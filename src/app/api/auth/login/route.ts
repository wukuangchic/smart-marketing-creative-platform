import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { feishuAuthorizeUrl, feishuConfigured } from "@/server/feishu";

export async function GET() {
  if (process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "1") return NextResponse.redirect(new URL("/", process.env.APP_BASE_URL || "http://localhost:3000"));
  if (!feishuConfigured()) return NextResponse.redirect(new URL("/login?setup=feishu", process.env.APP_BASE_URL || "http://localhost:3000"));
  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(feishuAuthorizeUrl(state));
  response.cookies.set("creative_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/callback", maxAge: 600 });
  return response;
}
