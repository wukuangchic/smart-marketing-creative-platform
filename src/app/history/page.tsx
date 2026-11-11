"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Clock3, Copy, Download, ImagePlus, Search } from "lucide-react";

type Output = { id: string; url: string; originalName: string; width: number | null; height: number | null };
type Run = { id: string; provider: string; modelKey: string; modelId: string; status: string; requestedCount: number; imageCount: number; estimatedCost: string | null; currency: string | null; estimatedCostCny: string | null; errorMessage: string | null; outputs: Output[] };
type InputAsset = { id: string; kind: "input"; url: string; originalName: string; width: number | null; height: number | null; mediaType: string };
type Task = { id: string; mode: string; prompt: string; name_template: string | null; identifier: string | null; tag_id: string | null; tag_name: string | null; tags?: Array<{ id: string; name: string }>; settings: Record<string, string | number>; status: string; created_at: string; creator_name: string; assets?: InputAsset[]; runs: Run[] };
type PreviewAsset = { id: string; url: string; originalName: string; kind: "input" | "output" };
const PAGE_SIZES = [20, 100, 500] as const;

export default function HistoryPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setTasks([]);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) });
      if (filter.trim()) params.set("search", filter.trim());
      fetch(`/api/generations?${params}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "历史记录读取失败");
        setTasks(data.tasks || []);
        setTotal(Number(data.total) || 0);
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "历史记录读取失败");
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, filter ? 180 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [filter, page, pageSize]);

  function copyTaskToStudio(task: Task) {
    const legacyAliases: Record<string, string> = { I: "J", L: "M", O: "P", U: "V" };
    const rawPrefix = (task.identifier?.slice(0, 4) || "").toUpperCase().replace(/[ILOU]/g, (character) => legacyAliases[character]);
    const promptPrefix = /^[0-9A-HJKMNP-TV-Z]{4}$/.test(rawPrefix) ? rawPrefix : null;
    const copy = {
      mode: task.mode,
      prompt: task.prompt,
      nameTemplate: task.name_template || "{标识}",
      promptPrefix,
      tagIds: task.tags?.length ? task.tags.map((tag) => tag.id) : (task.tag_id ? [task.tag_id] : []),
      models: task.runs.map((run) => ({ modelKey: run.modelKey, count: run.requestedCount || run.imageCount || 1 })),
      settings: {
        aspectRatio: task.settings?.aspectRatio || "1:1",
        targetWidth: Number(task.settings?.targetWidth) || 1024,
        targetHeight: Number(task.settings?.targetHeight) || 1024,
      },
    };
    try {
      window.sessionStorage.setItem("creative-studio-copy", JSON.stringify(copy));
      window.location.assign("/");
    } catch {
      setError("无法临时保存这套配置，请重试");
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return <div className="subpage">
    <header className="page-topbar"><div className="breadcrumb"><span>工作空间</span><span className="crumb-slash">/</span><b>历史记录</b></div><a className="button button-quiet" href="/"><ImagePlus size={16} /> 新建创作</a></header>
    <div className="subpage-heading"><div><p className="eyebrow">CREATION ARCHIVE</p><h1>创作历史</h1><p className="muted">团队成员可共同查看所有创作记录与生成结果。</p></div><div className="history-count"><b>{total}</b><span>条创作记录</span></div></div>
    <div className="history-toolbar"><label className="search-field"><Search size={16} /><input value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }} placeholder="搜索提示词、成员、模型、标识或标签" /></label><span className="sort-label"><Clock3 size={14} /> 最近创建</span></div>
    {error && <div className="notice notice-error">{error}</div>}
    <div className="history-list">{tasks.map((task) => {
      const previews: PreviewAsset[] = [
        ...(task.assets?.filter((asset) => asset.kind === "input").map((asset) => ({ id: asset.id, url: asset.url, originalName: asset.originalName, kind: "input" as const })) || []),
        ...task.runs.flatMap((run) => run.outputs || []).map((asset) => ({ id: asset.id, url: asset.url, originalName: asset.originalName, kind: "output" as const })),
      ].slice(0, 4);
      return <article className="history-card" key={task.id}>
        <div className="history-main">
          <div className="history-meta"><span className={task.mode === "image-to-image" ? "history-type edit" : "history-type"}>{task.mode === "image-to-image" ? "图生图" : "文生图"}</span><span>{task.creator_name}</span><span>·</span><span>{new Date(task.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span><span className={`task-pill ${task.status}`}>{task.status === "succeeded" ? "已完成" : task.status === "partial" ? "部分完成" : task.status === "failed" ? "失败" : task.status === "unknown" ? "状态待核实" : "进行中"}</span><button type="button" className="history-task-copy" onClick={() => copyTaskToStudio(task)}><Copy size={13} /> 一键复制</button>{task.runs.some((run) => run.outputs?.length) && <a className="history-task-download" href={`/api/generations/${task.id}/download`}><Download size={13} /> 下载任务压缩包</a>}</div>
          <p className="history-prompt">{task.prompt}</p>
          <div className="history-tags">{task.runs.map((run) => <span key={run.id}>{run.modelId}</span>)}<span>{task.settings?.aspectRatio || "1:1"} · {task.settings?.imageSize || "1K"}</span>{task.identifier && <span className="history-identifier">{task.identifier.length === 4 ? "提示词前缀" : "标识"} {task.identifier}</span>}{task.tags?.length ? task.tags.map((tag) => <span className="history-category-tag" key={tag.id}>{tag.name}</span>) : task.tag_name && <span className="history-category-tag">{task.tag_name}</span>}{task.name_template && task.identifier && task.name_template !== "{标识}" && <span>{task.name_template.replace("{标识}", task.identifier)}</span>}</div>
        </div>
        <div className="history-images">{previews.map((asset) => <a className="history-image-preview" key={asset.id} href={asset.url} target="_blank" rel="noreferrer"><img src={`/api/assets/${asset.id}/thumbnail`} alt={asset.kind === "input" ? "图生图原图" : asset.originalName} loading="lazy" /><span><ArrowUpRight size={13} /></span></a>)}</div>
        <div className="history-costs">{task.runs.map((run) => <div key={run.id}><small>{run.modelId.replace("-image", "")}</small><b>{run.estimatedCost ? `${Number(run.estimatedCost).toFixed(4)} ${run.currency}` : "待配置"}</b></div>)}</div>
      </article>;
    })}
      {loading && !tasks.length && <div className="materials-loading">正在加载历史记录</div>}
      {!loading && !tasks.length && <div className="empty-state"><Clock3 size={22} /><b>{filter ? "没有匹配记录" : "还没有创作记录"}</b><span>{filter ? "换个关键词再试试" : "完成第一张创作后，记录会出现在这里。"}</span>{!filter && <a href="/" className="text-link">开始创作 <ArrowUpRight size={14} /></a>}</div>}
    </div>
    {total > 0 && <div className="history-pagination"><label>每页显示<select className="period-select" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label><span>第 {page} / {pageCount} 页 · 共 {total} 条</span><div><button type="button" className="button button-quiet" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>上一页</button><button type="button" className="button button-quiet" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount || loading}>下一页</button></div></div>}
  </div>;
}
