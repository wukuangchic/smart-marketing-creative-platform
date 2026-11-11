import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, requireUser } from "@/server/auth";
import { query, pool } from "@/server/db";
import { HttpError } from "@/server/errors";
import { MODELS, SHARED_ASPECT_RATIOS } from "@/server/models";
import { copyStoredMedia, MAX_INPUT_IMAGES, storeUpload, storageStatus } from "@/server/media";
import { getBoss } from "@/server/queue";
import { jsonError, sameOrigin } from "@/server/http";
import { createPromptPrefix, isPromptPrefix, MAX_BASE32_SEQUENCE, normalizePromptPrefix } from "@/server/identifiers";

const schema = z.object({
  mode: z.enum(["text-to-image", "image-to-image"]),
  prompt: z.string().trim().min(1).max(18000),
  nameTemplate: z.string().trim().min(1).max(120).refine((value) => {
    const tokens = value.match(/\{[^{}]*\}/g) || [];
    const allowed = new Set(["{标识}", "{日期}", "{模型}", "{员工姓名}", "{原名}"]);
    const withoutKnownTokens = value.replace(/\{标识\}|\{日期\}|\{模型\}|\{员工姓名\}|\{原名\}/g, "");
    return tokens.filter((token) => token === "{标识}").length === 1 && tokens.every((token) => allowed.has(token)) && !/[{}]/.test(withoutKnownTokens);
  }, "图片命名必须且只能包含一次 {标识}，其他通配符仅支持 {日期}、{模型}、{员工姓名} 和 {原名}"),
  promptPrefix: z.string().optional().nullable(),
  tagIds: z.array(z.string().uuid()).optional(),
  tagId: z.string().uuid().nullable().optional(),
  models: z.array(z.object({ modelKey: z.string(), count: z.coerce.number().int().min(1).max(20) })).min(1).max(MODELS.length),
  settings: z.object({
    aspectRatio: z.enum(SHARED_ASPECT_RATIOS),
    targetWidth: z.coerce.number().int().min(256).max(4096),
    targetHeight: z.coerce.number().int().min(256).max(4096),
  }),
  confirmed: z.literal("true"),
});

