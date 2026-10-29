import { commonPrefixLength,formatIPv4 } from '../core/ipv4';
import { count } from './leakscore';
import { parseCase } from '../core/parser';
import { inSubnet, isNetworkOrBroadcast } from '../core/ipv4';
import type { CaseInput } from '../strategies/types';
export interface AddressPair { original: number; output: number }
/** Full host addresses only: canonicalised prefix bases do not disclose all 32 transformed bits. */
export function probeAddressStrings(input:CaseInput):string[]{
  const parsed=parseCase(input);if(parsed.violations.length)throw new Error('probe-config-caps');
  const addresses=new Set<number>(),add=(value:number):void=>{if(value!==0)addresses.add(value);};
  for(const file of parsed.files)for(const {node} of file.lines)switch(node.kind){
    case 'if-address':add(node.addressValue);break;
    case 'static-route':add(node.nextHopValue);break;
    case 'acl-entry':if(node.src.type==='host')add(node.src.value);if(node.dst.type==='host')add(node.dst.value);break;
    case 'bgp-remote-as':case 'bgp-description':add(node.neighborValue);break;
    default:break;
  }
  return [...addresses].map(formatIPv4);
}
/** Pair choices are frozen separately; this port receives only the preregistered public pairs, never a key or ledger. */
export function knownPrefixProbe(targets: AddressPair[], known: AddressPair[], disclosedBits = 0, prefixPreserving = true): { meanBits: number | null; full24: ReturnType<typeof count>; valid:boolean } {
  if (known.length > 2 || disclosedBits < 0 || disclosedBits > 32) throw new Error('invalid-probe-a');
  let bits = 0, full = 0;
  for (const target of targets) {
    let inferred = disclosedBits;
    for (const pair of prefixPreserving?known:[]) {
      const common = commonPrefixLength(target.output, pair.output);
      if(common!==commonPrefixLength(target.original,pair.original))return {meanBits:null,full24:count(0,0),valid:false};
      // Prefix-preserving threat model: first differing bit is also implied, unless identical.
      inferred = Math.max(inferred, Math.min(32, common + 1));
    }
    bits += Math.max(0, inferred - disclosedBits);
    if (inferred >= 24) full++;
  }
  return { meanBits: targets.length ? bits / targets.length : null, full24: count(full, targets.length),valid:true };
}
export interface Fingerprint { degreeSequence: number[]; prefixLengths: number[] }
export function caseFingerprint(input: CaseInput): Fingerprint {
  const files=parseCase(input).files;
  const active=files.map(f=>f.device.interfaces.filter(i=>i.address&&!i.shutdown&&!isNetworkOrBroadcast(i.address.address,i.address.prefixLength)));
  const degreeSequence=active.map((ifs,i)=>active.reduce((degree,others,j)=>degree+(i!==j&&ifs.some(a=>others.some(b=>a.address&&b.address&&a.address.prefixLength===b.address.prefixLength&&inSubnet(a.address.address,b.address.address,b.address.prefixLength)))?1:0),0));
  const prefixLengths=files.flatMap(f=>[...f.device.interfaces.flatMap(i=>i.address?[i.address.prefixLength]:[]),...f.device.staticRoutes.map(r=>r.prefixLength)]);
  return {degreeSequence,prefixLengths};
}
export function fingerprintKey(f: Fingerprint): string { return JSON.stringify([f.degreeSequence.slice().sort((a,b) => a-b), f.prefixLengths.slice().sort((a,b) => a-b)]); }
/** Equal candidates occupy ranks 1..m: reciprocal rank is averaged over every tied rank. */
export function fingerprintProbe(observed: Fingerprint, candidates: { id: string; fingerprint: Fingerprint }[], trueId: string): { candidateSetSize: number; unique: boolean; reciprocalRank: number } {
  const matches = candidates.filter(c => fingerprintKey(c.fingerprint) === fingerprintKey(observed));
  const contains = matches.some(c => c.id === trueId);
  let reciprocalRank = 0;
  if (contains) for (let rank = 1; rank <= matches.length; rank++) reciprocalRank += 1 / rank / matches.length;
  return { candidateSetSize: matches.length, unique: contains && matches.length === 1, reciprocalRank };
}
