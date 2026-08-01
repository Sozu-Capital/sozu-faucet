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

function isValidStellarAddress(addr: string): boolean {
  return /^[CG][A-Z0-9]{55}$/.test(addr.trim().toUpperCase());
}

function isSozuTag(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.startsWith("$") || /^[a-z0-9_-]+$/i.test(trimmed);
}

async function resolveSozuTag(tag: string): Promise<string | null> {
  const cleanTag = tag.startsWith("$") ? tag.slice(1) : tag;
  
  // TODO: Replace with actual sozutag API endpoint
  // For now, this is a placeholder that will need the real resolver
  try {
    const response = await fetch(`/api/sozutag/resolve?tag=${encodeURIComponent(cleanTag)}`);
    if (response.ok) {
      const data = await response.json();
      return data.address || null;
    }
  } catch {
    // Sozutag resolution failed - will show error to user
  }
  return null;
}

function formatCountdown(isoString: string | undefined): string {
  if (!isoString) return "";
  const target = new Date(isoString).getTime();
  const now = Date.now();
  const diffMs = target - now;
  if (diffMs <= 0) return "now";
  const mins = Math.ceil(diffMs / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return remainMins > 0 ? `${hrs}h ${remainMins}m` : `${hrs}h`;
}

export default function HomePage() {
  const [recipientInput, setRecipientInput] = useState("");
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [message, setMessage] = useState<{
    kind: "ok" | "err";
    text: string;
    txHash?: string;
    to?: string;
    nextAt?: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    void fetch("/api/v1/faucet/status")
      .then((r) => r.json())
      .then((data: StatusPayload) => setStatus(data))
      .catch(() => setStatus(null));
  }, []);

  // Load Turnstile widget
  useEffect(() => {
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!siteKey) return;

    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (typeof window !== "undefined" && (window as any).turnstile) {
        (window as any).turnstile.render("#turnstile-widget", {
          sitekey: siteKey,
          callback: (token: string) => setCaptchaToken(token),
          "expired-callback": () => setCaptchaToken(null),
          "error-callback": () => setCaptchaToken(null),
        });
      }
    };
    document.body.appendChild(script);
  }, []);

  async function claim() {
    setMessage(null);
    const trimmed = recipientInput.trim();

    if (!trimmed) {
      setMessage({ kind: "err", text: "Enter a Stellar address or $sozutag." });
      return;
    }

    // Resolve address or sozutag
    let resolvedAddress = trimmed;

    if (isSozuTag(trimmed) && !isValidStellarAddress(trimmed)) {
      setResolving(true);
      const resolved = await resolveSozuTag(trimmed);
      setResolving(false);

      if (!resolved) {
        setMessage({
          kind: "err",
          text: `Could not resolve sozutag: ${trimmed}. Check spelling or use a C…/G… address directly.`,
        });
        return;
      }
      resolvedAddress = resolved;
    }

    if (!isValidStellarAddress(resolvedAddress)) {
      setMessage({
        kind: "err",
        text: "Invalid address. Stellar addresses are 56 chars starting with C or G.",
      });
      return;
    }

    if (!captchaToken && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
      setMessage({
        kind: "err",
        text: "Please complete the captcha challenge.",
      });
      return;
    }

    startTransition(async () => {
      try {
        const claimRes = await fetch("/api/v1/faucet/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: resolvedAddress,
            captchaToken: captchaToken ?? undefined,
          }),
        });

        const claimBody = (await claimRes.json()) as ClaimPayload;

        if (claimBody.success) {
          setMessage({
            kind: "ok",
            text: `Funded ${claimBody.amount} Circle USDC (SAC)`,
            txHash: claimBody.txHash,
            to: claimBody.to,
            nextAt: claimBody.nextAvailableAt,
          });
        } else {
          const when = claimBody.nextAvailableAt
            ? ` Next available: ${formatCountdown(claimBody.nextAvailableAt)}.`
            : "";
          setMessage({
            kind: "err",
            text: `${claimBody.error ?? "Claim failed"} (${claimBody.reason}).${when}`,
            nextAt: claimBody.nextAvailableAt,
          });
        }

        // Reset captcha
        if (
          typeof window !== "undefined" &&
          (window as any).turnstile &&
          process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
        ) {
          (window as any).turnstile.reset();
          setCaptchaToken(null);
        }

        // Refresh status
        const refreshed = await fetch("/api/v1/faucet/status").then((r) =>
          r.json(),
        );
        setStatus(refreshed as StatusPayload);
      } catch (err) {
        setMessage({
          kind: "err",
          text: err instanceof Error ? err.message : "Unexpected error",
        });
      }
    });
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_FAUCET_PUBLIC_URL || "";

  const agentPrompt = `Get 20 testnet USDC from Sozu Faucet:

curl -X POST ${baseUrl}/api/v1/faucet/claim \\
  -H "Content-Type: application/json" \\
  -d '{"to":"YOUR_STELLAR_ADDRESS","captchaToken":"..."}'

Note: Captcha required in browser. For agent automation, use Mode A JWT (see docs).`;

  return (
    <main>
      <h1>Sozu Faucet</h1>
      <p className="lede">
        Testnet Circle USDC (SAC). One click. No Freighter detour.
      </p>

      <div className="panel">
        <label>
          Recipient (C…, G…, or $sozutag)
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
            <input
              value={recipientInput}
              onChange={(e) => setRecipientInput(e.target.value)}
              placeholder="C…, G…, or $sozutag"
              autoComplete="off"
              spellCheck={false}
              disabled={pending || resolving}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="login-btn"
              disabled={pending || resolving}
              onClick={() => {
                // TODO: Implement OAuth handoff redirect
                // For now, show coming soon message
                setMessage({
                  kind: "err",
                  text: "Login with Sozu coming soon. Use paste address for now.",
                });
              }}
            >
              Login with Sozu
            </button>
          </div>
        </label>

        {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && (
          <div
            id="turnstile-widget"
            style={{ minHeight: "65px", marginTop: "0.5rem" }}
          />
        )}

        <button
          type="button"
          disabled={pending || resolving}
          onClick={claim}
          style={{ marginTop: "0.5rem" }}
        >
          {pending || resolving
            ? resolving
              ? "Resolving sozutag…"
              : "Claiming…"
            : `Get ${status?.faucet.claimAmount ?? 20} testnet USDC`}
        </button>

        {message && (
          <div
            className={`status ${message.kind === "ok" ? "ok" : "err"}`}
            role="status"
          >
            {message.text}
            {message.kind === "ok" && message.txHash && message.to && (
              <div style={{ marginTop: "0.6rem", fontSize: "0.88rem" }}>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="copy-btn"
                    onClick={() =>
                      copy(message.to!, `to-${message.to!.slice(0, 6)}`)
                    }
                  >
                    {copied === `to-${message.to!.slice(0, 6)}`
                      ? "Copied!"
                      : `Copy to: ${message.to.slice(0, 4)}…${message.to.slice(-4)}`}
                  </button>
                  <button
                    type="button"
                    className="copy-btn"
                    onClick={() =>
                      copy(message.txHash!, `tx-${message.txHash!.slice(0, 6)}`)
                    }
                  >
                    {copied === `tx-${message.txHash!.slice(0, 6)}`
                      ? "Copied!"
                      : `Copy tx: ${message.txHash.slice(0, 10)}…`}
                  </button>
                </div>
                <a
                  href={`https://stellar.expert/explorer/testnet/contract/${message.to}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-block",
                    marginTop: "0.5rem",
                    fontSize: "0.85rem",
                  }}
                >
                  View on Stellar Expert →
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="agent-section">
        <h2>For agents & automation</h2>
        <p>Copy this prompt for your agent to handle testnet funding:</p>
        <div className="agent-prompt">
          <pre>{agentPrompt}</pre>
          <button
            type="button"
            className="copy-btn-small"
            onClick={() => copy(agentPrompt, "agent-prompt")}
          >
            {copied === "agent-prompt" ? "Copied!" : "Copy prompt"}
          </button>
        </div>
        {status && (
          <p style={{ marginTop: "1rem", fontSize: "0.85rem", color: "var(--muted)" }}>
            Status: {status.availability.available ? "Available" : `${status.availability.reason}`} · 
            {" "}{status.availability.remainingToday} USDC left today · 
            Cooldown {status.faucet.cooldownMinutes}m
          </p>
        )}
      </div>
    </main>
  );
}
