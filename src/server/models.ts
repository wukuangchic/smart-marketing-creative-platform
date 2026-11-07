export const MODELS = [
  { key: "bailian-qwen-image-3-pro", provider: "bailian", modelId: "qwen-image-3.0-pro", name: "Qwen Image 3.0 Pro", maxImages: 6 },
  { key: "gemini-3-1-flash-image", provider: "gemini", modelId: "gemini-3.1-flash-image", name: "Gemini 3.1 Flash Image", maxImages: 1 },
] as const;

export const SHARED_ASPECT_RATIOS = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"] as const;
export const SHARED_IMAGE_SIZES = ["1K", "2K"] as const;

export type ModelKey = (typeof MODELS)[number]["key"];

export function getModel(key: string) {
  return MODELS.find((model) => model.key === key);
}
