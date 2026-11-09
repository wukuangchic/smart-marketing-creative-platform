import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { MODELS, SHARED_ASPECT_RATIOS, nativeImageSize } from "@/server/models";
import { estimateCost } from "@/server/providers";
import { jsonError, sameOrigin } from "@/server/http";

const schema = z.object({
  mode: z.enum(["text-to-image", "image-to-image"]),
  prompt: z.string().trim().min(1).max(18000),
  models: z.array(z.object({ modelKey: z.string(), count: z.coerce.number().int().min(1).max(20) })).min(1).max(MODELS.length),
  settings: z.object({
    aspectRatio: z.enum(SHARED_ASPECT_RATIOS),
    targetWidth: z.coerce.number().int().min(256).max(4096),
    targetHeight: z.coerce.number().int().min(256).max(4096),
  }),
});

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 });
    await requireUser();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "预估参数无效" }, { status: 400 });
    if (new Set(parsed.data.models.map((item) => item.modelKey)).size !== parsed.data.models.length) {
      return NextResponse.json({ error: "同一模型不能重复选择" }, { status: 400 });
    }
    const [configured, rates] = await Promise.all([
      query<{ model_key: string; enabled: boolean; pricing: Record<string, unknown> | null }>(
        `SELECT m.model_key,
                (m.enabled AND p.enabled AND p.api_key_ciphertext IS NOT NULL) AS enabled,
                m.pricing
         FROM provider_models m JOIN provider_configs p ON p.provider=m.provider
         WHERE m.model_key=ANY($1::text[])`,
        [parsed.data.models.map((item) => item.modelKey)],
      ),
      query<{ currency: string; rate_to_cny: string }>(
        `SELECT DISTINCT ON (currency) currency,rate_to_cny FROM exchange_rates
         WHERE effective_date<=CURRENT_DATE ORDER BY currency,effective_date DESC`,
      ),
    ]);
    const configByKey = new Map(configured.rows.map((row) => [row.model_key, row]));
    const fx = new Map(rates.rows.map((row) => [row.currency, Number(row.rate_to_cny)]));
    const lines: Array<{
      modelKey: string;
      modelName: string;
      provider: string;
      count: number;
      nativeImageSize: "1K" | "2K";
      estimatedCost: string;
      currency: string;
      estimatedCostCny: string | null;
    }> = [];
    for (const requested of parsed.data.models) {
      const model = MODELS.find((item) => item.key === requested.modelKey);
      const config = configByKey.get(requested.modelKey);
      if (!model || !config?.enabled) return NextResponse.json({ error: "所选模型已停用或未配置 API 凭证，请刷新后重试" }, { status: 409 });
      if (requested.count > model.maxImages) return NextResponse.json({ error: `${model.name} 单次最多生成 ${model.maxImages} 张` }, { status: 400 });
      if (parsed.data.mode === "text-to-image" && !model.supportsTextToImage) return NextResponse.json({ error: `${model.name} 不支持文生图` }, { status: 400 });
      if (parsed.data.mode === "image-to-image" && !model.supportsImageToImage) return NextResponse.json({ error: `${model.name} 不支持图生图` }, { status: 400 });
      if ("maxPromptChars" in model && model.maxPromptChars && parsed.data.prompt.length > model.maxPromptChars) return NextResponse.json({ error: `${model.name} 的提示词最多支持 ${model.maxPromptChars} 个字符` }, { status: 400 });
      const imageSize = nativeImageSize(model, parsed.data.settings.targetWidth, parsed.data.settings.targetHeight);
      const price = estimateCost(config.pricing && Object.keys(config.pricing).length ? config.pricing : model.defaultPricing, imageSize, requested.count);
      if (!price) return NextResponse.json({ error: `${model.name} 缺少 ${imageSize} 参考价格，请联系管理员补充` }, { status: 409 });
      const rate = price.currency === "CNY" ? 1 : fx.get(price.currency);
      const amountCny = rate ? (Number(price.amount) * rate).toFixed(8) : null;
      lines.push({
        modelKey: model.key,
        modelName: model.name,
        provider: model.provider,
        count: requested.count,
        nativeImageSize: imageSize,
        estimatedCost: price.amount,
        currency: price.currency,
        estimatedCostCny: amountCny,
      });
    }
    const totalsByCurrency = Object.fromEntries([...new Set(lines.map((line) => line.currency))].map((currency) => [
      currency,
      lines.filter((line) => line.currency === currency).reduce((total, line) => total + Number(line.estimatedCost), 0).toFixed(8),
    ]));
    const totalCny = lines.every((line) => line.estimatedCostCny !== null)
      ? lines.reduce((total, line) => total + Number(line.estimatedCostCny), 0).toFixed(8)
      : null;
    return NextResponse.json({ lines, totalsByCurrency, totalCny, currencyRatesAvailable: totalCny !== null });
  } catch (error) { return jsonError(error); }
}
