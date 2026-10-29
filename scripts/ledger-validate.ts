/**
 * ledger-validate (PLAN.md §4, row 41; author packet item, row 43).
 *
 *   npm run ledger-validate                       # validates fixtures/smoke/*
 *   npx tsx scripts/ledger-validate.ts <dir>...   # each <dir> is a case directory (holds case.json) or a parent of case dirs
 *
 * A pure string check: for every ledger occurrence (location 'line' or 'name') and every labelled span, the stated text must
 * sit exactly at its span in the line or the file's display name. No config grammar is parsed. Output lists codes and positions
 * only (never occurrence text), so it can be pasted into a receipt. Exit code 1 when any issue is found.
 * Uses only node:fs and node:path; never spawns a process (row 44).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ConfigFileInput } from '../src/core/types';
import { parseSidecar } from '../src/core/sidecar';
import { parseLedger } from '../src/core/ledger';
import { parseLabels } from '../src/core/labels';
import { decodeUtf8Strict } from '../src/core/limits';
import type { SpanIssue } from '../src/core/ledgerValidate';
import { validateLabelSpans, validateLedgerSpans } from '../src/core/ledgerValidate';

function caseDirs(root: string): string[] {
  if (existsSync(join(root, 'case.json'))) return [root];
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((dir) => statSync(dir).isDirectory() && existsSync(join(dir, 'case.json')))
    .sort();
}

function readText(path: string): string | null {
  return decodeUtf8Strict(readFileSync(path));
}

function readJson(path: string): unknown {
  const text = readText(path);
  if (text === null) throw new Error(`${path}: not valid UTF-8`);
  return JSON.parse(text) as unknown;
}

function formatIssue(caseLabel: string, source: string, issue: SpanIssue): string {
  const parts = [`${caseLabel} ${source}: ${issue.code}`];
  if (issue.entityId !== null) parts.push(`entity=${issue.entityId}`);
  if (issue.fileId !== null) parts.push(`file=${issue.fileId}`);
  if (issue.ordinal !== null) parts.push(issue.ordinal === 0 ? 'location=name' : `line=${issue.ordinal}`);
  if (issue.index !== null) parts.push(`index=${issue.index}`);
  return parts.join(' ');
}

/** Returns the number of problems found in one case directory. */
function validateCaseDir(dir: string): number {
  const label = dir;
  const sidecar = parseSidecar(readJson(join(dir, 'case.json')));
  if (!sidecar.ok) {
    for (const i of sidecar.issues) console.error(`${label} case.json: ${i.path} ${i.message}`);
    return sidecar.issues.length;
  }
  const files: ConfigFileInput[] = [];
  let problems = 0;
  for (const f of sidecar.value.files) {
    const text = readText(join(dir, f.path));
    if (text === null) {
      console.error(`${label} ${f.path}: not valid UTF-8`);
      problems++;
      continue;
    }
    files.push({ fileId: f.fileId, name: f.name, text });
  }

  const ledger = parseLedger(readJson(join(dir, 'ledger.json')));
  let occurrences = 0;
  if (!ledger.ok) {
    for (const i of ledger.issues) console.error(`${label} ledger.json: ${i.path} ${i.message}`);
    problems += ledger.issues.length;
  } else {
    for (const e of ledger.value.entities) occurrences += e.occurrences.length;
    const issues = validateLedgerSpans(ledger.value, files, sidecar.value.caseId);
    for (const i of issues) console.error(formatIssue(label, 'ledger.json', i));
    problems += issues.length;
  }

  let labelCount = 0;
  if (existsSync(join(dir, 'labels.json'))) {
    const labels = parseLabels(readJson(join(dir, 'labels.json')));
    if (!labels.ok) {
      for (const i of labels.issues) console.error(`${label} labels.json: ${i.path} ${i.message}`);
      problems += labels.issues.length;
    } else {
      labelCount = labels.value.benignSpans.length + labels.value.freeTextTokens.length;
      const issues = validateLabelSpans(labels.value, files, sidecar.value.caseId);
      for (const i of issues) console.error(formatIssue(label, 'labels.json', i));
      problems += issues.length;
    }
  }

  if (problems === 0) {
    const entities = ledger.ok ? ledger.value.entities.length : 0;
    console.log(`OK ${sidecar.value.caseId}: ${entities} entities, ${occurrences} occurrences, ${labelCount} labelled spans`);
  }
  return problems;
}

function main(argv: readonly string[]): number {
  const roots = argv.length > 0 ? argv : ['fixtures/smoke'];
  const dirs = roots.flatMap((r) => caseDirs(resolve(r)));
  if (dirs.length === 0) {
    console.error(`ledger-validate: no case directories found under ${roots.join(', ')}`);
    return 1;
  }
  let problems = 0;
  for (const dir of dirs) problems += validateCaseDir(dir);
  console.log(`ledger-validate: ${dirs.length} case(s), ${problems} problem(s)`);
  return problems === 0 ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
