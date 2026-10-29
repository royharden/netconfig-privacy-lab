import { describe, expect, it } from 'vitest';
import { cfg, kindAt, parseText } from './helpers';

describe('construct: shutdown', () => {
  it('marks the interface shut', () => {
    const f = parseText(cfg('interface GigabitEthernet0/2', ' ip address 10.11.255.10 255.255.255.252', ' shutdown'));
    expect(kindAt(f, 3)).toBe('if-shutdown');
    expect(f.device.interfaces[0]?.shutdown).toBe(true);
  });

  it('only marks the interface it belongs to', () => {
    const f = parseText(cfg('interface GigabitEthernet0/0', ' shutdown', '!', 'interface GigabitEthernet0/1'));
    expect(f.device.interfaces.map((i) => i.shutdown)).toEqual([true, false]);
  });

  it('a shutdown with extra tokens is an unknown, forwarding-affecting line', () => {
    const f = parseText(cfg('interface GigabitEthernet0/0', ' shutdown now'));
    expect(kindAt(f, 2)).toBe('unknown');
    expect(f.device.unknownLines[0]?.forwardingAffecting).toBe(true);
  });
});
