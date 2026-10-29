import { describe, expect, it } from 'vitest';
import { cfg, kindAt, nodeAt, parseText, spanText } from './helpers';
import { parseIPv4 } from '../../src/core/ipv4';

describe('construct: interface ip address', () => {
  it('parses address and contiguous mask with spans and values', () => {
    const f = parseText(cfg('interface GigabitEthernet0/0', ' ip address 10.11.1.1 255.255.255.0'));
    const n = nodeAt(f, 2, 'if-address');
    expect(n.address).toEqual({ text: '10.11.1.1', start: 12, end: 21 });
    expect(spanText(f, 2, n.mask)).toBe('255.255.255.0');
    expect(n.addressValue).toBe(parseIPv4('10.11.1.1'));
    expect(n.prefixLength).toBe(24);
    expect(f.device.interfaces[0]?.address).toEqual({ address: n.addressValue, prefixLength: 24, lineOrdinal: 2 });
  });

  it('rejects non-contiguous masks, /0, bad octets and extra tokens', () => {
    for (const bad of [
      ' ip address 10.0.0.1 255.0.255.0',
      ' ip address 10.0.0.1 0.0.0.0',
      ' ip address 10.0.0.256 255.255.255.0',
      ' ip address 010.0.0.1 255.255.255.0',
      ' ip address 10.0.0.1 255.255.255.0 secondary',
    ]) {
      const f = parseText(cfg('interface GigabitEthernet0/0', bad));
      expect(kindAt(f, 2)).toBe('unknown');
      expect(f.device.unknownLines[0]?.forwardingAffecting).toBe(true);
    }
  });

  it('flags a network or broadcast host address with invalid-host-address (row 7)', () => {
    const f = parseText(cfg('interface GigabitEthernet0/0', ' ip address 10.0.0.0 255.255.255.0'));
    expect(f.device.diagnostics).toContainEqual({ code: 'invalid-host-address', lineOrdinal: 2 });
    const g = parseText(cfg('interface GigabitEthernet0/0', ' ip address 10.0.0.3 255.255.255.252'));
    expect(g.device.diagnostics).toContainEqual({ code: 'invalid-host-address', lineOrdinal: 2 });
  });
});
