import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getFaucetConfig } from "@/lib/config";
import * as schema from "@/lib/db/schema";

let cached: {
  client: Client;
  db: LibSQLDatabase<typeof schema>;
  migrated: boolean;
} | null = null;

/** Normalize file: URLs to absolute paths libsql accepts under Node. */
function resolveDatabaseUrl(url: string): string {
  if (!url.startsWith("file:")) return url;
  const raw = url.slice("file:".length);
  if (!raw || raw === ":memory:") return url;
  const abs = isAbsolute(raw)
    ? raw
    : resolve(/* turbopackIgnore: true */ process.cwd(), raw);
  mkdirSync(dirname(abs), { recursive: true });
  return pathToFileURL(abs).href;
}

export function getDb() {
  if (cached) return cached.db;

  const cfg = getFaucetConfig();
  const url = resolveDatabaseUrl(cfg.databaseUrl);

  const client = createClient({
    url,
    authToken: cfg.tursoAuthToken,
  });

  const db = drizzle(client, { schema });
  cached = { client, db, migrated: false };
  return db;
}

export async function ensureMigrated(): Promise<void> {
  if (cached?.migrated) return;

  if (!cached) {
    getDb();
  }

  const client = cached!.client;
  await client.execute(`
    CREATE TABLE IF NOT EXISTS faucet_claims (
      id TEXT PRIMARY KEY NOT NULL,
      faucet_slug TEXT NOT NULL,
      user_id TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL,
      tx_hash TEXT,
      ip_hash TEXT,
      user_agent_hash TEXT,
      claimed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await client.execute(
    `CREATE INDEX IF NOT EXISTS idx_claims_slug_status_at
     ON faucet_claims (faucet_slug, status, claimed_at)`,
  );
  await client.execute(
    `CREATE INDEX IF NOT EXISTS idx_claims_wallet_at
     ON faucet_claims (wallet_address, status, claimed_at)`,
  );
  await client.execute(
    `CREATE INDEX IF NOT EXISTS idx_claims_user_at
     ON faucet_claims (user_id, status, claimed_at)`,
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS faucet_pow_challenges (
      id TEXT PRIMARY KEY NOT NULL,
      wallet_address TEXT NOT NULL,
      difficulty INTEGER NOT NULL,
      prefix TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      ip_hash TEXT,
      created_at TEXT NOT NULL
    )
  `);
  await client.execute(
    `CREATE INDEX IF NOT EXISTS idx_pow_ip_created
     ON faucet_pow_challenges (ip_hash, created_at)`,
  );
  await client.execute(
    `CREATE INDEX IF NOT EXISTS idx_pow_wallet_created
     ON faucet_pow_challenges (wallet_address, created_at)`,
  );

  cached!.migrated = true;
}
