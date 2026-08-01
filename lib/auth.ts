import { createHash, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getFaucetConfig, normalizeAddress } from "@/lib/config";

export type FaucetAuthContext = {
  userId: string;
  walletAddress: string;
};

function secretKey(): Uint8Array {
  const secret = getFaucetConfig().authSecret;
  if (!secret || secret.length < 16) {
    throw new Error("FAUCET_AUTH_SECRET must be set (≥16 chars).");
  }
  return new TextEncoder().encode(secret);
}

/** Mint a short-lived Mode A token (Wallet or ops smoke scripts). */
export async function mintFaucetToken(params: {
  userId: string;
  walletAddress: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const wallet = normalizeAddress(params.walletAddress);
  return new SignJWT({ wallet })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(params.userId)
    .setIssuedAt()
    .setExpirationTime(`${params.expiresInSeconds ?? 300}s`)
    .sign(secretKey());
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

/**
 * Mode A auth: Bearer JWT signed with FAUCET_AUTH_SECRET.
 * Payload: `{ sub: userId, wallet: "C…"|"G…" }`.
 *
 * Dev convenience: if FAUCET_AUTH_SECRET is set and request includes
 * matching `x-user-id` + `x-wallet-address` + `x-faucet-dev-key` equal
 * to the secret, accept (local demos only — never enable in public prod
 * without network isolation).
 */
export async function resolveAuth(
  request: Request,
): Promise<
  | { ok: true; ctx: FaucetAuthContext }
  | { ok: false; status: number; error: string; reason: "unauthorized" | "wallet_missing" | "invalid_address" }
> {
  const token = bearerToken(request);

  if (token) {
    try {
      const { payload } = await jwtVerify(token, secretKey());
      const userId = typeof payload.sub === "string" ? payload.sub : null;
      const walletRaw =
        typeof payload.wallet === "string"
          ? payload.wallet
          : typeof payload.walletAddress === "string"
            ? payload.walletAddress
            : null;

      if (!userId) {
        return {
          ok: false,
          status: 401,
          error: "Token missing subject (user id).",
          reason: "unauthorized",
        };
      }
      if (!walletRaw) {
        return {
          ok: false,
          status: 422,
          error: "Token missing wallet address.",
          reason: "wallet_missing",
        };
      }

      try {
        return {
          ok: true,
          ctx: { userId, walletAddress: normalizeAddress(walletRaw) },
        };
      } catch {
        return {
          ok: false,
          status: 422,
          error: "Token wallet address is not a valid C…/G… address.",
          reason: "invalid_address",
        };
      }
    } catch {
      return {
        ok: false,
        status: 401,
        error: "Invalid or expired faucet token.",
        reason: "unauthorized",
      };
    }
  }

  // Optional local/dev header path (explicit shared secret header).
  const devKey = request.headers.get("x-faucet-dev-key")?.trim();
  const userId = request.headers.get("x-user-id")?.trim();
  const wallet = request.headers.get("x-wallet-address")?.trim();
  const secret = getFaucetConfig().authSecret;

  if (devKey && userId && wallet && secret) {
    const a = Buffer.from(devKey);
    const b = Buffer.from(secret);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      try {
        return {
          ok: true,
          ctx: { userId, walletAddress: normalizeAddress(wallet) },
        };
      } catch {
        return {
          ok: false,
          status: 422,
          error: "x-wallet-address is not a valid C…/G… address.",
          reason: "invalid_address",
        };
      }
    }
  }

  return {
    ok: false,
    status: 401,
    error:
      "Missing auth. Send Authorization: Bearer <JWT> signed with FAUCET_AUTH_SECRET.",
    reason: "unauthorized",
  };
}

export function softHash(value: string | null | undefined): string | null {
  if (!value) return null;
  const salt = getFaucetConfig().hashSalt;
  return createHash("sha256").update(`${salt}:${value}`).digest("hex");
}

export function clientIp(request: Request): string | null {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip");
}
