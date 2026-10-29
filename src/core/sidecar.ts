/**
 * `case.json` sidecar (structure only), PLAN.md §4 and rows 36, 41, 42c. Schema: schemas/case.schema.json.
 * Read only by the evaluator side (`src/eval/*`), loaders and scripts; strategies never import this module (row 29).
 *
 * IDs are opaque synthetic IDs (never hostnames). On-disk `path` values are opaque (`n01.cfg`); a planted file-name trap lives
 * only in `files[].name` (row 41). Interface `ordinal` = 1-based position among the file's interface blocks; ACL entry `ordinal`
 * = 1-based position among that ACL's permit/deny entries (docs/SEMANTICS.md).
 */
import type { Family, FlowProtocol, Stratum, Validated } from './types';
import { FAMILIES, FLOW_PROTOCOLS, ID_PATTERN, STRATA, ShapeChecker, isSafeFileName } from './types';
import { parseIPv4 } from './ipv4';
import {
  MAX_ACL_ENTRIES_PER_DEVICE,
  MAX_DEVICES_PER_CASE,
  MAX_INTERFACES_PER_DEVICE,
  MAX_SCHEDULED_FLOWS_PER_CASE,
  MIN_DEVICES_PER_CASE,
} from './limits';

export const CASE_SCHEMA_ID = 'case-v1';
/** On-disk config path inside a case directory: opaque, lowercase, `.cfg`. */
export const OPAQUE_CONFIG_PATH_RE = /^[a-z0-9]+\.cfg$/;

export interface SidecarFile {
  fileId: string;
  /** Opaque on-disk path relative to the case directory, e.g. `n01.cfg`. */
  path: string;
  /** Display name; may be a planted file-name trap (row 41). Never a path to follow. */
  name: string;
  nodeId: string;
}

export interface SidecarNode {
  id: string;
  fileId: string;
}

export interface SidecarInterface {
  id: string;
  nodeId: string;
  ordinal: number;
}

export interface SidecarAcl {
  id: string;
  nodeId: string;
  aclName: string;
}

export interface SidecarAclEntry {
  id: string;
  nodeId: string;
  aclId: string;
  aclName: string;
  ordinal: number;
}

/** Codex `Flow` shape. ICMP flows carry ports 0. Endpoints are addresses present in the original configs (row 31). */
export interface Flow {
  id: string;
  ingressNodeId: string;
  ingressInterfaceId: string;
  src: string;
  dst: string;
  protocol: FlowProtocol;
  srcPort: number;
  dstPort: number;
}

export interface CaseSidecar {
  schema: typeof CASE_SCHEMA_ID;
  caseId: string;
  family: Family;
  stratum: Stratum;
  files: SidecarFile[];
  nodes: SidecarNode[];
  interfaces: SidecarInterface[];
  acls: SidecarAcl[];
  aclEntries: SidecarAclEntry[];
  /** ≤32; exactly 32 for semantic-positive dev/held-out cases (row 36); 0 for unsupported cases; smoke cases may have fewer. */
  flows: Flow[];
}

