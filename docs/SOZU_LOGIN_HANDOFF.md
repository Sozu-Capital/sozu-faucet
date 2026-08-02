# Sozu Login — Redirect Handoff (v1)

**Status:** Implemented on Faucet `feature/sozu-login` + App `/auth/faucet-handoff`. Decisions: [`docs/adr/0001-login-with-sozu-handoff.md`](./adr/0001-login-with-sozu-handoff.md), terms in root `CONTEXT.md`.

---

## Product goal

User taps **"Login with Sozu"** on the faucet site → **Redirect Handoff** to Sozu App → passkey login (if needed) → back to faucet with a short-lived **Mode A Token** → Faucet **auto-claims** once (clear errors if cooldown/empty/expired).

No passkey UI on the faucet domain. No long-lived faucet sessions. Testnet-only. Guest paste / `$sozutag` / CLI remain.

The faucet remains embeddable in the App Deposit flow (Mode A JWT minting in-app).

---

## Flow

```
User on faucet.sozu.capital
  → clicks "Login with Sozu"
  → redirect to app.sozu.capital/auth/faucet-handoff?return=https://faucet.sozu.capital/
  → (App checks session; prompts passkey if needed)
  → App mints HS256 JWT { sub: userId, wallet: C…, exp: ~5m }
  → redirect to https://faucet.sozu.capital/?token=<JWT>
  → Faucet:
      - reads token from query param
      - stores in sessionStorage, strips from URL
      - shows "Logged in as C…xxxxx"
      - Auto-Claim on Return (Mode A Bearer) once
  → On claim failure: clear error (cooldown / empty vault / expired session)
  → Token expires in ~5m; faucet shows "Session expired, log in again"
```

---

## Wallet changes

### 1. New route: `/auth/faucet-handoff`

Query params:
- `return` (required): faucet callback URL (allowlisted: `https://faucet.sozu.capital`, `http://localhost:3010` for dev)

Steps:
1. Check if user is logged in (has valid passkey session).
2. If not → redirect to `/auth?faucet=1&return=<return>` (standard passkey login, then back to this route).
3. If yes → mint JWT and redirect.

### 2. Mint JWT helper

Reuse the faucet Mode A JWT shape (already in Wallet env as `FAUCET_AUTH_SECRET`, or add it):

```ts
import { SignJWT } from "jose";

async function mintFaucetToken(params: {
  userId: string;
  walletAddress: string; // user's C… smart account
  expiresInSeconds?: number;
}): Promise<string> {
  const secret = new TextEncoder().encode(
    process.env.FAUCET_AUTH_SECRET!,
  );
  return new SignJWT({ wallet: params.walletAddress })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(params.userId)
    .setIssuedAt()
    .setExpirationTime(`${params.expiresInSeconds ?? 300}s`)
    .sign(secret);
}
```

### 3. Redirect back with token

```ts
const token = await mintFaucetToken({ userId, walletAddress, expiresInSeconds: 300 });
const returnUrl = new URL(query.return);
returnUrl.searchParams.set("token", token);
return Response.redirect(returnUrl.toString());
```

### 4. CORS / allowlist

- Wallet `/auth/faucet-handoff` must allowlist `return` origins: `https://faucet.sozu.capital`, `http://localhost:3010`.
- Faucet env `ALLOWED_ORIGINS` must include Wallet origin (already standard for other flows).

---

## Faucet changes

### 1. New client-side: login button + session UI

On [`app/page.tsx`](../app/page.tsx):

- Show **"Login with Sozu"** button when no token in state.
- On click → redirect to `https://app.sozu.capital/auth/faucet-handoff?return=${encodeURIComponent(window.location.origin + "/")}`.
- On mount: check `?token=` query param:
  - If present → store in `sessionStorage`, remove from URL, show logged-in UI, **auto-claim once**.
- Manual Claim still available while session is valid.
- Token expiry: catch 401 from claim → clear session → show "Session expired, log in again".

No passkey logic on faucet domain — Wallet owns all auth.

### 2. Optional: session state indicator

Top-right corner: "Logged in as C…xxxxx | Log out" (clears sessionStorage, reloads).

### 3. Mode A claim keeps existing logic

The `/api/v1/faucet/claim` Mode A path already supports Bearer JWT → pays the bound wallet. No backend changes needed beyond UI wiring.

---

## Security / abuse

- JWT expires in ~5 minutes → no long-lived sessions.
- Faucet cooldown still applies per `userId` + `walletAddress` (same as today).
- Mode A claims don't bypass cooldown — they just skip captcha (user already authenticated via passkey).
- Wallet `/auth/faucet-handoff` must validate `return` URL against allowlist (prevent open redirect).

---

## Shared env

Both repos need:

```
FAUCET_AUTH_SECRET=<long-random-string>
```

Wallet mints, Faucet verifies. Same HS256 secret.

---

## Non-goals (this handoff)

- Passkeys hosted on `faucet.sozu.capital` domain
- Long-lived faucet sessions (> 5m)
- Mainnet support
- Wallet Deposit button changes (that flow already uses Mode A JWT minting in-app, no redirect)

---

## Testing locally

1. Wallet: `FAUCET_AUTH_SECRET=local-test-secret npm run dev` (port 3000)
2. Faucet: `FAUCET_AUTH_SECRET=local-test-secret npm run dev` (port 3010)
3. Wallet: implement `/auth/faucet-handoff?return=http://localhost:3010/`
4. Faucet: add login button → redirect to `http://localhost:3000/auth/faucet-handoff?return=...`
5. Smoke: click login → passkey → back to faucet with `?token=` → claim with Mode A.

---

## When to ship

After public Mode B paste claim is live and stable (v1). Handoff is v1.1+.

Wallet team can start on `/auth/faucet-handoff` route independently — no Faucet changes block it. Faucet UI integration is the final step once Wallet route is ready.
