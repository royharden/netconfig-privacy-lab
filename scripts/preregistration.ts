/** Closed G2 contract. Structural/config inputs only: label files are hashed, never parsed here. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { safePath, sha256, verifyVault } from './custody';
import { parseManifest } from '../src/core/manifest';
import type { Manifest } from '../src/core/manifest';
import { parseSidecar } from '../src/core/sidecar';
import type { CaseSidecar } from '../src/core/sidecar';
import { parseCase } from '../src/core/parser';
import { parseIPv4 } from '../src/core/ipv4';
import { probeAddressStrings } from '../src/eval/probes';
import { FAMILIES, ID_PATTERN, SHA256_PATTERN, ShapeChecker } from '../src/core/types';
import type { Validated } from '../src/core/types';
import type { CaseInput } from '../src/strategies/types';
import { parsePoolIndex } from '../src/gen/pool';
import type { PoolIndex } from '../src/gen/pool';
import { canonicalJson, NORMALISER_VERSION } from '../src/eval/normalise';

export const NETCONAN_CONFIGURATIONS = ['netconan-minimal', 'netconan-operator', 'netconan-ledger-informed'] as const;
export const CANDIDATE_TAG_PATTERN = /^(?!.*\.\.)(?!.*\.lock$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?<!\.)$/;
const FLOW_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}\/[a-z0-9][a-z0-9-]{0,63}$/;
export interface PublicChoices {
  seeds: { bootstrap: number; probe: number };
  /** One ordered tuple of two original addresses per held-out case. Runtime correspondence supplies output addresses. */
  probePairs: { caseId: string; pairs: [string, string][] }[];
  poolIds: string[];
  netconanArgs: Record<(typeof NETCONAN_CONFIGURATIONS)[number], string[]>;
  normaliserVersion: typeof NORMALISER_VERSION;
  recordingExpectationsSha256?: string;
}
export interface Preregistration extends PublicChoices {
  schema: 'preregister-v1'; candidateCommit: string; candidateTag: string;
  lockfileSha256: string; corpusManifestSha256: string; vaultManifestSha256: string; poolIndexSha256: string;
  flowIds: string[];
}
const CHOICE_KEYS = ['seeds', 'probePairs', 'poolIds', 'netconanArgs', 'normaliserVersion'];
function checkChoices(c: ShapeChecker, o: Record<string, unknown>): void {
  const seeds = c.object(o.seeds, '$.seeds', ['bootstrap', 'probe']);
  if (seeds) for (const key of ['bootstrap', 'probe']) c.integer(seeds[key], `$.seeds.${key}`, 0, Number.MAX_SAFE_INTEGER);
  const cases = new Set<string>();
  (c.array(o.probePairs, '$.probePairs', 24, 24) ?? []).forEach((value, i) => {
    const path = `$.probePairs[${i}]`, row = c.object(value, path, ['caseId', 'pairs']);
    if (!row) return;
    c.unique(c.string(row.caseId, `${path}.caseId`, ID_PATTERN, 64), cases, `${path}.caseId`);
    (c.array(row.pairs, `${path}.pairs`, 1, 1) ?? []).forEach((value, j) => {
      const pair = c.array(value, `${path}.pairs[${j}]`, 2, 2), addresses = new Set<string>();
      (pair ?? []).forEach((value, k) => {
        const p = `${path}.pairs[${j}][${k}]`, address = c.string(value, p, undefined, 15);
        if (address !== null && (parseIPv4(address) === null || address === '0.0.0.0')) c.fail(p, 'expected a nonzero canonical IPv4 address');
        c.unique(address, addresses, p);
      });
    });
  });
  const poolIds = new Set<string>();
  (c.array(o.poolIds, '$.poolIds', 196, 1176) ?? []).forEach((value, i) => c.unique(c.string(value, `$.poolIds[${i}]`, /^p\d{4}$/, 5), poolIds, `$.poolIds[${i}]`));
  const args = c.object(o.netconanArgs, '$.netconanArgs', NETCONAN_CONFIGURATIONS);
  if (args) for (const arm of NETCONAN_CONFIGURATIONS) {
    const array = c.array(args[arm], `$.netconanArgs.${arm}`, 3, 256) ?? [];
    array.forEach((value, i) => {
      const path = `$.netconanArgs.${arm}[${i}]`, arg = c.string(value, path, undefined, 4096);
      if (arg !== null && (arg.length === 0 || /[\x00-\x1f\x7f<>]/.test(arg))) c.fail(path, 'empty, control or unresolved placeholder argument');
    });
    for (const required of ['-a', '-p', 's43-synthetic-salt-v1']) if (array.filter(value => value === required).length !== 1) c.fail(`$.netconanArgs.${arm}`, 'missing or repeated frozen flag/synthetic salt');
    if (array.some(value => typeof value === 'string' && /^-d(?:=|$)/.test(value))) c.fail(`$.netconanArgs.${arm}`, 'private map flag is not a recording argument');
    for (const flag of ['-w', '-n']) {
      const index = array.indexOf(flag);
      if (arm === 'netconan-minimal') {
        if (index !== -1) c.fail(`$.netconanArgs.${arm}`, 'minimal configuration has no informed lists');
      } else {
        const list = array[index + 1];
        if (array.filter(value => value === flag).length !== 1 || typeof list !== 'string' || list.length === 0 || list.startsWith('-')) c.fail(`$.netconanArgs.${arm}`, 'informed configuration requires each list flag and argument');
      }
    }
  }
  c.constant(o.normaliserVersion, '$.normaliserVersion', NORMALISER_VERSION);
  if ('recordingExpectationsSha256' in o) c.string(o.recordingExpectationsSha256, '$.recordingExpectationsSha256', SHA256_PATTERN, 64);
}
export function parsePublicChoices(value: unknown): Validated<PublicChoices> {
  const c = new ShapeChecker(), o = c.object(value, '$', CHOICE_KEYS, ['recordingExpectationsSha256']);
  if (o) checkChoices(c, o);
  return c.result<PublicChoices>(value);
}
export function parsePreregistration(value: unknown): Validated<Preregistration> {
  const c = new ShapeChecker(), o = c.object(value, '$', [...CHOICE_KEYS, 'schema', 'candidateCommit', 'candidateTag', 'lockfileSha256', 'corpusManifestSha256', 'vaultManifestSha256', 'poolIndexSha256', 'flowIds'], ['recordingExpectationsSha256']);
  if (o) {
    checkChoices(c, o);
    c.constant(o.schema, '$.schema', 'preregister-v1');
    c.string(o.candidateCommit, '$.candidateCommit', /^[0-9a-f]{40}$/, 40);
    c.string(o.candidateTag, '$.candidateTag', CANDIDATE_TAG_PATTERN, 128);
    for (const key of ['lockfileSha256', 'corpusManifestSha256', 'vaultManifestSha256', 'poolIndexSha256']) c.string(o[key], `$.${key}`, SHA256_PATTERN, 64);
    const ids = new Set<string>();
    (c.array(o.flowIds, '$.flowIds', 640, 640) ?? []).forEach((value, i) => c.unique(c.string(value, `$.flowIds[${i}]`, FLOW_ID_PATTERN, 129), ids, `$.flowIds[${i}]`));
  }
  return c.result<Preregistration>(value);
}

