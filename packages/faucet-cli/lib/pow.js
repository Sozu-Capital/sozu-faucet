import { createHash } from "node:crypto";

/** Must match server `POW_PREFIX` in lib/pow.ts */
export const POW_PREFIX = "sozu-faucet-v1";

export function leadingZeroBits(hexDigest) {
  let bits = 0;
  for (const ch of hexDigest) {
    const n = Number.parseInt(ch, 16);
    if (!Number.isFinite(n)) return bits;
    if (n === 0) {
      bits += 4;
      continue;
    }
    if (n < 2) return bits + 3;
    if (n < 4) return bits + 2;
    if (n < 8) return bits + 1;
    return bits;
  }
  return bits;
}

export function powDigest({ prefix, challengeId, to, nonce }) {
  const payload = `${prefix}:${challengeId}:${to}:${nonce}`;
  return createHash("sha256").update(payload).digest("hex");
}

export function verifyPowSolution({
  prefix,
  challengeId,
  to,
  nonce,
  difficulty,
}) {
  return (
    leadingZeroBits(powDigest({ prefix, challengeId, to, nonce })) >= difficulty
  );
}

export function solvePow({
  prefix,
  challengeId,
  to,
  difficulty,
  onProgress,
}) {
  let nonce = 0;
  for (;;) {
    const nonceStr = String(nonce);
    if (
      verifyPowSolution({
        prefix,
        challengeId,
        to,
        nonce: nonceStr,
        difficulty,
      })
    ) {
      return nonceStr;
    }
    nonce += 1;
    if (onProgress && nonce % 50_000 === 0) onProgress(nonce);
  }
}
