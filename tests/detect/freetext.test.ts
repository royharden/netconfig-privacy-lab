import { expect, it } from 'vitest';
import { createFreeTextDetector } from '../../src/detect/freetext';
import { extractOperatorList } from '../../src/core/operatorList';
it('detects public shapes plus explicit operator tokens without generator knowledge', () => {
  const text = 'Edge admin@example.org aa:bb:cc:dd:ee:ff SN-ABC123 10.2.3.0/24 10.2. 3.1 unlisted';
  const spans = createFreeTextDetector(['Edge']).detect(text);
  expect(spans.map((s) => s.kind)).toEqual(['operator', 'email', 'mac', 'serial', 'prefix']);
  expect(spans.map((s) => text.slice(s.start, s.end))).not.toContain('unlisted');
});
it('extracts only the frozen operator line set', () => {
  const files = Array.from({ length: 3 }, (_, i) => ({ fileId: `f${i}`, name: `n${i}.cfg`, text: `hostname edge${i}\nip domain-name example.org\ninterface GigabitEthernet0/0\n description excluded\n!\nrouter bgp 110\n neighbor 192.0.2.1 remote-as 65000\n neighbor 192.0.2.1 description Transit customer\nend\n` }));
  const words = extractOperatorList({ caseId: 'unit', files });
  expect(words).toContain('110'); expect(words).toContain('Transit');
  expect(words).not.toContain('excluded'); expect(words).not.toContain('192.0.2.1');
});
