/** Shared API / domain types for Sozu Faucet v1. */

export type FaucetStatus = "active" | "inactive";
export type FaucetClaimStatus = "pending" | "success" | "failed";

export type FaucetUnavailableReason =
  | "inactive"
  | "empty_today"
  | "insufficient_vault"
  | "global_cooldown"
  | "user_cooldown";

export type ClaimFailureReason =
  | FaucetUnavailableReason
  | "wallet_missing"
  | "payment_failed"
  | "trustline_required"
  | "account_missing"
  | "unauthorized"
  | "invalid_address"
  | "mainnet_refused"
  | "rate_limited";

export type FaucetPublic = {
  slug: string;
  name: string;
  claimAmount: number;
  dailyLimit: number;
  status: FaucetStatus;
  asset: "circle_usdc_sac";
  network: "testnet";
  cooldownMinutes: number;
};

export type FaucetAvailability = {
  available: boolean;
  reason?: FaucetUnavailableReason;
  remainingToday: number;
  /** ISO timestamp when the faucet (or the user) can claim again. */
  nextAvailableAt?: string;
};

export type FaucetStatusResponse = {
  faucet: FaucetPublic;
  availability: FaucetAvailability;
};

export type FaucetClaimSuccess = {
  success: true;
  amount: number;
  asset: "circle_usdc_sac";
  network: "testnet";
  to: string;
  txHash: string;
  nextAvailableAt: string;
};

export type FaucetClaimFailure = {
  success: false;
  amount: number;
  error: string;
  reason: ClaimFailureReason;
  nextAvailableAt?: string;
  /** Optional action link (e.g. Stellar Lab to add a USDC trustline). */
  helpUrl?: string;
};

export type FaucetClaimResponse = FaucetClaimSuccess | FaucetClaimFailure;

export type HealthResponse = {
  ok: boolean;
  network: "testnet";
  slug: string;
  claimAmount: number;
  vault: {
    mode: "vault_contract" | "treasury_transfer";
    contractId: string | null;
    tokenContractId: string;
    balanceUsdc: number | null;
    canCoverClaim: boolean;
  };
  remainingToday: number;
  treasuryPublicKey: string | null;
};
