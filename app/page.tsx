"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  clearSession,
  isSessionExpired,
  readStoredSession,
  shortAddress,
  storeSession,
  walletHandoffUrl,
  type FaucetSession,
} from "@/lib/faucet-session";

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

type ResolveSozuTagResult =
  | { ok: true; address: string; tag?: string }
  | { ok: false; error: string };

async function resolveSozuTag(tag: string): Promise<ResolveSozuTagResult> {
  const cleanTag = tag.startsWith("$") ? tag.slice(1) : tag;

  try {
    const response = await fetch(
      `/api/sozutag/resolve?tag=${encodeURIComponent(cleanTag)}`,
    );
    const data = (await response.json()) as {
      address?: string;
      tag?: string;
      error?: string;
    };
    if (response.ok && data.address) {
      return { ok: true, address: data.address, tag: data.tag };
    }
    return {
      ok: false,
      error:
        data.error ??
        `Could not resolve sozutag: ${cleanTag}. Check spelling or use a C…/G… address directly.`,
    };
  } catch {
    return {
      ok: false,
      error: `Could not reach sozutag resolver for ${cleanTag}. Try again or paste a C…/G… address.`,
    };
  }
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

function resetTurnstile(setCaptchaToken: (t: string | null) => void) {
  if (
    typeof window !== "undefined" &&
    (window as any).turnstile &&
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  ) {
    (window as any).turnstile.reset();
    setCaptchaToken(null);
  }
}

export default function HomePage() {
  const [recipientInput, setRecipientInput] = useState("");
  const [resolvedWallet, setResolvedWallet] = useState<string | null>(null);
  const [walletStatus, setWalletStatus] = useState<StatusPayload | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [session, setSession] = useState<FaucetSession | null>(null);
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
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const closedVideoRef = useRef<HTMLVideoElement>(null);
  const openVideoRef = useRef<HTMLVideoElement>(null);
  const [baseUrl, setBaseUrl] = useState(
    process.env.NEXT_PUBLIC_FAUCET_PUBLIC_URL || "",
  );

  const captchaConfigured = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const loggedIn = !!session && !isSessionExpired(session);
  const claimAmount = status?.faucet.claimAmount ?? 20;
  const claiming = pending && !resolving;

  useEffect(() => {
    setBaseUrl(window.location.origin);
  }, []);

  // Login with Sozu: consume ?token= from Wallet handoff, or restore sessionStorage.
  useEffect(() => {
    const url = new URL(window.location.href);
    const tokenFromUrl = url.searchParams.get("token");
    if (tokenFromUrl) {
      const next = storeSession(tokenFromUrl);
      url.searchParams.delete("token");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      if (next) {
        setSession(next);
        setResolvedWallet(next.walletAddress);
        setRecipientInput(next.walletAddress);
        return;
      }
      setMessage({
        kind: "err",
        text: "Login token was invalid or expired. Try Login with Sozu again.",
      });
    }

    const stored = readStoredSession();
    if (stored) {
      setSession(stored);
      setResolvedWallet(stored.walletAddress);
      setRecipientInput(stored.walletAddress);
    }
  }, []);

  // Keep wallet status in sync when logged in via Mode A.
  useEffect(() => {
    if (!loggedIn || !session) return;
    let cancelled = false;
    void fetch(
      `/api/v1/faucet/status?wallet=${encodeURIComponent(session.walletAddress)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data: StatusPayload | null) => {
        if (!cancelled && data) setWalletStatus(data);
      })
      .catch(() => {
        if (!cancelled) setWalletStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loggedIn, session]);

  useEffect(() => {
    const closed = closedVideoRef.current;
    const open = openVideoRef.current;
    if (!closed || !open) return;

    if (claiming) {
      void open.play().catch(() => {});
      closed.pause();
    } else {
      void closed.play().catch(() => {});
      open.pause();
      open.currentTime = 0;
    }
  }, [claiming]);

  useEffect(() => {
    void fetch("/api/v1/faucet/status")
      .then((r) => r.json())
      .then((data: StatusPayload) => setStatus(data))
      .catch(() => setStatus(null));
  }, []);

  // Resolve address / sozutag + fetch per-wallet cooldown for Copy gating
  // (guest / paste path only — logged-in Mode A binds wallet from JWT)
  useEffect(() => {
    if (loggedIn) return;

    const trimmed = recipientInput.trim();
    if (!trimmed) {
      setResolvedWallet(null);
      setWalletStatus(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      let wallet: string | null = null;

      if (isValidStellarAddress(trimmed)) {
        wallet = trimmed.toUpperCase();
      } else if (isSozuTag(trimmed)) {
        setResolving(true);
        const resolved = await resolveSozuTag(trimmed);
        if (!cancelled) setResolving(false);
        if (resolved.ok) wallet = resolved.address;
      }

      if (cancelled) return;

      if (!wallet || !isValidStellarAddress(wallet)) {
        setResolvedWallet(null);
        setWalletStatus(null);
        return;
      }

      const normalized = wallet.toUpperCase();
      setResolvedWallet(normalized);

      try {
        const res = await fetch(
          `/api/v1/faucet/status?wallet=${encodeURIComponent(normalized)}`,
        );
        if (!cancelled && res.ok) {
          setWalletStatus((await res.json()) as StatusPayload);
        }
      } catch {
        if (!cancelled) setWalletStatus(null);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [recipientInput, loggedIn]);

  useEffect(() => {
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!siteKey || loggedIn) return;

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
    return () => {
      script.remove();
    };
  }, [loggedIn]);

  function loginWithSozu() {
    const returnUrl = `${window.location.origin}/`;
    window.location.href = walletHandoffUrl(returnUrl);
  }

  function logout() {
    clearSession();
    setSession(null);
    setRecipientInput("");
    setResolvedWallet(null);
    setWalletStatus(null);
    setMessage(null);
  }

  async function resolveRecipient(): Promise<string | null> {
    if (loggedIn && session) {
      if (isSessionExpired(session)) {
        logout();
        setMessage({
          kind: "err",
          text: "Session expired, log in again.",
        });
        return null;
      }
      return session.walletAddress;
    }

    const trimmed = recipientInput.trim();
    if (!trimmed) {
      setMessage({ kind: "err", text: "Enter a Stellar address or $sozutag." });
      return null;
    }

    if (resolvedWallet && isValidStellarAddress(resolvedWallet)) {
      return resolvedWallet;
    }

    let resolvedAddress = trimmed;

    if (isSozuTag(trimmed) && !isValidStellarAddress(trimmed)) {
      setResolving(true);
      const resolved = await resolveSozuTag(trimmed);
      setResolving(false);

      if (!resolved.ok) {
        setMessage({
          kind: "err",
          text: resolved.error,
        });
        return null;
      }
      resolvedAddress = resolved.address;
    }

    if (!isValidStellarAddress(resolvedAddress)) {
      setMessage({
        kind: "err",
        text: "Invalid address. Stellar addresses are 56 chars starting with C or G.",
      });
      return null;
    }

    return resolvedAddress.toUpperCase();
  }

  async function claim() {
    setMessage(null);
    const address = await resolveRecipient();
    if (!address) return;

    const useModeA = loggedIn && !!session && !isSessionExpired(session);

    if (!useModeA && !captchaToken && captchaConfigured) {
      setMessage({
        kind: "err",
        text: "Please complete the captcha challenge.",
      });
      return;
    }

    startTransition(async () => {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (useModeA && session) {
          headers.Authorization = `Bearer ${session.token}`;
        }

        const claimRes = await fetch("/api/v1/faucet/claim", {
          method: "POST",
          headers,
          body: JSON.stringify(
            useModeA
              ? {}
              : {
                  to: address,
                  captchaToken: captchaToken ?? undefined,
                },
          ),
        });

        const claimBody = (await claimRes.json()) as ClaimPayload;

        if (claimRes.status === 401 && useModeA) {
          logout();
          setMessage({
            kind: "err",
            text: "Session expired, log in again.",
          });
          return;
        }

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

        if (!useModeA) resetTurnstile(setCaptchaToken);

        const refreshed = await fetch("/api/v1/faucet/status").then((r) =>
          r.json(),
        );
        setStatus(refreshed as StatusPayload);

        const walletRefreshed = await fetch(
          `/api/v1/faucet/status?wallet=${encodeURIComponent(address)}`,
        ).then((r) => r.json());
        setWalletStatus(walletRefreshed as StatusPayload);
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

  const walletOnCooldown =
    !!walletStatus &&
    !walletStatus.availability.available &&
    (walletStatus.availability.reason === "user_cooldown" ||
      walletStatus.availability.reason === "global_cooldown" ||
      walletStatus.availability.reason === "empty_today" ||
      walletStatus.availability.reason === "inactive" ||
      walletStatus.availability.reason === "insufficient_vault");

  const copyBlockedReason = (() => {
    if (!recipientInput.trim()) return "Enter a C…/G… or $sozutag above.";
    if (resolving) return "Resolving sozutag…";
    if (!resolvedWallet) return "Need a valid C…/G… address before copying.";
    if (walletOnCooldown) {
      const when = walletStatus?.availability.nextAvailableAt
        ? formatCountdown(walletStatus.availability.nextAvailableAt)
        : null;
      const reason = walletStatus?.availability.reason ?? "unavailable";
      return when
        ? `Unavailable (${reason}). Next available: ${when}.`
        : `Unavailable (${reason}).`;
    }
    return null;
  })();

  const canCopyPrompt = !!resolvedWallet && !walletOnCooldown && !resolving;

  function buildAgentPromptText(wallet: string): string {
    const origin =
      baseUrl ||
      process.env.NEXT_PUBLIC_FAUCET_PUBLIC_URL ||
      "https://faucet.sozu.capital";
    const isLocal =
      origin.includes("localhost") || origin.includes("127.0.0.1");
    const urlFlag = isLocal ? ` --url ${origin.replace(/\/$/, "")}` : "";
    return `Claim ${claimAmount} testnet USDC (Circle SAC) from Sozu Faucet for ${wallet}.

Run this single command (solves a short PoW, then claims — no browser):

npx @sozu/faucet@latest claim ${wallet}${urlFlag}

Print the JSON. On success, open:
https://stellar.expert/explorer/testnet/contract/${wallet}`;
  }

  async function copyAgentPrompt() {
    if (!canCopyPrompt || !resolvedWallet) return;
    const prompt = buildAgentPromptText(resolvedWallet);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedPrompt(true);
      setCopied("agent-prompt");
      setTimeout(() => {
        setCopied(null);
        setCopiedPrompt(false);
      }, 2500);
    } catch {
      setMessage({
        kind: "err",
        text: "Could not copy to clipboard.",
      });
    }
  }

  const agentPromptPreview = resolvedWallet
    ? buildAgentPromptText(resolvedWallet)
    : `Enter a recipient above, then Copy prompt.

Clipboard will contain one command:

npx @sozu/faucet@latest claim <ADDRESS>

No captcha. No JWT. Agent runs one shell command.

Docs: ${baseUrl || "https://faucet.sozu.capital"}/agents.md`;

  return (
    <>
      <div
        className={`bg-video${claiming ? " bg-video--claiming" : ""}`}
        aria-hidden="true"
      >
        <video
          ref={closedVideoRef}
          className="bg-video__layer bg-video__layer--closed"
          src="faucet_closed_dithered.mp4"
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
        />
        <video
          ref={openVideoRef}
          className="bg-video__layer bg-video__layer--open"
          src="faucet_open_dithered.mp4"
          muted
          loop
          playsInline
          preload="auto"
        />
        <div className="bg-video__veil" />
      </div>

      <main>
      <h1>Sozu Faucet</h1>
      <p className="lede">
        Get test USDC (SAC) in one click — or one{" "}
        <code style={{ fontSize: "0.92em" }}>npx @sozu/faucet</code> command
      </p>

      <div className="panel">
        {loggedIn && session ? (
          <div className="session-bar">
            <p className="session-bar__label">
              Logged in as{" "}
              <code>{shortAddress(session.walletAddress)}</code>
              {walletOnCooldown && walletStatus?.availability.nextAvailableAt
                ? ` · cooldown ${formatCountdown(walletStatus.availability.nextAvailableAt)}`
                : ""}
            </p>
            <button
              type="button"
              className="login-btn"
              disabled={pending}
              onClick={logout}
            >
              Log out
            </button>
          </div>
        ) : (
          <label>
            Recipient (C…, G…, or $sozutag)
            <div
              style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}
            >
              <input
                value={recipientInput}
                onChange={(e) => {
                  setRecipientInput(e.target.value);
                }}
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
                onClick={loginWithSozu}
              >
                Login with Sozu
              </button>
            </div>
          </label>
        )}

        {!loggedIn && resolvedWallet && (
          <p
            style={{
              margin: "0.4rem 0 0",
              fontSize: "0.82rem",
              color: "var(--muted)",
            }}
          >
            Resolved: {shortAddress(resolvedWallet)}
            {walletOnCooldown && walletStatus?.availability.nextAvailableAt
              ? ` · cooldown ${formatCountdown(walletStatus.availability.nextAvailableAt)}`
              : ""}
          </p>
        )}

        {!loggedIn && captchaConfigured && (
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
            : `Get ${claimAmount} testnet USDC`}
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
        <p>
          One shell command. The CLI solves a short proof-of-work, then claims —
          no browser, no captcha.
        </p>
        <div className="agent-prompt">
          <pre>{agentPromptPreview}</pre>
          <button
            type="button"
            className="copy-btn-small"
            disabled={!canCopyPrompt}
            onClick={() => void copyAgentPrompt()}
            title={copyBlockedReason ?? "Copy npx claim prompt"}
          >
            {copiedPrompt || copied === "agent-prompt"
              ? "Copied!"
              : "Copy prompt"}
          </button>
        </div>
        {copyBlockedReason && (
          <p
            style={{
              marginTop: "0.65rem",
              fontSize: "0.85rem",
              color: "var(--muted)",
            }}
          >
            {copyBlockedReason}
          </p>
        )}
      </div>
    </main>
    </>
  );
}
