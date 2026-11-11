import type { ProviderConfigSlug, ProviderSlug } from "./types";

export const PROVIDERS: Record<ProviderConfigSlug, { name: string; shortName: string; defaultEndpoint: string; currency: "CNY" | "USD" }> = {
  bailian: { name: "阿里云百炼", shortName: "百炼", defaultEndpoint: "https://dashscope.aliyuncs.com", currency: "CNY" },
  gemini: { name: "Google Gemini API", shortName: "Gemini", defaultEndpoint: "https://generativelanguage.googleapis.com/v1beta", currency: "USD" },
  zhipu: { name: "智谱 AI", shortName: "智谱", defaultEndpoint: "https://open.bigmodel.cn/api/paas/v4", currency: "CNY" },
  volcengine: { name: "火山方舟（豆包）", shortName: "豆包", defaultEndpoint: "https://ark.cn-beijing.volces.com/api/v3", currency: "CNY" },
  deepseek: { name: "DeepSeek API", shortName: "DeepSeek", defaultEndpoint: "https://api.deepseek.com", currency: "USD" },
};

const qwen = (key: string, modelId: string, name: string, perImage: Record<string, string>, maxImages = 6) => ({
  key, provider: "bailian" as const, modelId, name, maxImages, enabledByDefault: true,
  supportsTextToImage: true, supportsImageToImage: true,
  supportedSizes: ["1K", "2K"] as const,
  defaultPricing: { currency: "CNY", perImage },
});

const wan = (key: string, modelId: string, name: string, perImage: Record<string, string>, modes: { text: boolean; image: boolean }, maxImages = 4) => ({
  key, provider: "bailian" as const, modelId, name, maxImages, enabledByDefault: true,
  supportsTextToImage: modes.text, supportsImageToImage: modes.image,
  supportedSizes: ["1K", "2K"] as const,
  defaultPricing: { currency: "CNY", perImage },
});

const gemini = (key: string, modelId: string, name: string, perImage: Record<string, string>, supportedSizes: readonly ("1K" | "2K")[]) => ({
  key, provider: "gemini" as const, modelId, name, maxImages: 20, enabledByDefault: true,
  supportsTextToImage: true, supportsImageToImage: true,
  supportedSizes,
  defaultPricing: { currency: "USD", perImage },
});

/**
 * Stable and currently documented image-generation model IDs.
 * Reference prices are standard paid output prices for Beijing (Bailian),
 * Gemini API standard tier (USD), and Zhipu (CNY). See docs/model-pricing.md.
 */
