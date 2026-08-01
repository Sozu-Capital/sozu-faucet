/**
 * Smoke test: mint token → claim → print result.
 *
 *   bun run ops:smoke -- CABCDEF... [userId]
 *
 * Requires FAUCET_TREASURY_SECRET, FAUCET_AUTH_SECRET, and a funded dispenser.
 * Hits the local server at FAUCET_BASE_URL (default http://localhost:3010).
 */
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

async function main() {
  const to = process.argv[2];
  const userId = process.argv[3] ?? `smoke-${Date.now()}`;
  if (!to) {
    console.error("Usage: bun run ops:smoke -- <C_or_G_address> [userId]");
    process.exit(1);
  }

  const base = (process.env.FAUCET_BASE_URL ?? "http://localhost:3010").replace(
    /\/$/,
    "",
  );
  const secret = process.env.FAUCET_AUTH_SECRET;
  if (!secret) throw new Error("FAUCET_AUTH_SECRET missing");

  const tokenRes = await fetch(`${base}/api/v1/faucet/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-faucet-dev-key": secret,
    },
    body: JSON.stringify({ userId, walletAddress: to }),
  });
  const tokenBody = (await tokenRes.json()) as { token?: string; error?: string };
  if (!tokenRes.ok || !tokenBody.token) {
    throw new Error(`token: ${tokenBody.error ?? tokenRes.status}`);
  }

  const claimRes = await fetch(`${base}/api/v1/faucet/claim`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenBody.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to }),
  });
  const claimBody = await claimRes.json();
  console.log(JSON.stringify(claimBody, null, 2));

  if (!claimBody.success) process.exit(1);

  console.log(
    `\nVerify on Stellar Expert (testnet):\nhttps://stellar.expert/explorer/testnet/contract/${to}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
