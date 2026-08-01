import { ensureMigrated } from "../lib/db/client";

async function main() {
  await ensureMigrated();
  console.log("Migrated faucet_claims + faucet_pow_challenges tables.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
