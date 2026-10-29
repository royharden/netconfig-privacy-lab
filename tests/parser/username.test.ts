import { describe, expect, it } from 'vitest';
import { cfg, kindAt, nodeAt, parseText, spanText } from './helpers';

describe('construct: username NAME secret 5|9 HASH', () => {
  it('parses the name and the hash token span; the model keeps no hash', () => {
    const f = parseText(cfg('username brakefold secret 9 $9$Lq0vXe2b$Hm3TzR8yWc1N5pKd7sJaUo4iGf6EtQwYbVx2CnRm9Lk'));
    const n = nodeAt(f, 1, 'username');
    expect(n.name).toEqual({ text: 'brakefold', start: 9, end: 18 });
    expect(n.hashType).toBe('9');
    expect(n.hash.start).toBe(28);
    expect(spanText(f, 1, n.hash)).toBe('$9$Lq0vXe2b$Hm3TzR8yWc1N5pKd7sJaUo4iGf6EtQwYbVx2CnRm9Lk');
    expect(f.device.usernames).toEqual([{ name: 'brakefold', hashType: '9', lineOrdinal: 1 }]);
    expect(JSON.stringify(f.device)).not.toContain('$9$');
  });

  it('accepts any non-space HASH token, including an unknown-format secret (row 45)', () => {
    const n = nodeAt(parseText(cfg('username tamsin secret 5 hunter2plain')), 1, 'username');
    expect(n.hash.text).toBe('hunter2plain');
  });

  it('rejects other secret types, `password`, and missing tokens', () => {
    for (const bad of ['username a secret 0 x', 'username a password 7 x', 'username a secret 5', 'username a b secret 5 x']) {
      expect(kindAt(parseText(cfg(bad)), 1)).toBe('unknown');
    }
  });
});
