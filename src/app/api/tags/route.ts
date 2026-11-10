import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { jsonError, sameOrigin } from "@/server/http";

const schema = z.object({ name: z.string().trim().min(1).max(40).refine((value) => !/[\u0000-\u001f]/.test(value), "标签不能包含控制字符") });

export async function GET() {
  try {
    await requireUser();
    const result = await query(
      `SELECT tag.id,tag.name,tag.created_at,COUNT(DISTINCT task_tag.task_id)::int AS task_count
       FROM creative_tags tag
       LEFT JOIN generation_task_tags task_tag ON task_tag.tag_id=tag.id
       GROUP BY tag.id
       ORDER BY lower(tag.name),tag.created_at`,
    );
    return NextResponse.json({ tags: result.rows });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 });
    const user = await requireUser();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "标签名称无效" }, { status: 400 });
    const inserted = await query<{ id: string; name: string; created_at: string }>(
      `INSERT INTO creative_tags(name,created_by) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id,name,created_at`,
      [parsed.data.name, user.id],
    );
    if (!inserted.rows[0]) return NextResponse.json({ error: "同名分类标签已存在，请直接选择已有标签" }, { status: 409 });
    return NextResponse.json({ tag: inserted.rows[0] }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
