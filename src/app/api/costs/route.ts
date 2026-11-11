import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { aliyunBillingStartDate } from "@/server/billing";
import { query } from "@/server/db";
import { jsonError } from "@/server/http";

export async function GET() {
  try {
    await requireUser();
    const billingStart = `${aliyunBillingStartDate()}T00:00:00.000Z`;
    const scopedInvoices = "(provider NOT IN ('aliyun','bailian') OR period_start >= $1::timestamptz)";
    const aliyunCategory = `CASE
      WHEN concat_ws(' ', raw->>'ProductCode', raw->>'ProductName', raw->>'ProductDetail', raw->>'BillingItem', raw->>'BillingItemCode', raw->>'ItemName', raw->>'PipCode') ~* '(存储|云盘|系统盘|数据盘|快照|storage|snapshot|datadisk|systemdisk|blockstorage|objectstorage|(^|[^a-z])disk([^a-z]|$)|(^|[^a-z])volume([^a-z]|$)|(^|[^a-z])nas([^a-z]|$)|(^|[^a-z])oss([^a-z]|$))' THEN 'storage'
      WHEN concat_ws(' ', raw->>'ProductCode', raw->>'ProductName', raw->>'ProductDetail', raw->>'BillingItem', raw->>'BillingItemCode', raw->>'ItemName', raw->>'PipCode') ~* '(流量|带宽|公网|网络|下行|出流量|流量包|弹性公网IP|traffic|bandwidth|network|internet|egress|elastic.?ip|(^|[^a-z])eip([^a-z]|$)|(^|[^a-z])cdn([^a-z]|$))' THEN 'traffic'
      ELSE 'basic'
    END`;
    const [byModel, invoices, invoiceSummary, estimatesByCycle, modelUnitEstimates, serverCostSummary, serverCostsByCycle] = await Promise.all([
      query(`SELECT r.provider,r.model_id,count(*) AS calls,sum(r.image_count) AS images,sum(r.estimated_cost) AS estimated_cost,r.currency,sum(r.estimated_cost_cny) AS estimated_cost_cny
             FROM provider_runs r WHERE r.status='succeeded' GROUP BY r.provider,r.model_id,r.currency ORDER BY r.provider,r.model_id`),
      query(`SELECT provider,account_id,model_id,period_start,period_end,amount,currency,usage_amount,raw->>'UsageUnit' AS usage_unit,imported_at FROM invoices WHERE ${scopedInvoices} ORDER BY period_start DESC,provider,account_id,model_id LIMIT 500`, [billingStart]),
      query(`SELECT provider,to_char(date_trunc('month',period_start),'YYYY-MM') AS billing_cycle,currency,
                    sum(amount) AS billed_amount,count(*) AS line_count,count(DISTINCT account_id) AS account_count,
                    max(imported_at) AS imported_at
             FROM invoices WHERE ${scopedInvoices} GROUP BY provider,date_trunc('month',period_start),currency
             ORDER BY date_trunc('month',period_start) DESC,provider,currency`, [billingStart]),
      query(`SELECT provider,to_char(date_trunc('month',COALESCE(r.finished_at,r.created_at)),'YYYY-MM') AS billing_cycle,
                    currency,sum(estimated_cost) AS estimated_amount
             FROM provider_runs r WHERE status='succeeded' AND estimated_cost IS NOT NULL
             GROUP BY provider,date_trunc('month',COALESCE(r.finished_at,r.created_at)),currency`),
      query(`SELECT to_char(period_start AT TIME ZONE 'UTC','YYYY-MM-DD') AS bill_date,model_id,
                    raw->>'UsageUnit' AS usage_unit,sum(usage_amount) AS usage_amount,
                    sum(amount) AS billed_amount,
                    round(sum(amount)/NULLIF(sum(usage_amount),0),8) AS unit_price,currency
             FROM invoices
             WHERE provider='bailian' AND period_start >= $1::timestamptz AND usage_amount>0 AND amount>0
               AND raw->>'UsageUnit' IN ('张','image','images')
             GROUP BY bill_date,model_id,usage_unit,currency
             ORDER BY bill_date DESC,model_id`, [billingStart]),
      query(`WITH classified AS (
               SELECT ${aliyunCategory} AS category,currency,amount
               FROM invoices WHERE provider='aliyun' AND period_start >= $1::timestamptz
             )
             SELECT category,currency,sum(amount) AS amount,count(*) AS line_count
             FROM classified GROUP BY category,currency ORDER BY category,currency`, [billingStart]),
      query(`WITH classified AS (
               SELECT ${aliyunCategory} AS category,period_start,currency,amount
               FROM invoices WHERE provider='aliyun' AND period_start >= $1::timestamptz
             )
             SELECT to_char(date_trunc('month',period_start),'YYYY-MM') AS billing_cycle,currency,
                    sum(amount) FILTER (WHERE category='basic') AS basic_amount,
                    sum(amount) FILTER (WHERE category='storage') AS storage_amount,
                    sum(amount) FILTER (WHERE category='traffic') AS traffic_amount,
                    sum(amount) AS total_amount
             FROM classified
             GROUP BY date_trunc('month',period_start),currency
             ORDER BY date_trunc('month',period_start) DESC,currency`, [billingStart]),
    ]);
    return NextResponse.json({ byModel: byModel.rows, invoices: invoices.rows, invoiceSummary: invoiceSummary.rows, estimatesByCycle: estimatesByCycle.rows, modelUnitEstimates: modelUnitEstimates.rows, serverCostSummary: serverCostSummary.rows, serverCostsByCycle: serverCostsByCycle.rows, billingStartDate: aliyunBillingStartDate() });
  } catch (error) { return jsonError(error); }
}
