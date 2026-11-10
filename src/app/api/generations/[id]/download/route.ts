import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { jsonError } from "@/server/http";
import { MAX_ARCHIVE_BYTES, zipDownloadResponse, type ZipAsset } from "@/server/zip";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dateForFilename(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}${part("month")}${part("day")}`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "任务编号无效" }, { status: 400 });
    const task = await query<{ identifier: string | null; created_at: Date | string }>(
      "SELECT identifier,created_at FROM generation_tasks WHERE id=$1", [id],
    );
    if (!task.rows[0]) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    const assets = await query<ZipAsset>(
      `SELECT id,original_name,relative_path,size_bytes,created_at
       FROM media_assets WHERE task_id=$1 AND kind='output'
       ORDER BY created_at,id`, [id],
    );
    if (!assets.rows.length) return NextResponse.json({ error: "这条创作记录还没有可下载的生成图片" }, { status: 409 });
    const totalBytes = assets.rows.reduce((sum, asset) => sum + Number(asset.size_bytes), 0);
    if (totalBytes > MAX_ARCHIVE_BYTES) return NextResponse.json({ error: "本任务素材超过 500 MiB，请联系管理员分批下载" }, { status: 413 });
    const taskDate = dateForFilename(task.rows[0].created_at);
    const taskIdentifier = task.rows[0].identifier?.replace(/[^a-z0-9_-]/gi, "").slice(0, 16) || id.slice(0, 8);
    return zipDownloadResponse(assets.rows, `creative-${taskIdentifier}-${taskDate}.zip`);
  } catch (error) { return jsonError(error); }
}
