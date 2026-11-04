// Deterministic helpers. Every "random" choice in the lab comes from here, so a
// run with the same seed always produces the same results.

/** Mulberry32: a small, well-known 32-bit PRNG. */
export function rng(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable hash of a string to [0, 1). Used for per-call outcomes. */
export function unit(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000
}

export const pick = (r, list) => list[Math.floor(r() * list.length)]
export const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d
