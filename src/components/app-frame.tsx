"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Aperture, ArrowUpRight, BarChart3, Clock3, Gauge, Images, LogOut, Settings2, Shield, Sparkles, WalletCards } from "lucide-react";

type User = { id: string; openId: string; name: string; role: "member" | "admin"; avatarUrl: string | null };
const nav = [
  { href: "/", label: "创意生产", icon: Sparkles },
  { href: "/history", label: "历史记录", icon: Clock3 },
  { href: "/materials", label: "素材库", icon: Images },
  { href: "/costs", label: "成本统计", icon: WalletCards },
  { href: "/consumption", label: "消耗统计", icon: BarChart3, planned: true },
  { href: "/roi", label: "ROI 面板", icon: Gauge, planned: true },
];

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [storage, setStorage] = useState<{ usedPercent: number; warning: boolean; blocked: boolean } | null>(null);
  useEffect(() => {
    if (pathname === "/login") { setReady(true); return; }
    let mounted = true;
    fetch("/api/me", { cache: "no-store" }).then((response) => response.json()).then((data) => {
      if (mounted) { setUser(data.user); setStorage(data.setup?.storage || null); setReady(true); }
    }).catch(() => { if (mounted) setReady(true); });
    return () => { mounted = false; };
  }, [pathname]);

  if (pathname === "/login") return <>{children}</>;
  if (!ready) return <main className="boot-screen"><div className="loader-mark"><Aperture size={24} /></div><span>正在打开灵感工场…</span></main>;
  if (!user) return <main className="auth-needed"><div className="auth-card"><div className="brand-mark"><Aperture size={24} /></div><p className="eyebrow">SMART MARKETING · CREATIVE STUDIO</p><h1>让每个好点子<br /><em>都值得看见。</em></h1><p className="muted">请使用公司飞书账号登录，进入创意工作台。</p><a className="button button-primary" href="/api/auth/login">使用飞书登录 <ArrowUpRight size={16} /></a><Link className="text-link" href="/login">查看登录配置状态</Link></div></main>;
  if (pathname.startsWith("/admin") && user.role !== "admin") return <main className="auth-needed"><div className="auth-card"><div className="brand-mark"><Shield size={22} /></div><p className="eyebrow">ADMIN ACCESS</p><h1>此页面仅限<br /><em>平台管理员。</em></h1><p className="muted">你的账号可使用创意工作台和查看共享历史、成本。</p><Link className="button button-primary" href="/">返回创意生产</Link></div></main>;

  const active = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }
  return <div className="app-layout">
    <aside className="sidebar">
      <Link className="brand" href="/"><span className="brand-icon"><Aperture size={21} strokeWidth={1.8} /></span><span><strong>灵感工场</strong><small>CREATIVE STUDIO</small></span></Link>
      <div className="workspace-picker"><span className="workspace-dot">智</span><span><b>智能营销部</b><small>公司工作空间</small></span><span className="chevrons">⌄</span></div>
      <div className="nav-caption">工作空间</div>
      <nav className="main-nav">{nav.map((item) => { const Icon = item.icon; return <Link key={item.href} href={item.href} className={active(item.href) ? "nav-item active" : "nav-item"}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.planned && <small className="nav-coming">待开发</small>}{item.href === "/" && <span className="nav-key">⌘ 1</span>}</Link>; })}</nav>
      {user.role === "admin" && <><div className="nav-caption nav-caption-admin">管理</div><nav className="main-nav"><Link href="/admin" className={active("/admin") ? "nav-item active" : "nav-item"}><Settings2 size={17} strokeWidth={1.8} /><span>API 配置</span><Shield size={13} className="admin-shield" /></Link></nav></>}
      <div className="sidebar-bottom">
        {storage?.warning && <div className={storage.blocked ? "storage-note blocked" : "storage-note"}><span className="storage-note-dot" /><div><b>{storage.blocked ? "生成已暂停" : "图片空间接近上限"}</b><small>已使用 {storage.usedPercent}% · 联系管理员扩容</small></div></div>}
        <div className="profile-row"><span className="avatar">{user.name.slice(0, 1)}</span><span className="profile-copy"><b>{user.name}</b><small>{user.role === "admin" ? "平台管理员" : "创意成员"}</small></span><button className="icon-button logout-button" title="退出登录" onClick={logout}><LogOut size={16} /></button></div>
      </div>
    </aside>
    <main className="main-area">{children}</main>
  </div>;
}
