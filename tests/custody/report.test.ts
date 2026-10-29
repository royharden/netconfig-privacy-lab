import { afterEach, expect, it, vi } from 'vitest';
import type { Outcome } from '../../src/strategies/types';
import { emptyReport, renderReport } from '../../src/eval/results';
import type { CaseResult } from '../../src/eval/results';
import { evaluateSafely, observedFailures, summariseOutcome } from '../../src/eval/runner';
import type { RunnerCase } from '../../src/eval/runner';
import { aggregateExport } from '../../src/ui/download';

const SENTINEL = 'CUSTODY_RUNNER_SENTINEL_b73f1d';
afterEach(() => { vi.restoreAllMocks(); });

function fixture(): RunnerCase {
  const input = { caseId: 'custody-unit', files: Array.from({ length: 3 }, (_, i) => ({
    fileId: `f${i}`, name: `${SENTINEL}-${i}.cfg`, text: `hostname node${i}\n! ${SENTINEL}\nend\n`,
  })) };
  return Object.assign({ input, arm: 'identity' as const,
    sidecar: { schema: 'case-v1' as const, caseId: input.caseId, family: 'ring' as const, stratum: 'semantic-positive' as const,
      files: input.files.map((f, i) => ({ fileId: f.fileId, path: `n${i}.cfg`, name: f.name, nodeId: `n${i}` })),
      nodes: input.files.map((f, i) => ({ id: `n${i}`, fileId: f.fileId })), interfaces: [], acls: [], aclEntries: [],
      flows: Array.from({ length: 32 }, (_, i) => ({ id: `q${i}`, ingressNodeId: 'n0', ingressInterfaceId: 'i0',
        src: '10.0.0.1', dst: '10.0.0.1', protocol: 'tcp' as const, srcPort: 1000, dstPort: 80 })),
    },
    ledger: { schema: 'ledger-v1' as const, caseId: input.caseId, entities: [] },
    labels: { schema: 'labels-v1' as const, caseId: input.caseId, benignSpans: [], freeTextTokens: [] },
  }, { key: { privateMaterial: SENTINEL }, privateMap: new Map([[SENTINEL, SENTINEL]]), raw: SENTINEL });
}
function outcome(context: RunnerCase): Outcome {
  return Object.assign({ ...context.input, arm: context.arm, status: 'ok' as const,
    diagnostics: [{ code: SENTINEL, fileId: SENTINEL, ordinal: 1 }],
  }, { privateMap: new Map([[SENTINEL, SENTINEL]]), key: SENTINEL });
}
function captureConsole(): unknown[] {
  const consoleWrites: unknown[] = [];
  for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => { consoleWrites.push(args); });
  }
  return consoleWrites;
}

it('projects actual successful runner output and public diagnostics into JSON, Markdown and download sinks', async () => {
  const consoleWrites = captureConsole(), context = fixture(), produced = outcome(context);
  const row = await evaluateSafely(context, () => produced);
  // Also exercise the exact pure summary used by evaluateSafely, rather than injecting an unrelated report field.
  expect(row).toEqual(summariseOutcome(context, produced));
  const failures = observedFailures(context, produced, row);
  expect(failures).toContainEqual({ rule: 'strategy-diagnostic', item: 'position-1' });
  const report = emptyReport('pending'); report.rows = [row];
  report.failures = failures.map((f, i) => ({ failureId: `f${i + 1}`, caseId: context.input.caseId, arm: context.arm,
    classOrFlowOrFindingId: f.item, rule: f.rule, evidenceRef: 'unit-runner', status: 'observed' }));
  const reportSinks = [JSON.stringify(row), JSON.stringify(report), JSON.stringify(report.failures), renderReport(report), JSON.stringify(aggregateExport(report))];
  expect(consoleWrites).toEqual([]);
  for (const sink of reportSinks) expect(sink).not.toContain(SENTINEL);
  for (const field of ['files', 'name', 'key', 'privateMap', 'raw', 'diagnostics']) expect(row).not.toHaveProperty(field);
  expect(row.correspondence).toEqual({ conflicts: 0, manyToOne: 0, missing: 0 });
});

for (const stage of ['strategy', 'oracle/probe'] as const) {
  it(`catches a secret-bearing ${stage} exception in the actual wrapper without emitting it to error, console or report sinks`, async () => {
    const consoleWrites = captureConsole(), errorSink: unknown[] = [], context = fixture();
    const privateState = { key: SENTINEL, map: new Map([[SENTINEL, SENTINEL]]), config: context.input.files[0]!.text,
      filename: context.input.files[0]!.name };
    const fail = (): never => { throw Object.assign(new Error(`${SENTINEL}: ${privateState.filename}`), privateState); };
    let row: CaseResult | undefined;
    try {
      row = await evaluateSafely(context, () => stage === 'strategy' ? fail() : outcome(context),
        () => stage === 'oracle/probe' ? fail() : {});
    } catch (error) { errorSink.push(error); }
    expect(errorSink).toEqual([]); expect(consoleWrites).toEqual([]); expect(row).toBeDefined();
    if (!row) throw new Error('runner-did-not-return-a-row');
    expect(row).toMatchObject({ status: 'not_run', reason: 'strategy-error', utility: {
      scheduled: { numerator: 0, denominator: 32 }, evaluable: { numerator: 0, denominator: 0, value: null },
      coverage: { numerator: 0, denominator: 32 },
    } });
    const report = emptyReport('pending'); report.rows = [row];
    const sinks = [JSON.stringify(row), JSON.stringify(report), renderReport(report), JSON.stringify(aggregateExport(report)),
      JSON.stringify(consoleWrites), JSON.stringify(errorSink)];
    for (const sink of sinks) expect(sink).not.toContain(SENTINEL);
    for (const field of ['files', 'key', 'map', 'config', 'filename', 'message', 'stack']) expect(row).not.toHaveProperty(field);
  });
}
