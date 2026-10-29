import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { hostname } from 'node:os';
import { sha256, safePath, verifyVault } from './custody';
import { parseManifest } from '../src/core/manifest';
import { parseSidecar } from '../src/core/sidecar';
import { parseLedger } from '../src/core/ledger';
import { parseLabels } from '../src/core/labels';
import { deriveStrategyCtx, parseEvaluationKeys } from '../src/strategies/keys';
import { extractOperatorList } from '../src/core/operatorList';
import { getStrategy } from '../src/strategies/index';
import { ARMS } from '../src/strategies/types';
import { deriveCorrespondence } from '../src/eval/correspondence';
import type { Count } from '../src/eval/leakscore';
import { LEDGER_CLASSES } from '../src/core/ledger';
import type { CaseResult } from '../src/eval/results';
import { authorAgreement } from '../src/eval/utility';
import { verifyCandidateSource } from './candidate';
import { parsePreregistration, verifyPreregistrationSelections, selectProbePair } from './preregistration';
import { parseExpected } from '../src/core/expected';
import type { ExpectedAnswers } from '../src/core/expected';
import { parseIPv4 } from '../src/core/ipv4';
import { caseFingerprint, fingerprintProbe, knownPrefixProbe, probeAddressStrings } from '../src/eval/probes';
import { pairedBootstrap } from '../src/eval/bootstrap';
import type { Cluster } from '../src/eval/bootstrap';
import { parsePoolIndex } from '../src/gen/pool';
import type { Fingerprint } from '../src/eval/probes';
import { emptyReport, renderReport } from '../src/eval/results';
import type { CaseInput, Outcome } from '../src/strategies/types';
import type { RecordingExpectation } from '../src/eval/recordings';
import { loadRecordedOutcome } from '../src/eval/recorded';
import { validateRecordingBundle } from '../src/eval/recordings';
import type { RecordingBundleV1 } from '../src/eval/recordings';
import { compareBatfish } from '../src/eval/oracle';
import { evaluateFlow } from '../src/eval/evaluator';
import { evaluateSafely, observedFailures, recordingExpectationMatches } from '../src/eval/runner';
import type { Preregistration } from './preregister';

async function heldoutGuard(root: string): Promise<Preregistration> {
  const g0 = JSON.parse(await readFile('evaluation/g0-admission.json', 'utf8')) as { status: string; royR1: string; royR2: string; author: string; evidenceSha256: string[] };
  if (g0.status !== 'pass' || !g0.royR1 || !g0.royR2 || !g0.author || !g0.evidenceSha256?.length || g0.evidenceSha256.some(h => !/^[0-9a-f]{64}$/.test(h))) throw new Error('g0-pending');
  const bytes = await readFile('evaluation/preregister.json');
  if (sha256(bytes) !== (await readFile('evaluation/preregister.sha256', 'utf8')).trim()) throw new Error('preregister-mismatch');
  const checked=parsePreregistration(JSON.parse(bytes.toString('utf8')));
  if(!checked.ok)throw new Error('invalid-preregistration');
  const p=checked.value;
  if (p.schema !== 'preregister-v1' || sha256(await readFile('package-lock.json')) !== p.lockfileSha256 || sha256(await readFile('evaluation/corpus-manifest.json')) !== p.corpusManifestSha256 || sha256(await readFile('fixtures/pool/INDEX.json'))!==p.poolIndexSha256) throw new Error('candidate-input-mismatch');
  // Candidate commit and tag are verified with fs only; no process spawning.
  const head = (await readFile('.git/HEAD', 'utf8')).trim();
  const commit = head.startsWith('ref: ') ? (await readFile(await safePath('.git', head.slice(5)), 'utf8')).trim() : head;
  const tag = (await readFile(await safePath('.git', `refs/tags/${p.candidateTag}`), 'utf8')).trim();
  if (commit !== p.candidateCommit || tag !== p.candidateCommit) throw new Error('candidate-not-pinned');
  await verifyCandidateSource(p.candidateCommit);
  await verifyPreregistrationSelections(p,root);
  const pin = (await readFile('gold/heldout/MANIFEST.sha256', 'utf8')).trim();
  if (pin !== p.vaultManifestSha256) throw new Error('g1-mismatch');
  const { receipt } = await verifyVault(root, pin, true);
  for (const path of ['evaluation/g1-receipt.json', 'evaluation/preflight-receipt.json']) {
    const old = JSON.parse(await readFile(path, 'utf8')) as typeof receipt;
    if (JSON.stringify(old) !== JSON.stringify(receipt)) throw new Error('custody-receipt-mismatch');
  }
  const practice = parseManifest(JSON.parse(await readFile('fixtures/practice/MANIFEST.json', 'utf8')));
  if (!practice.ok || practice.value.cases.length !== 2 || practice.value.cases.some(c => c.split !== 'practice')) throw new Error('practice-pending');
  return p;
}

