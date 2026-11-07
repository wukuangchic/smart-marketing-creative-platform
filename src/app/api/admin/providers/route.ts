import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { encryptSecret } from "@/server/crypto";
import { query } from "@/server/db";
import { MODELS } from "@/server/models";
import { jsonError, sameOrigin } from "@/server/http";

const priceField = z.string().max(32).refine((value) => value === "" || (/^\d+(\.\d{1,8})?$/.test(value) && Number.isFinite(Number(value)) && Number(value) >= 0), "价格必须为非负数字，最多 8 位小数");
const bodySchema = z.object({
  provider: z.enum(["bailian", "gemini"]), enabled: z.boolean(), endpoint: z.string().max(300).optional().default(""), apiKey: z.string().max(500).optional().default(""),
  currency: z.enum(["CNY", "USD", "SGD", "EUR"]).default("CNY"), price1K: priceField.optional().default(""), price2K: priceField.optional().default(""), modelId: z.string().max(120).optional(),
});

export async function GET() {
  try {
    await requireAdmin();
    const result = await query(
      `SELECT p.provider,p.enabled,CASE WHEN p.api_key_ciphertext IS NULL THEN false ELSE true END AS has_key,
              p.endpoint,p.config,m.model_key,m.model_id,m.display_name,m.enabled AS model_enabled,m.max_images,m.pricing
       FROM provider_configs p LEFT JOIN provider_models m ON m.provider=p.provider ORDER BY p.provider`,
    );
    return NextResponse.json({ providers: result.rows, encryptionReady: /^[0-9a-fA-F]{64}$/.test(process.env.CREDENTIALS_ENCRYPTION_KEY || "") });
  } catch (error) { return jsonError(error); }
}

export async function PUT(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 });
    const admin = await requireAdmin();
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "配置无效" }, { status: 400 });
    const input = parsed.data;
    const model = MODELS.find((item) => item.provider === input.provider)!;
    const endpoint = input.endpoint.trim().replace(/\/$/, "");
    if (endpoint) {
      let endpointUrl: URL;
      try { endpointUrl = new URL(endpoint); } catch { return NextResponse.json({ error: "API Endpoint 格式无效" }, { status: 400 }); }
      if (endpointUrl.protocol !== "https:" || endpointUrl.username || endpointUrl.password || endpointUrl.search || endpointUrl.hash) return NextResponse.json({ error: "API Endpoint 必须是 HTTPS URL，且不能在 URL 中携带凭证或查询参数" }, { status: 400 });
    }
    if (input.apiKey && !process.env.CREDENTIALS_ENCRYPTION_KEY) return NextResponse.json({ error: "服务器缺少凭证加密密钥，无法安全保存 API Key" }, { status: 503 });
    const pricing = {
      currency: input.currency,
      perImage: {
        ...(input.price1K ? { "1K": input.price1K } : {}),
        ...(input.price2K ? { "2K": input.price2K } : {}),
      },
    };
    const client = await (await import("@/server/db")).pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE provider_configs SET enabled=$2,endpoint=$3,api_key_ciphertext=COALESCE($4,api_key_ciphertext),updated_by=$5,updated_at=now() WHERE provider=$1`,
        [input.provider, input.enabled, endpoint || null, input.apiKey ? encryptSecret(input.apiKey) : null, admin.id],
      );
      await client.query("UPDATE provider_models SET enabled=$2,model_id=$3,pricing=$4,updated_at=now() WHERE model_key=$1", [model.key, input.enabled, input.modelId?.trim() || model.modelId, JSON.stringify(pricing)]);
      await client.query("INSERT INTO audit_logs(actor_id,action,target_type,target_id,details) VALUES ($1,'provider.updated','provider',$2,$3)", [admin.id, input.provider, JSON.stringify({ enabled: input.enabled, endpoint, keyRotated: Boolean(input.apiKey), modelId: input.modelId || model.modelId })]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return NextResponse.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
