/** Deferred until Dirty Mode closes. This script never reads practice/heldout, never produces expected answers. */
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Manifest, ManifestCaseFile } from '../src/core/manifest';
import { GENERATOR_COMMIT_RE, parseManifest } from '../src/core/manifest';
import { devSpecs, generatePool, parsePoolIndex } from '../src/gen/pool';
import type { PoolIndex, PoolEntry } from '../src/gen/pool';
import { generateCase } from '../src/gen/generator';
import type { GeneratedCase } from '../src/gen/generator';

const args = process.argv.slice(2);
const allowed = new Set(['--seed', '--generator-commit', '--mode', '--dirty-mode-closed']);
const options = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (!allowed.has(flag) || options.has(flag)) throw new Error('unknown or repeated generator argument');
  if (flag === '--dirty-mode-closed') options.set(flag, 'yes');
  else {
    const value = args[++i];
    if (value === undefined || value.startsWith('--')) throw new Error('missing generator argument');
    options.set(flag, value);
  }
}
if (!options.has('--dirty-mode-closed')) throw new Error('generation deferred: close Dirty Mode before running');
const seedText = options.get('--seed') ?? '';
if (!/^\d+$/.test(seedText)) throw new Error('explicit seed required');
const seed = Number(seedText);
if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('invalid seed');
const generatorCommit = options.get('--generator-commit') ?? '';
if (!GENERATOR_COMMIT_RE.test(generatorCommit)) throw new Error('explicit generator commit required');
const mode = options.get('--mode') ?? 'both';
if (!['dev', 'pool', 'both'].includes(mode)) throw new Error('mode must be dev, pool or both');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const hash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
// Exclusive writes preserve existing generated/frozen bytes; a partial failure requires an operator's decision.
async function put(base: string, path: string, text: string): Promise<string> {
  const target = resolve(base, path);
  if (!target.startsWith(`${base}/`) && !target.startsWith(`${base}\\`)) throw new Error('output escapes fixture directory');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, { encoding: 'utf8', flag: 'wx' });
  return hash(text);
}
async function writeCase(base: string, g: GeneratedCase, includeLabels: boolean): Promise<ManifestCaseFile[]> {
  const files: ManifestCaseFile[] = [];
  for (const f of g.files) {
    // Display names are metadata only. Physical names always use the opaque stable file ID.
    const path = `${g.spec.caseId}/${f.fileId}.cfg`;
    files.push({ path, role: 'config', sha256: await put(base, path, f.text) });
  }
  const casePath = `${g.spec.caseId}/case.json`;
  files.push({ path: casePath, role: 'case', sha256: await put(base, casePath, json(g.sidecar)) });
  if (includeLabels) for (const role of ['ledger', 'labels'] as const) {
    const path = `${g.spec.caseId}/${role}.json`;
    files.push({ path, role, sha256: await put(base, path, json(g[role])) });
  }
  return files;
}
if (mode === 'dev' || mode === 'both') {
  const base = resolve(root, 'fixtures/dev');
  const manifest: Manifest = { schema: 'manifest-v1', vaultFiles: [], cases: [] };
  for (const spec of devSpecs(seed)) {
    const g = generateCase(spec);
    manifest.cases.push({ caseId: spec.caseId, split: 'dev', family: spec.family, deviceCount: spec.deviceCount,
      stratum: spec.stratum, seed: spec.seed, generatorCommit, files: await writeCase(base, g, true) });
  }
  if (!parseManifest(manifest).ok) throw new Error('generated manifest rejected');
  // The source README is documented, hashed and listed; MANIFEST.json does not list itself.
  const { readFile } = await import('node:fs/promises');
  const readme = await readFile(resolve(base, 'README.md'), 'utf8');
  manifest.vaultFiles.push({ path: 'README.md', role: 'readme', sha256: hash(readme) });
  await put(base, 'MANIFEST.json', json(manifest));
}
if (mode === 'pool' || mode === 'both') {
  const base = resolve(root, 'fixtures/pool');
  const index: PoolIndex = { schema: 'pool-v1', entries: [] };
  for (const g of generatePool(seed)) {
    const written = await writeCase(base, g, false);
    const files: PoolEntry['files'] = written.map((f) => {
      if (f.role !== 'config' && f.role !== 'case') throw new Error('pool role violation');
      return { path: f.path, role: f.role, sha256: f.sha256 };
    });
    index.entries.push({ caseId: g.spec.caseId, family: g.spec.family, deviceCount: g.spec.deviceCount,
      seed: g.spec.seed, generatorCommit, files });
  }
  if (!parsePoolIndex(index).ok) throw new Error('generated pool index rejected');
  await put(base, 'INDEX.json', json(index));
}
