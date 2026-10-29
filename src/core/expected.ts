/**
 * Author expected answers (PLAN.md row 38), one `expected.json` per semantic-positive held-out or practice case, written only by
 * the independent author (row 43). Schema: schemas/expected.schema.json. Read only by `src/eval/*` and the custody tools; the
 * label-blind preflight only hashes these files (row 42c). The builder never writes one for a held-out or practice case.
 *
 * Semantics the author derives against: docs/SEMANTICS.md (rows 7–9). Ordinals:
 *  - `aclDecision.entryOrdinal`: 1-based ACL entry ordinal of the deciding entry; 0 = implicit deny (no entry matched).
 *  - finding `ordinal` (findings compared as multisets):
 *      permit-ip-any-any            → ACL entry ordinal of the any-any entry
 *      duplicate-acl-entry          → ACL entry ordinal of the second (duplicate) entry
 *      duplicate-interface-address  → interface source ordinal of each non-first copy (copies ordered by node order in
 *                                     case.json, then source ordinal; one finding per non-first copy)
 *      unresolved-acl-reference     → interface source ordinal of the interface whose `access-group` is unresolved
 *      default-snmp-community       → line ordinal of the default community line
 */
import type { Direction, Disposition, FindingRule, Validated } from './types';
import { DIRECTIONS, DISPOSITIONS, FINDING_RULES, ID_PATTERN, ShapeChecker } from './types';
import { MAX_ACL_ENTRIES_PER_DEVICE, MAX_LINES_PER_FILE } from './limits';

export const EXPECTED_SCHEMA_ID = 'expected-v1';
/** Row 19: exactly five hand-derived flows per semantic-positive case. */
export const EXPECTED_FLOWS_PER_CASE = 5;

export interface InterfaceHop {
  nodeId: string;
  /** Interface id the flow enters this node on. */
  ingress: string;
  /** Interface id it leaves on; null when the trace ends at this node. */
  egress: string | null;
}

export interface AclDecision {
  nodeId: string;
  aclId: string;
  /** 1-based deciding entry ordinal; 0 = implicit deny. */
  entryOrdinal: number;
}

export interface ExpectedFlow {
  flowId: string;
  disposition: Disposition;
  nodeIds: string[];
  interfaceHops: InterfaceHop[];
  aclDecision: AclDecision | null;
}

export interface ExpectedFinding {
  rule: FindingRule;
  nodeId: string;
  aclId?: string;
  direction?: Direction;
  ordinal: number;
}

export interface ExpectedAnswers {
  schema: typeof EXPECTED_SCHEMA_ID;
  caseId: string;
  flows: ExpectedFlow[];
  findings: ExpectedFinding[];
}

export function parseExpected(value: unknown): Validated<ExpectedAnswers> {
  const c = new ShapeChecker();
  const root = c.object(value, '$', ['schema', 'caseId', 'flows', 'findings']);
  if (root === null) return c.result<ExpectedAnswers>(value);
  c.constant(root.schema, '$.schema', EXPECTED_SCHEMA_ID);
  c.string(root.caseId, '$.caseId', ID_PATTERN);
  const flowIds = new Set<string>();
  (c.array(root.flows, '$.flows', EXPECTED_FLOWS_PER_CASE, EXPECTED_FLOWS_PER_CASE) ?? []).forEach((item, i) => {
    const p = `$.flows[${i}]`;
    const o = c.object(item, p, ['flowId', 'disposition', 'nodeIds', 'interfaceHops', 'aclDecision']);
    if (o === null) return;
    c.unique(c.string(o.flowId, `${p}.flowId`, ID_PATTERN), flowIds, `${p}.flowId`);
    c.enumValue(o.disposition, `${p}.disposition`, DISPOSITIONS);
    const nodeIds = c.array(o.nodeIds, `${p}.nodeIds`, 1) ?? [];
    nodeIds.forEach((n, j) => c.string(n, `${p}.nodeIds[${j}]`, ID_PATTERN));
    const hops = c.array(o.interfaceHops, `${p}.interfaceHops`, 1) ?? [];
    if (hops.length !== nodeIds.length) c.fail(`${p}.interfaceHops`, 'one hop per node visit');
    hops.forEach((h, j) => {
      const q = `${p}.interfaceHops[${j}]`;
      const ho = c.object(h, q, ['nodeId', 'ingress', 'egress']);
      if (ho === null) return;
      const nodeId = c.string(ho.nodeId, `${q}.nodeId`, ID_PATTERN);
      if (nodeId !== null && nodeIds[j] !== nodeId) c.fail(`${q}.nodeId`, 'differs from nodeIds at the same position');
      c.string(ho.ingress, `${q}.ingress`, ID_PATTERN);
      if (ho.egress !== null) c.string(ho.egress, `${q}.egress`, ID_PATTERN);
    });
    if (o.aclDecision !== null) {
      const a = c.object(o.aclDecision, `${p}.aclDecision`, ['nodeId', 'aclId', 'entryOrdinal']);
      if (a !== null) {
        c.string(a.nodeId, `${p}.aclDecision.nodeId`, ID_PATTERN);
        c.string(a.aclId, `${p}.aclDecision.aclId`, ID_PATTERN);
        c.integer(a.entryOrdinal, `${p}.aclDecision.entryOrdinal`, 0, MAX_ACL_ENTRIES_PER_DEVICE);
      }
    }
  });
  (c.array(root.findings, '$.findings') ?? []).forEach((item, i) => {
    const p = `$.findings[${i}]`;
    const o = c.object(item, p, ['rule', 'nodeId', 'ordinal'], ['aclId', 'direction']);
    if (o === null) return;
    const rule = c.enumValue(o.rule, `${p}.rule`, FINDING_RULES);
    c.string(o.nodeId, `${p}.nodeId`, ID_PATTERN);
    c.integer(o.ordinal, `${p}.ordinal`, 1, MAX_LINES_PER_FILE);
    if ('aclId' in o) c.string(o.aclId, `${p}.aclId`, ID_PATTERN);
    if ('direction' in o) c.enumValue(o.direction, `${p}.direction`, DIRECTIONS);
    const aclRule = rule === 'permit-ip-any-any' || rule === 'duplicate-acl-entry';
    if (aclRule && !('aclId' in o)) c.fail(`${p}.aclId`, `required for ${rule}`);
    if (rule === 'unresolved-acl-reference' && !('direction' in o)) c.fail(`${p}.direction`, `required for ${rule}`);
  });
  return c.result<ExpectedAnswers>(value);
}
