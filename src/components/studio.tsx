"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, CircleHelp, Clock3, ImagePlus, LoaderCircle, Maximize2, MessageSquareText, MoreHorizontal, MousePointer2, Plus, Search, Sparkles, WandSparkles, X, Zap } from "lucide-react";
import { MODELS, SHARED_ASPECT_RATIOS, nativeImageSize } from "@/server/models";

type Task = {
  id: string;
  status: string;
  name_template?: string | null;
  identifier?: string | null;
  tag_id?: string | null;
  tag_name?: string | null;
  created_at?: string;
  input_url?: string | null;
  runs: Array<{
    id: string;
    provider: string;
    modelKey: string;
    modelId: string;
    status: string;
    imageCount: number;
    startedAt?: string | null;
    finishedAt?: string | null;
    estimatedCost: string | null;
    currency: string | null;
    estimatedCostCny: string | null;
    errorMessage: string | null;
    outputs: Array<{ id: string; url: string; width?: number; height?: number }>;
  }>;
};

type CatalogEntry = {
  enabled: boolean;
  pricing?: { currency?: string; perImage?: Record<string, string | number> };
  priceCnyPerImage?: Record<string, number | null>;
};

type PromptEntry = { prompt: string; uses: number; latest_at: string; promptPrefix: string | null };
type CreativeTag = { id: string; name: string; task_count?: number };
type Estimate = {
  lines: Array<{ modelKey: string; modelName: string; count: number; nativeImageSize: string; estimatedCost: string; currency: string; estimatedCostCny: string | null }>;
  totalsByCurrency: Record<string, string>;
  totalCny: string | null;
};

function providerLogo(provider: string) {
  if (provider === "bailian") return { className: "bailian-logo", text: "通" };
  if (provider === "gemini") return { className: "gemini-logo", text: "✦" };
  if (provider === "deepseek") return { className: "deepseek-logo", text: "D" };
  return { className: "zhipu-logo", text: "智" };
}

function formatAmount(value: string | number) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(amount < 1 ? 4 : 2).replace(/0+$/, "").replace(/\.$/, "") : String(value);
}

