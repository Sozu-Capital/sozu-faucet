# Sozutag Resolution

The faucet supports sozutag inputs (`$username` or `username`) that resolve to Stellar addresses.

## How it works

1. User enters `$alice` or `alice` in the recipient field
2. Client calls `/api/sozutag/resolve?tag=alice`
3. API queries the **same Supabase DB as sozu-wallet**:
   - Looks up `profiles.username` (case-insensitive)
   - Returns linked `stellar_wallets.public_key`
   - Prefers org treasury (`organizations.soroban_contract_id`) if exists
4. Resolved address is used for the claim

## Setup

### Local development

Add to `.env.local` (same values as sozu-wallet):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-key
```

### Production (Vercel)

Add the same env vars in Vercel project settings.

## Testing

```bash
# Start faucet locally
npm run dev

# In browser: http://localhost:3010
# Enter: $yourusername
# Should resolve and prefill the stellar address
```

Or test the API directly:

```bash
curl "http://localhost:3010/api/sozutag/resolve?tag=alice"

# Success response:
{
  "address": "C...",
  "tag": "alice",
  "network": "testnet"
}

# Not found:
{
  "error": "Sozutag not found: $alice"
}
```

## Validation rules

- Length: 3-30 characters
- Allowed: letters, numbers, underscore (`a-zA-Z0-9_`)
- Case-insensitive matching
- Strips leading `$` automatically

## Database schema (sozu-wallet Supabase)

```sql
-- profiles table
CREATE TABLE profiles (
  id UUID PRIMARY KEY,
  username TEXT UNIQUE, -- the sozutag
  ...
);

-- stellar_wallets table
CREATE TABLE stellar_wallets (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  public_key TEXT, -- C... or G... address
  network TEXT,
  ...
);

-- organizations table (optional - for SozuPay org tags)
CREATE TABLE organizations (
  id UUID PRIMARY KEY,
  sozu_tag_auth_user_id UUID REFERENCES profiles(id),
  soroban_contract_id TEXT, -- org treasury C... address
  ...
);
```

## Fallback behavior

If sozutag resolution fails (network issue, DB down, tag not found), the UI shows a clear error and the user can paste the full Stellar address directly.
