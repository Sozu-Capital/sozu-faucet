/**
 * Payout rail for Circle USDC SAC (testnet).
 *
 * Preferred: FAUCET_CONTRACT_ID vault → claim(to, amount)
 * Fallback: treasury G SEP-41 transfer of Circle SAC → recipient
 */

import {
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { Api } from "@stellar/stellar-sdk/rpc";
import {
  getFaucetConfig,
  getTreasuryKeypair,
  getTreasuryPublicKey,
  minorToUsdc,
  normalizeAddress,
  usdcToMinor,
} from "@/lib/config";
import { assertRecipientCanReceiveUsdc } from "@/lib/recipient";

async function waitForResult(
  server: rpc.Server,
  hash: string,
  maxAttempts = 45,
): Promise<
  | { status: "SUCCESS" }
  | { status: "FAILED"; detail: string }
  | { status: "PENDING" }
> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const tx = await server.getTransaction(hash);
      if (tx.status === Api.GetTransactionStatus.SUCCESS) {
        return { status: "SUCCESS" };
      }
      if (tx.status === Api.GetTransactionStatus.FAILED) {
        let detail = "on-chain failure";
        try {
          detail = tx.resultXdr.result().switch().name;
        } catch {
          /* keep default */
        }
        const diags = tx.diagnosticEventsXdr ?? [];
        for (const d of diags) {
          if (typeof d === "string") continue;
          try {
            const topics = d
              .event()
              .body()
              .value()
              .topics()
              .map((t) => {
                try {
                  const n = t.switch().name;
                  if (n === "scvSymbol") return t.sym().toString();
                  if (n === "scvString") return t.str().toString();
                  return n;
                } catch {
                  return "?";
                }
              });
            if (topics.some((t) => t === "error" || /trustline/i.test(t))) {
              detail = topics.join(" ");
              break;
            }
          } catch {
            /* ignore malformed diagnostic */
          }
        }
        return { status: "FAILED", detail };
      }
    } catch {
      /* NOT_FOUND — keep polling */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { status: "PENDING" };
}

let fundedTreasury: string | null = null;

async function ensureTreasuryHasXlm(publicKey: string): Promise<void> {
  if (fundedTreasury === publicKey) return;
  const cfg = getFaucetConfig();
  const res = await fetch(`${cfg.horizonUrl}/accounts/${publicKey}`);
  if (res.ok) {
    fundedTreasury = publicKey;
    return;
  }

  // Friendbot the treasury so fees can be paid.
  const fb = await fetch(
    `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`,
  );
  if (!fb.ok) {
    throw new Error(
      `Treasury ${publicKey.slice(0, 4)}… has no account and Friendbot funding failed (${fb.status}).`,
    );
  }
  // Horizon eventual consistency
  await new Promise((r) => setTimeout(r, 2000));
  fundedTreasury = publicKey;
}

async function submitTreasuryInvocation(operation: xdr.Operation): Promise<string> {
  const cfg = getFaucetConfig();
  const treasury = getTreasuryKeypair();
  const treasuryPk = treasury.publicKey();

  await ensureTreasuryHasXlm(treasuryPk);

  const server = new rpc.Server(cfg.sorobanRpcUrl, { allowHttp: true });
  const account = await server.getAccount(treasuryPk);

  const rawTx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(rawTx);
  prepared.sign(treasury);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR" || !sent.hash) {
    const detail = sent.errorResult
      ? sent.errorResult.result()?.switch?.().name ?? "unknown"
      : "no hash";
    throw new Error(`Faucet payment rejected by Soroban RPC (${detail})`);
  }

  const outcome = await waitForResult(server, sent.hash);
  if (outcome.status === "FAILED") {
    throw new Error(
      `Faucet payment failed on-chain (tx ${sent.hash.slice(0, 8)}…): ${outcome.detail}`,
    );
  }
  if (outcome.status === "PENDING") {
    throw new Error(
      `Faucet payment still pending after timeout (tx ${sent.hash.slice(0, 8)}…).`,
    );
  }
  return sent.hash;
}

const BALANCE_CACHE_MS = 30_000;
let balanceCache: { minor: bigint; at: number } | null = null;

/**
 * On-chain USDC balance of vault contract, or treasury token balance if no vault.
 * `cached: true` accepts a per-instance reading up to 30 s old (status / health);
 * claims read fresh.
 */
