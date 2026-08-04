import { anonUserId } from "@/lib/agent-prompt";
import { clientIp, resolveAuth, softHash } from "@/lib/auth";
import {
  computeAvailability,
  toPublicFaucet,
} from "@/lib/availability";
import { getFaucetConfig, normalizeAddress } from "@/lib/config";
import { optionsResponse, withCors } from "@/lib/cors";
import { vaultCanCoverClaim } from "@/lib/payout";
import type { FaucetStatusResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

async function optionalAuth(request: Request) {
  const hasBearer = request.headers
    .get("authorization")
    ?.toLowerCase()
    .startsWith("bearer ");
  const hasDev =
    !!request.headers.get("x-faucet-dev-key") &&
    !!request.headers.get("x-user-id") &&
    !!request.headers.get("x-wallet-address");

  if (!hasBearer && !hasDev) return null;

  const auth = await resolveAuth(request);
  return auth.ok ? auth.ctx : null;
}

/**
 * GET /v1/faucet/status
 * Public. Optional Authorization Bearer, or ?wallet=C…/G… for that wallet's cooldown.
 */
export async function GET(request: Request) {
  try {
    getFaucetConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Misconfigured";
    return withCors(
      request,
      Response.json(
        { success: false, error: message, reason: "mainnet_refused" },
        { status: 503 },
      ),
    );
  }

  try {
    const ctx = await optionalAuth(request);
    const walletParam = new URL(request.url).searchParams.get("wallet");

    let userId = ctx?.userId ?? null;
    let walletAddress = ctx?.walletAddress ?? null;

    if (!ctx && walletParam) {
      try {
        walletAddress = normalizeAddress(walletParam);
        userId = anonUserId(walletAddress);
      } catch {
        return withCors(
          request,
          Response.json(
            { error: "Invalid wallet address", reason: "invalid_address" },
            { status: 400 },
          ),
        );
      }
    }

    let availability = await computeAvailability({
      userId,
      walletAddress,
      ipHash: softHash(clientIp(request)),
    });

    const claimAmount = getFaucetConfig().claimAmount;
    const canCover = await vaultCanCoverClaim(claimAmount);
    if (availability.available && canCover === false) {
      availability = {
        available: false,
        reason: "insufficient_vault",
        remainingToday: availability.remainingToday,
      };
    }

    const body: FaucetStatusResponse = {
      faucet: toPublicFaucet(),
      availability,
    };
    return withCors(request, Response.json(body));
  } catch (err) {
    console.error("[GET /v1/faucet/status]", err);
    return withCors(
      request,
      Response.json({ error: "Failed to fetch faucet status" }, { status: 500 }),
    );
  }
}

export async function OPTIONS(request: Request) {
  return optionsResponse(request);
}
