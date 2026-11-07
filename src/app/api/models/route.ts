import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { MODELS } from "@/server/models";
import { jsonError } from "@/server/http";

export async function GET() {
  try {
    await requireUser();
    const configured = await query<{ model_key: string; enabled: boolean }>(
      `SELECT m.model_key,(m.enabled AND p.enabled AND p.api_key_ciphertext IS NOT NULL) AS enabled
       FROM provider_models m JOIN provider_configs p ON p.provider=m.provider`,
    );
    const byKey = new Map(configured.rows.map((row) => [row.model_key, row.enabled]));
    return NextResponse.json({ models: MODELS.map((model) => ({ ...model, enabled: byKey.get(model.key) === true })) });
  } catch (error) { return jsonError(error); }
}
