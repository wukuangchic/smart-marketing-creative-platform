import { decryptSecret } from "./crypto";
import { query } from "./db";
import { MODELS } from "./models";
import { readMedia, removeMedia, storeGenerated } from "./media";
import type { ProviderSlug } from "./types";

export interface ImageOutput {
  bytes: Buffer;
  mediaType: string;
  width?: number;
  height?: number;
}

export interface ProviderUsage {
  requestId?: string;
  imageCount: number;
  promptTokens?: number;
  outputTokens?: number;
  outputWidth?: number;
  outputHeight?: number;
  raw: Record<string, unknown>;
}

export interface ProviderResult {
  outputs: ImageOutput[];
  usage: ProviderUsage;
  requestId?: string;
}

export interface ProviderAdapter {
  generateTextToImage(input: { prompt: string; count: number; aspectRatio: string; imageSize: string }): Promise<ProviderResult>;
  editImage(input: { prompt: string; count: number; aspectRatio: string; imageSize: string; image: Buffer; mediaType: string }): Promise<ProviderResult>;
}

const MAX_GENERATED_BYTES = 30 * 1024 * 1024;

export async function runProviderRun(runId: string) {
  const runResult = await query<{
    run_id: string; task_id: string; provider: ProviderSlug; model_key: string; model_id: string;
    requested_count: number; mode: "text-to-image" | "image-to-image"; prompt: string; settings: { aspectRatio: string; imageSize: string };
    input_asset_id: string | null; creator_id: string;
  }>(
    `SELECT r.id AS run_id,r.task_id,r.provider,r.model_key,r.model_id,r.requested_count,
            t.mode,t.prompt,t.settings,t.input_asset_id,t.creator_id
     FROM provider_runs r JOIN generation_tasks t ON t.id=r.task_id WHERE r.id=$1`, [runId],
  );
  const run = runResult.rows[0];
  if (!run) return;
  const claimed = await query("UPDATE provider_runs SET status='running',started_at=now() WHERE id=$1 AND status='queued' RETURNING id", [runId]);
  if (!claimed.rowCount) return;
  await query("UPDATE generation_tasks SET status='running' WHERE id=$1", [run.task_id]);
  let apiKeyForRedaction = "";
  try {
    const configResult = await query<{ enabled: boolean; endpoint: string | null; api_key_ciphertext: string | null; config: Record<string, unknown> }>(
      "SELECT enabled,endpoint,api_key_ciphertext,config FROM provider_configs WHERE provider=$1", [run.provider],
    );
    const config = configResult.rows[0];
    if (!config?.enabled || !config.api_key_ciphertext) throw new Error("管理员尚未配置此模型的 API 凭证");
    const model = MODELS.find((item) => item.key === run.model_key);
    if (!model) throw new Error("模型配置不存在");
    const apiKey = decryptSecret(config.api_key_ciphertext);
    apiKeyForRedaction = apiKey;
    const adapter = createAdapter(run.provider, run.model_id, apiKey, config.endpoint || "", config.config || {});
    let providerResult: ProviderResult;
    if (run.mode === "image-to-image" && run.input_asset_id) {
      const input = await query<{ relative_path: string; media_type: string }>("SELECT relative_path,media_type FROM media_assets WHERE id=$1", [run.input_asset_id]);
      if (!input.rows[0]) throw new Error("找不到图生图原图");
      const image = await readMedia(input.rows[0].relative_path);
      providerResult = await adapter.editImage({
        prompt: run.prompt, count: run.requested_count, aspectRatio: run.settings.aspectRatio || "1:1",
        imageSize: run.settings.imageSize || "1K", image, mediaType: input.rows[0].media_type,
      });
    } else {
      providerResult = await adapter.generateTextToImage({
        prompt: run.prompt, count: run.requested_count, aspectRatio: run.settings.aspectRatio || "1:1",
        imageSize: run.settings.imageSize || "1K",
      });
    }
    for (const output of providerResult.outputs) {
      const asset = await storeGenerated(output.bytes, output.mediaType, run.creator_id);
      const client = await (await import("./db")).pool.connect();
      try {
        await client.query("BEGIN");
        const task = await client.query("SELECT id FROM generation_tasks WHERE id=$1 FOR UPDATE", [run.task_id]);
        if (!task.rowCount) throw new Error("此任务已由管理员删除");
        await client.query(
          `INSERT INTO media_assets(id,task_id,run_id,owner_id,kind,relative_path,media_type,size_bytes,sha256,original_name,width,height)
           VALUES ($1,$2,$3,$4,'output',$5,$6,$7,$8,$9,$10,$11)`,
          [asset.id, run.task_id, runId, asset.ownerId, asset.relativePath, asset.mediaType, asset.size, asset.sha256, asset.originalName, output.width ?? null, output.height ?? null],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        await removeMedia(asset.relativePath).catch(() => undefined);
        throw error;
      } finally { client.release(); }
    }
    const pricingResult = await query<{ pricing: Record<string, unknown> }>("SELECT pricing FROM provider_models WHERE model_key=$1", [run.model_key]);
    const price = estimateCost(pricingResult.rows[0]?.pricing || {}, run.settings.imageSize, providerResult.outputs.length);
    const fx = price ? await query<{ rate_to_cny: string }>(
      "SELECT rate_to_cny FROM exchange_rates WHERE currency=$1 AND effective_date<=COALESCE((SELECT started_at::date FROM provider_runs WHERE id=$2),(SELECT created_at::date FROM provider_runs WHERE id=$2),current_date) ORDER BY effective_date DESC LIMIT 1", [price.currency, runId],
    ) : null;
    const cny = price && (price.currency === "CNY" || fx?.rows[0])
      ? (Number(price.amount) * Number(price.currency === "CNY" ? 1 : fx!.rows[0].rate_to_cny)).toFixed(8) : null;
    await query(
      `UPDATE provider_runs SET status='succeeded',image_count=$2,request_id=$3,usage=$4,estimated_cost=$5,currency=$6,estimated_cost_cny=$7,finished_at=now()
       WHERE id=$1`,
      [runId, providerResult.outputs.length, providerResult.requestId || null, JSON.stringify(providerResult.usage), price?.amount || null, price?.currency || null, cny],
    );
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "图片生成失败";
    const message = (apiKeyForRedaction ? rawMessage.replaceAll(apiKeyForRedaction, "[REDACTED]") : rawMessage).slice(0, 700);
    const uncertain = (error instanceof DOMException && error.name === "TimeoutError") || error instanceof TypeError;
    await finishRun(runId, uncertain ? "unknown" : "failed", { error: uncertain ? "请求超时，供应商是否已计费未知；为避免重复费用，请先查询供应商记录" : message });
  } finally {
    await refreshTaskStatus(run.task_id);
  }
}

async function finishRun(runId: string, status: "failed" | "unknown", options: { error: string }) {
  await query("UPDATE provider_runs SET status=$2,error_message=$3,finished_at=now() WHERE id=$1", [runId, status, options.error]);
}

async function refreshTaskStatus(taskId: string) {
  const result = await query<{ status: string; count: string }>("SELECT status,count(*) OVER() AS count FROM provider_runs WHERE task_id=$1", [taskId]);
  const statuses = result.rows.map((row) => row.status);
  const done = statuses.every((status) => ["succeeded", "failed", "unknown"].includes(status));
  if (!done) return;
  const successCount = statuses.filter((status) => status === "succeeded").length;
  const taskStatus = successCount === statuses.length ? "succeeded" : successCount > 0 ? "partial" : statuses.includes("unknown") ? "unknown" : "failed";
  await query("UPDATE generation_tasks SET status=$2,finished_at=now() WHERE id=$1", [taskId, taskStatus]);
}

export async function recoverInterruptedRuns() {
  const interrupted = await query<{ run_id: string; task_id: string }>(
    `UPDATE provider_runs SET status='unknown',error_message='工作进程在任务执行中停止，供应商是否已计费未知；请先核对供应商记录',finished_at=now()
     WHERE status='running' RETURNING id AS run_id,task_id`,
  );
  for (const taskId of new Set(interrupted.rows.map((row) => row.task_id))) await refreshTaskStatus(taskId);
  return interrupted.rowCount || 0;
}

export function estimateCost(pricing: Record<string, unknown>, imageSize: string, count: number) {
  const bySize = pricing.perImage as Record<string, string> | undefined;
  const value = bySize?.[imageSize] ?? pricing.defaultPerImage as string | undefined;
  const currency = typeof pricing.currency === "string" ? pricing.currency : "";
  if (!value || !currency || !Number.isFinite(Number(value))) return null;
  return { amount: (Number(value) * count).toFixed(8), currency };
}

export function createAdapter(provider: ProviderSlug, modelId: string, apiKey: string, endpoint: string, config: Record<string, unknown> = {}): ProviderAdapter {
  if (provider === "bailian") return new BailianAdapter(apiKey, endpoint, modelId);
  if (provider === "gemini") return new GeminiAdapter(apiKey, endpoint || "https://generativelanguage.googleapis.com/v1beta", modelId);
  return new ZhipuAdapter(apiKey, endpoint || "https://open.bigmodel.cn/api/paas/v4", modelId);
}

type ImageInput = { prompt: string; count: number; aspectRatio: string; imageSize: string; image: Buffer | null; mediaType: string | null };

class BailianAdapter implements ProviderAdapter {
  constructor(private apiKey: string, private endpoint: string, private modelId: string) {}
  generateTextToImage(input: Parameters<ProviderAdapter["generateTextToImage"]>[0]) { return this.call({ ...input, image: null, mediaType: null }); }
  editImage(input: Parameters<ProviderAdapter["editImage"]>[0]) { return this.call({ ...input, image: input.image, mediaType: input.mediaType }); }

  private async call(input: ImageInput): Promise<ProviderResult> {
    const endpoint = (this.endpoint || "https://dashscope.aliyuncs.com").replace(/\/$/, "");
    if (this.modelId === "wan2.5-i2i-preview") return this.callAsyncWanEdit(endpoint, input, false);
    if (this.modelId === "wanx2.1-imageedit") return this.callAsyncWanEdit(endpoint, input, true);
    if (this.modelId.startsWith("wanx2.") || this.modelId === "wan2.5-t2i-preview" || this.modelId.startsWith("wan2.2-t2i-")) {
      if (input.image) throw new Error(`${this.modelId} 当前仅支持文生图`);
      return this.callAsyncWan(endpoint, input);
    }

    const content: Array<Record<string, string>> = [];
    if (input.image) content.push({ image: `data:${input.mediaType};base64,${input.image.toString("base64")}` });
    content.push({ text: input.prompt });
    const parameters: Record<string, unknown> = { size: qwenSize(input.aspectRatio, input.imageSize), watermark: false };
    if (this.modelId !== "z-image-turbo") parameters.n = input.count;
    if (this.modelId === "z-image-turbo") parameters.prompt_extend = false;
    else if (this.modelId.startsWith("qwen-image-3.0") || this.modelId.startsWith("qwen-image-2.0")) parameters.prompt_extend = true;
    const body = {
      model: this.modelId,
      input: { messages: [{ role: "user", content }] },
      parameters,
    };
    const response = await fetch(`${endpoint}/api/v1/services/aigc/multimodal-generation/generation`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(600_000), cache: "no-store",
    });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(providerMessage(result, response.status));
    return this.resultFromBody(result);
  }

  private async callAsyncWan(endpoint: string, input: ImageInput): Promise<ProviderResult> {
    const response = await fetch(`${endpoint}/api/v1/services/aigc/text2image/image-synthesis`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}`, "X-DashScope-Async": "enable" },
      body: JSON.stringify({ model: this.modelId, input: { prompt: input.prompt }, parameters: { n: input.count, size: qwenSize(input.aspectRatio, input.imageSize) } }),
      signal: AbortSignal.timeout(60_000), cache: "no-store",
    });
    let body = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(providerMessage(body, response.status));
    const initialOutput = body.output as Record<string, unknown> | undefined;
    const taskId = stringValue(initialOutput?.task_id) || stringValue(body.task_id);
    if (!taskId) return this.resultFromBody(body);
    const deadline = Date.now() + 9 * 60_000;
    while (true) {
      const current = body.output as Record<string, unknown> | undefined;
      const status = stringValue(current?.task_status) || stringValue(body.status) || "";
      if (status === "SUCCEEDED") break;
      if (["FAILED", "CANCELED", "UNKNOWN"].includes(status)) throw new Error(providerMessage(current || body, 502));
      if (Date.now() >= deadline) throw new DOMException("供应商异步任务轮询超时", "TimeoutError");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const poll = await fetch(`${endpoint}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
        headers: { authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(60_000), cache: "no-store",
      });
      body = await poll.json() as Record<string, unknown>;
      if (!poll.ok) throw new Error(providerMessage(body, poll.status));
    }
    return this.resultFromBody(body);
  }

  private async callAsyncWanEdit(endpoint: string, input: ImageInput, legacy: boolean): Promise<ProviderResult> {
    if (!input.image || !input.mediaType) throw new Error(`${this.modelId} 需要上传原图`);
    const imageData = `data:${input.mediaType};base64,${input.image.toString("base64")}`;
    const requestInput = legacy
      ? { function: "description_edit", prompt: input.prompt, base_image_url: imageData }
      : { prompt: input.prompt, images: [imageData] };
    const parameters: Record<string, unknown> = { n: input.count };
    if (!legacy) {
      parameters.size = wan25Size(input.aspectRatio);
      parameters.prompt_extend = true;
      parameters.watermark = false;
    }
    let body: Record<string, unknown>;
    const response = await fetch(`${endpoint}/api/v1/services/aigc/image2image/image-synthesis`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}`, "X-DashScope-Async": "enable" },
      body: JSON.stringify({ model: this.modelId, input: requestInput, parameters }),
      signal: AbortSignal.timeout(60_000), cache: "no-store",
    });
    body = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(providerMessage(body, response.status));
    const initialOutput = body.output as Record<string, unknown> | undefined;
    const taskId = stringValue(initialOutput?.task_id) || stringValue(body.task_id);
    if (!taskId) return this.resultFromBody(body);
    const deadline = Date.now() + 9 * 60_000;
    while (true) {
      const current = body.output as Record<string, unknown> | undefined;
      const status = stringValue(current?.task_status) || stringValue(body.status) || "";
      if (status === "SUCCEEDED") break;
      if (["FAILED", "CANCELED", "UNKNOWN"].includes(status)) throw new Error(providerMessage(current || body, 502));
      if (Date.now() >= deadline) throw new DOMException("供应商异步任务轮询超时", "TimeoutError");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const poll = await fetch(`${endpoint}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
        headers: { authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(60_000), cache: "no-store",
      });
      body = await poll.json() as Record<string, unknown>;
      if (!poll.ok) throw new Error(providerMessage(body, poll.status));
    }
    return this.resultFromBody(body);
  }

  private async resultFromBody(body: Record<string, unknown>): Promise<ProviderResult> {
    const output = body.output as Record<string, unknown> | undefined;
    const choices = output?.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    const parts = message?.content as Array<Record<string, unknown>> | undefined;
    const urls = parts?.map((part) => part.image).filter((value): value is string => typeof value === "string") || [];
    const taskResults = output?.results as Array<Record<string, unknown>> | undefined;
    const directData = body.data as Array<Record<string, unknown>> | undefined;
    const images = urls.length ? urls : taskResults?.map((item) => item.url).filter((value): value is string => typeof value === "string")
      || directData?.map((item) => item.url || item.b64_json).filter((value): value is string => typeof value === "string") || [];
    if (!images.length) throw new Error("百炼调用成功但响应中没有可保存的图像");
    const outputs: ImageOutput[] = [];
    for (const image of images) {
      if (image.startsWith("data:")) {
        const parsed = image.match(/^data:([^;]+);base64,(.+)$/);
        if (parsed) outputs.push({ bytes: Buffer.from(parsed[2], "base64"), mediaType: parsed[1] });
      } else if (/^https?:\/\//i.test(image)) {
        outputs.push(await downloadRemoteImage(image, ["aliyuncs.com", "aliyun.com"]));
      } else {
        outputs.push({ bytes: Buffer.from(image, "base64"), mediaType: "image/png" });
      }
    }
    const usage = body.usage as Record<string, unknown> | undefined;
    return {
      outputs: outputs.filter((item) => item.bytes.length > 0),
      requestId: stringValue(body.request_id) || stringValue(body.requestId),
      usage: {
        requestId: stringValue(body.request_id) || undefined, imageCount: outputs.length,
        outputWidth: numberValue(usage?.output_width), outputHeight: numberValue(usage?.output_height), raw: usage || {},
      },
    };
  }
}

