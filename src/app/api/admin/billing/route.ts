import { NextResponse } from "next/server";
import { z } from "zod";
import { billingConnectorStatus, importProviderBill } from "@/server/billing";
import { requireAdmin } from "@/server/auth";
import { query } from "@/server/db";
import { jsonError, sameOrigin } from "@/server/http";

const syncSchema = z.object({
  provider: z.enum(["bailian", "gemini"]),
  billingCycle: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "账单周期必须采用 YYYY-MM 格式"),
});

export async function GET() {
  try {
    await requireAdmin();
    const [counts, lastImports] = await Promise.all([
      query("SELECT provider,count(*) AS records,max(imported_at) AS last_import FROM invoices GROUP BY provider"),
      query("SELECT provider,to_char(period_start,'YYYY-MM') AS billing_cycle,max(imported_at) AS imported_at FROM invoices GROUP BY provider,to_char(period_start,'YYYY-MM') ORDER BY imported_at DESC LIMIT 10"),
    ]);
    return NextResponse.json({ connectors: billingConnectorStatus(), imported: counts.rows, lastImports: lastImports.rows });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 });
    const admin = await requireAdmin();
    const parsed = syncSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "账单周期无效" }, { status: 400 });
    const connector = billingConnectorStatus().find((item) => item.provider === parsed.data.provider);
    if (connector?.status !== "ready") return NextResponse.json({ error: "此账单连接器缺少凭证或筛选配置" }, { status: 409 });
    try {
      const result = await importProviderBill(parsed.data.provider, parsed.data.billingCycle);
      await query(
        "INSERT INTO audit_logs(actor_id,action,target_type,target_id,details) VALUES ($1,'billing.imported','invoice',$2,$3)",
        [admin.id, `${result.provider}:${result.billingCycle}`, JSON.stringify({ imported: result.imported })],
      );
      return NextResponse.json(result);
    } catch {
      return NextResponse.json({ error: "账单同步失败；请检查连接器日志、账期和只读权限" }, { status: 502 });
    }
  } catch (error) { return jsonError(error); }
}