export function parseSidecar(value: unknown): Validated<CaseSidecar> {
  const c = new ShapeChecker();
  const root = c.object(value, '$', [
    'schema',
    'caseId',
    'family',
    'stratum',
    'files',
    'nodes',
    'interfaces',
    'acls',
    'aclEntries',
    'flows',
  ]);
  if (root === null) return c.result<CaseSidecar>(value);
  c.constant(root.schema, '$.schema', CASE_SCHEMA_ID);
  c.string(root.caseId, '$.caseId', ID_PATTERN);
  c.enumValue(root.family, '$.family', FAMILIES);
  const stratum = c.enumValue(root.stratum, '$.stratum', STRATA);

  const fileIds = new Set<string>();
  const paths = new Set<string>();
  const fileNode = new Map<string, string>();
  (c.array(root.files, '$.files', MIN_DEVICES_PER_CASE, MAX_DEVICES_PER_CASE) ?? []).forEach((item, i) => {
    const p = `$.files[${i}]`;
    const o = c.object(item, p, ['fileId', 'path', 'name', 'nodeId']);
    if (o === null) return;
    const fileId = c.string(o.fileId, `${p}.fileId`, ID_PATTERN);
    c.unique(fileId, fileIds, `${p}.fileId`);
    c.unique(c.string(o.path, `${p}.path`, OPAQUE_CONFIG_PATH_RE), paths, `${p}.path`);
    const name = c.string(o.name, `${p}.name`, undefined, 255);
    if (name !== null && !isSafeFileName(name)) c.fail(`${p}.name`, 'not a safe display file name');
    const nodeId = c.string(o.nodeId, `${p}.nodeId`, ID_PATTERN);
    if (fileId !== null && nodeId !== null) fileNode.set(fileId, nodeId);
  });

  const nodeIds = new Set<string>();
  (c.array(root.nodes, '$.nodes', MIN_DEVICES_PER_CASE, MAX_DEVICES_PER_CASE) ?? []).forEach((item, i) => {
    const p = `$.nodes[${i}]`;
    const o = c.object(item, p, ['id', 'fileId']);
    if (o === null) return;
    const id = c.string(o.id, `${p}.id`, ID_PATTERN);
    c.unique(id, nodeIds, `${p}.id`);
    const fileId = c.string(o.fileId, `${p}.fileId`, ID_PATTERN);
    if (fileId !== null && id !== null && fileNode.get(fileId) !== id) {
      c.fail(`${p}.fileId`, 'node and file do not reference each other');
    }
  });
  for (const [fileId, nodeId] of fileNode) {
    if (!nodeIds.has(nodeId)) c.fail('$.files', `file ${fileId} references unknown node ${nodeId}`);
  }

  const interfaceNode = new Map<string, string>();
  const interfaceOrdinals = new Set<string>();
  (c.array(root.interfaces, '$.interfaces') ?? []).forEach((item, i) => {
    const p = `$.interfaces[${i}]`;
    const o = c.object(item, p, ['id', 'nodeId', 'ordinal']);
    if (o === null) return;
    const id = c.string(o.id, `${p}.id`, ID_PATTERN);
    const nodeId = c.string(o.nodeId, `${p}.nodeId`, ID_PATTERN);
    const ordinal = c.integer(o.ordinal, `${p}.ordinal`, 1, MAX_INTERFACES_PER_DEVICE);
    if (id !== null) {
      if (interfaceNode.has(id)) c.fail(`${p}.id`, `duplicate id "${id}"`);
      if (nodeId !== null) interfaceNode.set(id, nodeId);
    }
    if (nodeId !== null && !nodeIds.has(nodeId)) c.fail(`${p}.nodeId`, 'unknown node');
    if (nodeId !== null && ordinal !== null) c.unique(`${nodeId}#${ordinal}`, interfaceOrdinals, `${p}.ordinal`);
  });

  const acls = new Map<string, { nodeId: string | null; aclName: string | null }>();
  (c.array(root.acls, '$.acls') ?? []).forEach((item, i) => {
    const p = `$.acls[${i}]`;
    const o = c.object(item, p, ['id', 'nodeId', 'aclName']);
    if (o === null) return;
    const id = c.string(o.id, `${p}.id`, ID_PATTERN);
    const nodeId = c.string(o.nodeId, `${p}.nodeId`, ID_PATTERN);
    const aclName = c.string(o.aclName, `${p}.aclName`, undefined, 64);
    if (nodeId !== null && !nodeIds.has(nodeId)) c.fail(`${p}.nodeId`, 'unknown node');
    if (id !== null) {
      if (acls.has(id)) c.fail(`${p}.id`, `duplicate id "${id}"`);
      acls.set(id, { nodeId, aclName });
    }
  });

  const entryIds = new Set<string>();
  const entryOrdinals = new Set<string>();
  (c.array(root.aclEntries, '$.aclEntries', 0, MAX_ACL_ENTRIES_PER_DEVICE * MAX_DEVICES_PER_CASE) ?? []).forEach(
    (item, i) => {
      const p = `$.aclEntries[${i}]`;
      const o = c.object(item, p, ['id', 'nodeId', 'aclId', 'aclName', 'ordinal']);
      if (o === null) return;
      c.unique(c.string(o.id, `${p}.id`, ID_PATTERN), entryIds, `${p}.id`);
      const nodeId = c.string(o.nodeId, `${p}.nodeId`, ID_PATTERN);
      const aclId = c.string(o.aclId, `${p}.aclId`, ID_PATTERN);
      const aclName = c.string(o.aclName, `${p}.aclName`, undefined, 64);
      const ordinal = c.integer(o.ordinal, `${p}.ordinal`, 1, MAX_ACL_ENTRIES_PER_DEVICE);
      const acl = aclId === null ? undefined : acls.get(aclId);
      if (aclId !== null && acl === undefined) c.fail(`${p}.aclId`, 'unknown ACL');
      if (acl !== undefined && (acl.nodeId !== nodeId || acl.aclName !== aclName)) {
        c.fail(p, 'nodeId/aclName disagree with the referenced ACL');
      }
      if (aclId !== null && ordinal !== null) c.unique(`${aclId}#${ordinal}`, entryOrdinals, `${p}.ordinal`);
    },
  );

  const flowIds = new Set<string>();
  const flows = c.array(root.flows, '$.flows', 0, MAX_SCHEDULED_FLOWS_PER_CASE) ?? [];
  if (stratum === 'unsupported' && flows.length > 0) c.fail('$.flows', 'unsupported cases schedule no flows (row 36)');
  flows.forEach((item, i) => {
    const p = `$.flows[${i}]`;
    const o = c.object(item, p, ['id', 'ingressNodeId', 'ingressInterfaceId', 'src', 'dst', 'protocol', 'srcPort', 'dstPort']);
    if (o === null) return;
    c.unique(c.string(o.id, `${p}.id`, ID_PATTERN), flowIds, `${p}.id`);
    const nodeId = c.string(o.ingressNodeId, `${p}.ingressNodeId`, ID_PATTERN);
    const ifaceId = c.string(o.ingressInterfaceId, `${p}.ingressInterfaceId`, ID_PATTERN);
    if (nodeId !== null && !nodeIds.has(nodeId)) c.fail(`${p}.ingressNodeId`, 'unknown node');
    if (ifaceId !== null && interfaceNode.get(ifaceId) !== nodeId) {
      c.fail(`${p}.ingressInterfaceId`, 'unknown interface or interface of another node');
    }
    for (const key of ['src', 'dst'] as const) {
      const addr = c.string(o[key], `${p}.${key}`, undefined, 15);
      if (addr !== null && parseIPv4(addr) === null) c.fail(`${p}.${key}`, 'not a dotted-quad IPv4 address');
    }
    const protocol = c.enumValue(o.protocol, `${p}.protocol`, FLOW_PROTOCOLS);
    const srcPort = c.integer(o.srcPort, `${p}.srcPort`, 0, 65535);
    const dstPort = c.integer(o.dstPort, `${p}.dstPort`, 0, 65535);
    if (protocol === 'icmp' && (srcPort !== 0 || dstPort !== 0)) c.fail(p, 'icmp flows carry ports 0');
  });

  return c.result<CaseSidecar>(value);
}
