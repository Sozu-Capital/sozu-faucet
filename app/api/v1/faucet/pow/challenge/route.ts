import { createPowChallenge } from "@/lib/pow";
import { optionsResponse, withCors } from "@/lib/cors";

export const dynamic = "force-dynamic";

type Body = {
  to?: string;
};

/**
 * POST /api/v1/faucet/pow/challenge
 *
 * Mint a single-use PoW ticket bound to `to`. CLI / agents solve locally,
 * then claim with Mode C `{ to, pow: { challengeId, nonce } }`.
 */
export async function POST(request: Request) {
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    body = {};
  }

  if (!body.to?.trim()) {
    return withCors(
      request,
      Response.json(
        {
          error: "Missing recipient. Body: { \"to\": \"C…|G…\" }",
          reason: "invalid_address",
        },
        { status: 400 },
      ),
    );
  }

  try {
    const result = await createPowChallenge({
      to: body.to,
      request,
    });

    if (!result.ok) {
      return withCors(
        request,
        Response.json(
          { error: result.error, reason: result.reason },
          { status: result.status },
        ),
      );
    }

    return withCors(request, Response.json(result.challenge));
  } catch (err) {
    console.error("[POST /v1/faucet/pow/challenge]", err);
    const message = err instanceof Error ? err.message : "Failed to mint PoW challenge";
    return withCors(
      request,
      Response.json({ error: message }, { status: 500 }),
    );
  }
}

export async function OPTIONS(request: Request) {
  return optionsResponse(request);
}
