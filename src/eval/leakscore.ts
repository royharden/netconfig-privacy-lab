import type { CaseInput, Outcome } from '../strategies/types';
import type { Ledger, LedgerClass, LedgerOccurrence, Variant } from '../core/ledger';
import { LEDGER_CLASSES, VARIANTS } from '../core/ledger';
import type { CaseLabels } from '../core/labels';
import { splitLines } from '../core/types';
import { parseLines } from '../core/parser';

export interface Count { numerator: number; denominator: number; value: number | null; reason?: string }
export function count(numerator: number, denominator: number): Count { return { numerator, denominator, value: denominator ? numerator / denominator : null, ...(denominator ? {} : { reason: 'no-support' }) }; }
export interface LeakClassScore { class: LedgerClass; entities: Count; occurrences: Count; anyLocation: Count; ambiguousNumeric: Count; variants: Record<Variant, Count> }
const escaped = (s: string): string => Array.from(s, c => ('.*+?^$()[]{}|'.includes(c) || c.charCodeAt(0)===92) ? String.fromCharCode(92)+c : c).join('');
const numeric = (c: LedgerClass): boolean => c === 'ipv4' || c === 'asn';

/** No fuzzy dictionary or oracle input. Variant matching follows the declared planting protocol. */
export function survives(text: string, value: string, variant: Variant, cls: LedgerClass): boolean {
  if (variant === 'split') return text.includes(value); // Ledger text contains precisely the planted one-space split.
  if (variant === 'dotted' || variant === 'dashed') {
    const normal = (s: string): string => s.replace(/[.:-]/g, '').toLowerCase();
    return normal(text).includes(normal(value));
  }
  const flags = numeric(cls) ? '' : 'i';
  if (variant === 'embedded') return new RegExp(escaped(value), flags).test(text);
  return new RegExp(`(?<![A-Za-z0-9_])${escaped(value)}(?![A-Za-z0-9_])`, flags).test(text);
}

function occurrenceText(files: CaseInput['files'], occurrence: LedgerOccurrence): string {
  const file = files.find(f => f.fileId === occurrence.fileId);
  return !file ? '' : occurrence.location === 'name' ? file.name : splitLines(file.text)[occurrence.ordinal - 1]?.text ?? '';
}
function sensitiveNumericContext(line: string, cls: LedgerClass): string {
  const top = parseLines(line.trimStart())[0]?.node;
  const bgp = parseLines(`router bgp 1\n ${line.trim()}\n`)[1]?.node;
  const iface = parseLines(`interface GigabitEthernet0/0\n ${line.trim()}\n`)[1]?.node;
  const acl = parseLines(`ip access-list extended A\n ${line.trim()}\n`)[1]?.node;
  const node = top?.kind !== 'unknown' ? top : bgp?.kind !== 'unknown' ? bgp : iface?.kind !== 'unknown' ? iface : acl;
  if (!node) return '';
  if (cls === 'asn') {
    if (node.kind === 'bgp-router' || node.kind === 'bgp-remote-as') return node.asn.text;
  } else {
    switch (node.kind) {
      case 'if-address': return node.address.text;
      case 'static-route': return `${node.prefix.text} ${node.nextHop.text}`;
      case 'bgp-remote-as': return node.neighbor.text;
      case 'bgp-description': return `${node.neighbor.text} ${node.text.text}`;
      case 'acl-entry': return [node.src,node.dst].flatMap(s=>s.type==='any'?[]:[s.address.text]).join(' ');
      default: break;
    }
  }
  // Only labelled free-text occurrences qualify here; typed mask/port/ACL-number slots do not.
  if (node.kind === 'comment') return node.text?.text ?? '';
  if (node.kind === 'banner-motd' || node.kind === 'if-description' || node.kind === 'bgp-description' || node.kind === 'acl-remark') return node.text.text;
  return '';
}