export async function POST(request: Request) {
  const uploaded: Awaited<ReturnType<typeof storeUpload>>[] = [];
  const createdMedia: Array<{ relativePath: string }> = [];
  let taskCommitted = false;
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 });
    const user = await requireUser();
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 110 * 1024 * 1024) return NextResponse.json({ error: "请求大小超过 110 MiB" }, { status: 413 });
    const usage = await storageStatus();
    if (usage.blocked) return NextResponse.json({ error: "图片存储空间已达到暂停阈值，请联系管理员扩容后再生成" }, { status: 507 });
    const form = await request.formData();
    const parsed = schema.safeParse({ mode: form.get("mode"), prompt: form.get("prompt"), nameTemplate: form.get("nameTemplate"), promptPrefix: String(form.get("promptPrefix") || "") || null, tagIds: JSON.parse(String(form.get("tagIds") || "[]")), tagId: String(form.get("tagId") || "") || null, models: JSON.parse(String(form.get("models") || "[]")), settings: JSON.parse(String(form.get("settings") || "{}")), confirmed: form.get("confirmed") });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "生成参数无效" }, { status: 400 });
    if (parsed.data.mode === "text-to-image" && parsed.data.nameTemplate.includes("{原名}")) return NextResponse.json({ error: "{原名} 仅适用于图生图命名" }, { status: 400 });
    const tagIds = [...new Set([...(parsed.data.tagIds || []), ...(parsed.data.tagId ? [parsed.data.tagId] : [])])];
    if (parsed.data.promptPrefix && !isPromptPrefix(parsed.data.promptPrefix)) return NextResponse.json({ error: "提示词标识前缀无效，请重新选择历史提示词" }, { status: 400 });
    if (parsed.data.promptPrefix) {
      const priorPrompts = await query<{ identifier: string | null }>("SELECT identifier FROM generation_tasks WHERE prompt=$1 ORDER BY created_at DESC LIMIT 100", [parsed.data.prompt]);
      if (!priorPrompts.rows.some((row) => normalizePromptPrefix(row.identifier) === parsed.data.promptPrefix)) {
        return NextResponse.json({ error: "历史提示词与标识前缀不匹配，请重新选择" }, { status: 400 });
      }
    }
    if (tagIds.length) {
      const tags = await query("SELECT id FROM creative_tags WHERE id=ANY($1::uuid[])", [tagIds]);
      if (tags.rowCount !== tagIds.length) return NextResponse.json({ error: "所选分类标签不存在，请刷新后重新选择" }, { status: 400 });
    }
    let assetIds: string[];
    try {
      const value = JSON.parse(String(form.get("inputAssetIds") || "[]"));
      if (!Array.isArray(value)) throw new Error("invalid");
      assetIds = z.array(z.string().uuid()).max(MAX_INPUT_IMAGES).parse(value);
    } catch { return NextResponse.json({ error: "素材库原图列表无效" }, { status: 400 }); }
    if (new Set(assetIds).size !== assetIds.length) return NextResponse.json({ error: "同一原图不能重复添加" }, { status: 400 });
    const inputFiles = form.getAll("images").filter((value): value is File => value instanceof File && value.size > 0);
    const legacyFile = form.get("image");
    if (legacyFile instanceof File && legacyFile.size > 0) inputFiles.push(legacyFile);
    const inputCount = inputFiles.length + assetIds.length;
    if (inputCount > MAX_INPUT_IMAGES) return NextResponse.json({ error: `一次最多添加 ${MAX_INPUT_IMAGES} 张原图` }, { status: 400 });
    if (parsed.data.mode === "image-to-image" && inputCount < 1) return NextResponse.json({ error: "图生图请至少添加一张原图" }, { status: 400 });
    if (parsed.data.mode === "text-to-image" && inputCount > 0) return NextResponse.json({ error: "文生图不接受参考图" }, { status: 400 });
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
    const referencedUploads: Awaited<ReturnType<typeof copyStoredMedia>>[] = [];
    if (assetIds.length) {
      const sourceRows = await query<{ id: string; relative_path: string; media_type: string; size_bytes: string; sha256: string; original_name: string }>(
        "SELECT id,relative_path,media_type,size_bytes,sha256,original_name FROM media_assets WHERE id=ANY($1::uuid[]) AND kind='output'", [assetIds],
      );
      const sourceById = new Map(sourceRows.rows.map((row) => [row.id, row]));
      if (sourceById.size !== assetIds.length) return NextResponse.json({ error: "部分素材不存在或不可用于图生图，请刷新素材库" }, { status: 400 });
      for (const id of assetIds) {
        const source = sourceById.get(id)!;
        const copy = await copyStoredMedia({ relativePath: source.relative_path, mediaType: source.media_type, size: Number(source.size_bytes), sha256: source.sha256, originalName: source.original_name }, user.id);
        referencedUploads.push(copy);
        createdMedia.push(copy);
      }
    }
    for (const file of inputFiles) {
      const upload = await storeUpload(file, user.id);
      uploaded.push(upload);
      createdMedia.push(upload);
    }
    const inputs = [...uploaded, ...referencedUploads];
    const taskId = randomUUID();
    const assetId = inputs[0]?.id || null;
    const dbClient = await pool.connect();
    const runIds: string[] = [];
    const identifier = parsed.data.promptPrefix || createPromptPrefix();
    let sequenceStart = 1;
    try {
      await dbClient.query("BEGIN");
      for (const input of inputs) await dbClient.query(
        `INSERT INTO media_assets(id,owner_id,kind,relative_path,media_type,size_bytes,sha256,original_name)
         VALUES ($1,$2,'input',$3,$4,$5,$6,$7)`,
        [input.id, input.ownerId, input.relativePath, input.mediaType, input.size, input.sha256, input.originalName],
      );
      const totalRequested = parsed.data.models.reduce((sum, item) => sum + item.count, 0) * Math.max(1, inputs.length);
      await dbClient.query(
        `INSERT INTO prompt_sequences(prompt_prefix,next_sequence) VALUES ($1,1) ON CONFLICT (prompt_prefix) DO NOTHING`, [identifier],
      );
      const sequence = await dbClient.query<{ next_sequence: number }>(
        "SELECT next_sequence FROM prompt_sequences WHERE prompt_prefix=$1 FOR UPDATE", [identifier],
      );
      sequenceStart = Number(sequence.rows[0]?.next_sequence || 1);
      if (sequenceStart + totalRequested - 1 > MAX_BASE32_SEQUENCE) throw new HttpError(409, "该提示词的 4 位图片序号已用完，请联系管理员处理");
      await dbClient.query(
        "UPDATE prompt_sequences SET next_sequence=$2,updated_at=now() WHERE prompt_prefix=$1", [identifier, sequenceStart + totalRequested],
      );
      await dbClient.query(
        `INSERT INTO generation_tasks(id,creator_id,mode,prompt,name_template,identifier,tag_id,input_asset_id,settings,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued')`,
        [taskId, user.id, parsed.data.mode, parsed.data.prompt, parsed.data.nameTemplate, identifier, tagIds[0] || null, assetId, JSON.stringify(taskSettings)],
      );
      for (const [position, input] of inputs.entries()) {
        await dbClient.query("UPDATE media_assets SET task_id=$2 WHERE id=$1", [input.id, taskId]);
        await dbClient.query("INSERT INTO generation_task_inputs(task_id,asset_id,position) VALUES ($1,$2,$3)", [taskId, input.id, position]);
      }
      if (tagIds.length) await dbClient.query(
        `INSERT INTO generation_task_tags(task_id,tag_id)
         SELECT $1,selected.tag_id FROM unnest($2::uuid[]) AS selected(tag_id)`,
        [taskId, tagIds],
      );
      for (const requested of parsed.data.models) {
        const model = MODELS.find((item) => item.key === requested.modelKey)!;
        const sources: Array<{ id: string | null }> = inputs.length ? inputs.map((input) => ({ id: input.id })) : [{ id: null }];
        for (const source of sources) {
          const runId = randomUUID();
          runIds.push(runId);
          await dbClient.query(
            `INSERT INTO provider_runs(id,task_id,provider,model_key,model_id,input_asset_id,requested_count,sequence_start,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued')`,
            [runId, taskId, model.provider, model.key, model.modelId, source.id, requested.count, sequenceStart],
          );
          sequenceStart += requested.count;
        }
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
    return NextResponse.json({ taskId, identifier, displayName: identifier, status: queuedCount ? "queued" : "failed", warning: queueWarning ? "部分模型未能进入后台队列，失败状态已记录" : undefined }, { status: 202 });
  } catch (error) {
    if (!taskCommitted && createdMedia.length) {
      try { const { removeMedia } = await import("@/server/media"); await Promise.all(createdMedia.map((item) => removeMedia(item.relativePath))); } catch { /* orphan is reported by storage scan */ }
    }
    return jsonError(error);
  }
}

