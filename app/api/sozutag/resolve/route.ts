import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function normalizeSozuTag(raw: string): string {
  return raw.trim().replace(/^\$+/, "").replace(/[^a-zA-Z0-9_]/g, "");
}

function isValidSozuTag(tag: string): boolean {
  return tag.length >= 3 && tag.length <= 30 && /^[a-zA-Z0-9_]+$/.test(tag);
}

function isValidStellarAddress(addr: string): boolean {
  return /^[CG][A-Z0-9]{55}$/.test(addr.trim().toUpperCase());
}

/**
 * GET /api/sozutag/resolve?tag=username
 * 
 * Resolves a sozutag to a Stellar address.
 * Uses the same Supabase DB as sozu-wallet.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawTag = searchParams.get("tag");

  if (!rawTag) {
    return NextResponse.json(
      { error: "Missing tag parameter" },
      { status: 400 },
    );
  }

  const tag = normalizeSozuTag(rawTag);

  if (!isValidSozuTag(tag)) {
    return NextResponse.json(
      { error: "Invalid sozutag format. Must be 3-30 characters (letters, numbers, underscore)." },
      { status: 400 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Sozutag resolution not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 },
    );
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Case-insensitive username lookup
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, username")
      .ilike("username", tag)
      .not("username", "is", null)
      .limit(10);

    if (profileError) {
      console.error("[sozutag/resolve] Profile lookup error:", profileError);
      return NextResponse.json(
        { error: "Failed to lookup sozutag" },
        { status: 500 },
      );
    }

    const profile =
      profiles?.find((p) => p.username === tag) ??
      profiles?.find((p) => p.username?.toLowerCase() === tag.toLowerCase()) ??
      profiles?.[0] ??
      null;

    if (!profile) {
      return NextResponse.json(
        { error: `Sozutag not found: $${tag}` },
        { status: 404 },
      );
    }

    // Get wallet for this user
    const [{ data: wallets, error: walletError }, { data: orgRow }] = await Promise.all([
      supabase
        .from("stellar_wallets")
        .select("public_key, network")
        .eq("user_id", profile.id)
        .order("updated_at", { ascending: false })
        .limit(1),
      supabase
        .from("organizations")
        .select("soroban_contract_id")
        .eq("sozu_tag_auth_user_id", profile.id)
        .not("soroban_contract_id", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (walletError) {
      console.error("[sozutag/resolve] Wallet lookup error:", walletError);
      return NextResponse.json(
        { error: "Failed to lookup wallet" },
        { status: 500 },
      );
    }

    // Prefer org treasury if exists (SozuPay org)
    const orgTreasuryC = orgRow?.soroban_contract_id?.trim().toUpperCase();
    const address = 
      (orgTreasuryC && isValidStellarAddress(orgTreasuryC)) 
        ? orgTreasuryC 
        : wallets?.[0]?.public_key?.trim().toUpperCase() ?? null;

    if (!address || !isValidStellarAddress(address)) {
      return NextResponse.json(
        { error: `No wallet found for $${tag}. User may not have created a wallet yet.` },
        { status: 404 },
      );
    }

    return NextResponse.json({
      address,
      tag: profile.username,
      network: wallets?.[0]?.network ?? "testnet",
    });
  } catch (error) {
    console.error("[sozutag/resolve] Unexpected error:", error);
    return NextResponse.json(
      { error: "Failed to resolve sozutag" },
      { status: 500 },
    );
  }
}