export function Studio() {
  const [mode, setMode] = useState<"text-to-image" | "image-to-image">("text-to-image");
  const [prompt, setPrompt] = useState("");
  const [nameTemplate, setNameTemplate] = useState("{标识}");
  const [reusedPromptPrefix, setReusedPromptPrefix] = useState<string | null>(null);
  const [tags, setTags] = useState<CreativeTag[]>([]);
  const [selectedTagId, setSelectedTagId] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [savingTag, setSavingTag] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [selected, setSelected] = useState<string[]>(["bailian-qwen-image-3-pro", "gemini-3-1-flash-image"]);
  const [catalog, setCatalog] = useState<Record<string, CatalogEntry>>({});
  const [counts, setCounts] = useState<Record<string, number>>({ "bailian-qwen-image-3-pro": 1, "gemini-3-1-flash-image": 1 });
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [targetWidth, setTargetWidth] = useState("1024");
  const [targetHeight, setTargetHeight] = useState("1024");
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [message, setMessage] = useState("");
  const [recent, setRecent] = useState<Task[]>([]);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptSearch, setPromptSearch] = useState("");
  const [promptEntries, setPromptEntries] = useState<PromptEntry[]>([]);
  const [selectedPrompts, setSelectedPrompts] = useState<string[]>([]);
  const [deepseekAvailable, setDeepseekAvailable] = useState(false);
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [rewrittenPrompt, setRewrittenPrompt] = useState("");
  const [promptError, setPromptError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/generations?limit=4", { cache: "no-store" }).then((res) => res.ok ? res.json() : null).then((data) => setRecent(data?.tasks || [])).catch(() => undefined);
    fetch("/api/tags", { cache: "no-store" }).then((res) => res.ok ? res.json() : null).then((data) => setTags(data?.tags || [])).catch(() => undefined);
    fetch("/api/models", { cache: "no-store" }).then((res) => res.ok ? res.json() : null).then((data) => {
      if (!data?.models) return;
      const entries = Object.fromEntries(data.models.map((model: { key: string; enabled: boolean; pricing?: CatalogEntry["pricing"]; priceCnyPerImage?: CatalogEntry["priceCnyPerImage"] }) => [model.key, {
        enabled: model.enabled,
        pricing: model.pricing,
        priceCnyPerImage: model.priceCnyPerImage,
      }])) as Record<string, CatalogEntry>;
      setCatalog(entries);
      setSelected((items) => items.filter((key) => entries[key]?.enabled));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!task || !["queued", "running"].includes(task.status)) return;
    const timer = setInterval(() => {
      fetch(`/api/generations/${task.id}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => data?.task && setTask(data.task)).catch(() => undefined);
    }, 2500);
    return () => clearInterval(timer);
  }, [task?.id, task?.status]);

  useEffect(() => {
    if (!image) { setPreview(""); return; }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(() => {
    if (!promptOpen) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoadingPrompts(true);
      fetch(`/api/prompts?search=${encodeURIComponent(promptSearch)}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "历史提示词读取失败");
          setPromptEntries(data.prompts || []);
          setDeepseekAvailable(Boolean(data.deepseekAvailable));
        })
        .catch((error) => { if (error.name !== "AbortError") setPromptError(error.message || "历史提示词读取失败"); })
        .finally(() => { if (!controller.signal.aborted) setLoadingPrompts(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [promptOpen, promptSearch]);

  const availableModels = useMemo(() => MODELS.filter((model) => {
    const compatible = mode === "text-to-image" ? model.supportsTextToImage : model.supportsImageToImage;
    return catalog[model.key]?.enabled && compatible;
  }).sort((left, right) => {
    const leftSize = nativeImageSize(left, Number(targetWidth) || 1024, Number(targetHeight) || 1024);
    const rightSize = nativeImageSize(right, Number(targetWidth) || 1024, Number(targetHeight) || 1024);
    const leftPrice = catalog[left.key]?.priceCnyPerImage?.[leftSize];
    const rightPrice = catalog[right.key]?.priceCnyPerImage?.[rightSize];
    if (leftPrice == null && rightPrice == null) return left.name.localeCompare(right.name);
    if (leftPrice == null) return 1;
    if (rightPrice == null) return -1;
    return leftPrice - rightPrice || left.name.localeCompare(right.name);
  }), [catalog, mode, targetWidth, targetHeight]);

  const outputCount = useMemo(() => selected.reduce((sum, model) => sum + (counts[model] || 1), 0), [selected, counts]);
  const isRunning = loading || Boolean(task && ["queued", "running"].includes(task.status));
  const hasOneIdentifierToken = nameTemplate.includes("{标识}") && nameTemplate.indexOf("{标识}") === nameTemplate.lastIndexOf("{标识}");
  const containsLegacySequenceToken = nameTemplate.includes("{序号}");
  const nameTemplateValid = hasOneIdentifierToken && !containsLegacySequenceToken;
  const nameTemplateError = !hasOneIdentifierToken
    ? "命名模板必须且只能包含一次 {标识}"
    : containsLegacySequenceToken
      ? "序号已包含在 8 位编号中，请删除 {序号}"
      : "";
  const missingPriceRates = availableModels.some((model) => {
    const pricing = (catalog[model.key]?.pricing || model.defaultPricing) as { currency: string; perImage: Record<string, string | number> };
    const size = nativeImageSize(model, Number(targetWidth) || 1024, Number(targetHeight) || 1024);
    const price = pricing.perImage?.[size] ?? pricing.perImage?.["1K"];
    return price != null && pricing.currency !== "CNY" && catalog[model.key]?.priceCnyPerImage?.[size] == null;
  });

  function switchMode(value: "text-to-image" | "image-to-image") {
    setMode(value);
    if (value === "text-to-image") setImage(null);
    setSelected((items) => items.filter((key) => {
      const model = MODELS.find((item) => item.key === key);
      return value === "text-to-image" ? model?.supportsTextToImage : model?.supportsImageToImage;
    }));
    setTask(null);
  }

  function toggleModel(key: string) {
    if (!catalog[key]?.enabled || !availableModels.some((model) => model.key === key)) return;
    setSelected((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key]);
  }

  function setFile(file?: File) { if (!file) return; setImage(file); setMessage(""); }

  async function createTag() {
    const name = newTagName.trim();
    if (!name) { setMessage("请输入分类标签名称"); return; }
    setSavingTag(true); setMessage("");
    try {
      const response = await fetch("/api/tags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "标签创建失败");
      setTags((items) => [data.tag, ...items.filter((tag) => tag.id !== data.tag.id)].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")));
      setSelectedTagId(data.tag.id);
      setNewTagName("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "标签创建失败"); }
    finally { setSavingTag(false); }
  }

  async function requestEstimate() {
    if (!nameTemplateValid) return;
    if (!prompt.trim() || !selected.length || (mode === "image-to-image" && !image)) return;
    setEstimating(true); setMessage("");
    try {
      const response = await fetch("/api/generations/estimate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, prompt: prompt.trim(), models: selected.map((key) => ({ modelKey: key, count: counts[key] || 1 })), settings: { aspectRatio, targetWidth: Number(targetWidth), targetHeight: Number(targetHeight) } }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "成本预估失败");
      setEstimate(data);
      setEstimateOpen(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "成本预估失败"); }
    finally { setEstimating(false); }
  }

  async function submitGeneration() {
    if (!estimate) return;
    if (!nameTemplateValid) { setMessage(nameTemplateError); setEstimateOpen(false); return; }
    setEstimateOpen(false); setLoading(true); setMessage(""); setTask(null);
    const form = new FormData();
    form.set("mode", mode);
    form.set("prompt", prompt.trim());
    form.set("nameTemplate", nameTemplate.trim());
    if (reusedPromptPrefix) form.set("promptPrefix", reusedPromptPrefix);
    form.set("tagId", selectedTagId);
    form.set("models", JSON.stringify(selected.map((key) => ({ modelKey: key, count: counts[key] || 1 }))));
    form.set("settings", JSON.stringify({ aspectRatio, targetWidth: Number(targetWidth), targetHeight: Number(targetHeight) }));
    form.set("confirmed", "true");
    if (image) form.set("image", image);
    try {
      const response = await fetch("/api/generations", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "提交失败");
      const statusResponse = await fetch(`/api/generations/${data.taskId}`, { cache: "no-store" });
      const statusData = statusResponse.ok ? await statusResponse.json() : null;
      const created = statusData?.task || { id: data.taskId, status: data.status, name_template: nameTemplate.trim(), identifier: data.identifier, tag_id: selectedTagId || null, tag_name: tags.find((tag) => tag.id === selectedTagId)?.name || null, runs: [] } as Task;
      setTask(created);
      setRecent((items) => [created, ...items].slice(0, 4));
      if (data.warning) setMessage(data.warning);
    } catch (error) { setMessage(error instanceof Error ? error.message : "提交失败，请稍后再试"); }
    finally { setLoading(false); }
  }

  function openPromptPicker() {
    setPromptOpen(true);
    setPromptSearch("");
    setSelectedPrompts([]);
    setRewrittenPrompt("");
    setPromptError("");
  }

  function toggleHistoryPrompt(value: string) {
    setSelectedPrompts((items) => items.includes(value) ? items.filter((item) => item !== value) : [...items, value]);
  }

  function useHistoryPrompt(entry: PromptEntry) {
    setPrompt(entry.prompt);
    setReusedPromptPrefix(entry.promptPrefix);
    setSelectedPrompts([entry.prompt]);
    setPromptOpen(false);
    setMessage(entry.promptPrefix ? `已直接使用历史提示词，后续编号沿用前缀 ${entry.promptPrefix}` : "已直接使用历史提示词，将为这组提示词生成新前缀");
  }

  async function rewriteSelectedPrompts() {
    if (!selectedPrompts.length || !deepseekAvailable) return;
    setRewriting(true); setPromptError(""); setRewrittenPrompt("");
    try {
      const response = await fetch("/api/prompts/rewrite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompts: selectedPrompts }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "提示词重构失败");
      setRewrittenPrompt(data.prompt);
    } catch (error) { setPromptError(error instanceof Error ? error.message : "提示词重构失败"); }
    finally { setRewriting(false); }
  }

  const statusCount = Object.values(catalog).filter((entry) => entry.enabled).length;
  return <div className="studio-page">
    <header className="page-topbar"><div className="breadcrumb"><span>工作空间</span><span className="crumb-slash">/</span><b>创意生产</b></div><div className="topbar-right"><span className={statusCount ? "status-live" : "status-pending"}><i /> {statusCount} / {MODELS.length} 个模型已配置</span><button className="icon-button help-icon" title="帮助"><CircleHelp size={17} /></button></div></header>
    <div className="studio-heading"><div><p className="eyebrow">IMAGE CREATION WORKSPACE</p><h1>把灵感，变成看得见的创意。</h1><p className="muted">描述你的想法，或上传一张图片开始创作。</p></div><button className="button button-quiet" onClick={() => { setTask(null); setPrompt(""); setReusedPromptPrefix(null); setSelectedTagId(""); setNewTagName(""); setImage(null); }}><Plus size={16} /> 新建创作</button></div>
    <div className="mode-switch"><button onClick={() => switchMode("text-to-image")} className={mode === "text-to-image" ? "mode-option active" : "mode-option"}><span className="mode-icon"><WandSparkles size={16} /></span><span><b>文生图</b><small>从文字创造画面</small></span></button><button onClick={() => switchMode("image-to-image")} className={mode === "image-to-image" ? "mode-option active" : "mode-option"}><span className="mode-icon"><ImagePlus size={16} /></span><span><b>图生图</b><small>基于原图继续创作</small></span></button></div>
    <div className="studio-grid">
      <section className="prompt-panel card-surface">
        <div className="panel-title"><span className="step-number">01</span><div><h2>{mode === "text-to-image" ? "描述你想要的画面" : "上传图片并描述修改"}</h2><p>{mode === "text-to-image" ? "写下画面、风格和构图细节，越具体越好。" : "一张原图，加上一段清晰的编辑指令。"}</p></div></div>
        {mode === "image-to-image" && <div className={preview ? "upload-zone has-image" : "upload-zone"} onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setFile(event.dataTransfer.files[0]); }}>
          {preview ? <><img src={preview} alt="上传的参考图" /><div className="upload-overlay"><button className="button button-light" onClick={(event) => { event.stopPropagation(); setImage(null); }}><X size={14} /> 移除图片</button></div></> : <><span className="upload-icon"><ImagePlus size={20} /></span><b>点击或拖拽上传一张图片</b><small>支持 PNG、JPG、WebP，最大 10 MB</small></>}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => setFile(event.target.files?.[0])} />
        </div>}
        <div className="prompt-box"><div className="prompt-box-top"><span><MessageSquareText size={14} /> 提示词</span><div className="prompt-top-actions"><span className="prompt-count">{prompt.length} / 18,000</span><button type="button" className="button button-quiet prompt-picker-button" onClick={openPromptPicker}><WandSparkles size={13} /> 历史提示词 · DeepSeek 重构</button></div></div><textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); setReusedPromptPrefix(null); }} placeholder={mode === "text-to-image" ? "例如：一只橘猫坐在复古咖啡馆的窗边，午后阳光洒进来，胶片摄影质感……" : "例如：保持人物和构图不变，把背景改成海边日落，增加柔和的金色逆光……"} maxLength={18000} /><div className="prompt-hints"><span><Sparkles size={13} /> 描述主体、环境、光线和风格</span><span>Enter 换行</span></div></div>
        <label className="task-name-field"><span>图片命名</span><input value={nameTemplate} onChange={(event) => setNameTemplate(event.target.value)} maxLength={120} aria-invalid={!nameTemplateValid} aria-describedby="name-template-help" /><small id="name-template-help">可在编号前后添加自定义文字，必须且只能包含一次 {"{标识}"}；示例：活动名称-{"{标识}"}。{`{标识}`} 会替换为 8 位编号，复用历史提示词时沿用前 4 位。</small>{!nameTemplateValid && <small className="task-name-error">{nameTemplateError}</small>}</label>
        <div className="category-field"><label><span>分类标签</span><select value={selectedTagId} onChange={(event) => setSelectedTagId(event.target.value)}><option value="">未分类</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label><div><input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} maxLength={40} placeholder="新建分类标签" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createTag(); } }} /><button type="button" className="button button-quiet" onClick={() => void createTag()} disabled={savingTag}>{savingTag ? "保存中" : "创建并使用"}</button></div></div>
        <div className="section-divider" />
        <div className="controls-heading"><div><span className="step-number">02</span><span><b>选择模型进行比较</b><small>按参考单价从低到高排列，可同时选择多个可用模型</small></span></div><span className="selected-counter">{selected.length} 个已选择</span></div>
        <div className="model-options">{availableModels.map((model) => {
          const checked = selected.includes(model.key);
          const logo = providerLogo(model.provider);
          const size = nativeImageSize(model, Number(targetWidth) || 1024, Number(targetHeight) || 1024);
          const pricing = (catalog[model.key]?.pricing || model.defaultPricing) as { currency: string; perImage: Record<string, string | number> };
          const unitPrice = pricing.perImage?.[size] ?? pricing.perImage?.["1K"];
          const priceCny = catalog[model.key]?.priceCnyPerImage?.[size];
          const priceLabel = unitPrice == null ? "价格未配置" : `参考 ${formatAmount(unitPrice)} ${pricing.currency || ""}/张${priceCny != null && pricing.currency !== "CNY" ? ` · ¥${formatAmount(priceCny)}` : ""}`;
          return <div key={model.key} className={checked ? "model-option selected" : "model-option"} onClick={() => toggleModel(model.key)}>
            <span className={checked ? "model-check checked" : "model-check"}>{checked && <Check size={12} />}</span><span className={`provider-logo ${logo.className}`}>{logo.text}</span><span className="model-copy"><b>{model.name}</b><small>{model.provider === "bailian" ? "阿里云百炼" : model.provider === "gemini" ? "Google Gemini" : "智谱 AI"} · {model.supportsTextToImage ? "文生图" : ""}{model.supportsTextToImage && model.supportsImageToImage ? " / " : ""}{model.supportsImageToImage ? "图生图" : "仅文生图"} · {priceLabel}</small></span><span className="model-ready"><i /> 可用</span>
            {checked && <div className="model-count" onClick={(event) => event.stopPropagation()}><button onClick={() => setCounts((state) => ({ ...state, [model.key]: Math.max(1, (state[model.key] || 1) - 1) }))}>−</button><span>{counts[model.key] || 1} 张</span><button disabled={(counts[model.key] || 1) >= model.maxImages} onClick={() => setCounts((state) => ({ ...state, [model.key]: Math.min(model.maxImages, (state[model.key] || 1) + 1) }))}>+</button></div>}
          </div>;
        })}{availableModels.length === 0 && <div className="model-empty">当前模式没有已启用的模型，请联系管理员配置 API 与模型。</div>}</div>
        {missingPriceRates && <p className="price-rate-note">美元模型需要在 API 配置中维护生效汇率；缺少汇率的型号会排在已换算价格之后。</p>}
        <div className="param-row"><label><span>画面比例</span><div className="select-wrap"><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{SHARED_ASPECT_RATIOS.map((ratio) => <option key={ratio}>{ratio}</option>)}</select><ChevronDown size={14} /></div></label><div className="dimension-fields"><span>目标尺寸</span><div><label><input aria-label="目标宽度" type="number" min={256} max={4096} step={1} value={targetWidth} onChange={(event) => setTargetWidth(event.target.value)} /><small>宽</small></label><b>×</b><label><input aria-label="目标高度" type="number" min={256} max={4096} step={1} value={targetHeight} onChange={(event) => setTargetHeight(event.target.value)} /><small>高</small></label><span>px</span></div></div></div>
        <p className="dimension-note"><Maximize2 size={12} /> 返回图片会按目标尺寸等比填充并裁切边缘，不拉伸变形。</p>
        <div className="run-footer"><div className="run-note"><Zap size={14} /><span>本次将调用 {selected.length} 个模型，共生成 {outputCount} 张图{reusedPromptPrefix ? ` · 延续前缀 ${reusedPromptPrefix}` : ""}</span></div><button className="button button-primary generate-button" disabled={!prompt.trim() || !nameTemplateValid || !selected.length || selected.some((key) => !catalog[key]?.enabled) || !Number(targetWidth) || !Number(targetHeight) || Number(targetWidth) < 256 || Number(targetWidth) > 4096 || Number(targetHeight) < 256 || Number(targetHeight) > 4096 || (mode === "image-to-image" && !image) || isRunning || estimating} onClick={requestEstimate}>{estimating ? <><LoaderCircle className="spin" size={16} /> 正在估算</> : isRunning ? <><LoaderCircle className="spin" size={16} /> 正在生成</> : <><Sparkles size={15} /> 查看预估并生成 <ArrowRight size={15} /></>}</button></div>
        {message && <div className="inline-error">{message}</div>}
      </section>

      <section className="result-panel card-surface">
        <div className="result-panel-top"><div><p className="eyebrow">RESULT CANVAS</p><h2>{task ? "模型对比结果" : "创作画布"}</h2></div><div className="canvas-tools"><button className="canvas-tool active" title="选择"><MousePointer2 size={15} /></button><button className="canvas-tool" title="更多"><MoreHorizontal size={16} /></button></div></div>
        {!task && <div className="empty-canvas"><div className="canvas-grid" /><div className="empty-art"><div className="empty-art-frame"><div className="empty-art-sun" /><div className="empty-art-mountain mountain-one" /><div className="empty-art-mountain mountain-two" /><div className="empty-art-flower flower-one">✿</div><div className="empty-art-flower flower-two">✿</div><div className="empty-art-caption">A LITTLE IDEA<br /><b>GOES A LONG WAY</b></div></div><span className="float-chip chip-left"><Sparkles size={13} /> 灵感，正在酝酿</span><span className="float-chip chip-right"><span>✦</span> {availableModels.length} 个模型可选</span></div><h3>你的画布，等待第一张作品</h3><p>提交创作后，结果会在这里并排呈现。<br />每个模型独立显示进度与成本。</p><div className="canvas-shortcut"><span>试试从一个简单想法开始</span><button onClick={() => { setPrompt("一间被午后阳光照亮的复古咖啡馆，窗边一束鲜花，温柔的胶片色调，安静松弛的氛围"); setReusedPromptPrefix(null); }}>使用示例提示词 <ArrowRight size={13} /></button></div></div>}
        {task && <>{task.input_url && <div className="reference-preview"><span>共同原图</span><img src={task.input_url} alt="本次图生图的原始图片" /></div>}<div className="comparison-results">{task.runs.length === 0 && <div className="waiting-runs"><LoaderCircle className="spin" size={20} /><b>已提交到生成队列</b><span>模型正在准备画面，请稍候…</span></div>}{task.runs.map((run) => { const model = MODELS.find((item) => item.key === run.modelKey); const logo = providerLogo(run.provider); return <article key={run.id} className="result-card"><div className="result-card-head"><div className={`provider-logo ${logo.className}`}>{logo.text}</div><div><b>{model?.name || run.modelId}</b><small>{run.status === "succeeded" ? "生成完成" : run.status === "failed" ? "生成失败" : run.status === "unknown" ? "状态待核实" : "正在生成…"}</small></div><span className={run.status === "succeeded" ? "run-state ok" : "run-state"}>{run.status === "succeeded" ? <Check size={13} /> : <LoaderCircle className="spin" size={13} />}</span></div>
            {run.outputs?.length ? <div className="result-images">{run.outputs.map((output) => <figure key={output.id}><img src={output.url} alt={`${model?.name}生成的作品`} /><a href={`${output.url}?download=1`} download className="image-download"><ArrowDownToLine size={15} /></a></figure>)}</div> : <div className={run.status === "failed" || run.status === "unknown" ? "result-placeholder failed" : "result-placeholder"}>{run.status === "failed" ? <span>{run.errorMessage || "生成失败"}</span> : run.status === "unknown" ? <span>{run.errorMessage || "请先核对供应商记录"}</span> : <><LoaderCircle className="spin" size={18} /><span>正在为你生成画面</span></>}</div>}
            <div className="result-card-foot"><span><Clock3 size={13} /> {run.status === "succeeded" ? `${run.imageCount} 张图片 · ${run.startedAt && run.finishedAt ? `${Math.max(1, Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000))} 秒` : "已完成"}` : "等待结果"}</span><span className="cost-tag">{run.estimatedCost ? `估算 ${run.estimatedCost} ${run.currency}` : "成本待配置"}</span></div>
          </article>; })}</div></>}
        {task && <div className="result-bottom-note"><span>提示词前缀 · {task.identifier || "旧记录"}{task.tag_name ? `　分类 · ${task.tag_name}` : ""}</span><span>结果文件名包含每张素材的完整 8 位编号</span></div>}
      </section>
    </div>
    <section className="recent-section"><div className="recent-heading"><div><p className="eyebrow">RECENT CREATIONS</p><h2>最近创作</h2></div><a href="/history">查看全部 <ArrowRight size={14} /></a></div><div className="recent-grid">{recent.length ? recent.slice(0, 4).map((item) => <a key={item.id} href="/history" className="recent-tile">{item.runs?.flatMap((run) => run.outputs || []).slice(0, 1).map((output) => <img key={output.id} src={output.url} alt="最近创作" />)}<div><b>{item.status === "succeeded" ? "已完成创作" : item.status === "failed" ? "生成未完成" : "创作进行中"}</b><small>{new Date(item.created_at || Date.now()).toLocaleDateString("zh-CN")}</small></div></a>) : <div className="recent-empty"><Clock3 size={16} /><span>你的近期作品会显示在这里</span></div>}</div></section>
    <div className="studio-tip"><span><Sparkles size={14} /> 创作提示</span><p>试着把「主体 + 场景 + 光线 + 风格」写进提示词，让模型更准确地捕捉你的想法。</p><button onClick={() => { setPrompt("主体：一只白色小狗；场景：春日花园；光线：清晨柔和的自然光；风格：温暖、细腻的胶片摄影"); setReusedPromptPrefix(null); }}>写个好提示词 <ArrowRight size={13} /></button></div>

    {estimateOpen && estimate && <div className="dialog-overlay" onClick={() => setEstimateOpen(false)}><section className="dialog-card estimate-dialog" role="dialog" aria-modal="true" aria-labelledby="estimate-title" onClick={(event) => event.stopPropagation()}>
      <div className="dialog-head"><div><span className="dialog-icon"><Zap size={16} /></span><div><h2 id="estimate-title">确认本次预估成本</h2><p>确认后才会调用所选模型；价格以供应商实际计费为准。</p></div></div><button className="icon-button" aria-label="关闭" onClick={() => setEstimateOpen(false)}><X size={17} /></button></div>
      <div className="estimate-settings"><span>{mode === "text-to-image" ? "文生图" : "图生图"}</span><span>{aspectRatio}</span><span>{targetWidth} × {targetHeight} px</span><span>{outputCount} 张结果</span></div>
      <div className="estimate-lines">{estimate.lines.map((line) => { const model = MODELS.find((item) => item.key === line.modelKey); const logo = providerLogo(model?.provider || ""); return <div className="estimate-line" key={line.modelKey}><span className={`provider-logo ${logo.className}`}>{logo.text}</span><span className="estimate-model"><b>{line.modelName}</b><small>{line.count} 张 · 模型输入规格 {line.nativeImageSize}</small></span><span className="estimate-price"><b>{formatAmount(line.estimatedCost)} {line.currency}</b><small>{line.estimatedCostCny ? `约 ¥${formatAmount(line.estimatedCostCny)}` : "单项预估"}</small></span></div>; })}</div>
      <div className="estimate-total"><span>{Object.entries(estimate.totalsByCurrency).map(([currency, amount]) => <b key={currency}>{formatAmount(amount)} {currency}</b>)}</span><strong>{estimate.totalCny ? `约 ¥${formatAmount(estimate.totalCny)}` : "未配置完整汇率"}</strong></div>
      <div className="dialog-actions"><button className="button button-quiet" onClick={() => setEstimateOpen(false)}>返回调整</button><button className="button button-primary" disabled={loading} onClick={submitGeneration}><Sparkles size={15} /> 确认并开始生成</button></div>
    </section></div>}

    {promptOpen && <div className="dialog-overlay" onClick={() => setPromptOpen(false)}><section className="dialog-card prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="prompt-dialog-title" onClick={(event) => event.stopPropagation()}>
      <div className="dialog-head"><div><span className="dialog-icon"><WandSparkles size={16} /></span><div><h2 id="prompt-dialog-title">从历史提示词重构</h2><p>搜索并多选已用过的提示词，再交给 DeepSeek 合并重写。</p></div></div><button className="icon-button" aria-label="关闭" onClick={() => setPromptOpen(false)}><X size={17} /></button></div>
      <label className="prompt-search"><Search size={15} /><input autoFocus value={promptSearch} onChange={(event) => setPromptSearch(event.target.value)} placeholder="搜索提示词内容" /><span>{selectedPrompts.length} 项已选</span></label>
      <div className="history-prompt-list">{loadingPrompts ? <div className="dialog-empty"><LoaderCircle className="spin" size={18} /> 正在读取历史提示词…</div> : promptEntries.length ? promptEntries.map((entry) => <div key={entry.prompt} className={selectedPrompts.includes(entry.prompt) ? "history-prompt-option chosen" : "history-prompt-option"}><label className="history-prompt-choice"><input type="checkbox" checked={selectedPrompts.includes(entry.prompt)} onChange={() => toggleHistoryPrompt(entry.prompt)} /><span><b>{entry.prompt}</b><small>使用 {entry.uses} 次 · 最近使用 {new Date(entry.latest_at).toLocaleDateString("zh-CN")} · {entry.promptPrefix ? `沿用前缀 ${entry.promptPrefix}` : "旧记录无前缀"}</small></span></label><button type="button" className="button button-quiet prompt-direct-use" onClick={() => useHistoryPrompt(entry)}>直接使用</button></div>) : <div className="dialog-empty">没有匹配的历史提示词</div>}</div>
      {promptError && <div className="inline-error">{promptError}</div>}
      {rewrittenPrompt && <div className="rewritten-prompt"><b><Sparkles size={13} /> DeepSeek 重构结果</b><p>{rewrittenPrompt}</p><button className="button button-quiet" onClick={() => { setPrompt(rewrittenPrompt); setReusedPromptPrefix(null); setPromptOpen(false); }}>替换当前提示词 <ArrowRight size={13} /></button></div>}
      <div className="dialog-actions prompt-dialog-actions"><button className="button button-quiet" onClick={() => setPromptOpen(false)}>关闭</button><button className="button button-primary" onClick={rewriteSelectedPrompts} disabled={!selectedPrompts.length || !deepseekAvailable || rewriting}>{rewriting ? <><LoaderCircle className="spin" size={15} /> 正在重构</> : <><WandSparkles size={15} /> DeepSeek 一键重构</>}</button></div>
      {!deepseekAvailable && <p className="dialog-footnote">DeepSeek API 尚未启用，请管理员先在 API 配置中完成设置。</p>}
    </section></div>}
  </div>;
}
