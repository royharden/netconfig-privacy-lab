import { describe, expect, it } from 'vitest';
import { cfg, kindAt, lineAt, nodeAt, parseText } from './helpers';

describe('construct: interface GigabitEthernetN/N', () => {
  it('opens an interface block and assigns 1-based source ordinals', () => {
    const f = parseText(
      cfg('interface GigabitEthernet0/0', ' no shutdown', '!', 'interface GigabitEthernet0/1', ' shutdown'),
    );
    expect(nodeAt(f, 1, 'interface').name.text).toBe('GigabitEthernet0/0');
    expect(lineAt(f, 2).block).toBe('interface');
    expect(f.device.interfaces.map((i) => [i.name, i.ordinal, i.lineOrdinal])).toEqual([
      ['GigabitEthernet0/0', 1, 1],
      ['GigabitEthernet0/1', 2, 4],
    ]);
  });

  it('a non-indented line closes the block', () => {
    const f = parseText(cfg('interface GigabitEthernet0/0', 'hostname r1', ' shutdown'));
    expect(kindAt(f, 2)).toBe('hostname');
    expect(kindAt(f, 3)).toBe('unknown');
    expect(f.device.interfaces[0]?.shutdown).toBe(false);
  });

  it('other interface types are unknown and forwarding-affecting, and so are their sub-lines', () => {
    const f = parseText(cfg('interface Loopback0', ' ip address 10.0.0.1 255.255.255.255'));
    const header = nodeAt(f, 1, 'unknown');
    expect(header.forwardingAffecting).toBe(true);
    expect(lineAt(f, 2).block).toBe('unknown-block');
    expect(nodeAt(f, 2, 'unknown').forwardingAffecting).toBe(true);
    expect(f.device.interfaces).toHaveLength(0);
  });

  it('rejects malformed GigabitEthernet names', () => {
    for (const bad of ['interface GigabitEthernet0', 'interface GigabitEthernet0/0/1', 'interface gigabitethernet0/0']) {
      expect(kindAt(parseText(cfg(bad)), 1)).toBe('unknown');
    }
  });
});
