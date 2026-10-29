import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { FORWARDING_AFFECTING_KEYWORDS, SUPPORTED_CONSTRUCTS } from '../../src/core/grammar';

const grammarDoc = readFileSync(new URL('../../docs/GRAMMAR.md', import.meta.url), 'utf8');

describe('grammar registry consistency (M1 acceptance)', () => {
  it('every supported construct has its own existing test file', () => {
    const files = SUPPORTED_CONSTRUCTS.map((c) => c.testFile);
    expect(new Set(files).size).toBe(files.length);
    for (const f of files) expect(existsSync(new URL(`./${f}`, import.meta.url))).toBe(true);
  });

  it('docs/GRAMMAR.md lists every construct id', () => {
    for (const c of SUPPORTED_CONSTRUCTS) expect(grammarDoc).toContain(`| ${c.id} |`);
  });

  it('docs/GRAMMAR.md keyword list equals FORWARDING_AFFECTING_KEYWORDS', () => {
    const start = grammarDoc.indexOf('<!-- forwarding-keywords:start -->');
    const end = grammarDoc.indexOf('<!-- forwarding-keywords:end -->');
    expect(start).toBeGreaterThan(-1);
    const listed = grammarDoc
      .slice(start, end)
      .split('\n')
      .map((l) => /^- `([^`]+)`$/.exec(l.trim())?.[1])
      .filter((k): k is string => k !== undefined);
    expect(listed).toEqual([...FORWARDING_AFFECTING_KEYWORDS]);
  });
});
