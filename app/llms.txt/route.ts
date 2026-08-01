import { getFaucetConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET /llms.txt — short machine-oriented pointer for agents.
 */
export async function GET(request: Request) {
  let claimAmount = 20;
  let cooldownMinutes = 120;

  try {
    const cfg = getFaucetConfig();
    claimAmount = cfg.claimAmount;
    cooldownMinutes = cfg.cooldownMinutes;
  } catch {
    // keep defaults
  }

  const origin = new URL(request.url).origin;
  const isLocal =
    origin.includes("localhost") || origin.includes("127.0.0.1");
  const urlFlag = isLocal ? ` --url ${origin}` : "";

  const body = `# Sozu Faucet

> Friendbot-like testnet Circle USDC (SAC) for Stellar. Claim amount: ${claimAmount} USDC. Cooldown: ${cooldownMinutes}m per wallet.

## Happy path

\`\`\`bash
npx @sozu/faucet@latest claim <C_OR_G_ADDRESS>${urlFlag}
\`\`\`

One command. CLI solves PoW and claims. No browser. No Turnstile. Do not ask humans for FAUCET_AUTH_SECRET.

## Docs

- Agents: ${origin}/agents.md
- Status: ${origin}/api/v1/faucet/status
- PoW challenge: POST ${origin}/api/v1/faucet/pow/challenge
- Claim: POST ${origin}/api/v1/faucet/claim

## Mode C claim (PoW)

Body: {"to":"<wallet>","pow":{"challengeId":"<id>","nonce":"<n>"}}

## Mode A claim (wallet)

Authorization: Bearer <JWT>
Body (optional): {"to":"<wallet matching JWT>"}

## Mode B claim (humans / browser)

Body: {"to":"<C…/G…>","captchaToken":"<turnstile>"}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
}
