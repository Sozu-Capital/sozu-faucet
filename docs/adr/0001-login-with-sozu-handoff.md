# Login with Sozu: Redirect Handoff first, App-owned popup later

Faucet must let users authenticate with their Sozu identity without hosting passkeys on `faucet.sozu.capital`. We ship **Redirect Handoff (v1)** now (full-page Faucet → `app.sozu.capital` → back with a short-lived Mode A JWT), then **In-Faucet Auth (v2)** as an App-owned **popup** that returns the same Mode A token via `postMessage`/`opener`, keeping Redirect Handoff as fallback. Passkeys and minting stay on Sozu App; Faucet only verifies Mode A and pays the bound wallet.

## Status

accepted

## Considered options

- **In-faucet WebAuthn on faucet origin** — rejected: splits identity from Sozu App RP ID.
- **App iframe as v2 default** — rejected for now: WebAuthn-in-iframe is unreliable (esp. Safari); popup-first is the target.
- **Wildcard Vercel preview return allowlist** — rejected: open-redirect risk; v1 done means prod + localhost only.
- **Manual claim after login (v1)** — rejected: product wants **auto-claim on return** with clear failure copy.

## Consequences

- Canonical App host is `app.sozu.capital` (staging `dev.sozu.capital`), not `wallet.sozu.capital`.
- Setup Incomplete (no `C…`) stays on App; no token until setup finishes.
- Guest paste / `$sozutag` / CLI remain first-class alongside Login.
- See root `CONTEXT.md` for terms.