/** Hash-ranked selection is independent of declaration order, labels and the strategy key. */
export function selectProbePair(input: CaseInput, seed: number): [string, string] {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('invalid-probe-seed');
  const parsed = parseCase(input);
  if (parsed.violations.length > 0) throw new Error('probe-config-caps');
  const ranked = probeAddressStrings(input).map(address => ({ address, rank: sha256(`s43/probe-pair/v1\n${seed}\n${input.caseId}\n${address}`) }));
  ranked.sort((a, b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
  const first = ranked[0], second = ranked[1];
  if (!first || !second) throw new Error('insufficient-probe-addresses');
  return [first.address, second.address];
}

export interface SelectionInputs {
  vault: Manifest; dev: Manifest; practice: Manifest; corpus: Manifest; pool: PoolIndex;
  heldoutCases: { sidecar: CaseSidecar; input: CaseInput }[];
}
export function combinedCorpus(dev: Manifest, practice: Manifest, vault: Manifest): Manifest {
  const corpus: Manifest = { schema: 'manifest-v1', vaultFiles: [], cases: [...dev.cases, ...practice.cases, ...vault.cases] };
  if (!parseManifest(corpus).ok) throw new Error('invalid-combined-corpus');
  return corpus;
}
export function frozenFlowIds(inputs: SelectionInputs): string[] {
  return inputs.heldoutCases.flatMap(({ sidecar }) => sidecar.flows.map(flow => `${sidecar.caseId}/${flow.id}`));
}
/** Pure selection verification, also used by mutation regression source. */
export function assertPreregistrationSelections(p: Preregistration, inputs: SelectionInputs): void {
  if (!parsePreregistration(p).ok) throw new Error('invalid-preregistration');
  const { vault, dev, practice, corpus, pool, heldoutCases } = inputs;
  for (const m of [vault, dev, practice, corpus]) if (!parseManifest(m).ok) throw new Error('invalid-selection-manifest');
  if (!parsePoolIndex(pool).ok) throw new Error('invalid-selection-pool');
  if (vault.cases.length !== 24 || vault.cases.some(c => c.split !== 'heldout')) throw new Error('heldout-quota');
  for (const family of FAMILIES) for (const stratum of ['semantic-positive', 'unsupported'] as const) {
    if (vault.cases.filter(c => c.family === family && c.stratum === stratum).length !== (stratum === 'semantic-positive' ? 5 : 1)) throw new Error('heldout-family-quota');
  }
  if (dev.cases.length !== 12 || dev.cases.some(c => c.split !== 'dev') || practice.cases.length !== 2 || practice.cases.some(c => c.split !== 'practice')) throw new Error('corpus-split-quota');
  for (const family of FAMILIES) for (const stratum of ['semantic-positive', 'unsupported'] as const) {
    if (dev.cases.filter(c => c.family === family && c.stratum === stratum).length !== (stratum === 'semantic-positive' ? 2 : 1)) throw new Error('dev-family-quota');
  }
  if (canonicalJson(corpus) !== canonicalJson(combinedCorpus(dev, practice, vault))) throw new Error('corpus-binding-mismatch');
  if (heldoutCases.length !== 24) throw new Error('missing-case-selection');
  heldoutCases.forEach(({ sidecar, input }, i) => {
    const entry = vault.cases[i];
    if (!entry || !parseSidecar(sidecar).ok || sidecar.caseId !== entry.caseId || input.caseId !== entry.caseId || sidecar.family !== entry.family || sidecar.stratum !== entry.stratum || sidecar.files.length !== entry.deviceCount || sidecar.flows.length !== (entry.stratum === 'semantic-positive' ? 32 : 0)) throw new Error('case-selection-mismatch');
    if (input.files.length !== sidecar.files.length || sidecar.files.some(f => input.files.filter(x => x.fileId === f.fileId && x.name === f.name).length !== 1)) throw new Error('case-input-mismatch');
  });
  if (canonicalJson(p.flowIds) !== canonicalJson(frozenFlowIds(inputs))) throw new Error('flow-selection-mismatch');
  const pairs = heldoutCases.map(({ input }) => ({ caseId: input.caseId, pairs: [selectProbePair(input, p.seeds.probe)] }));
  if (canonicalJson(p.probePairs) !== canonicalJson(pairs)) throw new Error('probe-selection-mismatch');
  const cells = new Set(vault.cases.map(c => `${c.family}/${c.deviceCount}`));
  const poolIds = pool.entries.filter(e => cells.has(`${e.family}/${e.deviceCount}`)).map(e => e.caseId).sort();
  if (canonicalJson(p.poolIds) !== canonicalJson(poolIds)) throw new Error('pool-selection-mismatch');
}

/** Verifies every listed byte; no label JSON is parsed or returned. */
export async function loadSelectionInputs(vaultRoot: string, projectRoot = process.cwd()): Promise<{ inputs: SelectionInputs; vaultPin: string; poolHash: string }> {
  const vaultPin = (await readFile(resolve(projectRoot, 'gold/heldout/MANIFEST.sha256'), 'utf8')).trim();
  if (!SHA256_PATTERN.test(vaultPin)) throw new Error('invalid-vault-pin');
  const { manifest: vault } = await verifyVault(vaultRoot, vaultPin, true);
  const readSplit = async (split: 'dev' | 'practice'): Promise<Manifest> => {
    const root = resolve(projectRoot, 'fixtures', split), bytes = await readFile(await safePath(root, 'MANIFEST.json'));
    return (await verifyVault(root, sha256(bytes), true)).manifest;
  };
  const dev = await readSplit('dev'), practice = await readSplit('practice');
  const poolBytes = await readFile(resolve(projectRoot, 'fixtures/pool/INDEX.json'));
  const pool = parsePoolIndex(JSON.parse(poolBytes.toString('utf8')));
  if (!pool.ok) throw new Error('invalid-pool-index');
  const heldoutCases: SelectionInputs['heldoutCases'] = [];
  for (const entry of vault.cases) {
    const file = entry.files.find(f => f.role === 'case');
    if (!file) throw new Error('missing-case');
    const bytes = await readFile(await safePath(vaultRoot, file.path));
    if (sha256(bytes) !== file.sha256) throw new Error('case-hash-mismatch');
    const sidecar = parseSidecar(JSON.parse(bytes.toString('utf8')));
    if (!sidecar.ok) throw new Error('invalid-case');
    const input: CaseInput = { caseId: entry.caseId, files: [] };
    for (const f of sidecar.value.files) {
      const config = entry.files.find(x => x.role === 'config' && x.path === `${file.path.split('/')[0]}/${f.path}`);
      if (!config) throw new Error('missing-case-config');
      const configBytes = await readFile(await safePath(vaultRoot, config.path));
      if (sha256(configBytes) !== config.sha256) throw new Error('config-hash-mismatch');
      input.files.push({ fileId: f.fileId, name: f.name, text: configBytes.toString('utf8') });
    }
    heldoutCases.push({ sidecar: sidecar.value, input });
  }
  return { inputs: { vault, dev, practice, corpus: combinedCorpus(dev, practice, vault), pool: pool.value, heldoutCases }, vaultPin, poolHash: sha256(poolBytes) };
}
export async function verifyPreregistrationSelections(p: Preregistration, vaultRoot: string, projectRoot = process.cwd()): Promise<void> {
  if (!parsePreregistration(p).ok) throw new Error('invalid-preregistration');
  const { inputs, vaultPin, poolHash } = await loadSelectionInputs(vaultRoot, projectRoot);
  const corpusBytes = await readFile(resolve(projectRoot, 'evaluation/corpus-manifest.json'));
  const corpus = parseManifest(JSON.parse(corpusBytes.toString('utf8')));
  if (!corpus.ok || sha256(corpusBytes) !== p.corpusManifestSha256 || vaultPin !== p.vaultManifestSha256 || poolHash !== p.poolIndexSha256 || sha256(await readFile(resolve(projectRoot, 'package-lock.json'))) !== p.lockfileSha256) throw new Error('preregistration-input-pin-mismatch');
  assertPreregistrationSelections(p, { ...inputs, corpus: corpus.value });
}
