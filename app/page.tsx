"use client";

import { useEffect, useState, useTransition } from "react";

type StatusPayload = {
  faucet: {
    name: string;
    claimAmount: number;
    cooldownMinutes: number;
    slug: string;
  };
  availability: {
    available: boolean;
    reason?: string;
    remainingToday: number;
    nextAvailableAt?: string;
  };
};

type ClaimPayload = {
  success: boolean;
  amount: number;
  to?: string;
  txHash?: string;
  error?: string;
  reason?: string;
  nextAvailableAt?: string;
};

export default function HomePage() {
  const [wallet, setWallet] = useState("");
  const [userId, setUserId] = useState("demo-user");
  const [devKey, setDevKey] = useState("");
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [message, setMessage] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void fetch("/api/v1/faucet/status")
      .then((r) => r.json())
      .then((data: StatusPayload) => setStatus(data))
      .catch(() => setStatus(null));
  }, []);

  function claim() {
    setMessage(null);
    startTransition(async () => {
      try {
        if (!wallet.trim() || !devKey.trim()) {
          setMessage({
            kind: "err",
            text: "Paste a C…/G… address and the FAUCET_AUTH_SECRET (dev key).",
          });
          return;
        }

        const tokenRes = await fetch("/api/v1/faucet/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-faucet-dev-key": devKey.trim(),
          },
          body: JSON.stringify({
            userId: userId.trim() || "demo-user",
            walletAddress: wallet.trim(),
          }),
        });
        const tokenBody = (await tokenRes.json()) as {
          token?: string;
          error?: string;
        };
        if (!tokenRes.ok || !tokenBody.token) {
          setMessage({
            kind: "err",
            text: tokenBody.error ?? "Could not mint claim token.",
          });
          return;
        }

        const claimRes = await fetch("/api/v1/faucet/claim", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenBody.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ to: wallet.trim() }),
        });
        const claimBody = (await claimRes.json()) as ClaimPayload;

        if (claimBody.success) {
          setMessage({
            kind: "ok",
            text: `Funded ${claimBody.amount} Circle USDC SAC → ${claimBody.to?.slice(0, 4)}…${claimBody.to?.slice(-4)}. tx ${claimBody.txHash?.slice(0, 10)}…`,
          });
        } else {
          const when = claimBody.nextAvailableAt
            ? ` Next available: ${new Date(claimBody.nextAvailableAt).toLocaleString()}.`
            : "";
          setMessage({
            kind: "err",
            text: `${claimBody.error ?? "Claim failed"} (${claimBody.reason}).${when}`,
          });
        }

        const refreshed = await fetch("/api/v1/faucet/status", {
          headers: { Authorization: `Bearer ${tokenBody.token}` },
        }).then((r) => r.json());
        setStatus(refreshed as StatusPayload);
      } catch (err) {
        setMessage({
          kind: "err",
          text: err instanceof Error ? err.message : "Unexpected error",
        });
      }
    });
  }

  return (
    <main>
      <h1>Sozu Faucet</h1>
      <p className="lede">
        One click. Testnet Circle USDC (SAC). No Freighter detour — paste a
        wallet address, claim, done.
      </p>

      <div className="panel">
        <label>
          Recipient (C… preferred, G… ok)
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="C… or G…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label>
          User id (for cooldown binding)
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="demo-user"
          />
        </label>
        <label>
          Dev key (= FAUCET_AUTH_SECRET)
          <input
            type="password"
            value={devKey}
            onChange={(e) => setDevKey(e.target.value)}
            placeholder="local secret"
            autoComplete="off"
          />
        </label>
        <button type="button" disabled={pending} onClick={claim}>
          {pending
            ? "Claiming…"
            : `Get ${status?.faucet.claimAmount ?? 20} testnet USDC`}
        </button>
        <div
          className={`status ${message?.kind === "ok" ? "ok" : message ? "err" : ""}`}
          role="status"
        >
          {message?.text ?? ""}
        </div>
      </div>

      <p className="meta">
        {status ? (
          <>
            <strong>{status.faucet.name}</strong> · slug{" "}
            <code>{status.faucet.slug}</code>
            <br />
            {status.availability.available
              ? `Available · ${status.availability.remainingToday} USDC left today`
              : `Unavailable (${status.availability.reason}) · ${status.availability.remainingToday} left today`}
            <br />
            Cooldown {status.faucet.cooldownMinutes} minutes · asset{" "}
            <code>circle_usdc_sac</code> · network <code>testnet</code>
          </>
        ) : (
          "Loading faucet status…"
        )}
      </p>
    </main>
  );
}
