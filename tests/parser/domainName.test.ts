import { describe, expect, it } from 'vitest';
import { cfg, kindAt, nodeAt, parseText, spanText } from './helpers';

describe('construct: ip domain-name', () => {
  it('parses `ip domain-name NAME` with the name span', () => {
    const f = parseText(cfg('ip domain-name brakefold-net.example'));
    const n = nodeAt(f, 1, 'domain-name');
    expect(n.name).toEqual({ text: 'brakefold-net.example', start: 15, end: 36 });
    expect(spanText(f, 1, n.name)).toBe('brakefold-net.example');
    expect(f.device.domainName).toBe('brakefold-net.example');
  });

  it('rejects malformed domains as unknown lines', () => {
    for (const bad of ['ip domain-name', 'ip domain-name a..b', 'ip domain-name -lead.example', 'ip domain-name a b']) {
      expect(kindAt(parseText(cfg(bad)), 1)).toBe('unknown');
    }
  });
});
