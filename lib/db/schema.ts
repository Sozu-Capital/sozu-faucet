import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Audit + rate-limit ledger for claims. */
export const faucetClaims = sqliteTable("faucet_claims", {
  id: text("id").primaryKey(),
  faucetSlug: text("faucet_slug").notNull(),
  userId: text("user_id").notNull(),
  walletAddress: text("wallet_address").notNull(),
  amount: integer("amount").notNull(), // whole USDC (matches claim_amount)
  status: text("status").notNull(), // pending | success | failed
  txHash: text("tx_hash"),
  ipHash: text("ip_hash"),
  userAgentHash: text("user_agent_hash"),
  claimedAt: text("claimed_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type FaucetClaimRow = typeof faucetClaims.$inferSelect;
export type NewFaucetClaim = typeof faucetClaims.$inferInsert;
