import type { CaseInput, Outcome, RecordedArm } from '../strategies/types';
import type { CaseSidecar } from '../core/sidecar';
import type { Ledger } from '../core/ledger';
import type { CaseLabels } from '../core/labels';
import type { ExpectedAnswers } from '../core/expected';
import { inSubnet } from '../core/ipv4';
import { parseCase } from '../core/parser';
import { deriveCorrespondence } from './correspondence';
import { evaluateFlow, sameTrace } from './evaluator';
import { findFindings } from './findings';
import { count, scoreLeaks, scoreRetention } from './leakscore';
import type { Count } from './leakscore';
import { canonicalJson } from './normalise';
import { recordedTraces } from './oracle';
import type { RecordingBundleV1, RecordingExpectation } from './recordings';
import type { CaseResult } from './results';
import { scoreUtility, unavailableUtility } from './utility';

export interface RunnerCase {
  input: CaseInput;
  sidecar: CaseSidecar;
  ledger: Ledger;
  labels: CaseLabels;
  arm: Outcome['arm'];
}
export type OutcomeAttempt = Outcome | { status: 'not_run'; reason: string };
export interface SummaryExtras {
  evidence?: CaseResult['evidence'];
  oracle?: CaseResult['oracle'];
  batfish?: CaseResult['batfish'];
  probes?: Omit<NonNullable<CaseResult['probes']>, 'prefix'> & {
    prefix: (NonNullable<CaseResult['probes']>['prefix'][number] & { valid?: boolean })[];
  };
}

const NOT_RUN_REASONS = new Set([
  'independently-pinned-recording-required', 'missing-recording', 'invalid-recording',
  'oracle-bundle-is-not-an-arm-output', 'recording-preregistration-mismatch', 'strategy-error',
]);
const PROBE_REASONS = new Set(['unhealthy-correspondence', 'prefix-disclosure-model-not-validated', 'pool-not-generated', 'prefix-constraint-mismatch']);
const publicCount = (value: Count): Count => count(value.numerator, value.denominator);

/** The only outcome-to-row boundary. Maps, files, diagnostics and exception objects stay runner-private. */
export function summariseOutcome(context: RunnerCase, attempt: OutcomeAttempt, extras: SummaryExtras = {}): CaseResult {
  const { input, sidecar, ledger, labels, arm } = context;
  const base = { caseId: input.caseId, family: sidecar.family, arm };
  if (attempt.status === 'not_run' || attempt.status === 'error') {
    const reason = attempt.status === 'error' ? 'strategy-error' : NOT_RUN_REASONS.has(attempt.reason) ? attempt.reason : 'strategy-error';
    return { ...base, status: 'not_run', reason,
      ...(sidecar.stratum === 'semantic-positive' ? { utility: unavailableUtility(input, sidecar) } : { utilityReason: 'unsupported-stratum' }) };
  }
  const correspondence = deriveCorrespondence(input, attempt, sidecar);
  const invalidPrefix = extras.probes?.prefix.some(p => p.valid === false) ?? false;
  const probes: CaseResult['probes'] = extras.probes ? {
    prefix: invalidPrefix ? [] : extras.probes.prefix.map(p => ({ k: p.k, meanBits: p.meanBits, full24: publicCount(p.full24) })),
    fingerprint: extras.probes.fingerprint ? {
      candidateSetSize: extras.probes.fingerprint.candidateSetSize, unique: extras.probes.fingerprint.unique,
      reciprocalRank: extras.probes.fingerprint.reciprocalRank,
    } : null,
    reason: invalidPrefix ? 'prefix-constraint-mismatch' : extras.probes.reason === null ? null : PROBE_REASONS.has(extras.probes.reason) ? extras.probes.reason : 'probe-unavailable',
  } : undefined;
  return { ...base, status: 'evaluated',
    ...(extras.evidence ? { evidence: { kind: 'recorded', tool: extras.evidence.tool,
      toolVersion: extras.evidence.toolVersion, sourceSha256: extras.evidence.sourceSha256 } } : {}),
    leaks: scoreLeaks(ledger, attempt), retention: scoreRetention(labels, input, attempt),
    correspondence: { conflicts: correspondence.issues.filter(i => i.kind === 'conflict').length,
      manyToOne: correspondence.issues.filter(i => i.kind === 'many-to-one').length,
      missing: correspondence.issues.filter(i => i.kind === 'missing').length },
    ...(probes ? { probes } : {}),
    ...(sidecar.stratum === 'semantic-positive' ? {
      utility: scoreUtility(input, attempt, sidecar, correspondence.addresses, correspondence.healthy),
      ...(extras.oracle ? { oracle: { flows: publicCount(extras.oracle.flows), findings: {
        preserved: extras.oracle.findings.preserved, lost: extras.oracle.findings.lost, introduced: extras.oracle.findings.introduced,
      } } } : {}),
      ...(extras.batfish ? { batfish: { status: extras.batfish.status,
        reason: extras.batfish.reason === null ? null : extras.batfish.reason === 'validated-batfish-recordings-required' ? 'validated-batfish-recordings-required' : 'native-trace-shape-or-correspondence-unavailable',
        scheduled: publicCount(extras.batfish.scheduled), evaluable: publicCount(extras.batfish.evaluable), coverage: publicCount(extras.batfish.coverage),
        evaluatorAgreement: publicCount(extras.batfish.evaluatorAgreement), authorAgreement: publicCount(extras.batfish.authorAgreement),
      } } : {}),
    } : { utilityReason: 'unsupported-stratum' }),
  };
}

