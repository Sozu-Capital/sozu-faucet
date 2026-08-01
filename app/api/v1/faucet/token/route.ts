import { mintFaucetToken } from "@/lib/auth";
import { getFaucetConfig, normalizeAddress } from "@/lib/config";
import { optionsResponse, withCors } from "@/lib/cors";

export const dynamic = "force-dynamic";

/**
 * POST /v1/faucet/token — mint a short-lived Mode A JWT.
 * Protected by x-faucet-dev-key === FAUCET_AUTH_SECRET (ops / local only).
 * Wallet production should mint tokens itself with the shared secret.
 */
export async function POST(request: Request) {
  const cfg = getFaucetConfig();
  const devKey = request.headers.get("x-faucet-dev-key")?.trim();
  if (!devKey || devKey !== cfg.authSecret) {
    return withCors(
      request,
      Response.json({ error: "Unauthorized" }, { status: 401 }),
    );
  }

  try {
    const body = (await request.json()) as {
      userId?: string;
      walletAddress?: string;
      expiresInSeconds?: number;
    };
    if (!body.userId || !body.walletAddress) {
      return withCors(
        request,
        Response.json(
          { error: "userId and walletAddress required" },
          { status: 400 },
        ),
      );
    }

    const wallet = normalizeAddress(body.walletAddress);
    const token = await mintFaucetToken({
      userId: body.userId,
      walletAddress: wallet,
      expiresInSeconds: body.expiresInSeconds,
    });

    return withCors(
      request,
      Response.json({
        token,
        wallet,
        userId: body.userId,
        expiresInSeconds: body.expiresInSeconds ?? 300,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "token mint failed";
    return withCors(
      request,
      Response.json({ error: message }, { status: 400 }),
    );
  }
}

export async function OPTIONS(request: Request) {
  return optionsResponse(request);
}
