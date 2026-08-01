import { ensureMigrated } from "../lib/db/client";

async function main() {
  await ensureMigrated();
  console.log("Migrated faucet_claims table.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
