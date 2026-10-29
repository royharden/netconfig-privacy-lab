import { describe, expect, it } from 'vitest';
import { cfg, kindAt, nodeAt, parseText } from './helpers';
import { parseIPv4 } from '../../src/core/ipv4';

describe('construct: neighbor IP remote-as ASN', () => {
  it('parses the neighbour address and remote ASN with spans', () => {
    const f = parseText(cfg('router bgp 110', ' neighbor 10.22.0.254 remote-as 443'));
    const n = nodeAt(f, 2, 'bgp-remote-as');
    expect(n.neighbor).toEqual({ text: '10.22.0.254', start: 10, end: 21 });
    expect(n.asn).toEqual({ text: '443', start: 32, end: 35 });
    expect(f.device.bgp?.neighbors).toEqual([
      { address: parseIPv4('10.22.0.254'), remoteAs: '443', hasDescription: false, lineOrdinal: 2 },
    ]);
  });

  it('outside a BGP block the line is unknown and forwarding-affecting', () => {
    const f = parseText(cfg('neighbor 10.0.0.1 remote-as 65000'));
    expect(kindAt(f, 1)).toBe('unknown');
    expect(f.device.unknownLines[0]?.keyword).toBe('neighbor');
  });

  it('rejects malformed neighbour lines', () => {
    for (const bad of [' neighbor 10.0.0.256 remote-as 1', ' neighbor 10.0.0.1 remote-as', ' neighbor 10.0.0.1 remote-as 1 extra']) {
      expect(kindAt(parseText(cfg('router bgp 1', bad)), 2)).toBe('unknown');
    }
  });
});
