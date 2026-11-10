"use client";

import { useEffect, useState } from "react";
import { Check, Download, Filter, Image as ImageIcon, LoaderCircle, Search, X } from "lucide-react";

type Tag = { id: string; name: string };
type Material = { id: string; original_name: string; media_type: string; width: number | null; height: number | null; size_bytes: string; created_at: string; identifier: string | null; name_template: string | null; tag_id: string | null; tag_name: string | null; model_id: string | null };
type Filters = { identifier: string; dateFrom: string; dateTo: string; tagId: string };
const PAGE_SIZE = 60;

export default function MaterialsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [assets, setAssets] = useState<Material[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<Filters>({ identifier: "", dateFrom: "", dateTo: "", tagId: "" });
  const [draft, setDraft] = useState<Filters>({ identifier: "", dateFrom: "", dateTo: "", tagId: "" });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/tags", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => setTags(data?.tags || [])).catch(() => undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ offset: String(offset) });
    if (filters.identifier.trim()) params.set("identifier", filters.identifier.trim());
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    if (filters.tagId) params.set("tagId", filters.tagId);
    setLoading(true); setError("");
    fetch(`/api/materials?${params}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "素材读取失败");
      setAssets((current) => offset === 0 ? data.assets : [...current, ...data.assets]);
      setTotal(data.total || 0);
    }).catch((reason) => { if (reason.name !== "AbortError") setError(reason.message || "素材读取失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, offset]);

  function applyFilters() {
    setOffset(0);
    setFilters({ ...draft, identifier: draft.identifier.trim() });
  }

  function toggleAsset(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function toggleCurrentPage() {
    const pageIds = assets.slice(Math.max(0, assets.length - PAGE_SIZE)).map((asset) => asset.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
    setSelected((current) => { const next = new Set(current); for (const id of pageIds) allSelected ? next.delete(id) : next.add(id); return next; });
  }

  async function downloadSelected() {
    if (!selected.size || selected.size > 100) return;
    setDownloading(true); setError("");
    try {
      const response = await fetch("/api/materials/download", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [...selected] }) });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "打包下载失败"); }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `creative-materials-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "打包下载失败"); }
    finally { setDownloading(false); }
  }

  const currentPage = assets.slice(Math.max(0, assets.length - PAGE_SIZE));
  const pageSelected = currentPage.length > 0 && currentPage.every((asset) => selected.has(asset.id));
  return <div className="subpage materials-page">
    <header className="page-topbar"><div className="breadcrumb"><span>工作空间</span><span className="crumb-slash">/</span><b>素材库</b></div><span className="materials-total">{total} 张生成素材</span></header>
    <div className="subpage-heading"><div><p className="eyebrow">CREATIVE ASSETS</p><h1>素材库</h1><p className="muted">集中浏览已生成的图片，按标识、日期和分类标签筛选。</p></div></div>
    <section className="material-filters card-surface">
      <label><span>创作标识</span><div className="material-search"><Search size={14} /><input value={draft.identifier} onChange={(event) => setDraft((value) => ({ ...value, identifier: event.target.value }))} placeholder="输入 6 位标识" onKeyDown={(event) => { if (event.key === "Enter") applyFilters(); }} /></div></label>
      <label><span>开始日期</span><input type="date" value={draft.dateFrom} onChange={(event) => setDraft((value) => ({ ...value, dateFrom: event.target.value }))} /></label>
      <label><span>结束日期</span><input type="date" value={draft.dateTo} onChange={(event) => setDraft((value) => ({ ...value, dateTo: event.target.value }))} /></label>
      <label><span>分类标签</span><select value={draft.tagId} onChange={(event) => setDraft((value) => ({ ...value, tagId: event.target.value }))}><option value="">全部标签</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
      <button className="button button-primary" onClick={applyFilters}><Filter size={14} /> 筛选</button>
      <button className="button button-quiet" onClick={() => { const clean = { identifier: "", dateFrom: "", dateTo: "", tagId: "" }; setDraft(clean); setOffset(0); setFilters(clean); }}><X size={14} /> 重置</button>
    </section>
    {error && <div className="notice notice-error">{error}</div>}
    <div className="materials-toolbar"><div><button className="button button-quiet" onClick={toggleCurrentPage} disabled={!assets.length}>{pageSelected ? "取消本页选择" : "选择本页"}</button><span className="selected-count">已选 {selected.size} 张{selected.size > 100 ? " · 每次最多下载 100 张" : ""}</span></div><button className="button button-primary" onClick={() => void downloadSelected()} disabled={!selected.size || selected.size > 100 || downloading}>{downloading ? <><LoaderCircle size={14} className="spin" /> 正在打包</> : <><Download size={14} /> 下载所选素材</>}</button></div>
    {loading && !assets.length ? <div className="materials-loading"><LoaderCircle size={20} className="spin" /> 正在加载素材</div> : assets.length ? <div className="materials-grid">{assets.map((asset) => <article className={selected.has(asset.id) ? "material-card selected" : "material-card"} key={asset.id}>
      <label className="material-select" title={selected.has(asset.id) ? "取消选择" : "选择素材"}><input type="checkbox" checked={selected.has(asset.id)} onChange={() => toggleAsset(asset.id)} /><span>{selected.has(asset.id) && <Check size={12} />}</span></label>
      <a className="material-image" href={`/api/assets/${asset.id}`} target="_blank" rel="noreferrer"><img src={`/api/assets/${asset.id}`} alt={asset.original_name} loading="lazy" /></a>
      <div className="material-meta"><b title={asset.original_name}>{asset.original_name}</b><span>{asset.tag_name || "未分类"} · {asset.identifier || "旧素材"}</span><small>{new Date(asset.created_at).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}</small></div>
    </article>)}</div> : !loading && <div className="empty-state materials-empty"><ImageIcon size={22} /><b>{filters.identifier || filters.dateFrom || filters.dateTo || filters.tagId ? "没有符合条件的素材" : "素材库还是空的"}</b><span>完成图片创作后，生成结果会自动收录在这里。</span></div>}
    {assets.length < total && <div className="materials-more"><button className="button button-quiet" onClick={() => setOffset((value) => value + PAGE_SIZE)} disabled={loading}>{loading ? "加载中…" : "加载更多"}</button></div>}
  </div>;
}
