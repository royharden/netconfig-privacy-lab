import { describe, expect, it } from 'vitest';
import type { Outcome, RecordedArm } from '../../src/strategies/types';
import type { ExpectedAnswers } from '../../src/core/expected';
import { parseIPv4 } from '../../src/core/ipv4';
import { deriveCorrespondence } from '../../src/eval/correspondence';
import { evaluateFlow } from '../../src/eval/evaluator';
import { count } from '../../src/eval/leakscore';
import { BATFISH_QUERIES, canonicalJson, normaliseRawAnswers, NORMALISER_VERSION } from '../../src/eval/normalise';
import { compareBatfish } from '../../src/eval/oracle';
import { knownPrefixProbe } from '../../src/eval/probes';
import { loadRecordedOutcome } from '../../src/eval/recorded';
import type { RecordingBundleV1, RecordingExpectation } from '../../src/eval/recordings';
import { sha256Text, validateRecordingBundle } from '../../src/eval/recordings';
import { emptyReport, renderReport } from '../../src/eval/results';
import { evaluateSafely, observedFailures, recordingExpectationMatches, summariseOutcome } from '../../src/eval/runner';
import type { RunnerCase } from '../../src/eval/runner';
import { authorAgreement } from '../../src/eval/utility';

// Literal builder-only network and metadata. No corpus, recording files, keys or author data are opened.
function fixture(arm: Outcome['arm'] = 'identity'): RunnerCase {
  const input = { caseId: 'runner-unit', files: Array.from({ length: 3 }, (_, i) => ({
    fileId: `f${i}`, name: `unit${i}.cfg`, text: `hostname unit${i}\ninterface GigabitEthernet0/0\n ip address 10.0.${i}.1 255.255.255.0\n${i === 0 ? ' ip access-group ALLOW in\n' : ''}!\n${i === 0 ? 'ip access-list extended ALLOW\n permit ip any any\n!\nip route 0.0.0.0 0.0.0.0 10.0.0.254\nsnmp-server community public RO\n' : ''}end\n`,
  })) };
  return { input, arm,
    sidecar: { schema: 'case-v1', caseId: input.caseId, family: 'ring', stratum: 'semantic-positive',
      files: input.files.map((f, i) => ({ fileId: f.fileId, name: f.name, path: `n${i}.cfg`, nodeId: `n${i}` })),
      nodes: input.files.map((f, i) => ({ id: `n${i}`, fileId: f.fileId })),
      interfaces: input.files.map((_, i) => ({ id: `i${i}`, nodeId: `n${i}`, ordinal: 1 })),
      acls: [{ id: 'a0', nodeId: 'n0', aclName: 'ALLOW' }], aclEntries: [{ id: 'e0', nodeId: 'n0', aclId: 'a0', aclName: 'ALLOW', ordinal: 1 }],
      flows: Array.from({ length: 32 }, (_, i) => ({ id: `q${i}`, ingressNodeId: 'n0', ingressInterfaceId: 'i0',
        src: '10.0.0.1', dst: '10.0.0.1', protocol: 'tcp', srcPort: 1000, dstPort: 80 })),
    },
    ledger: { schema: 'ledger-v1', caseId: input.caseId, entities: [] },
    labels: { schema: 'labels-v1', caseId: input.caseId, benignSpans: [], freeTextTokens: [] },
  };
}
function identity(context: RunnerCase): Outcome {
  return { ...context.input, arm: context.arm, status: 'ok', diagnostics: [] };
}

async function recording(context: RunnerCase, tool: 'netconan' | 'batfish' = 'netconan'):
Promise<{ bundle: RecordingBundleV1; expected: RecordingExpectation }> {
  const files = await Promise.all(context.input.files.map(async f => ({ ...f, sha256: await sha256Text(f.text) })));
  const queries = tool === 'netconan' ? [{ query: 'output', parametersJson: '{}' }] : BATFISH_QUERIES.map(query => ({ query,
    parametersJson: query === 'traceroute' ? canonicalJson({ flowId: 'q0', ignoreFilters: false,
      ingressNode: 'unit0', ingressInterface: 'GigabitEthernet0/0', headers: { srcIps: '10.0.0.1', dstIps: '10.0.0.1' } }) : '{}',
  }));
  const rawAnswers = canonicalJson({ schema: 'raw-recording-v1', answers: tool === 'netconan'
    ? files.map(f => ({ query: 'output', rowId: f.fileId, answer: { name: f.name, text: f.text } }))
    : BATFISH_QUERIES.map(query => ({ query, rowId: query === 'traceroute' ? 'q0' : 'metadata',
      answer: query === 'traceroute' ? { disposition: 'NO_ROUTE', nodeIds: ['n0'],
        interfaceHops: [{ nodeId: 'n0', ingress: 'i0', egress: null }], aclDecision: null } : {} })),
  });
  const expected: RecordingExpectation = { tool, caseId: context.input.caseId, arm: context.arm, split: 'dev',
    keyId: 'synthetic-key1', keyScope: 'synthetic-evaluation', candidateCommit: 'a'.repeat(40), recorderSourceSha256: 'b'.repeat(64),
    inputFiles: context.input.files, toolVersion: 'literal-unit-fixture', imageDigest: tool === 'batfish' ? `sha256:${'c'.repeat(64)}` : null,
    packageFileHashes: tool === 'netconan' ? [{ path: 'package-file', sha256: 'c'.repeat(64) }] : [],
    pybatfishVersion: tool === 'batfish' ? 'literal-unit-fixture' : null, args: tool === 'netconan' ? ['-a', '-p'] : [], queries,
    effectiveOptionsJson: '{}', salt: 'synthetic-unit', versionSha256: await sha256Text('unit-version'), helpSha256: await sha256Text('unit-help') };
  return { expected, bundle: { ...expected, schema: 'recording-v1', inputFiles: files, outputFiles: files,
    versionOutput: 'unit-version', helpOutput: 'unit-help', rawAnswers, rawAnswersSha256: await sha256Text(rawAnswers),
    normaliserVersion: NORMALISER_VERSION, normalisedRows: normaliseRawAnswers(tool, rawAnswers), exitStatus: 0, elapsedMs: 0,
    operatorCallsign: 'builder-unit-test', date: '2026-10-27T00:00:00Z' } };
}