class GeminiAdapter implements ProviderAdapter {
  constructor(private apiKey: string, private endpoint: string, private modelId: string) {}
  generateTextToImage(input: Parameters<ProviderAdapter["generateTextToImage"]>[0]) { return this.call({ ...input, image: null, mediaType: null }); }
  editImage(input: Parameters<ProviderAdapter["editImage"]>[0]) { return this.call({ ...input, image: input.image, mediaType: input.mediaType }); }
  private async call(input: ImageInput): Promise<ProviderResult> {
    const endpoint = this.endpoint.replace(/\/$/, "");
    const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
    if (input.image) parts.unshift({ inlineData: { mimeType: input.mediaType, data: input.image.toString("base64") } });
    const outputs: ImageOutput[] = [];
    let lastUsage: Record<string, unknown> = {};
    let requestId: string | undefined;
    for (let index = 0; index < input.count; index++) {
      const imageConfig: Record<string, string> = { aspectRatio: input.aspectRatio };
      if (this.modelId !== "gemini-2.5-flash-image") imageConfig.imageSize = input.imageSize;
      const response = await fetch(`${endpoint}/models/${encodeURIComponent(this.modelId)}:generateContent`, {
        method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig } }),
        signal: AbortSignal.timeout(600_000), cache: "no-store",
      });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(providerMessage(body, response.status));
      requestId = stringValue(body.responseId) || requestId;
      lastUsage = (body.usageMetadata as Record<string, unknown>) || lastUsage;
      const candidates = body.candidates as Array<Record<string, unknown>> | undefined;
      const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
      const resultParts = content?.parts as Array<Record<string, unknown>> | undefined;
      const inline = resultParts?.find((part) => part.inlineData || part.inline_data);
      const blob = (inline?.inlineData || inline?.inline_data) as { data?: string; mimeType?: string; mime_type?: string } | undefined;
      if (!blob?.data) throw new Error("Gemini 返回结果中没有图像");
      outputs.push({ bytes: Buffer.from(blob.data, "base64"), mediaType: blob.mimeType || blob.mime_type || "image/png" });
    }
    return {
      outputs, requestId,
      usage: { requestId, imageCount: outputs.length, promptTokens: numberValue(lastUsage.promptTokenCount), outputTokens: numberValue(lastUsage.candidatesTokenCount), raw: lastUsage },
    };
  }
}

