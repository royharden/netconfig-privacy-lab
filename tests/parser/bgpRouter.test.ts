import { describe, expect, it } from 'vitest';
import { cfg, kindAt, lineAt, nodeAt, parseText } from './helpers';

describe('construct: router bgp ASN', () => {
  it('parses the ASN token and opens a BGP block', () => {
    const f = parseText(cfg('router bgp 64512', ' neighbor 172.40.3.200 remote-as 65020', '!'));
    expect(nodeAt(f, 1, 'bgp-router').asn).toEqual({ text: '64512', start: 11, end: 16 });
    expect(lineAt(f, 2).block).toBe('bgp');
    expect(f.device.bgp?.asn).toBe('64512');
  });

  it('admits any decimal ASN token, including values outside the lab pools (row 14)', () => {
    for (const asn of ['0', '110', '23456', '65535', '4294967295']) {
      expect(parseText(cfg(`router bgp ${asn}`)).device.bgp?.asn).toBe(asn);
    }
  });

  it('rejects asdot, leading zeros, values above 2^32-1 and other routing protocols', () => {
    for (const bad of ['router bgp 1.10', 'router bgp 0110', 'router bgp 4294967296', 'router ospf 1', 'router bgp']) {
      const f = parseText(cfg(bad));
      expect(kindAt(f, 1)).toBe('unknown');
      expect(f.device.unknownLines[0]?.keyword).toBe('router');
    }
  });

  it('every unknown sub-command in a BGP block is forwarding-affecting', () => {
    const f = parseText(cfg('router bgp 64512', ' network 10.0.0.0 mask 255.0.0.0', ' bgp log-neighbor-changes'));
    expect(f.device.unknownLines.map((u) => u.forwardingAffecting)).toEqual([true, true]);
  });
});
