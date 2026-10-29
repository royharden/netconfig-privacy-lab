import { describe, expect, it } from 'vitest';
import { cfg, kindAt, nodeAt, parseText, spanText } from './helpers';

describe('construct: hostname', () => {
  it('parses `hostname NAME` with the name span', () => {
    const f = parseText(cfg('hostname brakefold'));
    const n = nodeAt(f, 1, 'hostname');
    expect(n.name).toEqual({ text: 'brakefold', start: 9, end: 18 });
    expect(spanText(f, 1, n.name)).toBe('brakefold');
    expect(f.device.hostname).toBe('brakefold');
    expect(f.device.hostnameLineOrdinal).toBe(1);
  });

  it('accepts letters, digits and hyphens after a leading letter', () => {
    expect(parseText(cfg('hostname kestle-hub-02')).device.hostname).toBe('kestle-hub-02');
  });

  it('treats malformed hostname lines as unknown', () => {
    for (const bad of ['hostname', 'hostname a b', 'hostname 9lives', 'hostname under_score', 'hostname café']) {
      expect(kindAt(parseText(cfg(bad)), 1)).toBe('unknown');
    }
  });

  it('reports a second hostname line as a model diagnostic and keeps the first', () => {
    const f = parseText(cfg('hostname one', 'hostname two'));
    expect(f.device.hostname).toBe('one');
    expect(f.device.diagnostics).toContainEqual({ code: 'duplicate-hostname-line', lineOrdinal: 2 });
  });
});