class ZhipuAdapter implements ProviderAdapter {
  constructor(private apiKey: string, private endpoint: string, private modelId: string) {}
  generateTextToImage(input: Parameters<ProviderAdapter["generateTextToImage"]>[0]) { return this.call(input); }
  editImage(): Promise<ProviderResult> { return Promise.reject(new Error("GLM-Image 当前仅支持文生图")); }
  private async call(input: Parameters<ProviderAdapter["generateTextToImage"]>[0]): Promise<ProviderResult> {
    const endpoint = this.endpoint.replace(/\/$/, "").replace(/\/images\/generations$/, "");
    const response = await fetch(`${endpoint}/images/generations`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.modelId, prompt: input.prompt, size: glmSize(input.aspectRatio, input.imageSize), n: 1, response_format: "url" }),
      signal: AbortSignal.timeout(600_000), cache: "no-store",
    });
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(providerMessage(body, response.status));
    const data = body.data as Array<Record<string, unknown>> | undefined;
    const item = data?.[0];
    if (!item) throw new Error("智谱调用成功但响应中没有可保存的图像");
    const image = stringValue(item.url) || stringValue(item.b64_json);
    if (!image) throw new Error("智谱返回结果中没有图像地址");
    const output = image.startsWith("http")
      ? await downloadRemoteImage(image, ["bigmodel.cn", "bigmodel-file.com"])
      : { bytes: Buffer.from(image, "base64"), mediaType: "image/png" };
    return { outputs: [output], requestId: stringValue(body.id) || stringValue(body.request_id), usage: { imageCount: 1, raw: (body.usage as Record<string, unknown>) || {} } };
  }
}

