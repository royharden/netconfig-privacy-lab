import type { AddrSpec, Tok } from '../core/model';
import { caseDiagnostics, parseCase } from '../core/parser';
import { formatIPv4, isNetworkOrBroadcast, networkOf, parseIPv4 } from '../core/ipv4';
import { createFreeTextDetector } from '../detect/freetext';
import { cryptoPan } from './cryptopan';
import { feistel, permuteAsn } from './asn';
import { createPseudonymizer, replaceSecret } from './pseudonym';
import type { NameDomain } from './pseudonym';
import { applyEdits } from './naiveMask';
import type { Edit } from './naiveMask';
import type { OutcomeDiagnostic, Strategy } from './types';

export type LabArm = 'lab-scrub' | 'lab-drop' | 'lab-scrub@key2' | 'random-consistent';

export function makeLabStrategy(id: LabArm): Strategy {
  return { id, async apply(c, ctx) {
    const diagnostics: OutcomeDiagnostic[] = [];
    try {
      const parsed = parseCase(c);
      diagnostics.push(...caseDiagnostics(parsed));
      if (parsed.stratum === null) return { caseId: c.caseId, arm: id, status: 'error', files: [], diagnostics };
      const pseudo = createPseudonymizer(ctx.nameKey);
      const detector = createFreeTextDetector(ctx.operatorList);
      const hosts = new Map<string, string>();
      for (const f of parsed.files) if (f.device.hostname) hosts.set(f.device.hostname.toLowerCase(), await pseudo('hostname', f.device.hostname));
      const transform = (v: number) => id === 'random-consistent' ? feistel(v, 16, ctx.rcKey, 'ipv4') : cryptoPan(v, ctx.cryptopan);
      const files = [];
      for (const file of parsed.files) {
        let text = '';
        for (const line of file.lines) {
          // A comment keeps the line ordinal and enclosing block while removing the whole
          // free-text construct (an empty neighbor-description would be unsupported syntax).
          if (id === 'lab-drop' && ['if-description', 'acl-remark', 'bgp-description', 'banner-motd', 'comment'].includes(line.node.kind)) {
            text += `${/^[ \t]*/.exec(line.text)?.[0] ?? ''}!${line.eol}`;
            continue;
          }
          const edits: Edit[] = [];
          const put = (tok: Tok, replacement: string) => { edits.push({ start: tok.start, end: tok.end, replacement }); };
          const name = async (tok: Tok, domain: NameDomain) => put(tok, await pseudo(domain, tok.text));
          const address = async (tok: Tok, prefix?: number, hostPrefix?: number) => {
            if (tok.text === '0.0.0.0') return;
            const value = parseIPv4(tok.text);
            if (value === null) throw new Error('invalid-ipv4');
            const transformed = await transform(value);
            const out = prefix === undefined ? transformed : networkOf(transformed, prefix);
            if ((out >>> 28) >= 14 || (out >>> 24) === 0 || (out >>> 24) === 127) diagnostics.push({ code: 'ipv4-reserved-output', fileId: file.fileId, ordinal: line.ordinal });
            if (hostPrefix !== undefined && isNetworkOrBroadcast(out, hostPrefix)) diagnostics.push({ code: 'ipv4-network-or-broadcast-output', fileId: file.fileId, ordinal: line.ordinal });
            put(tok, formatIPv4(out));
          };
          const addrSpec = async (spec: AddrSpec) => {
            if (spec.type !== 'any') await address(spec.address, spec.type === 'wildcard' ? spec.prefixLength : undefined);
          };
          const asn = async (tok: Tok) => {
            const mapped = await permuteAsn(tok.text, ctx.asnKey);
            put(tok, mapped.value);
            if (mapped.diagnostic) diagnostics.push({ code: mapped.diagnostic, fileId: file.fileId, ordinal: line.ordinal });
          };
          const freeText = async (tok: Tok | null) => {
            if (!tok) return;
            if (id === 'lab-drop') { put(tok, ''); return; }
            for (const span of detector.detect(tok.text)) {
              const value = tok.text.slice(span.start, span.end);
              const target = { text: value, start: tok.start + span.start, end: tok.start + span.end };
              if (span.kind === 'ipv4') await address(target);
              else if (span.kind === 'prefix') {
                const [ip, len] = value.split('/');
                const n = parseIPv4(ip);
                if (n !== null) put(target, `${formatIPv4(networkOf(await transform(n), Number(len)))}/${len}`);
              } else if (span.kind === 'operator' && /^\d+$/.test(value)) await asn(target);
              else {
                const host = hosts.get(value.toLowerCase());
                put(target, host ?? await pseudo('text', value));
              }
            }
          };
          const n = line.node;
          switch (n.kind) {
            case 'hostname': await name(n.name, 'hostname'); break;
            case 'domain-name': await name(n.name, 'domain'); break;
            case 'username': await name(n.name, 'username'); put(n.hash, await replaceSecret(ctx.secretKey, n.hashType)); break;
            case 'enable-secret': put(n.hash, await replaceSecret(ctx.secretKey, n.hashType)); break;
            case 'snmp-community': put(n.community, await replaceSecret(ctx.secretKey, 'community')); break;
            case 'acl-named-header': await name(n.name, 'acl-name'); break;
            case 'if-access-group': if (!n.numbered) await name(n.acl, 'acl-name'); break;
            case 'if-address': await address(n.address, undefined, n.prefixLength); break;
            case 'static-route': await address(n.prefix, n.prefixLength); await address(n.nextHop); break;
            case 'acl-entry': await addrSpec(n.src); await addrSpec(n.dst); break;
            case 'bgp-router': await asn(n.asn); break;
            case 'bgp-remote-as': await address(n.neighbor); await asn(n.asn); break;
            case 'bgp-description': await address(n.neighbor); await freeText(n.text); break;
            case 'if-description': case 'acl-remark': case 'banner-motd': case 'comment': await freeText(n.text); break;
            default: break;
          }
          text += applyEdits(line.text, edits) + line.eol;
        }
        const match = /^(.*?)(\.[^.]+)?$/.exec(file.name);
        const stem = match?.[1] ?? file.name, extension = match?.[2] ?? '';
        files.push({ fileId: file.fileId, name: hosts.has(stem.toLowerCase()) ? `${hosts.get(stem.toLowerCase())}${extension}` : file.name, text });
      }
      const invalidOutput = diagnostics.some((d) => d.code.startsWith('ipv4-'));
      return { caseId: c.caseId, arm: id, status: invalidOutput || parsed.stratum === 'unsupported' ? 'unsupported' : 'ok', files, diagnostics };
    } catch {
      return { caseId: c.caseId, arm: id, status: 'error', files: [], diagnostics: [{ code: 'strategy-failure', fileId: '', ordinal: 0 }] };
    }
  } };
}

export const labScrub = makeLabStrategy('lab-scrub');
export const labDrop = makeLabStrategy('lab-drop');
/** The runner MUST supply a context derived from the second master for this control. */
export const labScrubKey2 = makeLabStrategy('lab-scrub@key2');
