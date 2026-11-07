import { NextResponse } from "next/server";
import { AuthError } from "@/server/auth";
import { HttpError } from "@/server/errors";
export { HttpError } from "@/server/errors";

export function jsonError(error: unknown) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "服务器处理失败，请稍后重试" }, { status: 500 });
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}