describe('the shared runner row boundary', () => {
  it('keeps missing recordings in the scheduled denominator through the real loader and wrapper', async () => {
    const context = fixture('netconan-minimal'), { expected } = await recording(context);
    const row = await evaluateSafely(context, () => loadRecordedOutcome(null, expected).then(result => {
      if (result.status === 'not_run') return result;
      return result.outcome;
    }));
    expect(row).toMatchObject({ caseId: 'runner-unit', family: 'ring', arm: 'netconan-minimal', status: 'not_run', reason: 'missing-recording' });
    expect(row.utility?.scheduled).toMatchObject({ numerator: 0, denominator: 32, value: 0 });
    expect(row.utility?.evaluable).toMatchObject({ numerator: 0, denominator: 0, value: null });
    expect(row.utility?.coverage).toMatchObject({ numerator: 0, denominator: 32, value: 0 });
  });

  it('keeps returned strategy errors and thrown strategy errors at 0/32 scheduled, N/A evaluable and 0/32 coverage', async () => {
    const context = fixture();
    const attempts = [() => ({ ...identity(context), status: 'error' as const, files: [] }),
      () => { throw new Error('PRIVATE_RUNNER_ERROR'); }];
    for (const attempt of attempts) {
      const row = await evaluateSafely(context, attempt);
      expect(row.status).toBe('not_run'); expect(row.reason).toBe('strategy-error');
      expect(row.utility?.scheduled).toMatchObject({ numerator: 0, denominator: 32 });
      expect(row.utility?.evaluable.value).toBeNull();
      expect(row.utility?.coverage).toMatchObject({ numerator: 0, denominator: 32 });
      expect(JSON.stringify(row)).not.toContain('PRIVATE_RUNNER_ERROR');
    }
  });

  it('scores unsupported challenges for leakage/retention while omitting every utility and oracle field', async () => {
    const context = fixture(); context.sidecar.stratum = 'unsupported'; context.sidecar.flows = [];
    const row = await evaluateSafely(context, () => ({ ...identity(context), status: 'unsupported' }), () => ({
      oracle: { flows: count(1, 1), findings: { preserved: 1, lost: 0, introduced: 0 } },
      batfish: { status: 'available', reason: null, scheduled: count(1, 1), evaluable: count(1, 1), coverage: count(1, 1),
        evaluatorAgreement: count(1, 1), authorAgreement: count(1, 1) },
    }));
    expect(row.status).toBe('evaluated'); expect(row.leaks).toHaveLength(14); expect(row.retention).toBeDefined();
    expect(row.utilityReason).toBe('unsupported-stratum');
    for (const field of ['utility', 'oracle', 'batfish']) expect(row).not.toHaveProperty(field);
    expect(observedFailures(context, identity(context), row).some(f => /finding-|reference-|flow-|disagreement/.test(f.rule))).toBe(false);
    const missing = summariseOutcome(context, { status: 'not_run', reason: 'missing-recording' });
    expect(missing).not.toHaveProperty('utility');
  });

  it('rejects a hash-valid recording expectation that disagrees with frozen ordered netconan arguments', async () => {
    const context = fixture('netconan-minimal'), { bundle, expected } = await recording(context);
    const changed = { ...expected, args: ['-p', '-a'] }, changedBundle = { ...bundle, args: changed.args };
    // The independently pinned expectation and bundle agree and their retained byte hashes are valid.
    expect((await validateRecordingBundle(changedBundle, changed)).ok).toBe(true);
    const frozen = { candidateCommit: expected.candidateCommit, netconanArgs: {
      'netconan-minimal': ['-a', '-p'], 'netconan-operator': ['-a', '-p', '-w'], 'netconan-ledger-informed': ['-a', '-p', '-n'],
    } satisfies Record<RecordedArm, string[]> };
    expect(recordingExpectationMatches(expected, frozen)).toBe(true);
    expect(recordingExpectationMatches(changed, frozen)).toBe(false);
    const row = await evaluateSafely(context, async () => {
      if (!recordingExpectationMatches(changed, frozen)) return { status: 'not_run', reason: 'recording-preregistration-mismatch' };
      const loaded = await loadRecordedOutcome(changedBundle, changed);
      return loaded.status === 'not_run' ? loaded : loaded.outcome;
    });
    expect(row).toMatchObject({ status: 'not_run', reason: 'recording-preregistration-mismatch', utility: { scheduled: { numerator: 0, denominator: 32 } } });
  });

  it('renders a healthy correspondence with an invalid prefix constraint as explicitly unavailable', async () => {
    const context = fixture();
    const outcome = { ...identity(context), files: context.input.files.map((f, i) => ({ ...f,
      text: f.text.replaceAll(`10.0.${i}.1`, i === 0 ? '192.0.2.1' : i === 1 ? '203.0.113.1' : '198.51.100.1') })) };
    const correspondence = deriveCorrespondence(context.input, outcome, context.sidecar);
    expect(correspondence.healthy).toBe(true);
    const pairs = ['10.0.0.1', '10.0.1.1'].map(address => ({ original: parseIPv4(address)!, output: parseIPv4(correspondence.addresses.get(address)!)! }));
    const invalid = knownPrefixProbe([pairs[0]!], [pairs[1]!]); expect(invalid.valid).toBe(false);
    const row = await evaluateSafely(context, () => outcome, () => ({ probes: { prefix: [{ k: 1, ...invalid }], fingerprint: null, reason: 'pool-not-generated' } }));
    expect(row.probes).toEqual({ prefix: [], fingerprint: null, reason: 'prefix-constraint-mismatch' });
    const report = emptyReport('pending'); report.rows = [row];
    expect(renderReport(report)).toContain('prefix-constraint-mismatch');
    expect(observedFailures(context, outcome, row)).toContainEqual({ rule: 'prefix-constraint-mismatch', item: 'probe-a' });
  });

  it('reports concrete default-community/reference loss and validated Batfish disagreements by stable finding, interface, route and flow IDs', async () => {
    const context = fixture(), { bundle, expected } = await recording(context, 'batfish');
    const checked = await validateRecordingBundle(bundle, expected); expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error('invalid-builder-unit-recording');
    const author: ExpectedAnswers = { schema: 'expected-v1', caseId: context.input.caseId,
      flows: [{ flowId: 'q0', disposition: 'delivered', nodeIds: ['n0'], interfaceHops: [{ nodeId: 'n0', ingress: 'i0', egress: null }],
        aclDecision: { nodeId: 'n0', aclId: 'a0', entryOrdinal: 1 } }], findings: [] };
    const outcome = { ...identity(context), files: context.input.files.map((f, i) => i ? f : { ...f,
      text: f.text.replace('access-group ALLOW', 'access-group BROKEN').replace('community public', 'community replaced').replace('10.0.0.254', '198.51.100.1') }) };
    const row = await evaluateSafely(context, () => outcome, () => ({
      oracle: authorAgreement(context.input, context.sidecar, author),
      batfish: compareBatfish(checked.value, checked.value, context.sidecar.flows.map(f => f.id),
        context.sidecar.flows.map(f => evaluateFlow(context.input, context.sidecar, f)), author),
    }));
    const failures = observedFailures(context, outcome, row, { originalBatfish: checked.value, authorExpected: author });
    expect(failures).toContainEqual({ rule: 'finding-lost-default-snmp-community', item: 'n0-node-none-10' });
    expect(failures).toContainEqual({ rule: 'reference-broken', item: 'i0-in' });
    expect(failures).toContainEqual({ rule: 'reference-broken', item: 'n0-route-1' });
    expect(failures).toContainEqual({ rule: 'flow-not-preserved', item: 'q0' });
    expect(failures).toContainEqual({ rule: 'batfish-evaluator-disagreement', item: 'q0' });
    expect(failures).toContainEqual({ rule: 'batfish-author-disagreement', item: 'q0' });
    expect(observedFailures(context, outcome, row).some(f => f.rule.startsWith('batfish-'))).toBe(false);
    const report = emptyReport('pending'); report.rows = [row]; report.failures = failures.map((failure, i) => ({
      failureId: `f${i + 1}`, caseId: context.input.caseId, arm: context.arm, classOrFlowOrFindingId: failure.item,
      rule: failure.rule, evidenceRef: 'unit-report', status: 'observed',
    }));
    const rendered = renderReport(report);
    for (const text of ['finding-lost-default-snmp-community', 'i0-in', 'n0-route-1', 'batfish-evaluator-disagreement', 'batfish-author-disagreement']) expect(rendered).toContain(text);
    expect(JSON.stringify(failures)).not.toContain('BROKEN'); expect(JSON.stringify(failures)).not.toContain('198.51.100.1');
  });
});
