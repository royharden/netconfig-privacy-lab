import { describe, expect, it } from 'vitest';
import { cfg, kindAt, nodeAt, parseText, spanText } from './helpers';

describe('construct: banner motd #text#', () => {
  it('parses one-line banner text between the # delimiters', () => {
    const f = parseText(cfg('banner motd #Report faults to noc@velloran.example#'));
    const n = nodeAt(f, 1, 'banner-motd');
    expect(n.text).toEqual({ text: 'Report faults to noc@velloran.example', start: 13, end: 50 });
    expect(spanText(f, 1, n.text)).toBe(n.text.text);
    expect(f.device.bannerLineOrdinals).toEqual([1]);
  });

  it('allows an empty banner and trailing whitespace', () => {
    const n = nodeAt(parseText(cfg('banner motd ##  ')), 1, 'banner-motd');
    expect(n.text).toEqual({ text: '', start: 13, end: 13 });
  });

  it('multi-line banners, other delimiters and other banner types are unknown', () => {
    for (const bad of ['banner motd #unterminated', 'banner motd ^text^', 'banner login #x#', 'banner motd #a#b#']) {
      expect(kindAt(parseText(cfg(bad)), 1)).toBe('unknown');
    }
  });
});
