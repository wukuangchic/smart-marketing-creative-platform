import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { encryptSecret } from "@/server/crypto";
import { pool, query } from "@/server/db";
import { MODELS, PROVIDERS } from "@/server/models";
import { jsonError, sameOrigin } from "@/server/http";

const priceField = z.string().max(32).refine((value) => value === "" || (/^\d+(\.\d{1,8})?$/.test(value) && Number.isFinite(Number(value)) && Number(value) >= 0), "价格必须为非负数字，最多 8 位小数");
const providerEnum = z.enum(["bailian", "gemini", "zhipu", "deepseek"]);
const bodySchema = z.object({
  provider: providerEnum,
  enabled: z.boolean(),
  endpoint: z.string().max(300).optional().default(""),
  apiKey: z.string().max(500).optional().default(""),
  models: z.array(z.object({
    modelKey: z.string(),
    enabled: z.boolean(),
    currency: z.enum(["CNY", "USD"]),
    perImage: z.object({ "1K": priceField, "2K": priceField }),
  })).optional().default([]),
});

export async function GET() {
  try {
    await requireAdmin();
    const result = await query<{
      provider: string; enabled: boolean; has_key: boolean; endpoint: string | null;
      model_key: string | null; model_id: string | null; display_name: string | null; model_enabled: boolean | null; max_images: number | null; pricing: Record<string, unknown> | null;
    }>(
      `SELECT p.provider,p.enabled,(p.api_key_ciphertext IS NOT NULL) AS has_key,p.endpoint,
              m.model_key,m.model_id,m.display_name,m.enabled AS model_enabled,m.max_images,m.pricing
       FROM provider_configs p LEFT JOIN provider_models m ON m.provider=p.provider ORDER BY p.provider,m.display_name`,
    );
    const providers = (Object.keys(PROVIDERS) as Array<keyof typeof PROVIDERS>).map((provider) => {
      const rows = result.rows.filter((row) => row.provider === provider);
      const config = rows[0];
      const models = MODELS.filter((model) => model.provider === provider).map((model) => {
        const row = rows.find((item) => item.model_key === model.key);
        return {
          model_key: model.key, model_id: row?.model_id || model.modelId, display_name: row?.display_name || model.name,
          enabled: row?.model_enabled ?? false, max_images: row?.max_images || model.maxImages,
          supports_text_to_image: model.supportsTextToImage, supports_image_to_image: model.supportsImageToImage,
          pricing: row?.pricing && Object.keys(row.pricing).length ? row.pricing : model.defaultPricing,
        };
      });
      return {
        provider, display_name: PROVIDERS[provider].name, short_name: PROVIDERS[provider].shortName,
        enabled: config?.enabled ?? false, has_key: config?.has_key ?? false,
        endpoint: config?.endpoint || PROVIDERS[provider].defaultEndpoint, models,
      };
    });
    return NextResponse.json({ providers, encryptionReady: /^[0-9a-fA-F]{64}$/.test(process.env.CREDENTIALS_ENCRYPTION_KEY || "") });
  } catch (error) { return jsonError(error); }
}

export async function PUT(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 });
    const admin = await requireAdmin();
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "配置无效" }, { status: 400 });
    const input = parsed.data;
    const endpoint = input.endpoint.trim().replace(/\/$/, "");
    if (endpoint) {
      let endpointUrl: URL;
      try { endpointUrl = new URL(endpoint); } catch { return NextResponse.json({ error: "API Endpoint 格式无效" }, { status: 400 }); }
      if (endpointUrl.protocol !== "https:" || endpointUrl.username || endpointUrl.password || endpointUrl.search || endpointUrl.hash) return NextResponse.json({ error: "API Endpoint 必须是 HTTPS URL，且不能在 URL 中携带凭证或查询参数" }, { status: 400 });
    }
    if (input.apiKey && !process.env.CREDENTIALS_ENCRYPTION_KEY) return NextResponse.json({ error: "服务器缺少凭证加密密钥，无法安全保存 API Key" }, { status: 503 });
    const allowed = new Set(MODELS.filter((model) => model.provider === input.provider).map((model) => model.key));
    if (input.models.some((model) => !allowed.has(model.modelKey))) return NextResponse.json({ error: "模型与供应商不匹配" }, { status: 400 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE provider_configs SET enabled=$2,endpoint=$3,api_key_ciphertext=COALESCE($4,api_key_ciphertext),updated_by=$5,updated_at=now() WHERE provider=$1`,
        [input.provider, input.enabled, endpoint || PROVIDERS[input.provider].defaultEndpoint, input.apiKey ? encryptSecret(input.apiKey) : null, admin.id],
      );
      for (const model of input.models) {
        const pricing = { currency: model.currency, perImage: Object.fromEntries(Object.entries(model.perImage).filter(([, value]) => value !== "")) };
        await client.query(
          "UPDATE provider_models SET enabled=$2,pricing=$3,updated_at=now() WHERE model_key=$1 AND provider=$4",
          [model.modelKey, model.enabled, JSON.stringify(pricing), input.provider],
        );
      }
      await client.query(
        "INSERT INTO audit_logs(actor_id,action,target_type,target_id,details) VALUES ($1,'provider.updated','provider',$2,$3)",
        [admin.id, input.provider, JSON.stringify({ enabled: input.enabled, endpoint, keyRotated: Boolean(input.apiKey), modelCount: input.models.length })],
      );
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return NextResponse.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
