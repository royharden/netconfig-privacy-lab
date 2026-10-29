import { useState } from 'react';
import type { ReactNode } from 'react';
import type { CaseResult, Report } from '../../eval/results';
import type { Count } from '../../eval/leakscore';
import { emptyReport } from '../../eval/results';
import { VARIANTS } from '../../core/ledger';
import { downloadAggregate } from '../download';
import { EvidencePanel } from './EvidencePanel';
import type { EvidenceSummary } from './EvidencePanel';

const bundled = import.meta.glob<Report>('../../../results/{dev,practice,heldout}.json', { eager: true, import: 'default' });
const bundledReports = Object.values(bundled).filter(r => r.schema === 'results-v1' && Array.isArray(r.rows));
const pending = emptyReport('G0/G1/G2 and runtime validation pending');

function numeric(value: number | null | undefined): string {
  return value === null ? 'N/A' : typeof value === 'number' && Number.isFinite(value) ? String(value) : 'not_run';
}
function ratio(value?: Count): string {
  if (!value) return 'not_run';
  const { numerator, denominator } = value;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || denominator < 0 || numerator > denominator) return 'not_run';
  return denominator === 0 ? 'N/A' : `${numerator}/${denominator}`;
}
function findings(value?: { preserved: number; lost: number; introduced: number }): string {
  return value ? `${numeric(value.preserved)} / ${numeric(value.lost)} / ${numeric(value.introduced)}` : 'not_run';
}
function batfishRatio(row: CaseResult, metric: 'scheduled' | 'evaluable' | 'coverage' | 'evaluatorAgreement' | 'authorAgreement'): string {
  return row.batfish?.status === 'available' ? ratio(row.batfish[metric]) : 'not_run';
}
function admittedSource(row: CaseResult): boolean {
  const source = row.evidence;
  return row.status === 'evaluated' && source?.kind === 'recorded' && source.tool === 'netconan'
    && typeof source.toolVersion === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ._+()/-]{0,79}$/.test(source.toolVersion)
    && typeof source.sourceSha256 === 'string' && /^[a-f0-9]{64}$/i.test(source.sourceSha256);
}

/** Copy admitted metadata only; reports, bundles, configurations, keys and maps never reach EvidencePanel. */
export function recordingEvidence(report: Report): EvidenceSummary[] {
  const evidence: EvidenceSummary[] = [];
  for (const row of report.rows) {
    const source = row.evidence;
    if (!source || !admittedSource(row)) continue;
    if (!evidence.some(e => e.toolVersion === source.toolVersion && e.pin === source.sourceSha256)) {
      evidence.push({ status: 'recorded', tool: 'netconan', toolVersion: source.toolVersion, pin: source.sourceSha256, reason: null });
    }
  }
  if (!evidence.length) evidence.push({ status: 'not_run', tool: 'netconan', toolVersion: null, pin: null, reason: 'No admitted arm-source recording in this report.' });
  evidence.push({ status: 'not_run', tool: 'batfish', toolVersion: null, pin: null, reason: 'Recording metadata is not supplied. Available Batfish comparison metrics are shown separately below.' });
  return evidence;
}

