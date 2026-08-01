# Sozu Faucet — ops runbook

## Testnet go-live checklist

Follow these steps in order to deploy `faucet.sozu.capital` on Vercel and fund it.

### 1. Create Turso database

```bash
# Install Turso CLI if needed
brew install tursodatabase/tap/turso

# Create DB
turso db create sozu-faucet-prod

# Get connection string and auth token
turso db show sozu-faucet-prod --url
turso db tokens create sozu-faucet-prod
```

Save the URL (`libsql://...turso.io`) and token.

### 2. Set production env on Vercel

In Vercel project settings → Environment Variables, add:

```bash
# Network (testnet-only)
STELLAR_NETWORK=testnet
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
HORIZON_URL=https://horizon-testnet.stellar.org

# Treasury (never expose to client)
FAUCET_TREASURY_SECRET=S...  # testnet secret key
FAUCET_CONTRACT_ID=          # optional vault contract
FAUCET_TOKEN_CONTRACT_ID=    # optional override (defaults to Circle SAC)

# Faucet config
FAUCET_SLUG=sozu-testnet
FAUCET_NAME=Sozu Faucet
FAUCET_CLAIM_AMOUNT=20
FAUCET_DAILY_LIMIT=5000
FAUCET_COOLDOWN_MINUTES=120
FAUCET_GLOBAL_COOLDOWN_MINUTES=0

# Auth
FAUCET_AUTH_SECRET=...       # shared with Wallet for Mode A (≥16 chars)
FAUCET_HASH_SALT=sozu-faucet-v1

# Captcha (Turnstile)
TURNSTILE_SECRET_KEY=...
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...
FAUCET_REQUIRE_CAPTCHA=true

# Database (Turso)
DATABASE_URL=libsql://...turso.io
TURSO_AUTH_TOKEN=...

# CORS
ALLOWED_ORIGINS=https://faucet.sozu.capital,https://wallet.sozu.capital

# Public URL (for UI API strip)
NEXT_PUBLIC_FAUCET_PUBLIC_URL=https://faucet.sozu.capital
```

