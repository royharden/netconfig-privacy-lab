import { describe, expect, it } from 'vitest';
import { cfg, kindAt, nodeAt, parseText, spanText } from './helpers';

describe('construct: interface description', () => {
  it('captures the free text from the first word to the last, as a span', () => {
    const f = parseText(cfg('interface GigabitEthernet0/1', ' description link to n02 <script>alert(1)</script>  '));
    const n = nodeAt(f, 2, 'if-description');
    expect(n.text.text).toBe('link to n02 <script>alert(1)</script>');
    expect(n.text.start).toBe(13);
    expect(spanText(f, 2, n.text)).toBe(n.text.text);
    expect(f.device.interfaces[0]?.description).toBe('link to n02 <script>alert(1)</script>');
  });

  it('keeps UTF-8 free text', () => {
    const f = parseText(cfg('interface GigabitEthernet0/1', ' description café — réseau'));
    expect(nodeAt(f, 2, 'if-description').text.text).toBe('café — réseau');
  });

  it('an empty description and a top-level description are unknown', () => {
    expect(kindAt(parseText(cfg('interface GigabitEthernet0/1', ' description')), 2)).toBe('unknown');
    expect(kindAt(parseText(cfg('description orphan')), 1)).toBe('unknown');
  });
});
