/**
 * The ONLY module exempt from the row 28 network/storage lint ban (eslint.config.js). It loads bundled assets through Vite's
 * static `import.meta.glob` (resolved at build time, no runtime request); it uses no fetch and no storage either.
 *
 * Only the three builder smoke cases are bundled (fixtures/smoke, not held-out, never scored). From each `case.json` it imports
 * ONLY `caseId`, `family` and `files` (fileId, opaque path, display name) through Vite JSON named exports, so flows and other
 * scoring structure are not read by the UI (row 29: the sidecar is for src/eval). Ledgers and labels are not bundled in M1.
 */

const CONFIG_TEXTS = import.meta.glob<string>('../../fixtures/smoke/*/*.cfg', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const CASE_IDS = import.meta.glob<unknown>('../../fixtures/smoke/*/case.json', { import: 'caseId', eager: true });
const CASE_FAMILIES = import.meta.glob<unknown>('../../fixtures/smoke/*/case.json', { import: 'family', eager: true });
const CASE_FILES = import.meta.glob<unknown>('../../fixtures/smoke/*/case.json', { import: 'files', eager: true });

export interface SmokeCaseFile {
  fileId: string;
  /** Display name from case.json (may be a planted file-name trap; shown locally only, never downloaded). */
  name: string;
  text: string;
}

export interface SmokeCase {
  caseId: string;
  family: string;
  files: readonly SmokeCaseFile[];
}

interface FileEntry {
  fileId: string;
  path: string;
  name: string;
}

function isFileEntry(value: unknown): value is FileEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.fileId === 'string' && typeof v.path === 'string' && typeof v.name === 'string';
}

function buildSmokeCases(): SmokeCase[] {
  const out: SmokeCase[] = [];
  for (const key of Object.keys(CASE_FILES).sort()) {
    const dir = key.slice(0, key.length - 'case.json'.length);
    const caseId = CASE_IDS[key];
    const family = CASE_FAMILIES[key];
    const entries = CASE_FILES[key];
    if (typeof caseId !== 'string' || typeof family !== 'string' || !Array.isArray(entries)) continue;
    const files: SmokeCaseFile[] = [];
    let complete = true;
    for (const entry of entries) {
      const text = isFileEntry(entry) ? CONFIG_TEXTS[dir + entry.path] : undefined;
      if (!isFileEntry(entry) || text === undefined) {
        complete = false;
        break;
      }
      files.push({ fileId: entry.fileId, name: entry.name, text });
    }
    if (complete) out.push({ caseId, family, files });
  }
  return out;
}

export const SMOKE_CASES: readonly SmokeCase[] = buildSmokeCases();
