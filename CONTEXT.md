# Sozu Faucet

Testnet Circle USDC (SAC) faucet for Stellar — browser claim, terminal claim, and Wallet-authenticated claim.

## Language

**Redirect Handoff (v1)**:
Full-page trip from Faucet → Sozu App auth → back to Faucet with a short-lived Mode A JWT (`?token=`).
_Done when_: works for `faucet.sozu.capital` ↔ `app.sozu.capital` and localhost pairs — not arbitrary Vercel previews.
_Avoid_: OAuth (unless speaking loosely), webhook (this is not a webhook)

**In-Faucet Auth (v2)**:
Auth UX on the Faucet page that does not full-navigate away as the primary path. Target mechanism: **App-owned popup** on `app.sozu.capital` (passkeys stay on App origin); Faucet shows a waiting overlay and receives a **Mode A Token** via `postMessage` / `opener`. Iframe is a fallback candidate only if a later spike proves WebAuthn-in-iframe is reliable.
_Avoid_: hosting passkeys on `faucet.sozu.capital`; calling this a webhook; assuming iframe-first

**Auto-Claim on Return**:
v1 behavior: after accepting a fresh **Mode A Token** from handoff, Faucet immediately attempts one Mode A claim and shows success or a clear failure reason.
_Avoid_: silent login-without-funds when the user expected USDC

**Sozu App**:
The passkey wallet product hosted at `app.sozu.capital` (staging: `dev.sozu.capital`).
_Avoid_: wallet.sozu.capital (stale name in older faucet docs/defaults)

**Mode A Token**:
Short-lived HS256 JWT minted by Sozu App with shared `FAUCET_AUTH_SECRET`; Faucet verifies and pays only the bound wallet.
_Avoid_: session cookie, long-lived faucet login

**Setup Incomplete**:
Authenticated Sozu App user without a claimable smart account (`C…`) yet; handoff must not mint a Mode A Token until setup is finished.
_Avoid_: “no wallet” as a vague error without this name

## Relationships

- **Redirect Handoff (v1)** produces a **Mode A Token** that Faucet stores briefly and uses for claim
- **In-Faucet Auth (v2)** also ends in a **Mode A Token** (or equivalent Mode A claim); it does not replace Mode A
- **Sozu App** owns passkeys and minting; Faucet never hosts passkey ceremony in v1
- If Setup Incomplete (no smart account `C…`), **Redirect Handoff (v1)** stays on **Sozu App**; user finishes setup there and retries from Faucet
- On successful handoff return with a **Mode A Token**, Faucet **auto-claims** once; failures must surface clear errors (cooldown, empty vault, expired token) without silent no-ops
- **In-Faucet Auth (v2)** uses an **App-owned popup**; it still ends in a **Mode A Token**, same claim rail as v1
- Guest paste / `$sozutag` / CLI remain first-class alongside Login (v1); UI soft-deprecate of paste is optional later polish, not a Login requirement
- Ship order: **Redirect Handoff (v1)** first; then popup default (**In-Faucet Auth v2**) with Redirect Handoff kept as fallback

## Example dialogue

> **Dev:** “Login with Sozu failed on the preview — is the webhook broken?”
> **Domain expert:** “There is no webhook. v1 is a **Redirect Handoff**. If App doesn’t return you, the `return` origin is probably not allowlisted — or Faucet is still pointing at the wrong **Sozu App** host.”
>
> **Dev:** “For v2 can we just mount the auth React tree on the faucet?”
> **Domain expert:** “No. Passkeys belong to **Sozu App**. v2 is an **App-owned popup** that hands back a **Mode A Token**.”

## Flagged ambiguities

- “webhook” was used for the return-to-faucet step — resolved: that step is **Redirect Handoff**, not a webhook.
- “wallet.sozu.capital” vs **Sozu App** (`app.sozu.capital`) — resolved: use **Sozu App** / `app.sozu.capital`.
- Preview deployments are out of scope for calling **Redirect Handoff (v1)** done — use prod or localhost.
- New-account handoff with no `C…`: stay on App (**Setup Incomplete**), not return-to-Faucet with a soft error (v1).
- Post-login claim: **auto-claim on return** (not wait for a second click), with explicit error copy when claim cannot complete.
- v2 embedding: **popup-first** App-owned window on `app.sozu.capital`, not Faucet-hosted WebAuthn; iframe not the default.
- Guest claim paths stay (paste / sozutag / CLI); Login does not replace them in v1.
- After v2: popup is default UX; **Redirect Handoff** remains the fallback rail.
