// Tiny seeded PRNG (mulberry32) for reproducible fake data. Pure; never use Math.random for data that must repeat.
export type Rng = () => number; // uniform in [0, 1)

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (rng: Rng, n: number) => Math.floor(rng() * n); // 0..n-1
export const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[randInt(rng, xs.length)];
export const chance = (rng: Rng, p: number) => rng() < p;

// Fisher-Yates on a copy.
export function shuffle<T>(rng: Rng, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
