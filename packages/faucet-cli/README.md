# `@sozu/faucet`

Claim **testnet Circle USDC (SAC)** from [Sozu Faucet](https://faucet.sozu.capital) with one command. The CLI mints a short-lived PoW challenge, solves it locally, and claims — no browser, no captcha.

```bash
# Existing wallet
npx @sozu/faucet claim CABC...YOUR...ADDRESS

# No address → generate G… + Friendbot + USDC trustline + claim
npx @sozu/faucet claim
```

## Usage

```bash
npx @sozu/faucet claim [<C_OR_G_ADDRESS>] [--url https://faucet.sozu.capital]
```

| Flag / env | Meaning |
|---|---|
| `--url` | Faucet origin (default `https://faucet.sozu.capital`) |
| `SOZU_FAUCET_URL` | Same as `--url` |

Stdout: claim JSON. Stderr: progress (+ hints). Exit `0` on success.

### No address (new wallet)

Omitting the address generates a classic G… keypair locally, funds it with Friendbot, adds the Circle USDC trustline, then claims. The JSON includes `wallet.secret` once — save it.

### Existing G… (trustline)

Classic G… wallets need a Circle USDC trustline. The CLI checks Horizon and, if missing, exits with `trustline_required` plus a [Stellar Lab](https://lab.stellar.org/account/fund) link. It never asks for your secret. **C…** smart accounts claim directly.

## Agent prompt

```
Claim testnet USDC from Sozu Faucet:

npx @sozu/faucet@latest claim

# or with an existing address:
npx @sozu/faucet@latest claim <WALLET>

Print the JSON. If wallet.secret is present, tell the user to save it once.
On success, open Stellar Expert for the address.
```

## Local (this monorepo)

```bash
node packages/faucet-cli/bin/sozu-faucet.js claim --url http://localhost:3010
node packages/faucet-cli/bin/sozu-faucet.js claim C... --url http://localhost:3010
```
