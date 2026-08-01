import { getFaucetConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET /agents.md — agent-readable faucet docs (fallback; happy path is Copy prompt).
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

  const body = `# Sozu Faucet — Agent guide

Testnet Circle USDC (SAC). Base: \`${origin}\`

## Happy path (preferred)

On ${origin}, enter a C…/G… (or $sozutag), complete captcha, click **Copy prompt**.
Paste into your agent. The clipboard already contains a short-lived Mode A JWT + exact claim curl.
**Do not hunt for secrets. Do not solve Turnstile. One curl.**

## Mode A — Bearer JWT (automation)

\`\`\`bash
curl -sS -X POST ${origin}/api/v1/faucet/claim \\
  -H "Authorization: Bearer <JWT>" \\
  -H "Content-Type: application/json" \\
  -d '{"to":"<WALLET_BOUND_IN_JWT>"}'
\`\`\`

- JWT is HS256, claims: \`sub\` (user id), \`wallet\` (C…/G…), short \`exp\` (~5m for prompt tokens).
- Optional body \`to\` must match the JWT wallet.
- Wallet apps mint with shared \`FAUCET_AUTH_SECRET\`. Browser **Copy prompt** mints via \`POST /api/v1/faucet/prompt-token\` (captcha-gated) — agents never call that.

## Mode B — public paste + captcha (humans in browser)

\`\`\`bash
curl -sS -X POST ${origin}/api/v1/faucet/claim \\
  -H "Content-Type: application/json" \\
  -d '{"to":"<C_OR_G_ADDRESS>","captchaToken":"<TURNSTILE_TOKEN>"}'
\`\`\`

Agents cannot obtain a Turnstile token. Use Mode A / Copy prompt instead.

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
