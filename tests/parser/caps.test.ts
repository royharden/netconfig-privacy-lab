import { describe, expect, it } from 'vitest';
import { cfg } from './helpers';
import { parseCase, parseConfig } from '../../src/core/parser';
import {
  LIMITS,
  LimitError,
  assertNoViolations,
  checkCaseFiles,
  checkEntityCaps,
  checkFlowCount,
  decodeUtf8Strict,
} from '../../src/core/limits';

const file = (text: string, fileId = 'n01') => ({ fileId, name: `${fileId}.cfg`, text });
const codes = (r: { violations: { code: string }[] }) => r.violations.map((v) => v.code);

describe('caps (PLAN.md §3, rows 5 and 6)', () => {
  it('the constants equal the plan', () => {
    expect(LIMITS).toEqual({
      minDevicesPerCase: 3,
      maxDevicesPerCase: 8,
      maxFileBytes: 65536,
      maxCaseBytes: 524288,
      maxLinesPerFile: 1000,
      maxInterfacesPerDevice: 16,
      maxStaticRoutesPerDevice: 32,
      maxAclEntriesPerDevice: 32,
      maxBgpNeighborsPerDevice: 4,
      maxScheduledFlowsPerCase: 32,
      maxSensitiveEntitiesPerCase: 64,
      maxVariantsPerEntity: 8,
      parseDeadlineMs: 5000,
    });
  });

  it('64 KiB per file: at the cap parses, one byte over is an explicit error with no ParsedFile', () => {
    const atCap = `!${'x'.repeat(65534)}\n`;
    expect(parseConfig(file(atCap)).violations).toEqual([]);
    const over = `!${'x'.repeat(65535)}\n`;
    const r = parseConfig(file(over));
    expect(r.file).toBeNull();
    expect(r.violations).toEqual([{ code: 'file-too-large', limit: 65536, actual: 65537, fileId: 'n01' }]);
  });

  it('counts bytes as UTF-8, not characters', () => {
    const r = parseConfig(file(`!${'é'.repeat(32768)}\n`));
    expect(codes(r)).toEqual(['file-too-large']);
  });

  it('1,000 lines per file', () => {
    expect(parseConfig(file('!\n'.repeat(1000))).violations).toEqual([]);
    expect(codes(parseConfig(file('!\n'.repeat(1001))))).toEqual(['too-many-lines']);
  });

  it('16 interfaces, 32 static routes, 32 ACL entries, 4 BGP neighbours per device', () => {
    const ifaces = (n: number) => Array.from({ length: n }, (_, i) => `interface GigabitEthernet0/${i}`);
    expect(parseConfig(file(cfg(...ifaces(16)))).violations).toEqual([]);
    expect(codes(parseConfig(file(cfg(...ifaces(17)))))).toEqual(['too-many-interfaces']);

    const routes = (n: number) => Array.from({ length: n }, (_, i) => `ip route 10.${i}.0.0 255.255.0.0 192.0.2.1`);
    expect(parseConfig(file(cfg(...routes(32)))).violations).toEqual([]);
    expect(codes(parseConfig(file(cfg(...routes(33)))))).toEqual(['too-many-static-routes']);

    const entries = (n: number) => Array.from({ length: n }, (_, i) => `access-list ${100 + (i % 2)} permit tcp any any eq ${i + 1}`);
    expect(parseConfig(file(cfg(...entries(32)))).violations).toEqual([]);
    expect(codes(parseConfig(file(cfg(...entries(33)))))).toEqual(['too-many-acl-entries']);

    const neighbors = (n: number) => ['router bgp 64512', ...Array.from({ length: n }, (_, i) => ` neighbor 198.51.100.${i + 1} remote-as 64513`)];
    expect(parseConfig(file(cfg(...neighbors(4)))).violations).toEqual([]);
    expect(codes(parseConfig(file(cfg(...neighbors(5)))))).toEqual(['too-many-bgp-neighbors']);
  });

  it('3–8 devices per case; violations make the case an error (no stratum)', () => {
    const files = (n: number) => Array.from({ length: n }, (_, i) => file(cfg(`hostname h${i}`), `n${i}`));
    expect(parseCase({ caseId: 'c', files: files(3) }).stratum).toBe('semantic-positive');
    expect(parseCase({ caseId: 'c', files: files(8) }).stratum).toBe('semantic-positive');
    const two = parseCase({ caseId: 'c', files: files(2) });
    expect(codes(two)).toEqual(['too-few-devices']);
    expect(two.stratum).toBeNull();
    expect(codes(parseCase({ caseId: 'c', files: files(9) }))).toEqual(['too-many-devices']);
  });

  it('512 KiB per case is checked (implied by 8 × 64 KiB, so only reachable with more files)', () => {
    const big = Array.from({ length: 9 }, (_, i) => file(`!${'x'.repeat(65534)}\n`, `n${i}`));
    expect(checkCaseFiles(big).map((v) => v.code)).toEqual(['too-many-devices', 'case-too-large']);
    const eight = big.slice(0, 8);
    expect(checkCaseFiles(eight)).toEqual([]);
  });

  it('32 flows, 64 entities, 8 variants per entity', () => {
    expect(checkFlowCount(32)).toEqual([]);
    expect(checkFlowCount(33).map((v) => v.code)).toEqual(['too-many-flows']);
    const entity = (texts: string[]) => ({ occurrences: texts.map((text) => ({ text })) });
    expect(checkEntityCaps(Array.from({ length: 64 }, () => entity(['a'])))).toEqual([]);
    expect(checkEntityCaps(Array.from({ length: 65 }, () => entity(['a']))).map((v) => v.code)).toEqual(['too-many-entities']);
    const nine = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    expect(checkEntityCaps([entity(nine.slice(0, 8))])).toEqual([]);
    expect(checkEntityCaps([entity(nine)]).map((v) => v.code)).toEqual(['too-many-variants']);
  });

  it('UTF-8 input: lone surrogates and invalid bytes are rejected', () => {
    expect(codes(parseConfig(file('hostname a\ud800\n')))).toEqual(['invalid-unicode']);
    expect(decodeUtf8Strict(new Uint8Array([0x68, 0xff, 0x69]))).toBeNull();
    expect(decodeUtf8Strict(new Uint8Array([0xef, 0xbb, 0xbf, 0x68]))).toBe('﻿h');
  });

  it('assertNoViolations throws an explicit LimitError', () => {
    const v = parseConfig(file('!\n'.repeat(1001))).violations;
    expect(() => assertNoViolations(v)).toThrow(LimitError);
    expect(() => assertNoViolations([])).not.toThrow();
  });
});
