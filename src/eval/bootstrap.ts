import type { Family } from '../core/types';
export interface Cluster { caseId: string; family: Family; numerator: number; denominator: number }
export interface Interval { low: number | null; high: number | null; resamples: number; seed: number }
/** Paired cluster draws: one sampled case index serves both arms; ratios use summed counts. */
export function pairedBootstrap(a: Cluster[], b: Cluster[], seed: number, resamples = 2000): Interval {
  if (!Number.isSafeInteger(resamples) || resamples < 1) throw new Error('invalid-bootstrap-count');
  const right = new Map(b.map(x => [x.caseId, x]));
  if (right.size !== b.length || new Set(a.map(x => x.caseId)).size !== a.length || a.length !== b.length || a.some(x => right.get(x.caseId)?.family !== x.family)) throw new Error('unpaired-clusters');
  const groups = new Map<Family, Cluster[]>();
  for (const c of a) groups.set(c.family, [...(groups.get(c.family) ?? []), c]);
  let state = seed >>> 0;
  const random = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const differences: number[] = [];
  for (let n = 0; n < resamples; n++) {
    let an = 0, ad = 0, bn = 0, bd = 0;
    for (const group of groups.values()) for (let i = 0; i < group.length; i++) {
      const x = group[Math.floor(random() * group.length)]!, y = right.get(x.caseId)!;
      an += x.numerator; ad += x.denominator; bn += y.numerator; bd += y.denominator;
    }
    if (ad && bd) differences.push(an / ad - bn / bd);
  }
  differences.sort((x, y) => x - y);
  return { low: differences.length ? differences[Math.floor((differences.length - 1) * .025)]! : null, high: differences.length ? differences[Math.ceil((differences.length - 1) * .975)]! : null, resamples, seed };
}
