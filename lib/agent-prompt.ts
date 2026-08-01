/** Clipboard / agent paste: one npx claim command (Mode C PoW). */

export function buildNpxAgentPrompt(params: {
  wallet: string;
  claimAmount: number;
  faucetUrl?: string;
}): string {
  const wallet = params.wallet.trim().toUpperCase();
  const expert = `https://stellar.expert/explorer/testnet/contract/${wallet}`;
  const urlFlag = params.faucetUrl
    ? ` --url ${params.faucetUrl.replace(/\/$/, "")}`
    : "";

  return `Claim ${params.claimAmount} testnet USDC (Circle SAC) from Sozu Faucet for ${wallet}.

Run this single command (solves a short PoW, then claims — no browser):

npx @sozu/faucet@latest claim ${wallet}${urlFlag}

Print the JSON. On success, open:
${expert}`;
}

/** @deprecated Prefer buildNpxAgentPrompt — JWT curl handoff is no longer the happy path. */
export function buildAgentClaimPrompt(params: {
  baseUrl: string;
  token: string;
  wallet: string;
  claimAmount: number;
  expiresInSeconds?: number;
}): string {
  const base = params.baseUrl.replace(/\/$/, "");
  const ttl = params.expiresInSeconds ?? 300;
  const mins = Math.max(1, Math.round(ttl / 60));
  const expert = `https://stellar.expert/explorer/testnet/contract/${params.wallet}`;

  return `Claim ${params.claimAmount} testnet USDC from Sozu Faucet (token expires in ~${mins}m):

curl -sS -X POST ${base}/api/v1/faucet/claim \\
  -H "Authorization: Bearer ${params.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"to":"${params.wallet}"}'

Print the JSON. On success, open:
${expert}`;
}

/** Stable Mode B / Mode C / prompt-token identity so cooldown is shared. */
export function anonUserId(walletAddress: string): string {
  return `anon:${walletAddress.trim().toUpperCase()}`;
}
