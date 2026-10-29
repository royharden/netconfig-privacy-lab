import { afterEach, expect, it, vi } from 'vitest';
import { deriveStrategyCtx } from '../../src/strategies/keys';
import { labScrub } from '../../src/strategies/lab';
import type { CaseInput } from '../../src/strategies/types';

const SENTINEL = 'CUSTODY_ONLY_SENTINEL_b73f1d';
const input: CaseInput = { caseId: 'unit', files: Array.from({ length: 3 }, (_, i) => ({ fileId: `f${i}`, name: `n${i}.cfg`, text: `hostname node${i}\nend\n` })) };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

function traps() {
  const writes: unknown[] = [];
  const storage = { getItem: vi.fn(() => null), setItem: vi.fn((...args: unknown[]) => { writes.push(args); }), removeItem: vi.fn(), clear: vi.fn() };
  vi.stubGlobal('localStorage', storage); vi.stubGlobal('sessionStorage', storage);
  const open = vi.fn((...args: unknown[]) => { writes.push(args); throw new Error('unexpected-storage'); });
  vi.stubGlobal('indexedDB', { open });
  for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) vi.spyOn(console, method).mockImplementation((...args) => { writes.push(args); });
  return { writes, storage, open };
}

it('keeps context keys, maps and private sentinel out of Outcomes, captured console and storage', async () => {
  const { writes, storage, open } = traps();
  const ctx = await deriveStrategyCtx(new Uint8Array(32), [SENTINEL]);
  const outcome = await labScrub.apply(input, ctx);
  expect(Object.keys(outcome).sort()).toEqual(['arm', 'caseId', 'diagnostics', 'files', 'status']);
  expect(JSON.stringify(outcome)).not.toContain(SENTINEL);
  expect(JSON.stringify(writes)).not.toContain(SENTINEL);
  expect(storage.setItem).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  expect(writes).toEqual([]);
});

it('sanitizes thrown secret-bearing exceptions instead of exposing their messages', async () => {
  const { writes } = traps();
  const ctx = await deriveStrategyCtx(new Uint8Array(32));
  vi.spyOn(crypto.subtle, 'sign').mockRejectedValue(new Error(SENTINEL));
  const outcome = await labScrub.apply(input, ctx);
  expect(outcome.status).toBe('error');
  expect(JSON.stringify(outcome)).not.toContain(SENTINEL);
  expect(outcome.files).toEqual([]); expect(writes).toEqual([]);
});

it('posts only an allow-listed Outcome and fixed worker error codes across the worker boundary', async () => {
  const { writes, storage, open } = traps();
  const posted: unknown[] = [];
  let resolvePosted: (() => void) | undefined;
  const scope: { onmessage: ((e: MessageEvent<unknown>) => void) | null; postMessage: (v: unknown) => void } = {
    onmessage: null, postMessage: (v) => { posted.push(v); resolvePosted?.(); },
  };
  vi.stubGlobal('self', scope);
  await import('../../src/ui/worker');
  const wait = new Promise<void>((resolve) => { resolvePosted = resolve; });
  scope.onmessage?.({ data: { requestId: 1, arm: 'identity', input, privateMap: SENTINEL } } as MessageEvent<unknown>);
  await wait;
  expect(JSON.stringify(posted)).not.toContain(SENTINEL);
  const message = posted[0] as { outcome: Record<string, unknown> };
  expect(Object.keys(message.outcome).sort()).toEqual(['arm', 'caseId', 'diagnostics', 'files', 'status']);
  scope.onmessage?.({ data: { requestId: 2, arm: SENTINEL } } as MessageEvent<unknown>);
  expect(posted[1]).toEqual({ requestId: -1, kind: 'error', code: 'bad-request' });
  expect(storage.setItem).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(writes).toEqual([]);
});