export function scoreLeaks(ledger: Ledger, outcome: Outcome): LeakClassScore[] {
  return LEDGER_CLASSES.map(cls => {
    const entities = ledger.entities.filter(e => e.class === cls);
    let entityHits = 0, occurrenceHits = 0, total = 0, anyHits = 0, ambiguous = 0;
    const variants = Object.fromEntries(VARIANTS.map(v => [v, { hits: 0, total: 0 }])) as Record<Variant, { hits: number; total: number }>;
    for (const e of entities) {
      let hit = false;
      for (const o of e.occurrences) {
        total++; variants[o.variant].total++;
        const line = occurrenceText(outcome.files, o);
        const originalContext = o.location === 'line' ? line : '';
        const haystack = numeric(cls) ? sensitiveNumericContext(originalContext, cls) : line;
        const survived = survives(haystack, o.text, o.variant, cls);
        if (survived) { hit = true; occurrenceHits++; variants[o.variant].hits++; }
      }
      if (hit) entityHits++;
      const literal = outcome.files.some(f => survives(`${f.name}\n${f.text}`, e.value, 'exact', cls));
      if (literal) anyHits++;
      if (numeric(cls) && literal && !hit) ambiguous++;
    }
    return { class: cls, entities: count(entityHits, entities.length), occurrences: count(occurrenceHits, total), anyLocation: count(anyHits, entities.length), ambiguousNumeric: count(ambiguous, entities.length), variants: Object.fromEntries(VARIANTS.map(v => [v, count(variants[v].hits, variants[v].total)])) as Record<Variant, Count> };
  });
}

export function scoreRetention(labels: CaseLabels, original: CaseInput, outcome: Outcome): { overRedaction: Count; freeTextRetention: Count; finalOctetRetention: Count } {
  const alignments=new Map<string,(number|null)[]>();
  const align=(before:string,after:string):(number|null)[]=>{
    if(before===after)return Array.from({length:before.length},(_,i)=>i);
    const n=before.length,m=after.length,width=m+1,size=(n+1)*width;
    // Pathological single-line inputs fail conservatively rather than exhausting the worker.
    if(size>2_000_000)return Array.from({length:before.length},()=>null);
    const f=new Uint32Array(size),b=new Uint32Array(size),at=(i:number,j:number):number=>i*width+j;
    for(let i=0;i<=n;i++)f[at(i,0)]=i;for(let j=0;j<=m;j++)f[at(0,j)]=j;
    for(let i=1;i<=n;i++)for(let j=1;j<=m;j++)f[at(i,j)]=Math.min(f[at(i-1,j)]!+1,f[at(i,j-1)]!+1,f[at(i-1,j-1)]!+(before[i-1]===after[j-1]?0:1));
    for(let i=0;i<=n;i++)b[at(i,m)]=n-i;for(let j=0;j<=m;j++)b[at(n,j)]=m-j;
    for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)b[at(i,j)]=Math.min(b[at(i+1,j)]!+1,b[at(i,j+1)]!+1,b[at(i+1,j+1)]!+(before[i]===after[j]?0:1));
    const distance=f[at(n,m)]!,mapping:(number|null)[]=[];
    for(let i=0;i<n;i++){
      const matches=new Set<number>();let changed=false;
      for(let j=0;j<=m;j++){
        if(f[at(i,j)]!+1+b[at(i+1,j)]! === distance)changed=true;
        if(j<m&&f[at(i,j)]!+(before[i]===after[j]?0:1)+b[at(i+1,j+1)]! === distance){if(before[i]===after[j])matches.add(j);else changed=true;}
      }
      mapping.push(!changed&&matches.size===1?[...matches][0]!:null);
    }
    return mapping;
  };
  const kept = (span: { fileId: string; ordinal: number; start:number; end:number; text: string }): boolean => {
    const f = outcome.files.find(x => x.fileId === span.fileId);
    const before=splitLines(original.files.find(x=>x.fileId===span.fileId)?.text??'')[span.ordinal-1]?.text??'',after=splitLines(f?.text??'')[span.ordinal-1]?.text??'';
    if(before.slice(span.start,span.end)!==span.text)return false;
    const key=`${span.fileId}/${span.ordinal}`;let mapping=alignments.get(key);if(!mapping){mapping=align(before,after);alignments.set(key,mapping);}
    const start=mapping[span.start];if(start===null||start===undefined)return false;
    return Array.from({length:span.end-span.start},(_,i)=>mapping[span.start+i]===start+i).every(Boolean)&&after.slice(start,start+span.text.length)===span.text;
  };
  let octets = 0, same = 0;
  for (const f of original.files) {
    const before = parseLines(f.text), after = parseLines(outcome.files.find(x => x.fileId === f.fileId)?.text ?? '');
    for (const l of before) if (l.node.kind === 'if-address') {
      octets++;
      const n = after[l.ordinal - 1]?.node;
      if (n?.kind === 'if-address' && (n.addressValue & 255) === (l.node.addressValue & 255)) same++;
    }
  }
  return { overRedaction: count(labels.benignSpans.filter(s => !kept(s)).length, labels.benignSpans.length), freeTextRetention: count(labels.freeTextTokens.filter(kept).length, labels.freeTextTokens.length), finalOctetRetention: count(same, octets) };
}
