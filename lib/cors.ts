import { getFaucetConfig } from "@/lib/config";

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  const allowed = getFaucetConfig().allowedOrigins;
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, x-user-id, x-wallet-address, x-faucet-dev-key",
    "Access-Control-Max-Age": "86400",
  };

  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  } else if (!origin && allowed.length === 1) {
    // non-browser clients
    headers["Access-Control-Allow-Origin"] = allowed[0]!;
  }

  return headers;
}

export function withCors(request: Request, response: Response): Response {
  const headers = corsHeaders(request);
  const next = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) {
    next.headers.set(k, v);
  }
  return next;
}

export function optionsResponse(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
