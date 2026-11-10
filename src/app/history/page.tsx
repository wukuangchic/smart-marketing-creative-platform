"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Clock3, ImagePlus, Search, Trash2 } from "lucide-react";

type Run = { id: string; provider: string; modelKey: string; modelId: string; status: string; requestedCount: number; imageCount: number; estimatedCost: string | null; estimatedCostCny: string | null; currency: string | null; errorMessage: string | null; outputs: Array<{ id: string; url: string; width: number | null; height: number | null }> };
type Task = { id: string; mode: string; prompt: string; name_template: string | null; identifier: string | null; settings: Record<string,string>; status: string; created_at: string; creator_name: string; assets?: Array<{ id:string; kind:string; url:string; width:number|null; height:number|null; mediaType:string }>; runs: Run[] };

export default function HistoryPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    fetch("/api/generations?limit=100", { cache: "no-store" }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setTasks(d.tasks || []); }).catch((e) => setError(e.message));
    fetch("/api/me", { cache: "no-store" }).then((r) => r.json()).then((d) => setIsAdmin(d.user?.role === "admin")).catch(() => undefined);
  }, []);
  async function deleteTask(id: string) {
    if (!confirm("删除这条创作记录及其原图、结果图片？此操作不可撤销。")) return;
    const response = await fetch(`/api/admin/tasks/${id}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) { setError(data.error || "删除失败"); return; }
    setTasks((items) => items.filter((task) => task.id !== id));
    if (data.cleanupPending) setError(`记录已删除，但有 ${data.cleanupPending} 个图片文件未能清理，已写入审计记录。`);
  }
  const visible = tasks.filter((task) => `${task.prompt} ${task.creator_name} ${task.name_template || ""} ${task.identifier || ""} ${task.runs.map((r) => r.modelId).join(" ")}`.toLowerCase().includes(filter.toLowerCase()));
  return <div className="subpage">
    <header className="page-topbar"><div className="breadcrumb"><span>工作空间</span><span className="crumb-slash">/</span><b>历史记录</b></div><a className="button button-quiet" href="/"><ImagePlus size={16} /> 新建创作</a></header>
    <div className="subpage-heading"><div><p className="eyebrow">CREATION ARCHIVE</p><h1>创作历史</h1><p className="muted">团队成员可共同查看所有创作记录与生成结果。</p></div><div className="history-count"><b>{tasks.length}</b><span>条创作记录</span></div></div>
    <div className="history-toolbar"><label className="search-field"><Search size={16} /><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="搜索提示词、成员或模型" /></label><span className="sort-label"><Clock3 size={14} /> 最近创建</span></div>
    {error && <div className="notice notice-error">{error}</div>}
    <div className="history-list">{visible.map((task) => <article className="history-card" key={task.id}><div className="history-main"><div className="history-meta"><span className={task.mode === "image-to-image" ? "history-type edit" : "history-type"}>{task.mode === "image-to-image" ? "图生图" : "文生图"}</span><span>{task.creator_name}</span><span>·</span><span>{new Date(task.created_at).toLocaleString("zh-CN", { month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit" })}</span><span className={`task-pill ${task.status}`}>{task.status === "succeeded" ? "已完成" : task.status === "partial" ? "部分完成" : task.status === "failed" ? "失败" : task.status === "unknown" ? "状态待核实" : "进行中"}</span>{isAdmin && <button className="icon-button history-delete" title="删除这条创作记录" onClick={() => deleteTask(task.id)}><Trash2 size={14}/></button>}</div><p className="history-prompt">{task.prompt}</p><div className="history-tags">{task.runs.map((run) => <span key={run.id}>{run.modelId}</span>)}<span>{task.settings?.aspectRatio || "1:1"} · {task.settings?.imageSize || "1K"}</span>{task.identifier && <span className="history-identifier">标识 {task.identifier}</span>}{task.name_template && task.identifier && <span>{task.name_template.replace("{标识}", task.identifier)}</span>}</div></div><div className="history-images">{[...(task.assets?.filter((asset) => asset.kind === "input") || []), ...task.runs.flatMap((run) => run.outputs || [])].slice(0, 4).map((asset) => <a href={asset.url} target="_blank" key={asset.id}><img src={asset.url} alt={"kind" in asset && asset.kind === "input" ? "图生图原图" : "生成作品"} /><span><ArrowUpRight size={13} /></span></a>)}</div><div className="history-costs">{task.runs.map((run) => <div key={run.id}><small>{run.modelId.replace("-image", "")}</small><b>{run.estimatedCost ? `${Number(run.estimatedCost).toFixed(4)} ${run.currency}` : "待配置"}</b></div>)}</div></article>)}
      {!error && !visible.length && <div className="empty-state"><Clock3 size={22} /><b>{filter ? "没有匹配记录" : "还没有创作记录"}</b><span>{filter ? "换个关键词再试试" : "完成第一张创作后，记录会出现在这里。"}</span>{!filter && <a href="/" className="text-link">开始创作 <ArrowUpRight size={14} /></a>}</div>}
    </div>
  </div>;
}
