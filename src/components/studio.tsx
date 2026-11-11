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
  tags?: CreativeTag[];
  created_at?: string;
  input_assets?: Array<{ id: string; url: string; thumbnailUrl: string; originalName: string }>;
  runs: Array<{
    id: string;
    inputAssetId?: string | null;
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
type ReferenceAsset = { id: string; originalName: string };
type Estimate = {
  lines: Array<{ modelKey: string; modelName: string; count: number; countPerInput: number; inputCount: number; nativeImageSize: string; estimatedCost: string; currency: string; estimatedCostCny: string | null }>;
  totalsByCurrency: Record<string, string>;
  totalCny: string | null;
};

function providerLogo(provider: string) {
  if (provider === "bailian") return { className: "bailian-logo", text: "通" };
  if (provider === "gemini") return { className: "gemini-logo", text: "✦" };
  if (provider === "deepseek") return { className: "deepseek-logo", text: "D" };
  if (provider === "volcengine") return { className: "volcengine-logo", text: "豆" };
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
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [savingTag, setSavingTag] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [referenceAssets, setReferenceAssets] = useState<ReferenceAsset[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>(["bailian-qwen-image-3-pro", "gemini-3-1-flash-image"]);
  const [catalog, setCatalog] = useState<Record<string, CatalogEntry>>({});
  const [modelCatalogReady, setModelCatalogReady] = useState(false);
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
      if (!data?.models) { setModelCatalogReady(true); return; }
      const entries = Object.fromEntries(data.models.map((model: { key: string; enabled: boolean; pricing?: CatalogEntry["pricing"]; priceCnyPerImage?: CatalogEntry["priceCnyPerImage"] }) => [model.key, {
        enabled: model.enabled,
        pricing: model.pricing,
        priceCnyPerImage: model.priceCnyPerImage,
      }])) as Record<string, CatalogEntry>;
      setCatalog(entries);
      setSelected((items) => items.filter((key) => entries[key]?.enabled));
      setModelCatalogReady(true);
    }).catch(() => setModelCatalogReady(true));
  }, []);

  useEffect(() => {
    if (!modelCatalogReady) return;
    const storageKey = "creative-studio-copy";
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return;
    window.sessionStorage.removeItem(storageKey);
    try {
      const copy = JSON.parse(raw) as {
        mode?: string;
        prompt?: string;
        nameTemplate?: string;
        promptPrefix?: string | null;
        tagIds?: unknown[];
        models?: Array<{ modelKey?: string; count?: number }>;
        settings?: { aspectRatio?: string; targetWidth?: number; targetHeight?: number };
        referenceAssets?: ReferenceAsset[];
      };
      const copiedMode = copy.mode === "image-to-image" ? "image-to-image" : "text-to-image";
      const copiedModels = Array.isArray(copy.models) ? copy.models : [];
      const nextCounts: Record<string, number> = {};
      const nextSelected: string[] = [];
      let skippedModels = 0;
      for (const requested of copiedModels) {
        const model = MODELS.find((item) => item.key === requested.modelKey);
        if (!model) { skippedModels += 1; continue; }
        nextCounts[model.key] = Math.max(1, Math.min(model.maxImages, Math.floor(Number(requested.count) || 1)));
        const compatible = copiedMode === "text-to-image" ? model.supportsTextToImage : model.supportsImageToImage;
        if (catalog[model.key]?.enabled && compatible && !nextSelected.includes(model.key)) nextSelected.push(model.key);
        else skippedModels += 1;
      }
      if (!copiedModels.length) {
        for (const model of MODELS) {
          const compatible = copiedMode === "text-to-image" ? model.supportsTextToImage : model.supportsImageToImage;
          if (catalog[model.key]?.enabled && compatible) nextSelected.push(model.key);
        }
      }
      const ratio = String(copy.settings?.aspectRatio || "1:1");
      const promptPrefix = typeof copy.promptPrefix === "string" && /^[0-9A-HJKMNP-TV-Z]{4}$/i.test(copy.promptPrefix)
        ? copy.promptPrefix.toUpperCase() : null;
      setMode(copiedMode);
      setPrompt(typeof copy.prompt === "string" ? copy.prompt : "");
      setNameTemplate(typeof copy.nameTemplate === "string" && copy.nameTemplate ? copy.nameTemplate : "{标识}");
      setReusedPromptPrefix(promptPrefix);
      setSelectedTagIds(Array.isArray(copy.tagIds) ? copy.tagIds.filter((id): id is string => typeof id === "string") : []);
      setSelected(nextSelected);
      setCounts(nextCounts);
      setAspectRatio((SHARED_ASPECT_RATIOS as readonly string[]).includes(ratio) ? ratio : "1:1");
      setTargetWidth(String(Math.max(256, Math.min(4096, Number(copy.settings?.targetWidth) || 1024))));
      setTargetHeight(String(Math.max(256, Math.min(4096, Number(copy.settings?.targetHeight) || 1024))));
      setImages([]);
      setReferenceAssets(Array.isArray(copy.referenceAssets) ? copy.referenceAssets.filter((asset) => asset && typeof asset.id === "string" && typeof asset.originalName === "string").slice(0, 10) : []);
      if (fileRef.current) fileRef.current.value = "";
      setTask(null);
      setEstimate(null);
      setEstimateOpen(false);
      setTagPickerOpen(false);
      setTagSearch("");
      const availabilityNote = skippedModels ? `；${skippedModels} 个模型当前不可用或不支持该模式，已跳过` : "";
      setMessage(copiedMode === "image-to-image"
        ? `配置已复制${availabilityNote}${copy.referenceAssets?.length ? `；已添加 ${copy.referenceAssets.length} 张素材库原图` : "；请添加原图"}，再手动点击「查看预估并生成」`
        : `配置已复制${availabilityNote}，请手动点击「查看预估并生成」`);
    } catch {
      setMessage("复制的配置读取失败，请返回历史记录重试");
    }
  }, [catalog, modelCatalogReady]);

  useEffect(() => {
    if (!task || !["queued", "running"].includes(task.status)) return;
    const timer = setInterval(() => {
      fetch(`/api/generations/${task.id}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => data?.task && setTask(data.task)).catch(() => undefined);
    }, 2500);
    return () => clearInterval(timer);
  }, [task?.id, task?.status]);

  useEffect(() => {
    const urls = images.map((image) => URL.createObjectURL(image));
    setImagePreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [images]);

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

  const inputCount = images.length + referenceAssets.length;
  const outputCount = useMemo(() => selected.reduce((sum, model) => sum + (counts[model] || 1), 0) * (mode === "image-to-image" ? inputCount : 1), [selected, counts, mode, inputCount]);
  const isRunning = loading || Boolean(task && ["queued", "running"].includes(task.status));
  const nameTokens = nameTemplate.match(/\{[^{}]+\}/g) || [];
  const allowedNameTokens = ["{标识}", "{日期}", "{模型}", "{员工姓名}", "{原名}"];
  const hasOneIdentifierToken = nameTokens.filter((token) => token === "{标识}").length === 1;
  const withoutKnownTokens = nameTemplate.replace(/\{标识\}|\{日期\}|\{模型\}|\{员工姓名\}|\{原名\}/g, "");
  const hasOnlyKnownTokens = nameTokens.every((token) => allowedNameTokens.includes(token)) && !/[{}]/.test(withoutKnownTokens) && (mode === "image-to-image" || !nameTemplate.includes("{原名}"));
  const nameTemplateValid = hasOneIdentifierToken && hasOnlyKnownTokens;
  const nameTemplateError = !hasOneIdentifierToken
    ? "命名模板必须且只能包含一次 {标识}"
      : !hasOnlyKnownTokens
      ? mode === "text-to-image" && nameTemplate.includes("{原名}") ? "{原名} 仅适用于图生图命名" : "命名模板包含不支持的通配符"
      : "";
  const missingPriceRates = availableModels.some((model) => {
    const pricing = (catalog[model.key]?.pricing || model.defaultPricing) as { currency: string; perImage: Record<string, string | number> };
    const size = nativeImageSize(model, Number(targetWidth) || 1024, Number(targetHeight) || 1024);
    const price = pricing.perImage?.[size] ?? pricing.perImage?.["1K"];
    return price != null && pricing.currency !== "CNY" && catalog[model.key]?.priceCnyPerImage?.[size] == null;
  });

  function switchMode(value: "text-to-image" | "image-to-image") {
    setMode(value);
    if (value === "text-to-image") { setImages([]); setReferenceAssets([]); if (fileRef.current) fileRef.current.value = ""; }
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

  function toggleTag(id: string) {
    setSelectedTagIds((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }

  function setFiles(files?: FileList | File[]) {
    if (!files?.length) return;
    const incoming = Array.from(files);
    const remaining = Math.max(0, 10 - referenceAssets.length - images.length);
    if (!remaining) { setMessage("一次最多添加 10 张原图"); return; }
    const accepted = incoming.slice(0, remaining);
    setImages((current) => [...current, ...accepted]);
    setMessage(incoming.length > remaining ? "一次最多添加 10 张原图，超出部分未添加" : "");
  }

  function removeImage(index: number) { setImages((current) => current.filter((_, itemIndex) => itemIndex !== index)); }
  function removeReference(id: string) { setReferenceAssets((current) => current.filter((asset) => asset.id !== id)); }

  async function createTag() {
    const name = newTagName.trim();
    if (!name) { setMessage("请输入分类标签名称"); return; }
    setSavingTag(true); setMessage("");
    try {
      const response = await fetch("/api/tags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const data = await response.json();
      if (response.status === 409) throw new Error("该分类标签已存在，请从下拉框中选择");
      if (!response.ok) throw new Error(data.error || "标签创建失败");
      setTags((items) => [data.tag, ...items.filter((tag) => tag.id !== data.tag.id)].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")));
      setSelectedTagIds((items) => items.includes(data.tag.id) ? items : [...items, data.tag.id]);
      setNewTagName("");
      setTagPickerOpen(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "标签创建失败"); }
    finally { setSavingTag(false); }
  }

  async function requestEstimate() {
    if (!nameTemplateValid) return;
    if (!prompt.trim() || !selected.length || (mode === "image-to-image" && inputCount < 1)) return;
    setEstimating(true); setMessage("");
    try {
      const response = await fetch("/api/generations/estimate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, prompt: prompt.trim(), inputCount: mode === "image-to-image" ? inputCount : 0, models: selected.map((key) => ({ modelKey: key, count: counts[key] || 1 })), settings: { aspectRatio, targetWidth: Number(targetWidth), targetHeight: Number(targetHeight) } }),
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
    form.set("tagIds", JSON.stringify(selectedTagIds));
    form.set("models", JSON.stringify(selected.map((key) => ({ modelKey: key, count: counts[key] || 1 }))));
    form.set("settings", JSON.stringify({ aspectRatio, targetWidth: Number(targetWidth), targetHeight: Number(targetHeight) }));
    form.set("confirmed", "true");
    images.forEach((image) => form.append("images", image));
    form.set("inputAssetIds", JSON.stringify(referenceAssets.map((asset) => asset.id)));
    try {
      const response = await fetch("/api/generations", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "提交失败");
      const statusResponse = await fetch(`/api/generations/${data.taskId}`, { cache: "no-store" });
      const statusData = statusResponse.ok ? await statusResponse.json() : null;
      const selectedTags = tags.filter((tag) => selectedTagIds.includes(tag.id));
      const created = statusData?.task || { id: data.taskId, status: data.status, name_template: nameTemplate.trim(), identifier: data.identifier, tag_id: selectedTags[0]?.id || null, tag_name: selectedTags[0]?.name || null, tags: selectedTags, runs: [] } as Task;
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
    <div className="studio-heading"><div><p className="eyebrow">IMAGE CREATION WORKSPACE</p><h1>把灵感，变成看得见的创意。</h1><p className="muted">描述你的想法，或上传一张图片开始创作。</p></div><button className="button button-quiet" onClick={() => { setTask(null); setPrompt(""); setReusedPromptPrefix(null); setSelectedTagIds([]); setNewTagName(""); setImages([]); setReferenceAssets([]); if (fileRef.current) fileRef.current.value = ""; }}><Plus size={16} /> 新建创作</button></div>
    <div className="mode-switch"><button onClick={() => switchMode("text-to-image")} className={mode === "text-to-image" ? "mode-option active" : "mode-option"}><span className="mode-icon"><WandSparkles size={16} /></span><span><b>文生图</b><small>从文字创造画面</small></span></button><button onClick={() => switchMode("image-to-image")} className={mode === "image-to-image" ? "mode-option active" : "mode-option"}><span className="mode-icon"><ImagePlus size={16} /></span><span><b>图生图</b><small>基于原图继续创作</small></span></button></div>
    <div className="studio-grid">
      <section className="prompt-panel card-surface">
        <div className="panel-title"><span className="step-number">01</span><div><h2>{mode === "text-to-image" ? "描述你想要的画面" : "上传图片并描述修改"}</h2><p>{mode === "text-to-image" ? "写下画面、风格和构图细节，越具体越好。" : "每张原图分别生成，可同时添加多张图片。"}</p></div></div>
        {mode === "image-to-image" && <div className={inputCount ? "upload-zone has-image" : "upload-zone"} onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setFiles(event.dataTransfer.files); }}>
          {inputCount ? <div className="upload-thumbnails">{images.map((image, index) => <div className="upload-thumb" key={`${image.name}-${image.size}-${index}`}><img src={imagePreviews[index]} alt={image.name} /><button type="button" aria-label={`移除 ${image.name}`} onClick={(event) => { event.stopPropagation(); removeImage(index); }}><X size={12} /></button><small title={image.name}>{image.name}</small></div>)}{referenceAssets.map((asset) => <div className="upload-thumb" key={`ref-${asset.id}`}><img src={`/api/assets/${asset.id}/thumbnail`} alt={asset.originalName} /><button type="button" aria-label={`移除 ${asset.originalName}`} onClick={(event) => { event.stopPropagation(); removeReference(asset.id); }}><X size={12} /></button><small title={asset.originalName}>{asset.originalName}</small></div>)}<span className="upload-add"><ImagePlus size={16} />继续添加</span></div> : <><span className="upload-icon"><ImagePlus size={20} /></span><b>点击或拖拽上传多张图片</b><small>支持 PNG、JPG、WebP，单张最大 10 MB，最多 10 张</small></>}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { setFiles(event.target.files || undefined); event.target.value = ""; }} />
          {inputCount > 0 && <small className="upload-count">已添加 {inputCount} / 10 张原图 · 每张原图分别调用所选模型</small>}
        </div>}
        <div className="prompt-box"><div className="prompt-box-top"><span><MessageSquareText size={14} /> 提示词</span><div className="prompt-top-actions"><span className="prompt-count">{prompt.length} / 18,000</span><button type="button" className="button button-quiet prompt-picker-button" onClick={openPromptPicker}><WandSparkles size={13} /> 历史提示词 · DeepSeek 重构</button></div></div><textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); setReusedPromptPrefix(null); }} placeholder={mode === "text-to-image" ? "例如：一只橘猫坐在复古咖啡馆的窗边，午后阳光洒进来，胶片摄影质感……" : "例如：保持人物和构图不变，把背景改成海边日落，增加柔和的金色逆光……"} maxLength={18000} /><div className="prompt-hints"><span><Sparkles size={13} /> 描述主体、环境、光线和风格</span><span>Enter 换行</span></div></div>
        <label className="task-name-field"><span>图片命名</span><input value={nameTemplate} onChange={(event) => setNameTemplate(event.target.value)} maxLength={120} aria-invalid={!nameTemplateValid} aria-describedby="name-template-help" /><small id="name-template-help">必须且只能包含一次 {"{标识}"}；可选通配符：{`{日期}`}（任务日期 YYYYMMDD）、{`{模型}`}（供应商模型 ID）、{`{员工姓名}`}。{mode === "image-to-image" ? <>图生图还可用 {`{原名}`}（原图文件名，不含扩展名）。</> : null}{"例如：创意-{日期}-{模型}-{员工姓名}-{标识}。"}</small>{!nameTemplateValid && <small className="task-name-error">{nameTemplateError}</small>}</label>
        <div className="category-field">
          <div className="category-picker"><span className="category-field-label">分类标签 <small>全体成员共享 · 可多选</small></span><button type="button" className="category-select-trigger" aria-expanded={tagPickerOpen} onClick={() => setTagPickerOpen((open) => !open)}><span>{selectedTagIds.length ? `已选 ${selectedTagIds.length} 个标签` : "搜索并选择已有标签"}</span><ChevronDown size={14} /></button>{tagPickerOpen && <div className="category-dropdown"><label className="category-dropdown-search"><Search size={13} /><input value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} placeholder="搜索标签" autoFocus /></label><div className="category-dropdown-list">{tags.filter((tag) => tag.name.toLocaleLowerCase().includes(tagSearch.trim().toLocaleLowerCase())).map((tag) => { const checked = selectedTagIds.includes(tag.id); return <button key={tag.id} type="button" className={checked ? "category-dropdown-option selected" : "category-dropdown-option"} aria-pressed={checked} onClick={() => toggleTag(tag.id)}><span className={checked ? "category-checkbox checked" : "category-checkbox"}>{checked && <Check size={10} />}</span>{tag.name}</button>; })}{!tags.length && <small className="category-tag-empty">还没有分类标签，可在右侧新建</small>}{tags.length > 0 && !tags.some((tag) => tag.name.toLocaleLowerCase().includes(tagSearch.trim().toLocaleLowerCase())) && <small className="category-tag-empty">没有匹配的标签</small>}</div></div>}<div className="category-selected-tags">{tags.filter((tag) => selectedTagIds.includes(tag.id)).map((tag) => <button type="button" key={tag.id} className="category-selected-tag" onClick={() => toggleTag(tag.id)} title={`移除 ${tag.name}`}>{tag.name}<X size={10} /></button>)}</div></div>
          <div className="category-field-create"><input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} maxLength={40} placeholder="新建公共标签" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createTag(); } }} /><button type="button" className="button button-quiet" onClick={() => void createTag()} disabled={savingTag}>{savingTag ? "保存中" : "创建并使用"}</button></div>
        </div>
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
            <span className={checked ? "model-check checked" : "model-check"}>{checked && <Check size={12} />}</span><span className={`provider-logo ${logo.className}`}>{logo.text}</span><span className="model-copy"><b>{model.name}</b><small>{model.provider === "bailian" ? "阿里云百炼" : model.provider === "gemini" ? "Google Gemini" : model.provider === "volcengine" ? "火山方舟" : "智谱 AI"} · {model.supportsTextToImage ? "文生图" : ""}{model.supportsTextToImage && model.supportsImageToImage ? " / " : ""}{model.supportsImageToImage ? "图生图" : "仅文生图"} · {priceLabel}</small></span><span className="model-ready"><i /> 可用</span>
            {checked && <div className="model-count" onClick={(event) => event.stopPropagation()}><button onClick={() => setCounts((state) => ({ ...state, [model.key]: Math.max(1, (state[model.key] || 1) - 1) }))}>−</button><span>{counts[model.key] || 1} 张</span><button disabled={(counts[model.key] || 1) >= model.maxImages} onClick={() => setCounts((state) => ({ ...state, [model.key]: Math.min(model.maxImages, (state[model.key] || 1) + 1) }))}>+</button></div>}
          </div>;
        })}{availableModels.length === 0 && <div className="model-empty">当前模式没有已启用的模型，请联系管理员配置 API 与模型。</div>}</div>
        {missingPriceRates && <p className="price-rate-note">美元模型需要在 API 配置中维护生效汇率；缺少汇率的型号会排在已换算价格之后。</p>}
        <div className="param-row"><label><span>画面比例</span><div className="select-wrap"><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{SHARED_ASPECT_RATIOS.map((ratio) => <option key={ratio}>{ratio}</option>)}</select><ChevronDown size={14} /></div></label><div className="dimension-fields"><span>目标尺寸</span><div><label><input aria-label="目标宽度" type="number" min={256} max={4096} step={1} value={targetWidth} onChange={(event) => setTargetWidth(event.target.value)} /><small>宽</small></label><b>×</b><label><input aria-label="目标高度" type="number" min={256} max={4096} step={1} value={targetHeight} onChange={(event) => setTargetHeight(event.target.value)} /><small>高</small></label><span>px</span></div></div></div>
        <p className="dimension-note"><Maximize2 size={12} /> 返回图片会按目标尺寸等比填充并裁切边缘，不拉伸变形。</p>
        <div className="run-footer"><div className="run-note"><Zap size={14} /><span>本次将调用 {selected.length} 个模型，共生成 {outputCount} 张图{mode === "image-to-image" ? `（${inputCount} 张原图 × 每张数量）` : ""}{reusedPromptPrefix ? ` · 延续前缀 ${reusedPromptPrefix}` : ""}</span></div><button className="button button-primary generate-button" disabled={!prompt.trim() || !nameTemplateValid || !selected.length || selected.some((key) => !catalog[key]?.enabled) || !Number(targetWidth) || !Number(targetHeight) || Number(targetWidth) < 256 || Number(targetWidth) > 4096 || Number(targetHeight) < 256 || Number(targetHeight) > 4096 || (mode === "image-to-image" && !inputCount) || isRunning || estimating} onClick={requestEstimate}>{estimating ? <><LoaderCircle className="spin" size={16} /> 正在估算</> : isRunning ? <><LoaderCircle className="spin" size={16} /> 正在生成</> : <><Sparkles size={15} /> 查看预估并生成 <ArrowRight size={15} /></>}</button></div>
        {message && <div className="inline-error">{message}</div>}
      </section>

      <section className="result-panel card-surface">
        <div className="result-panel-top"><div><p className="eyebrow">RESULT CANVAS</p><h2>{task ? "模型对比结果" : "创作画布"}</h2></div><div className="canvas-tools"><button className="canvas-tool active" title="选择"><MousePointer2 size={15} /></button><button className="canvas-tool" title="更多"><MoreHorizontal size={16} /></button></div></div>
        {!task && <div className="empty-canvas"><div className="canvas-grid" /><div className="empty-art"><div className="empty-art-frame"><div className="empty-art-sun" /><div className="empty-art-mountain mountain-one" /><div className="empty-art-mountain mountain-two" /><div className="empty-art-flower flower-one">✿</div><div className="empty-art-flower flower-two">✿</div><div className="empty-art-caption">A LITTLE IDEA<br /><b>GOES A LONG WAY</b></div></div><span className="float-chip chip-left"><Sparkles size={13} /> 灵感，正在酝酿</span><span className="float-chip chip-right"><span>✦</span> {availableModels.length} 个模型可选</span></div><h3>你的画布，等待第一张作品</h3><p>提交创作后，结果会在这里并排呈现。<br />每个模型独立显示进度与成本。</p><div className="canvas-shortcut"><span>试试从一个简单想法开始</span><button onClick={() => { setPrompt("一间被午后阳光照亮的复古咖啡馆，窗边一束鲜花，温柔的胶片色调，安静松弛的氛围"); setReusedPromptPrefix(null); }}>使用示例提示词 <ArrowRight size={13} /></button></div></div>}
        {task && <>{task.input_assets?.length ? <div className="reference-preview"><span>原图（{task.input_assets.length} 张）</span>{task.input_assets.map((asset) => <img key={asset.id} src={asset.thumbnailUrl} alt={asset.originalName} title={asset.originalName} />)}</div> : null}<div className="comparison-results">{task.runs.length === 0 && <div className="waiting-runs"><LoaderCircle className="spin" size={20} /><b>已提交到生成队列</b><span>模型正在准备画面，请稍候…</span></div>}{task.runs.map((run) => { const model = MODELS.find((item) => item.key === run.modelKey); const logo = providerLogo(run.provider); const source = task.input_assets?.find((asset) => asset.id === run.inputAssetId); const completed = run.status === "succeeded" || run.status === "partial"; return <article key={run.id} className="result-card"><div className="result-card-head"><div className={`provider-logo ${logo.className}`}>{logo.text}</div><div><b>{model?.name || run.modelId}</b><small>{source ? `原图：${source.originalName} · ` : ""}{run.status === "succeeded" ? "生成完成" : run.status === "partial" ? "部分完成" : run.status === "failed" ? "生成失败" : run.status === "unknown" ? "状态待核实" : "正在生成…"}</small></div><span className={completed ? "run-state ok" : "run-state"}>{completed ? <Check size={13} /> : <LoaderCircle className="spin" size={13} />}</span></div>
            {run.outputs?.length ? <div className="result-images">{run.outputs.map((output) => <figure key={output.id}><img src={output.url} alt={`${model?.name}生成的作品`} /><a href={`${output.url}?download=1`} download className="image-download"><ArrowDownToLine size={15} /></a></figure>)}</div> : <div className={run.status === "failed" || run.status === "unknown" || run.status === "partial" ? "result-placeholder failed" : "result-placeholder"}>{run.status === "failed" ? <span>{run.errorMessage || "生成失败"}</span> : run.status === "unknown" ? <span>{run.errorMessage || "请先核对供应商记录"}</span> : run.status === "partial" ? <span>{run.errorMessage || "模型仅返回部分图片"}</span> : <><LoaderCircle className="spin" size={18} /><span>正在为你生成画面</span></>}</div>}
            <div className="result-card-foot"><span><Clock3 size={13} /> {run.status === "succeeded" || run.status === "partial" ? `${run.imageCount} 张图片${run.status === "partial" ? " · 部分完成" : ""} · ${run.startedAt && run.finishedAt ? `${Math.max(1, Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000))} 秒` : "已完成"}` : "等待结果"}</span><span className="cost-tag">{run.estimatedCost ? `估算 ${run.estimatedCost} ${run.currency}` : "成本待配置"}</span></div>
          </article>; })}</div></>}
        {task && <div className="result-bottom-note"><span>提示词前缀 · {task.identifier || "旧记录"}{task.tags?.length ? `　分类 · ${task.tags.map((tag) => tag.name).join("、")}` : task.tag_name ? `　分类 · ${task.tag_name}` : ""}</span><span>结果文件名包含每张素材的完整 8 位编号</span></div>}
      </section>
    </div>
    <section className="recent-section"><div className="recent-heading"><div><p className="eyebrow">RECENT CREATIONS</p><h2>最近创作</h2></div><a href="/history">查看全部 <ArrowRight size={14} /></a></div><div className="recent-grid">{recent.length ? recent.slice(0, 4).map((item) => <a key={item.id} href="/history" className="recent-tile">{item.runs?.flatMap((run) => run.outputs || []).slice(0, 1).map((output) => <img key={output.id} src={output.url} alt="最近创作" />)}<div><b>{item.status === "succeeded" ? "已完成创作" : item.status === "failed" ? "生成未完成" : "创作进行中"}</b><small>{new Date(item.created_at || Date.now()).toLocaleDateString("zh-CN")}</small></div></a>) : <div className="recent-empty"><Clock3 size={16} /><span>你的近期作品会显示在这里</span></div>}</div></section>
    <div className="studio-tip"><span><Sparkles size={14} /> 创作提示</span><p>试着把「主体 + 场景 + 光线 + 风格」写进提示词，让模型更准确地捕捉你的想法。</p><button onClick={() => { setPrompt("主体：一只白色小狗；场景：春日花园；光线：清晨柔和的自然光；风格：温暖、细腻的胶片摄影"); setReusedPromptPrefix(null); }}>写个好提示词 <ArrowRight size={13} /></button></div>

    {estimateOpen && estimate && <div className="dialog-overlay" onClick={() => setEstimateOpen(false)}><section className="dialog-card estimate-dialog" role="dialog" aria-modal="true" aria-labelledby="estimate-title" onClick={(event) => event.stopPropagation()}>
      <div className="dialog-head"><div><span className="dialog-icon"><Zap size={16} /></span><div><h2 id="estimate-title">确认本次预估成本</h2><p>确认后才会调用所选模型；价格以供应商实际计费为准。</p></div></div><button className="icon-button" aria-label="关闭" onClick={() => setEstimateOpen(false)}><X size={17} /></button></div>
      <div className="estimate-settings"><span>{mode === "text-to-image" ? "文生图" : `图生图 · ${inputCount} 张原图`}</span><span>{aspectRatio}</span><span>{targetWidth} × {targetHeight} px</span><span>{outputCount} 张结果</span></div>
      <div className="estimate-lines">{estimate.lines.map((line) => { const model = MODELS.find((item) => item.key === line.modelKey); const logo = providerLogo(model?.provider || ""); return <div className="estimate-line" key={line.modelKey}><span className={`provider-logo ${logo.className}`}>{logo.text}</span><span className="estimate-model"><b>{line.modelName}</b><small>{mode === "image-to-image" ? `${line.inputCount} 张原图 × 每张 ${line.countPerInput} 张 = ` : ""}{line.count} 张 · 模型输入规格 {line.nativeImageSize}</small></span><span className="estimate-price"><b>{formatAmount(line.estimatedCost)} {line.currency}</b><small>{line.estimatedCostCny ? `约 ¥${formatAmount(line.estimatedCostCny)}` : "单项预估"}</small></span></div>; })}</div>
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
