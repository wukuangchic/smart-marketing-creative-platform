"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Download, Filter, Image as ImageIcon, ImagePlus, LoaderCircle, Search, X } from "lucide-react";

type Tag = { id: string; name: string };
type ModelOption = { provider: string; provider_name: string; model_key: string; model_id: string; model_name: string };
type Material = { id: string; original_name: string; media_type: string; width: number | null; height: number | null; size_bytes: string; created_at: string; identifier: string | null; prompt_prefix: string | null; prompt: string; settings: Record<string, string | number>; name_template: string | null; tag_id: string | null; tag_name: string | null; tags?: Tag[]; provider: string | null; model_key: string | null; model_id: string | null; model_name: string | null };
type Filters = { identifier: string; dateFrom: string; dateTo: string; tagIds: string[]; tagMode: "any" | "all"; provider: string; modelKey: string };
const PAGE_SIZES = [20, 100, 500] as const;
const EMPTY_FILTERS: Filters = { identifier: "", dateFrom: "", dateTo: "", tagIds: [], tagMode: "any", provider: "", modelKey: "" };

export default function MaterialsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [assets, setAssets] = useState<Material[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  const [editTagIds, setEditTagIds] = useState<string[]>([]);
  const [clearTags, setClearTags] = useState(false);
  const [savingTags, setSavingTags] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/tags", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => setTags(data?.tags || [])).catch(() => undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ offset: String((page - 1) * pageSize), limit: String(pageSize) });
    if (filters.identifier.trim()) params.set("identifier", filters.identifier.trim());
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    for (const id of filters.tagIds) params.append("tagIds", id);
    if (filters.tagIds.length) params.set("tagMode", filters.tagMode);
    if (filters.provider) params.set("provider", filters.provider);
    if (filters.modelKey) params.set("modelKey", filters.modelKey);
    setLoading(true); setError(""); setAssets([]);
    fetch(`/api/materials?${params}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "素材读取失败");
      setAssets(data.assets || []);
      setTotal(data.total || 0);
      setModelOptions(data.models || []);
    }).catch((reason) => { if (reason.name !== "AbortError") setError(reason.message || "素材读取失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, page, pageSize, reloadKey]);

  function applyFilters() {
    setPage(1);
    setFilters({ ...draft, tagIds: [...draft.tagIds], identifier: draft.identifier.trim() });
  }

  function toggleTag(id: string) {
    setDraft((current) => ({ ...current, tagIds: current.tagIds.includes(id) ? current.tagIds.filter((value) => value !== id) : [...current.tagIds, id] }));
  }

  function toggleAsset(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function toggleCurrentPage() {
    const pageIds = assets.map((asset) => asset.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
    setSelected((current) => { const next = new Set(current); for (const id of pageIds) allSelected ? next.delete(id) : next.add(id); return next; });
  }

  function toggleEditTag(id: string) {
    setClearTags(false);
    setEditTagIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function useMaterialForImageEdit(asset: Material) {
    const rawPrefix = (asset.prompt_prefix || "").slice(0, 4).toUpperCase();
    const promptPrefix = /^[0-9A-HJKMNP-TV-Z]{4}$/.test(rawPrefix) ? rawPrefix : null;
    let nameTemplate = asset.name_template || "{标识}";
    nameTemplate = nameTemplate.replaceAll("{序号}", "");
    if (!nameTemplate.includes("{标识}")) nameTemplate = "{标识}";
    if (!nameTemplate.includes("{原名}")) nameTemplate += "-{原名}";
    const copy = {
      mode: "image-to-image",
      prompt: asset.prompt || "",
      nameTemplate,
      promptPrefix,
      tagIds: asset.tags?.map((tag) => tag.id) || (asset.tag_id ? [asset.tag_id] : []),
      models: [],
      settings: asset.settings || { aspectRatio: "1:1", targetWidth: 1024, targetHeight: 1024 },
      referenceAssets: [{ id: asset.id, originalName: asset.original_name }],
    };
    try { window.sessionStorage.setItem("creative-studio-copy", JSON.stringify(copy)); window.location.assign("/"); }
    catch { setError("无法临时保存这张素材，请重试"); }
  }

  async function saveSelectedTags() {
    if (!selected.size || (!editTagIds.length && !clearTags)) return;
    setSavingTags(true); setError("");
    try {
      const response = await fetch("/api/materials/tags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetIds: [...selected], tagIds: clearTags ? [] : editTagIds }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "分类标签修改失败");
      setSelected(new Set()); setTagsDialogOpen(false); setEditTagIds([]); setClearTags(false); setReloadKey((value) => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "分类标签修改失败"); }
    finally { setSavingTags(false); }
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

  const pageSelected = assets.length > 0 && assets.every((asset) => selected.has(asset.id));
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return <div className="subpage materials-page">
    <header className="page-topbar"><div className="breadcrumb"><span>工作空间</span><span className="crumb-slash">/</span><b>素材库</b></div><span className="materials-total">{total} 张生成素材</span></header>
    <div className="subpage-heading"><div><p className="eyebrow">CREATIVE ASSETS</p><h1>素材库</h1><p className="muted">按标识、日期、标签、模型供应商和模型查找已生成素材。</p></div></div>
    <section className="material-filters card-surface">
      <label><span>创作标识</span><div className="material-search"><Search size={14} /><input value={draft.identifier} onChange={(event) => setDraft((value) => ({ ...value, identifier: event.target.value }))} placeholder="输入 4 位前缀或 8 位素材标识" onKeyDown={(event) => { if (event.key === "Enter") applyFilters(); }} /></div></label>
      <label><span>开始日期</span><input type="date" value={draft.dateFrom} onChange={(event) => setDraft((value) => ({ ...value, dateFrom: event.target.value }))} /></label>
      <label><span>结束日期</span><input type="date" value={draft.dateTo} onChange={(event) => setDraft((value) => ({ ...value, dateTo: event.target.value }))} /></label>
      <div className="material-tag-filter"><span>分类标签</span><button type="button" className="material-filter-trigger" aria-expanded={tagMenuOpen} onClick={() => setTagMenuOpen((open) => !open)}>{draft.tagIds.length ? `已选 ${draft.tagIds.length} 个标签` : "全部标签"}<ChevronDown size={13} /></button>{tagMenuOpen && <div className="material-tag-menu"><label className="material-tag-search"><Search size={12} /><input value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} placeholder="搜索标签" /></label><div className="material-tag-list">{tags.filter((tag) => tag.name.toLocaleLowerCase().includes(tagSearch.trim().toLocaleLowerCase())).map((tag) => <label key={tag.id}><input type="checkbox" checked={draft.tagIds.includes(tag.id)} onChange={() => toggleTag(tag.id)} /><span>{tag.name}</span></label>)}{!tags.length && <small>暂无分类标签</small>}</div><label className="material-tag-match"><span>匹配方式</span><select value={draft.tagMode} onChange={(event) => setDraft((value) => ({ ...value, tagMode: event.target.value as Filters["tagMode"] }))}><option value="any">满足任一标签</option><option value="all">满足所有标签</option></select></label></div>}</div>
      <label><span>模型供应商</span><select value={draft.provider} onChange={(event) => setDraft((value) => ({ ...value, provider: event.target.value, modelKey: value.modelKey && modelOptions.some((model) => model.model_key === value.modelKey && model.provider === event.target.value) ? value.modelKey : "" }))}><option value="">全部供应商</option>{Array.from(new Map(modelOptions.map((model) => [model.provider, model.provider_name])).entries()).map(([provider, name]) => <option key={provider} value={provider}>{name}</option>)}</select></label>
      <label><span>生成模型</span><select value={draft.modelKey} onChange={(event) => setDraft((value) => ({ ...value, modelKey: event.target.value }))}><option value="">全部模型</option>{modelOptions.filter((model) => !draft.provider || model.provider === draft.provider).map((model) => <option key={model.model_key} value={model.model_key}>{model.model_name}</option>)}</select></label>
      <button className="button button-primary" onClick={applyFilters}><Filter size={14} /> 筛选</button>
      <button className="button button-quiet" onClick={() => { setDraft(EMPTY_FILTERS); setTagSearch(""); setTagMenuOpen(false); setPage(1); setFilters(EMPTY_FILTERS); }}><X size={14} /> 重置</button>
    </section>
    {error && <div className="notice notice-error">{error}</div>}
    <div className="materials-toolbar"><div><button className="button button-quiet" onClick={toggleCurrentPage} disabled={!assets.length}>{pageSelected ? "取消本页选择" : "选择本页"}</button><span className="selected-count">已选 {selected.size} 张{selected.size > 100 ? " · 下载每批最多 100 张" : ""}{selected.size > 500 ? " · 标签修改最多 500 张" : ""}</span></div><div className="materials-toolbar-actions"><button className="button button-quiet" onClick={() => { setEditTagIds([]); setClearTags(false); setTagsDialogOpen(true); }} disabled={!selected.size || selected.size > 500}>修改分类标签</button><button className="button button-primary" onClick={() => void downloadSelected()} disabled={!selected.size || selected.size > 100 || downloading}>{downloading ? <><LoaderCircle size={14} className="spin" /> 正在打包</> : <><Download size={14} /> 下载所选素材</>}</button></div></div>
    {loading && !assets.length ? <div className="materials-loading"><LoaderCircle size={20} className="spin" /> 正在加载素材</div> : assets.length ? <div className="materials-grid">{assets.map((asset) => <article className={selected.has(asset.id) ? "material-card selected" : "material-card"} key={asset.id}>
      <label className="material-select" title={selected.has(asset.id) ? "取消选择" : "选择素材"}><input type="checkbox" checked={selected.has(asset.id)} onChange={() => toggleAsset(asset.id)} /><span>{selected.has(asset.id) && <Check size={12} />}</span></label>
      <a className="material-image" href={`/api/assets/${asset.id}`} target="_blank" rel="noreferrer"><img src={`/api/assets/${asset.id}/thumbnail`} alt={asset.original_name} loading="lazy" /></a>
      <div className="material-meta"><b title={asset.original_name}>{asset.original_name}</b><span>{asset.tags?.length ? asset.tags.map((tag) => tag.name).join(" · ") : asset.tag_name || "未分类"} · {asset.identifier || "旧素材"}</span><small>{asset.model_name || asset.model_id || "未知模型"} · {new Date(asset.created_at).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}</small></div>
      <div className="material-actions"><button type="button" className="button button-quiet" onClick={() => useMaterialForImageEdit(asset)}><ImagePlus size={13} /> 图生图</button></div>
    </article>)}</div> : !loading && <div className="empty-state materials-empty"><ImageIcon size={22} /><b>{filters.identifier || filters.dateFrom || filters.dateTo || filters.tagIds.length || filters.provider || filters.modelKey ? "没有符合条件的素材" : "素材库还是空的"}</b><span>完成图片创作后，生成结果会自动收录在这里。</span></div>}
    {total > 0 && <div className="materials-pagination"><label>每页显示<select className="period-select" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 张</option>)}</select></label><span>第 {page} / {pageCount} 页 · 共 {total} 张</span><div><button type="button" className="button button-quiet" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>上一页</button><button type="button" className="button button-quiet" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount || loading}>下一页</button></div></div>}
    {tagsDialogOpen && <div className="dialog-overlay" onClick={() => setTagsDialogOpen(false)}><section className="dialog-card material-tags-dialog" role="dialog" aria-modal="true" aria-labelledby="material-tags-title" onClick={(event) => event.stopPropagation()}><div className="dialog-head"><div><span className="dialog-icon"><Filter size={16} /></span><div><h2 id="material-tags-title">修改分类标签</h2><p>为已选 {selected.size} 张素材更新共享标签。</p></div></div><button className="icon-button" aria-label="关闭" onClick={() => setTagsDialogOpen(false)}><X size={17} /></button></div><p className="dialog-footnote">标签属于整条创作任务。若所选图片来自同一任务，修改会同步应用到该任务的全部生成图片。</p><div className="material-edit-tags">{tags.map((tag) => <button type="button" key={tag.id} className={editTagIds.includes(tag.id) ? "category-dropdown-option selected" : "category-dropdown-option"} aria-pressed={editTagIds.includes(tag.id)} onClick={() => toggleEditTag(tag.id)}><span className={editTagIds.includes(tag.id) ? "category-checkbox checked" : "category-checkbox"}>{editTagIds.includes(tag.id) && <Check size={10} />}</span>{tag.name}</button>)}</div><label className="material-clear-tags"><input type="checkbox" checked={clearTags} onChange={(event) => { setClearTags(event.target.checked); if (event.target.checked) setEditTagIds([]); }} /><span>清空所选任务的全部标签</span></label><div className="dialog-actions"><button className="button button-quiet" onClick={() => setTagsDialogOpen(false)}>取消</button><button className="button button-primary" onClick={() => void saveSelectedTags()} disabled={savingTags || (!editTagIds.length && !clearTags)}>{savingTags ? <><LoaderCircle className="spin" size={14} /> 保存中</> : "保存标签"}</button></div></section></div>}
  </div>;
}
