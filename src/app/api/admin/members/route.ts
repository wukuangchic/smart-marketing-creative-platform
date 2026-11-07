import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { query } from "@/server/db";
import { jsonError, sameOrigin } from "@/server/http";

const memberSchema = z.object({ openId: z.string().trim().min(4).max(200), name: z.string().trim().max(120).default("飞书员工"), role: z.enum(["member", "admin"]).default("member") });

export async function GET() {
  try {
    await requireAdmin();
    const users = await query("SELECT id,feishu_open_id AS open_id,display_name,role,active,created_at FROM users ORDER BY role DESC,display_name");
    return NextResponse.json({ users: users.rows });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 });
    const admin = await requireAdmin();
    const parsed = memberSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "成员信息无效" }, { status: 400 });
    const existing = await query<{ id: string; role: string; active: boolean }>("SELECT id,role,active FROM users WHERE feishu_open_id=$1", [parsed.data.openId]);
    if (parsed.data.role !== "admin" && existing.rows[0]?.role === "admin" && existing.rows[0].active) {
      const admins = await query<{ count: string }>("SELECT count(*) FROM users WHERE role='admin' AND active=true");
      if (Number(admins.rows[0]?.count) <= 1) return NextResponse.json({ error: "不能移除最后一名有效管理员" }, { status: 409 });
    }
    const result = await query(
      `INSERT INTO users(feishu_open_id,display_name,role,active) VALUES ($1,$2,$3,true)
       ON CONFLICT(feishu_open_id) DO UPDATE SET display_name=EXCLUDED.display_name,role=EXCLUDED.role,active=true,updated_at=now()
       RETURNING id`, [parsed.data.openId, parsed.data.name || "飞书员工", parsed.data.role],
    );
    await query("INSERT INTO audit_logs(actor_id,action,target_type,target_id,details) VALUES ($1,'member.upserted','user',$2,$3)", [admin.id, "" + result.rows[0].id, JSON.stringify({ role: parsed.data.role })]);
    return NextResponse.json({ ok: true });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 });
    const admin = await requireAdmin();
    const id = new URL(request.url).searchParams.get("id");
    if (!id || id === admin.id) return NextResponse.json({ error: "不能移除自己或缺少成员 ID" }, { status: 400 });
    const target = await query<{ role: string; active: boolean }>("SELECT role,active FROM users WHERE id=$1", [id]);
    if (target.rows[0]?.role === "admin" && target.rows[0].active) {
      const admins = await query<{ count: string }>("SELECT count(*) FROM users WHERE role='admin' AND active=true");
      if (Number(admins.rows[0]?.count) <= 1) return NextResponse.json({ error: "不能停用最后一名有效管理员" }, { status: 409 });
    }
    await query("UPDATE users SET active=false,updated_at=now() WHERE id=$1", [id]);
    await query("DELETE FROM sessions WHERE user_id=$1", [id]);
    await query("INSERT INTO audit_logs(actor_id,action,target_type,target_id) VALUES ($1,'member.disabled','user',$2)", [admin.id, id]);
    return NextResponse.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
