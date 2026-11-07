import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { query } from "@/server/db";
import { createSession } from "@/server/auth";
import { getFeishuProfile } from "@/server/feishu";

export async function GET(request: NextRequest) {
  const base = process.env.APP_BASE_URL || request.nextUrl.origin;
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const jar = await cookies();
  const expected = jar.get("creative_oauth_state")?.value;
  jar.delete("creative_oauth_state");
  if (!code || !state || !expected || state !== expected) return NextResponse.redirect(new URL("/login?error=oauth_state", base));
  try {
    const profile = await getFeishuProfile(code);
    const existing = await query<{ id: string; role: "member" | "admin"; active: boolean }>("SELECT id,role,active FROM users WHERE feishu_open_id=$1", [profile.open_id]);
    let user = existing.rows[0];
    const bootstrapAdmins = (process.env.BOOTSTRAP_ADMIN_OPEN_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
    const bootstrapAdmin = bootstrapAdmins.includes(profile.open_id);
    if (!user && !bootstrapAdmin) return NextResponse.redirect(new URL("/login?error=not_whitelisted", base));
    if (!user) {
      const created = await query<{ id: string; role: "admin" | "member" }>(
        `INSERT INTO users(feishu_open_id,display_name,avatar_url,role) VALUES ($1,$2,$3,'admin') RETURNING id,role`,
        [profile.open_id, profile.name || profile.en_name || "飞书用户", profile.avatar_url || null],
      );
      user = { ...created.rows[0], active: true };
    } else if (bootstrapAdmin && user.role !== "admin") {
      await query("UPDATE users SET role='admin',updated_at=now() WHERE id=$1", [user.id]);
      user.role = "admin";
    }
    if (!user.active) return NextResponse.redirect(new URL("/login?error=disabled", base));
    await query("UPDATE users SET display_name=$2,avatar_url=$3,updated_at=now() WHERE id=$1", [user.id, profile.name || profile.en_name || "飞书用户", profile.avatar_url || null]);
    await createSession(user.id);
    return NextResponse.redirect(new URL("/", base));
  } catch {
    return NextResponse.redirect(new URL("/login?error=oauth_failed", base));
  }
}
