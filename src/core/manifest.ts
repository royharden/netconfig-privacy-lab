/**
 * Vault / corpus manifest `manifest-v1` (PLAN.md row 42a/b/d). Schema: schemas/manifest.schema.json.
 *
 * - Every file in the vault except `MANIFEST.json` itself is listed exactly once: case files under `cases[].files`, everything
 *   else (PROVENANCE.md, README.md) under `vaultFiles`.
 * - On-disk case paths are opaque (`h01/n01.cfg`, `h01/case.json`); case IDs are opaque synthetic IDs, never hostnames.
 * - Label files are identified by role (`labels`, `ledger`, `expected`): the label-blind preflight only hashes them.
 * - `gold/heldout/MANIFEST.sha256` holds the SHA-256 of `MANIFEST.json` (G1).
 */
import type { Family, Split, Stratum, Validated } from './types';
import { FAMILIES, ID_PATTERN, SHA256_PATTERN, SPLITS, STRATA, ShapeChecker } from './types';
import { MAX_DEVICES_PER_CASE, MIN_DEVICES_PER_CASE } from './limits';

export const MANIFEST_SCHEMA_ID = 'manifest-v1';

export type VaultFileRole = 'provenance' | 'readme';
export const VAULT_FILE_ROLES: readonly VaultFileRole[] = ['provenance', 'readme'];

export type CaseFileRole = 'config' | 'case' | 'labels' | 'ledger' | 'expected';
export const CASE_FILE_ROLES: readonly CaseFileRole[] = ['config', 'case', 'labels', 'ledger', 'expected'];

/** Row 42c: roles whose files the preflight reads only as bytes for hashing. */
export const LABEL_ROLES: readonly CaseFileRole[] = ['labels', 'ledger', 'expected'];

export function isLabelRole(role: CaseFileRole): boolean {
  return LABEL_ROLES.includes(role);
}

/** Opaque case-file path: `<caseDir>/<file>.cfg|json`, lowercase alphanumerics only. */
export const OPAQUE_CASE_FILE_PATH_RE = /^[a-z0-9]+\/[a-z0-9]+\.(?:cfg|json)$/;
/** Non-case vault file (e.g. `PROVENANCE.md`, `README.md`): no directories, no `..`. */
export const VAULT_FILE_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*\.md$/;
export const GENERATOR_COMMIT_RE = /^[0-9a-f]{7,40}$/;

export interface VaultFile {
  path: string;
  role: VaultFileRole;
  sha256: string;
}

export interface ManifestCaseFile {
  path: string;
  role: CaseFileRole;
  sha256: string;
}

export interface ManifestCase {
  caseId: string;
  split: Split;
  family: Family;
  deviceCount: number;
  stratum: Stratum;
  /** Generated dev cases only. */
  seed?: number;
  /** Generated dev cases only. */
  generatorCommit?: string;
  files: ManifestCaseFile[];
}

export interface Manifest {
  schema: typeof MANIFEST_SCHEMA_ID;
  vaultFiles: VaultFile[];
  cases: ManifestCase[];
}

export function parseManifest(value: unknown): Validated<Manifest> {
  const c = new ShapeChecker();
  const root = c.object(value, '$', ['schema', 'vaultFiles', 'cases']);
  if (root === null) return c.result<Manifest>(value);
  c.constant(root.schema, '$.schema', MANIFEST_SCHEMA_ID);
  const paths = new Set<string>();
  (c.array(root.vaultFiles, '$.vaultFiles') ?? []).forEach((item, i) => {
    const p = `$.vaultFiles[${i}]`;
    const o = c.object(item, p, ['path', 'role', 'sha256']);
    if (o === null) return;
    const path = c.string(o.path, `${p}.path`, VAULT_FILE_PATH_RE, 128);
    if (path === 'MANIFEST.json') c.fail(`${p}.path`, 'MANIFEST.json does not list itself');
    c.unique(path, paths, `${p}.path`);
    c.enumValue(o.role, `${p}.role`, VAULT_FILE_ROLES);
    c.string(o.sha256, `${p}.sha256`, SHA256_PATTERN);
  });
  const caseIds = new Set<string>();
  (c.array(root.cases, '$.cases') ?? []).forEach((item, i) => {
    const p = `$.cases[${i}]`;
    const o = c.object(
      item,
      p,
      ['caseId', 'split', 'family', 'deviceCount', 'stratum', 'files'],
      ['seed', 'generatorCommit'],
    );
    if (o === null) return;
    c.unique(c.string(o.caseId, `${p}.caseId`, ID_PATTERN), caseIds, `${p}.caseId`);
    const split = c.enumValue(o.split, `${p}.split`, SPLITS);
    c.enumValue(o.family, `${p}.family`, FAMILIES);
    const deviceCount = c.integer(o.deviceCount, `${p}.deviceCount`, MIN_DEVICES_PER_CASE, MAX_DEVICES_PER_CASE);
    const stratum = c.enumValue(o.stratum, `${p}.stratum`, STRATA);
    if ('seed' in o) c.integer(o.seed, `${p}.seed`, 0, Number.MAX_SAFE_INTEGER);
    if ('generatorCommit' in o) c.string(o.generatorCommit, `${p}.generatorCommit`, GENERATOR_COMMIT_RE);
    const roleCounts = new Map<CaseFileRole, number>();
    (c.array(o.files, `${p}.files`, 1) ?? []).forEach((f, j) => {
      const q = `${p}.files[${j}]`;
      const fo = c.object(f, q, ['path', 'role', 'sha256']);
      if (fo === null) return;
      c.unique(c.string(fo.path, `${q}.path`, OPAQUE_CASE_FILE_PATH_RE, 128), paths, `${q}.path`);
      const role = c.enumValue(fo.role, `${q}.role`, CASE_FILE_ROLES);
      if (role !== null) roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
      c.string(fo.sha256, `${q}.sha256`, SHA256_PATTERN);
    });
    const count = (role: CaseFileRole): number => roleCounts.get(role) ?? 0;
    if (deviceCount !== null && count('config') !== deviceCount) c.fail(`${p}.files`, 'config file count != deviceCount');
    for (const role of ['case', 'labels', 'ledger'] as const) {
      if (count(role) !== 1) c.fail(`${p}.files`, `exactly one ${role} file required`);
    }
    // Row 38/43: expected.json exists exactly for semantic-positive practice and held-out cases.
    const needsExpected = stratum === 'semantic-positive' && (split === 'practice' || split === 'heldout');
    if (split !== null && stratum !== null && count('expected') !== (needsExpected ? 1 : 0)) {
      c.fail(`${p}.files`, needsExpected ? 'expected file required' : 'expected file not allowed for this case');
    }
  });
  return c.result<Manifest>(value);
}
