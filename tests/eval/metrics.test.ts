import { expect, it } from 'vitest';
import { count, survives, scoreLeaks, scoreRetention } from '../../src/eval/leakscore';
import type { Outcome } from '../../src/strategies/types';
import type { Ledger } from '../../src/core/ledger';
import { pairedBootstrap } from '../../src/eval/bootstrap';
import { fingerprintProbe, knownPrefixProbe,probeAddressStrings } from '../../src/eval/probes';
import { emptyReport } from '../../src/eval/results';
it('zero support is N/A',()=>expect(count(0,0).value).toBeNull());
it('variant rules distinguish exact from embedded and preserve split space',()=>{
 expect(survives('XalphaY','alpha','exact','hostname')).toBe(false);
 expect(survives('XalphaY','alpha','embedded','hostname')).toBe(true);
 expect(survives('ALPHA','alpha','case','hostname')).toBe(true);
 expect(survives('10.1. 2.3','10.1. 2.3','split','ipv4')).toBe(true);
 expect(survives('10.1.2.3','10.1. 2.3','split','ipv4')).toBe(false);
 expect(survives('00-aa-bb-cc-dd-ee','00:aa:bb:cc:dd:ee','dashed','mac')).toBe(true);
 expect(survives('00.aabb.ccdd.ee','00:aa:bb:cc:dd:ee','dotted','mac')).toBe(true);
});
it('paired bootstrap deterministic and rejects mispaired families',()=>{
 const a=[{caseId:'c1',family:'ring' as const,numerator:1,denominator:2}];
 expect(pairedBootstrap(a,a,43)).toEqual({low:0,high:0,resamples:2000,seed:43});
 expect(()=>pairedBootstrap(a,[],43)).toThrow();
});
it('fingerprint ties use mean reciprocal rank',()=>{
 const fingerprint={degreeSequence:[1,2,1],prefixLengths:[24,30]};
 expect(fingerprintProbe(fingerprint,[{id:'a',fingerprint},{id:'b',fingerprint}],'a')).toEqual({candidateSetSize:2,unique:false,reciprocalRank:.75});
});
it('known prefix probe has zero extra information with no pairs',()=>expect(knownPrefixProbe([{original:1,output:2}],[]).meanBits).toBe(0));
it('missing evidence rows remain not_run',()=>expect(emptyReport('gates-pending').rows.every(r=>r.status==='not_run'&&!r.utility)).toBe(true));
it('literal known-prefix k1/k2 and identity disclosure controls',()=>{
 const target={original:0x0a010203,output:0xc0010203},one={original:0x0a010204,output:0xc0010204},two={original:0x0a010202,output:0xc0010202};
 expect(knownPrefixProbe([target],[one]).meanBits).toBe(30);
 expect(knownPrefixProbe([target],[one,two]).meanBits).toBe(32);
 expect(knownPrefixProbe([target],[],32).full24.value).toBe(1);
 expect(knownPrefixProbe([target],[{original:one.original,output:1}]).valid).toBe(false);
 expect(knownPrefixProbe([target],[one],0,false).meanBits).toBe(0);
});
it('numeric ASN role excludes equal ACL and port literals but reports ambiguous support',()=>{
 const ledger:Ledger={schema:'ledger-v1',caseId:'c',entities:[{entityId:'e',class:'asn',value:'110',occurrences:[{fileId:'n',location:'line',ordinal:1,start:11,end:14,text:'110',variant:'exact'}]}]};
 const out:Outcome={caseId:'c',arm:'lab-scrub',status:'ok',files:[{fileId:'n',name:'n.cfg',text:'router bgp 120\naccess-list 110 permit tcp any any eq 110\n'}],diagnostics:[]};
 const score=scoreLeaks(ledger,out).find(c=>c.class==='asn')!;expect(score.entities.value).toBe(0);expect(score.anyLocation.value).toBe(1);expect(score.ambiguousNumeric.value).toBe(1);
});
it('retention uses the labelled occurrence, never a repeated token elsewhere on the line',()=>{
 const input={caseId:'c',files:[{fileId:'n',name:'n.cfg',text:'! keep keep\n'}]},out:Outcome={...input,arm:'lab-scrub',status:'ok',diagnostics:[],files:[{...input.files[0]!,text:'! gone keep\n'}]};
 const labels={schema:'labels-v1' as const,caseId:'c',benignSpans:[{id:'b',fileId:'n',ordinal:1,start:2,end:6,text:'keep',note:'repeat'}],freeTextTokens:[{fileId:'n',ordinal:1,start:2,end:6,text:'keep'}]};
 expect(scoreRetention(labels,input,out).overRedaction.value).toBe(1);expect(scoreRetention(labels,input,out).freeTextRetention.value).toBe(0);
});
it('retention follows an unchanged labelled occurrence after a longer preceding pseudonym',()=>{
 const input={caseId:'c',files:[{fileId:'n',name:'n.cfg',text:'! alpha keep\n'}]},out:Outcome={...input,arm:'lab-scrub',status:'ok',diagnostics:[],files:[{...input.files[0]!,text:'! pseudonym keep\n'}]};
 // Original keep is [8,12); its unique unchanged output span is [12,16).
 // Literal counts assert the authored occurrence survives the preceding length change.
 const labels={schema:'labels-v1' as const,caseId:'c',benignSpans:[{id:'b',fileId:'n',ordinal:1,start:8,end:12,text:'keep',note:'preceding replacement grows'}],freeTextTokens:[{fileId:'n',ordinal:1,start:8,end:12,text:'keep'}]};
 const score=scoreRetention(labels,input,out);
 expect(score.overRedaction).toEqual({numerator:0,denominator:1,value:0});
 expect(score.freeTextRetention).toEqual({numerator:1,denominator:1,value:1});
});
it('stratified case-cluster bootstrap recomputes unequal ratios from sampled counts',()=>{
 const a=[{caseId:'r1',family:'ring' as const,numerator:1,denominator:1},{caseId:'r2',family:'ring' as const,numerator:0,denominator:9},{caseId:'h1',family:'hub-and-spoke' as const,numerator:3,denominator:3}],b=a.map(c=>({...c,numerator:0}));
 const result=pairedBootstrap(a,b,43);expect(result.low).toBeGreaterThanOrEqual(0);expect(result.high).toBeLessThanOrEqual(1);expect(result.low).not.toBe(result.high);expect(pairedBootstrap(a,b,43)).toEqual(result);
});
it('known-pair selection excludes canonical prefix bases and typed constants',()=>{
 const input={caseId:'c',files:Array.from({length:3},(_,i)=>({fileId:`n${i}`,name:`n${i}.cfg`,text:`hostname node${i}\ninterface GigabitEthernet0/0\n ip address 10.0.${i}.1 255.255.255.0\n!\nip route 198.51.100.0 255.255.255.0 10.0.${i}.2\naccess-list 110 permit ip 192.0.2.0 0.0.0.255 host 203.0.113.9\nend\n`}))};
 const selected=probeAddressStrings(input);expect(selected).toContain('10.0.0.2');expect(selected).toContain('203.0.113.9');expect(selected).not.toContain('198.51.100.0');expect(selected).not.toContain('192.0.2.0');expect(selected).not.toContain('255.255.255.0');
});
