"use client";

import { useEffect, useState } from "react";
import { CalendarDays, ChevronDown, Filter, Image as ImageIcon, LoaderCircle, MessageSquareText, Search, Sparkles, X } from "lucide-react";

type Tag = { id: string; name: string };
type ModelOption = { provider: string; provider_name: string; model_key: string; model_id: string; model_name: string };
type PromptModel = { provider: string; name: string };
type PromptGroup = {
  prompt: string;
  uses: number;
  latest_at: string;
  latest_identifier: string | null;
  promptPrefix: string | null;
  model_runs: number;
  generated_images: number;
  output_assets: number;
  estimated_cost_cny: string | null;
  unconverted_runs: number;
  models: PromptModel[];
  tags: Tag[];
};
type Filters = { search: string; identifier: string; dateFrom: string; dateTo: string; tagIds: string[]; tagMode: "any" | "all"; provider: string; modelKey: string };

const PAGE_SIZES = [20, 100, 500] as const;
const EMPTY_FILTERS: Filters = { search: "", identifier: "", dateFrom: "", dateTo: "", tagIds: [], tagMode: "any", provider: "", modelKey: "" };
const PROVIDER_NAMES: Record<string, string> = { bailian: "阿里云百炼", gemini: "Gemini", zhipu: "智谱", volcengine: "火山方舟" };

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function PromptLibraryPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [prompts, setPrompts] = useState<PromptGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/tags", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => setTags(data?.tags || [])).catch(() => undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ offset: String((page - 1) * pageSize), limit: String(pageSize) });
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.identifier.trim()) params.set("identifier", filters.identifier.trim());
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    for (const id of filters.tagIds) params.append("tagIds", id);
    if (filters.tagIds.length) params.set("tagMode", filters.tagMode);
    if (filters.provider) params.set("provider", filters.provider);
    if (filters.modelKey) params.set("modelKey", filters.modelKey);
    setLoading(true); setError(""); setPrompts([]);
    fetch(`/api/prompt-library?${params}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Prompt 库读取失败");
      setPrompts(data.prompts || []); setTotal(data.total || 0); setModelOptions(data.models || []);
    }).catch((reason) => { if (reason.name !== "AbortError") setError(reason.message || "Prompt 库读取失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, page, pageSize]);

  function applyFilters() {
    setPage(1);
    setFilters({ ...draft, tagIds: [...draft.tagIds], search: draft.search.trim(), identifier: draft.identifier.trim() });
  }

  function toggleTag(id: string) {
    setDraft((current) => ({ ...current, tagIds: current.tagIds.includes(id) ? current.tagIds.filter((value) => value !== id) : [...current.tagIds, id] }));
  }

  function usePrompt(entry: PromptGroup) {
    window.sessionStorage.setItem("creative-studio-prompt-use", JSON.stringify({ prompt: entry.prompt, promptPrefix: entry.promptPrefix }));
    window.location.assign("/");
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return <div className="subpage materials-page prompt-library-page">
    <header className="page-topbar"><div className="breadcrumb"><span>工作空间</span><span className="crumb-slash">/</span><b>Prompt 库</b></div><span className="materials-total">{total} 条独立 Prompt</span></header>
    <div className="subpage-heading"><div><p className="eyebrow">PROMPT LIBRARY</p><h1>Prompt 库</h1><p className="muted">按完整提示词汇总创作记录，并查看使用次数、模型、标签与估算成本。</p></div></div>
    <section className="material-filters prompt-library-filters card-surface">
      <label className="prompt-search-field"><span>搜索 Prompt</span><div className="material-search"><Search size={14} /><input value={draft.search} onChange={(event) => setDraft((value) => ({ ...value, search: event.target.value }))} placeholder="搜索提示词内容" onKeyDown={(event) => { if (event.key === "Enter") applyFilters(); }} /></div></label>
      <label><span>创作标识</span><input value={draft.identifier} onChange={(event) => setDraft((value) => ({ ...value, identifier: event.target.value }))} placeholder="输入 4 位前缀或 8 位标识" onKeyDown={(event) => { if (event.key === "Enter") applyFilters(); }} /></label>
      <label><span>开始日期</span><input type="date" value={draft.dateFrom} onChange={(event) => setDraft((value) => ({ ...value, dateFrom: event.target.value }))} /></label>
      <label><span>结束日期</span><input type="date" value={draft.dateTo} onChange={(event) => setDraft((value) => ({ ...value, dateTo: event.target.value }))} /></label>
      <div className="material-tag-filter"><span>分类标签</span><button type="button" className="material-filter-trigger" aria-expanded={tagMenuOpen} onClick={() => setTagMenuOpen((open) => !open)}>{draft.tagIds.length ? `已选 ${draft.tagIds.length} 个标签` : "全部标签"}<ChevronDown size={13} /></button>{tagMenuOpen && <div className="material-tag-menu"><label className="material-tag-search"><Search size={12} /><input value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} placeholder="搜索标签" /></label><div className="material-tag-list">{tags.filter((tag) => tag.name.toLocaleLowerCase().includes(tagSearch.trim().toLocaleLowerCase())).map((tag) => <label key={tag.id}><input type="checkbox" checked={draft.tagIds.includes(tag.id)} onChange={() => toggleTag(tag.id)} /><span>{tag.name}</span></label>)}{!tags.length && <small>暂无分类标签</small>}</div><label className="material-tag-match"><span>匹配方式</span><select value={draft.tagMode} onChange={(event) => setDraft((value) => ({ ...value, tagMode: event.target.value as Filters["tagMode"] }))}><option value="any">满足任一标签</option><option value="all">满足所有标签</option></select></label></div>}</div>
      <label><span>模型供应商</span><select value={draft.provider} onChange={(event) => setDraft((value) => ({ ...value, provider: event.target.value, modelKey: value.modelKey && modelOptions.some((model) => model.model_key === value.modelKey && model.provider === event.target.value) ? value.modelKey : "" }))}><option value="">全部供应商</option>{Array.from(new Map(modelOptions.map((model) => [model.provider, model.provider_name])).entries()).map(([provider, name]) => <option key={provider} value={provider}>{name}</option>)}</select></label>
      <label><span>生成模型</span><select value={draft.modelKey} onChange={(event) => setDraft((value) => ({ ...value, modelKey: event.target.value }))}><option value="">全部模型</option>{modelOptions.filter((model) => !draft.provider || model.provider === draft.provider).map((model) => <option key={model.model_key} value={model.model_key}>{model.model_name}</option>)}</select></label>
      <button className="button button-primary" onClick={applyFilters}><Filter size={14} /> 筛选</button>
      <button className="button button-quiet" onClick={() => { setDraft(EMPTY_FILTERS); setTagSearch(""); setTagMenuOpen(false); setPage(1); setFilters(EMPTY_FILTERS); }}><X size={14} /> 重置</button>
    </section>
    {error && <div className="notice notice-error">{error}</div>}
    {loading && !prompts.length ? <div className="materials-loading"><LoaderCircle size={20} className="spin" /> 正在汇总 Prompt</div> : prompts.length ? <div className="prompt-library-list">{prompts.map((entry) => <article className="prompt-library-card card-surface" key={entry.prompt}>
      <div className="prompt-library-main"><div className="prompt-library-label"><MessageSquareText size={14} /><span>提示词</span><code>{entry.promptPrefix || "旧记录"}</code></div><p className="prompt-library-text">{entry.prompt}</p>
        <div className="prompt-library-chips">{entry.models.map((model) => <span className="prompt-library-chip model" key={`${model.provider}-${model.name}`}>{PROVIDER_NAMES[model.provider] || model.provider} · {model.name}</span>)}{entry.tags.map((tag) => <span className="prompt-library-chip tag" key={tag.id}>{tag.name}</span>)}{!entry.tags.length && <span className="prompt-library-chip muted-chip">未分类</span>}</div>
      </div>
      <div className="prompt-library-side"><div className="prompt-library-metrics"><div><b>{entry.uses}</b><span>使用次数</span></div><div><b>{entry.output_assets || entry.generated_images}</b><span>生成图片</span></div><div className="prompt-cost"><b>{entry.estimated_cost_cny !== null ? `¥${Number(entry.estimated_cost_cny).toFixed(2)}` : "—"}</b><span>估算成本 CNY</span></div></div>
        <div className="prompt-library-latest"><CalendarDays size={12} /><span>最近使用 {formatDate(entry.latest_at)}</span></div>{entry.unconverted_runs > 0 && <small className="prompt-library-unconverted">部分调用成本未换算为人民币</small>}
        <button type="button" className="button button-primary prompt-library-use" onClick={() => usePrompt(entry)}><Sparkles size={14} /> 直接使用</button>
      </div>
    </article>)}</div> : !loading && <div className="empty-state materials-empty"><ImageIcon size={22} /><b>{filters.search || filters.identifier || filters.dateFrom || filters.dateTo || filters.tagIds.length || filters.provider || filters.modelKey ? "没有符合条件的 Prompt" : "Prompt 库还是空的"}</b><span>完成创作后，相同的完整提示词会自动汇总在这里。</span></div>}
    {total > 0 && <div className="materials-pagination"><label>每页显示<select className="period-select" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label><span>第 {page} / {pageCount} 页 · 共 {total} 条 Prompt</span><div><button type="button" className="button button-quiet" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>上一页</button><button type="button" className="button button-quiet" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount || loading}>下一页</button></div></div>}
  </div>;
}
