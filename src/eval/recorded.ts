import type { Outcome } from '../strategies/types';
import type { RecordingBundleV1, RecordingExpectation } from './recordings';
import { validateRecordingBundle } from './recordings';

export type RecordedResult =
  | { status: 'recorded'; outcome: Outcome; bundle: RecordingBundleV1 }
  | { status: 'not_run'; reason: string };

/** Runner-side only. Never turns an absent or rejected bundle into a score of zero. */
export async function loadRecordedOutcome(value: unknown | null, expected: RecordingExpectation): Promise<RecordedResult> {
  if (value === null || value === undefined) return { status: 'not_run', reason: 'missing-recording' };
  const result = await validateRecordingBundle(value, expected);
  if (!result.ok) return { status: 'not_run', reason: 'invalid-recording' };
  if (result.value.tool !== 'netconan') return { status: 'not_run', reason: 'oracle-bundle-is-not-an-arm-output' };
  return { status: 'recorded', bundle: result.value, outcome: {
    caseId: result.value.caseId, arm: result.value.arm, status: 'ok',
    files: result.value.outputFiles.map(({ fileId, name, text }) => ({ fileId, name, text })), diagnostics: [],
  } };
}
