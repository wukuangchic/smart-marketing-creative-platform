import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { readMedia } from "@/server/media";
import { jsonError } from "@/server/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await params;
    const asset = await query<{ relative_path: string; media_type: string }>("SELECT relative_path,media_type FROM media_assets WHERE id=$1", [id]);
    if (!asset.rows[0]) return NextResponse.json({ error: "图片不存在" }, { status: 404 });
    const bytes = await readMedia(asset.rows[0].relative_path);
    return new NextResponse(new Uint8Array(bytes), { headers: { "content-type": asset.rows[0].media_type, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
  } catch (error) { return jsonError(error); }
}
