/** Stellar Expert explorer URL for a C… contract or G… account on testnet. */
export function stellarExpertUrl(address: string): string {
  const wallet = address.trim().toUpperCase();
  const kind = wallet.startsWith("G") ? "account" : "contract";
  return `https://stellar.expert/explorer/testnet/${kind}/${wallet}`;
}
