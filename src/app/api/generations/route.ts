import { randomInt, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, requireUser } from "@/server/auth";
import { query, pool } from "@/server/db";
import { MODELS, SHARED_ASPECT_RATIOS } from "@/server/models";
import { storeUpload, storageStatus } from "@/server/media";
import { getBoss } from "@/server/queue";
import { jsonError, sameOrigin } from "@/server/http";

const schema = z.object({
  mode: z.enum(["text-to-image", "image-to-image"]),
  prompt: z.string().trim().min(1).max(18000),
  nameTemplate: z.string().trim().min(1).max(120).refine((value) => (value.match(/\{标识\}/g) || []).length === 1, "创作命名必须且只能包含一次 {标识}"),
  models: z.array(z.object({ modelKey: z.string(), count: z.coerce.number().int().min(1).max(20) })).min(1).max(MODELS.length),
  settings: z.object({
    aspectRatio: z.enum(SHARED_ASPECT_RATIOS),
    targetWidth: z.coerce.number().int().min(256).max(4096),
    targetHeight: z.coerce.number().int().min(256).max(4096),
  }),
  confirmed: z.literal("true"),
});

const IDENTIFIER_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function createIdentifier() {
  return Array.from({ length: 6 }, () => IDENTIFIER_ALPHABET[randomInt(IDENTIFIER_ALPHABET.length)]).join("");
}

export async function POST(request: Request) {
  let uploaded: Awaited<ReturnType<typeof storeUpload>> | undefined;
  let taskCommitted = false;
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 });
    const user = await requireUser();
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 12 * 1024 * 1024) return NextResponse.json({ error: "请求大小超过 12 MiB" }, { status: 413 });
    const usage = await storageStatus();
    if (usage.blocked) return NextResponse.json({ error: "图片存储空间已达到暂停阈值，请联系管理员扩容后再生成" }, { status: 507 });
    const form = await request.formData();
    const parsed = schema.safeParse({ mode: form.get("mode"), prompt: form.get("prompt"), nameTemplate: form.get("nameTemplate"), models: JSON.parse(String(form.get("models") || "[]")), settings: JSON.parse(String(form.get("settings") || "{}")), confirmed: form.get("confirmed") });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "生成参数无效" }, { status: 400 });
    const inputFile = form.get("image");
    if (parsed.data.mode === "image-to-image" && !(inputFile instanceof File)) return NextResponse.json({ error: "图生图需要上传一张原图" }, { status: 400 });
    if (parsed.data.mode === "text-to-image" && inputFile instanceof File && inputFile.size) return NextResponse.json({ error: "文生图不接受参考图" }, { status: 400 });
    const unique = new Set(parsed.data.models.map((item) => item.modelKey));
    if (unique.size !== parsed.data.models.length) return NextResponse.json({ error: "同一模型不能重复选择" }, { status: 400 });
    for (const requested of parsed.data.models) {
      const model = MODELS.find((item) => item.key === requested.modelKey);
      if (!model || requested.count > model.maxImages) return NextResponse.json({ error: "所选模型或图片张数超出模型能力" }, { status: 400 });
      if (parsed.data.mode === "text-to-image" && !model.supportsTextToImage) return NextResponse.json({ error: `${model.name} 不支持文生图` }, { status: 400 });
      if (parsed.data.mode === "image-to-image" && !model.supportsImageToImage) return NextResponse.json({ error: `${model.name} 不支持图生图，请切换文生图模式或更换模型` }, { status: 400 });
      if ("maxPromptChars" in model && parsed.data.prompt.length > model.maxPromptChars) return NextResponse.json({ error: `${model.name} 的提示词最多支持 ${model.maxPromptChars} 个字符` }, { status: 400 });
      const configured = await query<{ enabled: boolean }>("SELECT p.enabled AND m.enabled AS enabled FROM provider_configs p JOIN provider_models m ON m.provider=p.provider WHERE m.model_key=$1", [requested.modelKey]);
      if (!configured.rows[0]?.enabled) return NextResponse.json({ error: `${model.name} 尚未由管理员启用或配置 API 密钥` }, { status: 409 });
    }
    const imageSize = Math.max(parsed.data.settings.targetWidth, parsed.data.settings.targetHeight) > 1536 ? "2K" : "1K";
    const taskSettings = { ...parsed.data.settings, imageSize };
    if (parsed.data.mode === "image-to-image") uploaded = await storeUpload(inputFile as File, user.id);
    const taskId = randomUUID();
    const assetId = uploaded?.id || null;
    const dbClient = await pool.connect();
    const runIds: string[] = [];
    let identifier = "";
    try {
      await dbClient.query("BEGIN");
      if (uploaded) await dbClient.query(
        `INSERT INTO media_assets(id,owner_id,kind,relative_path,media_type,size_bytes,sha256,original_name)
         VALUES ($1,$2,'input',$3,$4,$5,$6,$7)`,
        [uploaded.id, uploaded.ownerId, uploaded.relativePath, uploaded.mediaType, uploaded.size, uploaded.sha256, uploaded.originalName],
      );
      let insertedTask = false;
      for (let attempt = 0; attempt < 10 && !insertedTask; attempt += 1) {
        identifier = createIdentifier();
        const result = await dbClient.query(
          `INSERT INTO generation_tasks(id,creator_id,mode,prompt,name_template,identifier,input_asset_id,settings,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued') ON CONFLICT (identifier) DO NOTHING RETURNING id`,
          [taskId, user.id, parsed.data.mode, parsed.data.prompt, parsed.data.nameTemplate, identifier, assetId, JSON.stringify(taskSettings)],
        );
        insertedTask = Boolean(result.rowCount);
      }
      if (!insertedTask) throw new Error("无法生成唯一的创作标识，请重新提交");
      for (const requested of parsed.data.models) {
        const model = MODELS.find((item) => item.key === requested.modelKey)!;
        const runId = randomUUID();
        runIds.push(runId);
        await dbClient.query(
          `INSERT INTO provider_runs(id,task_id,provider,model_key,model_id,requested_count,status) VALUES ($1,$2,$3,$4,$5,$6,'queued')`,
          [runId, taskId, model.provider, model.key, model.modelId, requested.count],
        );
      }
      await dbClient.query("COMMIT");
      taskCommitted = true;
    } catch (error) {
      await dbClient.query("ROLLBACK");
      throw error;
    } finally { dbClient.release(); }
    const boss = await getBoss();
    let queuedCount = 0;
    let queueWarning = false;
    try {
      for (const runId of runIds) {
        await boss.send("generate-provider-run", { runId });
        queuedCount += 1;
      }
    } catch {
      queueWarning = true;
      const unsentRunIds = runIds.slice(queuedCount);
      if (unsentRunIds.length) {
        await query("UPDATE provider_runs SET status='failed',error_message='后台任务队列无法提交，请联系管理员',finished_at=now() WHERE id=ANY($1::uuid[])", [unsentRunIds]);
        if (queuedCount === 0) await query("UPDATE generation_tasks SET status='failed',finished_at=now() WHERE id=$1", [taskId]);
      }
    }
    return NextResponse.json({ taskId, identifier, displayName: parsed.data.nameTemplate.replace("{标识}", identifier), status: queuedCount ? "queued" : "failed", warning: queueWarning ? "部分模型未能进入后台队列，失败状态已记录" : undefined }, { status: 202 });
  } catch (error) {
    if (uploaded && !taskCommitted) {
      try { const { removeMedia } = await import("@/server/media"); await removeMedia(uploaded.relativePath); } catch { /* orphan is reported by storage scan */ }
    }
    return jsonError(error);
  }
}

