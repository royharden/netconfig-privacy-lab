/** Offline file-only validator. Expected context is independently frozen; bundle paths are never followed. */
import { readFileSync } from 'node:fs';
import { validateRecordingBundle } from '../src/eval/recordings';
import type { RecordingExpectation } from '../src/eval/recordings';

async function main(): Promise<void> {
  const [bundlePath, contextPath] = process.argv.slice(2);
  if (!bundlePath || !contextPath) throw new Error('usage: verify-recordings <bundle.json> <frozen-expectation.json>');
  const value: unknown = JSON.parse(readFileSync(bundlePath, 'utf8'));
  // This file is trusted preregistration/case context, not supplied by the recording producer.
  const expected = JSON.parse(readFileSync(contextPath, 'utf8')) as RecordingExpectation;
  const checked = await validateRecordingBundle(value, expected);
  if (!checked.ok) {
    for (const issue of checked.issues) console.error(`${issue.path}: ${issue.message}`);
    process.exitCode = 1;
  } else console.log(`validated ${checked.value.caseId} ${checked.value.arm} ${checked.value.tool}`);
}
main().catch(() => { console.error('recording-verification-failed'); process.exitCode = 1; });
