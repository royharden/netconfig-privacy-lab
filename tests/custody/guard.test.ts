import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { verifyCandidateSource } from '../../scripts/candidate';
import { safePath, sha256, verifyVault } from '../../scripts/custody';

// Source-only regression cases under Dirty Mode: none have been executed.
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function temporary(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 's43-custody-'));
  roots.push(root);
  return root;
}
async function put(root: string, path: string, text: string | Buffer): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
}

/** Build real loose Git objects without git, subprocesses, installs or external data. */
async function candidateFixture(): Promise<{ root: string; commit: string }> {
  const root = await temporary();
  const files: Record<string, string> = {
    'package.json': '{"private":true}', 'package-lock.json': '{"lockfileVersion":3}',
    'tsconfig.json': '{}', 'vite.config.ts': 'export default {};', 'vitest.config.ts': 'export default {};',
    'eslint.config.js': 'export default [];', 'src/eval/evaluator.ts': 'export const disposition = "deny-in";',
    'scripts/eval.ts': 'export const frozen = true;', 'schemas/manifest.schema.json': '{}',
    'config/evaluation.json': '{"mode":"frozen"}',
    // This is newly authored test data, never the project's key fixture.
    'fixtures/eval-key.txt': 'TEST_ONLY_SYNTHETIC_KEY_BYTES',
  };
  const store = async (type: string, bytes: Buffer): Promise<string> => {
    const raw = Buffer.concat([Buffer.from(`${type} ${bytes.length}\0`), bytes]);
    const oid = createHash('sha1').update(raw).digest('hex');
    await put(root, `.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`, deflateSync(raw));
    return oid;
  };
  const tree = async (prefix = ''): Promise<string> => {
    const direct = new Map<string, { directory: boolean; path: string }>();
    for (const path of Object.keys(files).filter(path => path.startsWith(prefix))) {
      const rest = path.slice(prefix.length), slash = rest.indexOf('/');
      const name = slash < 0 ? rest : rest.slice(0, slash);
      direct.set(name, { directory: slash >= 0, path });
    }
    const entries: Buffer[] = [];
    for (const [name, entry] of [...direct].sort(([a, x], [b, y]) => `${a}${x.directory ? '/' : ''}`.localeCompare(`${b}${y.directory ? '/' : ''}`, 'en'))) {
      const oid = entry.directory ? await tree(`${prefix}${name}/`) : await store('blob', Buffer.from(files[entry.path]!));
      entries.push(Buffer.concat([Buffer.from(`${entry.directory ? '40000' : '100644'} ${name}\0`), Buffer.from(oid, 'hex')]));
    }
    return store('tree', Buffer.concat(entries));
  };
  const treeId = await tree();
  const commit = await store('commit', Buffer.from(`tree ${treeId}\nauthor Test <test@example.invalid> 0 +0000\ncommitter Test <test@example.invalid> 0 +0000\n\nsynthetic candidate\n`));
  for (const [path, text] of Object.entries(files)) await put(root, path, text);
  await put(root, '.git/HEAD', 'ref: refs/heads/main\n');
  await put(root, '.git/refs/heads/main', `${commit}\n`);
  await put(root, '.git/refs/tags/candidate', `${commit}\n`);
  return { root, commit };
}

describe('committed candidate bytes', () => {
  it('accepts matching committed objects and working files without reading refs as proof', async () => {
    const { root, commit } = await candidateFixture();
    await expect(verifyCandidateSource(commit, root)).resolves.toBeUndefined();
  });

  it.each(['src/eval/evaluator.ts', 'scripts/eval.ts', 'config/evaluation.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', 'eslint.config.js', 'fixtures/eval-key.txt'])(
    'refuses modified %s despite unchanged HEAD and tag', async path => {
      // what_bug_this_catches: a tagged commit was accepted while executed source/key bytes had changed.
      const { root, commit } = await candidateFixture();
      const head = await readFile(join(root, '.git/HEAD'), 'utf8');
      await put(root, path, 'CHANGED_TEST_BYTES');
      await expect(verifyCandidateSource(commit, root)).rejects.toThrow('candidate-source-mismatch');
      expect(await readFile(join(root, '.git/HEAD'), 'utf8')).toBe(head);
      expect((await readFile(join(root, '.git/refs/tags/candidate'), 'utf8')).trim()).toBe(commit);
    },
  );

  it('refuses untracked executable source and additional compiler configuration', async () => {
    const { root, commit } = await candidateFixture();
    await put(root, 'src/eval/injected.ts', 'export const injected = true;');
    await expect(verifyCandidateSource(commit, root)).rejects.toThrow('untracked-candidate-source');
    await rm(join(root, 'src/eval/injected.ts'));
    await put(root, 'tsconfig.injected.json', '{}');
    await expect(verifyCandidateSource(commit, root)).rejects.toThrow('untracked-candidate-source');
  });

  it('refuses a missing committed source file', async () => {
    const { root, commit } = await candidateFixture();
    await rm(join(root, 'src/eval/evaluator.ts'));
    await expect(verifyCandidateSource(commit, root)).rejects.toThrow();
  });

  it('refuses corrupt objects even when the filename still claims the candidate hash', async () => {
    const { root, commit } = await candidateFixture();
    const bytes = Buffer.from('commit 5\0wrong');
    await put(root, `.git/objects/${commit.slice(0, 2)}/${commit.slice(2)}`, deflateSync(bytes));
    await expect(verifyCandidateSource(commit, root)).rejects.toThrow('candidate-object-hash-mismatch');
  });

  it('fails closed for missing/packed-only objects rather than trusting unchanged refs', async () => {
    const { root, commit } = await candidateFixture();
    await rm(join(root, `.git/objects/${commit.slice(0, 2)}/${commit.slice(2)}`));
    await expect(verifyCandidateSource(commit, root)).rejects.toThrow('unsupported-packed-or-missing-candidate-object');
  });
});

