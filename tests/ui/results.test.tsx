import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { emptyReport } from '../../src/eval/results';
import type { Report } from '../../src/eval/results';
import type { Count, LeakClassScore } from '../../src/eval/leakscore';
import { VARIANTS } from '../../src/core/ledger';
import { ResultsPanel, recordingEvidence } from '../../src/ui/components/ResultsPanel';

const count = (numerator: number, denominator: number): Count => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
function availableReport(): Report {
  const report = emptyReport('pending');
  for (const key of ['A', 'B', 'C', 'D', 'E', 'F'] as const) report.tables[key] = { status: 'available', reason: null };
  report.rows = [{
    caseId: 'ui-fixture', arm: 'netconan-minimal', status: 'evaluated',
    evidence: { kind: 'recorded', tool: 'netconan', toolVersion: '1.0.0', sourceSha256: 'a'.repeat(64) },
    leaks: [{ class: 'hostname', entities: count(3, 7), occurrences: count(4, 9), anyLocation: count(3, 7), ambiguousNumeric: count(0, 0), variants: Object.fromEntries(VARIANTS.map(v => [v, count(2, 5)])) as LeakClassScore['variants'] }],
    utility: { scheduled: count(6, 8), evaluable: count(6, 7), coverage: count(7, 8), parseClean: true, findings: { preserved: 3, lost: 2, introduced: 1 }, addressPairs: count(8, 9), subnetRelations: count(9, 10), referenceIntegrity: count(10, 11) },
    correspondence: { conflicts: 1, manyToOne: 2, missing: 3 },
    retention: { overRedaction: count(2, 13), freeTextRetention: count(11, 14), finalOctetRetention: count(4, 15) },
    probes: { prefix: [{ k: 1, meanBits: 17, full24: count(5, 16) }], fingerprint: { candidateSetSize: 50, unique: false, reciprocalRank: 0.25 }, reason: null },
    oracle: { flows: count(4, 5), findings: { preserved: 5, lost: 1, introduced: 2 } },
    batfish: { status: 'available', reason: null, scheduled: count(7, 19), evaluable: count(7, 17), coverage: count(17, 19), evaluatorAgreement: count(16, 19), authorAgreement: count(18, 19) },
  }];
  report.intervals = [{ arm: 'netconan-minimal', reference: 'naive-mask', metric: 'scheduled', interval: { low: -0.2, high: 0.3, resamples: 2000, seed: 43 } }];
  report.failures = [{ failureId: 'f0001', caseId: 'ui-fixture', arm: 'netconan-minimal', classOrFlowOrFindingId: 'flow-1', rule: 'flow-mismatch', evidenceRef: 'result:f0001', status: 'observed' }];
  return report;
}

it('renders report-provided A–F metrics instead of availability-only cards', () => {
  // Regression: M6 displayed only table statuses and utility flow rates, hiding supplied metrics.
  const html = renderToStaticMarkup(<ResultsPanel reports={[availableReport()]} />);
  for (const value of ['hostname', '3/7', '4/9', '2/5', '6/8', '8/9', '9/10', '10/11', '2/13', '11/14', '4/15', '5/16', '0.25', '4/5', '7/19', '7/17', '17/19', '16/19', '18/19', '-0.2', '0.3', '2000', 'f0001', 'flow-mismatch', 'result:f0001']) expect(html).toContain(value);
  expect(html).toContain('Findings preserved / lost / introduced');
  expect(html).toContain('Author flow agreement');
  expect(html).toContain('N/A');
});

it('projects source metadata and leaves missing Batfish metadata not_run independently of comparison metrics', () => {
  // Regression: loaded validated recording metadata had no display path; source must never become oracle PASS.
  const report = availableReport();
  Object.assign(report.rows[0]!.evidence!, { config: 'RAW_CONFIG_SENTINEL', filename: 'RAW_FILENAME_SENTINEL', key: 'RAW_KEY_SENTINEL', map: 'RAW_MAP_SENTINEL' });
  const projected = recordingEvidence(report);
  expect(projected[0]).toEqual({ status: 'recorded', tool: 'netconan', toolVersion: '1.0.0', pin: 'a'.repeat(64), reason: null });
  expect(projected[1]).toMatchObject({ status: 'not_run', tool: 'batfish' });
  expect(JSON.stringify(projected)).not.toContain('SENTINEL');
  const html = renderToStaticMarkup(<ResultsPanel reports={[report]} />);
  expect(html).toContain('version 1.0.0');
  expect(html).toContain('arm source');
  expect(html).toContain('independent oracle');
  expect(html).toContain('Batfish / evaluator agreement');
  expect(html).not.toContain('SENTINEL');
  expect(html).not.toContain('PASS');
});

it('shows missing results as not_run and zero support as N/A', () => {
  const report = emptyReport('pending');
  const html = renderToStaticMarkup(<ResultsPanel reports={[report]} />);
  expect(html).toContain('not_run');
  expect(html).not.toContain('No named failures in this report.');
  expect(recordingEvidence(report).every(e => e.status === 'not_run')).toBe(true);
});

it('keeps unavailable Batfish comparisons not_run even when placeholder counts exist', () => {
  const report = availableReport();
  report.rows[0]!.batfish!.status = 'not_run';
  report.rows[0]!.batfish!.reason = 'native-trace-shape-or-correspondence-unavailable';
  const html = renderToStaticMarkup(<ResultsPanel reports={[report]} />);
  expect(html).not.toContain('7/19');
  expect(html).not.toContain('16/19');
  expect(html).toContain('native-trace-shape-or-correspondence-unavailable');
});

it('does not project malformed provenance or render invalid numeric count strings', () => {
  const report = availableReport();
  report.rows[0]!.evidence!.sourceSha256 = 'RAW_SOURCE_SENTINEL';
  report.rows[0]!.retention!.overRedaction = { numerator: 'RAW_COUNT_SENTINEL', denominator: 1, value: 0 } as unknown as Count;
  expect(recordingEvidence(report).every(e => e.status === 'not_run')).toBe(true);
  expect(renderToStaticMarkup(<ResultsPanel reports={[report]} />)).not.toContain('SENTINEL');
});
