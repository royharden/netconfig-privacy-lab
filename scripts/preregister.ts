import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { safePath, sha256 } from './custody';
import { verifyCandidateSource } from './candidate';
import { assertPreregistrationSelections, CANDIDATE_TAG_PATTERN, frozenFlowIds, loadSelectionInputs, parsePreregistration, parsePublicChoices } from './preregistration';
import type { Preregistration } from './preregistration';
export type { Preregistration } from './preregistration';

async function main(): Promise<void> {
  const [vault, commit, tag, publicPlan] = process.argv.slice(2);
  if (!vault || !commit || !/^[0-9a-f]{40}$/.test(commit) || !tag || !CANDIDATE_TAG_PATTERN.test(tag) || !publicPlan || process.argv.slice(2).length !== 4) throw new Error('usage: preregister VAULT COMMIT TAG PUBLIC-CHOICES.json');
  // Executed source and synthetic evaluation-key bytes must match the candidate before vault access.
  await verifyCandidateSource(commit);
  const taggedCommit = (await readFile(await safePath('.git', `refs/tags/${tag}`), 'utf8')).trim();
  if (taggedCommit !== commit) throw new Error('candidate-tag-mismatch');
  const choices = parsePublicChoices(JSON.parse(await readFile(publicPlan, 'utf8')));
  if (!choices.ok) throw new Error('invalid-public-choices');
  const { inputs, vaultPin, poolHash } = await loadSelectionInputs(vault);
  const corpusText = JSON.stringify(inputs.corpus, null, 2) + '\n';
  const parsed = parsePreregistration({ ...choices.value, schema: 'preregister-v1', candidateCommit: commit, candidateTag: tag, lockfileSha256: sha256(await readFile('package-lock.json')), corpusManifestSha256: sha256(corpusText), vaultManifestSha256: vaultPin, poolIndexSha256: poolHash, flowIds: frozenFlowIds(inputs) });
  if (!parsed.ok) throw new Error('invalid-preregistration');
  const prereg: Preregistration = parsed.value;
  assertPreregistrationSelections(prereg, inputs);
  const text = JSON.stringify(prereg, null, 2) + '\n';
  await mkdir('evaluation', { recursive: true });
  await writeFile('evaluation/corpus-manifest.json', corpusText, { flag: 'wx' });
  await writeFile('evaluation/preregister.json', text, { flag: 'wx' });
  await writeFile('evaluation/preregister.sha256', sha256(text) + '\n', { flag: 'wx' });
}
main().catch(() => { console.error('preregistration refused: missing or invalid frozen inputs'); process.exitCode = 1; });
