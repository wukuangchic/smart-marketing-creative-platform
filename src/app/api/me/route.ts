import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { feishuConfigured } from "@/server/feishu";
import { storageStatus } from "@/server/media";

export async function GET() {
  const user = await currentUser();
  const setup: Record<string, unknown> = {
    feishuConfigured: feishuConfigured(),
    encryptionConfigured: /^[0-9a-fA-F]{64}$/.test(process.env.CREDENTIALS_ENCRYPTION_KEY || ""),
  };
  if (user) setup.storage = await storageStatus();
  return NextResponse.json({ user, setup }, { headers: { "Cache-Control": "no-store" } });
}
