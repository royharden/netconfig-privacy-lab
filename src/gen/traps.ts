/** Each planting trap has its own function and a named regression in tests/gen/traps.test.ts. */
import type { LedgerEntity } from '../core/ledger';
import { benign, concat, ident, word, wrap } from './text';
import type { ConfigText, CorpusText, Piece } from './text';
export function plantHostnameInDomainAndDescription(f: ConfigText, host: LedgerEntity, domain: LedgerEntity): void {
  f.add('ip domain-name ', wrap(domain, concat(ident(host, host.value, 'embedded'), '.example')));
}
export function plantMixedCaseRepeat(host: LedgerEntity): Piece { return ident(host, host.value.toUpperCase(), 'case'); }
export function plantEmbeddedName(host: LedgerEntity): Piece { return concat('uplink-', ident(host, host.value, 'embedded'), '-edge'); }
export function plantIpInFreeText(ip: LedgerEntity): Piece { return ident(ip); }
export function plantIpPrefixText(ip: LedgerEntity): Piece { return concat(ident(ip), '/24'); }
export function plantSplitIp(ip: LedgerEntity): Piece {
  const parts = ip.value.split('.'); return ident(ip, `${parts[0]}.${parts[1]}. ${parts[2]}.${parts[3]}`, 'split');
}
export function plantAsnEqualsAcl(f: ConfigText, asn: LedgerEntity): void {
  f.add('access-list ', benign(asn.value, 'asn-equals-acl'), ' permit ip any any');
}
export function plantAsnEqualsPort(asn: LedgerEntity): Piece { return benign(asn.value, 'asn-equals-port'); }
export function plantCommonWordCommunity(f: ConfigText, community: LedgerEntity): void { f.add('snmp-server community ', ident(community), ' RO'); }
export function plantUsernameEqualsHostname(f: ConfigText, corpus: CorpusText, host: LedgerEntity, secret: LedgerEntity): void {
  f.add('username ', ident(corpus.entity('username', host.value)), ' secret 5 ', ident(secret));
}
export function plantOrgInAclName(acl: LedgerEntity, org: LedgerEntity): Piece { return wrap(acl, concat(ident(org, org.value, 'embedded'), '-EDGE-IN')); }
export function plantUnknownFormatSecret(corpus: CorpusText): LedgerEntity { return corpus.entity('secret', 'opaqueUnrecognisedHashToken'); }
export function plantEmailInBanner(f: ConfigText, corpus: CorpusText, host: LedgerEntity, domain: LedgerEntity): void {
  const email = corpus.entity('email', `noc@${domain.value}`);
  f.add('banner motd #', word('Contact'), ' ', wrap(email, concat('noc@', wrap(domain,
    concat(ident(host, host.value, 'embedded'), '.example')))), '#');
}
export function plantMacAndSerial(corpus: CorpusText): Piece {
  return concat(ident(corpus.entity('mac', '02:ab:cd:ef:12:34'), '02ab.cdef.1234', 'dotted'), ' ',
    ident(corpus.entity('serial', 'SYNTH-ZQKJ-ABCD')));
}
export function plantFilenameTrap(f: ConfigText, corpus: CorpusText, host: LedgerEntity): void {
  f.rename(concat(ident(corpus.entity('filename', host.value)), '.cfg'));
}
export function plantDefaultRoute(f: ConfigText, nextHop: LedgerEntity): void {
  f.add('ip route ', benign('0.0.0.0', 'default-route-zero'), ' ', benign('0.0.0.0', 'default-route-zero'), ' ', ident(nextHop));
}
export function plantMaskLikeAddress(mask: string): Piece { return benign(mask, 'mask-like-address'); }
export function plantNetworkBase(prefix: LedgerEntity): Piece { return ident(prefix); }
export function plantHtmlInDescription(): Piece { return benign('<script>alert(1)</script>', 'html-in-description'); }
export function plantBenignSubstring(host: LedgerEntity): Piece { return benign(`${host.value}ch`, 'benign-substring'); }
export function plantUnsupportedRoutingLine(f: ConfigText): void { f.add('router ospf 1'); }
export function plantDuplicateInterfaceIp(f: ConfigText, ip: LedgerEntity, ordinal: number): void {
  f.add(`interface GigabitEthernet0/${ordinal}`);
  f.add(' ip address ', ident(ip), ' ', plantMaskLikeAddress('255.255.255.252'));
  // Isolated spare: no routes or flows use this interface or subnet.
  f.add('!');
}
