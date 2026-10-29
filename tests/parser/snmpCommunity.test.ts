import { describe, expect, it } from 'vitest';
import { cfg, kindAt, nodeAt, parseText } from './helpers';

describe('construct: snmp-server community STR RO|RW', () => {
  it('parses community string spans and access', () => {
    const f = parseText(cfg('snmp-server community heron RO', 'snmp-server community tillmoor-ro RW'));
    expect(nodeAt(f, 1, 'snmp-community').community).toEqual({ text: 'heron', start: 22, end: 27 });
    expect(nodeAt(f, 2, 'snmp-community').access).toBe('RW');
    expect(f.device.snmpCommunities.map((c) => [c.community, c.access, c.lineOrdinal])).toEqual([
      ['heron', 'RO', 1],
      ['tillmoor-ro', 'RW', 2],
    ]);
  });

  it('rejects other access words and extra tokens', () => {
    for (const bad of ['snmp-server community x ro', 'snmp-server community x RO 10', 'snmp-server community x']) {
      expect(kindAt(parseText(cfg(bad)), 1)).toBe('unknown');
    }
  });
});
