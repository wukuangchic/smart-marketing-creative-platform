import { decryptSecret } from "./crypto";
import { query } from "./db";
import { MODELS, nativeImageSize } from "./models";
import { readMedia, removeMedia, resizeGenerated, storeGenerated } from "./media";
import { createMaterialIdentifier, isPromptPrefix } from "./identifiers";
import { getBoss } from "./queue";
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
const SEEDREAM_RETRY_DELAY_SECONDS = 60;
const MAX_SEEDREAM_ATTEMPTS = 2;

function taskDateForFilename(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}${part("month")}${part("day")}`;
}

export async function runProviderRun(runId: string) {
  const runResult = await query<{
    run_id: string; task_id: string; provider: ProviderSlug; model_key: string; model_id: string;
    requested_count: number; sequence_start: number; mode: "text-to-image" | "image-to-image"; prompt: string; name_template: string | null; identifier: string | null; settings: { aspectRatio: string; imageSize: string; targetWidth?: number; targetHeight?: number };
    input_asset_id: string | null; creator_id: string; creator_name: string; created_at: Date | string;
  }>(
    `SELECT r.id AS run_id,r.task_id,r.provider,r.model_key,r.model_id,r.requested_count,r.sequence_start,
            t.mode,t.prompt,t.name_template,t.identifier,t.settings,COALESCE(r.input_asset_id,t.input_asset_id) AS input_asset_id,t.creator_id,t.created_at,u.display_name AS creator_name
     FROM provider_runs r JOIN generation_tasks t ON t.id=r.task_id JOIN users u ON u.id=t.creator_id WHERE r.id=$1`, [runId],
  );
  const run = runResult.rows[0];
  if (!run) return;
  const claimed = await query<{ attempt_count: number }>(
    "UPDATE provider_runs SET status='running',started_at=now(),finished_at=NULL,retry_due_at=NULL,attempt_count=attempt_count+1 WHERE id=$1 AND status='queued' RETURNING attempt_count",
    [runId],
  );
  if (!claimed.rowCount) return;
  const attemptNumber = Number(claimed.rows[0].attempt_count);
  const attemptStartedAt = new Date();
  await query("UPDATE generation_tasks SET status='running' WHERE id=$1", [run.task_id]);
  let apiKeyForRedaction = "";
  let providerCallStarted = false;
  let providerResponseReceived = false;
  try {
    const configResult = await query<{ enabled: boolean; endpoint: string | null; api_key_ciphertext: string | null; config: Record<string, unknown> }>(
      "SELECT enabled,endpoint,api_key_ciphertext,config FROM provider_configs WHERE provider=$1", [run.provider],
    );
    const config = configResult.rows[0];
    if (!config?.enabled || !config.api_key_ciphertext) throw new Error("管理员尚未配置此模型的 API 凭证");
    const model = MODELS.find((item) => item.key === run.model_key);
    if (!model) throw new Error("模型配置不存在");
    const targetWidth = run.settings.targetWidth || 1024;
    const targetHeight = run.settings.targetHeight || 1024;
    const providerImageSize = nativeImageSize(model, targetWidth, targetHeight);
    const apiKey = decryptSecret(config.api_key_ciphertext);
    apiKeyForRedaction = apiKey;
    const adapter = createAdapter(run.provider, run.model_id, apiKey, config.endpoint || "", config.config || {});
    let providerResult: ProviderResult;
    let sourceName = "";
    if (run.mode === "image-to-image" && run.input_asset_id) {
      const input = await query<{ relative_path: string; media_type: string; original_name: string }>("SELECT relative_path,media_type,original_name FROM media_assets WHERE id=$1", [run.input_asset_id]);
      if (!input.rows[0]) throw new Error("找不到图生图原图");
      sourceName = input.rows[0].original_name.replace(/\.[^.]+$/, "");
      const image = await readMedia(input.rows[0].relative_path);
      providerCallStarted = true;
      providerResult = await adapter.editImage({
        prompt: run.prompt, count: run.requested_count, aspectRatio: run.settings.aspectRatio || "1:1",
        imageSize: providerImageSize, image, mediaType: input.rows[0].media_type,
      });
    } else {
      providerCallStarted = true;
      providerResult = await adapter.generateTextToImage({
        prompt: run.prompt, count: run.requested_count, aspectRatio: run.settings.aspectRatio || "1:1",
        imageSize: providerImageSize,
      });
    }
    providerResponseReceived = true;
    if (run.settings.targetWidth && run.settings.targetHeight) {
      providerResult.outputs = await Promise.all(providerResult.outputs.map((output) =>
        resizeGenerated(output.bytes, output.mediaType, targetWidth, targetHeight),
      ));
      providerResult.usage.outputWidth = targetWidth;
      providerResult.usage.outputHeight = targetHeight;
    }
    for (const [index, output] of providerResult.outputs.entries()) {
      const newIdentifierFormat = isPromptPrefix(run.identifier || "");
      const outputIdentifier = newIdentifierFormat ? createMaterialIdentifier(run.identifier!, run.sequence_start + index) : null;
      let outputName: string;
      if (outputIdentifier) {
        const template = run.name_template || "{标识}";
        outputName = template
          .replaceAll("{标识}", outputIdentifier)
          .replaceAll("{日期}", taskDateForFilename(run.created_at))
          .replaceAll("{模型}", run.model_id)
          .replaceAll("{员工姓名}", run.creator_name)
          .replaceAll("{原名}", sourceName);
      } else {
        const sequence = String(run.sequence_start + index).padStart(3, "0");
        const template = run.name_template || "创意-{标识}-{序号}";
        outputName = template
          .replaceAll("{标识}", run.identifier || "legacy")
          .replaceAll("{序号}", sequence)
          .replaceAll("{日期}", taskDateForFilename(run.created_at))
          .replaceAll("{模型}", run.model_id)
          .replaceAll("{员工姓名}", run.creator_name)
          .replaceAll("{原名}", sourceName);
        if (!template.includes("{序号}")) outputName = `${outputName}-${sequence}`;
      }
      const asset = await storeGenerated(output.bytes, output.mediaType, run.creator_id, outputName);
      const client = await (await import("./db")).pool.connect();
      try {
        await client.query("BEGIN");
        const task = await client.query("SELECT id FROM generation_tasks WHERE id=$1 FOR UPDATE", [run.task_id]);
        if (!task.rowCount) throw new Error("此任务已由管理员删除");
        await client.query(
          `INSERT INTO media_assets(id,task_id,run_id,owner_id,kind,relative_path,media_type,size_bytes,sha256,original_name,identifier,width,height)
           VALUES ($1,$2,$3,$4,'output',$5,$6,$7,$8,$9,$10,$11,$12)`,
          [asset.id, run.task_id, runId, asset.ownerId, asset.relativePath, asset.mediaType, asset.size, asset.sha256, asset.originalName, outputIdentifier, output.width ?? null, output.height ?? null],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        await removeMedia(asset.relativePath).catch(() => undefined);
        throw error;
      } finally { client.release(); }
    }
    const pricingResult = await query<{ pricing: Record<string, unknown> }>("SELECT pricing FROM provider_models WHERE model_key=$1", [run.model_key]);
    const price = providerResult.outputs.length ? estimateCost(pricingResult.rows[0]?.pricing || {}, providerImageSize, providerResult.outputs.length) : null;
    const fx = price ? await query<{ rate_to_cny: string }>(
      "SELECT rate_to_cny FROM exchange_rates WHERE currency=$1 AND effective_date<=COALESCE((SELECT started_at::date FROM provider_runs WHERE id=$2),(SELECT created_at::date FROM provider_runs WHERE id=$2),current_date) ORDER BY effective_date DESC LIMIT 1", [price.currency, runId],
    ) : null;
    const cny = price && (price.currency === "CNY" || fx?.rows[0])
      ? (Number(price.amount) * Number(price.currency === "CNY" ? 1 : fx!.rows[0].rate_to_cny)).toFixed(8) : null;
    const runStatus = providerResult.outputs.length < run.requested_count ? "partial" : "succeeded";
    const partialMessage = runStatus === "partial" ? `模型请求 ${run.requested_count} 张，实际返回 ${providerResult.outputs.length} 张` : null;
    const retryCostWarning = attemptNumber > 1 ? "自动重试已成功，但首次调用计费状态未知，估算成本只包含本次成功结果，可能未计入首次调用。" : null;
    const completionMessage = [partialMessage, retryCostWarning].filter(Boolean).join("；") || null;
    const attemptRecord = {
      attempt: attemptNumber,
      status: runStatus,
      startedAt: attemptStartedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      requestId: providerResult.requestId || null,
      imageCount: providerResult.outputs.length,
      estimatedCost: price?.amount || null,
      currency: price?.currency || null,
    };
    await query(
      `UPDATE provider_runs SET status=$8,image_count=$2,request_id=$3,usage=$4,estimated_cost=$5,currency=$6,estimated_cost_cny=$7,error_message=$9,finished_at=now(),retry_due_at=NULL,
       attempt_history=attempt_history || jsonb_build_array($10::jsonb)
       WHERE id=$1`,
      [runId, providerResult.outputs.length, providerResult.requestId || null, JSON.stringify(providerResult.usage), price?.amount || null, price?.currency || null, cny, runStatus, completionMessage, JSON.stringify(attemptRecord)],
    );
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "图片生成失败";
    const message = (apiKeyForRedaction ? rawMessage.replaceAll(apiKeyForRedaction, "[REDACTED]") : rawMessage).slice(0, 700);
    const uncertain = providerCallStarted && !providerResponseReceived && ((error instanceof DOMException && error.name === "TimeoutError") || error instanceof TypeError);
    const details = providerErrorDetails(error);
    const attemptRecord = {
      attempt: attemptNumber,
      status: uncertain ? "unknown" : "failed",
      startedAt: attemptStartedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      errorName: details.name,
      errorCode: details.code,
      errorSyscall: details.syscall,
      errorMessage: message,
    };
    const isSeedream = run.provider === "volcengine" && run.model_id.startsWith("doubao-seedream-");
    console[uncertain ? "warn" : "error"]("[provider] generation run ended with an error", {
      runId, provider: run.provider, modelId: run.model_id, attempt: attemptNumber,
      uncertain, errorName: details.name, errorCode: details.code, errorSyscall: details.syscall,
    });
    if (uncertain && isSeedream && attemptNumber < MAX_SEEDREAM_ATTEMPTS) {
      await scheduleSeedreamRetry(runId, run.task_id, attemptRecord);
    } else {
      const finalError = uncertain && isSeedream
        ? `自动重试后调用结果仍未知；已达到重试上限，请核对火山方舟调用记录和账单。${details.code ? `（${details.code}${details.syscall ? `/${details.syscall}` : ""}）` : ""}`
        : uncertain
          ? `调用结果未知；请先核对供应商记录后再手动重试。${details.code ? `（${details.code}${details.syscall ? `/${details.syscall}` : ""}）` : ""}`
          : attemptNumber > 1
            ? `${message}；前次请求结果未知，可能已经计费，估算成本可能未包含首次调用。`
            : message;
      await finishRun(runId, uncertain ? "unknown" : "failed", { error: finalError, attempt: attemptRecord });
    }
  } finally {
    await refreshTaskStatus(run.task_id);
  }
}

async function finishRun(runId: string, status: "failed" | "unknown", options: { error: string; attempt: Record<string, unknown> }) {
  await query(
    "UPDATE provider_runs SET status=$2,error_message=$3,finished_at=now(),retry_due_at=NULL,attempt_history=attempt_history || jsonb_build_array($4::jsonb) WHERE id=$1",
    [runId, status, options.error, JSON.stringify(options.attempt)],
  );
}

async function scheduleSeedreamRetry(runId: string, taskId: string, attempt: Record<string, unknown>) {
  const retryAt = new Date(Date.now() + SEEDREAM_RETRY_DELAY_SECONDS * 1000);
  const message = `调用结果未知；系统将在约 ${SEEDREAM_RETRY_DELAY_SECONDS} 秒后自动重试一次。首次请求可能已经计费，成本统计可能暂未包含该次调用。`;
  const queued = await query<{ id: string }>(
    `UPDATE provider_runs SET status='queued',error_message=$3,finished_at=NULL,retry_due_at=$2,
       attempt_history=attempt_history || jsonb_build_array($4::jsonb)
     WHERE id=$1 AND status='running' RETURNING id`,
    [runId, retryAt, message, JSON.stringify(attempt)],
  );
  if (!queued.rowCount) return;
  try {
    await query("UPDATE generation_tasks SET status='running',finished_at=NULL WHERE id=$1", [taskId]);
    const boss = await getBoss();
    const jobId = await boss.send("generate-provider-run", { runId }, { startAfter: retryAt });
    if (!jobId) throw new Error("Delayed retry was not accepted by the queue");
    console.warn("[provider] Seedream retry scheduled", { runId, attempt: 2, delaySeconds: SEEDREAM_RETRY_DELAY_SECONDS });
  } catch (error) {
    const details = providerErrorDetails(error);
    const schedulingError = `自动重试未能进入任务队列，请稍后人工核对；首次请求可能已经计费。${details.code ? `（${details.code}${details.syscall ? `/${details.syscall}` : ""}）` : ""}`;
    const schedulingAttempt = { event: "retry_enqueue_failed", at: new Date().toISOString(), errorName: details.name, errorCode: details.code, errorSyscall: details.syscall };
    await query(
      `UPDATE provider_runs SET status='unknown',error_message=$2,finished_at=now(),retry_due_at=NULL,
         attempt_history=attempt_history || jsonb_build_array($3::jsonb)
       WHERE id=$1 AND status='queued'`,
      [runId, schedulingError, JSON.stringify(schedulingAttempt)],
    );
    console.error("[provider] Seedream retry enqueue failed", { runId, errorName: details.name, errorCode: details.code, errorSyscall: details.syscall });
  }
}

function providerErrorDetails(error: unknown) {
  let name = error instanceof Error ? error.name : "UnknownError";
  let code: string | undefined;
  let syscall: string | undefined;
  const visited = new Set<object>();
  const inspect = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || depth > 6 || visited.has(value)) return;
    visited.add(value);
    const record = value as Record<string, unknown>;
    if (typeof record.name === "string" && name === "UnknownError") name = record.name;
    if (!code && typeof record.code === "string" && /^[A-Z0-9_]{2,40}$/.test(record.code)) code = record.code;
    if (!syscall && typeof record.syscall === "string" && /^[a-z0-9_]{2,40}$/i.test(record.syscall)) syscall = record.syscall;
    inspect(record.cause, depth + 1);
    if (Array.isArray(record.errors)) for (const nested of record.errors.slice(0, 8)) inspect(nested, depth + 1);
  };
  inspect(error, 0);
  return { name, code, syscall };
}

export async function restoreSeedreamRetryQueue(boss: Awaited<ReturnType<typeof getBoss>>) {
  const recovered = await query<{ run_id: string; task_id: string; retry_due_at: Date | string }>(
    `UPDATE provider_runs SET status='queued',retry_due_at=now()+$1::int*interval '1 second',finished_at=NULL,
       error_message='工作进程在首次调用期间停止；系统将在约 60 秒后自动重试一次，首次请求可能已经计费。'
     WHERE provider='volcengine' AND model_id LIKE 'doubao-seedream-%' AND status='unknown' AND attempt_count=1
     RETURNING id AS run_id,task_id,retry_due_at`,
    [String(SEEDREAM_RETRY_DELAY_SECONDS)],
  );
  for (const taskId of new Set(recovered.rows.map((row) => row.task_id))) {
    await query("UPDATE generation_tasks SET status='running',finished_at=NULL WHERE id=$1", [taskId]);
  }
  const pending = await query<{ run_id: string; retry_due_at: Date | string }>(
    `SELECT id AS run_id,retry_due_at FROM provider_runs
     WHERE provider='volcengine' AND model_id LIKE 'doubao-seedream-%' AND status='queued' AND retry_due_at IS NOT NULL`,
  );
  let queuedCount = 0;
  for (const run of pending.rows) {
    const retryAt = new Date(run.retry_due_at);
    const jobId = await boss.send("generate-provider-run", { runId: run.run_id }, { startAfter: retryAt });
    if (jobId) queuedCount += 1;
  }
  return queuedCount;
}

async function refreshTaskStatus(taskId: string) {
  const result = await query<{ status: string; count: string }>("SELECT status,count(*) OVER() AS count FROM provider_runs WHERE task_id=$1", [taskId]);
  const statuses = result.rows.map((row) => row.status);
  const done = statuses.every((status) => ["succeeded", "partial", "failed", "unknown"].includes(status));
  if (!done) return;
  const successCount = statuses.filter((status) => status === "succeeded").length;
  const taskStatus = successCount === statuses.length ? "succeeded" : successCount > 0 || statuses.includes("partial") ? "partial" : statuses.includes("unknown") ? "unknown" : "failed";
  await query("UPDATE generation_tasks SET status=$2,finished_at=now() WHERE id=$1", [taskId, taskStatus]);
}

export async function recoverInterruptedRuns() {
  const interrupted = await query<{ run_id: string; task_id: string }>(
    `UPDATE provider_runs SET status='unknown',error_message='工作进程在任务执行中停止，供应商是否已计费未知；请先核对供应商记录',finished_at=now(),
       attempt_history=attempt_history || jsonb_build_array(jsonb_build_object('attempt',attempt_count,'status','unknown','errorName','WorkerInterrupted','errorMessage','工作进程在任务执行中停止','finishedAt',now()))
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
  if (provider === "volcengine") return new VolcengineAdapter(apiKey, endpoint || "https://ark.cn-beijing.volces.com/api/v3", modelId);
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

