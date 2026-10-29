/**
 * `identity` control arm (row 11): output bytes and file names equal the input exactly (row 41). It still parses the case so
 * that caps, stratum and parse diagnostics are reported the same way for every arm.
 */
import type { CaseInput, Outcome, Strategy } from './types';
import { caseDiagnostics, parseCase } from '../core/parser';

export const identity: Strategy = {
  id: 'identity',
  async apply(c: CaseInput): Promise<Outcome> {
    const parsed = parseCase(c);
    const diagnostics = caseDiagnostics(parsed);
    if (parsed.stratum === null) {
      return { caseId: c.caseId, arm: 'identity', status: 'error', files: [], diagnostics };
    }
    return {
      caseId: c.caseId,
      arm: 'identity',
      status: parsed.stratum === 'unsupported' ? 'unsupported' : 'ok',
      files: c.files.map((f) => ({ fileId: f.fileId, name: f.name, text: f.text })),
      diagnostics,
    };
  },
};
