import { resolveAuth } from "@/lib/auth";
import {
  computeAvailability,
  toPublicFaucet,
} from "@/lib/availability";
import { getFaucetConfig } from "@/lib/config";
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
 * Public. When Authorization Bearer is present, includes user_cooldown.
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

    let availability = await computeAvailability({
      userId: ctx?.userId ?? null,
      walletAddress: ctx?.walletAddress ?? null,
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
