import { createHash, randomUUID } from "node:crypto";
import { mkdir, stat, statfs, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "./errors";

const root = path.resolve(/*turbopackIgnore: true*/ process.env.MEDIA_ROOT || "./data/media");
const accepted = new Set(["image/png", "image/jpeg", "image/webp"]);
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function storeUpload(file: File, ownerId: string) {
  if (!accepted.has(file.type)) throw new HttpError(400, "仅支持 PNG、JPG、JPEG 和 WebP 图片");
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) throw new HttpError(400, "图片大小必须在 1 字节到 10 MiB 之间");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!matchesMediaType(bytes, file.type)) throw new HttpError(400, "图片内容与文件类型不匹配");
  const ext = file.type === "image/png" ? ".png" : file.type === "image/webp" ? ".webp" : ".jpg";
  const id = randomUUID();
  const relativePath = path.join(new Date().toISOString().slice(0, 7), `${id}${ext}`);
  const target = safePath(relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx", mode: 0o640 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { id, ownerId, relativePath, mediaType: file.type, size: bytes.length, sha256, originalName: file.name.slice(0, 180) };
}

function matchesMediaType(bytes: Buffer, mediaType: string) {
  if (mediaType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mediaType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return mediaType === "image/webp" && bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

export async function storeGenerated(bytes: Uint8Array, mediaType: string, ownerId: string) {
  if (!accepted.has(mediaType) || bytes.byteLength <= 0 || bytes.byteLength > 30 * 1024 * 1024 || !matchesMediaType(Buffer.from(bytes), mediaType)) {
    throw new Error("模型返回了无法安全保存的图片格式或内容");
  }
  const ext = mediaType === "image/jpeg" ? ".jpg" : mediaType === "image/webp" ? ".webp" : ".png";
  const id = randomUUID();
  const relativePath = path.join(new Date().toISOString().slice(0, 7), `${id}${ext}`);
  const target = safePath(relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx", mode: 0o640 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { id, ownerId, relativePath, mediaType, size: bytes.length, sha256, originalName: `generated${ext}` };
}

export async function readMedia(relativePath: string) {
  return readFile(/*turbopackIgnore: true*/ safePath(relativePath));
}

export async function removeMedia(relativePath: string) {
  return unlink(safePath(relativePath));
}

function safePath(relativePath: string) {
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Invalid media path");
  return target;
}

export async function storageStatus() {
  await mkdir(root, { recursive: true });
  const [fs, rootStat] = await Promise.all([statfs(/*turbopackIgnore: true*/ root), stat(/*turbopackIgnore: true*/ root)]);
  const totalBytes = Number(fs.blocks) * Number(fs.bsize);
  const freeBytes = Number(fs.bavail) * Number(fs.bsize);
  const warningAt = Number(process.env.STORAGE_WARNING_PERCENT || 80);
  const stopAt = Number(process.env.STORAGE_STOP_PERCENT || 95);
  return { root: rootStat.isDirectory() ? root : "", ...storageUsage(totalBytes, freeBytes, warningAt, stopAt) };
}

export function storageUsage(totalBytes: number, freeBytes: number, warningAt = 80, stopAt = 95) {
  const usedPercent = totalBytes ? Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10 : 0;
  return { totalBytes, freeBytes, usedPercent, warningAt, stopAt, warning: usedPercent >= warningAt, blocked: usedPercent >= stopAt };
}
