import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sozu Faucet",
  description:
    "One-click testnet Circle USDC (SAC) for Sozu wallets — Friendbot-like, Sozu-owned.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
