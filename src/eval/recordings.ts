import type { Split, Validated, ConfigFileInput } from '../core/types';
import { ID_PATTERN, SHA256_PATTERN, SPLITS, ShapeChecker, DISPOSITIONS } from '../core/types';
import type { Arm } from '../strategies/types';
import { ARMS, RECORDED_ARMS } from '../strategies/types';
import type { NormalisedRow, RecordingTool } from './normalise';
import { BATFISH_QUERIES, canonicalJson, normaliseRawAnswers, NORMALISER_VERSION } from './normalise';

export interface RecordingFile extends ConfigFileInput { sha256: string }
export interface RecordingQuery { query: string; parametersJson: string }
export interface RecordingBundleV1 {
  schema: 'recording-v1'; tool: RecordingTool; toolVersion: string;
  imageDigest: string | null; packageFileHashes: { path: string; sha256: string }[];
  pybatfishVersion: string | null; versionOutput: string; versionSha256: string; helpOutput: string; helpSha256: string;
  args: string[]; queries: RecordingQuery[]; effectiveOptionsJson: string;
  salt: string; keyId: string; keyScope: 'synthetic-evaluation';
  inputFiles: RecordingFile[]; outputFiles: RecordingFile[];
  rawAnswers: string; rawAnswersSha256: string; normaliserVersion: typeof NORMALISER_VERSION;
  normalisedRows: NormalisedRow[]; exitStatus: number; elapsedMs: number; operatorCallsign: string; date: string;
  caseId: string; arm: Arm; split: Split; candidateCommit: string; recorderSourceSha256: string;
}
export interface RecordingExpectation {
  tool: RecordingTool; caseId: string; arm: Arm; split: Split; keyId: string; keyScope: 'synthetic-evaluation';
  candidateCommit: string; recorderSourceSha256: string; inputFiles: ConfigFileInput[];
  toolVersion: string; imageDigest: string | null; packageFileHashes: { path: string; sha256: string }[];
  pybatfishVersion: string | null; args: string[]; queries: RecordingQuery[]; effectiveOptionsJson: string; salt: string;
  versionSha256: string; helpSha256: string;
}
export async function sha256Text(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** Closed structural reader; no file paths in a bundle are ever followed. */
export function parseRecordingBundle(value: unknown): Validated<RecordingBundleV1> {
  const c = new ShapeChecker();
  const root = c.object(value, '$', ['schema','tool','toolVersion','imageDigest','packageFileHashes','pybatfishVersion',
    'versionOutput','versionSha256','helpOutput','helpSha256','args','queries','effectiveOptionsJson','salt','keyId','keyScope',
    'inputFiles','outputFiles','rawAnswers','rawAnswersSha256','normaliserVersion','normalisedRows','exitStatus','elapsedMs',
    'operatorCallsign','date','caseId','arm','split','candidateCommit','recorderSourceSha256']);
  if (root === null) return c.result(value);
  c.constant(root.schema, '$.schema', 'recording-v1');
  const tool = c.enumValue(root.tool, '$.tool', ['netconan','batfish']);
  for (const field of ['toolVersion','versionOutput','helpOutput','salt','operatorCallsign']) c.string(root[field], `$.${field}`, undefined, 1048576);
  for (const field of ['versionSha256','helpSha256','rawAnswersSha256','recorderSourceSha256']) c.string(root[field], `$.${field}`, SHA256_PATTERN);
  for (const field of ['caseId','keyId']) c.string(root[field], `$.${field}`, ID_PATTERN);
  c.constant(root.keyScope, '$.keyScope', 'synthetic-evaluation');
  c.constant(root.normaliserVersion, '$.normaliserVersion', NORMALISER_VERSION);
  c.string(root.candidateCommit, '$.candidateCommit', /^[0-9a-f]{40}$/);
  const date = c.string(root.date, '$.date', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  if (date !== null && !Number.isFinite(Date.parse(date))) c.fail('$.date', 'invalid date');
  c.enumValue(root.arm, '$.arm', ARMS); c.enumValue(root.split, '$.split', SPLITS);
  c.integer(root.exitStatus, '$.exitStatus', 0, 255); c.integer(root.elapsedMs, '$.elapsedMs', 0, Number.MAX_SAFE_INTEGER);
  if (tool === 'netconan' && !(RECORDED_ARMS as readonly unknown[]).includes(root.arm)) c.fail('$.arm', 'netconan requires a recorded arm');
  if (root.imageDigest !== null) c.string(root.imageDigest, '$.imageDigest', /^sha256:[0-9a-f]{64}$/);
  if (root.pybatfishVersion !== null) c.string(root.pybatfishVersion, '$.pybatfishVersion', /^.+$/);
  if (tool === 'batfish' && (root.imageDigest === null || root.pybatfishVersion === null)) c.fail('$.tool', 'Batfish requires image digest and pybatfish version');
  if (tool === 'netconan' && (root.imageDigest !== null || root.pybatfishVersion !== null)) c.fail('$.tool', 'netconan has no Batfish pins');
  const packages = c.array(root.packageFileHashes, '$.packageFileHashes', tool === 'netconan' ? 1 : 0, 4096) ?? [];
  const packageIds = new Set<string>();
  packages.forEach((entry, i) => { const p = `$.packageFileHashes[${i}]`; const o = c.object(entry,p,['path','sha256']);
    if (o) { c.unique(c.string(o.path,`${p}.path`,/^.+$/),packageIds,`${p}.path`); c.string(o.sha256,`${p}.sha256`,SHA256_PATTERN); } });
  (c.array(root.args,'$.args',0,1024) ?? []).forEach((a,i) => c.string(a,`$.args[${i}]`));
  (c.array(root.queries,'$.queries',0,1024) ?? []).forEach((entry,i) => { const p=`$.queries[${i}]`; const o=c.object(entry,p,['query','parametersJson']);
    if(o) { c.string(o.query,`${p}.query`,/^.+$/); jsonString(o.parametersJson,`${p}.parametersJson`); } });
  function jsonString(v: unknown,p: string): void { const text=c.string(v,p,undefined,16777216); if(text!==null) { try { JSON.parse(text); } catch { c.fail(p,'invalid JSON'); } } }
  jsonString(root.effectiveOptionsJson,'$.effectiveOptionsJson'); jsonString(root.rawAnswers,'$.rawAnswers');
  for (const field of ['inputFiles','outputFiles']) {
    const ids=new Set<string>();
    (c.array(root[field],`$.${field}`,1,8) ?? []).forEach((entry,i) => { const p=`$.${field}[${i}]`; const o=c.object(entry,p,['fileId','name','text','sha256']);
      if(o) { c.unique(c.string(o.fileId,`${p}.fileId`,ID_PATTERN),ids,p); c.string(o.name,`${p}.name`,/^[^/\\\u0000-\u001f\u007f]+$/,255);
        if(o.name==='.' || o.name==='..') c.fail(`${p}.name`,'invalid display name'); c.string(o.text,`${p}.text`,undefined,65536); c.string(o.sha256,`${p}.sha256`,SHA256_PATTERN); } });
  }
  const rowIds=new Set<string>();
  (c.array(root.normalisedRows,'$.normalisedRows',0,100000) ?? []).forEach((entry,i) => { const p=`$.normalisedRows[${i}]`; const o=c.object(entry,p,['query','rowId','disposition','answer']);
    if(o) { c.string(o.query,`${p}.query`,/^.+$/); const id=c.string(o.rowId,`${p}.rowId`,ID_PATTERN); c.unique(`${String(o.query)}:${id}`,rowIds,p);
      if(o.disposition!==null) c.enumValue(o.disposition,`${p}.disposition`,DISPOSITIONS); jsonString(o.answer,`${p}.answer`); } });
  return c.result(value);
}

/** Runtime importer: expected pins come from preregistration/case bytes, never from the bundle itself. */
export async function validateRecordingBundle(value: unknown, expected: RecordingExpectation): Promise<Validated<RecordingBundleV1>> {
  const parsed = parseRecordingBundle(value);
  if (!parsed.ok) return parsed;
  const bundle=parsed.value; const c=new ShapeChecker();
  for(const key of ['tool','caseId','arm','split','keyId','keyScope','candidateCommit','recorderSourceSha256','toolVersion','imageDigest','pybatfishVersion','salt','versionSha256','helpSha256'] as const)
    if(bundle[key]!==expected[key]) c.fail(`$.${key}`,'does not match expected pin');
  for(const key of ['args','queries','packageFileHashes'] as const)
    if(canonicalJson(bundle[key])!==canonicalJson(expected[key])) c.fail(`$.${key}`,'does not match expected pin');
  try { if(canonicalJson(JSON.parse(bundle.effectiveOptionsJson))!==canonicalJson(JSON.parse(expected.effectiveOptionsJson))) c.fail('$.effectiveOptionsJson','does not match expected pin'); }
  catch { c.fail('$.effectiveOptionsJson','invalid expected JSON'); }
  if(bundle.exitStatus!==0) c.fail('$.exitStatus','recording failed');
  for(const [text,hash] of [['versionOutput','versionSha256'],['helpOutput','helpSha256'],['rawAnswers','rawAnswersSha256']] as const)
    if(await sha256Text(bundle[text])!==bundle[hash]) c.fail(`$.${hash}`,'bytes hash mismatch');
  for(const field of ['inputFiles','outputFiles'] as const) for(const [i,file] of bundle[field].entries())
    if(await sha256Text(file.text)!==file.sha256) c.fail(`$.${field}[${i}].sha256`,'bytes hash mismatch');
  if(bundle.inputFiles.length!==expected.inputFiles.length) c.fail('$.inputFiles','input file set mismatch');
  for(const file of expected.inputFiles) { const found=bundle.inputFiles.find((f)=>f.fileId===file.fileId);
    if(!found || found.text!==file.text || found.name!==file.name || found.sha256!==await sha256Text(file.text)) c.fail('$.inputFiles','input identity or bytes mismatch'); }
  if(canonicalJson(bundle.inputFiles.map(f=>f.fileId).sort())!==canonicalJson(bundle.outputFiles.map(f=>f.fileId).sort())) c.fail('$.outputFiles','stable file set mismatch');
  if(bundle.tool==='batfish') {
    if(canonicalJson([...bundle.inputFiles].sort((a,b)=>a.fileId.localeCompare(b.fileId)))!==canonicalJson([...bundle.outputFiles].sort((a,b)=>a.fileId.localeCompare(b.fileId)))) c.fail('$.outputFiles','Batfish observes unchanged input bytes');
    for(const query of BATFISH_QUERIES) if(!bundle.queries.some(q=>q.query===query)) c.fail('$.queries','missing mandatory Batfish query');
  }
  try { const rows=normaliseRawAnswers(bundle.tool,bundle.rawAnswers);
    if(canonicalJson(rows)!==canonicalJson(bundle.normalisedRows)) c.fail('$.normalisedRows','raw re-normalisation mismatch');
    const declared=new Set(bundle.queries.map(q=>q.query));
    if(rows.some(row=>!declared.has(row.query))) c.fail('$.queries','raw answer for undeclared query');
    if([...declared].some(query=>!rows.some(row=>row.query===query))) c.fail('$.rawAnswers','missing declared query answer');
    if(bundle.tool==='batfish') {
      const flowIds=new Set<string>();
      for(const query of bundle.queries.filter(q=>q.query==='traceroute')) {
        const parameters=JSON.parse(query.parametersJson) as Record<string,unknown>;
        if(typeof parameters.flowId!=='string' || !ID_PATTERN.test(parameters.flowId) || parameters.ignoreFilters!==false ||
           typeof parameters.ingressNode!=='string' || typeof parameters.ingressInterface!=='string' ||
           typeof parameters.headers!=='object' || parameters.headers===null) c.fail('$.queries','traceroute requires flow ID, mapped ingress, headers and ignoreFilters=false');
        else { flowIds.add(parameters.flowId); if(!rows.some(row=>row.query==='traceroute'&&row.rowId===parameters.flowId)) c.fail('$.rawAnswers','missing scheduled traceroute answer'); }
      }
      if(rows.some(row=>row.query==='traceroute'&&!flowIds.has(row.rowId))) c.fail('$.rawAnswers','unscheduled traceroute row');
    }
    if(bundle.tool==='netconan') {
      for(const file of bundle.outputFiles) { const row=rows.find(r=>r.query==='output'&&r.rowId===file.fileId);
        if(!row || row.answer!==canonicalJson({name:file.name,text:file.text})) c.fail('$.outputFiles','raw output mismatch'); }
      if(rows.length!==bundle.outputFiles.length) c.fail('$.outputFiles','raw output set mismatch');
    }
  } catch { c.fail('$.rawAnswers','invalid raw answer envelope'); }
  return c.result(bundle);
}
