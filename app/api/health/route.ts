import { computeAvailability } from "@/lib/availability";
import { getFaucetConfig, getTreasuryPublicKey } from "@/lib/config";
import { optionsResponse, withCors } from "@/lib/cors";
import { getVaultHealth } from "@/lib/payout";
import type { HealthResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/health — ops: vault balance, daily remaining, can-cover-claim. */
export async function GET(request: Request) {
  try {
    const cfg = getFaucetConfig();
    const [vault, availability] = await Promise.all([
      getVaultHealth(),
      computeAvailability({}),
    ]);

    const body: HealthResponse = {
      ok: vault.canCoverClaim && availability.remainingToday >= cfg.claimAmount,
      network: "testnet",
      slug: cfg.slug,
      claimAmount: cfg.claimAmount,
      vault,
      remainingToday: availability.remainingToday,
      treasuryPublicKey: getTreasuryPublicKey(),
    };
    return withCors(request, Response.json(body));
  } catch (err) {
    console.error("[GET /api/health]", err);
    const message = err instanceof Error ? err.message : "health failed";
    return withCors(
      request,
      Response.json({ ok: false, error: message }, { status: 503 }),
    );
  }
}

export async function OPTIONS(request: Request) {
  return optionsResponse(request);
}
