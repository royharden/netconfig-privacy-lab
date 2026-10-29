/** Generator-only vocabulary. Detectors and strategies MUST NOT import this module. */
import type { Prng } from './prng';
export function inventedNames(random: Prng, count: number): string[] {
  const alphabet = 'bcdfghjklmnpqrstvwxyz';
  const root = Array.from({ length: 8 }, () => alphabet[random.int(0, alphabet.length - 1)]).join('');
  return Array.from({ length: count }, (_, i) => `${root}r${i + 1}`);
}