/** Both strategy application and optional oracle/probe work use the same closed error path; nothing is logged. */
export async function evaluateSafely(context: RunnerCase, compute: () => OutcomeAttempt | Promise<OutcomeAttempt>,
  extras?: (outcome: Outcome) => SummaryExtras | Promise<SummaryExtras>): Promise<CaseResult> {
  try {
    const attempt = await compute();
    const additional = attempt.status !== 'not_run' && attempt.status !== 'error' && extras ? await extras(attempt) : {};
    return summariseOutcome(context, attempt, additional);
  } catch {
    return summariseOutcome(context, { status: 'not_run', reason: 'strategy-error' });
  }
}

/** Independently frozen expectation hashes do not replace the preregistered arm's exact ordered argument array. */
export function recordingExpectationMatches(expected: RecordingExpectation,
  prereg: { candidateCommit: string; netconanArgs: Record<RecordedArm, string[]> }): boolean {
  if (expected.tool !== 'netconan' || !Object.hasOwn(prereg.netconanArgs, expected.arm)) return false;
  return expected.candidateCommit === prereg.candidateCommit &&
    canonicalJson(expected.args) === canonicalJson(prereg.netconanArgs[expected.arm as RecordedArm]);
}

export interface ObservedFailure { rule: string; item: string }
const PUBLIC_DIAGNOSTICS = new Set([
  'ipv4-reserved-output', 'ipv4-network-or-broadcast-output', 'asn-out-of-range', 'strategy-failure',
  'unknown-line-forwarding', 'unknown-line', 'duplicate-hostname', 'invalid-host-address',
  'duplicate-hostname-line', 'duplicate-domain-line', 'duplicate-acl-name', 'duplicate-bgp-router',
  'interface-address-redefined', 'undefined-acl', 'invalid-unicode', 'file-too-large', 'too-many-lines',
  'too-many-interfaces', 'too-many-static-routes', 'too-many-acl-entries', 'too-many-bgp-neighbors',
  'too-few-devices', 'too-many-devices', 'case-too-large', 'too-many-flows', 'too-many-entities',
  'too-many-variants', 'deadline-exceeded',
]);

