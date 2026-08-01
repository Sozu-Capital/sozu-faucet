import { Asset, Keypair, Networks } from "@stellar/stellar-sdk";

const CIRCLE_TESTNET_ISSUER_DEFAULT =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const TOKEN_DECIMALS = 7;

function env(key: string, fallback = ""): string {
  return process.env[key]?.trim() || fallback;
}

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isContractId(value: string): boolean {
  return /^C[A-Z0-9]{55}$/.test(value);
}

function isStellarAddress(value: string): boolean {
  return /^[CG][A-Z0-9]{55}$/.test(value);
}

/** Refuse mainnet — v1 is testnet-only. */
export function assertTestnetOnly(): void {
  const network = env("STELLAR_NETWORK", "testnet").toLowerCase();
  if (network !== "testnet") {
    throw new Error(
      `Sozu Faucet v1 is testnet-only (STELLAR_NETWORK=${network}). Refusing to start payouts.`,
    );
  }
}

export function getCircleIssuer(): string {
  return env("CIRCLE_TESTNET_USDC_ISSUER", CIRCLE_TESTNET_ISSUER_DEFAULT);
}

/** Circle USDC SAC contract id on Stellar testnet. */
export function getTokenContractId(): string {
  const override =
    env("FAUCET_TOKEN_CONTRACT_ID") ||
    env("TESTNET_CIRCLE_USDC_SAC_CONTRACT_ADDRESS");
  if (override) {
    const id = override.toUpperCase();
    if (!isContractId(id)) {
      throw new Error(`Invalid FAUCET_TOKEN_CONTRACT_ID: ${override}`);
    }
    return id;
  }
  return new Asset("USDC", getCircleIssuer()).contractId(Networks.TESTNET);
}

export function getFaucetConfig() {
  assertTestnetOnly();

  return {
    slug: env("FAUCET_SLUG", "sozu-testnet").toLowerCase(),
    name: env("FAUCET_NAME", "Sozu Faucet"),
    claimAmount: envNumber("FAUCET_CLAIM_AMOUNT", 20),
    dailyLimit: envNumber("FAUCET_DAILY_LIMIT", 5000),
    /** Per-user / per-wallet cooldown. Default 120m (Circle-like). */
    cooldownMinutes: envNumber("FAUCET_COOLDOWN_MINUTES", 120),
    globalCooldownMinutes: envNumber("FAUCET_GLOBAL_COOLDOWN_MINUTES", 0),
    status: "active" as const,
    asset: "circle_usdc_sac" as const,
    network: "testnet" as const,
    decimals: TOKEN_DECIMALS,
    sorobanRpcUrl: env("SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org"),
    horizonUrl: env("HORIZON_URL", "https://horizon-testnet.stellar.org"),
    tokenContractId: getTokenContractId(),
    faucetContractId: (() => {
      const id = env("FAUCET_CONTRACT_ID").toUpperCase();
      return id && isContractId(id) ? id : null;
    })(),
    authSecret: env("FAUCET_AUTH_SECRET"),
    hashSalt: env("FAUCET_HASH_SALT", "sozu-faucet-v1"),
    allowedOrigins: env("ALLOWED_ORIGINS", "http://localhost:3000")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    databaseUrl: env("DATABASE_URL", "file:./data/faucet.db"),
    tursoAuthToken: env("TURSO_AUTH_TOKEN") || undefined,
  };
}

export type FaucetConfig = ReturnType<typeof getFaucetConfig>;

export function getTreasuryKeypair(): Keypair {
  const secret =
    env("FAUCET_TREASURY_SECRET") || env("STELLAR_FUNDER_SECRET");
  if (!secret) {
    throw new Error(
      "Faucet treasury not configured. Set FAUCET_TREASURY_SECRET in env.",
    );
  }
  try {
    return Keypair.fromSecret(secret);
  } catch {
    throw new Error("FAUCET_TREASURY_SECRET is not a valid Stellar secret key.");
  }
}

export function getTreasuryPublicKey(): string | null {
  try {
    return getTreasuryKeypair().publicKey();
  } catch {
    return null;
  }
}

export function normalizeAddress(address: string): string {
  const trimmed = address.trim().toUpperCase();
  if (!isStellarAddress(trimmed)) {
    throw new Error(`Invalid Stellar address: ${address}`);
  }
  return trimmed;
}

export function usdcToMinor(amount: number, decimals = TOKEN_DECIMALS): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  return BigInt(Math.round(amount * 10 ** decimals));
}

export function minorToUsdc(minor: bigint, decimals = TOKEN_DECIMALS): number {
  return Number(minor) / 10 ** decimals;
}

export { isContractId, isStellarAddress, TOKEN_DECIMALS };
