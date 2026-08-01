# Sozu Faucet

Friendbot-like **one-click** testnet **Circle USDC (SAC)** for Sozu wallets.

```
Wallet / UI  →  Sozu Faucet API  →  Treasury / Vault  →  Circle USDC SAC → C… (or G…)
```

Not Friendbot (XLM). Not Circle.com’s product UI. Not Blend mint/borrow. **Sozu-owned**, API-first, embeddable.

| | Friendbot | Circle.com faucet | Blend flows | **Sozu Faucet** |
|---|---|---|---|---|
| Asset | XLM | USDC (multi-chain) | BlendUSDC / pool | **Circle USDC SAC** |
| Network | Stellar testnet | Various | Stellar testnet | **Stellar testnet only** |
| UX | One click → funded | Form + rate limits | Mint/borrow steps | **One intentional click** |
| Owner | SDF | Circle | Blend | **Sozu** |
| Embed | Horizon URL | External site | App-specific | **Wallet `POST /claim`** |

---

## Quick start (local dev)

```bash
cp .env.example .env.local
# Edit .env.local:
#   FAUCET_AUTH_SECRET=local-dev-secret-at-least-16chars
#   FAUCET_TREASURY_SECRET=S... (testnet secret key)
#   TURNSTILE_SECRET_KEY=... (optional for dev, required for prod)
#   NEXT_PUBLIC_TURNSTILE_SITE_KEY=... (optional)
npm install
npm run db:migrate
npm run dev          # http://localhost:3010
```

Fund treasury (testnet):

```bash
npm run ops:fund-xlm      # Friendbot XLM for fees
npm run ops:balance       # Check vault/treasury USDC balance
npm run ops:topup -- 100  # If using vault contract
# with server running:
npm run ops:smoke -- C...your-smart-account
```

## Testnet go-live (production deploy)

See [`docs/OPS.md`](./docs/OPS.md) for the full checklist. Quick summary:

1. **Secrets:** Set production env on Vercel — `FAUCET_TREASURY_SECRET`, `FAUCET_AUTH_SECRET`, Turnstile keys, `DATABASE_URL` (Turso), `ALLOWED_ORIGINS=https://faucet.sozu.capital`.
2. **DB:** Create Turso DB → set `DATABASE_URL` + `TURSO_AUTH_TOKEN` → `npm run db:migrate`.
3. **Deploy:** Vercel project → custom domain `faucet.sozu.capital` → verify `/api/health`.
4. **Fund:** Friendbot treasury XLM → Circle testnet faucet for USDC → verify balance.
5. **Smoke:** Paste a C… on live site → captcha → claim → check Stellar Expert.

Mainnet is refused by config guard (`STELLAR_NETWORK=testnet` enforced).

---

## API (v1)

Base: `/api/v1/faucet` (Next.js). Wallet can treat `SOZU_FAUCET_URL` as origin and call these paths.

### `GET /api/v1/faucet/status`

Public. Optional `Authorization: Bearer <JWT>` adds user cooldown.

```json
{
  "faucet": {
    "slug": "sozu-testnet",
    "name": "Sozu Faucet",
    "claimAmount": 20,
    "dailyLimit": 5000,
    "status": "active",
    "asset": "circle_usdc_sac",
    "network": "testnet",
    "cooldownMinutes": 120
  },
  "availability": {
    "available": true,
    "remainingToday": 4980,
    "reason": null,
    "nextAvailableAt": null
  }
}
```

Reasons: `inactive | empty_today | insufficient_vault | global_cooldown | user_cooldown`

### `POST /api/v1/faucet/claim`

**Mode A (required for v1):** Bearer JWT signed with `FAUCET_AUTH_SECRET`.

JWT claims:

```json
{ "sub": "<userId>", "wallet": "C…", "exp": "…" }
```

Optional body: `{ "to": "C…", "slug": "sozu-testnet" }` — `to` must match JWT wallet.

Success:

```json
{
  "success": true,
  "amount": 20,
  "asset": "circle_usdc_sac",
  "network": "testnet",
  "to": "C...",
  "txHash": "...",
  "nextAvailableAt": "..."
}
```

Failure:

```json
{
  "success": false,
  "amount": 20,
  "error": "human message",
  "reason": "user_cooldown",
  "nextAvailableAt": "..."
}
```

### `GET /api/health`

Ops: vault/treasury balance, `canCoverClaim`, daily remaining.

### Rate limits (v1)

| Control | Default | Env |
|---|---|---|
| Per-user / per-wallet cooldown | **120 minutes** (Circle-like) | `FAUCET_COOLDOWN_MINUTES` |
| Daily budget | 5000 USDC | `FAUCET_DAILY_LIMIT` |
| Global gap between claims | off | `FAUCET_GLOBAL_COOLDOWN_MINUTES` |
| Soft abuse signals | IP hash + UA hash | `FAUCET_HASH_SALT` |

Failed claims do **not** consume cooldown or daily budget.

---

## Auth (Wallet ↔ Faucet)

### Mode A — JWT auth (implemented)

Sozu Wallet mints a short-lived HS256 JWT with the shared `FAUCET_AUTH_SECRET` and calls claim. Faucet pays the bound `wallet` only — no arbitrary third-party addresses.

See `lib/client.ts` helpers the wallet can copy/import later.

### Mode B — public paste + captcha (implemented)

Public claim UI: paste C…/G… + Turnstile captcha + strict per-wallet cooldown.

### Login with Sozu — OAuth-style handoff (planned v1.1)

User clicks "Login with Sozu" → redirects to Wallet → passkey → back to faucet with short-lived JWT.

See [`docs/SOZU_LOGIN_HANDOFF.md`](./docs/SOZU_LOGIN_HANDOFF.md) for implementation spec.

CORS: `ALLOWED_ORIGINS` allowlist.

---

## Asset (locked)

| Field | Value |
|---|---|
| Network | Stellar **testnet** |
| Asset | Circle USDC SAC |
| Issuer | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| Decimals | 7 |
| Default SAC | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

Override with `FAUCET_TOKEN_CONTRACT_ID` / `TESTNET_CIRCLE_USDC_SAC_CONTRACT_ADDRESS`.

Mainnet config is **refused** (`STELLAR_NETWORK` must be `testnet`).

---

## Payout rail

1. **Preferred:** `FAUCET_CONTRACT_ID` vault → `claim(to, amount)` (treasury admin)
2. **Fallback:** treasury G SEP-41 `transfer` of Circle SAC → recipient

Treasury needs testnet XLM for fees (`bun run ops:fund-xlm`).

---

## Env

See [`.env.example`](./.env.example). Never expose `FAUCET_TREASURY_SECRET` to the client.

DB: libsql (`DATABASE_URL=file:./data/faucet.db` locally; Turso URL + `TURSO_AUTH_TOKEN` in prod).

---

## Wallet embed (later)

```
POST {SOZU_FAUCET_URL}/api/v1/faucet/claim
Authorization: Bearer <wallet-minted JWT>
→ refresh Circle SAC balance on C…
```

No redirect. One button. Friendbot energy.

More ops detail: [`docs/OPS.md`](./docs/OPS.md) · OpenAPI: [`openapi.yaml`](./openapi.yaml)
