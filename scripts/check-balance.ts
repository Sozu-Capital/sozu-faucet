/**
 * Check vault / treasury Circle USDC SAC balance and claim dry-run eligibility.
 *
 *   bun run ops:balance
 */
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

async function main() {
  const { getFaucetConfig, getTreasuryPublicKey, minorToUsdc } = await import(
    "../lib/config"
  );
  const { getDispenserBalanceMinor, getVaultHealth } = await import(
    "../lib/payout"
  );
  const { computeAvailability } = await import("../lib/availability");

  const cfg = getFaucetConfig();
  const health = await getVaultHealth();
  const minor = await getDispenserBalanceMinor();
  const availability = await computeAvailability({});

  console.log("Sozu Faucet balance");
  console.log("──────────────────");
  console.log(`slug:            ${cfg.slug}`);
  console.log(`claim amount:    ${cfg.claimAmount} USDC`);
  console.log(`mode:            ${health.mode}`);
  console.log(`token SAC:       ${health.tokenContractId}`);
  console.log(`vault contract:  ${health.contractId ?? "(none — treasury transfer)"}`);
  console.log(`treasury G:      ${getTreasuryPublicKey() ?? "(not configured)"}`);
  console.log(
    `dispenser bal:   ${minor !== null ? `${minorToUsdc(minor)} USDC` : "unreadable"}`,
  );
  console.log(`can cover claim: ${health.canCoverClaim}`);
  console.log(`remaining today: ${availability.remainingToday} USDC`);
  console.log(
    `dry-run:         ${
      health.canCoverClaim && availability.remainingToday >= cfg.claimAmount
        ? "OK — would accept a claim (subject to user cooldown)"
        : "BLOCKED"
    }`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
