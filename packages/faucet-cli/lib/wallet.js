/**
 * Ephemeral classic G… wallet: Friendbot + Circle USDC trustline.
 * Secret stays local — never sent to the faucet API.
 */
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

export const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
export const FRIENDBOT_URL = "https://friendbot.stellar.org";
export const CIRCLE_USDC_ISSUER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const USDC = new Asset("USDC", CIRCLE_USDC_ISSUER);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function hasUsdcTrustline(account) {
  return (account.balances ?? []).some(
    (b) =>
      b.asset_type === "credit_alphanum4" &&
      b.asset_code === "USDC" &&
      b.asset_issuer === CIRCLE_USDC_ISSUER,
  );
}

async function waitForAccount(horizon, address, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await horizon.loadAccount(address);
    } catch {
      await sleep(500);
    }
  }
  throw new Error(
    `Account ${address.slice(0, 4)}… not visible on Horizon after Friendbot.`,
  );
}

/**
 * Create a fresh G… keypair, Friendbot-fund it, and add Circle USDC trustline.
 * @returns {{ address: string, secret: string, funded: boolean, trustline: "created" }}
 */
export async function createPreparedGWallet({ onProgress } = {}) {
  const log = onProgress ?? (() => {});
  const kp = Keypair.random();
  const address = kp.publicKey();
  const secret = kp.secret();
  const horizon = new Horizon.Server(HORIZON_TESTNET);

  log(`Generated G… wallet ${address.slice(0, 4)}…${address.slice(-4)}\n`);
  log("Funding with Friendbot (XLM for fees)…\n");

  const fb = await fetch(
    `${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`,
  );
  if (!fb.ok) {
    const text = await fb.text().catch(() => "");
    throw new Error(
      `Friendbot failed (${fb.status})${text ? `: ${text.slice(0, 120)}` : ""}`,
    );
  }

  const account = await waitForAccount(horizon, address);

  if (hasUsdcTrustline(account)) {
    return { address, secret, funded: true, trustline: "exists" };
  }

  log("Adding Circle USDC trustline…\n");
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  tx.sign(kp);

  const result = await horizon.submitTransaction(tx);
  if (!result.successful) {
    throw new Error(
      `Trustline transaction failed (hash ${result.hash ?? "unknown"}).`,
    );
  }

  return { address, secret, funded: true, trustline: "created" };
}
