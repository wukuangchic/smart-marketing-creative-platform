import { pool } from "../src/server/db.js";
const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";

const schema = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feishu_open_id text UNIQUE NOT NULL,
  display_name text NOT NULL,
  avatar_url text,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS provider_configs (
  provider text PRIMARY KEY CHECK (provider IN ('bailian','gemini')),
  enabled boolean NOT NULL DEFAULT false,
  endpoint text,
  api_key_ciphertext text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS provider_models (
  model_key text PRIMARY KEY,
  provider text NOT NULL REFERENCES provider_configs(provider),
  model_id text NOT NULL,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  max_images integer NOT NULL DEFAULT 1 CHECK (max_images > 0 AND max_images <= 20),
  pricing jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS exchange_rates (
  currency text NOT NULL,
  effective_date date NOT NULL,
  rate_to_cny numeric(18,8) NOT NULL CHECK (rate_to_cny > 0),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(currency,effective_date)
);
INSERT INTO exchange_rates(currency,effective_date,rate_to_cny) VALUES ('CNY','2000-01-01',1) ON CONFLICT DO NOTHING;
INSERT INTO provider_configs(provider,enabled,config) VALUES ('bailian',false,'{}'),('gemini',false,'{}') ON CONFLICT DO NOTHING;
INSERT INTO provider_models(model_key,provider,model_id,display_name,max_images,pricing) VALUES
  ('bailian-qwen-image-3-pro','bailian','qwen-image-3.0-pro','Qwen Image 3.0 Pro',6,'{}'),
  ('gemini-3-1-flash-image','gemini','gemini-3.1-flash-image','Gemini 3.1 Flash Image',1,'{}')
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS generation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES users(id),
  mode text NOT NULL CHECK (mode IN ('text-to-image','image-to-image')),
  prompt text NOT NULL,
  input_asset_id uuid,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','partial','failed','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS generation_tasks_created_idx ON generation_tasks(created_at DESC);
CREATE TABLE IF NOT EXISTS provider_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES generation_tasks(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('bailian','gemini')),
  model_key text NOT NULL REFERENCES provider_models(model_key),
  model_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','unknown')),
  requested_count integer NOT NULL CHECK (requested_count > 0),
  image_count integer NOT NULL DEFAULT 0,
  request_id text,
  usage jsonb,
  estimated_cost numeric(18,8),
  currency text,
  estimated_cost_cny numeric(18,8),
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_runs_task_idx ON provider_runs(task_id);
CREATE TABLE IF NOT EXISTS media_assets (
  id uuid PRIMARY KEY,
  task_id uuid REFERENCES generation_tasks(id) ON DELETE CASCADE,
  run_id uuid REFERENCES provider_runs(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('input','output')),
  relative_path text NOT NULL UNIQUE,
  media_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  original_name text NOT NULL,
  width integer,
  height integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE generation_tasks DROP CONSTRAINT IF EXISTS generation_tasks_input_asset_id_fkey;
ALTER TABLE generation_tasks ADD CONSTRAINT generation_tasks_input_asset_id_fkey FOREIGN KEY (input_asset_id) REFERENCES media_assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS media_assets_task_idx ON media_assets(task_id);
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('bailian','gemini')),
  account_id text NOT NULL,
  model_id text,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  amount numeric(18,8) NOT NULL,
  currency text NOT NULL,
  usage_amount numeric(24,8),
  source_id text NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,account_id,source_id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
INSERT INTO schema_migrations(name) VALUES ('001_initial') ON CONFLICT DO NOTHING;
`;

try {
  await pool.query(schema);
  if (process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "1") {
    await pool.query(
      `INSERT INTO users(id,feishu_open_id,display_name,role) VALUES ($1,'dev-open-id','本地体验用户','admin') ON CONFLICT(id) DO NOTHING`,
      [DEV_USER_ID],
    );
  }
  console.log("Database schema is up to date.");
} finally {
  await pool.end();
}
