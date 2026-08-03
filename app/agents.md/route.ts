import { getFaucetConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET /agents.md — agent-readable faucet docs.
 */
export async function GET(request: Request) {
  let claimAmount = 20;
  let cooldownMinutes = 120;
  let dailyLimit = 5000;
  let slug = "sozu-testnet";

  try {
    const cfg = getFaucetConfig();
    claimAmount = cfg.claimAmount;
    cooldownMinutes = cfg.cooldownMinutes;
    dailyLimit = cfg.dailyLimit;
    slug = cfg.slug;
  } catch {
    // serve docs shell even if payout config is incomplete
  }

  const origin = new URL(request.url).origin;
  const isLocal =
    origin.includes("localhost") || origin.includes("127.0.0.1");
  const urlFlag = isLocal ? ` --url ${origin}` : "";

  const body = `# Sozu Faucet — Agent guide

Testnet Circle USDC (SAC). Base: \`${origin}\`

## Happy path (preferred)

One shell command. No browser. No captcha. No JWT. Never ask humans for secret keys.

\`\`\`bash
# Existing C… / G… wallet
npx @sozu/faucet@latest claim <C_OR_G_ADDRESS>${urlFlag}

# No address → generate G… + Friendbot + USDC trustline + claim
npx @sozu/faucet@latest claim${urlFlag}
\`\`\`

The CLI: (optional wallet prep) → PoW → claim. Print the JSON.
If \`wallet.secret\` is present, tell the user to save it once.

On the site: **Copy prompt** (with or without a recipient) → paste into agent.

Agent Skill (install once, then say "get testnet dollars"):
\`https://github.com/blessedux/agent-skills/blob/main/sozu-faucet/SKILL.md\`
\`npx skills add https://github.com/blessedux/agent-skills --skill sozu-faucet\`

## Mode C — PoW (what the CLI uses)

1. \`POST ${origin}/api/v1/faucet/pow/challenge\` body \`{"to":"<WALLET>"}\`
2. Solve: SHA-256(\`prefix:challengeId:to:nonce\`) with \`difficulty\` leading zero bits
3. \`POST ${origin}/api/v1/faucet/claim\` body:

\`\`\`json
{"to":"<WALLET>","pow":{"challengeId":"<id>","nonce":"<n>"}}
\`\`\`

Prefer the CLI over hand-rolling this.

## Mode A — Bearer JWT (wallet embed)

\`\`\`bash
curl -sS -X POST ${origin}/api/v1/faucet/claim \\
  -H "Authorization: Bearer <JWT>" \\
  -H "Content-Type: application/json" \\
  -d '{"to":"<WALLET_BOUND_IN_JWT>"}'
\`\`\`

Wallet apps mint with shared \`FAUCET_AUTH_SECRET\`.

## Mode B — browser + captcha (humans on the site)

\`\`\`bash
curl -sS -X POST ${origin}/api/v1/faucet/claim \\
  -H "Content-Type: application/json" \\
  -d '{"to":"<C_OR_G_ADDRESS>","captchaToken":"<TURNSTILE_TOKEN>"}'
\`\`\`

Agents cannot obtain a Turnstile token. Use Mode C / \`npx @sozu/faucet\`.

## Status

\`\`\`bash
curl -sS "${origin}/api/v1/faucet/status"
curl -sS "${origin}/api/v1/faucet/status?wallet=<C_OR_G_ADDRESS>"
\`\`\`

## Limits

| Control | Value |
|---|---|
| Claim amount | ${claimAmount} USDC |
| Per-wallet cooldown | ${cooldownMinutes} minutes |
| Daily budget | ${dailyLimit} USDC |
| Slug | ${slug} |
| Network | Stellar testnet |

Failed claims do not consume cooldown.

## Classic G… accounts

G… wallets **cannot** receive Circle USDC until they have a trustline for
\`USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5\`.

- **No address** (\`npx @sozu/faucet claim\`): CLI generates a G…, Friendbots it,
  adds the trustline with the local secret, then claims. Secret appears once in JSON.
- **Existing G… without trustline**: \`trustline_required\` + \`helpUrl\` (Stellar Lab).
  User adds the trustline there — never collect secrets in chat.
- **C…**: claim directly (no trustline).

## Verify

On success, open Stellar Expert testnet for the wallet (contract/ for C…, account/ for G…).

More: ${origin}/llms.txt · OpenAPI in repo \`openapi.yaml\`
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
}
