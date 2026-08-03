import { anonUserId } from "@/lib/agent-prompt";
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
import { verifyCaptcha } from "@/lib/captcha";
import { getFaucetConfig, normalizeAddress } from "@/lib/config";
import { optionsResponse, withCors } from "@/lib/cors";
import { classifyPaymentError } from "@/lib/payment-errors";
import {
  getDispenserBalanceMinor,
  sendFaucetPayment,
  vaultCanCoverClaim,
} from "@/lib/payout";
import { consumePowProof } from "@/lib/pow";
import { RecipientError, assertRecipientCanReceiveUsdc } from "@/lib/recipient";
import { minorToUsdc } from "@/lib/config";
import type { FaucetClaimResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ClaimBody = {
  to?: string;
  slug?: string;
  captchaToken?: string;
  pow?: {
    challengeId?: string;
    nonce?: string;
  };
};

/**
 * POST /v1/faucet/claim
 *
 * Mode A: Bearer JWT → pays the wallet bound in JWT (body.to optional, must match)
 * Mode B: No auth + body { to, captchaToken } → public paste claim
 * Mode C: No auth + body { to, pow: { challengeId, nonce } } → terminal / agent
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

  const cfg = getFaucetConfig();

  // Parse body once
  let body: ClaimBody = {};
  try {
    body = (await request.json()) as ClaimBody;
  } catch {
    body = {};
  }

  // Check slug early
  if (body.slug && body.slug.trim().toLowerCase() !== cfg.slug) {
    const res: FaucetClaimResponse = {
      success: false,
      amount: cfg.claimAmount,
      error: `Unknown faucet slug. v1 serves only "${cfg.slug}".`,
      reason: "inactive",
    };
    return withCors(request, Response.json(res, { status: 404 }));
  }

  // Try Mode A auth
  const auth = await resolveAuth(request);

  let userId: string;
  let walletAddress: string;

  if (auth.ok) {
    // Mode A: authenticated JWT claim
    userId = auth.ctx.userId;
    walletAddress = auth.ctx.walletAddress;

    // If body.to is provided, must match JWT wallet
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
  } else if (body.to && body.pow?.challengeId && body.pow?.nonce) {
    // Mode C: PoW ticket (npx @sozu/faucet / agents)
    const pow = await consumePowProof({
      to: body.to,
      pow: {
        challengeId: body.pow.challengeId,
        nonce: body.pow.nonce,
      },
    });
    if (!pow.ok) {
      const res: FaucetClaimResponse = {
        success: false,
        amount: cfg.claimAmount,
        error: pow.error,
        reason: pow.reason === "invalid_address" ? "invalid_address" : "unauthorized",
      };
      return withCors(request, Response.json(res, { status: pow.status }));
    }
    walletAddress = pow.walletAddress;
    userId = anonUserId(walletAddress);
  } else if (body.to && body.captchaToken) {
    // Mode B: public paste claim requires captcha + to address
    const captchaValid = await verifyCaptcha(body.captchaToken);
    if (!captchaValid) {
      const res: FaucetClaimResponse = {
        success: false,
        amount: cfg.claimAmount,
        error: "Captcha verification failed. Refresh and try again.",
        reason: "unauthorized",
      };
      return withCors(request, Response.json(res, { status: 401 }));
    }

    try {
      walletAddress = normalizeAddress(body.to);
    } catch {
      const res: FaucetClaimResponse = {
        success: false,
        amount: cfg.claimAmount,
        error: `Invalid Stellar address: ${body.to}. Provide a valid C… or G… address.`,
        reason: "invalid_address",
      };
      return withCors(request, Response.json(res, { status: 400 }));
    }

    userId = anonUserId(walletAddress);
  } else {
    const res: FaucetClaimResponse = {
      success: false,
      amount: cfg.claimAmount,
      error:
        "Missing authentication. Provide Authorization: Bearer <JWT> (Mode A), { to, captchaToken } (Mode B), or { to, pow } (Mode C).",
      reason: "unauthorized",
    };
    return withCors(request, Response.json(res, { status: 401 }));
  }

  try {
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

    // Fail closed on classic G… trustline / missing account before reserving a claim.
    try {
      await assertRecipientCanReceiveUsdc(walletAddress);
    } catch (preflightErr) {
      if (preflightErr instanceof RecipientError) {
        const res: FaucetClaimResponse = {
          success: false,
          amount: claimAmount,
          error: preflightErr.message,
          reason: preflightErr.reason,
          ...(preflightErr.helpUrl ? { helpUrl: preflightErr.helpUrl } : {}),
        };
        return withCors(
          request,
          Response.json(res, { status: preflightErr.status }),
        );
      }
      throw preflightErr;
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
      const classified =
        payErr instanceof RecipientError
          ? {
              reason: payErr.reason,
              message: payErr.message,
              status: payErr.status,
              helpUrl: payErr.helpUrl,
            }
          : classifyPaymentError(payErr);
      const res: FaucetClaimResponse = {
        success: false,
        amount: claimAmount,
        error: classified.message,
        reason: classified.reason,
        ...(classified.helpUrl ? { helpUrl: classified.helpUrl } : {}),
      };
      return withCors(
        request,
        Response.json(res, { status: classified.status }),
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
