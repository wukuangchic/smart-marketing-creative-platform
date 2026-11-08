export type GenerationMode = "text-to-image" | "image-to-image";
export type TaskStatus = "queued" | "running" | "succeeded" | "partial" | "failed" | "unknown";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "unknown";
export type ProviderSlug = "bailian" | "gemini" | "zhipu";

export interface GenerationRequest {
  mode: GenerationMode;
  prompt: string;
  inputAssetId?: string;
  models: Array<{ modelKey: string; count: number }>;
  settings: {
    aspectRatio: string;
    imageSize: "1K" | "2K";
  };
}

export interface UsageRecord {
  provider: ProviderSlug;
  modelId: string;
  requestId?: string;
  promptTokens?: number;
  outputTokens?: number;
  outputWidth?: number;
  outputHeight?: number;
  imageCount: number;
  raw?: Record<string, unknown>;
}

export interface ProviderRun {
  id: string;
  provider: ProviderSlug;
  modelKey: string;
  modelId: string;
  status: RunStatus;
  requestedCount: number;
  imageCount: number;
  usage: UsageRecord | null;
  estimatedCost: string | null;
  currency: string | null;
  estimatedCostCny: string | null;
  errorMessage: string | null;
  outputs: Array<{ id: string; url: string; width: number | null; height: number | null }>;
}

export interface GenerationTask {
  id: string;
  creator: { id: string; name: string };
  mode: GenerationMode;
  prompt: string;
  status: TaskStatus;
  settings: GenerationRequest["settings"];
  createdAt: string;
  runs: ProviderRun[];
}

export interface InvoiceRecord {
  provider: ProviderSlug;
  accountId: string;
  modelId: string | null;
  periodStart: string;
  periodEnd: string;
  amount: string;
  currency: string;
  usageAmount: string | null;
  sourceId: string;
}
