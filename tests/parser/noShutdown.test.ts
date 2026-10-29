import { describe, expect, it } from 'vitest';
import { cfg, kindAt, parseText } from './helpers';

describe('construct: no shutdown', () => {
  it('parses `no shutdown` and leaves the interface active', () => {
    const f = parseText(cfg('interface GigabitEthernet0/0', ' no shutdown'));
    expect(kindAt(f, 2)).toBe('if-no-shutdown');
    expect(f.device.interfaces[0]?.shutdown).toBe(false);
  });

  it('a later `no shutdown` re-enables a shut interface (last statement wins)', () => {
    const f = parseText(cfg('interface GigabitEthernet0/0', ' shutdown', ' no shutdown'));
    expect(f.device.interfaces[0]?.shutdown).toBe(false);
  });

  it('`no shutdown` outside an interface block is unknown and forwarding-affecting', () => {
    const f = parseText(cfg('no shutdown'));
    expect(kindAt(f, 1)).toBe('unknown');
    expect(f.device.unknownLines[0]).toEqual({ lineOrdinal: 1, forwardingAffecting: true, keyword: 'no shutdown' });
  });
});
