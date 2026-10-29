import { describe, expect, it } from 'vitest';
import { cfg, kindAt, nodeAt, parseText, spanText } from './helpers';

describe('construct: enable secret 5|9 HASH', () => {
  it('parses the hash type and hash span', () => {
    const f = parseText(cfg('enable secret 5 $1$mQ3x$Zt7bK1pLw9VrN2cDsY4hE.'));
    const n = nodeAt(f, 1, 'enable-secret');
    expect(n.hashType).toBe('5');
    expect(n.hash).toEqual({ text: '$1$mQ3x$Zt7bK1pLw9VrN2cDsY4hE.', start: 16, end: 46 });
    expect(spanText(f, 1, n.hash)).toBe(n.hash.text);
    expect(f.device.enableSecret).toEqual({ hashType: '5', lineOrdinal: 1 });
  });

  it('rejects `enable password`, other types and extra tokens', () => {
    for (const bad of ['enable password x', 'enable secret 0 x', 'enable secret 9 a b', 'enable secret 5']) {
      expect(kindAt(parseText(cfg(bad)), 1)).toBe('unknown');
    }
  });
});
