import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { jsonError, sameOrigin } from "@/server/http";
import { MAX_ARCHIVE_BYTES, zipDownloadResponse, type ZipAsset } from "@/server/zip";

export const runtime = "nodejs";

const schema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 });
    await requireUser();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "请选择 1 到 100 张素材下载" }, { status: 400 });
    const ids = [...new Set(parsed.data.ids)];
    const result = await query<ZipAsset>(
      `SELECT id,original_name,relative_path,size_bytes,created_at
       FROM media_assets WHERE kind='output' AND id=ANY($1::uuid[])
       ORDER BY created_at,id`, [ids],
    );
    if (result.rows.length !== ids.length) return NextResponse.json({ error: "部分素材不存在或不可下载，请刷新素材库后重试" }, { status: 404 });
    const totalBytes = result.rows.reduce((sum, asset) => sum + Number(asset.size_bytes), 0);
    if (totalBytes > MAX_ARCHIVE_BYTES) return NextResponse.json({ error: "所选素材超过 500 MiB，请分批下载" }, { status: 413 });
    const filename = `creative-materials-${new Date().toISOString().slice(0, 10)}.zip`;
    return zipDownloadResponse(result.rows, filename);
  } catch (error) { return jsonError(error); }
}
