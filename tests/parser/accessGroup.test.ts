import { describe, expect, it } from 'vitest';
import { cfg, kindAt, nodeAt, parseText, spanText } from './helpers';

describe('construct: ip access-group', () => {
  it('parses a named ACL reference and its direction', () => {
    const f = parseText(
      cfg('interface GigabitEthernet0/1', ' ip access-group QUILLFEN-EDGE-IN in', '!', 'ip access-list extended QUILLFEN-EDGE-IN', ' permit ip any any'),
    );
    const n = nodeAt(f, 2, 'if-access-group');
    expect(n.acl).toEqual({ text: 'QUILLFEN-EDGE-IN', start: 17, end: 33 });
    expect(spanText(f, 2, n.acl)).toBe('QUILLFEN-EDGE-IN');
    expect(n.direction).toBe('in');
    expect(n.numbered).toBe(false);
    expect(f.device.interfaces[0]?.accessGroups).toEqual([{ aclName: 'QUILLFEN-EDGE-IN', direction: 'in', lineOrdinal: 2 }]);
    expect(f.device.diagnostics).toEqual([]);
  });

  it('parses a numbered reference (typed constant) in the out direction', () => {
    const f = parseText(cfg('interface GigabitEthernet0/2', ' ip access-group 110 out', '!', 'access-list 110 deny ip any any'));
    const n = nodeAt(f, 2, 'if-access-group');
    expect(n.numbered).toBe(true);
    expect(n.direction).toBe('out');
  });

  it('reports an undefined ACL as undefined-acl but still parses the line', () => {
    const f = parseText(cfg('interface GigabitEthernet0/2', ' ip access-group MISSING in'));
    expect(kindAt(f, 2)).toBe('if-access-group');
    expect(f.device.diagnostics).toContainEqual({ code: 'undefined-acl', lineOrdinal: 2 });
  });

  it('rejects bad directions and numbers outside 100-199', () => {
    for (const bad of [' ip access-group X both', ' ip access-group 99 in', ' ip access-group 200 in', ' ip access-group X']) {
      expect(kindAt(parseText(cfg('interface GigabitEthernet0/0', bad)), 2)).toBe('unknown');
    }
  });
});