class VolcengineAdapter implements ProviderAdapter {
  constructor(private apiKey: string, private endpoint: string, private modelId: string) {}
  generateTextToImage(input: Parameters<ProviderAdapter["generateTextToImage"]>[0]) {
    return this.call({ ...input, image: null, mediaType: null });
  }
  editImage(input: Parameters<ProviderAdapter["editImage"]>[0]) {
    return this.call({ ...input, image: input.image, mediaType: input.mediaType });
  }

  private async call(input: ImageInput): Promise<ProviderResult> {
    const endpoint = this.endpoint.replace(/\/$/, "").replace(/\/images\/generations$/, "");
    const modelSupportsSequence = ["doubao-seedream-5-0-260128", "doubao-seedream-5-0-lite-260128", "doubao-seedream-4-5-251128", "doubao-seedream-4-0-250828"].includes(this.modelId);
    const prompt = `${input.prompt}\n画面宽高比为 ${input.aspectRatio}。`;
    const body: Record<string, unknown> = {
      model: this.modelId,
      prompt,
      size: volcengineSize(this.modelId, input.imageSize),
      response_format: "b64_json",
      watermark: false,
    };
    if (input.image) body.image = `data:${input.mediaType};base64,${input.image.toString("base64")}`;
    if (modelSupportsSequence) {
      body.sequential_image_generation = input.count > 1 ? "auto" : "disabled";
      if (input.count > 1) body.sequential_image_generation_options = { max_images: input.count };
    }

    const response = await fetch(`${endpoint}/images/generations`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
      cache: "no-store",
    });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(providerMessage(result, response.status));
    const data = Array.isArray(result.data) ? result.data as Array<Record<string, unknown>> : [];
    const outputs: ImageOutput[] = [];
    const itemErrors: string[] = [];
    for (const item of data) {
      if (item.error && typeof item.error === "object") {
        itemErrors.push(providerMessage(item.error as Record<string, unknown>, 502));
        continue;
      }
      const encoded = stringValue(item.b64_json);
      const url = stringValue(item.url);
      if (encoded) {
        const format = stringValue(item.output_format)?.toLowerCase();
        outputs.push({
          bytes: Buffer.from(encoded, "base64"),
          mediaType: format === "png" ? "image/png" : "image/jpeg",
          ...parseImageDimensions(item.size),
        });
      } else if (url) {
        outputs.push(await downloadRemoteImage(url, ["volces.com", "volcengine.com"]));
      }
    }
    if (!outputs.length) throw new Error(itemErrors[0] || "火山方舟返回结果中没有可保存的图像");
    const usage = (result.usage && typeof result.usage === "object" ? result.usage : {}) as Record<string, unknown>;
    return {
      outputs,
      requestId: stringValue(result.id) || stringValue(result.request_id),
      usage: {
        requestId: stringValue(result.id) || stringValue(result.request_id),
        imageCount: numberValue(usage.generated_images) ?? outputs.length,
        outputTokens: numberValue(usage.output_tokens),
        raw: usage,
      },
    };
  }
}

function volcengineSize(modelId: string, requested: string) {
  if (modelId === "doubao-seedream-5-0-260128" || modelId === "doubao-seedream-5-0-lite-260128" || modelId === "doubao-seedream-4-5-251128") return "2K";
  return requested === "2K" ? "2K" : "1K";
}

function parseImageDimensions(value: unknown) {
  if (typeof value !== "string") return {};
  const match = /^(\d+)[x×](\d+)$/.exec(value);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : {};
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
