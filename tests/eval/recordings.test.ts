import { describe, expect, it } from 'vitest';
import type { RecordingBundleV1, RecordingExpectation } from '../../src/eval/recordings';
import { sha256Text, validateRecordingBundle } from '../../src/eval/recordings';
import { canonicalJson, mapBatfishDisposition, normaliseRawAnswers, NORMALISER_VERSION } from '../../src/eval/normalise';
import { loadRecordedOutcome } from '../../src/eval/recorded';

async function fixture(): Promise<{ bundle: RecordingBundleV1; expected: RecordingExpectation }> {
  const file = { fileId:'n01', name:'n01.cfg', text:'hostname synthetic\n' };
  const files = [{ ...file, sha256:await sha256Text(file.text) }];
  const rawAnswers=JSON.stringify({schema:'raw-recording-v1',answers:[{query:'output',rowId:'n01',answer:{name:file.name,text:file.text}}]});
  const expected: RecordingExpectation={tool:'netconan',caseId:'s01',arm:'netconan-minimal',split:'dev',keyId:'synthetic-key1',
    keyScope:'synthetic-evaluation',candidateCommit:'a'.repeat(40),recorderSourceSha256:'b'.repeat(64),inputFiles:[file],
    toolVersion:'unverified-fixture',imageDigest:null,packageFileHashes:[{path:'package-file',sha256:'c'.repeat(64)}],
    pybatfishVersion:null,args:['-a','-p'],queries:[{query:'output',parametersJson:'{}'}],effectiveOptionsJson:'{}',salt:'synthetic-only',
    versionSha256:await sha256Text('fixture'),helpSha256:await sha256Text('fixture-help')};
  const bundle: RecordingBundleV1={...expected,schema:'recording-v1',inputFiles:files,outputFiles:files,versionOutput:'fixture',helpOutput:'fixture-help',
    versionSha256:await sha256Text('fixture'),helpSha256:await sha256Text('fixture-help'),rawAnswers,rawAnswersSha256:await sha256Text(rawAnswers),
    normaliserVersion:NORMALISER_VERSION,normalisedRows:normaliseRawAnswers('netconan',rawAnswers),exitStatus:0,elapsedMs:0,
    operatorCallsign:'builder-unit-test',date:'2026-10-27T00:00:00Z'};
  return {bundle,expected};
}

describe('recording validation: tampering never becomes measured evidence',()=>{
  it('accepts a self-contained synthetic unit fixture',async()=>{const {bundle,expected}=await fixture();expect((await validateRecordingBundle(bundle,expected)).ok).toBe(true);});
  for(const field of ['caseId','arm','keyId','keyScope','recorderSourceSha256','candidateCommit'] as const) {
    it(`rejects wrong ${field} (cross-case/arm/key/source reuse)`,async()=>{const {bundle,expected}=await fixture();
      const value={...bundle,[field]:field==='recorderSourceSha256'?'d'.repeat(64):field==='candidateCommit'?'d'.repeat(40):field==='arm'?'netconan-operator':'wrong'};
      expect((await validateRecordingBundle(value,expected)).ok).toBe(false);});
  }
  it('rejects wrong input hash',async()=>{const {bundle,expected}=await fixture();bundle.inputFiles=[{...bundle.inputFiles[0]!,sha256:'d'.repeat(64)}];expect((await validateRecordingBundle(bundle,expected)).ok).toBe(false);});
  it('rejects changed input even with a recomputed self-hash',async()=>{const {bundle,expected}=await fixture();bundle.inputFiles=[{...bundle.inputFiles[0]!,text:'edited',sha256:await sha256Text('edited')}];expect((await validateRecordingBundle(bundle,expected)).ok).toBe(false);});
  it('rejects edited normalized rows by recomputing retained raw answers',async()=>{const {bundle,expected}=await fixture();bundle.normalisedRows[0]!.answer='{}';expect((await validateRecordingBundle(bundle,expected)).ok).toBe(false);});
  it('rejects every missing field',async()=>{const {bundle,expected}=await fixture();for(const key of Object.keys(bundle)) {const value:Record<string,unknown>={...bundle};delete value[key];expect((await validateRecordingBundle(value,expected)).ok,key).toBe(false);}});
  it('rejects unknown fields',async()=>{const {bundle,expected}=await fixture();expect((await validateRecordingBundle({...bundle,unexpected:true},expected)).ok).toBe(false);});
  it('rejects changed output even when its own hash is repaired',async()=>{const {bundle,expected}=await fixture();bundle.outputFiles=[{...bundle.outputFiles[0]!,text:'edited',sha256:await sha256Text('edited')}];expect((await validateRecordingBundle(bundle,expected)).ok).toBe(false);});
  it('missing/rejected bundle yields not_run',async()=>{const {bundle,expected}=await fixture();expect((await loadRecordedOutcome(null,expected)).status).toBe('not_run');expect((await loadRecordedOutcome({...bundle,exitStatus:1},expected)).status).toBe('not_run');});
  it('never emits hash metadata or key labels in Outcome',async()=>{const {bundle,expected}=await fixture();const row=await loadRecordedOutcome(bundle,expected);expect(row.status).toBe('recorded');if(row.status==='recorded') expect(canonicalJson(row.outcome)).not.toContain('synthetic-key1');});
  it('maps raw dispositions without merging delivery classes',()=>{expect(mapBatfishDisposition('ACCEPTED')).toBe('delivered');expect(mapBatfishDisposition('DELIVERED_TO_SUBNET')).toBe('delivered-to-subnet');expect(mapBatfishDisposition('EXITS_NETWORK')).toBe('exits-network');expect(mapBatfishDisposition('INSUFFICIENT_INFO')).toBe('unsupported');});
  it('normalizes trace dispositions from raw answers and retains every native answer',()=>{
    const raw=JSON.stringify({schema:'raw-recording-v1',answers:[{query:'traceroute',rowId:'f01',answer:{disposition:'DENIED_OUT',native:{steps:['acl']}}}]});
    const rows=normaliseRawAnswers('batfish',raw);
    expect(rows[0]!.disposition).toBe('deny-out');expect(rows[0]!.answer).toContain('steps');
  });
  it('rejects duplicate raw rows rather than silently selecting one',()=>{
    const answer={query:'output',rowId:'n01',answer:{name:'n01.cfg',text:''}};
    expect(()=>normaliseRawAnswers('netconan',JSON.stringify({schema:'raw-recording-v1',answers:[answer,answer]}))).toThrow('invalid-raw-envelope');
  });
  it('rejects raw edits with a stale raw-byte hash',async()=>{const {bundle,expected}=await fixture();bundle.rawAnswers=bundle.rawAnswers+' ';expect((await validateRecordingBundle(bundle,expected)).ok).toBe(false);});
  it('rejects help text replacement with a repaired local hash but different frozen capture',async()=>{const {bundle,expected}=await fixture();bundle.helpOutput='changed';bundle.helpSha256=await sha256Text('changed');expect((await validateRecordingBundle(bundle,expected)).ok).toBe(false);});
});
