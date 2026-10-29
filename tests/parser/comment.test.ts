import { describe, expect, it } from 'vitest';
import { cfg, lineAt, nodeAt, parseText, spanText } from './helpers';

describe('construct: ! comment', () => {
  it('parses comment text spans, including an IP planted in a comment', () => {
    const f = parseText(cfg('! backup path via 10.11.255.10 is shut'));
    const n = nodeAt(f, 1, 'comment');
    expect(n.text).toEqual({ text: 'backup path via 10.11.255.10 is shut', start: 2, end: 38 });
    expect(spanText(f, 1, n.text ?? { start: 0, end: 0 })).toBe('backup path via 10.11.255.10 is shut');
  });

  it('a bare ! has no text', () => {
    expect(nodeAt(parseText(cfg('!')), 1, 'comment').text).toBeNull();
  });

  it('a non-indented ! closes a block; an indented one does not', () => {
    const f = parseText(
      cfg('interface GigabitEthernet0/0', ' ! inside', ' shutdown', '!', 'interface GigabitEthernet0/1', '!', ' shutdown'),
    );
    expect(lineAt(f, 2).block).toBe('interface');
    expect(f.device.interfaces[0]?.shutdown).toBe(true);
    expect(lineAt(f, 7).node.kind).toBe('unknown');
    expect(f.device.interfaces[1]?.shutdown).toBe(false);
  });

  it('blank lines are allowed and do not close a block', () => {
    const f = parseText(cfg('interface GigabitEthernet0/0', '', ' shutdown'));
    expect(lineAt(f, 2).node.kind).toBe('blank');
    expect(f.device.interfaces[0]?.shutdown).toBe(true);
  });
});
