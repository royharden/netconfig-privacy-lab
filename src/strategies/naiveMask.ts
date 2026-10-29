/**
 * `naive-mask`: the position-aware non-model floor (PLAN.md row 30, with rows 10, 34, 41, 45). It parses each config with the
 * M1 parser and never reads a ledger, sidecar, labels or expected answers (enforced by eslint.config.js).
 *
 *  - Every dotted quad in an ADDRESS position (interface address, ACL `host A` and `A WILDCARD` address, static-route prefix and
 *    next hop, BGP neighbour) and every dotted quad in free text (descriptions, remarks, banner, comments) → `0.0.0.0`.
 *    Masks and wildcards are typed constants and stay untouched, so the output stays parseable.
 *  - Identifier values in name slots → `MASKED`: `hostname`, `ip domain-name`, `username` NAME, named ACL names and their
 *    `access-group` references, and the whole `neighbor ... description` text. Numbered ACL numbers (100–199) are typed
 *    constants and stay (row 34).
 *  - Secrets and communities are replaced IN PLACE with the literal `MASKED` (row 10), keeping every line.
 *  - Descriptions, remarks, banners and comments are otherwise untouched; ASNs, ports and unknown lines are untouched; file
 *    names are kept (row 41).
 *
 * Collapsing all names to one token deliberately yields duplicate hostnames / ACL names (the many-to-one φ̂ the evaluator must
 * report; row 7 `ambiguous-name`). Naive flow rows are therefore `unsupported` by rule (row 45), not by measurement.
 */
import type { CaseInput, Outcome, Strategy } from './types';
import type { AddrSpec, ParsedFile, ParsedLine, Tok } from '../core/model';
import { caseDiagnostics, parseCase } from '../core/parser';
import { findDottedQuads } from '../core/ipv4';

export const NAIVE_MASK_TOKEN = 'MASKED';
export const NAIVE_ZERO_ADDRESS = '0.0.0.0';

export interface Edit {
  start: number;
  end: number;
  replacement: string;
}

const mask = (tok: Tok): Edit => ({ start: tok.start, end: tok.end, replacement: NAIVE_MASK_TOKEN });
const zero = (tok: Tok): Edit => ({ start: tok.start, end: tok.end, replacement: NAIVE_ZERO_ADDRESS });

function addressEdits(spec: AddrSpec): Edit[] {
  return spec.type === 'any' ? [] : [zero(spec.address)];
}

function freeTextEdits(tok: Tok | null): Edit[] {
  if (tok === null) return [];
  return findDottedQuads(tok.text).map((q) => ({
    start: tok.start + q.start,
    end: tok.start + q.end,
    replacement: NAIVE_ZERO_ADDRESS,
  }));
}

/** The edits for one line, in line coordinates. Exported for tests. */
export function naiveEditsForLine(line: ParsedLine): Edit[] {
  const n = line.node;
  switch (n.kind) {
    case 'hostname':
    case 'domain-name':
      return [mask(n.name)];
    case 'if-description':
      return freeTextEdits(n.text);
    case 'if-address':
      return [zero(n.address)];
    case 'if-access-group':
      return n.numbered ? [] : [mask(n.acl)];
    case 'static-route':
      return [zero(n.prefix), zero(n.nextHop)];
    case 'acl-named-header':
      return [mask(n.name)];
    case 'acl-entry':
      return [...addressEdits(n.src), ...addressEdits(n.dst)];
    case 'acl-remark':
      return freeTextEdits(n.text);
    case 'bgp-remote-as':
      return [zero(n.neighbor)];
    case 'bgp-description':
      return [zero(n.neighbor), mask(n.text)];
    case 'snmp-community':
      return [mask(n.community)];
    case 'username':
      return [mask(n.name), mask(n.hash)];
    case 'enable-secret':
      return [mask(n.hash)];
    case 'banner-motd':
      return freeTextEdits(n.text);
    case 'comment':
      return freeTextEdits(n.text);
    case 'blank':
    case 'end':
    case 'interface':
    case 'if-shutdown':
    case 'if-no-shutdown':
    case 'bgp-router':
    case 'unknown':
      return [];
  }
}

/** Applies non-overlapping edits right to left so earlier offsets stay valid. */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  return out;
}

function maskFile(file: ParsedFile): string {
  let out = '';
  for (const line of file.lines) out += applyEdits(line.text, naiveEditsForLine(line)) + line.eol;
  return out;
}

export const naiveMask: Strategy = {
  id: 'naive-mask',
  async apply(c: CaseInput): Promise<Outcome> {
    const parsed = parseCase(c);
    const diagnostics = caseDiagnostics(parsed);
    if (parsed.stratum === null) {
      return { caseId: c.caseId, arm: 'naive-mask', status: 'error', files: [], diagnostics };
    }
    const byId = new Map(parsed.files.map((f) => [f.fileId, f] as const));
    if (c.files.some((f) => !byId.has(f.fileId))) {
      // Unreachable when stratum is set (every file parsed); never fall back to unmasked text.
      return { caseId: c.caseId, arm: 'naive-mask', status: 'error', files: [], diagnostics };
    }
    const files = c.files.map((f) => {
      const pf = byId.get(f.fileId);
      return { fileId: f.fileId, name: f.name, text: pf === undefined ? '' : maskFile(pf) };
    });
    return {
      caseId: c.caseId,
      arm: 'naive-mask',
      status: parsed.stratum === 'unsupported' ? 'unsupported' : 'ok',
      files,
      diagnostics,
    };
  },
};
