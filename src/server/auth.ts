import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { query } from "@/server/db";
import { hashToken } from "@/server/crypto";

export interface UserSession {
  id: string;
  openId: string;
  name: string;
  role: "member" | "admin";
  avatarUrl: string | null;
}

const COOKIE = "creative_session";
const SIXTY_DAYS = 60 * 24 * 60 * 60 * 1000;
export const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";

export async function currentUser(): Promise<UserSession | null> {
  if (process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "1") {
    return { id: DEV_USER_ID, openId: "dev-open-id", name: "本地体验用户", role: "admin", avatarUrl: null };
  }
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const result = await query<UserSession & { expires_at: Date }>(
    `SELECT u.id, u.feishu_open_id AS "openId", u.display_name AS name, u.role, u.avatar_url AS "avatarUrl", s.expires_at
     FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND u.active=true AND s.expires_at>now()`,
    [hashToken(token)],
  );
  return result.rows[0] ?? null;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new AuthError(401, "请先通过飞书登录");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") throw new AuthError(403, "仅管理员可执行此操作");
  return user;
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '60 days')", [hashToken(token), userId]);
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SIXTY_DAYS });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await query("DELETE FROM sessions WHERE token_hash=$1", [hashToken(token)]);
  jar.delete(COOKIE);
}

export class AuthError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
