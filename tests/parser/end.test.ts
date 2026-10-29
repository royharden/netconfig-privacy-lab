import { describe, expect, it } from 'vitest';
import { cfg, kindAt, parseText } from './helpers';

describe('construct: end', () => {
  it('parses `end`', () => {
    expect(kindAt(parseText(cfg('hostname r1', 'end')), 2)).toBe('end');
  });

  it('`end` with extra tokens or upper case is unknown', () => {
    expect(kindAt(parseText(cfg('end now')), 1)).toBe('unknown');
    expect(kindAt(parseText(cfg('END')), 1)).toBe('unknown');
  });
});
