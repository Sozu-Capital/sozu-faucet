import { createHash, randomUUID } from "node:crypto";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { softHash, clientIp } from "@/lib/auth";
import { getFaucetConfig, normalizeAddress } from "@/lib/config";
import { ensureMigrated, getDb } from "@/lib/db/client";
import { faucetPowChallenges } from "@/lib/db/schema";

export const POW_PREFIX = "sozu-faucet-v1";

export type PowChallengePublic = {
  challengeId: string;
  to: string;
  difficulty: number;
  prefix: string;
  expiresAt: string;
};

export type PowProof = {
  challengeId: string;
  nonce: string;
};

/** Count leading zero bits in a hex SHA-256 digest. */
export function leadingZeroBits(hexDigest: string): number {
  let bits = 0;
  for (const ch of hexDigest) {
    const n = Number.parseInt(ch, 16);
    if (!Number.isFinite(n)) return bits;
    if (n === 0) {
      bits += 4;
      continue;
    }
    if (n < 2) return bits + 3;
    if (n < 4) return bits + 2;
    if (n < 8) return bits + 1;
    return bits;
  }
  return bits;
}

export function powDigest(params: {
  prefix: string;
  challengeId: string;
  to: string;
  nonce: string;
}): string {
  const payload = `${params.prefix}:${params.challengeId}:${params.to}:${params.nonce}`;
  return createHash("sha256").update(payload).digest("hex");
}

export function verifyPowSolution(params: {
  prefix: string;
  challengeId: string;
  to: string;
  nonce: string;
  difficulty: number;
}): boolean {
  const digest = powDigest(params);
  return leadingZeroBits(digest) >= params.difficulty;
}

/** CPU solve loop (CLI / tests). Returns nonce string. */
export function solvePow(params: {
  prefix: string;
  challengeId: string;
  to: string;
  difficulty: number;
  onProgress?: (attempts: number) => void;
}): string {
  let nonce = 0;
  for (;;) {
    const nonceStr = String(nonce);
    if (
      verifyPowSolution({
        prefix: params.prefix,
        challengeId: params.challengeId,
        to: params.to,
        nonce: nonceStr,
        difficulty: params.difficulty,
      })
    ) {
      return nonceStr;
    }
    nonce += 1;
    if (params.onProgress && nonce % 50_000 === 0) {
      params.onProgress(nonce);
    }
  }
}

export async function createPowChallenge(params: {
  to: string;
  request: Request;
}): Promise<
  | { ok: true; challenge: PowChallengePublic }
  | { ok: false; status: number; error: string; reason: string }
> {
  await ensureMigrated();
  const cfg = getFaucetConfig();

  let wallet: string;
  try {
    wallet = normalizeAddress(params.to);
  } catch {
    return {
      ok: false,
      status: 400,
      error: `Invalid Stellar address: ${params.to}. Provide a valid C… or G… address.`,
      reason: "invalid_address",
    };
  }

  const ipHash = softHash(clientIp(params.request));
  if (ipHash && cfg.powChallengePerIpPerMin > 0) {
    const since = new Date(Date.now() - 60_000).toISOString();
    const db = getDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(faucetPowChallenges)
      .where(
        and(
          eq(faucetPowChallenges.ipHash, ipHash),
          gte(faucetPowChallenges.createdAt, since),
        ),
      );
    const count = Number(row?.count ?? 0);
    if (count >= cfg.powChallengePerIpPerMin) {
      return {
        ok: false,
        status: 429,
        error:
          "Too many PoW challenges from this IP. Wait a minute and try again.",
        reason: "rate_limited",
      };
    }
  }

  const id = randomUUID();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + cfg.powTtlSeconds * 1000,
  ).toISOString();
  const createdAt = now.toISOString();

  const db = getDb();
  await db.insert(faucetPowChallenges).values({
    id,
    walletAddress: wallet,
    difficulty: cfg.powDifficulty,
    prefix: POW_PREFIX,
    expiresAt,
    consumedAt: null,
    ipHash,
    createdAt,
  });

  return {
    ok: true,
    challenge: {
      challengeId: id,
      to: wallet,
      difficulty: cfg.powDifficulty,
      prefix: POW_PREFIX,
      expiresAt,
    },
  };
}

/**
 * Verify + atomically consume a PoW ticket.
 * Returns the bound wallet on success.
 */
export async function consumePowProof(params: {
  to: string;
  pow: PowProof;
}): Promise<
  | { ok: true; walletAddress: string }
  | { ok: false; status: number; error: string; reason: string }
> {
  await ensureMigrated();

  let wallet: string;
  try {
    wallet = normalizeAddress(params.to);
  } catch {
    return {
      ok: false,
      status: 400,
      error: `Invalid Stellar address: ${params.to}. Provide a valid C… or G… address.`,
      reason: "invalid_address",
    };
  }

  const challengeId = params.pow.challengeId?.trim();
  const nonce = params.pow.nonce?.trim();
  if (!challengeId || !nonce) {
    return {
      ok: false,
      status: 401,
      error: "PoW proof requires challengeId and nonce.",
      reason: "unauthorized",
    };
  }

  const db = getDb();
  const [challenge] = await db
    .select()
    .from(faucetPowChallenges)
    .where(eq(faucetPowChallenges.id, challengeId))
    .limit(1);

  if (!challenge) {
    return {
      ok: false,
      status: 401,
      error: "Unknown or expired PoW challenge.",
      reason: "unauthorized",
    };
  }

  if (challenge.consumedAt) {
    return {
      ok: false,
      status: 401,
      error: "PoW challenge already used.",
      reason: "unauthorized",
    };
  }

  if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
    return {
      ok: false,
      status: 401,
      error: "PoW challenge expired. Request a new one.",
      reason: "unauthorized",
    };
  }

  if (challenge.walletAddress !== wallet) {
    return {
      ok: false,
      status: 403,
      error: "PoW challenge is bound to a different wallet.",
      reason: "unauthorized",
    };
  }

  if (
    !verifyPowSolution({
      prefix: challenge.prefix,
      challengeId: challenge.id,
      to: wallet,
      nonce,
      difficulty: challenge.difficulty,
    })
  ) {
    return {
      ok: false,
      status: 401,
      error: "Invalid PoW solution.",
      reason: "unauthorized",
    };
  }

  const consumedAt = new Date().toISOString();
  const updated = await db
    .update(faucetPowChallenges)
    .set({ consumedAt })
    .where(
      and(
        eq(faucetPowChallenges.id, challengeId),
        isNull(faucetPowChallenges.consumedAt),
      ),
    )
    .returning({ id: faucetPowChallenges.id });

  if (updated.length === 0) {
    return {
      ok: false,
      status: 401,
      error: "PoW challenge already used.",
      reason: "unauthorized",
    };
  }

  return { ok: true, walletAddress: wallet };
}
