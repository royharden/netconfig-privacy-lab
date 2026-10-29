import { describe, expect, it } from 'vitest';
import { cfg, kindAt, nodeAt, parseText, spanText } from './helpers';

describe('construct: neighbor IP description TEXT', () => {
  it('parses the neighbour and the free-text description span', () => {
    const f = parseText(
      cfg('router bgp 64512', ' neighbor 172.40.3.200 remote-as 65020', ' neighbor 172.40.3.200 description Ferrowind transit'),
    );
    const n = nodeAt(f, 3, 'bgp-description');
    expect(spanText(f, 3, n.neighbor)).toBe('172.40.3.200');
    expect(n.text).toEqual({ text: 'Ferrowind transit', start: 35, end: 52 });
    expect(f.device.bgp?.neighbors).toHaveLength(1);
    expect(f.device.bgp?.neighbors[0]?.hasDescription).toBe(true);
  });

  it('an empty neighbour description is unknown (forwarding-affecting inside BGP)', () => {
    const f = parseText(cfg('router bgp 1', ' neighbor 10.0.0.1 description'));
    expect(kindAt(f, 2)).toBe('unknown');
    expect(f.device.unknownLines[0]?.forwardingAffecting).toBe(true);
  });
});
