import { describe, expect, it } from 'vitest';
import { assertPreregistrationSelections, combinedCorpus, frozenFlowIds, parsePreregistration, parsePublicChoices, selectProbePair } from '../../scripts/preregistration';
import type { Preregistration, SelectionInputs } from '../../scripts/preregistration';
import type { Manifest, ManifestCase } from '../../src/core/manifest';
import type { CaseSidecar } from '../../src/core/sidecar';
import type { CaseInput } from '../../src/strategies/types';
import type { Family, Split, Stratum } from '../../src/core/types';
import { FAMILIES } from '../../src/core/types';
import type { PoolIndex } from '../../src/gen/pool';

// In-memory builder-only contract examples. These are not authored corpus cases or custody data.
const HASH = 'a'.repeat(64);
function manifestCase(caseId: string, split: Split, family: Family, stratum: Stratum): ManifestCase {
  return { caseId, split, family, stratum, deviceCount: 3, files: [
    ...[1, 2, 3].map(i => ({ path: `${caseId}/n0${i}.cfg`, role: 'config' as const, sha256: HASH })),
    ...(['case', 'ledger', 'labels'] as const).map(role => ({ path: `${caseId}/${role}.json`, role, sha256: HASH })),
    ...(split !== 'dev' && stratum === 'semantic-positive' ? [{ path: `${caseId}/expected.json`, role: 'expected' as const, sha256: HASH }] : []),
  ] };
}
function structuralCase(entry: ManifestCase): { sidecar: CaseSidecar; input: CaseInput } {
  const files = [1, 2, 3].map(i => ({ fileId: `n0${i}`, path: `n0${i}.cfg`, name: `n0${i}.cfg`, nodeId: `n0${i}` }));
  const sidecar: CaseSidecar = {
    schema: 'case-v1', caseId: entry.caseId, family: entry.family, stratum: entry.stratum, files,
    nodes: files.map(f => ({ id: f.nodeId, fileId: f.fileId })),
    interfaces: files.map(f => ({ id: `i${f.fileId}`, nodeId: f.nodeId, ordinal: 1 })), acls: [], aclEntries: [],
    flows: entry.stratum === 'unsupported' ? [] : Array.from({ length: 32 }, (_, i) => ({ id: `f${String(i + 1).padStart(2, '0')}`, ingressNodeId: 'n01', ingressInterfaceId: 'in01', src: '10.0.0.1', dst: '10.0.0.2', protocol: 'icmp' as const, srcPort: 0, dstPort: 0 })),
  };
  const input: CaseInput = { caseId: entry.caseId, files: files.map((f, i) => ({ fileId: f.fileId, name: f.name, text: `hostname node${i + 1}\ninterface GigabitEthernet0/0\n ip address 10.0.0.${i + 1} 255.255.255.0\n!\nend\n` })) };
  return { sidecar, input };
}
function example(): { p: Preregistration; inputs: SelectionInputs } {
  const manifest = (cases: ManifestCase[]): Manifest => ({ schema: 'manifest-v1', vaultFiles: [], cases });
  const vault = manifest(FAMILIES.flatMap((family, f) => Array.from({ length: 6 }, (_, i) => manifestCase(`h${f}${i}`, 'heldout', family, i === 5 ? 'unsupported' : 'semantic-positive'))));
  const dev = manifest(FAMILIES.flatMap((family, f) => Array.from({ length: 3 }, (_, i) => manifestCase(`d${f}${i}`, 'dev', family, i === 2 ? 'unsupported' : 'semantic-positive'))));
  const practice = manifest([manifestCase('r01', 'practice', 'ring', 'semantic-positive'), manifestCase('r02', 'practice', 'campus-tree', 'semantic-positive')]);
  let index = 0;
  const pool: PoolIndex = { schema: 'pool-v1', entries: FAMILIES.flatMap(family => [3, 4, 5, 6, 7, 8].flatMap(deviceCount => Array.from({ length: 49 }, () => {
    const caseId = `p${String(++index).padStart(4, '0')}`;
    return { caseId, family, deviceCount, seed: index, generatorCommit: 'b'.repeat(40), files: [
      ...Array.from({ length: deviceCount }, (_, i) => ({ path: `${caseId}/n${String(i + 1).padStart(2, '0')}.cfg`, role: 'config' as const, sha256: HASH })),
      { path: `${caseId}/case.json`, role: 'case' as const, sha256: HASH },
    ] };
  }))) };
  const inputs: SelectionInputs = { vault, dev, practice, corpus: combinedCorpus(dev, practice, vault), pool, heldoutCases: vault.cases.map(structuralCase) };
  const common = ['-a', '-p', '--frozen-salt-option', 's43-synthetic-salt-v1'];
  const p: Preregistration = {
    schema: 'preregister-v1', candidateCommit: 'b'.repeat(40), candidateTag: 's43-candidate-1', lockfileSha256: HASH, corpusManifestSha256: HASH, vaultManifestSha256: HASH, poolIndexSha256: HASH,
    seeds: { bootstrap: 123, probe: 7 }, flowIds: frozenFlowIds(inputs),
    probePairs: inputs.heldoutCases.map(({ input }) => ({ caseId: input.caseId, pairs: [selectProbePair(input, 7)] })),
    poolIds: pool.entries.filter(e => e.deviceCount === 3).map(e => e.caseId).sort(),
    netconanArgs: { 'netconan-minimal': [...common], 'netconan-operator': [...common, '-w', 'operator-words.txt', '-n', 'operator-asns.txt'], 'netconan-ledger-informed': [...common, '-w', 'ledger-words.txt', '-n', 'ledger-asns.txt'] }, normaliserVersion: 's43-normalise-v1',
  };
  return { p, inputs };
}

