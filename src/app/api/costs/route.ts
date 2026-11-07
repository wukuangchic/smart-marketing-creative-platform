import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { jsonError } from "@/server/http";

export async function GET() {
  try {
    await requireUser();
    const [byModel, invoices, invoiceSummary, estimatesByCycle] = await Promise.all([
      query(`SELECT r.provider,r.model_id,count(*) AS calls,sum(r.image_count) AS images,sum(r.estimated_cost) AS estimated_cost,r.currency,sum(r.estimated_cost_cny) AS estimated_cost_cny
             FROM provider_runs r WHERE r.status='succeeded' GROUP BY r.provider,r.model_id,r.currency ORDER BY r.provider,r.model_id`),
      query(`SELECT provider,account_id,model_id,period_start,period_end,amount,currency,imported_at FROM invoices ORDER BY period_end DESC,provider,account_id,model_id LIMIT 500`),
      query(`SELECT provider,to_char(date_trunc('month',period_start),'YYYY-MM') AS billing_cycle,currency,
                    sum(amount) AS billed_amount,count(*) AS line_count,count(DISTINCT account_id) AS account_count,
                    max(imported_at) AS imported_at
             FROM invoices GROUP BY provider,date_trunc('month',period_start),currency
             ORDER BY date_trunc('month',period_start) DESC,provider,currency`),
      query(`SELECT provider,to_char(date_trunc('month',COALESCE(r.finished_at,r.created_at)),'YYYY-MM') AS billing_cycle,
                    currency,sum(estimated_cost) AS estimated_amount
             FROM provider_runs r WHERE status='succeeded' AND estimated_cost IS NOT NULL
             GROUP BY provider,date_trunc('month',COALESCE(r.finished_at,r.created_at)),currency`),
    ]);
    return NextResponse.json({ byModel: byModel.rows, invoices: invoices.rows, invoiceSummary: invoiceSummary.rows, estimatesByCycle: estimatesByCycle.rows });
  } catch (error) { return jsonError(error); }
}