async function vaultFixture(): Promise<{ root: string; pin: string; manifest: Record<string, unknown> }> {
  const root = await temporary();
  const sidecar = {
    schema: 'case-v1', caseId: 'h01', family: 'ring', stratum: 'unsupported',
    files: [1, 2, 3].map(i => ({ fileId: `f${i}`, path: `n${i}.cfg`, name: `n${i}.cfg`, nodeId: `n${i}` })),
    nodes: [1, 2, 3].map(i => ({ id: `n${i}`, fileId: `f${i}` })), interfaces: [], acls: [], aclEntries: [], flows: [],
  };
  const data = [
    ...[1, 2, 3].map(i => ({ path: `h01/n${i}.cfg`, role: 'config', text: `hostname node${i}\nend\n` })),
    { path: 'h01/case.json', role: 'case', text: JSON.stringify(sidecar) },
    // Invalid JSON is deliberate: label-blind preflight must only hash these bytes.
    { path: 'h01/labels.json', role: 'labels', text: 'CUSTODY_LABEL_SENTINEL {not-json' },
    { path: 'h01/ledger.json', role: 'ledger', text: 'CUSTODY_LEDGER_SENTINEL {not-json' },
  ];
  const manifest = {
    schema: 'manifest-v1', vaultFiles: [], cases: [{ caseId: 'h01', split: 'heldout', family: 'ring', deviceCount: 3,
      stratum: 'unsupported', files: data.map(({ path, role, text }) => ({ path, role, sha256: sha256(text) })) }],
  };
  for (const file of data) await put(root, file.path, file.text);
  const text = JSON.stringify(manifest);
  await put(root, 'MANIFEST.json', text);
  return { root, pin: sha256(text), manifest };
}

describe('label-blind vault structure', () => {
  it('hashes malformed label bytes without parsing, exposing or logging their values', async () => {
    // what_bug_this_catches: preflight accidentally opens expected answers or labels while checking structure.
    const { root, pin } = await vaultFixture();
    const parse = vi.spyOn(JSON, 'parse'), log = vi.spyOn(console, 'log'), error = vi.spyOn(console, 'error');
    const { receipt } = await verifyVault(root, pin, true);
    expect(receipt.status).toBe('pass');
    expect(receipt.files).toHaveLength(6);
    expect(JSON.stringify(receipt)).not.toContain('CUSTODY_');
    expect(parse.mock.calls.every(([text]) => !String(text).includes('CUSTODY_'))).toBe(true);
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });

  it('rejects label-byte tampering before emitting a successful receipt', async () => {
    const { root, pin } = await vaultFixture();
    await put(root, 'h01/labels.json', 'CHANGED_LABEL_BYTES');
    await expect(verifyVault(root, pin, true)).rejects.toThrow('vault-file-mismatch');
  });

  it('rejects a sidecar config path that does not join its manifest entry', async () => {
    const { root, manifest } = await vaultFixture();
    const raw = JSON.parse(await readFile(join(root, 'h01/case.json'), 'utf8')) as { files: { path: string }[] };
    raw.files[0]!.path = 'other.cfg';
    const text = JSON.stringify(raw);
    await put(root, 'h01/case.json', text);
    const typed = manifest as unknown as { cases: { files: { role: string; sha256: string }[] }[] };
    typed.cases[0]!.files.find(file => file.role === 'case')!.sha256 = sha256(text);
    const manifestText = JSON.stringify(manifest);
    await put(root, 'MANIFEST.json', manifestText);
    await expect(verifyVault(root, sha256(manifestText), true)).rejects.toThrow('case-config-join-mismatch');
  });

  it('rejects complete-manifest omissions, including extra unlisted label files', async () => {
    const { root, pin } = await vaultFixture();
    await put(root, 'h01/extra.json', 'UNLISTED_LABEL');
    await expect(verifyVault(root, pin, true)).rejects.toThrow('unlisted-vault-file');
  });

  it.each(['../outside.json', '/absolute.json', 'h01/../case.json', 'h01\\case.json', 'h01/case.json:stream', 'h01//case.json', 'h01/NUL.json', 'h01/case.json.'])(
    'refuses portable path traversal or alias %s before reading bytes', async path => {
      const { root } = await vaultFixture();
      await expect(safePath(root, path)).rejects.toThrow('path-outside-root');
    },
  );
});
