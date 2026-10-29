import { describe, expect, it } from 'vitest';
import { cfg, kindAt, nodeAt, parseText, spanText } from './helpers';

describe('construct: ACL remark', () => {
  it('parses a remark inside a named ACL; remarks take no entry ordinal', () => {
    const f = parseText(cfg('ip access-list extended T', ' remark web to 192.0.2.1 only', ' deny ip any any'));
    const n = nodeAt(f, 2, 'acl-remark');
    expect(n.aclName).toBe('T');
    expect(n.text).toEqual({ text: 'web to 192.0.2.1 only', start: 8, end: 29 });
    expect(f.device.acls[0]?.entries.map((e) => [e.ordinal, e.lineOrdinal])).toEqual([[1, 3]]);
  });

  it('parses `access-list N remark TEXT` and declares the numbered ACL', () => {
    const f = parseText(cfg('access-list 110 remark protect docs LAN'));
    const n = nodeAt(f, 1, 'acl-remark');
    expect(n.numberTok?.text).toBe('110');
    expect(spanText(f, 1, n.text)).toBe('protect docs LAN');
    expect(f.device.acls.map((a) => [a.name, a.form, a.entries.length])).toEqual([['110', 'numbered', 0]]);
  });

  it('an empty remark is unknown', () => {
    expect(kindAt(parseText(cfg('ip access-list extended T', ' remark')), 2)).toBe('unknown');
    expect(kindAt(parseText(cfg('access-list 110 remark')), 1)).toBe('unknown');
  });
});
