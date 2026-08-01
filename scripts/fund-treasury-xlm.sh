#!/usr/bin/env bash
# Fund the faucet treasury G with Friendbot (testnet XLM for Soroban fees).
#
# Usage:
#   ./scripts/fund-treasury-xlm.sh
#   ./scripts/fund-treasury-xlm.sh GABCDEF...
#
# Reads FAUCET_TREASURY_SECRET from .env.local / .env when no address is passed.

set -euo pipefail
cd "$(dirname "$0")/.."

envval() {
  local file key="$1"
  for file in .env.local .env; do
    if [[ -f "$file" ]]; then
      local v
      v="$(grep -E "^\s*${key}=" "$file" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs || true)"
      if [[ -n "$v" ]]; then
        echo "$v"
        return 0
      fi
    fi
  done
  return 1
}

ADDR="${1:-}"
if [[ -z "$ADDR" ]]; then
  SECRET="$(envval FAUCET_TREASURY_SECRET || envval STELLAR_FUNDER_SECRET || true)"
  if [[ -z "${SECRET:-}" ]]; then
    echo "Pass a G… address or set FAUCET_TREASURY_SECRET in .env.local" >&2
    exit 1
  fi
  ADDR="$(node -e "const{Keypair}=require('@stellar/stellar-sdk');console.log(Keypair.fromSecret(process.argv[1]).publicKey())" "$SECRET")"
fi

echo "Friendbot → $ADDR"
curl -sS "https://friendbot.stellar.org?addr=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$ADDR")"
echo
echo "Horizon:"
curl -sS "https://horizon-testnet.stellar.org/accounts/$ADDR" \
  | python3 -c "import json,sys; j=json.load(sys.stdin); [print(' ', (b.get('asset_code') or 'XLM'), b['balance']) for b in j.get('balances', [])]"
