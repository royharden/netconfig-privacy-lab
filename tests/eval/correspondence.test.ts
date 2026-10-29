import { expect, it } from 'vitest';
import { deriveCorrespondence } from '../../src/eval/correspondence';
import { naiveMask } from '../../src/strategies/naiveMask';
import { deriveStrategyCtx } from '../../src/strategies/keys';
import type { CaseSidecar } from '../../src/core/sidecar';
import type { CaseInput, Outcome } from '../../src/strategies/types';

const input: CaseInput = { caseId: 'unit', files: Array.from({ length: 3 }, (_, i) => ({ fileId: `f${i}`, name: `n${i}.cfg`, text: `hostname edge${i}\ninterface GigabitEthernet0/0\n ip address 10.0.${i}.1 255.255.255.0\n!\nip access-list extended ACL${i}\n permit ip any any\nend\n` })) };
const sidecar: CaseSidecar = { schema: 'case-v1', caseId: 'unit', family: 'ring', stratum: 'semantic-positive',
  files: input.files.map((f, i) => ({ fileId: f.fileId, path: f.name, name: f.name, nodeId: `n${i}` })),
  nodes: input.files.map((f, i) => ({ id: `n${i}`, fileId: f.fileId })),
  interfaces: input.files.map((_, i) => ({ id: `i${i}`, nodeId: `n${i}`, ordinal: 1 })),
  acls: input.files.map((_, i) => ({ id: `a${i}`, nodeId: `n${i}`, aclName: `ACL${i}` })),
  aclEntries: input.files.map((_, i) => ({ id: `e${i}`, nodeId: `n${i}`, aclId: `a${i}`, aclName: `ACL${i}`, ordinal: 1 })), flows: [] };
const identity = (): Outcome => ({ caseId: 'unit', arm: 'identity', status: 'ok', files: input.files.map((f) => ({ ...f })), diagnostics: [] });
it('uses stable file IDs and structural ordinals despite renamed interfaces and filenames', () => {
  const out = identity();
  out.files.reverse();
  out.files.forEach((f) => { f.name = 'different.cfg'; f.text = f.text.replace('GigabitEthernet0/0', 'GigabitEthernet1/7'); });
  const result = deriveCorrespondence(input, out, sidecar);
  expect(result.healthy).toBe(true);
  expect(result.interfaces.get('i0')).toBe('GigabitEthernet1/7');
  expect(result.aclEntries.get('e0')).toBe(1);
});
it('reports naive many-to-one collapse without repairing it', async () => {
  const outcome = await naiveMask.apply(input, await deriveStrategyCtx(new Uint8Array(32)));
  const result = deriveCorrespondence(input, outcome, sidecar);
  expect(result.healthy).toBe(false);
  expect(result.issues.some((i) => i.kind === 'many-to-one' && i.scope === 'node')).toBe(true);
  expect(result.nodes.get('n0')).toBe('MASKED');
  expect(result.nodes.get('n1')).toBe('MASKED');
});
it('reports repeated original address mapping conflicts and missing structures', () => {
  const repeated = { ...input, files: input.files.map((f) => ({ ...f, text: f.text.replace(/10\.0\.\d\.1/, '10.0.0.1') })) };
  const out = identity();
  const result = deriveCorrespondence(repeated, out, sidecar);
  expect(result.issues.some((i) => i.kind === 'conflict' && i.scope === 'address')).toBe(true);
  out.files.pop();
  expect(deriveCorrespondence(input, out, sidecar).issues.some((i) => i.kind === 'missing')).toBe(true);
});