export async function GET(request: Request) {
  try {
    await requireUser();
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);
    const result = await query(
      `SELECT t.id,t.mode,t.prompt,t.name_template,t.identifier,t.settings,t.status,t.created_at,t.finished_at,
              u.display_name AS creator_name,
              COALESCE((SELECT json_agg(json_build_object('id',a.id,'kind',a.kind,'url','/api/assets/'||a.id,'width',a.width,'height',a.height,'mediaType',a.media_type) ORDER BY a.created_at)
                        FROM media_assets a WHERE a.task_id=t.id),'[]'::json) AS assets,
              COALESCE((SELECT json_agg(json_build_object('id',r.id,'provider',r.provider,'modelKey',r.model_key,'modelId',r.model_id,'status',r.status,'requestedCount',r.requested_count,'imageCount',r.image_count,'usage',r.usage,'estimatedCost',r.estimated_cost,'currency',r.currency,'estimatedCostCny',r.estimated_cost_cny,'errorMessage',r.error_message,'startedAt',r.started_at,'finishedAt',r.finished_at,'outputs',COALESCE((SELECT json_agg(json_build_object('id',a.id,'url','/api/assets/'||a.id,'width',a.width,'height',a.height) ORDER BY a.created_at) FROM media_assets a WHERE a.run_id=r.id),'[]'::json)) ORDER BY r.created_at)
                        FROM provider_runs r WHERE r.task_id=t.id),'[]'::json) AS runs
       FROM generation_tasks t JOIN users u ON u.id=t.creator_id ORDER BY t.created_at DESC LIMIT $1`, [limit],
    );
    return NextResponse.json({ tasks: result.rows });
  } catch (error) { return jsonError(error); }
}
