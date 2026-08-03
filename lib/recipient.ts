/**
 * Preflight: can this address receive Circle USDC SAC on testnet?
 *
 * C… contracts: no classic trustline needed.
 * G… accounts: must exist on Horizon and hold a USDC trustline to the Circle issuer.
 * Trustlines require the owner's secret — we never collect it; point humans to Stellar Lab.
 */

import { getCircleIssuer, getFaucetConfig, isContractId } from "@/lib/config";
import { STELLAR_LAB_TESTNET_FUND_URL } from "@/lib/stellar-lab";
import type { ClaimFailureReason } from "@/lib/types";

export class RecipientError extends Error {
  readonly reason: ClaimFailureReason;
  readonly status: number;
  readonly helpUrl?: string;

  constructor(
    reason: ClaimFailureReason,
    message: string,
    status: number,
    helpUrl?: string,
  ) {
    super(message);
    this.name = "RecipientError";
    this.reason = reason;
    this.status = status;
    this.helpUrl = helpUrl;
  }
}

type HorizonBalance = {
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
};

function shortAddr(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export async function assertRecipientCanReceiveUsdc(
  address: string,
): Promise<void> {
  if (isContractId(address)) return;

  const cfg = getFaucetConfig();
  const issuer = getCircleIssuer();
  const res = await fetch(`${cfg.horizonUrl}/accounts/${address}`);

  if (res.status === 404) {
    throw new RecipientError(
      "account_missing",
      `Account ${shortAddr(address)} is not on Stellar testnet yet. Open Stellar Lab (Testnet → Fund Account), paste the address, fund with Friendbot, add the Circle USDC trustline (USDC:${issuer}), then re-run the claim.`,
      400,
      STELLAR_LAB_TESTNET_FUND_URL,
    );
  }

  if (!res.ok) {
    throw new RecipientError(
      "payment_failed",
      `Could not verify account ${shortAddr(address)} on Horizon (HTTP ${res.status}). Try again in a moment.`,
      502,
    );
  }

  const body = (await res.json()) as { balances?: HorizonBalance[] };
  const hasTrustline = (body.balances ?? []).some(
    (b) =>
      b.asset_type === "credit_alphanum4" &&
      b.asset_code === "USDC" &&
      b.asset_issuer === issuer,
  );

  if (!hasTrustline) {
    throw new RecipientError(
      "trustline_required",
      `Trustline missing: classic account ${shortAddr(address)} cannot receive Circle USDC (USDC:${issuer}). The faucet cannot sign the trustline (needs your secret). Open Stellar Lab → Fund Account → paste this address → Add trustline for USDC → sign → re-run claim. C… smart accounts skip this step.`,
      400,
      STELLAR_LAB_TESTNET_FUND_URL,
    );
  }
}