function MetricTable({ headers, children }: { headers: readonly string[]; children: ReactNode }) {
  return <div className="table-scroll"><table><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
function TableStatus({ report, table }: { report: Report; table: keyof Report['tables'] }) {
  const status = report.tables?.[table];
  return <p className="muted">{status?.status ?? 'not_run'}{status?.reason ? ` · ${status.reason}` : ''}</p>;
}
const rowLabel = (row: CaseResult): string => `${row.arm} · ${row.caseId}`;

export function ResultsPanel({ reports = bundledReports }: { reports?: readonly Report[] }) {
  const [index, setIndex] = useState(0);
  const [downloadError, setDownloadError] = useState(false);
  const report = reports[index] ?? pending;
  const download = (): void => {
    try { downloadAggregate(report); setDownloadError(false); }
    catch { setDownloadError(true); }
  };
  return <>
    <div className="section-heading"><h2>Evaluation tables</h2><button disabled={!reports.length} onClick={download}>Download aggregate</button></div>
    <p>Evaluations are separate from the local preview. Missing evidence is <strong>not_run</strong>; zero-support metrics are <strong>N/A</strong>. Counts are numerator/denominator.</p>
    <p className="muted">Phase: {report.phase}. Runtime verified: {String(report.runtimeVerified)}.</p>
    {downloadError ? <p role="alert">Aggregate download rejected or unavailable.</p> : null}
    {reports.length ? <label>Frozen report<select value={index} onChange={e => { setIndex(Number(e.target.value)); setDownloadError(false); }}>{reports.map((r, i) => <option key={i} value={i}>{r.phase} {i + 1}</option>)}</select></label> : null}
    <EvidencePanel evidence={recordingEvidence(report)} />
    <h3>Evaluator and source availability</h3>
    <MetricTable headers={['Arm · case', 'Builder evaluator', 'Recorded arm source', 'Independent Batfish oracle']}>
      {report.rows.map((row, i) => <tr key={i}><td>{rowLabel(row)}</td><td>{row.status}{row.reason ? ` · ${row.reason}` : ''}</td><td>{admittedSource(row) ? 'recorded netconan source' : 'not_run'}</td><td>{row.batfish?.status ?? 'not_run'}</td></tr>)}
    </MetricTable>

    <h3>A — Residual identifiers by class and variant</h3><TableStatus report={report} table="A" />
    <MetricTable headers={['Arm · case', 'Class', 'Entities', 'Occurrences', 'Any location', 'Ambiguous numeric', ...VARIANTS]}>
      {report.rows.map((row, i) => row.leaks?.length ? row.leaks.map((leak, j) => <tr key={`${i}-${j}`}><td>{rowLabel(row)}</td><td>{leak.class}</td><td>{ratio(leak.entities)}</td><td>{ratio(leak.occurrences)}</td><td>{ratio(leak.anyLocation)}</td><td>{ratio(leak.ambiguousNumeric)}</td>{VARIANTS.map(v => <td key={v}>{ratio(leak.variants?.[v])}</td>)}</tr>) : <tr key={i}><td>{rowLabel(row)}</td><td colSpan={11}>not_run</td></tr>)}
    </MetricTable>

    <h3>B — Analysis utility</h3><TableStatus report={report} table="B" />
    <MetricTable headers={['Arm · case', 'Scheduled', 'Evaluable', 'Coverage', 'Parse clean', 'Findings preserved / lost / introduced', 'Address pairs', 'Subnet relations', 'Reference integrity', 'Correspondence conflicts / many-to-one / missing', 'Availability reason']}>
      {report.rows.map((row, i) => <tr key={i}><td>{rowLabel(row)}</td><td>{ratio(row.utility?.scheduled)}</td><td>{ratio(row.utility?.evaluable)}</td><td>{ratio(row.utility?.coverage)}</td><td>{row.utility ? String(row.utility.parseClean) : 'not_run'}</td><td>{findings(row.utility?.findings)}</td><td>{ratio(row.utility?.addressPairs)}</td><td>{ratio(row.utility?.subnetRelations)}</td><td>{ratio(row.utility?.referenceIntegrity)}</td><td>{row.correspondence ? `${numeric(row.correspondence.conflicts)} / ${numeric(row.correspondence.manyToOne)} / ${numeric(row.correspondence.missing)}` : 'not_run'}</td><td>{row.utilityReason ?? (row.utility ? 'available' : 'not_run')}</td></tr>)}
    </MetricTable>

    <h3>B — Recorded Batfish utility</h3>
    <MetricTable headers={['Arm · case', 'Comparison status', 'Scheduled', 'Evaluable', 'Coverage', 'Availability reason']}>
      {report.rows.map((row, i) => <tr key={i}><td>{rowLabel(row)}</td><td>{row.batfish?.status ?? 'not_run'}</td><td>{batfishRatio(row, 'scheduled')}</td><td>{batfishRatio(row, 'evaluable')}</td><td>{batfishRatio(row, 'coverage')}</td><td>{row.batfish?.reason ?? (row.batfish?.status === 'available' ? 'available' : 'validated-batfish-recordings-required')}</td></tr>)}
    </MetricTable>

    <h3>C — Retention</h3><TableStatus report={report} table="C" />
    <MetricTable headers={['Arm · case', 'Over-redaction', 'Free-text retention', 'Final-octet retention']}>
      {report.rows.map((row, i) => <tr key={i}><td>{rowLabel(row)}</td><td>{ratio(row.retention?.overRedaction)}</td><td>{ratio(row.retention?.freeTextRetention)}</td><td>{ratio(row.retention?.finalOctetRetention)}</td></tr>)}
    </MetricTable>

    <h3>D — Adversary probes</h3><TableStatus report={report} table="D" />
    <MetricTable headers={['Arm · case', 'Known-address probe: k, mean bits, full /24', 'Fingerprint candidates', 'Unique match', 'Reciprocal rank', 'Availability reason']}>
      {report.rows.map((row, i) => <tr key={i}><td>{rowLabel(row)}</td><td>{row.probes?.prefix.length ? row.probes.prefix.map((p, j) => <div key={j}>k={numeric(p.k)} · {numeric(p.meanBits)} bits · {ratio(p.full24)}</div>) : 'not_run'}</td><td>{numeric(row.probes?.fingerprint?.candidateSetSize)}</td><td>{row.probes?.fingerprint ? String(row.probes.fingerprint.unique) : 'not_run'}</td><td>{numeric(row.probes?.fingerprint?.reciprocalRank)}</td><td>{row.probes?.reason ?? (row.probes ? 'available' : 'not_run')}</td></tr>)}
    </MetricTable>

    <h3>E — Author agreement and independent oracle</h3><TableStatus report={report} table="E" />
    <p className="muted">Author agreement compares the builder evaluator with authored expected answers. Recorded netconan arm sources do not establish independent oracle agreement.</p>
    <MetricTable headers={['Arm · case', 'Author flow agreement', 'Author findings preserved / lost / introduced', 'Independent Batfish status', 'Batfish / evaluator agreement', 'Batfish / author agreement']}>
      {report.rows.map((row, i) => <tr key={i}><td>{rowLabel(row)}</td><td>{ratio(row.oracle?.flows)}</td><td>{findings(row.oracle?.findings)}</td><td>{row.batfish?.status ?? 'not_run'}</td><td>{batfishRatio(row, 'evaluatorAgreement')}</td><td>{batfishRatio(row, 'authorAgreement')}</td></tr>)}
    </MetricTable>

    <h3>Paired 95% intervals</h3>
    <MetricTable headers={['Arm', 'Reference', 'Metric', 'Lower', 'Upper', 'Resamples', 'Seed']}>
      {report.intervals?.length ? report.intervals.map((value, i) => <tr key={i}><td>{value.arm}</td><td>{value.reference}</td><td>{value.metric}</td><td>{numeric(value.interval.low)}</td><td>{numeric(value.interval.high)}</td><td>{numeric(value.interval.resamples)}</td><td>{numeric(value.interval.seed)}</td></tr>) : <tr><td colSpan={7}>not_run</td></tr>}
    </MetricTable>

    <h3>F — Named failures</h3><TableStatus report={report} table="F" />
    <MetricTable headers={['Failure ID', 'Arm · case', 'Class / flow / finding ID', 'Rule', 'Evidence reference', 'Status']}>
      {report.failures.length ? report.failures.map((failure, i) => <tr key={i}><td>{failure.failureId}</td><td>{failure.arm} · {failure.caseId}</td><td>{failure.classOrFlowOrFindingId}</td><td>{failure.rule}</td><td>{failure.evidenceRef}</td><td>{failure.status}</td></tr>) : <tr><td colSpan={6}>{report.tables?.F.status === 'available' ? 'No named failures in this report.' : 'not_run'}</td></tr>}
    </MetricTable>
    <ul>{report.denominatorDefinitions.map((definition, i) => <li key={i}>{definition}</li>)}</ul>
  </>;
}
