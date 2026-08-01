import { NextResponse } from "next/server";

/** GET /docs → /agents.md (no more 404 scavenger hunt). */
export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/agents.md", request.url), 308);
}
