import "server-only";

export type TurnstileVerifyResponse = {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
};

/**
 * Verify Cloudflare Turnstile captcha token server-side.
 * Returns true on success, false otherwise.
 *
 * Env: TURNSTILE_SECRET_KEY
 */
export async function verifyCaptcha(token: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  
  // Dev/test bypass: if no secret is configured and not in production, skip verification
  if (!secret) {
    const isDev = process.env.NODE_ENV !== "production" && 
                  process.env.FAUCET_REQUIRE_CAPTCHA !== "true";
    if (isDev) {
      console.warn("[captcha] TURNSTILE_SECRET_KEY not set; bypassing in dev mode");
      return true;
    }
    throw new Error(
      "Captcha verification required but TURNSTILE_SECRET_KEY not configured. " +
      "Set TURNSTILE_SECRET_KEY or FAUCET_REQUIRE_CAPTCHA=false for local dev.",
    );
  }

  if (!token || typeof token !== "string") {
    return false;
  }

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, response: token }),
      },
    );

    if (!response.ok) {
      console.error(
        `[captcha] Turnstile API returned ${response.status}`,
      );
      return false;
    }

    const data = (await response.json()) as TurnstileVerifyResponse;
    
    if (!data.success) {
      console.warn(
        `[captcha] Verification failed: ${data["error-codes"]?.join(", ") ?? "unknown"}`,
      );
    }

    return data.success;
  } catch (err) {
    console.error("[captcha] Turnstile verification error:", err);
    return false;
  }
}