/** Safe public IDs and rule codes only; never return a diagnostic's free-form fileId or text. */
export function observedFailures(context: RunnerCase, outcome: Outcome, row: CaseResult,
  oracle: { originalBatfish?: RecordingBundleV1 | null; authorExpected?: ExpectedAnswers } = {}): ObservedFailure[] {
  const { input, sidecar } = context;
  if (row.status !== 'evaluated') return row.reason === 'strategy-error' ? [{ rule: 'strategy-error', item: 'strategy' }] : [];
  const out: ObservedFailure[] = [];
  const add = (rule: string, item: string): void => { out.push({ rule, item }); };
  for (const d of outcome.diagnostics) add(PUBLIC_DIAGNOSTICS.has(d.code) ? d.code : 'strategy-diagnostic',
    `position-${Number.isSafeInteger(d.ordinal) && d.ordinal >= 0 ? d.ordinal : 0}`);
  if (row.correspondence?.conflicts) add('correspondence-conflict', 'correspondence');
  if (row.correspondence?.manyToOne) add('many-to-one', 'correspondence');
  if (row.correspondence?.missing) add('correspondence-missing', 'correspondence');
  if (row.utility) {
    const before = findFindings(input, sidecar), after = findFindings(outcome, sidecar);
    const key = (f: typeof before[number]): string => JSON.stringify([f.rule, f.nodeId, f.aclId ?? null, f.direction ?? null, f.ordinal]);
    const remaining = after.map(key), originalKeys = before.map(key);
    const item = (f: typeof before[number]): string => `${f.nodeId}-${f.aclId ?? 'node'}-${f.direction ?? 'none'}-${f.ordinal}`;
    for (const f of before) { const i = remaining.indexOf(key(f)); if (i >= 0) remaining.splice(i, 1); else add(`finding-lost-${f.rule}`, item(f)); }
    for (const f of after) { const i = originalKeys.indexOf(key(f)); if (i >= 0) originalKeys.splice(i, 1); else add(`finding-introduced-${f.rule}`, item(f)); }
    const a = parseCase(input), b = parseCase(outcome);
    for (const n of sidecar.nodes) {
      const original = a.files.find(f => f.fileId === n.fileId)?.device;
      const output = b.files.find(f => f.fileId === n.fileId)?.device;
      if (!original) continue;
      for (const i of original.interfaces) for (const g of i.accessGroups) {
        if (!original.acls.some(acl => acl.name === g.aclName)) continue;
        const transformed = output?.interfaces.find(oi => oi.ordinal === i.ordinal);
        if (!transformed?.accessGroups.some(og => og.direction === g.direction && output?.acls.some(acl => acl.name === og.aclName))) {
          const id = sidecar.interfaces.find(si => si.nodeId === n.id && si.ordinal === i.ordinal)?.id ?? `${n.id}-interface-${i.ordinal}`;
          add('reference-broken', `${id}-${g.direction}`);
        }
      }
      for (const r of original.staticRoutes) {
        if (!original.interfaces.some(i => i.address && !i.shutdown && inSubnet(r.nextHop, i.address.address, i.address.prefixLength))) continue;
        const transformed = output?.staticRoutes.find(route => route.ordinal === r.ordinal);
        if (!transformed || !output?.interfaces.some(i => i.address && !i.shutdown && inSubnet(transformed.nextHop, i.address.address, i.address.prefixLength))) add('reference-broken', `${n.id}-route-${r.ordinal}`);
      }
    }
    const correspondence = deriveCorrespondence(input, outcome, sidecar);
    const batfish = oracle.originalBatfish ? recordedTraces(oracle.originalBatfish) : new Map();
    for (const flow of sidecar.flows) {
      const src = correspondence.addresses.get(flow.src), dst = correspondence.addresses.get(flow.dst);
      const original = evaluateFlow(input, sidecar, flow);
      if (!src || !dst || !correspondence.healthy || !sameTrace(original, evaluateFlow(outcome, sidecar, { ...flow, src, dst }))) add('flow-not-preserved', flow.id);
      const expected = oracle.authorExpected?.flows.find(f => f.flowId === flow.id);
      if (expected && !sameTrace(original, { ...expected, diagnostics: [] })) add('author-disagreement', flow.id);
      const recorded = batfish.get(flow.id);
      if (recorded && recorded.disposition !== 'unsupported') {
        if (original.disposition !== 'unsupported' && !sameTrace(original, recorded)) add('batfish-evaluator-disagreement', flow.id);
        if (expected && !sameTrace(recorded, { ...expected, diagnostics: [] })) add('batfish-author-disagreement', flow.id);
      }
    }
  }
  if (row.probes?.prefix.some(p => (p.meanBits ?? 0) > 0)) add('known-prefix-exposure', 'probe-a');
  if (row.probes?.reason === 'prefix-constraint-mismatch') add('prefix-constraint-mismatch', 'probe-a');
  if (row.probes?.fingerprint?.unique) add('unique-fingerprint', 'probe-b');
  return out;
}