export const MODELS = [
  qwen("bailian-qwen-image-3-pro", "qwen-image-3.0-pro", "Qwen Image 3.0 Pro", { "1K": "0.25", "2K": "0.50" }),
  qwen("bailian-qwen-image-3", "qwen-image-3.0", "Qwen Image 3.0", { "1K": "0.18", "2K": "0.18" }),
  qwen("bailian-qwen-image-21-pro", "qwen-image-2.1-pro", "Qwen Image 2.1 Pro", { "1K": "0.25", "2K": "0.25" }),
  qwen("bailian-qwen-image-21-turbo", "qwen-image-2.1-turbo", "Qwen Image 2.1 Turbo", { "1K": "0.10", "2K": "0.10" }),
  qwen("bailian-qwen-image-20-pro", "qwen-image-2.0-pro", "Qwen Image 2.0 Pro", { "1K": "0.50", "2K": "0.50" }),
  qwen("bailian-qwen-image-20-pro-20260622", "qwen-image-2.0-pro-2026-06-22", "Qwen Image 2.0 Pro · 2026-06-22", { "1K": "0.50", "2K": "0.50" }),
  qwen("bailian-qwen-image-20-pro-20260422", "qwen-image-2.0-pro-2026-04-22", "Qwen Image 2.0 Pro · 2026-04-22", { "1K": "0.50", "2K": "0.50" }),
  qwen("bailian-qwen-image-20-pro-20260303", "qwen-image-2.0-pro-2026-03-03", "Qwen Image 2.0 Pro · 2026-03-03", { "1K": "0.50", "2K": "0.50" }),
  qwen("bailian-qwen-image-20", "qwen-image-2.0", "Qwen Image 2.0", { "1K": "0.20", "2K": "0.20" }),
  qwen("bailian-qwen-image-20-20260303", "qwen-image-2.0-2026-03-03", "Qwen Image 2.0 · 2026-03-03", { "1K": "0.20", "2K": "0.20" }),
  wan("bailian-wan-image-27-pro", "wan2.7-image-pro", "Wan 2.7 Image Pro", { "1K": "0.50", "2K": "0.50" }, { text: true, image: true }),
  wan("bailian-wan-image-27", "wan2.7-image", "Wan 2.7 Image", { "1K": "0.20", "2K": "0.20" }, { text: true, image: true }),
  wan("bailian-wan-image-26-t2i", "wan2.6-t2i", "Wan 2.6 Text-to-Image", { "1K": "0.20", "2K": "0.20" }, { text: true, image: true }),
  wan("bailian-wan-image-26", "wan2.6-image", "Wan 2.6 Image", { "1K": "0.20", "2K": "0.20" }, { text: true, image: true }),
  wan("bailian-wan-image-25-t2i", "wan2.5-t2i-preview", "Wan 2.5 Text-to-Image Preview", { "1K": "0.20", "2K": "0.20" }, { text: true, image: false }),
  { key: "bailian-wan-image-25-i2i", provider: "bailian", modelId: "wan2.5-i2i-preview", name: "Wan 2.5 Image-to-Image Preview", maxImages: 4, enabledByDefault: true,
    supportsTextToImage: false, supportsImageToImage: true, maxPromptChars: 2000, supportedSizes: ["1K"] as const,
    defaultPricing: { currency: "CNY", perImage: { "1K": "0.20" } } },
  wan("bailian-wan-image-22-plus", "wan2.2-t2i-plus", "Wan 2.2 Text-to-Image Plus", { "1K": "0.20", "2K": "0.20" }, { text: true, image: false }),
  wan("bailian-wan-image-22-flash", "wan2.2-t2i-flash", "Wan 2.2 Text-to-Image Flash", { "1K": "0.14", "2K": "0.14" }, { text: true, image: false }),
  wan("bailian-wan-image-21-plus", "wanx2.1-t2i-plus", "Wan 2.1 Text-to-Image Plus", { "1K": "0.20", "2K": "0.20" }, { text: true, image: false }),
  wan("bailian-wan-image-21-turbo", "wanx2.1-t2i-turbo", "Wan 2.1 Text-to-Image Turbo", { "1K": "0.14", "2K": "0.14" }, { text: true, image: false }),
  wan("bailian-wan-image-20-turbo", "wanx2.0-t2i-turbo", "Wan 2.0 Text-to-Image Turbo", { "1K": "0.04", "2K": "0.04" }, { text: true, image: false }),
  { key: "bailian-wanx-imageedit-21", provider: "bailian", modelId: "wanx2.1-imageedit", name: "Wan 2.1 Image Edit (legacy)", maxImages: 1, enabledByDefault: true,
    supportsTextToImage: false, supportsImageToImage: true, supportedSizes: ["1K"] as const,
    defaultPricing: { currency: "CNY", perImage: { "1K": "0.14" } } },
  { key: "bailian-z-image-turbo", provider: "bailian", modelId: "z-image-turbo", name: "Z-Image Turbo", maxImages: 1, enabledByDefault: true,
    supportsTextToImage: true, supportsImageToImage: false, maxPromptChars: 800, supportedSizes: ["1K", "2K"] as const,
    defaultPricing: { currency: "CNY", perImage: { "1K": "0.10", "2K": "0.10" } } },
  gemini("gemini-3-pro-image", "gemini-3-pro-image", "Gemini 3 Pro Image", { "1K": "0.134", "2K": "0.134" }, ["1K", "2K"]),
  gemini("gemini-3-1-flash-image", "gemini-3.1-flash-image", "Gemini 3.1 Flash Image", { "1K": "0.067", "2K": "0.101" }, ["1K", "2K"]),
  gemini("gemini-3-1-flash-lite-image", "gemini-3.1-flash-lite-image", "Gemini 3.1 Flash Lite Image", { "1K": "0.0336" }, ["1K"]),
  { key: "gemini-2-5-flash-image", provider: "gemini", modelId: "gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image (deprecated)", maxImages: 1, enabledByDefault: true,
    supportsTextToImage: true, supportsImageToImage: true, supportedSizes: ["1K"] as const,
    defaultPricing: { currency: "USD", perImage: { "1K": "0.039" } } },
  { key: "zhipu-glm-image", provider: "zhipu", modelId: "glm-image", name: "GLM-Image", maxImages: 1, enabledByDefault: true,
    supportsTextToImage: true, supportsImageToImage: false, maxPromptChars: 1000, supportedSizes: ["1K", "2K"] as const,
    defaultPricing: { currency: "CNY", perImage: { "1K": "0.10", "2K": "0.10" } } },
  { key: "volcengine-seedream-5-pro", provider: "volcengine", modelId: "doubao-seedream-5-0-pro-260628", name: "Seedream 5.0 Pro", maxImages: 1, enabledByDefault: true,
    supportsTextToImage: true, supportsImageToImage: true, supportedSizes: ["1K", "2K"] as const,
    defaultPricing: { currency: "CNY", perImage: { "1K": "0.30", "2K": "0.60" } } },
  { key: "volcengine-seedream-5-flash", provider: "volcengine", modelId: "doubao-seedream-5-0-flash-260915", name: "Seedream 5.0 Flash", maxImages: 1, enabledByDefault: true,
    supportsTextToImage: true, supportsImageToImage: true, supportedSizes: ["1K", "2K"] as const,
    defaultPricing: { currency: "CNY", perImage: { "1K": "0.12", "2K": "0.12" } } },
  { key: "volcengine-seedream-5-lite", provider: "volcengine", modelId: "doubao-seedream-5-0-lite-260128", name: "Seedream 5.0 Lite", availabilityNote: "官方模型目录标注即将下线，默认停用", maxImages: 14, enabledByDefault: false,
    supportsTextToImage: true, supportsImageToImage: true, supportedSizes: ["2K"] as const,
    defaultPricing: { currency: "CNY", perImage: { "2K": "0.22" } } },
  { key: "volcengine-seedream-4-5", provider: "volcengine", modelId: "doubao-seedream-4-5-251128", name: "Seedream 4.5", availabilityNote: "官方模型目录标注即将下线，默认停用", maxImages: 14, enabledByDefault: false,
    supportsTextToImage: true, supportsImageToImage: true, supportedSizes: ["2K"] as const,
    defaultPricing: { currency: "CNY", perImage: { "2K": "0.25" } } },
  { key: "volcengine-seedream-4-0", provider: "volcengine", modelId: "doubao-seedream-4-0-250828", name: "Seedream 4.0", availabilityNote: "官方模型目录标注即将下线，默认停用", maxImages: 14, enabledByDefault: false,
    supportsTextToImage: true, supportsImageToImage: true, supportedSizes: ["1K", "2K"] as const,
    defaultPricing: { currency: "CNY", perImage: { "1K": "0.20", "2K": "0.20" } } },
] as const;

export const SHARED_ASPECT_RATIOS = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"] as const;
export const SHARED_IMAGE_SIZES = ["1K", "2K"] as const;

export type ModelKey = (typeof MODELS)[number]["key"];

export function getModel(key: string) {
  return MODELS.find((model) => model.key === key);
}

export function getProviderModels(provider: ProviderSlug) {
  return MODELS.filter((model) => model.provider === provider);
}

export function nativeImageSize(model: (typeof MODELS)[number], targetWidth: number, targetHeight: number): "1K" | "2K" {
  const requested = Math.max(targetWidth, targetHeight) > 1536 ? "2K" : "1K";
  const sizes = model.supportedSizes as readonly ("1K" | "2K")[];
  if (sizes.includes(requested)) return requested;
  return sizes.includes("1K") ? "1K" : "2K";
}
