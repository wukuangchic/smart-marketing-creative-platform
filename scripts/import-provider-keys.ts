import { pool, query } from "../src/server/db.js";
import { encryptSecret } from "../src/server/crypto.js";

type ProviderKeyInput = Partial<Record<"bailian" | "gemini" | "zhipu" | "deepseek" | "volcengine", string>>;

async function readInput() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as ProviderKeyInput;
}

try {
  const values = await readInput();
  const entries = Object.entries(values).filter((entry): entry is ["bailian" | "gemini" | "zhipu" | "deepseek" | "volcengine", string] =>
    ["bailian", "gemini", "zhipu", "deepseek", "volcengine"].includes(entry[0]) && typeof entry[1] === "string" && entry[1].trim().length > 0,
  );
  if (entries.length === 0) throw new Error("No provider credentials were supplied");
  const administrator = await query<{ id: string }>("SELECT id FROM users WHERE role='admin' AND active=true ORDER BY created_at LIMIT 1");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [provider, key] of entries) {
      const result = await client.query(
        "UPDATE provider_configs SET enabled=true,api_key_ciphertext=$2,updated_by=$3,updated_at=now() WHERE provider=$1",
        [provider, encryptSecret(key.trim()), administrator.rows[0]?.id || null],
      );
      if (result.rowCount !== 1) throw new Error("Provider configuration is missing; run database migrations first");
      await client.query(
        "INSERT INTO audit_logs(actor_id,action,target_type,target_id,details) VALUES ($1,'provider.key_imported','provider',$2,$3)",
        [administrator.rows[0]?.id || null, provider, JSON.stringify({ source: "server-side encrypted import" })],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  console.log(`Encrypted and saved credentials for ${entries.length} providers.`);
} catch {
  console.error("Provider credential import failed. Check server encryption and provider configuration, then retry.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
