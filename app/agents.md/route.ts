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

One shell command. No browser. No captcha. No JWT.

\`\`\`bash
npx @sozu/faucet@latest claim <C_OR_G_ADDRESS>${urlFlag}
\`\`\`

The CLI: mints a PoW challenge → solves it locally (~a few seconds) → claims.
Paste into your agent as a single action. Print the JSON.

On the site: enter address → **Copy prompt** → paste into agent (same command).

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

## Verify

On success, open: \`https://stellar.expert/explorer/testnet/contract/<WALLET>\`

More: ${origin}/llms.txt · OpenAPI in repo \`openapi.yaml\`
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
}
