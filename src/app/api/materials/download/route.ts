import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { readMedia } from "@/server/media";
import { jsonError, sameOrigin } from "@/server/http";

export const runtime = "nodejs";

const schema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });
const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;

type ZipAsset = { id: string; original_name: string; relative_path: string; size_bytes: string; created_at: string };
type ZipEntry = ZipAsset & { zipName: string };

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function dosTimestamp(value: string) {
  const date = new Date(value);
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

function safeZipName(name: string, id: string) {
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^[. ]+|[. ]+$/g, "").slice(0, 140);
  return safe || `material-${id}.png`;
}

function localHeader(name: Buffer, checksum: number, size: number, time: number, date: number) {
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(date, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  name.copy(header, 30);
  return header;
}

function centralHeader(name: Buffer, checksum: number, size: number, time: number, date: number, offset: number) {
  const header = Buffer.alloc(46 + name.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(date, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(size, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  name.copy(header, 46);
  return header;
}

async function* zipChunks(entries: ZipEntry[]) {
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const bytes = await readMedia(entry.relative_path);
    if (bytes.length !== Number(entry.size_bytes)) throw new Error("素材文件大小与记录不符，无法打包下载");
    const name = Buffer.from(entry.zipName, "utf8");
    const checksum = crc32(bytes);
    const timestamp = dosTimestamp(entry.created_at);
    const header = localHeader(name, checksum, bytes.length, timestamp.time, timestamp.date);
    yield header;
    yield bytes;
    central.push(centralHeader(name, checksum, bytes.length, timestamp.time, timestamp.date, offset));
    offset += header.length + bytes.length;
  }
  const centralOffset = offset;
  let centralSize = 0;
  for (const header of central) { yield header; centralSize += header.length; }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  yield end;
}

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

    const names = new Set<string>();
    const entries = result.rows.map((asset) => {
      const original = safeZipName(asset.original_name, asset.id);
      let name = original;
      let suffix = 2;
      while (names.has(name.toLocaleLowerCase())) {
        const dot = original.lastIndexOf(".");
        name = dot > 0 ? `${original.slice(0, dot)} (${suffix})${original.slice(dot)}` : `${original} (${suffix})`;
        suffix += 1;
      }
      names.add(name.toLocaleLowerCase());
      return { ...asset, zipName: name };
    });
    const iterator = zipChunks(entries);
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) { controller.error(error); }
      },
      async cancel(reason) { await iterator.return?.(reason); },
    });
    const filename = `creative-materials-${new Date().toISOString().slice(0, 10)}.zip`;
    return new NextResponse(body, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) { return jsonError(error); }
}
