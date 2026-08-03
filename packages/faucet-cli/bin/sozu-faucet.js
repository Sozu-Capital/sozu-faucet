#!/usr/bin/env node
import { solvePow } from "../lib/pow.js";

const DEFAULT_URL = "https://faucet.sozu.capital";
const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const CIRCLE_USDC_ISSUER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** Stellar Lab Testnet → Fund Account (Add trustline for USDC). */
const STELLAR_LAB_TESTNET_FUND_URL =
  "https://lab.stellar.org/account/fund?$=network$id=testnet&label=Testnet&horizonUrl=https:////horizon-testnet.stellar.org&rpcUrl=https:////soroban-testnet.stellar.org&passphrase=Test%20SDF%20Network%20/;%20September%202015";

function usage(exitCode = 1) {
  console.error(`Sozu Faucet CLI — claim testnet Circle USDC (SAC)

Usage:
  npx @sozu/faucet claim <C_OR_G_ADDRESS> [--url <faucet-origin>]

Env:
  SOZU_FAUCET_URL   Override default origin (default: ${DEFAULT_URL})

Classic G… wallets need a Circle USDC trustline before claiming.
The CLI cannot sign it (needs your secret) — it will detect a missing
trustline and link Stellar Lab so you can add it manually, then retry.

Example:
  npx @sozu/faucet claim CABC...YOUR...ADDRESS
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    usage(args.length === 0 ? 1 : 0);
  }

  const command = args[0];
  if (command !== "claim") {
    console.error(`Unknown command: ${command}`);
    usage(1);
  }

  let to = null;
  let url = process.env.SOZU_FAUCET_URL?.trim() || DEFAULT_URL;

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--url") {
      url = args[++i];
      if (!url) {
        console.error("--url requires a value");
        process.exit(1);
      }
      continue;
    }
    if (a.startsWith("-")) {
      console.error(`Unknown flag: ${a}`);
      usage(1);
    }
    if (to) {
      console.error("Unexpected extra argument:", a);
      usage(1);
    }
    to = a;
  }

  if (!to) {
    console.error("Missing recipient address.");
    usage(1);
  }

  return { to: to.trim().toUpperCase(), url: url.replace(/\/$/, "") };
}

function isStellarAddress(value) {
  return /^[CG][A-Z0-9]{55}$/.test(value);
}

async function readJson(res, label) {
  const text = await res.text();
  const contentType = res.headers.get("content-type") || "";
  let body = null;
  if (text && (contentType.includes("json") || text.trimStart().startsWith("{"))) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (body) return body;

  const looksHtml = text.trimStart().startsWith("<!") || contentType.includes("text/html");
  const hint =
    res.status === 404 && looksHtml
      ? ` ${label} endpoint missing on ${res.url.split("/api")[0] || "this host"} — deploy Mode C PoW API, or pass --url http://localhost:3010 for local.`
      : "";

  throw new Error(
    `${label} returned HTTP ${res.status} (${contentType || "unknown type"}), not JSON.${hint}`,
  );
}

/**
 * For classic G… addresses: require Horizon account + Circle USDC trustline
 * before spending PoW. Never asks for a secret — points to Stellar Lab.
 */
async function preflightGAccount(to) {
  if (!to.startsWith("G")) return null;

  process.stderr.write("Checking Circle USDC trustline…\n");
  const res = await fetch(`${HORIZON_TESTNET}/accounts/${to}`);

  if (res.status === 404) {
    return {
      success: false,
      amount: 0,
      error:
        `Account ${to.slice(0, 4)}…${to.slice(-4)} is not on Stellar testnet yet. Open Stellar Lab → Fund Account, paste the address, Friendbot-fund it, add the Circle USDC trustline, then re-run claim.`,
      reason: "account_missing",
      helpUrl: STELLAR_LAB_TESTNET_FUND_URL,
    };
  }

  if (!res.ok) {
    process.stderr.write(
      `Warning: could not verify trustline on Horizon (HTTP ${res.status}); continuing…\n`,
    );
    return null;
  }

  const body = await res.json();
  const hasTrustline = (body.balances ?? []).some(
    (b) =>
      b.asset_type === "credit_alphanum4" &&
      b.asset_code === "USDC" &&
      b.asset_issuer === CIRCLE_USDC_ISSUER,
  );

  if (hasTrustline) return null;

  return {
    success: false,
    amount: 0,
    error:
      `Trustline missing: classic G… account cannot receive Circle USDC (USDC:${CIRCLE_USDC_ISSUER}). This CLI cannot sign the trustline (needs your secret). Open Stellar Lab, add the USDC trustline, then re-run claim.`,
    reason: "trustline_required",
    helpUrl: STELLAR_LAB_TESTNET_FUND_URL,
  };
}

function printFailure(claim) {
  console.log(JSON.stringify(claim, null, 2));
  writeClaimHint(claim);
}

/** Stderr guidance for common claim failures (does not change JSON stdout). */
function writeClaimHint(claim) {
  const reason = claim?.reason;
  const helpUrl = claim?.helpUrl || STELLAR_LAB_TESTNET_FUND_URL;

  if (reason === "trustline_required") {
    process.stderr.write(
      `\nTrustline missing — the faucet cannot add it without your secret key.\n` +
        `Add Circle USDC on Testnet in Stellar Lab, then retry this command:\n` +
        `  1. Open ${helpUrl}\n` +
        `  2. Paste your G… address\n` +
        `  3. Click "Add trustline" next to USDC and sign\n` +
        `  4. Re-run: npx @sozu/faucet claim <ADDRESS>\n` +
        `\nC… smart accounts do not need a trustline.\n`,
    );
    return;
  }

  if (reason === "account_missing") {
    process.stderr.write(
      `\nAccount not on testnet yet.\n` +
        `  1. Open ${helpUrl}\n` +
        `  2. Paste your G… address → Fund (Friendbot) → Add trustline for USDC → sign\n` +
        `  3. Re-run: npx @sozu/faucet claim <ADDRESS>\n`,
    );
    return;
  }

  // Older API builds collapsed trustline failures into payment_failed.
  if (reason === "payment_failed" && claim?.to?.startsWith?.("G")) {
    process.stderr.write(
      `\nIf this is a classic G… wallet, it likely needs a Circle USDC trustline.\n` +
        `Add it in Stellar Lab (needs your secret / Freighter), then retry:\n` +
        `  ${helpUrl}\n`,
    );
    return;
  }

  if (reason === "user_cooldown" || reason === "global_cooldown") {
    const when = claim?.nextAvailableAt
      ? ` Next available: ${claim.nextAvailableAt}`
      : "";
    process.stderr.write(`\nHint: Cooldown active.${when}\n`);
    return;
  }

  if (reason === "insufficient_vault" || reason === "empty_today") {
    process.stderr.write(
      `\nHint: Faucet side is empty or paused — try again later (not a wallet setup issue).\n`,
    );
  }
}

async function main() {
  const { to, url } = parseArgs(process.argv);

  if (!isStellarAddress(to)) {
    console.error(
      `Invalid Stellar address: ${to}\nExpected 56-char C… or G… address.`,
    );
    process.exit(1);
  }

  const blocked = await preflightGAccount(to);
  if (blocked) {
    printFailure(blocked);
    process.exit(1);
  }

  process.stderr.write(`Requesting PoW challenge from ${url}…\n`);
  const challengeRes = await fetch(`${url}/api/v1/faucet/pow/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to }),
  });
  const challenge = await readJson(challengeRes, "PoW challenge");
  if (!challengeRes.ok) {
    printFailure({
      success: false,
      error: challenge.error ?? `Challenge failed (${challengeRes.status})`,
      reason: challenge.reason,
      helpUrl: challenge.helpUrl,
    });
    process.exit(1);
  }

  const started = Date.now();
  process.stderr.write(
    `Solving PoW (difficulty ${challenge.difficulty})…\n`,
  );
  const nonce = solvePow({
    prefix: challenge.prefix,
    challengeId: challenge.challengeId,
    to: challenge.to,
    difficulty: challenge.difficulty,
    onProgress: (attempts) => {
      process.stderr.write(`  … ${attempts.toLocaleString()} hashes\n`);
    },
  });
  const ms = Date.now() - started;
  process.stderr.write(`Solved in ${(ms / 1000).toFixed(1)}s (nonce=${nonce})\n`);
  process.stderr.write("Claiming…\n");

  const claimRes = await fetch(`${url}/api/v1/faucet/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: challenge.to,
      pow: {
        challengeId: challenge.challengeId,
        nonce,
      },
    }),
  });
  const claim = await readJson(claimRes, "Claim");

  if (!claimRes.ok || claim.success !== true) {
    // Ensure Lab link is present even on older API builds.
    if (
      (claim.reason === "trustline_required" ||
        claim.reason === "account_missing" ||
        (claim.reason === "payment_failed" && to.startsWith("G"))) &&
      !claim.helpUrl
    ) {
      claim.helpUrl = STELLAR_LAB_TESTNET_FUND_URL;
    }
    printFailure({ ...claim, to });
    process.exit(1);
  }

  console.log(JSON.stringify(claim, null, 2));

  if (claim.to) {
    const explorer = claim.to.startsWith("G")
      ? `https://stellar.expert/explorer/testnet/account/${claim.to}`
      : `https://stellar.expert/explorer/testnet/contract/${claim.to}`;
    process.stderr.write(`${explorer}\n`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