export async function GET(request: Request) {
  try {
    await requireUser();
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 500);
    const offset = Math.min(Math.max(Number.parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0), 1_000_000);
    const search = (url.searchParams.get("search") || "").trim().slice(0, 200);
    const values: unknown[] = [];
    const conditions: string[] = [];
    if (search) {
      values.push(`%${search}%`);
      const pattern = `$${values.length}`;
      conditions.push(`(
        t.prompt ILIKE ${pattern} OR u.display_name ILIKE ${pattern} OR COALESCE(t.name_template,'') ILIKE ${pattern}
        OR COALESCE(t.identifier,'') ILIKE ${pattern}
        OR EXISTS (SELECT 1 FROM generation_task_tags search_tag JOIN creative_tags tag ON tag.id=search_tag.tag_id WHERE search_tag.task_id=t.id AND tag.name ILIKE ${pattern})
        OR EXISTS (SELECT 1 FROM provider_runs search_run WHERE search_run.task_id=t.id AND (search_run.model_id ILIKE ${pattern} OR search_run.model_key ILIKE ${pattern}))
      )`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const pageValues = [...values, limit, offset];
    const [count, result] = await Promise.all([query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM generation_tasks t JOIN users u ON u.id=t.creator_id
       ${where}`,
      values,
    ), query(
      `SELECT t.id,t.mode,t.prompt,t.name_template,t.identifier,t.tag_id,ct.name AS tag_name,
              COALESCE((SELECT json_agg(json_build_object('id',tag.id,'name',tag.name) ORDER BY lower(tag.name),tag.created_at)
                        FROM generation_task_tags task_tag JOIN creative_tags tag ON tag.id=task_tag.tag_id WHERE task_tag.task_id=t.id),'[]'::json) AS tags,
              t.settings,t.status,t.created_at,t.finished_at,
              u.display_name AS creator_name,
              COALESCE((SELECT json_agg(json_build_object('id',a.id,'kind',a.kind,'url','/api/assets/'||a.id,'width',a.width,'height',a.height,'mediaType',a.media_type,'originalName',a.original_name,'identifier',a.identifier) ORDER BY a.created_at)
                        FROM media_assets a WHERE a.task_id=t.id),'[]'::json) AS assets,
              COALESCE((SELECT json_agg(json_build_object('id',r.id,'provider',r.provider,'modelKey',r.model_key,'modelId',r.model_id,'inputAssetId',r.input_asset_id,'status',r.status,'requestedCount',r.requested_count,'imageCount',r.image_count,'usage',r.usage,'estimatedCost',r.estimated_cost,'currency',r.currency,'estimatedCostCny',r.estimated_cost_cny,'errorMessage',r.error_message,'startedAt',r.started_at,'finishedAt',r.finished_at,'outputs',COALESCE((SELECT json_agg(json_build_object('id',a.id,'url','/api/assets/'||a.id,'width',a.width,'height',a.height,'originalName',a.original_name,'identifier',a.identifier) ORDER BY a.created_at) FROM media_assets a WHERE a.run_id=r.id),'[]'::json)) ORDER BY r.created_at)
                        FROM provider_runs r WHERE r.task_id=t.id),'[]'::json) AS runs
       FROM generation_tasks t JOIN users u ON u.id=t.creator_id LEFT JOIN creative_tags ct ON ct.id=t.tag_id
       ${where}
       ORDER BY t.created_at DESC,t.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      pageValues,
    )]);
    return NextResponse.json({ tasks: result.rows, total: count.rows[0]?.total || 0, offset, limit });
  } catch (error) { return jsonError(error); }
}
