"use client";

import { useEffect, useState } from "react";
import { Aperture, ArrowLeft, ArrowUpRight, Check, CircleAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";

export default function LoginPage() {
  const [state, setState] = useState<{ feishuConfigured?: boolean; encryptionConfigured?: boolean } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const messages: Record<string,string> = { not_whitelisted: "你的飞书账号尚未加入平台白名单，请联系管理员。", disabled: "此账号已停用，请联系管理员。", oauth_state: "登录验证已过期，请重新发起登录。", oauth_failed: "飞书登录未完成，请检查应用配置后重试。" };
    setError(params.get("setup") === "feishu" ? "飞书自建应用信息尚未配置。" : messages[params.get("error") || ""] || "");
    fetch("/api/me").then((response) => response.json()).then((data) => setState(data.setup)).catch(() => setState({}));
  }, []);
  return <div className="login-page"><div className="login-art"><div className="art-orbit orbit-a" /><div className="art-orbit orbit-b" /><div className="art-orbit orbit-c" /><div className="art-stars">✦<span>✧</span>✦</div><div className="art-glow" /><div className="art-copy"><div className="brand-mark brand-mark-light"><Aperture size={24} /></div><p>IDEAS INTO IMAGERY</p><h1>每一个灵感，<br />都有自己的<span>画面。</span></h1><div className="art-footer"><span>智能营销部 · 创意图片平台</span><span>01 / 2026</span></div></div></div>
    <div className="login-form-side"><Link className="login-back" href="/"><ArrowLeft size={15} /> 返回工作台</Link><div className="login-form"><span className="login-mini-mark"><Aperture size={22} /></span><p className="eyebrow">WELCOME TO CREATIVE STUDIO</p><h2>欢迎回来</h2><p className="muted">使用公司飞书账号安全登录</p>
      {error && <div className="notice notice-error"><CircleAlert size={17} />{error}</div>}
      <a className="button button-primary login-submit" href="/api/auth/login">继续使用飞书 <ArrowUpRight size={16} /></a>
      <div className="secure-note"><ShieldCheck size={16} /><span>仅限已加入平台白名单的公司成员访问</span></div>
      <div className="setup-list"><div><span className={state?.feishuConfigured ? "setup-check done" : "setup-check"}>{state?.feishuConfigured ? <Check size={12} /> : "1"}</span><span>飞书登录应用{state?.feishuConfigured ? "已配置" : "待管理员配置"}</span></div><div><span className={state?.encryptionConfigured ? "setup-check done" : "setup-check"}>{state?.encryptionConfigured ? <Check size={12} /> : "2"}</span><span>API 凭证加密{state?.encryptionConfigured ? "已就绪" : "待管理员配置"}</span></div></div>
    </div><div className="login-legal">灵感工场 · 智能营销部 <span>内部使用</span></div></div></div>;
}
