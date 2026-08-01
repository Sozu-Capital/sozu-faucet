import {
  clientIp,
  resolveAuth,
  softHash,
} from "@/lib/auth";
import {
  computeAvailability,
  createPendingClaim,
  finalizeClaim,
  nextUserAvailableAt,
} from "@/lib/availability";
import { getFaucetConfig } from "@/lib/config";
import { optionsResponse, withCors } from "@/lib/cors";
import {
  getDispenserBalanceMinor,
  sendFaucetPayment,
  vaultCanCoverClaim,
} from "@/lib/payout";
import { minorToUsdc } from "@/lib/config";
import type { FaucetClaimResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /v1/faucet/claim — Mode A authenticated claim.
 * Recipient is the wallet bound in the JWT (optional body.to must match).
 */
export async function POST(request: Request) {
  try {
    getFaucetConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Misconfigured";
    const res: FaucetClaimResponse = {
      success: false,
      amount: 0,
      error: message,
      reason: "mainnet_refused",
    };
    return withCors(request, Response.json(res, { status: 503 }));
  }

  const auth = await resolveAuth(request);
  if (!auth.ok) {
    const res: FaucetClaimResponse = {
      success: false,
      amount: getFaucetConfig().claimAmount,
      error: auth.error,
      reason: auth.reason,
    };
    return withCors(request, Response.json(res, { status: auth.status }));
  }

  const cfg = getFaucetConfig();
  const { userId, walletAddress } = auth.ctx;

  try {
    // Optional body.to — if present, must match auth wallet (no third-party payouts).
    let body: { to?: string; slug?: string } = {};
    try {
      body = (await request.json()) as { to?: string; slug?: string };
    } catch {
      body = {};
    }

    if (body.slug && body.slug.trim().toLowerCase() !== cfg.slug) {
      const res: FaucetClaimResponse = {
        success: false,
        amount: cfg.claimAmount,
        error: `Unknown faucet slug. v1 serves only "${cfg.slug}".`,
        reason: "inactive",
      };
      return withCors(request, Response.json(res, { status: 404 }));
    }

    if (body.to) {
      const requested = body.to.trim().toUpperCase();
      if (requested !== walletAddress) {
        const res: FaucetClaimResponse = {
          success: false,
          amount: cfg.claimAmount,
          error:
            "Recipient must match the authenticated wallet. Arbitrary addresses are not allowed in Mode A.",
          reason: "unauthorized",
        };
        return withCors(request, Response.json(res, { status: 403 }));
      }
    }

    const availability = await computeAvailability({
      userId,
      walletAddress,
    });

    if (!availability.available) {
      const res: FaucetClaimResponse = {
        success: false,
        amount: cfg.claimAmount,
        error: humanReason(availability.reason),
        reason: availability.reason ?? "user_cooldown",
        nextAvailableAt: availability.nextAvailableAt,
      };
      return withCors(request, Response.json(res, { status: 409 }));
    }

    const claimAmount = cfg.claimAmount;

    const canCover = await vaultCanCoverClaim(claimAmount);
    if (canCover !== true) {
      const minor = await getDispenserBalanceMinor();
      const have = minor !== null ? minorToUsdc(minor) : 0;
      const res: FaucetClaimResponse = {
        success: false,
        amount: claimAmount,
        error:
          canCover === null
            ? "Faucet balance unreadable. Check treasury config / Soroban RPC."
            : `Vault has ${have} USDC but this claim needs ${claimAmount} USDC. Fund the faucet or lower FAUCET_CLAIM_AMOUNT.`,
        reason: "insufficient_vault",
      };
      return withCors(request, Response.json(res, { status: 503 }));
    }

    // Reserve budget/cooldown before touching the chain.
    const claim = await createPendingClaim({
      userId,
      walletAddress,
      amount: claimAmount,
      ipHash: softHash(clientIp(request)),
      userAgentHash: softHash(request.headers.get("user-agent")),
    });

    try {
      const { txHash } = await sendFaucetPayment({
        toWalletAddress: walletAddress,
        amount: claimAmount,
      });

      await finalizeClaim({
        claimId: claim.id,
        status: "success",
        txHash,
      });

      const res: FaucetClaimResponse = {
        success: true,
        amount: claimAmount,
        asset: "circle_usdc_sac",
        network: "testnet",
        to: walletAddress,
        txHash,
        nextAvailableAt: nextUserAvailableAt(),
      };
      return withCors(request, Response.json(res));
    } catch (payErr) {
      console.error("[POST /v1/faucet/claim] payment", payErr);
      await finalizeClaim({ claimId: claim.id, status: "failed" }).catch(
        (e) => console.error("[POST /v1/faucet/claim] finalize", e),
      );
      const message =
        payErr instanceof Error
          ? payErr.message
          : "Transfer could not be completed.";
      const isUnderfunded =
        message.includes("underfunded") ||
        message.includes("InsufficientBalance");
      const res: FaucetClaimResponse = {
        success: false,
        amount: claimAmount,
        error: isUnderfunded
          ? message
          : "Transfer could not be completed. Try again in a moment.",
        reason: isUnderfunded ? "insufficient_vault" : "payment_failed",
      };
      return withCors(
        request,
        Response.json(res, { status: isUnderfunded ? 503 : 502 }),
      );
    }
  } catch (err) {
    console.error("[POST /v1/faucet/claim]", err);
    return withCors(
      request,
      Response.json({ error: "Failed to process claim" }, { status: 500 }),
    );
  }
}

export async function OPTIONS(request: Request) {
  return optionsResponse(request);
}

function humanReason(reason: string | undefined): string {
  switch (reason) {
    case "inactive":
      return "This faucet is inactive.";
    case "empty_today":
      return "Daily faucet budget is exhausted. Try again tomorrow (UTC).";
    case "insufficient_vault":
      return "Faucet vault does not have enough USDC right now.";
    case "global_cooldown":
      return "Faucet is cooling down. Try again shortly.";
    case "user_cooldown":
      return "You already claimed recently. Wait for the cooldown to end.";
    default:
      return "Faucet not available.";
  }
}
