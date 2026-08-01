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

  const body = `# Sozu Faucet

> Friendbot-like testnet Circle USDC (SAC) for Stellar. Claim amount: ${claimAmount} USDC. Cooldown: ${cooldownMinutes}m per wallet.

Prefer the site **Copy prompt** (pre-authorized Mode A JWT). Do not ask humans for FAUCET_AUTH_SECRET. Do not attempt Turnstile (Mode B) from an agent.

## Docs

- Agents: ${origin}/agents.md
- Status: ${origin}/api/v1/faucet/status
- Claim: POST ${origin}/api/v1/faucet/claim
- Prompt mint (browser/captcha only): POST ${origin}/api/v1/faucet/prompt-token

## Mode A claim

Authorization: Bearer <JWT>
Body (optional): {"to":"<wallet matching JWT>"}

## Mode B claim (humans)

Body: {"to":"<C…/G…>","captchaToken":"<turnstile>"}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
}