describe('closed preregistration contract', () => {
  it('accepts a complete opaque contract and exact deterministic selections', () => {
    const { p, inputs } = example();
    expect(parsePreregistration(p).ok).toBe(true);
    expect(() => assertPreregistrationSelections(p, inputs)).not.toThrow();
  });
  it.each<[string, (p: Preregistration) => unknown]>([
    ['extra root field', (p: Preregistration) => ({ ...p, labels: [] })],
    ['missing required args', (p: Preregistration) => ({ ...p, netconanArgs: { 'netconan-minimal': ['-a', '-p'] } })],
    ['extra args configuration', (p: Preregistration) => ({ ...p, netconanArgs: { ...p.netconanArgs, accidental: [] } })],
    ['empty argument arrays', (p: Preregistration) => ({ ...p, netconanArgs: { ...p.netconanArgs, 'netconan-minimal': [] } })],
    ['omitted flag', (p: Preregistration) => ({ ...p, netconanArgs: { ...p.netconanArgs, 'netconan-minimal': ['-a', 's43-synthetic-salt-v1'] } })],
    ['unresolved tool syntax', (p: Preregistration) => ({ ...p, netconanArgs: { ...p.netconanArgs, 'netconan-minimal': ['-a', '-p', '<verified-salt-switch>', 's43-synthetic-salt-v1'] } })],
    ['private map option', (p: Preregistration) => ({ ...p, netconanArgs: { ...p.netconanArgs, 'netconan-minimal': [...p.netconanArgs['netconan-minimal'], '-d'] } })],
    ['informed list omitted', (p: Preregistration) => ({ ...p, netconanArgs: { ...p.netconanArgs, 'netconan-operator': p.netconanArgs['netconan-minimal'] } })],
    ['informed list value omitted', (p: Preregistration) => ({ ...p, netconanArgs: { ...p.netconanArgs, 'netconan-operator': [...p.netconanArgs['netconan-minimal'], '-w', '-n'] } })],
    ['unsafe seed', (p: Preregistration) => ({ ...p, seeds: { ...p.seeds, probe: Number.MAX_SAFE_INTEGER + 1 } })],
    ['unknown seed field', (p: Preregistration) => ({ ...p, seeds: { ...p.seeds, labels: [] } })],
    ['invalid candidate tag', (p: Preregistration) => ({ ...p, candidateTag: '../arbitrary' })],
    ['invalid commit', (p: Preregistration) => ({ ...p, candidateCommit: 'not-a-commit' })],
    ['bad index hash', (p: Preregistration) => ({ ...p, poolIndexSha256: '123' })],
    ['omitted flow', (p: Preregistration) => ({ ...p, flowIds: p.flowIds.slice(1) })],
    ['duplicate flow', (p: Preregistration) => ({ ...p, flowIds: p.flowIds.map((id, i) => i === 1 ? p.flowIds[0]! : id) })],
    ['duplicate pool ID', (p: Preregistration) => ({ ...p, poolIds: p.poolIds.map((id, i) => i === 1 ? p.poolIds[0]! : id) })],
    ['empty probe pairs', (p: Preregistration) => ({ ...p, probePairs: p.probePairs.map(row => ({ ...row, pairs: [] })) })],
    ['malformed tuple', (p: Preregistration) => ({ ...p, probePairs: p.probePairs.map(row => ({ ...row, pairs: [['10.0.0.1']] })) })],
    ['noncanonical IPv4', (p: Preregistration) => ({ ...p, probePairs: p.probePairs.map(row => ({ ...row, pairs: [['010.0.0.1', '10.0.0.2']] })) })],
    ['duplicate address', (p: Preregistration) => ({ ...p, probePairs: p.probePairs.map(row => ({ ...row, pairs: [['10.0.0.1', '10.0.0.1']] })) })],
    ['duplicate case ID', (p: Preregistration) => ({ ...p, probePairs: p.probePairs.map((row, i) => i === 1 ? { ...row, caseId: p.probePairs[0]!.caseId } : row) })],
    ['unrecognized normaliser', (p: Preregistration) => ({ ...p, normaliserVersion: 'anything' })],
  ])('rejects %s', (_name, mutation) => {
    expect(parsePreregistration(mutation(example().p)).ok).toBe(false);
  });
  it('public choices are closed and cannot override generated pins', () => {
    const { seeds, probePairs, poolIds, netconanArgs, normaliserVersion } = example().p;
    const choices = { seeds, probePairs, poolIds, netconanArgs, normaliserVersion };
    expect(parsePublicChoices(choices).ok).toBe(true);
    expect(parsePublicChoices({ ...choices, flowIds: [] }).ok).toBe(false);
    expect(parsePublicChoices({ ...choices, candidateCommit: 'b'.repeat(40) }).ok).toBe(false);
  });
});

