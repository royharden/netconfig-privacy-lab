/** Pool is deliberately separate from the vault/corpus manifest: decoys have no gold/labels/expected role. */
import { FAMILIES, ShapeChecker, SHA256_PATTERN } from '../core/types';
import type { Family, Validated } from '../core/types';
import { GENERATOR_COMMIT_RE } from '../core/manifest';
import { seedFor } from './prng';
import { generateCase } from './generator';
import type { GeneratedCase, GeneratorSpec } from './generator';
export const DECOYS_PER_CELL = 49;
export const POOL_DEVICE_COUNTS = [3, 4, 5, 6, 7, 8] as const;
export const POOL_SCHEMA_ID = 'pool-v1';
export const DEV_POSITIVES_PER_FAMILY = 2;
export const DEV_CHALLENGES_PER_FAMILY = 1;
export interface PoolEntry {
  caseId: string; family: Family; deviceCount: number; seed: number; generatorCommit: string;
  files: { path: string; role: 'config' | 'case'; sha256: string }[];
}
export interface PoolIndex { schema: typeof POOL_SCHEMA_ID; entries: PoolEntry[] }
export function devSpecs(seed: number): GeneratorSpec[] {
  return FAMILIES.flatMap((family, fi) => Array.from({ length: DEV_POSITIVES_PER_FAMILY + DEV_CHALLENGES_PER_FAMILY }, (_, i) => ({
    caseId: `d${String(fi * 3 + i + 1).padStart(2, '0')}`, family,
    deviceCount: i === 0 ? 3 + fi % 3 : i === 1 ? 8 - fi % 3 : 4 + fi % 3,
    seed: seedFor(seed, `dev/${family}/${i}`), stratum: i < DEV_POSITIVES_PER_FAMILY ? 'semantic-positive' as const : 'unsupported' as const,
  })));
}
/** Lazy iteration keeps the 1,176-case pool bounded in memory. */
export function* poolSpecs(seed: number): Generator<GeneratorSpec> {
  let index = 0;
  for (const family of FAMILIES) for (const deviceCount of POOL_DEVICE_COUNTS) for (let i = 0; i < DECOYS_PER_CELL; i++) {
    index++;
    yield { caseId: `p${String(index).padStart(4, '0')}`, family, deviceCount,
      seed: seedFor(seed, `pool/${family}/${deviceCount}/${i}`), stratum: 'semantic-positive' };
  }
}
export function* generatePool(seed: number): Generator<GeneratedCase> { for (const spec of poolSpecs(seed)) yield generateCase(spec); }
export function parsePoolIndex(value: unknown): Validated<PoolIndex> {
  const c = new ShapeChecker();
  const root = c.object(value, '$', ['schema', 'entries']);
  if (root === null) return c.result<PoolIndex>(value);
  c.constant(root.schema, '$.schema', POOL_SCHEMA_ID);
  const ids = new Set<string>(), paths = new Set<string>();
  const cells = new Map<string, number>();
  const entries = c.array(root.entries, '$.entries', 1176, 1176) ?? [];
  entries.forEach((item, i) => {
    const p = `$.entries[${i}]`, e = c.object(item, p, ['caseId', 'family', 'deviceCount', 'seed', 'generatorCommit', 'files']);
    if (e === null) return;
    const id = c.string(e.caseId, `${p}.caseId`, /^p\d{4}$/); c.unique(id, ids, `${p}.caseId`);
    const family = c.enumValue(e.family, `${p}.family`, FAMILIES);
    const count = c.integer(e.deviceCount, `${p}.deviceCount`, 3, 8);
    c.integer(e.seed, `${p}.seed`, 0, Number.MAX_SAFE_INTEGER);
    c.string(e.generatorCommit, `${p}.generatorCommit`, GENERATOR_COMMIT_RE);
    if (family !== null && count !== null) { const key = `${family}/${count}`; cells.set(key, (cells.get(key) ?? 0) + 1); }
    let configs = 0, cases = 0;
    (c.array(e.files, `${p}.files`) ?? []).forEach((file, j) => {
      const q = `${p}.files[${j}]`, f = c.object(file, q, ['path', 'role', 'sha256']); if (f === null) return;
      const path = c.string(f.path, `${q}.path`, /^p\d{4}\/(?:n\d{2}\.cfg|case\.json)$/);
      c.unique(path, paths, `${q}.path`);
      const role = c.enumValue(f.role, `${q}.role`, ['config', 'case'] as const);
      if (role === 'config') configs++; if (role === 'case') cases++;
      if (path !== null && id !== null && !path.startsWith(`${id}/`)) c.fail(q, 'path belongs to another case');
      if (path !== null && ((role === 'case') !== path.endsWith('/case.json'))) c.fail(q, 'path/role mismatch');
      c.string(f.sha256, `${q}.sha256`, SHA256_PATTERN);
    });
    if (count !== null && (configs !== count || cases !== 1)) c.fail(`${p}.files`, 'wrong config/case counts');
  });
  for (const family of FAMILIES) for (const count of POOL_DEVICE_COUNTS) if (cells.get(`${family}/${count}`) !== DECOYS_PER_CELL) c.fail('$.entries', 'wrong family/count quota');
  return c.result<PoolIndex>(value);
}
