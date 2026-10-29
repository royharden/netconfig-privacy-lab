import { describe, expect, it } from 'vitest';
import { cfg, nodeAt, parseText } from './helpers';

// Trap E1 (parser side): an ACL written for inbound traffic but applied `out` is parsed exactly as written. The parser never
// "corrects" a direction; the evaluator (M4) is what shows the consequence.
describe('wrong-direction ACL is parsed as written', () => {
  it('keeps `out` on an ACL whose entries only make sense inbound', () => {
    const f = parseText(
      cfg(
        'interface GigabitEthernet0/1',
        ' description uplink from ISP',
        ' ip address 203.0.113.2 255.255.255.252',
        ' ip access-group FROM-ISP out',
        '!',
        'ip access-list extended FROM-ISP',
        ' permit tcp any host 10.33.1.10 eq 443',
        ' deny ip any any',
      ),
    );
    expect(nodeAt(f, 4, 'if-access-group').direction).toBe('out');
    expect(f.device.interfaces[0]?.accessGroups).toEqual([{ aclName: 'FROM-ISP', direction: 'out', lineOrdinal: 4 }]);
    expect(f.device.acls[0]?.entries.map((e) => e.action)).toEqual(['permit', 'deny']);
    expect(f.device.diagnostics).toEqual([]);
  });

  it('keeps both directions when the same ACL is applied in and out', () => {
    const f = parseText(
      cfg('interface GigabitEthernet0/1', ' ip access-group A in', ' ip access-group A out', '!', 'ip access-list extended A', ' deny ip any any'),
    );
    expect(f.device.interfaces[0]?.accessGroups.map((g) => g.direction)).toEqual(['in', 'out']);
  });
});
