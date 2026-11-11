import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { pool, query } from "@/server/db";
import { jsonError, sameOrigin } from "@/server/http";

const schema = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(500),
  tagIds: z.array(z.string().uuid()).max(100),
});

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 });
    await requireUser();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "标签修改参数无效" }, { status: 400 });
    const assetIds = [...new Set(parsed.data.assetIds)];
    const tagIds = [...new Set(parsed.data.tagIds)];
    const [assets, tags] = await Promise.all([
      query<{ id: string; task_id: string }>("SELECT id,task_id FROM media_assets WHERE id=ANY($1::uuid[]) AND kind='output' AND task_id IS NOT NULL", [assetIds]),
      tagIds.length ? query("SELECT id FROM creative_tags WHERE id=ANY($1::uuid[])", [tagIds]) : Promise.resolve({ rows: [], rowCount: 0 }),
    ]);
    if (assets.rowCount !== assetIds.length) return NextResponse.json({ error: "所选素材中包含已不存在的图片，请刷新后重试" }, { status: 400 });
    if (tags.rowCount !== tagIds.length) return NextResponse.json({ error: "部分分类标签已不存在，请刷新后重试" }, { status: 400 });
    const taskIds = [...new Set(assets.rows.map((asset) => asset.task_id))];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM generation_task_tags WHERE task_id=ANY($1::uuid[])", [taskIds]);
      if (tagIds.length) await client.query(
        "INSERT INTO generation_task_tags(task_id,tag_id) SELECT tasks.task_id,labels.tag_id FROM unnest($1::uuid[]) AS tasks(task_id) CROSS JOIN unnest($2::uuid[]) AS labels(tag_id)",
        [taskIds, tagIds],
      );
      await client.query("UPDATE generation_tasks SET tag_id=$2 WHERE id=ANY($1::uuid[])", [taskIds, tagIds[0] || null]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    return NextResponse.json({ updatedTasks: taskIds.length, updatedAssets: assetIds.length, tagIds });
  } catch (error) { return jsonError(error); }
}
