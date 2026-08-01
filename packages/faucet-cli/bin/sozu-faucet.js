#!/usr/bin/env node
import { solvePow } from "../lib/pow.js";

const DEFAULT_URL = "https://faucet.sozu.capital";

function usage(exitCode = 1) {
  console.error(`Sozu Faucet CLI — claim testnet Circle USDC (SAC)

Usage:
  npx @sozu/faucet claim <C_OR_G_ADDRESS> [--url <faucet-origin>]

Env:
  SOZU_FAUCET_URL   Override default origin (default: ${DEFAULT_URL})

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

async function main() {
  const { to, url } = parseArgs(process.argv);

  if (!isStellarAddress(to)) {
    console.error(
      `Invalid Stellar address: ${to}\nExpected 56-char C… or G… address.`,
    );
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
    console.error(
      JSON.stringify(
        {
          success: false,
          error: challenge.error ?? `Challenge failed (${challengeRes.status})`,
          reason: challenge.reason,
        },
        null,
        2,
      ),
    );
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
  console.log(JSON.stringify(claim, null, 2));

  if (!claimRes.ok || claim.success !== true) {
    process.exit(1);
  }

  if (claim.to) {
    process.stderr.write(
      `https://stellar.expert/explorer/testnet/contract/${claim.to}\n`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
