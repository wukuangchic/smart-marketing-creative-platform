import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { readMedia } from "@/server/media";
import { jsonError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await params;
    const asset = await query<{ relative_path: string }>("SELECT relative_path FROM media_assets WHERE id=$1", [id]);
    if (!asset.rows[0]) return NextResponse.json({ error: "图片不存在" }, { status: 404 });

    const source = await readMedia(asset.rows[0].relative_path);
    const thumbnail = await sharp(source)
      .rotate()
      .resize(300, 300, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .webp({ quality: 78 })
      .toBuffer();

    return new NextResponse(new Uint8Array(thumbnail), {
      headers: {
        "content-type": "image/webp",
        "content-length": String(thumbnail.byteLength),
        "cache-control": "private, max-age=604800, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) { return jsonError(error); }
}
