// Seeded, serialisable RNG (sfc32). State is a plain array so it survives JSON
// round-trips (localStorage, Firestore documents, Postgres jsonb).

export function seedRng(seed) {
  // splitmix32 to expand a 32-bit seed into 4 words
  let s = (seed >>> 0) || 0x9e3779b9;
  const next = () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  const st = [next(), next(), next(), next()];
  for (let i = 0; i < 12; i++) rngU32(st);
  return st;
}

export function rngU32(st) {
  let [a, b, c, d] = st;
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) >>> 0;
  st[0] = a >>> 0; st[1] = b; st[2] = c; st[3] = d;
  return t;
}

export const rngFloat = (st) => rngU32(st) / 4294967296;
/** Uniform integer in [lo, hi] inclusive. */
export const rngInt = (st, lo, hi) => lo + Math.floor(rngFloat(st) * (hi - lo + 1));
export const rngPick = (st, arr) => arr[Math.floor(rngFloat(st) * arr.length)];
export function rngShuffle(st, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rngFloat(st) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function rngWeighted(st, weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rngFloat(st) * total;
  for (const [k, w] of entries) { if ((r -= w) < 0) return k; }
  return entries[entries.length - 1][0];
}