async function downloadRemoteImage(url: string, allowedDomains: string[]): Promise<ImageOutput> {
  const imageUrl = new URL(url);
  const allowed = allowedDomains.some((domain) => imageUrl.hostname === domain || imageUrl.hostname.endsWith(`.${domain}`));
  if (imageUrl.protocol !== "https:" || imageUrl.username || imageUrl.password || !allowed) throw new Error("模型返回了不受支持的图片地址");
  const file = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000), cache: "no-store" });
  if (!file.ok) throw new Error("无法下载供应商返回的临时图片");
  const mediaType = file.headers.get("content-type")?.split(";")[0] || "image/png";
  const contentLength = Number(file.headers.get("content-length") || 0);
  if (contentLength > MAX_GENERATED_BYTES) throw new Error("模型返回的图片超过单文件保存容量");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_GENERATED_BYTES) throw new Error("模型返回的图片超过单文件保存容量");
  return { bytes, mediaType };
}

export function qwenSize(aspectRatio: string, imageSize: string) {
  const [a, b] = aspectRatio.split(":").map(Number);
  if (!a || !b) return "1024*1024";
  const maxSide = imageSize === "2K" ? 2048 : 1024;
  const width = a >= b ? maxSide : Math.round(maxSide * a / b);
  const height = b >= a ? maxSide : Math.round(maxSide * b / a);
  return `${width}*${height}`;
}

