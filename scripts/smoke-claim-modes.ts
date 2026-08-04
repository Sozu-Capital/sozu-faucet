/**
 * Smoke all three claim modes against a local faucet and verify Stellar Expert links.
 *
 *   bun run --import tsx scripts/smoke-claim-modes.ts
 *
 * Mode B uses Cloudflare's always-pass Turnstile secret (set on the server):
 *   TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
 */
import { loadEnvFiles } from "./load-env";
import { stellarExpertUrl } from "../lib/stellar-expert";
import { createPreparedGWallet } from "../packages/faucet-cli/lib/wallet.js";
import { solvePow } from "../packages/faucet-cli/lib/pow.js";

loadEnvFiles();

const BASE = (process.env.FAUCET_BASE_URL ?? "http://localhost:3010").replace(
  /\/$/,
  "",
);

type ClaimOk = {
  success: true;
  to: string;
  txHash: string;
  amount: number;
};

function assertExpertLink(address: string, label: string) {
  const url = stellarExpertUrl(address);
  const expectKind = address.startsWith("G") ? "account" : "contract";
  const badKind = address.startsWith("G") ? "contract" : "account";
  if (!url.includes(`/testnet/${expectKind}/${address}`)) {
    throw new Error(
      `${label}: expected Expert ${expectKind} URL, got ${url}`,
    );
  }
  if (url.includes(`/${badKind}/`)) {
    throw new Error(`${label}: Expert URL still uses /${badKind}/ — ${url}`);
  }
  console.log(`  ✓ ${label} Expert link: ${url}`);
  return url;
}

async function checkExpertHttp(url: string, label: string) {
  const res = await fetch(url, { method: "GET", redirect: "follow" });
  // Expert often returns 200 even for odd paths; still flag hard failures.
  if (res.status >= 500) {
    throw new Error(`${label}: Expert HTTP ${res.status} for ${url}`);
  }
  console.log(`  ✓ ${label} Expert HTTP ${res.status}`);
}

async function modeA(to: string): Promise<ClaimOk> {
  const secret = process.env.FAUCET_AUTH_SECRET;
  if (!secret) throw new Error("FAUCET_AUTH_SECRET missing");

  const tokenRes = await fetch(`${BASE}/api/v1/faucet/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-faucet-dev-key": secret,
    },
    body: JSON.stringify({ userId: `smoke-a-${Date.now()}`, walletAddress: to }),
  });
  const tokenBody = (await tokenRes.json()) as { token?: string; error?: string };
  if (!tokenRes.ok || !tokenBody.token) {
    throw new Error(`Mode A token: ${tokenBody.error ?? tokenRes.status}`);
  }

  const claimRes = await fetch(`${BASE}/api/v1/faucet/claim`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenBody.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to }),
  });
  const claim = (await claimRes.json()) as ClaimOk & {
    success: boolean;
    error?: string;
    reason?: string;
  };
  if (!claim.success) {
    throw new Error(`Mode A claim: ${claim.reason ?? ""} ${claim.error ?? claimRes.status}`);
  }
  return claim as ClaimOk;
}

async function modeB(to: string): Promise<ClaimOk> {
  const claimRes = await fetch(`${BASE}/api/v1/faucet/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to,
      captchaToken: "XXXX.DUMMY.TOKEN.XXXX",
    }),
  });
  const claim = (await claimRes.json()) as ClaimOk & {
    success: boolean;
    error?: string;
    reason?: string;
  };
  if (!claim.success) {
    throw new Error(`Mode B claim: ${claim.reason ?? ""} ${claim.error ?? claimRes.status}`);
  }
  return claim as ClaimOk;
}

async function modeC(to: string): Promise<ClaimOk> {
  const challengeRes = await fetch(`${BASE}/api/v1/faucet/pow/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to }),
  });
  const challenge = (await challengeRes.json()) as {
    challengeId?: string;
    difficulty?: number;
    prefix?: string;
    to?: string;
    error?: string;
    reason?: string;
  };
  if (!challengeRes.ok || !challenge.challengeId) {
    throw new Error(
      `Mode C challenge: ${challenge.reason ?? ""} ${challenge.error ?? challengeRes.status}`,
    );
  }

  const nonce = solvePow({
    prefix: challenge.prefix!,
    challengeId: challenge.challengeId,
    to: challenge.to ?? to,
    difficulty: challenge.difficulty!,
  });

  const claimRes = await fetch(`${BASE}/api/v1/faucet/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to,
      pow: { challengeId: challenge.challengeId, nonce },
    }),
  });
  const claim = (await claimRes.json()) as ClaimOk & {
    success: boolean;
    error?: string;
    reason?: string;
  };
  if (!claim.success) {
    throw new Error(`Mode C claim: ${claim.reason ?? ""} ${claim.error ?? claimRes.status}`);
  }
  return claim as ClaimOk;
}

async function main() {
  console.log(`Smoke Mode A/B/C against ${BASE}\n`);

  // Static URL parsing checks (the original bug class)
  assertExpertLink(
    "GCT7D6S5VTFGEURS6ZYIO33YZRPQMA3LNWB4GEOHDFDXZGWTA4EPIM5E",
    "G… static",
  );
  assertExpertLink(
    "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    "C… static",
  );

  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) throw new Error(`health ${health.status} — is the dev server up?`);
  console.log(`\n✓ health ok\n`);

  const modes: Array<{
    name: string;
    run: (to: string) => Promise<ClaimOk>;
  }> = [
    { name: "Mode A (JWT)", run: modeA },
    { name: "Mode B (captcha)", run: modeB },
    { name: "Mode C (PoW)", run: modeC },
  ];

  for (const mode of modes) {
    console.log(`── ${mode.name} ──`);
    process.stderr.write("  Preparing fresh G… + Friendbot + USDC trustline…\n");
    const wallet = await createPreparedGWallet({
      onProgress: (m) => process.stderr.write(`  ${m}`),
    });
    const claim = await mode.run(wallet.address);
    console.log(`  ✓ claimed ${claim.amount} USDC → ${claim.to}`);
    console.log(`  ✓ tx ${claim.txHash}`);
    if (!claim.to.startsWith("G")) {
      throw new Error(`${mode.name}: expected G… recipient, got ${claim.to}`);
    }
    const url = assertExpertLink(claim.to, mode.name);
    await checkExpertHttp(url, mode.name);
    console.log("");
  }

  console.log("All three modes claimed successfully; Expert links use /account/ for G…");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
