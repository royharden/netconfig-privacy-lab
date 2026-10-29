/** A runner-built safe projection. Raw bundles/configs/paths/keys never cross into this component. */
export interface EvidenceSummary {
  status: 'recorded' | 'not_run';
  tool: 'netconan' | 'batfish';
  toolVersion: string | null;
  pin: string | null;
  reason: string | null;
}
export function EvidencePanel({ evidence = [] }: { evidence?: readonly EvidenceSummary[] }) {
  return <section aria-label="Recording source and independent oracle evidence">
    <h2>Recording metadata</h2>
    <p>The deterministic evaluator is builder-written. A netconan recording supplies an arm source. Independent Batfish oracle evidence requires its own validated recording and comparison.</p>
    {evidence.length === 0 ? <p><strong>not_run</strong> — no validated recordings. Tool admission and recorder approval are pending.</p> :
      <ul>{evidence.map((row, i) => <li key={`${row.tool}-${i}`}>
        <strong>{row.status}</strong> · {row.tool} · {row.tool === 'netconan' ? 'arm source' : 'independent oracle'}
        {row.status === 'recorded' ? <> · version {row.toolVersion ?? 'unavailable'} · pin {row.pin ?? 'unavailable'}</> : <> · {row.reason ?? 'missing-recording'}</>}
      </li>)}</ul>}
  </section>;
}
