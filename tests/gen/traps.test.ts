import { describe, it, expect } from 'vitest';
import { generateCase } from '../../src/gen/generator';
import { parseCase } from '../../src/core/parser';
import type { LedgerClass } from '../../src/core/ledger';
const make = () => generateCase({ caseId: 'd01', family: 'dual-isp-edge', deviceCount: 8, seed: 43, stratum: 'semantic-positive' });
describe('named planting traps (P1–P22)', () => {
  const entity = (kind: LedgerClass) => make().ledger.entities.find((e) => e.class === kind)!;
  const benign = (note: string) => make().labels.benignSpans.filter((b) => b.note === note);
  it('plantHostnameInDomainAndDescription', () => {
    const e = entity('hostname'); expect(e.occurrences.some((o) => o.variant === 'embedded')).toBe(true);
    expect(e.occurrences.filter((o) => o.variant === 'exact').length).toBeGreaterThan(1);
  });
  it('plantMixedCaseRepeat', () => expect(entity('hostname').occurrences.some((o) => o.variant === 'case' && o.text === entity('hostname').value.toUpperCase())).toBe(true));
  it('plantEmbeddedName', () => expect(make().files[0].text).toContain(`uplink-${entity('hostname').value}-edge`));
  it('plantIpInFreeText', () => {
    const lines = make().files[0].text.split('\n');
    for (const prefix of [' description ', 'banner motd #Address', '! Contact']) expect(lines.some((l) => l.startsWith(prefix) && l.includes('192.0.2.1'))).toBe(true);
  });
  it('plantIpPrefixText', () => expect(make().files[0].text).toContain('192.0.2.1/24'));
  it('plantSplitIp', () => expect(make().ledger.entities.flatMap((e) => e.occurrences).some((o) => o.variant === 'split' && o.text === '192.0. 2.1')).toBe(true));
  it('plantAsnEqualsAcl', () => { expect(benign('asn-equals-acl')[0].text).toBe('150'); expect(entity('asn').value).toBe('150'); });
  it('plantAsnEqualsPort', () => { expect(benign('asn-equals-port').map((b) => b.text)).toEqual(['443', '443']); expect(make().files[0].text).toContain('remote-as 443'); });
  it('plantCommonWordCommunity', () => expect(entity('community').value).toBe('public'));
  it('plantUsernameEqualsHostname', () => expect(entity('username').value).toBe(entity('hostname').value));
  it('plantOrgInAclName', () => { expect(entity('acl-name').value).toContain(entity('org').value); expect(entity('org').occurrences.every((o) => o.variant === 'embedded')).toBe(true); });
  it('plantUnknownFormatSecret', () => { expect(entity('secret').value).not.toMatch(/^\$/); expect(make().files[0].text).toContain(`secret 5 ${entity('secret').value}`); });
  it('plantEmailInBanner', () => expect(make().files[0].text).toContain(`banner motd #Contact ${entity('email').value}#`));
  it('plantMacAndSerial', () => { expect(entity('mac').occurrences[0].variant).toBe('dotted'); expect(make().files[0].text).toContain(entity('serial').value); });
  it('plantFilenameTrap', () => { expect(make().sidecar.files[0].path).toBe('n01.cfg'); expect(make().sidecar.files[0].name).toBe(`${entity('hostname').value}.cfg`); expect(entity('filename').occurrences[0]).toMatchObject({ location: 'name', ordinal: 0 }); });
  it('plantDefaultRoute', () => { expect(benign('default-route-zero').length).toBeGreaterThan(0); expect(make().ledger.entities.some((e) => e.class === 'ipv4' && e.value === '0.0.0.0')).toBe(false); });
  it('plantMaskLikeAddress', () => expect(benign('mask-like-address').some((b) => b.text === '255.255.255.0')).toBe(true));
  it('plantNetworkBase', () => expect(make().ledger.entities.some((e) => e.class === 'ipv4' && e.value === '192.0.2.0')).toBe(true));
  it('plantHtmlInDescription', () => expect(benign('html-in-description')[0].text).toBe('<script>alert(1)</script>'));
  it('plantBenignSubstring', () => expect(benign('benign-substring')[0].text).toContain(entity('hostname').value));
  it('plantUnsupportedRoutingLine', () => {
    const g = generateCase({ caseId: 'd01', family: 'ring', deviceCount: 3, seed: 43, stratum: 'unsupported' });
    expect(parseCase({ caseId: g.spec.caseId, files: g.files }).stratum).toBe('unsupported'); expect(g.sidecar.flows).toEqual([]);
  });
  it('plantDuplicateInterfaceIp', () => {
    const g = make(), p = parseCase({ caseId: g.spec.caseId, files: g.files });
    const ips = p.files.flatMap((f) => f.device.interfaces.map((i) => i.address?.address));
    expect(ips.length - new Set(ips).size).toBe(1);
    const duplicate = g.ledger.entities.find((e) => e.class === 'ipv4' && /\.249\.1$/.test(e.value))!.value;
    expect(g.sidecar.flows.every((f) => f.src !== duplicate && f.dst !== duplicate)).toBe(true);
    expect(p.files.flatMap((f) => f.lines).some((l) => l.node.kind === 'static-route' && l.node.nextHop.text === duplicate)).toBe(false);
  });
});
