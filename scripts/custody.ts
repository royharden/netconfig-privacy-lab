import { readFile, readdir, realpath, lstat } from 'node:fs/promises';
import { resolve, relative, sep, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { parseManifest, isLabelRole } from '../src/core/manifest';
import { parseSidecar } from '../src/core/sidecar';
import { parseConfig } from '../src/core/parser';
import type { Manifest, ManifestCase } from '../src/core/manifest';
import type { CaseSidecar } from '../src/core/sidecar';

export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export async function safePath(root: string, path: string): Promise<string> {
  // Portable canonical relative paths only: also block Windows aliases/streams on POSIX hosts.
  const parts = path.split('/');
  if (isAbsolute(path) || /[\\:\x00-\x1f]/.test(path) || parts.some(part => !part || part === '.' || part === '..' ||
    /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('path-outside-root');
  const base = await realpath(root), full = resolve(base, ...parts), rel = relative(base, full);
  if ((await lstat(root)).isSymbolicLink() || base !== resolve(root)) throw new Error('linked-vault-root');
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('path-outside-root');
  // Reject links at every component, including directories, before reading vault bytes.
  let cursor = base;
  for (const part of relative(base, full).split(sep)) { cursor = resolve(cursor, part); if ((await lstat(cursor)).isSymbolicLink()) throw new Error('linked-vault-path'); }
  const actual = await realpath(full);
  if (actual !== full) throw new Error('vault-path-alias');
  return full;
}
export interface ReceiptFile { caseId: string | null; role: string; sha256: string }
export interface PreflightReceipt { schema: 'preflight-v1'; manifestSha256: string; files: ReceiptFile[]; status: 'pass' }

/** Structure and role joins only: this must never open expected, ledger or labels JSON. */
function verifyCaseJoin(entry: ManifestCase, sidecar: CaseSidecar): void {
  const caseFile = entry.files.find(file => file.role === 'case')!;
  const dir = caseFile.path.split('/')[0]!;
  const configPaths = new Set(entry.files.filter(file => file.role === 'config').map(file => file.path));
  if (entry.files.some(file => file.path.split('/')[0] !== dir) ||
    sidecar.files.some(file => !configPaths.delete(`${dir}/${file.path}`)) || configPaths.size !== 0) throw new Error('case-config-join-mismatch');
}
/** Labels are read only as byte buffers for hashing. Never JSON.parse a label in this path. */
export async function verifyVault(root: string, pinnedHash: string, preflight: boolean): Promise<{ manifest: Manifest; receipt: PreflightReceipt }> {
  const manifestBytes = await readFile(await safePath(root, 'MANIFEST.json'));
  if (sha256(manifestBytes) !== pinnedHash.trim()) throw new Error('vault-manifest-mismatch');
  const checked = parseManifest(JSON.parse(manifestBytes.toString('utf8')));
  if (!checked.ok) throw new Error('invalid-vault-manifest');
  const manifest = checked.value;
  // A vault has one directory per case. Role identity cannot be smuggled across cases.
  const caseDirs = new Set<string>();
  for (const entry of manifest.cases) {
    const dir = entry.files.find(file => file.role === 'case')!.path.split('/')[0]!;
    if (caseDirs.has(dir) || entry.files.some(file => file.path.split('/')[0] !== dir)) throw new Error('vault-case-directory-mismatch');
    caseDirs.add(dir);
    for (const file of entry.files) if ((file.role === 'config') !== file.path.endsWith('.cfg')) throw new Error('vault-role-extension-mismatch');
  }
  const listed = new Set(['MANIFEST.json']);
  const files: ReceiptFile[] = [];
  for (const item of [...manifest.vaultFiles.map(f => ({ ...f, caseId: null })), ...manifest.cases.flatMap(c => c.files.map(f => ({ ...f, caseId: c.caseId })))]) {
    listed.add(item.path);
    const bytes = await readFile(await safePath(root, item.path));
    if (sha256(bytes) !== item.sha256) throw new Error('vault-file-mismatch');
    files.push({ caseId: item.caseId, role: item.role, sha256: item.sha256 });
    if (!preflight || isLabelRole(item.role as 'ledger')) continue;
    if (item.role === 'case') {
      const c = parseSidecar(JSON.parse(bytes.toString('utf8')));
      const entry = manifest.cases.find(x => x.caseId === item.caseId);
      if (!c.ok || !entry || c.value.caseId !== entry.caseId || c.value.family !== entry.family || c.value.stratum !== entry.stratum || c.value.files.length !== entry.deviceCount || (c.value.stratum === 'semantic-positive' && c.value.flows.length !== 32)) throw new Error('invalid-case-structure');
      verifyCaseJoin(entry, c.value);
    }
    if (item.role === 'config' && !parseConfig({ fileId: 'preflight', name: 'n.cfg', text: bytes.toString('utf8') }).file) throw new Error('invalid-config-caps');
  }
  const walk = async (dir: string, prefix = ''): Promise<void> => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = prefix + item.name;
      if (item.isSymbolicLink()) throw new Error('linked-vault-path');
      if (item.isDirectory()) await walk(resolve(dir, item.name), `${path}/`);
      else if (!item.isFile() || !listed.has(path)) throw new Error('unlisted-vault-file');
    }
  };
  await walk(root);
  // Stable receipt ordering is independent of manifest listing order.
  files.sort((a, b) => `${a.caseId ?? ''}/${a.role}/${a.sha256}`.localeCompare(`${b.caseId ?? ''}/${b.role}/${b.sha256}`, 'en'));
  return { manifest, receipt: { schema: 'preflight-v1', manifestSha256: pinnedHash.trim(), files, status: 'pass' } };
}
