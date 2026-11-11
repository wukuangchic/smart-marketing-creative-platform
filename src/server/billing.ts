import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { BigQuery } from "@google-cloud/bigquery";
import { query } from "@/server/db";

export type BillingProvider = "bailian" | "gemini";
export type BillingImportResult = { provider: BillingProvider; billingCycle: string; imported: number };

type InvoiceLine = {
  storedProvider?: "aliyun" | "bailian";
  accountId: string;
  modelId: string;
  amount: number;
  currency: string;
  sourceId: string;
  raw: Record<string, unknown>;
};

export function billingConnectorStatus() {
  const bailianReady = Boolean(
    process.env.BAILIAN_BILLING_ACCESS_KEY_ID &&
    process.env.BAILIAN_BILLING_ACCESS_KEY_SECRET &&
    (process.env.BAILIAN_BILLING_PRODUCT_CODE || process.env.BAILIAN_BILLING_INCLUDE_ALL_PRODUCTS === "1"),
  );
  const googleReady = Boolean(
    (process.env.GOOGLE_BILLING_SERVICE_ACCOUNT_JSON || (process.env.GOOGLE_BILLING_SERVICE_ACCOUNT_FILE && existsSync(process.env.GOOGLE_BILLING_SERVICE_ACCOUNT_FILE))) &&
    process.env.GOOGLE_BILLING_PROJECT_ID &&
    process.env.GOOGLE_BILLING_DATASET &&
    process.env.GOOGLE_BILLING_TABLE &&
    process.env.GOOGLE_BILLING_SERVICE_FILTER,
  );
  return [
    { provider: "bailian" as const, status: bailianReady ? "ready" : "credentials_missing" },
    { provider: "gemini" as const, status: googleReady ? "ready" : "credentials_missing" },
  ];
}

export async function importProviderBill(provider: BillingProvider, billingCycle: string): Promise<BillingImportResult> {
  assertBillingCycle(billingCycle);
  const lines = provider === "bailian" ? await fetchBailianBill(billingCycle) : await fetchGoogleBill(billingCycle);
  const { start, end } = cycleWindow(billingCycle);
  for (const line of lines) {
    await query(
      `INSERT INTO invoices(provider,account_id,model_id,period_start,period_end,amount,currency,source_id,raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(provider,account_id,source_id) DO UPDATE SET
         model_id=EXCLUDED.model_id,period_start=EXCLUDED.period_start,period_end=EXCLUDED.period_end,
         amount=EXCLUDED.amount,currency=EXCLUDED.currency,raw=EXCLUDED.raw,imported_at=now()`,
      [line.storedProvider || provider, line.accountId, line.modelId, start, end, line.amount, line.currency, line.sourceId, JSON.stringify(line.raw)],
    );
  }
  return { provider, billingCycle, imported: lines.length };
}

