import { getCircleIssuer } from "@/lib/config";
import { STELLAR_LAB_TESTNET_FUND_URL } from "@/lib/stellar-lab";
import type { ClaimFailureReason } from "@/lib/types";

export type ClassifiedPaymentError = {
  reason: ClaimFailureReason;
  message: string;
  status: number;
  helpUrl?: string;
};

/** Pull the first quoted diagnostic string from a Soroban HostError dump. */
function extractDiagnosticQuote(raw: string): string | null {
  const match = raw.match(/data:\s*\[\s*"([^"]+)"/);
  return match?.[1] ?? null;
}

/**
 * Map payout / Soroban failures to a stable claim reason + human message.
 * Keeps raw HostError stacks out of the API response.
 */
export function classifyPaymentError(err: unknown): ClassifiedPaymentError {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  const diagnostic = extractDiagnosticQuote(raw);
  const issuer = getCircleIssuer();

  if (
    lower.includes("trustline") ||
    diagnostic?.toLowerCase().includes("trustline")
  ) {
    return {
      reason: "trustline_required",
      message: `Trustline missing for Circle USDC (USDC:${issuer}). The faucet cannot sign it (needs your secret). Open Stellar Lab → Fund Account → Add trustline for USDC → sign → re-run claim. C… smart accounts skip this step.`,
      status: 400,
      helpUrl: STELLAR_LAB_TESTNET_FUND_URL,
    };
  }

  if (
    lower.includes("underfunded") ||
    lower.includes("insufficientbalance") ||
    lower.includes("insufficient balance") ||
    lower.includes("faucet balance unreadable")
  ) {
    return {
      reason: "insufficient_vault",
      message: raw.includes("Faucet")
        ? raw
        : "Faucet treasury does not have enough USDC right now.",
      status: 503,
    };
  }

  if (
    lower.includes("account not found") ||
    lower.includes("does not exist") ||
    lower.includes("no account") ||
    lower.includes("op_no_destination")
  ) {
    return {
      reason: "account_missing",
      message:
        "Recipient account is not on Stellar testnet. Open Stellar Lab (Testnet → Fund Account), fund with Friendbot, add a Circle USDC trustline, then claim again.",
      status: 400,
      helpUrl: STELLAR_LAB_TESTNET_FUND_URL,
    };
  }

  if (lower.includes("still pending after timeout")) {
    return {
      reason: "payment_failed",
      message: raw,
      status: 504,
    };
  }

  if (lower.includes("rejected by soroban rpc")) {
    return {
      reason: "payment_failed",
      message: raw,
      status: 502,
    };
  }

  // Prefer a short diagnostic line when present.
  if (diagnostic) {
    return {
      reason: "payment_failed",
      message: `Transfer failed on-chain: ${diagnostic}.`,
      status: 502,
    };
  }

  // Truncate huge HostError dumps if they somehow slip through.
  const trimmed = raw.length > 280 ? `${raw.slice(0, 277)}…` : raw;
  if (
    trimmed.startsWith("Faucet ") ||
    trimmed.startsWith("Transfer ") ||
    trimmed.startsWith("Treasury ")
  ) {
    return { reason: "payment_failed", message: trimmed, status: 502 };
  }

  return {
    reason: "payment_failed",
    message: "Transfer could not be completed. Try again in a moment.",
    status: 502,
  };
}
