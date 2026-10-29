/** Public shapes only. These expressions contain no corpus vocabulary. */
export const PUBLIC_PATTERNS = [
  { kind: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'mac', pattern: /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi },
  { kind: 'serial', pattern: /\b(?:SN|SERIAL)[-_:]?[A-Za-z0-9]{5,}\b/gi },
] as const;