**Get Turnstile keys:** [Cloudflare Turnstile dashboard](https://dash.cloudflare.com/?to=/:account/turnstile) → Add Site → Invisible/Managed widget → copy Site Key + Secret Key.

### 3. Deploy to Vercel

```bash
# Install Vercel CLI if needed
npm i -g vercel

# Link project (first time)
vercel link

# Deploy
vercel --prod
```

Or push to main branch if GitHub integration is set up.

### 4. Configure custom domain

Vercel project → Settings → Domains → Add `faucet.sozu.capital` → follow DNS instructions.

### 5. Run migration against prod DB

```bash
# Set env locally for migration
export DATABASE_URL=libsql://...turso.io
export TURSO_AUTH_TOKEN=...
export STELLAR_NETWORK=testnet

npm run db:migrate
```

### 6. Verify deployment health

```bash
curl https://faucet.sozu.capital/api/health | jq
curl https://faucet.sozu.capital/api/v1/faucet/status | jq
```

Should return faucet config + availability. Initially `canCoverClaim: false` (no funds yet).

### 7. Fund treasury with XLM (Friendbot)

Locally (or in a secure environment):

```bash
# Extract treasury public key from secret
node -e "const{Keypair}=require('@stellar/stellar-sdk');console.log(Keypair.fromSecret(process.env.FAUCET_TREASURY_SECRET).publicKey())"

# Fund via Friendbot
curl "https://friendbot.stellar.org?addr=G..."
```

Or use the script:

```bash
npm run ops:fund-xlm
```

Verify:

```bash
curl "https://horizon-testnet.stellar.org/accounts/G..." | jq '.balances'
```

Should show XLM balance (~10,000 XLM).

### 8. Fund treasury with Circle USDC SAC

**Option A: Circle testnet faucet**

1. Go to [Circle testnet faucet](https://faucet.circle.com/)
2. Select **Stellar testnet USDC**
3. Paste treasury **G…** address
4. Request funds (usually 1000 USDC per request)

**Option B: Transfer from another funded account**

If you have Circle SAC USDC on another testnet account, transfer to the treasury G address using Stellar Lab or CLI.

**Verify balance:**

```bash
npm run ops:balance
```

Or hit the health endpoint:

```bash
curl https://faucet.sozu.capital/api/health | jq '.vault'
```

Should show:

```json
{
  "mode": "treasury_transfer",
  "balanceUsdc": 1000,
  "canCoverClaim": true
}
```

### 9. Smoke test on live site

1. Open `https://faucet.sozu.capital`
2. Paste a known testnet C… or G… address (create one in Wallet if needed)
3. Complete captcha
4. Click "Get 20 testnet USDC"
5. Wait for success message + tx hash
6. Verify on [Stellar Expert](https://stellar.expert/explorer/testnet):
   - Search for the recipient address
   - Check Soroban balances → should show 20.0000000 Circle USDC (SAC)

### 10. Test cooldown

Immediately try to claim again with the same address. Should return:

```json
{
  "success": false,
  "reason": "user_cooldown",
  "error": "You already claimed recently. Wait for the cooldown to end.",
  "nextAvailableAt": "2026-08-01T13:00:00.000Z"
}
```

No second on-chain transfer should occur.

---

## Local dev ops

### Fund treasury with Friendbot (XLM fees)

```bash
npm run ops:fund-xlm
# or
./scripts/fund-treasury-xlm.sh G...
```

### Get Circle testnet USDC onto the dispenser

**Treasury-transfer mode** (no `FAUCET_CONTRACT_ID`):

1. Hold Circle SAC USDC on the treasury G account.
2. Sources: [Circle testnet faucet](https://faucet.circle.com/) (Stellar), or transfer from another funded account.
3. Token contract (default): `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`

**Vault mode** (`FAUCET_CONTRACT_ID` set):

1. Fund treasury G with Circle SAC first.
2. Move into vault:

```bash
npm run ops:topup -- 100
```

### Check balance / dry-run

```bash
npm run ops:balance
curl -s localhost:3010/api/health | jq
```

### Smoke claim (local)

```bash
npm run dev   # other terminal
npm run ops:smoke -- C...smart-account
```

Verify Soroban balances on Stellar Expert (testnet) for that C….

### Cooldown / double-pay check

Run smoke twice quickly — second response should be:

```json
{ "success": false, "reason": "user_cooldown", "nextAvailableAt": "..." }
```

No second on-chain transfer.

### Empty vault test

Drain dispenser below `FAUCET_CLAIM_AMOUNT`. Claim should return `insufficient_vault` with **no** pending→success write (failed finalize only).

---

## Production maintenance

### Monitor health

```bash
curl https://faucet.sozu.capital/api/health | jq
```

Check:
- `vault.canCoverClaim` — should be `true`
- `remainingToday` — USDC left in daily budget
- `vault.balanceUsdc` — total dispenser balance

### Top up when low

When `vault.balanceUsdc` drops below desired threshold (~100 USDC):

1. Fund treasury G via Circle testnet faucet (repeat as needed)
2. If using vault contract: `npm run ops:topup -- <amount>`
3. Verify: `curl https://faucet.sozu.capital/api/health | jq '.vault'`

### Rotate secrets

When rotating `FAUCET_AUTH_SECRET`:

1. Update in Vercel env vars
2. Redeploy
3. Update in Wallet `.env` (if using Mode A JWT)
4. Coordinate timing to avoid auth failures during rotation

### View claims audit log

Query Turso DB:

```bash
turso db shell sozu-faucet-prod
```

```sql
-- Recent successful claims
SELECT * FROM faucet_claims 
WHERE status = 'success' 
ORDER BY claimed_at DESC 
LIMIT 20;

-- Daily totals
SELECT 
  date(claimed_at) as day,
  COUNT(*) as claims,
  SUM(amount) as total_usdc
FROM faucet_claims
WHERE status = 'success'
GROUP BY day
ORDER BY day DESC;
```

---

## Production notes

- Use Turso / hosted libsql (`DATABASE_URL` + `TURSO_AUTH_TOKEN`). Local `file:` DB won't work on Vercel.
- Rotate `FAUCET_AUTH_SECRET` when sharing with new services.
- Keep `ALLOWED_ORIGINS` tight (only trusted domains).
- Never disable captcha in production (`FAUCET_REQUIRE_CAPTCHA=true` or `NODE_ENV=production`).
- Monitor vault balance daily — set up alerts when < 100 USDC.
- Circle testnet faucet has its own rate limits — request early/often as needed.
