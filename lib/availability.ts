import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { getFaucetConfig } from "@/lib/config";
import { ensureMigrated, getDb } from "@/lib/db/client";
import { faucetClaims } from "@/lib/db/schema";
import type { FaucetAvailability, FaucetPublic } from "@/lib/types";

function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function nextUtcMidnight(now: Date): Date {
  return new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000);
}

export function toPublicFaucet(): FaucetPublic {
  const cfg = getFaucetConfig();
  return {
    slug: cfg.slug,
    name: cfg.name,
    claimAmount: cfg.claimAmount,
    dailyLimit: cfg.dailyLimit,
    status: cfg.status,
    asset: cfg.asset,
    network: cfg.network,
    cooldownMinutes: cfg.cooldownMinutes,
  };
}

/**
 * Abuse rules (order matters):
 * 1. inactive
 * 2. daily budget exhausted (pending + success)
 * 3. per-IP lifetime USDC cap (pending + success)
 * 4. global cooldown
 * 5. user / wallet cooldown
 */
export async function computeAvailability(opts: {
  userId?: string | null;
  walletAddress?: string | null;
  /** Soft-hashed client IP; required to enforce FAUCET_IP_TOTAL_LIMIT on claims. */
  ipHash?: string | null;
}): Promise<FaucetAvailability> {
  await ensureMigrated();
  const cfg = getFaucetConfig();
  const db = getDb();
  const now = new Date();
  const dayStart = startOfUtcDay(now).toISOString();

  if (cfg.status !== "active") {
    return { available: false, reason: "inactive", remainingToday: 0 };
  }

  const todayRows = await db
    .select({
      total: sql<number>`coalesce(sum(${faucetClaims.amount}), 0)`,
    })
    .from(faucetClaims)
    .where(
      and(
        eq(faucetClaims.faucetSlug, cfg.slug),
        inArray(faucetClaims.status, ["pending", "success"]),
        gte(faucetClaims.claimedAt, dayStart),
      ),
    );

  const claimedToday = Number(todayRows[0]?.total ?? 0);
  const remainingToday = Math.max(0, cfg.dailyLimit - claimedToday);

  if (remainingToday < cfg.claimAmount) {
    return {
      available: false,
      reason: "empty_today",
      remainingToday,
      nextAvailableAt: nextUtcMidnight(now).toISOString(),
    };
  }

  if (cfg.ipTotalLimit > 0 && opts.ipHash) {
    const [ipRow] = await db
      .select({
        total: sql<number>`coalesce(sum(${faucetClaims.amount}), 0)`,
      })
      .from(faucetClaims)
      .where(
        and(
          eq(faucetClaims.faucetSlug, cfg.slug),
          eq(faucetClaims.ipHash, opts.ipHash),
          inArray(faucetClaims.status, ["pending", "success"]),
        ),
      );

    const claimedByIp = Number(ipRow?.total ?? 0);
    if (claimedByIp + cfg.claimAmount > cfg.ipTotalLimit) {
      return {
        available: false,
        reason: "ip_limit",
        remainingToday,
      };
    }
  }

  if (cfg.globalCooldownMinutes > 0) {
    const [last] = await db
      .select({ claimedAt: faucetClaims.claimedAt })
      .from(faucetClaims)
      .where(
        and(
          eq(faucetClaims.faucetSlug, cfg.slug),
          inArray(faucetClaims.status, ["pending", "success"]),
        ),
      )
      .orderBy(desc(faucetClaims.claimedAt))
      .limit(1);

    if (last) {
      const readyAt =
        new Date(last.claimedAt).getTime() +
        cfg.globalCooldownMinutes * 60_000;
      if (readyAt > now.getTime()) {
        return {
          available: false,
          reason: "global_cooldown",
          remainingToday,
          nextAvailableAt: new Date(readyAt).toISOString(),
        };
      }
    }
  }

  const wallet = opts.walletAddress?.trim().toUpperCase() || null;
  const userId = opts.userId?.trim() || null;

  if (cfg.cooldownMinutes > 0 && (wallet || userId)) {
    const since = new Date(
      now.getTime() - cfg.cooldownMinutes * 60_000,
    ).toISOString();

    const identityFilter =
      wallet && userId
        ? or(
            eq(faucetClaims.walletAddress, wallet),
            eq(faucetClaims.userId, userId),
          )
        : wallet
          ? eq(faucetClaims.walletAddress, wallet)
          : eq(faucetClaims.userId, userId!);

    const [userClaim] = await db
      .select({ claimedAt: faucetClaims.claimedAt })
      .from(faucetClaims)
      .where(
        and(
          inArray(faucetClaims.status, ["pending", "success"]),
          gte(faucetClaims.claimedAt, since),
          identityFilter,
        ),
      )
      .orderBy(desc(faucetClaims.claimedAt))
      .limit(1);

    if (userClaim) {
      const readyAt =
        new Date(userClaim.claimedAt).getTime() +
        cfg.cooldownMinutes * 60_000;
      return {
        available: false,
        reason: "user_cooldown",
        remainingToday,
        nextAvailableAt: new Date(readyAt).toISOString(),
      };
    }
  }

  return { available: true, remainingToday };
}

export async function createPendingClaim(params: {
  userId: string;
  walletAddress: string;
  amount: number;
  ipHash?: string | null;
  userAgentHash?: string | null;
}): Promise<{ id: string }> {
  await ensureMigrated();
  const cfg = getFaucetConfig();
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db.insert(faucetClaims).values({
    id,
    faucetSlug: cfg.slug,
    userId: params.userId,
    walletAddress: params.walletAddress.trim().toUpperCase(),
    amount: params.amount,
    status: "pending",
    txHash: null,
    ipHash: params.ipHash ?? null,
    userAgentHash: params.userAgentHash ?? null,
    claimedAt: now,
    updatedAt: now,
  });

  return { id };
}

export async function finalizeClaim(params: {
  claimId: string;
  status: "success" | "failed";
  txHash?: string | null;
}): Promise<void> {
  await ensureMigrated();
  const db = getDb();
  await db
    .update(faucetClaims)
    .set({
      status: params.status,
      txHash: params.txHash ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(faucetClaims.id, params.claimId));
}

export function nextUserAvailableAt(from = new Date()): string {
  const cfg = getFaucetConfig();
  return new Date(from.getTime() + cfg.cooldownMinutes * 60_000).toISOString();
}
