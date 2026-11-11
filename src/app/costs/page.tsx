"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, CircleDollarSign, Clock3, HardDrive, Info, Network, ReceiptText, Server, WalletCards } from "lucide-react";

type CostModel = { provider: string; model_id: string; calls: string; images: string; estimated_cost: string | null; currency: string | null; estimated_cost_cny: string | null };
type InvoiceSummary = { provider: string; billing_cycle: string; currency: string; billed_amount: string; line_count: string; account_count: string; imported_at: string };
type EstimateCycle = { provider: string; billing_cycle: string; currency: string; estimated_amount: string };
type InvoiceLine = { provider: string; account_id: string; model_id: string; period_start: string; amount: string; currency: string; usage_amount: string | null; usage_unit: string | null };
type ModelUnitEstimate = { bill_date: string; model_id: string; usage_unit: string; usage_amount: string; billed_amount: string; unit_price: string; currency: string };
type ServerCostCategory = "basic" | "storage" | "traffic";
type ServerCostSummary = { category: ServerCostCategory; currency: string; amount: string; line_count: string };
type ServerCostByCycle = { billing_cycle: string; currency: string; basic_amount: string | null; storage_amount: string | null; traffic_amount: string | null; total_amount: string };
const serverCostCategories: { category: ServerCostCategory; label: string; description: string; Icon: typeof Server }[] = [
  { category: "basic", label: "基础成本", description: "除存储与流量外的阿里云费用", Icon: Server },
  { category: "storage", label: "存储成本", description: "云盘、快照及其他存储费用", Icon: HardDrive },
  { category: "traffic", label: "流量成本", description: "带宽、公网流量及网络费用", Icon: Network },
];
function formatCurrencyAmount(amount: string | null, currency: string) {
  const value = Number(amount || 0).toFixed(2);
  return currency === "CNY" ? `¥ ${value}` : `${value} ${currency}`;
}
export default function CostsPage() {
  const [data, setData] = useState<{ byModel: CostModel[]; invoices: InvoiceLine[]; invoiceSummary: InvoiceSummary[]; estimatesByCycle: EstimateCycle[]; modelUnitEstimates: ModelUnitEstimate[]; serverCostSummary: ServerCostSummary[]; serverCostsByCycle: ServerCostByCycle[]; billingStartDate: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/costs", { cache: "no-store" }).then(async (r) => { const d=await r.json(); if(!r.ok) throw new Error(d.error); setData(d); }).catch((e) => setError(e.message)); }, []);
  const totalCny = data?.byModel.reduce((sum, row) => sum + Number(row.estimated_cost_cny || 0), 0) || 0;
  const totalImages = data?.byModel.reduce((sum, row) => sum + Number(row.images || 0), 0) || 0;
  return <div className="subpage">
    <header className="page-topbar"><div className="breadcrumb"><span>工作空间</span><span className="crumb-slash">/</span><b>成本统计</b></div><span className="muted-small">模型估算与云账单</span></header>
    <div className="subpage-heading"><div><p className="eyebrow">MODEL COST OVERVIEW</p><h1>成本统计</h1><p className="muted">查看模型调用估算及阿里云、Google Cloud 账单汇总。</p></div><div className="period-select">所有时间 <span>⌄</span></div></div>
    <div className="cost-summary-grid"><div className="cost-summary-card hero"><span className="summary-icon"><CircleDollarSign size={19} /></span><small>累计人民币估算</small><b>¥ {totalCny.toFixed(2)}</b><span className="summary-caption">依赖管理员设置的价格与汇率</span></div><div className="cost-summary-card"><span className="summary-icon lilac"><WalletCards size={18} /></span><small>生成图片</small><b>{totalImages.toLocaleString("zh-CN")}</b><span className="summary-caption">覆盖所有成功任务</span></div><div className="cost-summary-card"><span className="summary-icon peach"><Clock3 size={18} /></span><small>成本口径</small><b className="small-value">估算 + 账单对账</b><span className="summary-caption">{data?.invoiceSummary?.length ? "已导入供应商账单汇总" : "等待管理员同步供应商账单"}</span></div></div>
    <div className="notice notice-info"><Info size={16} /><span>单次调用金额是按后台配置价格计算的估算值。阿里云账单仅统计 {data?.billingStartDate || "2026-11-07"} 起的费用；可追溯模型单价按当日账单金额÷图片用量计算，供应商账单仍不是单张图片的实收金额。</span></div>
    {error && <div className="notice notice-error">{error}</div>}
    <section className="table-card server-cost-card">
      <div className="table-heading"><div><h2>服务器成本分类</h2><p>按阿里云账单项目统计，自 {data?.billingStartDate || "2026-11-07"} 起</p></div><span className="table-range">云资源账单</span></div>
      <div className="server-cost-grid">{serverCostCategories.map(({ category, label, description, Icon }) => {
        const amounts = data?.serverCostSummary.filter((row) => row.category === category) || [];
        const lineCount = amounts.reduce((sum, row) => sum + Number(row.line_count), 0);
        return <article className={`server-cost-tile server-cost-${category}`} key={category}>
          <span className="server-cost-icon"><Icon size={17} /></span>
          <div className="server-cost-label"><b>{label}</b><small>{description}</small></div>
          <div className="server-cost-amounts">{amounts.length ? amounts.map((row) => <strong key={row.currency}>{formatCurrencyAmount(row.amount, row.currency)}</strong>) : <strong>¥ 0.00</strong>}</div>
          <small className="server-cost-lines">{lineCount} 条账单项目</small>
        </article>;
      })}</div>
      <p className="server-cost-note">仅统计阿里云云资源账单；百炼模型费用仍单独列在供应商账单中。系统按账单项目名称和编码识别存储与流量，其余费用归入基础成本。</p>
      <div className="table-scroll"><table><thead><tr><th>账单月份</th><th>币种</th><th>基础成本</th><th>存储成本</th><th>流量成本</th><th>合计</th></tr></thead><tbody>{data?.serverCostsByCycle.map((row) => <tr key={`${row.billing_cycle}-${row.currency}`}><td>{row.billing_cycle}</td><td>{row.currency}</td><td>{formatCurrencyAmount(row.basic_amount, row.currency)}</td><td>{formatCurrencyAmount(row.storage_amount, row.currency)}</td><td>{formatCurrencyAmount(row.traffic_amount, row.currency)}</td><td><b>{formatCurrencyAmount(row.total_amount, row.currency)}</b></td></tr>)}{!data?.serverCostsByCycle.length && <tr><td colSpan={6} className="empty-table">暂无阿里云云资源账单</td></tr>}</tbody></table></div>
    </section>
    <section className="table-card"><div className="table-heading"><div><h2>按模型汇总</h2><p>对比各模型调用次数与估算花费</p></div><span className="table-range">当前累计</span></div><div className="table-scroll"><table><thead><tr><th>模型</th><th>调用次数</th><th>生成图片</th><th>供应商原币估算</th><th>人民币估算</th></tr></thead><tbody>{data?.byModel.map((row) => {const logoClass=row.provider==="bailian"?"bailian-logo":row.provider==="gemini"?"gemini-logo":row.provider==="volcengine"?"volcengine-logo":"zhipu-logo";const logoText=row.provider==="bailian"?"通":row.provider==="gemini"?"✦":row.provider==="volcengine"?"豆":"智";return <tr key={`${row.provider}-${row.model_id}`}><td><span className={`table-provider ${logoClass}`}>{logoText}</span><b>{row.model_id}</b></td><td>{Number(row.calls).toLocaleString()}</td><td>{Number(row.images).toLocaleString()}</td><td>{row.estimated_cost ? `${Number(row.estimated_cost).toFixed(4)} ${row.currency}` : "价格未设置"}</td><td>{row.estimated_cost_cny ? `¥ ${Number(row.estimated_cost_cny).toFixed(2)}` : "汇率或价格未设置"}</td></tr>})}{!data?.byModel.length && <tr><td colSpan={5} className="empty-table">暂无成本记录</td></tr>}</tbody></table></div></section>
    <section className="table-card"><div className="table-heading"><div><h2>百炼模型单价追溯</h2><p>按账单日期、模型和图片用量计算估算单价；只有存在可追溯用量的日期才显示</p></div><span className="table-range">自 {data?.billingStartDate || "2026-11-07"}</span></div><div className="table-scroll"><table><thead><tr><th>账单日期</th><th>模型</th><th>计费用量</th><th>账单金额</th><th>估算单价 / 图片</th></tr></thead><tbody>{data?.modelUnitEstimates?.map((row) => <tr key={`${row.bill_date}-${row.model_id}-${row.usage_unit}`}><td>{row.bill_date}</td><td><b>{row.model_id}</b></td><td>{Number(row.usage_amount).toLocaleString("zh-CN")} {row.usage_unit}</td><td>{Number(row.billed_amount).toFixed(4)} {row.currency}</td><td>{Number(row.unit_price).toFixed(8)} {row.currency}</td></tr>)}{!data?.modelUnitEstimates?.length && <tr><td colSpan={5} className="empty-table">当前账期尚无可追溯的百炼图片用量账单</td></tr>}</tbody></table></div></section>
    <section className="table-card invoice-card"><div className="table-heading"><div><h2>供应商账单对账</h2><p>按供应商与账期对比调用估算和账单汇总，不分摊到单张图片</p></div><span className={data?.invoiceSummary?.length ? "coming-pill connected" : "coming-pill"}>{data?.invoiceSummary?.length ? "已导入汇总" : "待导入"}</span></div>
      {data?.invoiceSummary?.length ? <><div className="table-scroll"><table><thead><tr><th>供应商</th><th>账单周期</th><th>账号数 / 账单行</th><th>调用估算</th><th>供应商账单</th><th>差额</th></tr></thead><tbody>{data.invoiceSummary.map((row) => { const estimate = data.estimatesByCycle.find((item) => item.provider === row.provider && item.billing_cycle === row.billing_cycle && item.currency === row.currency); const billed = Number(row.billed_amount); const estimated = estimate ? Number(estimate.estimated_amount) : null; const sourceLabel = row.provider === "bailian" ? "阿里云百炼" : row.provider === "aliyun" ? "阿里云云资源" : "Google Cloud"; return <tr key={`${row.provider}-${row.billing_cycle}-${row.currency}`}><td>{sourceLabel}</td><td>{row.billing_cycle}</td><td>{row.account_count} / {row.line_count}</td><td>{estimated === null ? "无同周期估算" : `${estimated.toFixed(4)} ${row.currency}`}</td><td>{billed.toFixed(4)} {row.currency}</td><td>{estimated === null ? "—" : `${(billed-estimated).toFixed(4)} ${row.currency}`}</td></tr>; })}</tbody></table></div><details className="invoice-details"><summary>查看供应商账单项目（{data.invoices.length}）</summary><div className="table-scroll"><table><thead><tr><th>账期</th><th>供应商</th><th>账号</th><th>账单项目 / SKU</th><th>金额</th></tr></thead><tbody>{data.invoices.map((row, index) => <tr key={`${row.provider}-${row.account_id}-${row.model_id}-${index}`}><td>{new Date(row.period_start).toLocaleDateString("zh-CN", {year:"numeric",month:"2-digit",timeZone:"UTC"})}</td><td>{row.provider === "bailian" ? "阿里云百炼" : row.provider === "aliyun" ? "阿里云云资源" : "Google Cloud"}</td><td>{row.account_id}</td><td>{row.model_id}</td><td>{Number(row.amount).toFixed(4)} {row.currency}</td></tr>)}</tbody></table></div></details></> : <div className="invoice-empty"><ReceiptText size={21} /><span>还没有导入供应商账单</span><small>管理员配置只读连接器并同步账期后，可在此核对供应商汇总。对账差额仅供检查，单次生成仍展示估算费用。</small></div>}
    </section>
  </div>;
}
