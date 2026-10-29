/**
 * Strategy worker (PLAN.md §3 "cancellable worker, 5 s deadline, timeout = error"; row 28 custody boundary).
 *
 * - The UI (App.tsx) starts one worker per run and hard-terminates it at PARSE_DEADLINE_MS or on Cancel; a terminated run is an
 *   error, never a partial result. This worker additionally refuses to report an outcome that finished after the deadline.
 * - Keys exist only inside this worker. In M1 the session context is drawn fresh from WebCrypto per worker and never persisted
 *   or posted; M3 replaces `freshSessionCtx` with HKDF derivation from a fresh random master (row 29; row 44 wiring edit).
 *   identity and naive-mask ignore the keys.
 * - Only an allow-listed copy of the Outcome crosses the message boundary (no map, key or extra field); error replies carry a
 *   fixed code, never an exception message or config text.
 */
import { PARSE_DEADLINE_MS } from '../core/limits';
import { getStrategy, LOCAL_ARMS } from '../strategies/index';
import { freshStrategyCtx } from '../strategies/keys';
import { extractOperatorList } from '../core/operatorList';
import type { CaseInput, Outcome, StrategyCtx } from '../strategies/types';

export type UiArm = typeof LOCAL_ARMS[number];
export const UI_ARMS: readonly UiArm[] = LOCAL_ARMS;

export interface WorkerRequest {
  requestId: number;
  arm: UiArm;
  input: CaseInput;
}

export type WorkerErrorCode = 'timeout' | 'strategy-error' | 'bad-request';

export type WorkerResponse =
  | { requestId: number; kind: 'outcome'; outcome: Outcome }
  | { requestId: number; kind: 'error'; code: WorkerErrorCode };


/** The subset of DedicatedWorkerGlobalScope used here (the DOM lib types `self` as Window). */
interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: WorkerResponse): void;
}

const scope = self as unknown as WorkerScope;

let ctxPromise: Promise<StrategyCtx> | null = null;
let key2Promise: Promise<StrategyCtx> | null = null;

async function freshSessionCtx(): Promise<StrategyCtx> {
  return freshStrategyCtx();
}

function sessionCtx(): Promise<StrategyCtx> {
  ctxPromise ??= freshSessionCtx();
  return ctxPromise;
}

function isRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.requestId !== 'number' || typeof v.arm !== 'string' || !UI_ARMS.includes(v.arm as UiArm)) return false;
  const input = v.input as Record<string, unknown> | null;
  if (typeof input !== 'object' || input === null || typeof input.caseId !== 'string' || !Array.isArray(input.files)) {
    return false;
  }
  return input.files.every((f: unknown) => {
    if (typeof f !== 'object' || f === null) return false;
    const r = f as Record<string, unknown>;
    return typeof r.fileId === 'string' && typeof r.name === 'string' && typeof r.text === 'string';
  });
}

/** Allow-listed copy: exactly the Outcome fields, nothing a strategy might have attached. */
function boundaryCopy(o: Outcome): Outcome {
  return {
    caseId: o.caseId,
    arm: o.arm,
    status: o.status,
    files: o.files.map((f) => ({ fileId: f.fileId, name: f.name, text: f.text })),
    diagnostics: o.diagnostics.map((d) => ({ code: d.code, fileId: d.fileId, ordinal: d.ordinal })),
  };
}

async function handle(request: WorkerRequest): Promise<void> {
  const startedAt = performance.now();
  try {
    const base = request.arm === 'lab-scrub@key2' ? await (key2Promise ??= freshSessionCtx()) : await sessionCtx();
    const ctx = { ...base, operatorList: extractOperatorList(request.input) };
    const strategy = getStrategy(request.arm);
    if (!strategy) throw new Error('unknown-arm');
    const outcome = await strategy.apply(request.input, ctx);
    if (performance.now() - startedAt > PARSE_DEADLINE_MS) {
      scope.postMessage({ requestId: request.requestId, kind: 'error', code: 'timeout' });
      return;
    }
    scope.postMessage({ requestId: request.requestId, kind: 'outcome', outcome: boundaryCopy(outcome) });
  } catch {
    scope.postMessage({ requestId: request.requestId, kind: 'error', code: 'strategy-error' });
  }
}

scope.onmessage = (event: MessageEvent<unknown>): void => {
  const data = event.data;
  if (!isRequest(data)) {
    scope.postMessage({ requestId: -1, kind: 'error', code: 'bad-request' });
    return;
  }
  void handle(data);
};
