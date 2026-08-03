#!/usr/bin/env node
import { solvePow } from "../lib/pow.js";
import {
  CIRCLE_USDC_ISSUER,
  HORIZON_TESTNET,
  createPreparedGWallet,
  hasUsdcTrustline,
} from "../lib/wallet.js";

const DEFAULT_URL = "https://faucet.sozu.capital";

/** Stellar Lab Testnet → Fund Account (Add trustline for USDC). */
const STELLAR_LAB_TESTNET_FUND_URL =
  "https://lab.stellar.org/account/fund?$=network$id=testnet&label=Testnet&horizonUrl=https:////horizon-testnet.stellar.org&rpcUrl=https:////soroban-testnet.stellar.org&passphrase=Test%20SDF%20Network%20/;%20September%202015";

function usage(exitCode = 1) {
  console.error(`Sozu Faucet CLI — claim testnet Circle USDC (SAC)

Usage:
  npx @sozu/faucet claim [<C_OR_G_ADDRESS>] [--url <faucet-origin>]

  claim <ADDRESS>   Fund an existing C… or G… wallet
  claim             Generate a fresh G… wallet, add USDC trustline, claim

Env:
  SOZU_FAUCET_URL   Override default origin (default: ${DEFAULT_URL})

Existing G… wallets need a Circle USDC trustline. This CLI never asks for
your secret — it links Stellar Lab so you can add the trustline and retry.
C… smart accounts claim directly (no trustline).

Examples:
  npx @sozu/faucet claim
  npx @sozu/faucet claim CABC...YOUR...ADDRESS
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args[0] === "-h" || args[0] === "--help") {
    usage(0);
  }
  if (args.length === 0) {
    usage(1);
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

  return {
    to: to ? to.trim().toUpperCase() : null,
    url: url.replace(/\/$/, ""),
  };
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
 * For classic G… addresses the user provided: require Horizon account + trustline.
 * Never asks for a secret — points to Stellar Lab.
 */
async function preflightExistingG(to) {
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
  if (hasUsdcTrustline(body)) return null;

  return {
    success: false,
    amount: 0,
    error:
      `Trustline missing: classic G… account cannot receive Circle USDC (USDC:${CIRCLE_USDC_ISSUER}). Open Stellar Lab, add the USDC trustline (sign with your wallet), then re-run claim.`,
    reason: "trustline_required",
    helpUrl: STELLAR_LAB_TESTNET_FUND_URL,
  };
}

function printFailure(claim) {
  console.log(JSON.stringify(claim, null, 2));
  writeClaimHint(claim);
}

function writeClaimHint(claim) {
  const reason = claim?.reason;
  const helpUrl = claim?.helpUrl || STELLAR_LAB_TESTNET_FUND_URL;

  if (reason === "trustline_required") {
    process.stderr.write(
      `\nTrustline missing — add it in Stellar Lab (this CLI never asks for your secret):\n` +
        `  1. Open ${helpUrl}\n` +
        `  2. Paste your G… address\n` +
        `  3. Click "Add trustline" next to USDC and sign\n` +
        `  4. Re-run: npx @sozu/faucet claim <ADDRESS>\n` +
        `\nOr create a funded wallet in one step: npx @sozu/faucet claim\n` +
        `C… smart accounts do not need a trustline.\n`,
    );
    return;
  }

  if (reason === "account_missing") {
    process.stderr.write(
      `\nAccount not on testnet yet.\n` +
        `  1. Open ${helpUrl}\n` +
        `  2. Paste your G… address → Fund (Friendbot) → Add trustline for USDC → sign\n` +
        `  3. Re-run: npx @sozu/faucet claim <ADDRESS>\n` +
        `\nOr: npx @sozu/faucet claim   (generates a new G… + trustline + claim)\n`,
    );
    return;
  }

  if (reason === "payment_failed" && claim?.to?.startsWith?.("G")) {
    process.stderr.write(
      `\nIf this is a classic G… wallet, add a Circle USDC trustline in Stellar Lab:\n` +
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

async function claimTo(url, to) {
  process.stderr.write(`Requesting PoW challenge from ${url}…\n`);
  const challengeRes = await fetch(`${url}/api/v1/faucet/pow/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to }),
  });
  const challenge = await readJson(challengeRes, "PoW challenge");
  if (!challengeRes.ok) {
    return {
      ok: false,
      claim: {
        success: false,
        error: challenge.error ?? `Challenge failed (${challengeRes.status})`,
        reason: challenge.reason,
        helpUrl: challenge.helpUrl,
      },
    };
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
  return { ok: claimRes.ok && claim.success === true, claim };
}

async function main() {
  const { to: providedTo, url } = parseArgs(process.argv);

  let to = providedTo;
  let generatedWallet = null;

  if (!to) {
    process.stderr.write(
      "No address given — creating a fresh G… wallet (Friendbot + USDC trustline)…\n",
    );
    generatedWallet = await createPreparedGWallet({
      onProgress: (msg) => process.stderr.write(msg),
    });
    to = generatedWallet.address;
    process.stderr.write(
      `Wallet ready (${generatedWallet.trustline} trustline). Claiming…\n`,
    );
  } else if (!isStellarAddress(to)) {
    console.error(
      `Invalid Stellar address: ${to}\nExpected 56-char C… or G… address, or omit for a new wallet.`,
    );
    process.exit(1);
  } else {
    const blocked = await preflightExistingG(to);
    if (blocked) {
      printFailure(blocked);
      process.exit(1);
    }
  }

  const { ok, claim } = await claimTo(url, to);

  if (!ok) {
    if (
      (claim.reason === "trustline_required" ||
        claim.reason === "account_missing" ||
        (claim.reason === "payment_failed" && to.startsWith("G"))) &&
      !claim.helpUrl
    ) {
      claim.helpUrl = STELLAR_LAB_TESTNET_FUND_URL;
    }
    if (generatedWallet) {
      claim.wallet = {
        address: generatedWallet.address,
        secret: generatedWallet.secret,
        generated: true,
        funded: generatedWallet.funded,
        trustline: generatedWallet.trustline,
      };
      process.stderr.write(
        "\nWallet was created before claim failed — save the secret from the JSON.\n",
      );
    }
    printFailure({ ...claim, to });
    process.exit(1);
  }

  const out = { ...claim };
  if (generatedWallet) {
    out.wallet = {
      address: generatedWallet.address,
      secret: generatedWallet.secret,
      generated: true,
      funded: generatedWallet.funded,
      trustline: generatedWallet.trustline,
    };
  }

  console.log(JSON.stringify(out, null, 2));

  if (generatedWallet) {
    process.stderr.write(
      `\nSave this secret now — it is only shown once:\n  ${generatedWallet.secret}\n` +
        `Address: ${generatedWallet.address}\n`,
    );
  }

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
