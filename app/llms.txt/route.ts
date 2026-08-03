import { getFaucetConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET /llms.txt — short machine-oriented pointer for agents.
 */
export async function GET(request: Request) {
  let claimAmount = 100;
  let cooldownMinutes = 60;

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
npx @sozu/faucet@latest claim${urlFlag}
\`\`\`

One command. Omit address to generate G… + trustline + claim. CLI solves PoW. No browser. No Turnstile. Never ask humans for secret keys or FAUCET_AUTH_SECRET.

## Docs

- Skill: https://github.com/blessedux/agent-skills/blob/main/sozu-faucet/SKILL.md
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

## Classic G… accounts

G… needs Circle USDC trustline \`USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5\`.
Bare \`claim\` creates wallet+trustline. Existing G… without trustline → \`trustline_required\` + Stellar Lab \`helpUrl\`. Never collect secrets in chat. C… skips trustline.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
}
