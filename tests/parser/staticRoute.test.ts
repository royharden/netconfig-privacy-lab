import { describe, expect, it } from 'vitest';
import { cfg, kindAt, nodeAt, parseText, spanText } from './helpers';
import { parseIPv4 } from '../../src/core/ipv4';

describe('construct: ip route', () => {
  it('parses prefix, mask and next hop with spans and values', () => {
    const f = parseText(cfg('ip route 192.0.2.0 255.255.255.0 10.11.255.2'));
    const n = nodeAt(f, 1, 'static-route');
    expect(n.prefix).toEqual({ text: '192.0.2.0', start: 9, end: 18 });
    expect(spanText(f, 1, n.mask)).toBe('255.255.255.0');
    expect(n.nextHop).toEqual({ text: '10.11.255.2', start: 33, end: 44 });
    expect(n.prefixLength).toBe(24);
    expect(f.device.staticRoutes).toEqual([
      { ordinal: 1, lineOrdinal: 1, prefix: parseIPv4('192.0.2.0'), prefixLength: 24, nextHop: parseIPv4('10.11.255.2') },
    ]);
  });

  it('parses the 0.0.0.0 0.0.0.0 default route', () => {
    const n = nodeAt(parseText(cfg('ip route 0.0.0.0 0.0.0.0 10.22.255.1')), 1, 'static-route');
    expect(n.prefixValue).toBe(0);
    expect(n.prefixLength).toBe(0);
  });

  it('rejects a prefix that is not the network base, a non-contiguous mask, and interface/extra-token forms', () => {
    for (const bad of [
      'ip route 192.0.2.1 255.255.255.0 10.0.0.1',
      'ip route 10.0.0.0 255.0.255.0 10.0.0.1',
      'ip route 10.0.0.0 255.0.0.0 GigabitEthernet0/0',
      'ip route 10.0.0.0 255.0.0.0 10.0.0.1 250',
      'ip route 10.0.0.0 255.0.0.0',
    ]) {
      const f = parseText(cfg(bad));
      expect(kindAt(f, 1)).toBe('unknown');
      expect(f.device.unknownLines[0]?.keyword).toBe('ip route');
    }
  });
});
