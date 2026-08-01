/**
 * Top up the faucet dispenser with Circle USDC SAC from an external holder.
 *
 * This script transfers FROM the treasury G (which must already hold Circle SAC)
 * INTO the vault contract when FAUCET_CONTRACT_ID is set.
 *
 * If no vault is configured, this only prints how to acquire Circle testnet USDC
 * (Circle faucet / mint) onto the treasury — the treasury IS the dispenser.
 *
 *   bun run ops:topup -- 50
 */
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

async function main() {
  const amount = Number(process.argv[2] ?? process.argv[3]);
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error("Usage: bun run ops:topup -- <usdc_amount>");
    process.exit(1);
  }

  const {
    getFaucetConfig,
    getTreasuryKeypair,
    usdcToMinor,
  } = await import("../lib/config");
  const {
    Address,
    Contract,
    Networks,
    TransactionBuilder,
    nativeToScVal,
    rpc,
  } = await import("@stellar/stellar-sdk");
  const { Api } = await import("@stellar/stellar-sdk/rpc");

  const cfg = getFaucetConfig();
  const treasury = getTreasuryKeypair();
  const treasuryPk = treasury.publicKey();

  if (!cfg.faucetContractId) {
    console.log(
      [
        "No FAUCET_CONTRACT_ID — treasury transfer mode.",
        `Fund treasury ${treasuryPk} with ≥ ${amount} Circle SAC USDC.`,
        "",
        "Options:",
        "  1. Circle testnet faucet: https://faucet.circle.com/ (Stellar USDC)",
        "  2. Transfer SAC to the treasury G from another funded account",
        "",
        `Token contract: ${cfg.tokenContractId}`,
        `Issuer:         ${cfg.tokenContractId ? "see CIRCLE_TESTNET_USDC_ISSUER" : ""}`,
      ].join("\n"),
    );
    process.exit(0);
  }

  const server = new rpc.Server(cfg.sorobanRpcUrl, { allowHttp: true });
  const account = await server.getAccount(treasuryPk);
  const token = new Contract(cfg.tokenContractId);
  const minor = usdcToMinor(amount);

  const rawTx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      token.call(
        "transfer",
        Address.fromString(treasuryPk).toScVal(),
        Address.fromString(cfg.faucetContractId).toScVal(),
        nativeToScVal(minor, { type: "i128" }),
      ),
    )
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(rawTx);
  prepared.sign(treasury);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR" || !sent.hash) {
    throw new Error(`Top-up rejected: ${sent.status}`);
  }

  for (let i = 0; i < 45; i++) {
    try {
      const tx = await server.getTransaction(sent.hash);
      if (tx.status === Api.GetTransactionStatus.SUCCESS) {
        console.log(`Top-up ok: ${amount} USDC → vault ${cfg.faucetContractId}`);
        console.log(`tx: ${sent.hash}`);
        return;
      }
      if (tx.status === Api.GetTransactionStatus.FAILED) {
        throw new Error(`Top-up failed on-chain: ${sent.hash}`);
      }
    } catch {
      /* pending */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Top-up still pending: ${sent.hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
