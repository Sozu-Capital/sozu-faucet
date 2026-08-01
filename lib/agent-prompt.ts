/** Clipboard / agent paste: one Mode A claim curl, no scavenger notes. */

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

/** Stable Mode B / prompt-token identity so cooldown is shared with paste claims. */
export function anonUserId(walletAddress: string): string {
  return `anon:${walletAddress.trim().toUpperCase()}`;
}
