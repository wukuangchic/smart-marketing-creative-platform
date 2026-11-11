import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { jsonError } from "@/server/http";
import { PROVIDERS } from "@/server/models";
import { normalizePromptPrefix } from "@/server/identifiers";

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
    const search = (params.get("search") || "").trim().slice(0, 160);
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
    if (provider && !["bailian", "gemini", "zhipu", "volcengine"].includes(provider)) return NextResponse.json({ error: "模型供应商无效" }, { status: 400 });
    if (modelKey && !/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(modelKey)) return NextResponse.json({ error: "模型无效" }, { status: 400 });

    const values: unknown[] = [];
    const conditions = ["task.prompt<>''"];
    const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
    if (search) {
      const pattern = add(`%${search}%`);
      conditions.push(`(task.prompt ILIKE ${pattern} OR task.identifier ILIKE ${pattern} OR EXISTS (
        SELECT 1 FROM media_assets search_asset WHERE search_asset.task_id=task.id AND search_asset.kind='output'
          AND UPPER(COALESCE(search_asset.identifier,'')) LIKE UPPER(${pattern})
      ))`);
    }
    if (identifier) {
      const pattern = add(`${identifier.toUpperCase()}%`);
      conditions.push(`(UPPER(COALESCE(task.identifier,'')) LIKE ${pattern} OR EXISTS (
        SELECT 1 FROM media_assets identifier_asset WHERE identifier_asset.task_id=task.id AND identifier_asset.kind='output'
          AND UPPER(COALESCE(identifier_asset.identifier,'')) LIKE ${pattern}
      ))`);
    }
    if (dateFrom) conditions.push(`task.created_at >= (${add(dateFrom)}::date::timestamp AT TIME ZONE 'Asia/Shanghai')`);
    if (dateTo) conditions.push(`task.created_at < ((${add(dateTo)}::date + interval '1 day') AT TIME ZONE 'Asia/Shanghai')`);
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
    let runFilters = "";
    if (provider) {
      const providerValue = add(provider);
      conditions.push(`EXISTS (SELECT 1 FROM provider_runs filter_run WHERE filter_run.task_id=task.id AND filter_run.provider=${providerValue}`);
      runFilters += ` AND run.provider=${providerValue}`;
      if (modelKey) {
        const modelValue = add(modelKey);
        conditions[conditions.length - 1] += ` AND filter_run.model_key=${modelValue}`;
        conditions[conditions.length - 1] += ")";
        runFilters += ` AND run.model_key=${modelValue}`;
      } else {
        conditions[conditions.length - 1] += ")";
      }
    } else if (modelKey) {
      const modelValue = add(modelKey);
      conditions.push(`EXISTS (SELECT 1 FROM provider_runs filter_run WHERE filter_run.task_id=task.id AND filter_run.model_key=${modelValue})`);
      runFilters += ` AND run.model_key=${modelValue}`;
    }
    const where = conditions.join(" AND ");
    const pageValues = [...values, limit, offset];
    const [count, rows, modelOptions] = await Promise.all([
      query<{ total: number }>(
        `SELECT count(*)::int AS total FROM (
           SELECT task.prompt FROM generation_tasks task WHERE ${where} GROUP BY task.prompt
         ) prompt_groups`, values,
      ),
      query(
        `WITH matched_tasks AS (
           SELECT task.id,task.prompt,task.identifier,task.created_at,task.tag_id
           FROM generation_tasks task WHERE ${where}
         ),
         matched_runs AS (
           SELECT run.id,run.task_id,matched_tasks.prompt,run.provider,run.model_key,run.model_id,run.status,run.image_count,
                  run.estimated_cost,run.estimated_cost_cny,run.currency,model.display_name AS model_name
           FROM provider_runs run
           JOIN matched_tasks ON matched_tasks.id=run.task_id
           LEFT JOIN provider_models model ON model.model_key=run.model_key
           WHERE true ${runFilters}
         ),
         prompt_groups AS (
           SELECT prompt,count(*)::int AS uses,max(created_at) AS latest_at,
                  (array_agg(identifier ORDER BY created_at DESC))[1] AS latest_identifier
           FROM matched_tasks GROUP BY prompt
         ),
         run_summary AS (
           SELECT prompt,count(*)::int AS model_runs,COALESCE(sum(image_count),0)::int AS generated_images,
                  sum(estimated_cost_cny) AS estimated_cost_cny,
                  count(*) FILTER (WHERE estimated_cost IS NOT NULL AND estimated_cost_cny IS NULL)::int AS unconverted_runs
           FROM matched_runs GROUP BY prompt
         ),
         asset_summary AS (
           SELECT matched_runs.prompt,count(DISTINCT asset.id)::int AS output_assets
           FROM matched_runs JOIN media_assets asset ON asset.run_id=matched_runs.id AND asset.kind='output'
           GROUP BY matched_runs.prompt
         ),
         model_items AS (
           SELECT DISTINCT prompt,provider,COALESCE(model_name,model_id) AS model_name FROM matched_runs
         ),
         model_summary AS (
           SELECT prompt,jsonb_agg(jsonb_build_object('provider',provider,'name',model_name) ORDER BY lower(model_name)) AS models
           FROM model_items GROUP BY prompt
         ),
         tag_items AS (
           SELECT DISTINCT matched_tasks.prompt,tag.id,tag.name
           FROM matched_tasks JOIN generation_task_tags task_tag ON task_tag.task_id=matched_tasks.id
           JOIN creative_tags tag ON tag.id=task_tag.tag_id
           UNION
           SELECT DISTINCT matched_tasks.prompt,tag.id,tag.name
           FROM matched_tasks JOIN creative_tags tag ON tag.id=matched_tasks.tag_id
         ),
         tag_summary AS (
           SELECT prompt,jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY lower(name)) AS tags
           FROM tag_items GROUP BY prompt
         )
         SELECT prompt_groups.prompt,prompt_groups.uses,prompt_groups.latest_at,prompt_groups.latest_identifier,
                COALESCE(run_summary.model_runs,0) AS model_runs,COALESCE(run_summary.generated_images,0) AS generated_images,
                run_summary.estimated_cost_cny,COALESCE(run_summary.unconverted_runs,0) AS unconverted_runs,
                COALESCE(asset_summary.output_assets,0) AS output_assets,
                COALESCE(model_summary.models,'[]'::jsonb) AS models,COALESCE(tag_summary.tags,'[]'::jsonb) AS tags
         FROM prompt_groups
         LEFT JOIN run_summary USING(prompt)
         LEFT JOIN asset_summary USING(prompt)
         LEFT JOIN model_summary USING(prompt)
         LEFT JOIN tag_summary USING(prompt)
         ORDER BY prompt_groups.latest_at DESC,prompt_groups.prompt
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        pageValues,
      ),
      query<{ provider: string; model_key: string; model_id: string; model_name: string | null }>(
        `SELECT DISTINCT run.provider,run.model_key,run.model_id,model.display_name AS model_name
         FROM provider_runs run LEFT JOIN provider_models model ON model.model_key=run.model_key
         ORDER BY run.provider,model_name,run.model_id`,
      ),
    ]);
    const prompts = rows.rows.map((row: Record<string, unknown>) => ({ ...row, promptPrefix: normalizePromptPrefix(typeof row.latest_identifier === "string" ? row.latest_identifier : null) }));
    const models = modelOptions.rows.map((model) => ({ ...model, provider_name: PROVIDERS[model.provider as keyof typeof PROVIDERS]?.shortName || model.provider, model_name: model.model_name || model.model_id }));
    return NextResponse.json({ prompts, total: count.rows[0]?.total || 0, offset, limit, models });
  } catch (error) { return jsonError(error); }
}
