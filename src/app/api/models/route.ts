import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { MODELS } from "@/server/models";
import { jsonError } from "@/server/http";

export async function GET() {
  try {
    await requireUser();
    const [configured, rates] = await Promise.all([
      query<{
        model_key: string;
        enabled: boolean;
        pricing: Record<string, unknown> | null;
      }>(
        `SELECT m.model_key,
                (m.enabled AND p.enabled AND p.api_key_ciphertext IS NOT NULL) AS enabled,
                m.pricing
         FROM provider_models m JOIN provider_configs p ON p.provider=m.provider`,
      ),
      query<{ currency: string; rate_to_cny: string }>(
        `SELECT DISTINCT ON (currency) currency,rate_to_cny
         FROM exchange_rates WHERE effective_date<=CURRENT_DATE
         ORDER BY currency,effective_date DESC`,
      ),
    ]);
    const byKey = new Map(configured.rows.map((row) => [row.model_key, row]));
    const fx = new Map(rates.rows.map((row) => [row.currency, Number(row.rate_to_cny)]));
    return NextResponse.json({ models: MODELS.map((model) => {
      const row = byKey.get(model.key);
      const pricing = row?.pricing && Object.keys(row.pricing).length ? row.pricing : model.defaultPricing;
      const currency = typeof pricing.currency === "string" ? pricing.currency : model.defaultPricing.currency;
      const perImage = (pricing.perImage || {}) as Record<string, string | number>;
      const rate = currency === "CNY" ? 1 : fx.get(currency);
      const priceCnyPerImage = Object.fromEntries(["1K", "2K"].map((size) => {
        const value = Number(perImage[size]);
        return [size, Number.isFinite(value) && rate ? value * rate : null];
      }));
      return { ...model, enabled: row?.enabled === true, pricing, priceCnyPerImage };
    }) });
  } catch (error) { return jsonError(error); }
}