async function main(): Promise<void> {
  const splitIndex = process.argv.indexOf('--split'), split = process.argv[splitIndex + 1];
  if (splitIndex < 0 || !['dev', 'practice', 'heldout'].includes(split ?? '')) throw new Error('usage: eval --split dev|practice|heldout [--vault PATH]');
  const root = split === 'heldout' ? process.argv[process.argv.indexOf('--vault') + 1] : `fixtures/${split}`;
  if (!root || (split === 'heldout' && !process.argv.includes('--vault'))) throw new Error('vault-required');
  const prereg = split === 'heldout' ? await heldoutGuard(root) : null;
  // Expectations are independently frozen context, never fields inferred from a bundle.
  let recordingPins: RecordingExpectation[] = [];
  const recordingPinsPath = process.argv[process.argv.indexOf('--recording-pins') + 1];
  const recordingPinsHash = process.argv[process.argv.indexOf('--recording-pins-sha256') + 1];
  if (process.argv.includes('--recording-pins') && process.argv.includes('--recording-pins-sha256') && recordingPinsPath && /^[0-9a-f]{64}$/.test(recordingPinsHash ?? '')) {
    const frozenHash = (prereg as (Preregistration & { recordingExpectationsSha256?: string }) | null)?.recordingExpectationsSha256;
    if (split !== 'heldout' || frozenHash === recordingPinsHash) {
      const bytes = await readFile(recordingPinsPath);
      if (sha256(bytes) !== recordingPinsHash) throw new Error('recording-expectations-hash-mismatch');
      const parsed: unknown = JSON.parse(bytes.toString('utf8'));
      if (!Array.isArray(parsed)) throw new Error('recording-expectations-not-array');
      recordingPins = parsed as RecordingExpectation[];
    }
  }
  // Output reservation precedes any label opening: existing execution bytes prohibit a confirmatory rerun.
  await mkdir('results', { recursive: true });
  if (split === 'heldout') await writeFile('evaluation/heldout-opened.json', JSON.stringify({ candidateCommit: prereg!.candidateCommit, preregisterSha256: sha256(await readFile('evaluation/preregister.json')) }), { flag: 'wx' });
  const manifest = parseManifest(JSON.parse(await readFile(await safePath(root, 'MANIFEST.json'), 'utf8')));
  if (!manifest.ok || manifest.value.cases.some(c => c.split !== split)) throw new Error('manifest-split-mismatch');
  const report = emptyReport('recording or oracle not available');
  report.rows = []; report.machine = hostname(); report.phase = split === 'heldout' ? 'confirmatory' : 'development';
  report.runtimeVerified = true;
  if (prereg) { report.seeds = prereg.seeds; report.pins = { candidateCommit: prereg.candidateCommit, corpusManifestSha256: prereg.corpusManifestSha256 }; }
  if (recordingPins.length > 0) report.pins.recordingExpectationsSha256 = recordingPinsHash!;
  const keys = parseEvaluationKeys(await readFile('fixtures/eval-key.txt', 'utf8'));
  try {
    for (const c of manifest.value.cases) {
      const readRole = async (role: string): Promise<unknown> => {
        const f = c.files.find(x => x.role === role);
        if (!f) throw new Error('missing-role');
        const bytes = await readFile(await safePath(root, f.path));
        if (sha256(bytes) !== f.sha256) throw new Error('case-hash-mismatch');
        return JSON.parse(bytes.toString('utf8'));
      };
      const sidecar = parseSidecar(await readRole('case')), ledger = parseLedger(await readRole('ledger')), labels = parseLabels(await readRole('labels'));
      if (!sidecar.ok || !ledger.ok || !labels.ok || sidecar.value.caseId !== c.caseId || ledger.value.caseId !== c.caseId || labels.value.caseId !== c.caseId || (sidecar.value.stratum === 'semantic-positive' && sidecar.value.flows.length !== 32)) throw new Error('invalid-case-contract');
      const input: CaseInput = { caseId: c.caseId, files: [] };
      for (const f of sidecar.value.files) {
        const entry = c.files.find(x => x.role === 'config' && x.path.endsWith(`/${f.path}`));
        if (!entry) throw new Error('config-not-in-manifest');
        const bytes = await readFile(await safePath(root, entry.path));
        if (sha256(bytes) !== entry.sha256) throw new Error('config-hash-mismatch');
        input.files.push({ fileId: f.fileId, name: f.name, text: bytes.toString('utf8') });
      }
      const batfishBundle=async(arm:typeof ARMS[number],source:CaseInput):Promise<RecordingBundleV1|null>=>{
        const pins=recordingPins.filter(p=>p.tool==='batfish'&&p.caseId===c.caseId&&p.arm===arm&&p.split===split);if(pins.length!==1)return null;
        try{const value:unknown=JSON.parse(await readFile(await safePath('recordings',`batfish/${arm}/${split}/${c.caseId}.json`),'utf8'));const pin={...pins[0]!,inputFiles:source.files,caseId:c.caseId,arm,split:c.split};if(prereg&&pin.candidateCommit!==prereg.candidateCommit)return null;const result=await validateRecordingBundle(value,pin);return result.ok?result.value:null;}catch{return null;}
      };
      const originalBatfish=await batfishBundle('identity',input);
      let oracle: ReturnType<typeof authorAgreement> | undefined;
      let authorExpected:ExpectedAnswers|undefined;
      if(c.files.some(f=>f.role==='expected')){const e=parseExpected(await readRole('expected'));if(!e.ok)throw new Error('invalid-author-answers');authorExpected=e.value;oracle=authorAgreement(input,sidecar.value,e.value);}
      // Pool and pair selection are frozen before held-out opening; no vocabulary, ledger or key enters the probe.
      let decoys: {id:string;fingerprint:Fingerprint}[]=[];
      try {
        const pool=parsePoolIndex(JSON.parse(await readFile('fixtures/pool/INDEX.json','utf8')));
        if(!pool.ok)throw new Error('invalid-pool');
        const cell=pool.value.entries.filter(e=>e.family===c.family&&e.deviceCount===c.deviceCount);
        if(cell.length!==49||prereg&&cell.some(e=>!prereg.poolIds.includes(e.caseId)))throw new Error('pool-choice-mismatch');
        for(const e of cell){const files=[];for(const f of e.files.filter(f=>f.role==='config')){const bytes=await readFile(await safePath('fixtures/pool',f.path));if(sha256(bytes)!==f.sha256)throw new Error('pool-hash-mismatch');files.push({fileId:`n${files.length+1}`,name:'n.cfg',text:bytes.toString('utf8')});}decoys.push({id:e.caseId,fingerprint:caseFingerprint({caseId:e.caseId,files})});}
      } catch { if(prereg)throw new Error('frozen-pool-unavailable');decoys=[]; }
      for (const arm of ARMS) {
        const strategy = getStrategy(arm);
        const context = { input, sidecar: sidecar.value, ledger: ledger.value, labels: labels.value, arm };
        let produced: Outcome | undefined;
        let evidence: CaseResult['evidence'];
        const row = await evaluateSafely(context, async () => {
          if (strategy) {
            const ctx = await deriveStrategyCtx(keys[arm === 'lab-scrub@key2' ? 1 : 0], extractOperatorList(input));
            produced = await strategy.apply(input, ctx);
          } else {
            const matches = recordingPins.filter(pin => pin.tool === 'netconan' && pin.caseId === c.caseId && pin.arm === arm && pin.split === split);
            if (matches.length !== 1) return { status: 'not_run', reason: 'independently-pinned-recording-required' };
            const expected = { ...matches[0]!, caseId:c.caseId, arm, split:c.split, inputFiles:input.files };
            if (prereg && !recordingExpectationMatches(expected, prereg)) return { status: 'not_run', reason: 'recording-preregistration-mismatch' };
            let bundle: unknown = null;
            try { bundle = JSON.parse(await readFile(await safePath('recordings',`netconan/${arm}/${split}/${c.caseId}.json`),'utf8')); }
            catch { /* Missing, unreadable and malformed bundles remain not_run. */ }
            const recorded = await loadRecordedOutcome(bundle,expected);
            if (recorded.status === 'not_run') return recorded;
            produced = recorded.outcome;
            evidence = {kind:'recorded',tool:recorded.bundle.tool,toolVersion:recorded.bundle.toolVersion,sourceSha256:recorded.bundle.recorderSourceSha256};
          }
          if (!produced) return { status: 'not_run', reason: 'strategy-error' };
          return produced;
        }, async (outcome) => {
          const correspondence = deriveCorrespondence(input, outcome, sidecar.value);
          const probeTargets = new Set(probeAddressStrings(input));
          const allPairs=[...correspondence.addresses].flatMap(([a,b])=>{const original=parseIPv4(a),output=parseIPv4(b);return !probeTargets.has(a)||original===null||output===null?[]:[{original,output,text:a}];});
          const selected=prereg?.probePairs.find(p=>p.caseId===c.caseId)?.pairs[0]??selectProbePair(input,report.seeds.probe);
          const known=selected.flatMap(address=>{const pair=allPairs.find(p=>p.text===address);return pair?[pair]:[];});
          if(prereg&&known.length<2)throw new Error('probe-pairs-not-frozen');
          const model=['identity','lab-scrub','lab-drop','lab-scrub@key2'].includes(arm);
          const prefix=correspondence.healthy&&!arm.startsWith('netconan')?[0,1,2].map(k=>({k,...knownPrefixProbe(allPairs.filter(p=>!known.slice(0,k).includes(p)),known.slice(0,k),arm==='identity'?32:0,model)})):[];
          const fingerprint=decoys.length===49?fingerprintProbe(caseFingerprint(outcome),[{id:c.caseId,fingerprint:caseFingerprint(input)},...decoys],c.caseId):null;
          const batfish=c.stratum==='semantic-positive'?compareBatfish(originalBatfish,arm==='identity'?originalBatfish:await batfishBundle(arm,outcome),sidecar.value.flows.map(f=>f.id),sidecar.value.flows.map(f=>evaluateFlow(input,sidecar.value,f)),authorExpected):undefined;
          return { ...(evidence ? {evidence} : {}), ...(oracle ? {oracle} : {}), ...(batfish ? {batfish} : {}),
            probes: {prefix,fingerprint,reason:!correspondence.healthy?'unhealthy-correspondence':arm.startsWith('netconan')?'prefix-disclosure-model-not-validated':fingerprint?null:'pool-not-generated'} };
        });
        report.rows.push(row);
        const failures = produced ? observedFailures(context, produced, row, {originalBatfish, authorExpected}) : row.reason === 'strategy-error' ? [{rule:'strategy-error',item:'strategy'}] : [];
        for (const failure of failures) report.failures.push({ failureId:`f${report.failures.length+1}`,caseId:c.caseId,arm,
          classOrFlowOrFindingId:failure.item,rule:failure.rule,evidenceRef:`results/${split}.json#${c.caseId}/${arm}`,status:'observed' });
      }
    }
    for (const table of ['A','B','C'] as const) report.tables[table] = { status: 'available', reason: 'local evaluator only; external oracle pending' };
    report.intervals=[];
    const metrics:{name:string;read:(r:CaseResult)=>Count|undefined}[]=[
      {name:'scheduled-flow-preservation',read:r=>r.utility?.scheduled},{name:'evaluable-flow-preservation',read:r=>r.utility?.evaluable},{name:'coverage',read:r=>r.utility?.coverage},
      {name:'address-prefix-relations',read:r=>r.utility?.addressPairs},{name:'subnet-relations',read:r=>r.utility?.subnetRelations},{name:'reference-integrity',read:r=>r.utility?.referenceIntegrity},
      {name:'over-redaction',read:r=>r.retention?.overRedaction},{name:'free-text-retention',read:r=>r.retention?.freeTextRetention},{name:'final-octet-retention',read:r=>r.retention?.finalOctetRetention},
      ...LEDGER_CLASSES.flatMap(cls=>[{name:`entity-residual-${cls}`,read:(r:CaseResult)=>r.leaks?.find(x=>x.class===cls)?.entities},{name:`occurrence-residual-${cls}`,read:(r:CaseResult)=>r.leaks?.find(x=>x.class===cls)?.occurrences}]),
    ];
    for(const arm of ARMS.filter(a=>a!=='lab-scrub@key2'))for(const reference of ['naive-mask','netconan-minimal','netconan-operator','netconan-ledger-informed'] as const){
      for(const metric of metrics){const clusters=(target:typeof arm):Cluster[]=>report.rows.filter(r=>r.arm===target&&r.family&&metric.read(r)).map(r=>({caseId:r.caseId,family:r.family!,numerator:metric.read(r)!.numerator,denominator:metric.read(r)!.denominator}));
        const a=clusters(arm),b=clusters(reference);if(a.length&&a.length===b.length&&a.every(x=>b.some(y=>y.caseId===x.caseId)))report.intervals.push({arm,reference,metric:metric.name,interval:pairedBootstrap(a,b,report.seeds.bootstrap)});
      }
    }
    if(report.rows.some(r=>r.probes?.fingerprint))report.tables.D={status:'available',reason:'prefix probe only for declared prefix-preserving arms; others not applicable'};
    if(report.rows.some(r=>r.oracle))report.tables.E={status:'available',reason:'evaluator versus independent author only; Batfish pending'};
    report.tables.F={status:'available',reason:null};
    await writeFile(`results/${split}.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    await writeFile(`results/${split}.md`, renderReport(report), { flag: 'wx' });
    await writeFile(`results/${split}-failures.json`, JSON.stringify(report.failures, null, 2) + '\n', { flag: 'wx' });
  } finally { keys[0].fill(0); keys[1].fill(0); }
}
main().catch(() => { console.error('evaluation refused or stopped; inspect pinned inputs and admission records; no sensitive details logged'); process.exitCode = 1; });
