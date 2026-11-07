import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdapter, estimateCost, qwenSize } from "@/server/providers";

const pngData = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("Qwen Image adapter", () => {
  it("sends a text-to-image request and saves the returned data image", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      request_id: "qwen-request-1",
      output: { choices: [{ message: { content: [{ image: `data:image/png;base64,${pngData}` }] } }] },
      usage: { output_width: 1024, output_height: 1024, output_image_count: 1 },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createAdapter("bailian", "secret-key", "https://workspace.cn-beijing.maas.aliyuncs.com");
    const result = await adapter.generateTextToImage({ prompt: "测试画面", count: 1, aspectRatio: "1:1", imageSize: "1K" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/services/aigc/multimodal-generation/generation");
    expect(new Headers(request.headers).get("authorization")).toBe("Bearer secret-key");
    expect(JSON.parse(String(request.body))).toMatchObject({ model: "qwen-image-3.0-pro", parameters: { n: 1, size: "1024*1024" } });
    expect(result.requestId).toBe("qwen-request-1");
    expect(result.outputs[0].bytes).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });

  it("includes a single reference image for image editing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ output: { choices: [{ message: { content: [{ image: `data:image/png;base64,${pngData}` }] } }] }, usage: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createAdapter("bailian", "secret-key", "https://workspace.cn-beijing.maas.aliyuncs.com");
    await adapter.editImage({ prompt: "修改背景", count: 1, aspectRatio: "4:3", imageSize: "2K", image: Buffer.from("reference"), mediaType: "image/png" });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.input.messages[0].content).toHaveLength(2);
    expect(body.input.messages[0].content[0].image).toBe(`data:image/png;base64,${Buffer.from("reference").toString("base64")}`);
    expect(body.input.messages[0].content[1].text).toBe("修改背景");
  });
});

describe("Gemini Image adapter", () => {
  it("uses the configured model ID and stores inline image output", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      responseId: "gemini-request-1",
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: pngData } }] } }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 5 },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createAdapter("gemini", "secret-key", "https://generativelanguage.googleapis.com/v1beta", { modelId: "gemini-test-image" });
    const result = await adapter.generateTextToImage({ prompt: "一张插画", count: 1, aspectRatio: "16:9", imageSize: "2K" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/gemini-test-image:generateContent");
    expect(new Headers(request.headers).get("x-goog-api-key")).toBe("secret-key");
    expect(JSON.parse(String(request.body)).generationConfig.imageConfig).toEqual({ aspectRatio: "16:9", imageSize: "2K" });
    expect(result.outputs[0].bytes).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(result.usage.outputTokens).toBe(5);
  });
});

describe("shared model cost helpers", () => {
  it("calculates supported Qwen dimensions and preserves the price currency", () => {
    expect(qwenSize("16:9", "1K")).toBe("1024*576");
    expect(qwenSize("9:16", "2K")).toBe("1152*2048");
    expect(estimateCost({ currency: "USD", perImage: { "1K": "0.04" } }, "1K", 3)).toEqual({ amount: "0.12000000", currency: "USD" });
    expect(estimateCost({}, "1K", 1)).toBeNull();
  });
});
