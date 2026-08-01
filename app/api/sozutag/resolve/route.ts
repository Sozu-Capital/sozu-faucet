import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/sozutag/resolve?tag=username
 * 
 * Resolves a sozutag to a Stellar address.
 * 
 * TODO: Implement actual sozutag resolution logic.
 * This is a placeholder that should connect to the real sozutag registry.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tag = searchParams.get("tag");

  if (!tag) {
    return NextResponse.json(
      { error: "Missing tag parameter" },
      { status: 400 },
    );
  }

  // TODO: Replace with actual sozutag API call
  // For now, return a placeholder error
  // 
  // Expected implementation:
  // 1. Query sozutag registry (likely in sozu-wallet DB or separate service)
  // 2. Return the bound Stellar address (C… or G…)
  // 3. Handle errors: tag not found, expired, etc.
  //
  // Example:
  // const registry = await getSozuTagRegistry();
  // const address = await registry.resolve(tag);
  // return NextResponse.json({ address, tag });

  return NextResponse.json(
    {
      error: "Sozutag resolution not yet implemented",
      message: "This endpoint needs to be connected to the sozutag registry. See app/api/sozutag/resolve/route.ts",
    },
    { status: 501 },
  );
}
