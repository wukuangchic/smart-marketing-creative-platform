import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { jsonError } from "@/server/http";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 60;

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
    const tagId = params.get("tagId") || "";
    const offset = Math.min(Math.max(Number.parseInt(params.get("offset") || "0", 10) || 0, 0), 1_000_000);
    if (identifier.length > 40) return NextResponse.json({ error: "标识最多 40 个字符" }, { status: 400 });
    if ((dateFrom && !validDate(dateFrom)) || (dateTo && !validDate(dateTo))) return NextResponse.json({ error: "日期格式无效" }, { status: 400 });
    if (dateFrom && dateTo && dateFrom > dateTo) return NextResponse.json({ error: "开始日期不能晚于结束日期" }, { status: 400 });
    if (tagId && !UUID_PATTERN.test(tagId)) return NextResponse.json({ error: "分类标签无效" }, { status: 400 });

    const values: unknown[] = [];
    const conditions = ["asset.kind='output'"];
    const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
    if (identifier) conditions.push(`task.identifier=${add(identifier)}`);
    if (dateFrom) conditions.push(`asset.created_at >= (${add(dateFrom)}::date::timestamp AT TIME ZONE 'Asia/Shanghai')`);
    if (dateTo) conditions.push(`asset.created_at < ((${add(dateTo)}::date + interval '1 day') AT TIME ZONE 'Asia/Shanghai')`);
    if (tagId) conditions.push(`task.tag_id=${add(tagId)}::uuid`);
    const where = conditions.join(" AND ");
    const count = await query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM media_assets asset JOIN generation_tasks task ON task.id=asset.task_id
       WHERE ${where}`,
      values,
    );
    const pageValues = [...values, PAGE_SIZE, offset];
    const rows = await query(
      `SELECT asset.id,asset.original_name,asset.media_type,asset.width,asset.height,asset.size_bytes,asset.created_at,
              task.identifier,task.name_template,task.tag_id,tag.name AS tag_name,run.model_id
       FROM media_assets asset
       JOIN generation_tasks task ON task.id=asset.task_id
       LEFT JOIN creative_tags tag ON tag.id=task.tag_id
       LEFT JOIN provider_runs run ON run.id=asset.run_id
       WHERE ${where}
       ORDER BY asset.created_at DESC,asset.id
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      pageValues,
    );
    return NextResponse.json({ assets: rows.rows, total: count.rows[0]?.total || 0, offset, limit: PAGE_SIZE });
  } catch (error) { return jsonError(error); }
}
