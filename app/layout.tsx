import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sozu Faucet",
  description:
    "One-click testnet Circle USDC (SAC) on the Stellar Blockchain. Powered by Sozu.",
  icons: {
    apple: [
      { url: "/icons/sozu_icon_152.png", sizes: "152x152", type: "image/png" },
      { url: "/icons/sozu_icon_180.png", sizes: "180x180", type: "image/png" },
      { url: "/icons/sozu_icon_192.png", sizes: "192x192", type: "image/png" },
    ],
    icon: [
      { url: "/icons/sozu_icon_192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/sozu_icon_512.png", sizes: "512x512", type: "image/png" },
    ],
  },
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
