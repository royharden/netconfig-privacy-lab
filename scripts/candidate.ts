import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { resolve } from 'node:path';
import { safePath } from './custody';

const OID = /^[0-9a-f]{40}$/;
const SOURCE_DIRS = new Set(['src', 'scripts', 'schemas', 'config']);
const REQUIRED = ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', 'eslint.config.js', 'fixtures/eval-key.txt'];
const gitHash = (bytes: Uint8Array): string => createHash('sha1').update(bytes).digest('hex');

/** Explicit selection: never open environment files, credentials or unrelated fixture/vault bytes. */
function selected(path: string): boolean {
  const first = path.split('/')[0]!;
  return SOURCE_DIRS.has(first) || path === 'fixtures/eval-key.txt' ||
    (!path.includes('/') && (path === 'package.json' || path === 'package-lock.json' ||
      /^(?:tsconfig(?:\.[a-z0-9_.-]+)?\.json|(?:vite|vitest)\.config\.[cm]?[jt]s|eslint\.config\.[cm]?[jt]s|\.eslintrc(?:\.[a-z0-9]+)?)$/i.test(path)));
}

function relevantDirectory(path: string): boolean {
  return SOURCE_DIRS.has(path.split('/')[0]!) || path === 'fixtures';
}

interface GitObject { type: 'commit' | 'tree' | 'blob'; bytes: Buffer }
interface TreeEntry { mode: string; name: string; oid: string }

function treeEntries(bytes: Buffer): TreeEntry[] {
  const result: TreeEntry[] = [], names = new Set<string>();
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset), nul = bytes.indexOf(0, space + 1);
    if (space <= offset || nul <= space + 1 || nul + 21 > bytes.length) throw new Error('invalid-candidate-tree');
    const mode = bytes.subarray(offset, space).toString('ascii');
    const nameBytes = bytes.subarray(space + 1, nul), name = nameBytes.toString('utf8');
    if (!Buffer.from(name, 'utf8').equals(nameBytes) || !name || name === '.' || name === '..' ||
      /[\\/:\x00-\x1f]/.test(name) || /[. ]$/.test(name) || names.has(name.toLowerCase())) throw new Error('unsafe-candidate-tree-path');
    names.add(name.toLowerCase());
    result.push({ mode, name, oid: bytes.subarray(nul + 1, nul + 21).toString('hex') });
    offset = nul + 21;
  }
  return result;
}

/**
 * Verify actual working bytes against the supplied committed candidate, independently of HEAD/index/tag.
 * Only SHA-1 loose objects and a real .git directory are supported. Packed/worktree/alternate object
 * layouts fail closed and require a separately reviewed reader before confirmatory execution.
 * Raw bytes must match: checkout line-ending/filter conversions are not silently normalised.
 */
export async function verifyCandidateSource(commit: string, root = process.cwd()): Promise<void> {
  if (!OID.test(commit)) throw new Error('invalid-candidate-commit');
  const base = await realpath(root);
  if ((await lstat(root)).isSymbolicLink() || base !== resolve(root)) throw new Error('linked-candidate-root');
  const git = await safePath(base, '.git');
  if (!(await lstat(git)).isDirectory()) throw new Error('unsupported-candidate-git-layout');
  const cache = new Map<string, GitObject>();
  const object = async (oid: string, expected: GitObject['type']): Promise<Buffer> => {
    if (!OID.test(oid)) throw new Error('invalid-candidate-object-id');
    let value = cache.get(oid);
    if (!value) {
      let compressed: Buffer;
      try { compressed = await readFile(await safePath(git, `objects/${oid.slice(0, 2)}/${oid.slice(2)}`)); }
      catch { throw new Error('unsupported-packed-or-missing-candidate-object'); }
      const raw = inflateSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
      if (gitHash(raw) !== oid) throw new Error('candidate-object-hash-mismatch');
      const nul = raw.indexOf(0), header = raw.subarray(0, nul).toString('ascii');
      const match = /^(commit|tree|blob) (0|[1-9][0-9]*)$/.exec(header);
      if (nul < 0 || !match || Number(match[2]) !== raw.length - nul - 1) throw new Error('invalid-candidate-object');
      value = { type: match[1] as GitObject['type'], bytes: raw.subarray(nul + 1) };
      cache.set(oid, value);
    }
    if (value.type !== expected) throw new Error('candidate-object-type-mismatch');
    return value.bytes;
  };
  const commitBytes = await object(commit, 'commit');
  const tree = /^tree ([0-9a-f]{40})\n/.exec(commitBytes.toString('utf8'))?.[1];
  if (!tree) throw new Error('invalid-candidate-commit-tree');
  const tracked = new Map<string, string>();
  const visitTree = async (oid: string, prefix = '', depth = 0): Promise<void> => {
    if (depth > 64) throw new Error('candidate-tree-too-deep');
    for (const entry of treeEntries(await object(oid, 'tree'))) {
      const path = prefix + entry.name;
      if (entry.mode === '40000') {
        if (relevantDirectory(path)) await visitTree(entry.oid, `${path}/`, depth + 1);
      } else if (selected(path)) {
        if (path.split('/').some(part => /^\.env(?:\.|$)/i.test(part) || /^(?:\.creds|credentials)$/i.test(part))) throw new Error('forbidden-candidate-source');
        if (!['100644', '100755'].includes(entry.mode)) throw new Error('linked-or-special-candidate-source');
        tracked.set(path, entry.oid);
      }
    }
  };
  await visitTree(tree);
  for (const path of REQUIRED) if (!tracked.has(path)) throw new Error('candidate-required-source-missing');
  for (const dir of ['src', 'scripts', 'schemas']) {
    if (![...tracked.keys()].some(path => path.startsWith(`${dir}/`))) throw new Error('candidate-required-source-missing');
  }
  for (const [path, oid] of tracked) {
    const file = await safePath(base, path);
    if (!(await lstat(file)).isFile()) throw new Error('candidate-source-not-file');
    if (!(await readFile(file)).equals(await object(oid, 'blob'))) throw new Error('candidate-source-mismatch');
  }
  const visitWorking = async (dir: string, prefix = ''): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (!selected(path) && !relevantDirectory(path)) continue;
      if (path.split('/').some(part => /^\.env(?:\.|$)/i.test(part) || /^(?:\.creds|credentials)$/i.test(part))) throw new Error('forbidden-candidate-source');
      if (entry.isSymbolicLink()) throw new Error('linked-candidate-source');
      if (entry.isDirectory()) {
        if (relevantDirectory(path)) await visitWorking(await safePath(base, path), `${path}/`);
        else throw new Error('candidate-source-not-file');
      } else if (selected(path) && (!entry.isFile() || !tracked.has(path))) throw new Error('untracked-candidate-source');
    }
  };
  await visitWorking(base);
}
