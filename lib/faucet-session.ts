/**
 * Client-side Mode A session helpers for "Login with Sozu" handoff.
 * Wallet mints the JWT; faucet only stores/displays it and sends Bearer on claim.
 * Server-side verification stays in lib/auth.ts.
 */

export const FAUCET_SESSION_KEY = "sozu.faucet.modeAToken";

export type FaucetSession = {
  token: string;
  userId: string;
  walletAddress: string;
  /** unix seconds */
  exp: number;
};

function base64UrlToJson(segment: string): unknown {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const json = atob(padded + pad);
  return JSON.parse(json) as unknown;
}

/** Decode JWT payload for UI only — claim endpoint still verifies signature. */
export function decodeFaucetToken(token: string): FaucetSession | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = base64UrlToJson(parts[1]) as {
      sub?: unknown;
      wallet?: unknown;
      walletAddress?: unknown;
      exp?: unknown;
    };
    const userId = typeof payload.sub === "string" ? payload.sub : null;
    const walletRaw =
      typeof payload.wallet === "string"
        ? payload.wallet
        : typeof payload.walletAddress === "string"
          ? payload.walletAddress
          : null;
    const exp = typeof payload.exp === "number" ? payload.exp : null;
    if (!userId || !walletRaw || exp === null) return null;
    const walletAddress = walletRaw.trim().toUpperCase();
    if (!/^[CG][A-Z0-9]{55}$/.test(walletAddress)) return null;
    return { token, userId, walletAddress, exp };
  } catch {
    return null;
  }
}

export function isSessionExpired(session: FaucetSession, nowMs = Date.now()): boolean {
  return session.exp * 1000 <= nowMs;
}

export function readStoredSession(): FaucetSession | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(FAUCET_SESSION_KEY);
  if (!raw) return null;
  const session = decodeFaucetToken(raw);
  if (!session || isSessionExpired(session)) {
    sessionStorage.removeItem(FAUCET_SESSION_KEY);
    return null;
  }
  return session;
}

export function storeSession(token: string): FaucetSession | null {
  const session = decodeFaucetToken(token);
  if (!session || isSessionExpired(session)) {
    sessionStorage.removeItem(FAUCET_SESSION_KEY);
    return null;
  }
  sessionStorage.setItem(FAUCET_SESSION_KEY, token);
  return session;
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(FAUCET_SESSION_KEY);
}

export function walletHandoffUrl(returnUrl: string): string {
  const walletOrigin = (
    process.env.NEXT_PUBLIC_WALLET_URL || "https://wallet.sozu.capital"
  ).replace(/\/$/, "");
  const url = new URL(`${walletOrigin}/auth/faucet-handoff`);
  url.searchParams.set("return", returnUrl);
  return url.toString();
}

/** Short display: CABC…WXYZ */
export function shortAddress(addr: string): string {
  const a = addr.trim().toUpperCase();
  if (a.length < 10) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}
