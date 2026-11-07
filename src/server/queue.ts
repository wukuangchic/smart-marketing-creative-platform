import { PgBoss } from "pg-boss";

let boss: PgBoss | undefined;
export async function getBoss() {
  if (boss) return boss;
  boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: "pgboss" });
  await boss.start();
  await boss.createQueue("generate-provider-run", { retryLimit: 0, expireInSeconds: 720, deleteAfterSeconds: 86400 });
  return boss;
}
