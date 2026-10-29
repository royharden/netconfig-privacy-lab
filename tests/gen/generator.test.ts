// Written in Dirty Mode; all execution deferred until it closes.
import { describe, it, expect } from 'vitest';
import { generateCase, auditGeneratedCase } from '../../src/gen/generator';
import { FAMILIES } from '../../src/core/types';
import { parseCase } from '../../src/core/parser';
import { parseLedger } from '../../src/core/ledger';
import { parseLabels } from '../../src/core/labels';
import { parseSidecar } from '../../src/core/sidecar';
import { validateLabelSpans, validateLedgerSpans } from '../../src/core/ledgerValidate';
import { createPrng } from '../../src/gen/prng';
import { devSpecs, poolSpecs, parsePoolIndex, DECOYS_PER_CELL } from '../../src/gen/pool';
import type { PoolIndex } from '../../src/gen/pool';
describe('generator construction contract', () => {
  it('has deterministic streams, independent forks and case bytes', () => {
    const a = createPrng(43), b = createPrng(43);
    expect(Array.from({ length: 40 }, () => a.next())).toEqual(Array.from({ length: 40 }, () => b.next()));
    const c = createPrng(43); c.next(); c.next();
    expect(c.fork('route').next()).toBe(createPrng(43).fork('route').next());
    const spec = { caseId: 'd01', family: 'ring' as const, deviceCount: 8, seed: 43, stratum: 'semantic-positive' as const };
    expect(generateCase(spec)).toEqual(generateCase(spec));
    expect(generateCase({ ...spec, seed: 44 }).files).not.toEqual(generateCase(spec).files);
  });
  for (const family of FAMILIES) for (let deviceCount = 3; deviceCount <= 8; deviceCount++) {
    it(`${family}/${deviceCount}: obeys caps, schemas, spans and exact32/zero flow rule`, () => {
      for (const seed of [0, 43, 4294967295]) for (const stratum of ['semantic-positive', 'unsupported'] as const) {
        const g = generateCase({ caseId: 'd01', family, deviceCount, seed, stratum });
        expect(g.files).toHaveLength(deviceCount);
        expect(g.ledger.entities.length).toBeLessThanOrEqual(64);
        expect(g.ledger.entities.every((e) => new Set(e.occurrences.map((o) => o.text)).size <= 8)).toBe(true);
        expect(g.sidecar.flows).toHaveLength(stratum === 'semantic-positive' ? 32 : 0);
        expect(parseLedger(g.ledger).ok && parseLabels(g.labels).ok && parseSidecar(g.sidecar).ok).toBe(true);
        expect(validateLedgerSpans(g.ledger, g.files)).toEqual([]);
        expect(validateLabelSpans(g.labels, g.files)).toEqual([]);
        expect(parseCase({ caseId: g.spec.caseId, files: g.files }).stratum).toBe(stratum);
        expect(() => auditGeneratedCase(g)).not.toThrow();
      }
    });
  }
  it('rejects accidental flow, endpoint, route and ledger drift', () => {
    const make = () => generateCase({ caseId: 'd01', family: 'ring', deviceCount: 8, seed: 17, stratum: 'semantic-positive' });
    const flow = make(); flow.sidecar.flows.pop(); expect(() => auditGeneratedCase(flow)).toThrow('flow-count');
    const endpoint = make(); endpoint.sidecar.flows[0].dst = '1.2.3.4'; expect(() => auditGeneratedCase(endpoint)).toThrow('config-present-endpoints');
    const span = make(); span.ledger.entities[0].occurrences[0].start++; expect(() => auditGeneratedCase(span)).toThrow();
    const unsupported = make(); unsupported.files[0].text += 'router ospf 1\n'; expect(() => auditGeneratedCase(unsupported)).toThrow('parse');
  });
  it('encodes the 8 positive + 4 challenge dev split and 49 per 24 pool cells', () => {
    const dev = devSpecs(43), pool = [...poolSpecs(43)];
    expect(dev.filter((s) => s.stratum === 'semantic-positive')).toHaveLength(8);
    expect(dev.filter((s) => s.stratum === 'unsupported')).toHaveLength(4);
    expect(pool).toHaveLength(1176);
    expect(new Set(pool.map((s) => s.caseId)).size).toBe(1176);
    for (const family of FAMILIES) for (let n = 3; n <= 8; n++) expect(pool.filter((s) => s.family === family && s.deviceCount === n)).toHaveLength(DECOYS_PER_CELL);
    expect(pool).toEqual([...poolSpecs(43)]);
  });
  it('validates pool quotas, opaque paths and roles independently of the corpus manifest', () => {
    const index: PoolIndex = { schema: 'pool-v1', entries: [...poolSpecs(43)].map((s) => ({
      caseId: s.caseId, family: s.family, deviceCount: s.deviceCount, seed: s.seed, generatorCommit: '123abcd',
      files: [...Array.from({ length: s.deviceCount }, (_, i) => ({ path: `${s.caseId}/n${String(i + 1).padStart(2, '0')}.cfg`, role: 'config' as const, sha256: 'a'.repeat(64) })),
        { path: `${s.caseId}/case.json`, role: 'case' as const, sha256: 'b'.repeat(64) }],
    })) };
    expect(parsePoolIndex(index).ok).toBe(true);
    const edited = structuredClone(index); edited.entries[0].family = 'campus-tree'; expect(parsePoolIndex(edited).ok).toBe(false);
    const paths = structuredClone(index); paths.entries[0].files[0].path = '../secret.cfg'; expect(parsePoolIndex(paths).ok).toBe(false);
  });
});
