import { NextResponse } from "next/server";
import { destroySession } from "@/server/auth";
import { sameOrigin } from "@/server/http";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 });
  await destroySession();
  return NextResponse.json({ ok: true });
}
