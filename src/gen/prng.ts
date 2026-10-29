/** Seeded source generator PRNG. Forks depend on the root seed + label, never draw order. */
export interface Prng { next(): number; int(min: number, max: number): number; fork(label: string): Prng }
export function seedFor(seed: number, label: string): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return (Math.imul(h, 0x846ca68b) ^ (h >>> 16)) >>> 0;
}
export function createPrng(seed: number): Prng {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('invalid generator seed');
  let a = seedFor(seed, 'a'), b = seedFor(seed, 'b'), c = seedFor(seed, 'c'), d = seedFor(seed, 'd');
  const next = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0;
    c = ((c << 21) | (c >>> 11)); c = (c + t) | 0;
    return (t >>> 0) / 0x100000000;
  };
  return { next, int(min, max) {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) throw new Error('invalid PRNG range');
    return min + Math.floor(next() * (max - min + 1));
  }, fork: (label) => createPrng(seedFor(seed, label)) };
}
