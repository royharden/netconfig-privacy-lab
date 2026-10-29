import { describe, expect, it } from 'vitest';
import { cfg, kindAt, lineAt, nodeAt, parseText, spanText } from './helpers';

describe('construct: ip access-list extended NAME', () => {
  it('opens an ACL block whose entries get 1-based ordinals (remarks excluded)', () => {
    const f = parseText(
      cfg(
        'ip access-list extended QUILLFEN-EDGE-IN',
        ' remark web only',
        ' permit tcp host 10.11.1.1 host 192.0.2.1 eq 443',
        ' deny ip any any',
        '!',
      ),
    );
    const n = nodeAt(f, 1, 'acl-named-header');
    expect(n.name).toEqual({ text: 'QUILLFEN-EDGE-IN', start: 24, end: 40 });
    expect(spanText(f, 1, n.name)).toBe('QUILLFEN-EDGE-IN');
    expect(lineAt(f, 3).block).toBe('acl');
    const acl = f.device.acls[0];
    expect(acl?.name).toBe('QUILLFEN-EDGE-IN');
    expect(acl?.form).toBe('named');
    expect(acl?.entries.map((e) => [e.ordinal, e.lineOrdinal, e.action])).toEqual([
      [1, 3, 'permit'],
      [2, 4, 'deny'],
    ]);
  });

  it('a repeated header on one node is reported as duplicate-acl-name', () => {
    const f = parseText(cfg('ip access-list extended A', ' deny ip any any', 'ip access-list extended A', ' permit ip any any'));
    expect(f.device.diagnostics).toContainEqual({ code: 'duplicate-acl-name', lineOrdinal: 3 });
    expect(f.device.acls).toHaveLength(1);
    expect(f.device.acls[0]?.entries.map((e) => e.ordinal)).toEqual([1, 2]);
  });

  it('standard ACLs and names starting with a digit are unknown and forwarding-affecting', () => {
    for (const bad of ['ip access-list standard A', 'ip access-list extended 1abc', 'ip access-list extended']) {
      const f = parseText(cfg(bad));
      expect(kindAt(f, 1)).toBe('unknown');
      expect(f.device.unknownLines[0]?.forwardingAffecting).toBe(true);
    }
  });
});
