/**
 * Strategy contract (PLAN.md rows 11, 29, 33, 41). Strategies receive config text and display names only: no sidecar, no ledger,
 * no labels (row 29). An Outcome never contains a correspondence map, a key or any secret beyond the transformed text (row 28).
 *
 * Key material (row 29): from a 32-byte master, HKDF-SHA-256 (salt = 32 zero bytes) derives with info `s43/cryptopan` the
 * Crypto-PAn key (bytes 0–15 AES-128 key, bytes 16–31 pad source), and with infos `s43/random-consistent`, `s43/names`,
 * `s43/asn`, `s43/secrets` the HMAC-SHA-256 keys below. The derivation lives in src/strategies/keys.ts (M3). UI sessions draw a
 * fresh random master and never persist it.
 */
import type { ConfigFileInput } from '../core/types';

/** Every row of the results tables (row 11). */
export type Arm =
  | 'identity'
  | 'naive-mask'
  | 'random-consistent'
  | 'lab-scrub'
  | 'lab-drop'
  | 'netconan-minimal'
  | 'netconan-operator'
  | 'netconan-ledger-informed'
  | 'lab-scrub@key2';

export const ARMS: readonly Arm[] = [
  'identity',
  'naive-mask',
  'random-consistent',
  'lab-scrub',
  'lab-drop',
  'netconan-minimal',
  'netconan-operator',
  'netconan-ledger-informed',
  'lab-scrub@key2',
];

/** Recorded netconan rows are NOT Strategy implementations (row 33); they come from validated recordings only. */
export type RecordedArm = 'netconan-minimal' | 'netconan-operator' | 'netconan-ledger-informed';
export const RECORDED_ARMS: readonly RecordedArm[] = ['netconan-minimal', 'netconan-operator', 'netconan-ledger-informed'];

/** One file, aligned by its stable `fileId` (row 41). Arms may change only `name` (lab arms), never `fileId`. */
export type CaseFile = ConfigFileInput;

/** Row 29: `{ caseId, files }` and nothing else. */
export interface CaseInput {
  caseId: string;
  files: CaseFile[];
}

/** Row 29: Crypto-PAn needs 32 bytes, which one CryptoKey cannot hold. */
export interface CryptoPanKey {
  /** AES-128 key imported from master-derived bytes 0–15 (AES-CBC, zero IV, first block = one ECB block). */
  aes: CryptoKey;
  /** 16 bytes = AES_aes(bytes 16–31), computed at load. */
  pad: Uint8Array;
}

/** Row 29: per-purpose keys plus the operator list (row 15), produced by the runner/UI, never derived by an arm. */
export interface StrategyCtx {
  cryptopan: CryptoPanKey;
  rcKey: CryptoKey;
  nameKey: CryptoKey;
  asnKey: CryptoKey;
  secretKey: CryptoKey;
  operatorList: string[];
}

/**
 * 'ok' = output produced for a semantic-positive case; 'unsupported' = output produced but the case is in the unsupported
 * stratum (leak-scored only); 'error' = no output (a cap was violated or the arm failed).
 */
export type OutcomeStatus = 'ok' | 'unsupported' | 'error';

/** Codes and positions only. `ordinal` is a 1-based line ordinal; case-level items use fileId '' and ordinal 0. */
export interface OutcomeDiagnostic {
  code: string;
  fileId: string;
  ordinal: number;
}

/** No map, no key (rows 28, 29). */
export interface Outcome {
  caseId: string;
  arm: Arm;
  status: OutcomeStatus;
  files: CaseFile[];
  diagnostics: OutcomeDiagnostic[];
}

export interface Strategy {
  id: Arm;
  apply(c: CaseInput, ctx: StrategyCtx): Promise<Outcome>;
}
