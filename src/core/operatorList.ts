import { parseCase } from './parser';
import type { ConfigFileInput } from './types';

/** Frozen text-only extraction: whole hostname/domain/ASN values and whitespace-delimited
 * neighbor-description tokens (ASCII letters/digits plus . _ @ : / -). No other lines qualify. */
export function extractOperatorList(input: { caseId: string; files: ConfigFileInput[] }): string[] {
  const parsed = parseCase(input);
  const words = new Set<string>();
  for (const file of parsed.files) for (const line of file.lines) {
    const n = line.node;
    if (n.kind === 'hostname' || n.kind === 'domain-name') words.add(n.name.text);
    else if (n.kind === 'bgp-router' || n.kind === 'bgp-remote-as') words.add(n.asn.text);
    else if (n.kind === 'bgp-description') for (const word of n.text.text.split(/[ \t]+/)) {
      if (/^[A-Za-z0-9][A-Za-z0-9._@:/-]*$/.test(word)) words.add(word);
    }
  }
  return [...words].sort();
}
