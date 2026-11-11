import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { PROVIDERS } from "@/server/models";
import { jsonError } from "@/server/http";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZES = new Set([20, 100, 500]);

function validDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function GET(request: Request) {
  try {
    await requireUser();
    const params = new URL(request.url).searchParams;
    const identifier = params.get("identifier")?.trim() || "";
    const dateFrom = params.get("dateFrom") || "";
    const dateTo = params.get("dateTo") || "";
    const tagIds = [...new Set([...params.getAll("tagIds"), ...params.getAll("tagId")].flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))];
    const tagMode = params.get("tagMode") === "all" ? "all" : "any";
    const provider = params.get("provider") || "";
    const modelKey = params.get("modelKey") || "";
    const requestedLimit = Number.parseInt(params.get("limit") || "20", 10);
    const limit = PAGE_SIZES.has(requestedLimit) ? requestedLimit : 20;
    const offset = Math.min(Math.max(Number.parseInt(params.get("offset") || "0", 10) || 0, 0), 1_000_000);
    if (identifier.length > 8 || (identifier && !/^[0-9a-z]+$/i.test(identifier))) return NextResponse.json({ error: "请输入有效的提示词前缀或素材标识" }, { status: 400 });
    if ((dateFrom && !validDate(dateFrom)) || (dateTo && !validDate(dateTo))) return NextResponse.json({ error: "日期格式无效" }, { status: 400 });
    if (dateFrom && dateTo && dateFrom > dateTo) return NextResponse.json({ error: "开始日期不能晚于结束日期" }, { status: 400 });
    if (tagIds.some((tagId) => !UUID_PATTERN.test(tagId)) || tagIds.length > 100) return NextResponse.json({ error: "分类标签无效" }, { status: 400 });
    if (provider && !["bailian", "gemini", "zhipu"].includes(provider)) return NextResponse.json({ error: "模型供应商无效" }, { status: 400 });
    if (modelKey && !/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(modelKey)) return NextResponse.json({ error: "模型无效" }, { status: 400 });

    const values: unknown[] = [];
    const conditions = ["asset.kind='output'"];
    const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
    if (identifier) {
      const pattern = add(`${identifier.toUpperCase()}%`);
      conditions.push(`(UPPER(COALESCE(asset.identifier,task.identifier)) LIKE ${pattern} OR UPPER(task.identifier) LIKE ${pattern})`);
    }
    if (dateFrom) conditions.push(`asset.created_at >= (${add(dateFrom)}::date::timestamp AT TIME ZONE 'Asia/Shanghai')`);
    if (dateTo) conditions.push(`asset.created_at < ((${add(dateTo)}::date + interval '1 day') AT TIME ZONE 'Asia/Shanghai')`);
    if (tagIds.length) {
      const selectedTags = add(tagIds);
      if (tagMode === "all") {
        conditions.push(`((SELECT count(DISTINCT task_tag.tag_id) FROM generation_task_tags task_tag WHERE task_tag.task_id=task.id AND task_tag.tag_id=ANY(${selectedTags}::uuid[]))
          + CASE WHEN task.tag_id=ANY(${selectedTags}::uuid[]) AND NOT EXISTS (SELECT 1 FROM generation_task_tags legacy_tag WHERE legacy_tag.task_id=task.id AND legacy_tag.tag_id=task.tag_id) THEN 1 ELSE 0 END)=cardinality(${selectedTags}::uuid[])`);
      } else {
        conditions.push(`(task.tag_id=ANY(${selectedTags}::uuid[]) OR EXISTS (
          SELECT 1 FROM generation_task_tags task_tag WHERE task_tag.task_id=task.id AND task_tag.tag_id=ANY(${selectedTags}::uuid[])
        ))`);
      }
    }
    if (provider) conditions.push(`run.provider=${add(provider)}`);
    if (modelKey) conditions.push(`run.model_key=${add(modelKey)}`);
    const where = conditions.join(" AND ");
    const pageValues = [...values, limit, offset];
    const [count, rows, modelOptions] = await Promise.all([query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM media_assets asset JOIN generation_tasks task ON task.id=asset.task_id LEFT JOIN provider_runs run ON run.id=asset.run_id
       WHERE ${where}`,
      values,
    ),
    query(
      `SELECT asset.id,asset.original_name,asset.media_type,asset.width,asset.height,asset.size_bytes,asset.created_at,
              COALESCE(asset.identifier,task.identifier) AS identifier,task.identifier AS prompt_prefix,task.name_template,task.tag_id,tag.name AS tag_name,
              COALESCE((SELECT json_agg(json_build_object('id',task_label.id,'name',task_label.name) ORDER BY lower(task_label.name),task_label.created_at)
                        FROM generation_task_tags task_tag JOIN creative_tags task_label ON task_label.id=task_tag.tag_id WHERE task_tag.task_id=task.id),'[]'::json) AS tags,
              run.provider,run.model_key,run.model_id,model.display_name AS model_name
       FROM media_assets asset
       JOIN generation_tasks task ON task.id=asset.task_id
       LEFT JOIN creative_tags tag ON tag.id=task.tag_id
       LEFT JOIN provider_runs run ON run.id=asset.run_id
       LEFT JOIN provider_models model ON model.model_key=run.model_key
       WHERE ${where}
       ORDER BY asset.created_at DESC,asset.id
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      pageValues,
    ),
    query<{ provider: string; model_key: string; model_id: string; model_name: string | null }>(
      `SELECT DISTINCT run.provider,run.model_key,run.model_id,model.display_name AS model_name
       FROM media_assets asset JOIN provider_runs run ON run.id=asset.run_id
       LEFT JOIN provider_models model ON model.model_key=run.model_key
       WHERE asset.kind='output' ORDER BY run.provider,model_name,run.model_id`,
    )]);
    const models = modelOptions.rows.map((model) => ({
      ...model,
      provider_name: PROVIDERS[model.provider as keyof typeof PROVIDERS]?.shortName || model.provider,
      model_name: model.model_name || model.model_id,
    }));
    return NextResponse.json({ assets: rows.rows, total: count.rows[0]?.total || 0, offset, limit, models });
  } catch (error) { return jsonError(error); }
}
