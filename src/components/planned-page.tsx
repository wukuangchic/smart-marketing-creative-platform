import Link from "next/link";
import { ArrowUpRight, Clock3 } from "lucide-react";

export function PlannedPage({ title, eyebrow, description }: { title: string; eyebrow: string; description: string }) {
  return <div className="subpage planned-page">
    <header className="page-topbar"><div className="breadcrumb"><span>工作空间</span><span className="crumb-slash">/</span><b>{title}</b></div><span className="planned-badge">待开发</span></header>
    <div className="subpage-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{description}</p></div></div>
    <section className="planned-card card-surface"><span className="planned-icon"><Clock3 size={20} /></span><b>此功能已加入项目计划</b><p>当前阶段优先完善图片创作、素材管理和模型成本比较。该页面暂不展示统计数据。</p><Link className="text-link" href="/costs">查看成本统计 <ArrowUpRight size={14} /></Link></section>
  </div>;
}
