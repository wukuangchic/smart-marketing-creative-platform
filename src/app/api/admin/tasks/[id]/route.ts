import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { pool, query } from "@/server/db";
import { removeMedia } from "@/server/media";
import { jsonError, sameOrigin } from "@/server/http";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 });
    const admin = await requireAdmin();
    const { id } = await params;
    const client = await pool.connect();
    let paths: string[] = [];
    try {
      await client.query("BEGIN");
      const task = await client.query("SELECT id FROM generation_tasks WHERE id=$1 FOR UPDATE", [id]);
      if (!task.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "任务不存在或已删除" }, { status: 404 }); }
      const assets = await client.query<{ relative_path: string }>("SELECT relative_path FROM media_assets WHERE task_id=$1", [id]);
      paths = assets.rows.map((asset) => asset.relative_path);
      await client.query("INSERT INTO audit_logs(actor_id,action,target_type,target_id,details) VALUES ($1,'task.deleted','generation_task',$2,$3)", [admin.id,id,JSON.stringify({ assetCount: paths.length })]);
      await client.query("DELETE FROM generation_tasks WHERE id=$1", [id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    const cleanup = await Promise.allSettled(paths.map((relativePath) => removeMedia(relativePath)));
    const failedPaths = cleanup.flatMap((result, index) => result.status === "rejected" ? [paths[index]] : []);
    if (failedPaths.length) await query("INSERT INTO audit_logs(actor_id,action,target_type,target_id,details) VALUES ($1,'task.file_cleanup_failed','generation_task',$2,$3)", [admin.id,id,JSON.stringify({ paths: failedPaths })]);
    return NextResponse.json({ ok: true, cleanupPending: failedPaths.length });
  } catch (error) { return jsonError(error); }
}
