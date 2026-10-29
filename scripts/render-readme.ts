import { readFile, writeFile } from 'node:fs/promises';
import { renderReport } from '../src/eval/results';
import type { Report } from '../src/eval/results';
async function main(): Promise<void> {
  const path = process.argv[2];
  if (!/^results\/(dev|practice|heldout)\.json$/.test(path ?? '')) throw new Error('invalid-results-path');
  const report = JSON.parse(await readFile(path!, 'utf8')) as Report;
  if (report.schema !== 'results-v1' || !Array.isArray(report.rows)) throw new Error('invalid-results');
  const readme = await readFile('README.md', 'utf8');
  const start = '<!-- results:start -->', end = '<!-- results:end -->';
  if (!readme.includes(start) || !readme.includes(end)) throw new Error('missing-readme-markers');
  await writeFile('README.md', readme.slice(0, readme.indexOf(start) + start.length) + '\n' + renderReport(report) + readme.slice(readme.indexOf(end)));
}
main().catch(() => { console.error('README results rendering refused'); process.exitCode = 1; });
