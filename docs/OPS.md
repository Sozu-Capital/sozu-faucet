# Sozu Faucet — ops runbook

## 1. Fund treasury with Friendbot (XLM fees)

```bash
bun run ops:fund-xlm
# or
./scripts/fund-treasury-xlm.sh G...
```

## 2. Get Circle testnet USDC onto the dispenser

**Treasury-transfer mode** (no `FAUCET_CONTRACT_ID`):

1. Hold Circle SAC USDC on the treasury G account.
2. Sources: [Circle testnet faucet](https://faucet.circle.com/) (Stellar), or transfer from another funded account.
3. Token contract (default): `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`

**Vault mode** (`FAUCET_CONTRACT_ID` set):

1. Fund treasury G with Circle SAC first.
2. Move into vault:

```bash
bun run ops:topup -- 100
```

## 3. Check balance / dry-run

```bash
bun run ops:balance
curl -s localhost:3010/api/health | jq
```

## 4. Smoke claim

```bash
bun run dev   # other terminal
bun run ops:smoke -- C...smart-account
```

Verify Soroban balances on Stellar Expert (testnet) for that C….

## 5. Cooldown / double-pay check

Run smoke twice quickly — second response should be:

```json
{ "success": false, "reason": "user_cooldown", "nextAvailableAt": "..." }
```

No second on-chain transfer.

## 6. Empty vault

Drain dispenser below `FAUCET_CLAIM_AMOUNT`. Claim should return `insufficient_vault` with **no** pending→success write (failed finalize only).

## Production notes

- Use Turso / hosted libsql (`DATABASE_URL` + `TURSO_AUTH_TOKEN`).
- Rotate `FAUCET_AUTH_SECRET` with the wallet deploy.
- Keep `ALLOWED_ORIGINS` tight.
- Never enable Mode B public claim without captcha.
