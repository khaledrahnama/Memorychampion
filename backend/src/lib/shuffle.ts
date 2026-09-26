import { createHash } from "node:crypto";

/**
 * Deterministic per-player shuffle (spec: same photos and questions for
 * everyone, randomized answer order). Seeded by game+player+round so a player
 * sees the same order if they refresh mid-question.
 */
export function shuffledOrder(length: number, seed: string): number[] {
  const order = Array.from({ length }, (_, i) => i);
  let h = createHash("sha256").update(seed).digest();
  let byte = 0;
  const next = () => {
    if (byte + 4 > h.length) {
      h = createHash("sha256").update(h).digest();
      byte = 0;
    }
    const n = h.readUInt32BE(byte);
    byte += 4;
    return n;
  };
  for (let i = length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
