import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { jsonError } from "@/server/http";
import { normalizePromptPrefix } from "@/server/identifiers";

export async function GET(request: Request) {
  try {
    await requireUser();
    const url = new URL(request.url);
    const search = (url.searchParams.get("search") || "").trim().slice(0, 160);
    const [prompts, deepseek] = await Promise.all([
      query<{ prompt: string; uses: number; latest_at: string; latest_identifier: string | null }>(
        `SELECT prompt,count(*)::int AS uses,max(created_at) AS latest_at,
                (array_agg(identifier ORDER BY created_at DESC))[1] AS latest_identifier
         FROM generation_tasks
         WHERE prompt<>'' AND ($1='' OR prompt ILIKE '%'||$1||'%')
         GROUP BY prompt ORDER BY max(created_at) DESC LIMIT 80`,
        [search],
      ),
      query<{ enabled: boolean }>(
        "SELECT enabled AND api_key_ciphertext IS NOT NULL AS enabled FROM provider_configs WHERE provider='deepseek'",
      ),
    ]);
    return NextResponse.json({
      prompts: prompts.rows.map(({ latest_identifier, ...entry }) => ({ ...entry, promptPrefix: normalizePromptPrefix(latest_identifier) })),
      deepseekAvailable: deepseek.rows[0]?.enabled === true,
    });
  } catch (error) { return jsonError(error); }
}
