import { anonUserId, buildAgentClaimPrompt } from "@/lib/agent-prompt";
import { mintFaucetToken } from "@/lib/auth";
import { computeAvailability } from "@/lib/availability";
import { verifyCaptcha } from "@/lib/captcha";
import { getFaucetConfig, normalizeAddress } from "@/lib/config";
import { optionsResponse, withCors } from "@/lib/cors";

export const dynamic = "force-dynamic";

const PROMPT_TTL_SECONDS = 300;

/**
 * POST /v1/faucet/prompt-token
 *
 * Human-gated Mode A handoff for "Copy prompt":
 * Turnstile (when configured) + resolved wallet → short-lived JWT in clipboard.
 * Never exposes FAUCET_AUTH_SECRET to the client.
 */
export async function POST(request: Request) {
  try {
    getFaucetConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Misconfigured";
    return withCors(
      request,
      Response.json(
        { error: message, reason: "mainnet_refused" },
        { status: 503 },
      ),
    );
  }

  const cfg = getFaucetConfig();
  if (!cfg.authSecret || cfg.authSecret.length < 16) {
    return withCors(
      request,
      Response.json(
        {
          error: "FAUCET_AUTH_SECRET is not configured.",
          reason: "misconfigured",
        },
        { status: 503 },
      ),
    );
  }

  let body: { walletAddress?: string; captchaToken?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (!body.walletAddress?.trim()) {
    return withCors(
      request,
      Response.json(
        { error: "walletAddress required", reason: "invalid_address" },
        { status: 400 },
      ),
    );
  }

  const captchaRequired =
    !!process.env.TURNSTILE_SECRET_KEY?.trim() ||
    process.env.FAUCET_REQUIRE_CAPTCHA === "true";

  if (captchaRequired) {
    if (!body.captchaToken) {
      return withCors(
        request,
        Response.json(
          {
            error: "Complete the captcha, then copy the prompt.",
            reason: "unauthorized",
          },
          { status: 401 },
        ),
      );
    }
    const captchaValid = await verifyCaptcha(body.captchaToken);
    if (!captchaValid) {
      return withCors(
        request,
        Response.json(
          {
            error: "Captcha verification failed. Refresh and try again.",
            reason: "unauthorized",
          },
          { status: 401 },
        ),
      );
    }
  }

  let wallet: string;
  try {
    wallet = normalizeAddress(body.walletAddress);
  } catch {
    return withCors(
      request,
      Response.json(
        {
          error: `Invalid Stellar address: ${body.walletAddress}`,
          reason: "invalid_address",
        },
        { status: 400 },
      ),
    );
  }

  const userId = anonUserId(wallet);
  const availability = await computeAvailability({ userId, walletAddress: wallet });

  if (!availability.available) {
    return withCors(
      request,
      Response.json(
        {
          error: "Faucet not available for this wallet right now.",
          reason: availability.reason ?? "user_cooldown",
          nextAvailableAt: availability.nextAvailableAt,
        },
        { status: 409 },
      ),
    );
  }

  const token = await mintFaucetToken({
    userId,
    walletAddress: wallet,
    expiresInSeconds: PROMPT_TTL_SECONDS,
  });

  const origin = new URL(request.url).origin;
  const prompt = buildAgentClaimPrompt({
    baseUrl: origin,
    token,
    wallet,
    claimAmount: cfg.claimAmount,
    expiresInSeconds: PROMPT_TTL_SECONDS,
  });

  return withCors(
    request,
    Response.json({
      token,
      wallet,
      userId,
      expiresInSeconds: PROMPT_TTL_SECONDS,
      expiresAt: new Date(Date.now() + PROMPT_TTL_SECONDS * 1000).toISOString(),
      claimAmount: cfg.claimAmount,
      prompt,
    }),
  );
}

export async function OPTIONS(request: Request) {
  return optionsResponse(request);
}