export async function getDispenserBalanceMinor(
  opts: { cached?: boolean } = {},
): Promise<bigint | null> {
  if (
    opts.cached &&
    balanceCache &&
    Date.now() - balanceCache.at < BALANCE_CACHE_MS
  ) {
    return balanceCache.minor;
  }
  const minor = await readDispenserBalanceMinor();
  if (minor !== null) balanceCache = { minor, at: Date.now() };
  return minor;
}

async function readDispenserBalanceMinor(): Promise<bigint | null> {
  const cfg = getFaucetConfig();
  const funderPk = getTreasuryPublicKey();
  if (!funderPk) return null;

  const server = new rpc.Server(cfg.sorobanRpcUrl, { allowHttp: true });

  try {
    await ensureTreasuryHasXlm(funderPk);
    const account = await server.getAccount(funderPk);

    if (cfg.faucetContractId) {
      const faucet = new Contract(cfg.faucetContractId);
      const tx = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(faucet.call("balance"))
        .setTimeout(30)
        .build();

      const sim = await server.simulateTransaction(tx);
      if (Api.isSimulationError(sim) || !sim.result?.retval) return null;
      const native = scValToNative(sim.result.retval);
      if (typeof native === "bigint") return native;
      if (typeof native === "number") return BigInt(Math.trunc(native));
      if (typeof native === "string") return BigInt(native);
      return null;
    }

    // Fallback rail: SEP-41 balance(treasury)
    const token = new Contract(cfg.tokenContractId);
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        token.call("balance", Address.fromString(funderPk).toScVal()),
      )
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (Api.isSimulationError(sim) || !sim.result?.retval) return null;
    const native = scValToNative(sim.result.retval);
    if (typeof native === "bigint") return native;
    if (typeof native === "number") return BigInt(Math.trunc(native));
    if (typeof native === "string") return BigInt(native);
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns:
 * - true / false when balance is readable
 * - null when treasury/RPC is unavailable (status should not hard-fail; claim fails closed)
 */
export async function vaultCanCoverClaim(
  amountUsdc: number,
  opts: { cached?: boolean } = {},
): Promise<boolean | null> {
  const minor = await getDispenserBalanceMinor(opts);
  if (minor === null) return null;
  return minor >= usdcToMinor(amountUsdc);
}

export type SendPaymentResult = { txHash: string };

/**
 * `preflighted: true` skips the recipient and balance checks; only pass it when
 * the caller ran `assertRecipientCanReceiveUsdc` and `vaultCanCoverClaim` itself.
 */
export async function sendFaucetPayment(params: {
  toWalletAddress: string;
  amount: number;
  preflighted?: boolean;
}): Promise<SendPaymentResult> {
  const cfg = getFaucetConfig(); // asserts testnet
  const to = normalizeAddress(params.toWalletAddress);
  const amountScVal = nativeToScVal(usdcToMinor(params.amount, cfg.decimals), {
    type: "i128",
  });

  if (!params.preflighted) {
    await assertRecipientCanReceiveUsdc(to);

    const minor = await getDispenserBalanceMinor();
    if (minor === null || minor < usdcToMinor(params.amount)) {
      throw new Error(
        minor === null
          ? `Faucet balance unreadable (treasury/RPC). Need ${params.amount} USDC.`
          : `Faucet underfunded: has ${minorToUsdc(minor)} USDC, need ${params.amount} USDC.`,
      );
    }
  }

  try {
    if (cfg.faucetContractId) {
      const faucet = new Contract(cfg.faucetContractId);
      const txHash = await submitTreasuryInvocation(
        faucet.call("claim", Address.fromString(to).toScVal(), amountScVal),
      );
      return { txHash };
    }

    const treasuryPk = getTreasuryKeypair().publicKey();
    const token = new Contract(cfg.tokenContractId);
    const txHash = await submitTreasuryInvocation(
      token.call(
        "transfer",
        Address.fromString(treasuryPk).toScVal(),
        Address.fromString(to).toScVal(),
        amountScVal,
      ),
    );
    return { txHash };
  } finally {
    balanceCache = null;
  }
}

export async function getVaultHealth() {
  const cfg = getFaucetConfig();
  const minor = await getDispenserBalanceMinor({ cached: true });
  const balanceUsdc = minor !== null ? minorToUsdc(minor) : null;
  return {
    mode: cfg.faucetContractId
      ? ("vault_contract" as const)
      : ("treasury_transfer" as const),
    contractId: cfg.faucetContractId,
    tokenContractId: cfg.tokenContractId,
    balanceUsdc,
    canCoverClaim: balanceUsdc !== null && balanceUsdc >= cfg.claimAmount,
  };
}