function wan25Size(aspectRatio: string) {
  const sizes: Record<string, string> = {
    "1:1": "1280*1280", "3:2": "1200*800", "2:3": "800*1200",
    "4:3": "1280*960", "3:4": "960*1280", "16:9": "1280*720", "9:16": "720*1280",
  };
  return sizes[aspectRatio] || "1280*1280";
}

export function glmSize(aspectRatio: string, imageSize: string) {
  const [a, b] = aspectRatio.split(":").map(Number);
  if (!a || !b) return imageSize === "2K" ? "2048x2048" : "1024x1024";
  const maxSide = imageSize === "2K" ? 2048 : 1024;
  const roundTo32 = (value: number) => Math.max(512, Math.min(2048, Math.round(value / 32) * 32));
  const width = roundTo32(a >= b ? maxSide : maxSide * a / b);
  const height = roundTo32(b >= a ? maxSide : maxSide * b / a);
  return `${width}x${height}`;
}

function providerMessage(body: Record<string, unknown>, status: number) {
  const error = body.error as Record<string, unknown> | undefined;
  return typeof error?.message === "string" ? error.message.slice(0, 500) : typeof body.message === "string" ? body.message.slice(0, 500) : `模型服务返回 HTTP ${status}`;
}
function stringValue(value: unknown) { return typeof value === "string" ? value : undefined; }
function numberValue(value: unknown) { return typeof value === "number" ? value : undefined; }
