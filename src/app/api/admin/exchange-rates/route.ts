import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { query } from "@/server/db";
import { jsonError, sameOrigin } from "@/server/http";

const schema = z.object({ currency: z.enum(["USD", "SGD", "EUR"]), effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), rateToCny: z.coerce.number().positive().max(1000) });
export async function GET() {
  try { await requireAdmin(); return NextResponse.json({ rates: (await query("SELECT currency,effective_date,rate_to_cny FROM exchange_rates ORDER BY effective_date DESC LIMIT 30")).rows }); }
  catch (error) { return jsonError(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 });
    const admin = await requireAdmin();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "汇率格式无效" }, { status: 400 });
    const { currency, effectiveDate, rateToCny } = parsed.data;
    await query("INSERT INTO exchange_rates(currency,effective_date,rate_to_cny,updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT(currency,effective_date) DO UPDATE SET rate_to_cny=EXCLUDED.rate_to_cny,updated_by=EXCLUDED.updated_by", [currency,effectiveDate,rateToCny,admin.id]);
    await query("INSERT INTO audit_logs(actor_id,action,target_type,details) VALUES ($1,'fx.updated','exchange_rate',$2)", [admin.id, JSON.stringify({ currency,effectiveDate,rateToCny })]);
    return NextResponse.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
