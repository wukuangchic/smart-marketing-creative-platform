import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { readMedia } from "@/server/media";
import { jsonError } from "@/server/http";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await params;
    const asset = await query<{ relative_path: string; media_type: string; original_name: string }>("SELECT relative_path,media_type,original_name FROM media_assets WHERE id=$1", [id]);
    if (!asset.rows[0]) return NextResponse.json({ error: "图片不存在" }, { status: 404 });
    const bytes = await readMedia(asset.rows[0].relative_path);
    const headers = new Headers({ "content-type": asset.rows[0].media_type, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" });
    if (new URL(request.url).searchParams.get("download") === "1") {
      const encodedName = encodeURIComponent(asset.rows[0].original_name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
      headers.set("content-disposition", `attachment; filename*=UTF-8''${encodedName}`);
    }
    return new NextResponse(new Uint8Array(bytes), { headers });
  } catch (error) { return jsonError(error); }
}
