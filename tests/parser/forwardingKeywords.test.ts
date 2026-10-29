import { describe, expect, it } from 'vitest';
import { cfg, parseText } from './helpers';
import { parseCase } from '../../src/core/parser';
import { classifyUnknown, matchForwardingKeyword } from '../../src/core/grammar';

const threeFiles = (extra: string) =>
  ['n01', 'n02', 'n03'].map((id, i) => ({
    fileId: id,
    name: `${id}.cfg`,
    text: i === 1 ? cfg(`hostname h-${id}`, extra) : cfg(`hostname h-${id}`),
  }));

describe('forwarding-affecting unknown lines → unsupported stratum (trap P21)', () => {
  it('matches leading tokens case-insensitively and prefers the longest keyword', () => {
    expect(matchForwardingKeyword('router ospf 1')).toBe('router');
    expect(matchForwardingKeyword('IPV6 unicast-routing')).toBe('ipv6');
    expect(matchForwardingKeyword('no ip route 10.0.0.0 255.0.0.0 10.0.0.1')).toBe('no ip route');
    expect(matchForwardingKeyword('ip nat inside')).toBe('ip nat');
    expect(matchForwardingKeyword('logging buffered 16384')).toBeNull();
    expect(matchForwardingKeyword('no ip domain-lookup')).toBeNull();
    expect(matchForwardingKeyword('routerx')).toBeNull();
  });

  it('every unknown line inside an ACL or BGP block is forwarding-affecting', () => {
    expect(classifyUnknown('bgp log-neighbor-changes', 'bgp').forwardingAffecting).toBe(true);
    expect(classifyUnknown('permit tcp any any range 1 2', 'acl').forwardingAffecting).toBe(true);
    expect(classifyUnknown('speed 1000', 'interface').forwardingAffecting).toBe(false);
  });

  it.each([
    'router ospf 1',
    'ip route 10.0.0.0 255.0.0.0 GigabitEthernet0/0',
    'ipv6 route ::/0 2001:db8::1',
    'ip nat inside source list 1 interface GigabitEthernet0/0 overload',
    'route-map RM permit 10',
    'interface Tunnel0',
    'ip default-gateway 10.0.0.1',
  ])('a case with `%s` is unsupported', (line) => {
    const r = parseCase({ caseId: 'c1', files: threeFiles(line) });
    expect(r.violations).toEqual([]);
    expect(r.stratum).toBe('unsupported');
  });

  it('a harmless unknown inside an interface block keeps the case semantic-positive', () => {
    const f = parseText(cfg('interface GigabitEthernet0/0', ' speed 1000', ' negotiation auto'));
    expect(f.device.unknownLines.every((u) => !u.forwardingAffecting)).toBe(true);
    const r = parseCase({ caseId: 'c1', files: threeFiles('logging host 192.0.2.9') });
    expect(r.stratum).toBe('semantic-positive');
  });
});
