"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, CircleHelp, Clock3, ImagePlus, LoaderCircle, Maximize2, MessageSquareText, MoreHorizontal, MousePointer2, Plus, RefreshCw, Sparkles, WandSparkles, X, Zap } from "lucide-react";
import { MODELS, SHARED_ASPECT_RATIOS, SHARED_IMAGE_SIZES } from "@/server/models";

type Task = { id: string; status: string; created_at?: string; input_url?: string | null; runs: Array<{ id: string; provider: string; modelKey: string; modelId: string; status: string; imageCount: number; startedAt?: string | null; finishedAt?: string | null; estimatedCost: string | null; currency: string | null; estimatedCostCny: string | null; errorMessage: string | null; outputs: Array<{ id: string; url: string; width?: number; height?: number }> }> };

export function Studio() {
  const [mode, setMode] = useState<"text-to-image" | "image-to-image">("text-to-image");
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [selected, setSelected] = useState<string[]>(["bailian-qwen-image-3-pro", "gemini-3-1-flash-image"]);
  const [available, setAvailable] = useState<Record<string, boolean>>({});
  const [counts, setCounts] = useState<Record<string, number>>({ "bailian-qwen-image-3-pro": 1, "gemini-3-1-flash-image": 1 });
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [imageSize, setImageSize] = useState<"1K" | "2K">("1K");
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [recent, setRecent] = useState<Task[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/generations?limit=4", { cache: "no-store" }).then((res) => res.ok ? res.json() : null).then((data) => setRecent(data?.tasks || [])).catch(() => undefined);
    fetch("/api/models", { cache: "no-store" }).then((res) => res.ok ? res.json() : null).then((data) => {
      if (!data?.models) return;
      const state = Object.fromEntries(data.models.map((model: { key: string; enabled: boolean }) => [model.key, model.enabled]));
      setAvailable(state);
      setSelected((items) => items.filter((key) => state[key]));
    }).catch(() => undefined);
  }, []);
  useEffect(() => { if (!task || !["queued", "running"].includes(task.status)) return; const timer = setInterval(() => { fetch(`/api/generations/${task.id}`, { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((d) => d?.task && setTask(d.task)).catch(() => undefined); }, 2500); return () => clearInterval(timer); }, [task?.id, task?.status]);
  useEffect(() => { if (!image) { setPreview(""); return; } const url = URL.createObjectURL(image); setPreview(url); return () => URL.revokeObjectURL(url); }, [image]);

  const outputCount = useMemo(() => selected.reduce((sum, model) => sum + (counts[model] || 1), 0), [selected, counts]);
  function switchMode(value: "text-to-image" | "image-to-image") { setMode(value); if (value === "text-to-image") setImage(null); else setImageSize("1K"); setSelected((items) => items.filter((key) => { const model=MODELS.find((item)=>item.key===key); return value==="text-to-image"?model?.supportsTextToImage:model?.supportsImageToImage; })); setTask(null); }
  function toggleModel(key: string) { const model=MODELS.find((item)=>item.key===key); const compatible=mode==="text-to-image"?model?.supportsTextToImage:model?.supportsImageToImage; if(!available[key]||!compatible)return; setSelected((items) => { if(items.includes(key)) return items.filter((item) => item !== key); if(items.length>=2)return items; return [...items,key]; }); }
  function setFile(file?: File) { if (!file) return; setImage(file); setMessage(""); }
  async function generate() {
    if (!prompt.trim() || !selected.length || selected.some((key) => !available[key]) || (mode === "image-to-image" && !image)) return;
    setLoading(true); setMessage(""); setTask(null);
    const form = new FormData();
    form.set("mode", mode); form.set("prompt", prompt.trim()); form.set("models", JSON.stringify(selected.map((key) => ({ modelKey: key, count: counts[key] || 1 }))));
    form.set("settings", JSON.stringify({ aspectRatio, imageSize }));
    if (image) form.set("image", image);
    try {
      const response = await fetch("/api/generations", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "提交失败");
      const statusResponse = await fetch(`/api/generations/${data.taskId}`, { cache: "no-store" });
      const statusData = statusResponse.ok ? await statusResponse.json() : null;
      const created = statusData?.task || { id: data.taskId, status: data.status, runs: [] } as Task;
      setTask(created);
      setRecent((items) => [created, ...items].slice(0, 4));
      if (data.warning) setMessage(data.warning);
    } catch (error) { setMessage(error instanceof Error ? error.message : "提交失败，请稍后再试"); }
    finally { setLoading(false); }
  }
  const isRunning = loading || Boolean(task && ["queued", "running"].includes(task.status));
  const commonSizes = selected.length ? SHARED_IMAGE_SIZES.filter((size) => selected.every((key) => { const model=MODELS.find((item)=>item.key===key); return model ? (model.supportedSizes as readonly ("1K" | "2K")[]).includes(size) : false; })) : SHARED_IMAGE_SIZES;
  const commonSizesKey = commonSizes.join(",");
  useEffect(() => { if (!commonSizes.includes(imageSize)) setImageSize(commonSizes[0] || "1K"); }, [commonSizesKey, imageSize]);
  return <div className="studio-page">
    <header className="page-topbar"><div className="breadcrumb"><span>工作空间</span><span className="crumb-slash">/</span><b>创意生产</b></div><div className="topbar-right"><span className={Object.values(available).some(Boolean) ? "status-live" : "status-pending"}><i /> {Object.values(available).filter(Boolean).length} / {MODELS.length} 个模型已配置</span><button className="icon-button help-icon" title="帮助"><CircleHelp size={17} /></button></div></header>
    <div className="studio-heading"><div><p className="eyebrow">IMAGE CREATION WORKSPACE</p><h1>把灵感，变成看得见的创意。</h1><p className="muted">描述你的想法，或上传一张图片开始创作。</p></div><button className="button button-quiet" onClick={() => { setTask(null); setPrompt(""); setImage(null); }}><Plus size={16} /> 新建创作</button></div>
    <div className="mode-switch"><button onClick={() => switchMode("text-to-image")} className={mode === "text-to-image" ? "mode-option active" : "mode-option"}><span className="mode-icon"><WandSparkles size={16} /></span><span><b>文生图</b><small>从文字创造画面</small></span></button><button onClick={() => switchMode("image-to-image")} className={mode === "image-to-image" ? "mode-option active" : "mode-option"}><span className="mode-icon"><ImagePlus size={16} /></span><span><b>图生图</b><small>基于原图继续创作</small></span></button></div>
    <div className="studio-grid">
      <section className="prompt-panel card-surface">
        <div className="panel-title"><span className="step-number">01</span><div><h2>{mode === "text-to-image" ? "描述你想要的画面" : "上传图片并描述修改"}</h2><p>{mode === "text-to-image" ? "写下画面、风格和构图细节，越具体越好。" : "一张原图，加上一段清晰的编辑指令。"}</p></div></div>
        {mode === "image-to-image" && <div className={preview ? "upload-zone has-image" : "upload-zone"} onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setFile(event.dataTransfer.files[0]); }}>
          {preview ? <><img src={preview} alt="上传的参考图" /><div className="upload-overlay"><button className="button button-light" onClick={(event) => { event.stopPropagation(); setImage(null); }}><X size={14} /> 移除图片</button></div></> : <><span className="upload-icon"><ImagePlus size={20} /></span><b>点击或拖拽上传一张图片</b><small>支持 PNG、JPG、WebP，最大 10 MB</small></>}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => setFile(event.target.files?.[0])} />
        </div>}
        <div className="prompt-box"><div className="prompt-box-top"><span><MessageSquareText size={14} /> 提示词</span><span className="prompt-count">{prompt.length} / 18,000</span></div><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={mode === "text-to-image" ? "例如：一只橘猫坐在复古咖啡馆的窗边，午后阳光洒进来，胶片摄影质感……" : "例如：保持人物和构图不变，把背景改成海边日落，增加柔和的金色逆光……"} maxLength={18000} /><div className="prompt-hints"><span><Sparkles size={13} /> 描述主体、环境、光线和风格</span><span>Enter 换行</span></div></div>
        <div className="section-divider" />
        <div className="controls-heading"><div><span className="step-number">02</span><span><b>选择模型进行比较</b><small>同一提示词同时发送给所选模型</small></span></div><span className="selected-counter">{selected.length} / 2 已选择</span></div>
        <div className="model-options">{MODELS.map((model) => { const checked = selected.includes(model.key); const providerLabel=model.provider==="bailian"?"阿里云百炼":model.provider==="gemini"?"Google Gemini":"智谱 AI"; const logoClass=model.provider==="bailian"?"bailian-logo":model.provider==="gemini"?"gemini-logo":"zhipu-logo"; const logoText=model.provider==="bailian"?"通":model.provider==="gemini"?"✦":"智"; const ready = available[model.key] === true; const compatible=mode==="text-to-image"?model.supportsTextToImage:model.supportsImageToImage; const pricing=model.defaultPricing as {currency:string;perImage:Record<string,string>}; const referencePrice=pricing.perImage[imageSize]||pricing.perImage["1K"]; return <div key={model.key} className={`${checked ? "model-option selected" : "model-option"}${ready && compatible ? "" : " unavailable"}`} onClick={() => toggleModel(model.key)}>
          <span className={checked ? "model-check checked" : "model-check"}>{checked && <Check size={12} />}</span><span className={`provider-logo ${logoClass}`}>{logoText}</span><span className="model-copy"><b>{model.name}</b><small>{providerLabel} · {model.supportsTextToImage?"文生图":""}{model.supportsTextToImage&&model.supportsImageToImage?" / ":""}{model.supportsImageToImage?"图生图":"仅文生图"} · 参考 {referencePrice} {pricing.currency}/张</small></span><span className={ready && compatible ? "model-ready" : "model-ready pending"}><i /> {!compatible?"此模式不支持":ready?"可用":"待管理员配置"}</span>
          {checked && <div className="model-count" onClick={(event) => event.stopPropagation()}><button onClick={() => setCounts((state) => ({ ...state, [model.key]: Math.max(1, (state[model.key] || 1) - 1) }))}>−</button><span>{counts[model.key] || 1} 张</span><button disabled={(counts[model.key] || 1) >= model.maxImages} onClick={() => setCounts((state) => ({ ...state, [model.key]: Math.min(model.maxImages, (state[model.key] || 1) + 1) }))}>+</button></div>}
        </div>; })}</div>
        <div className="param-row"><label><span>画面比例</span><div className="select-wrap"><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{SHARED_ASPECT_RATIOS.map((ratio) => <option key={ratio}>{ratio}</option>)}</select><ChevronDown size={14} /></div></label><label><span>图片尺寸</span><div className="size-toggle">{SHARED_IMAGE_SIZES.map((size) => <button key={size} disabled={!commonSizes.includes(size)} onClick={() => setImageSize(size)} className={imageSize === size ? "active" : ""}>{size}</button>)}</div></label></div>
        <div className="run-footer"><div className="run-note"><Zap size={14} /><span>本次将调用 {selected.length} 个模型，共生成 {outputCount} 张图</span></div><button className="button button-primary generate-button" disabled={!prompt.trim() || !selected.length || selected.some((key) => !available[key]) || (mode === "image-to-image" && !image) || isRunning} onClick={generate}>{isRunning ? <><LoaderCircle className="spin" size={16} /> 正在生成</> : <><Sparkles size={15} /> 开始生成 <ArrowRight size={15} /></>}</button></div>
        {message && <div className="inline-error">{message}</div>}
      </section>

      <section className="result-panel card-surface">
        <div className="result-panel-top"><div><p className="eyebrow">RESULT CANVAS</p><h2>{task ? "模型对比结果" : "创作画布"}</h2></div><div className="canvas-tools"><button className="canvas-tool active" title="选择"><MousePointer2 size={15} /></button><button className="canvas-tool" title="更多"><MoreHorizontal size={16} /></button></div></div>
        {!task && <div className="empty-canvas"><div className="canvas-grid" /><div className="empty-art"><div className="empty-art-frame"><div className="empty-art-sun" /><div className="empty-art-mountain mountain-one" /><div className="empty-art-mountain mountain-two" /><div className="empty-art-flower flower-one">✿</div><div className="empty-art-flower flower-two">✿</div><div className="empty-art-caption">A LITTLE IDEA<br /><b>GOES A LONG WAY</b></div></div><span className="float-chip chip-left"><Sparkles size={13} /> 灵感，正在酝酿</span><span className="float-chip chip-right"><span>✦</span> 2 个模型可对比</span></div><h3>你的画布，等待第一张作品</h3><p>提交创作后，结果会在这里并排呈现。<br />每个模型独立显示进度与成本。</p><div className="canvas-shortcut"><span>试试从一个简单想法开始</span><button onClick={() => setPrompt("一间被午后阳光照亮的复古咖啡馆，窗边一束鲜花，温柔的胶片色调，安静松弛的氛围")}>使用示例提示词 <ArrowRight size={13} /></button></div></div>}
        {task && <>{task.input_url && <div className="reference-preview"><span>共同原图</span><img src={task.input_url} alt="本次图生图的原始图片" /></div>}<div className="comparison-results">{task.runs.length === 0 && <div className="waiting-runs"><LoaderCircle className="spin" size={20} /><b>已提交到生成队列</b><span>模型正在准备画面，请稍候…</span></div>}{task.runs.map((run) => { const model = MODELS.find((item) => item.key === run.modelKey); const logoClass=run.provider==="bailian"?"bailian-logo":run.provider==="gemini"?"gemini-logo":"zhipu-logo"; const logoText=run.provider==="bailian"?"通":run.provider==="gemini"?"✦":"智"; return <article key={run.id} className="result-card"><div className="result-card-head"><div className={`provider-logo ${logoClass}`}>{logoText}</div><div><b>{model?.name || run.modelId}</b><small>{run.status === "succeeded" ? "生成完成" : run.status === "failed" ? "生成失败" : run.status === "unknown" ? "状态待核实" : "正在生成…"}</small></div><span className={run.status === "succeeded" ? "run-state ok" : "run-state"}>{run.status === "succeeded" ? <Check size={13} /> : <LoaderCircle className="spin" size={13} />}</span></div>
            {run.outputs?.length ? <div className="result-images">{run.outputs.map((output) => <figure key={output.id}><img src={output.url} alt={`${model?.name}生成的作品`} /><a href={output.url} download className="image-download"><ArrowDownToLine size={15} /></a></figure>)}</div> : <div className={run.status === "failed" || run.status === "unknown" ? "result-placeholder failed" : "result-placeholder"}>{run.status === "failed" ? <span>{run.errorMessage || "生成失败"}</span> : run.status === "unknown" ? <span>{run.errorMessage || "请先核对供应商记录"}</span> : <><LoaderCircle className="spin" size={18} /><span>正在为你生成画面</span></>}</div>}
            <div className="result-card-foot"><span><Clock3 size={13} /> {run.status === "succeeded" ? `${run.imageCount} 张图片 · ${run.startedAt && run.finishedAt ? `${Math.max(1,Math.round((new Date(run.finishedAt).getTime()-new Date(run.startedAt).getTime())/1000))} 秒` : "已完成"}` : "等待结果"}</span><span className="cost-tag">{run.estimatedCost ? `估算 ${run.estimatedCost} ${run.currency}` : "成本待配置"}</span></div>
          </article>; })}</div></>}
        {task && <div className="result-bottom-note"><span>任务编号 · {task.id.slice(0, 8).toUpperCase()}</span><span>费用为估算值，以供应商账单为准</span></div>}
      </section>
    </div>
    <section className="recent-section"><div className="recent-heading"><div><p className="eyebrow">RECENT CREATIONS</p><h2>最近创作</h2></div><a href="/history">查看全部 <ArrowRight size={14} /></a></div><div className="recent-grid">{recent.length ? recent.slice(0, 4).map((item) => <a key={item.id} href="/history" className="recent-tile">{item.runs?.flatMap((run) => run.outputs || []).slice(0,1).map((output) => <img key={output.id} src={output.url} alt="最近创作" />)}<div><b>{item.status === "succeeded" ? "已完成创作" : item.status === "failed" ? "生成未完成" : "创作进行中"}</b><small>{new Date(item.created_at || Date.now()).toLocaleDateString("zh-CN")}</small></div></a>) : <div className="recent-empty"><Clock3 size={16} /><span>你的近期作品会显示在这里</span></div>}</div></section>
    <div className="studio-tip"><span><Sparkles size={14} /> 创作提示</span><p>试着把「主体 + 场景 + 光线 + 风格」写进提示词，让模型更准确地捕捉你的想法。</p><button onClick={() => setPrompt("主体：一只白色小狗；场景：春日花园；光线：清晨柔和的自然光；风格：温暖、细腻的胶片摄影")}>写个好提示词 <ArrowRight size={13} /></button></div>
  </div>;
}
