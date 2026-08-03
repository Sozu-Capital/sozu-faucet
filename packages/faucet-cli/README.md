# `@sozu/faucet`

Claim **testnet Circle USDC (SAC)** from [Sozu Faucet](https://faucet.sozu.capital) with one command. The CLI mints a short-lived PoW challenge, solves it locally, and claims — no browser, no captcha.

```bash
npx @sozu/faucet claim CABC...YOUR...ADDRESS
```

## Usage

```bash
npx @sozu/faucet claim <C_OR_G_ADDRESS> [--url https://faucet.sozu.capital]
```

| Flag / env | Meaning |
|---|---|
| `--url` | Faucet origin (default `https://faucet.sozu.capital`) |
| `SOZU_FAUCET_URL` | Same as `--url` |

Stdout: claim JSON. Stderr: progress (+ hints on common failures). Exit `0` on success.

**Classic G… wallets** need a Circle USDC trustline before claiming. The CLI
checks Horizon first and, if the trustline is missing, exits with
`trustline_required` plus a [Stellar Lab](https://lab.stellar.org/account/fund)
link — it never asks for your secret (you sign the trustline in Lab / Freighter).
Then re-run `claim`. **C…** smart accounts skip the trustline.

## Agent prompt

```
Claim testnet USDC from Sozu Faucet:

npx @sozu/faucet@latest claim <WALLET>

Print the JSON. On success, open:
https://stellar.expert/explorer/testnet/contract/<WALLET>
```

## Local (this monorepo)

```bash
node packages/faucet-cli/bin/sozu-faucet.js claim C... --url http://localhost:3010
```
