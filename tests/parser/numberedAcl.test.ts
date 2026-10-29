import { describe, expect, it } from 'vitest';
import { cfg, kindAt, nodeAt, parseText, spanText } from './helpers';

describe('construct: numbered extended ACL (access-list 100-199)', () => {
  it('parses entries whose ACL name is the number (a typed constant)', () => {
    const f = parseText(
      cfg('access-list 110 permit tcp any host 198.51.100.1 eq 443', 'access-list 110 permit icmp any any', 'access-list 110 deny ip any any'),
    );
    const n = nodeAt(f, 1, 'acl-entry');
    expect(n.aclName).toBe('110');
    expect(n.numberTok).toEqual({ text: '110', start: 12, end: 15 });
    if (n.dst.type === 'host') expect(spanText(f, 1, n.dst.address)).toBe('198.51.100.1');
    const acl = f.device.acls[0];
    expect(acl?.form).toBe('numbered');
    expect(acl?.entries.map((e) => [e.ordinal, e.action, e.protocol])).toEqual([
      [1, 'permit', 'tcp'],
      [2, 'permit', 'icmp'],
      [3, 'deny', 'ip'],
    ]);
  });

  it('numbers outside 100-199 (standard ACLs, 2000+) are unknown and forwarding-affecting', () => {
    for (const bad of ['access-list 10 permit any', 'access-list 99 permit ip any any', 'access-list 2100 permit ip any any']) {
      const f = parseText(cfg(bad));
      expect(kindAt(f, 1)).toBe('unknown');
      expect(f.device.unknownLines[0]?.keyword).toBe('access-list');
    }
  });

  it('a numbered line does not open a block', () => {
    const f = parseText(cfg('access-list 150 permit icmp any any', ' permit ip any any'));
    expect(kindAt(f, 2)).toBe('unknown');
  });
});
