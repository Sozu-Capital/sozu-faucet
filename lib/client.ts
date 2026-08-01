/**
 * Tiny typed client helpers for Sozu Wallet (or any embed).
 * Copy or import once this package is published / path-linked.
 */

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
  reason: string;
  nextAvailableAt?: string;
};

export type FaucetClaimResponse = FaucetClaimSuccess | FaucetClaimFailure;

export type FaucetStatusResponse = {
  faucet: {
    slug: string;
    name: string;
    claimAmount: number;
    dailyLimit: number;
    status: "active" | "inactive";
    asset: "circle_usdc_sac";
    network: "testnet";
    cooldownMinutes: number;
  };
  availability: {
    available: boolean;
    reason?: string;
    remainingToday: number;
    nextAvailableAt?: string;
  };
};

export function createSozuFaucetClient(baseUrl: string) {
  const root = baseUrl.replace(/\/$/, "");

  return {
    async status(token?: string): Promise<FaucetStatusResponse> {
      const res = await fetch(`${root}/api/v1/faucet/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`faucet status ${res.status}`);
      return res.json() as Promise<FaucetStatusResponse>;
    },

    async claim(token: string, body?: { to?: string; slug?: string }) {
      const res = await fetch(`${root}/api/v1/faucet/claim`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body ?? {}),
      });
      return (await res.json()) as FaucetClaimResponse;
    },
  };
}