describe('frozen selections cannot be replaced by a matching self-hash', () => {
  it('rejects changed or reordered flow IDs even with valid shape and count', () => {
    const { p, inputs } = example();
    p.flowIds[0] = 'h00/f99';
    expect(parsePreregistration(p).ok).toBe(true);
    expect(() => assertPreregistrationSelections(p, inputs)).toThrow('flow-selection-mismatch');
    p.flowIds = frozenFlowIds(inputs).reverse();
    expect(() => assertPreregistrationSelections(p, inputs)).toThrow('flow-selection-mismatch');
  });
  it('rejects changed tuple order, changed case order and a changed probe seed', () => {
    const { p, inputs } = example();
    p.probePairs[0]!.pairs[0]!.reverse();
    expect(() => assertPreregistrationSelections(p, inputs)).toThrow('probe-selection-mismatch');
    p.probePairs = example().p.probePairs.reverse();
    expect(() => assertPreregistrationSelections(p, inputs)).toThrow('probe-selection-mismatch');
    p.probePairs = example().p.probePairs;
    p.seeds.probe = 8;
    expect(() => assertPreregistrationSelections(p, inputs)).toThrow('probe-selection-mismatch');
  });
  it('rejects a shape-valid ID from an unmatched pool cell and changed pool ordering', () => {
    const { p, inputs } = example();
    p.poolIds[0] = 'p0050';
    expect(parsePreregistration(p).ok).toBe(true);
    expect(() => assertPreregistrationSelections(p, inputs)).toThrow('pool-selection-mismatch');
    p.poolIds = example().p.poolIds.reverse();
    expect(() => assertPreregistrationSelections(p, inputs)).toThrow('pool-selection-mismatch');
  });
  it('rejects corpus manifest substitutions independently of its self-hash', () => {
    const { p, inputs } = example();
    inputs.corpus = structuredClone(inputs.corpus);
    inputs.corpus.cases[0]!.files[0]!.sha256 = 'c'.repeat(64);
    expect(() => assertPreregistrationSelections(p, inputs)).toThrow('corpus-binding-mismatch');
  });
  it('rejects altered 5-positive/1-challenge family quotas', () => {
    const { p, inputs } = example();
    inputs.vault.cases[0]!.family = 'campus-tree';
    expect(() => assertPreregistrationSelections(p, inputs)).toThrow('heldout-family-quota');
  });
  it('rejects absent vault cases and incomplete structural flow schedules', () => {
    const { p, inputs } = example();
    inputs.heldoutCases.pop();
    expect(() => assertPreregistrationSelections(p, inputs)).toThrow('missing-case-selection');
    const other = example();
    other.inputs.heldoutCases[0]!.sidecar.flows.pop();
    expect(() => assertPreregistrationSelections(other.p, other.inputs)).toThrow('case-selection-mismatch');
  });
  it('selects only nonzero structural address roles; masks and free text never enter the probe', () => {
    const { inputs } = example(), input = inputs.heldoutCases[0]!.input;
    const pair = selectProbePair(input, 7);
    expect(pair).toHaveLength(2);
    expect(new Set(pair).size).toBe(2);
    expect(pair.every(address => ['10.0.0.1', '10.0.0.2', '10.0.0.3'].includes(address))).toBe(true);
    const changed = structuredClone(input);
    changed.files.reverse();
    changed.files[0]!.text += '! 192.0.2.99\n';
    expect(selectProbePair(changed, 7)).toEqual(pair);
  });
});