async function fetchBailianBill(billingCycle: string): Promise<InvoiceLine[]> {
  const accessKeyId = process.env.BAILIAN_BILLING_ACCESS_KEY_ID;
  const accessKeySecret = process.env.BAILIAN_BILLING_ACCESS_KEY_SECRET;
  const productCode = process.env.BAILIAN_BILLING_PRODUCT_CODE;
  const includeAllProducts = process.env.BAILIAN_BILLING_INCLUDE_ALL_PRODUCTS === "1";
  if (!accessKeyId || !accessKeySecret || (!productCode && !includeAllProducts)) throw new Error("阿里云账单连接器缺少只读凭证或账单范围配置");
  const require = createRequire(import.meta.url);
  const sdk = require("@alicloud/pop-core") as { RPCClient: new (options: Record<string, unknown>) => { request: (action: string, params: Record<string, unknown>, options: Record<string, unknown>) => Promise<unknown> } };
  const client = new sdk.RPCClient({
    accessKeyId,
    accessKeySecret,
    endpoint: process.env.BAILIAN_BILLING_ENDPOINT || "https://business.aliyuncs.com",
    apiVersion: "2017-12-14",
    opts: { timeout: 30_000 },
  });
  const all: Array<Record<string, unknown>> = [];
  let nextToken = "";
  for (let page = 0; page < 200; page += 1) {
    const response = await client.request("DescribeInstanceBill", {
      BillingCycle: billingCycle,
      IsBillingItem: true,
      IsHideZeroCharge: true,
      Granularity: "MONTHLY",
      MaxResults: 300,
      ...(!includeAllProducts ? {
        ProductCode: productCode,
        ...(process.env.BAILIAN_BILLING_PRODUCT_TYPE ? { ProductType: process.env.BAILIAN_BILLING_PRODUCT_TYPE } : {}),
        ...(process.env.BAILIAN_BILLING_PIP_CODE ? { PipCode: process.env.BAILIAN_BILLING_PIP_CODE } : {}),
      } : {}),
      ...(nextToken ? { NextToken: nextToken } : {}),
    }, { method: "POST", formatParams: false, timeout: 30_000 }) as Record<string, unknown>;
    const body = (response.Body || response) as Record<string, unknown>;
    if (body.Success === false || (body.Code && body.Code !== "Success")) {
      throw new Error(`阿里云账单查询失败（${String(body.Code || "unknown").slice(0, 80)}）`);
    }
    const data = body.Data as Record<string, unknown> | undefined;
    const items = data?.Items;
    const nestedItems = items && typeof items === "object" ? (items as Record<string, unknown>).Item : undefined;
    const pageItems = Array.isArray(items) ? items : Array.isArray(nestedItems) ? nestedItems : [];
    all.push(...pageItems.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")));
    nextToken = typeof data?.NextToken === "string" ? data.NextToken : "";
    if (!nextToken) break;
    if (page === 199) throw new Error("阿里云账单分页超过 200 页，请缩小账单查询范围");
  }
  return parseBailianBillItems(billingCycle, all, productCode);
}

export function parseBailianBillItems(billingCycle: string, all: Array<Record<string, unknown>>, defaultProductCode = "aliyun-billing-item") {
  const accountId = String(all[0]?.BillAccountID || all[0]?.OwnerID || "aliyun-account");
  return all.flatMap((item, index) => {
    const amount = Number(item.AfterDiscountAmount ?? item.PretaxAmount);
    const currency = typeof item.Currency === "string" ? item.Currency : "CNY";
    if (!Number.isFinite(amount)) return [];
    const productName = String(item.ProductName || item.ProductDetail || "");
    const isBailian = /百炼|model\s*studio/i.test(productName);
    const source = {
      index,
      instanceId: item.InstanceID || "",
      productCode: item.ProductCode || defaultProductCode,
      pipCode: item.PipCode || "",
      billingItemCode: item.BillingItemCode || "",
      billingItem: item.BillingItem || "",
      itemName: item.ItemName || "",
      amount,
      currency,
    };
    return [{
      storedProvider: isBailian ? "bailian" as const : "aliyun" as const,
      accountId: String(item.BillAccountID || item.OwnerID || accountId),
      modelId: isBailian
        ? String(item.BillingItem || item.ProductDetail || item.ProductName || item.ProductCode || defaultProductCode)
        : [item.ProductName, item.ProductDetail || item.BillingItem].filter(Boolean).join(" / ") || String(item.ProductCode || defaultProductCode),
      amount,
      currency,
      sourceId: stableId(billingCycle, source),
      raw: { ...item, periodType: "provider bill detail; not an individual image charge" },
    }];
  });
}

async function fetchGoogleBill(billingCycle: string): Promise<InvoiceLine[]> {
  const json = process.env.GOOGLE_BILLING_SERVICE_ACCOUNT_JSON || (process.env.GOOGLE_BILLING_SERVICE_ACCOUNT_FILE ? await readFile(process.env.GOOGLE_BILLING_SERVICE_ACCOUNT_FILE, "utf8") : undefined);
  const projectId = process.env.GOOGLE_BILLING_PROJECT_ID;
  const dataset = process.env.GOOGLE_BILLING_DATASET;
  const table = process.env.GOOGLE_BILLING_TABLE;
  const serviceFilter = process.env.GOOGLE_BILLING_SERVICE_FILTER;
  if (!json || !projectId || !dataset || !table || !serviceFilter) throw new Error("Google Cloud Billing 连接器缺少 BigQuery 只读配置");
  if (![projectId, dataset, table].every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error("Google Billing 项目、数据集或表名格式无效");
  const credentials = JSON.parse(json) as { client_email?: string; private_key?: string };
  if (!credentials.client_email || !credentials.private_key) throw new Error("Google Billing 服务账号 JSON 缺少必要字段");
  const bigquery = new BigQuery({ projectId, credentials });
  const [rows] = await bigquery.query({
    query: `SELECT billing_account_id, invoice.month AS invoice_month, service.id AS service_id,
                   service.description AS service_description, sku.id AS sku_id,
                   sku.description AS sku_description, project.id AS project_id, currency,
                   SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS net_cost
            FROM \`${projectId}.${dataset}.${table}\`
            WHERE invoice.month = @billingCycle AND service.description LIKE CONCAT('%', @serviceFilter, '%')
            GROUP BY billing_account_id, invoice_month, service_id, service_description, sku_id, sku_description, project_id, currency`,
    params: { billingCycle: billingCycle.replace("-", ""), serviceFilter },
    useLegacySql: false,
  });
  return rows.flatMap((row: Record<string, unknown>) => {
    const amount = Number(row.net_cost);
    if (!Number.isFinite(amount)) return [];
    const modelId = `${String(row.service_description || row.service_id || "Google Cloud")} / ${String(row.sku_description || row.sku_id || "SKU")}`;
    const source = {
      invoiceMonth: billingCycle,
      projectId: String(row.project_id || ""),
      serviceId: String(row.service_id || ""),
      skuId: String(row.sku_id || ""),
      currency: String(row.currency || "USD"),
    };
    return [{
      accountId: `${String(row.billing_account_id || "google-cloud")}/${String(row.project_id || "unknown-project")}`,
      modelId,
      amount,
      currency: String(row.currency || "USD"),
      sourceId: stableId(billingCycle, source),
      raw: { ...source, serviceDescription: row.service_description, skuDescription: row.sku_description, periodType: "invoice month aggregate; not an individual image charge" },
    }];
  });
}

function assertBillingCycle(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error("账单周期必须采用 YYYY-MM 格式");
  const [year, month] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, 1));
  const current = new Date();
  if (candidate > new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1))) throw new Error("不能同步未来账单周期");
}

function cycleWindow(cycle: string) {
  const [year, month] = cycle.split("-").map(Number);
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

function stableId(cycle: string, value: Record<string, unknown>) {
  return createHash("sha256").update(`${cycle}:${JSON.stringify(value)}`).digest("hex");
}
