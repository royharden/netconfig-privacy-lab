# Deferred validation

Dirty Mode is active (Roy, 2026-10-27): nothing below has run. Each entry says what, why it is deferred, and the exact later
command. Run from the repo root after Dirty Mode closes (ROY-DECISIONS R5). Every later milestone appends its own entries. Nothing
here may be marked passed in `docs/ACCEPTANCE.md` until it has actually run.

## Static checks that WERE run in M1 (for reference)

- Syntax parse of every `.ts`/`.js` file: Node 24's `node --check file.ts` turned out NOT to type-strip in check mode here (it parses
  `.ts` as plain JS, and exits 0 on any file containing `import`/`export` even with a syntax error), so it is not evidence. The
  check actually used: `module.stripTypeScriptTypes(src, { mode: 'strip' })` (Node's built-in parser; rejects TS syntax errors
  and non-erasable syntax such as `enum`), output written to a scratch `.mjs`, then `node --check` on that `.mjs`. 52/52 files
  passed; probe files with a syntax error and with an `enum` were rejected. `.tsx` files cannot be parsed this way (inspected).
- `JSON.parse` on all 16 JSON files: passed. Data-only span check of all smoke ledger/labels spans: 269/269 match.

## M1 deferred items

| # | What | Why deferred | Exact later command |
|---|---|---|---|
| D1 | Install dependencies and create the lockfile | Dirty Mode: no installs; lockfile pending R5 | `npm install` (then commit `package-lock.json`; later builds use `npm ci`) |
| D2 | Confirm the declared dependency ranges resolve and peer ranges agree (typescript-eslint vs TypeScript 5.8, vitest 2 vs Vite 5) | needs the registry | `npm install` then `npm ls --all` (no `ERESOLVE`/peer warnings) |
| D3 | Type check, including `.tsx` (never parsed in M1) and `erasableSyntaxOnly`/`verbatimModuleSyntax` | no `tsc` | `npm run typecheck` |
| D4 | Lint | no ESLint | `npm run lint` |
| D5 | Row 28 ban fires in `src/` and not in `src/ui/assets.ts` | no ESLint | `echo "fetch('x');" \| npx eslint --stdin --stdin-filename src/core/probe.ts` (expect `no-restricted-globals` error); `echo "localStorage.x = 1; navigator.sendBeacon('/');" \| npx eslint --stdin --stdin-filename src/ui/probe.ts` (expect errors); `echo "export const a = 1;" \| npx eslint --stdin --stdin-filename src/ui/assets.ts` (expect clean) |
| D6 | HTML-sink ban fires | no ESLint | `echo "export const P = () => <div dangerouslySetInnerHTML={{ __html: '' }} />;" \| npx eslint --stdin --stdin-filename src/ui/Probe.tsx` and `echo "document.body.innerHTML = 'x';" \| npx eslint --stdin --stdin-filename src/ui/probe.ts` (expect errors) |
| D7 | Row 44 process ban fires in `src/`, `scripts/`, `tools/` | no ESLint | `for p in src/core/probe.ts scripts/probe.ts tools/probe.ts; do echo "import 'node:child_process';" \| npx eslint --stdin --stdin-filename $p; done` (expect three errors) |
| D8 | Custody import ban fires for strategies | no ESLint | `echo "import '../core/ledger';" \| npx eslint --stdin --stdin-filename src/strategies/probe.ts` and the same with `../core/sidecar`, `../core/labels`, `../core/expected`, `../eval/x`, `../gen/x`, `../../fixtures/smoke/s01/case.json` (expect errors) |
| D9 | All unit tests | Dirty Mode: no vitest | `npm test` |
| D10 | Parser tests: one per construct, unknown passthrough, forwarding keywords, caps, wrong-direction ACL, registry/doc consistency | no vitest | `npx vitest run tests/parser` |
| D11 | ledger-validate unit tests and the three smoke fixtures | no vitest | `npx vitest run tests/core/ledgerValidate.test.ts` |
| D12 | identity and naive-mask tests | no vitest | `npx vitest run tests/strategies` |
| D13 | ledger-validate script on the smoke fixtures | no `tsx` | `npm run ledger-validate` (expect three `OK s0N` lines and `0 problem(s)`) |
| D14 | JSON Schema validation of the smoke fixtures against the 2020-12 schemas (and that the schemas themselves compile) | no ajv; network | `npx --yes ajv-cli@5 validate --spec=draft2020 -s schemas/case.schema.json -d "fixtures/smoke/*/case.json"`, then the same for `ledger` and `labels` (`expected`/`manifest` have no M1 instances: compile only with `npx --yes ajv-cli@5 compile --spec=draft2020 -s schemas/expected.schema.json` and `.../manifest.schema.json`) |
| D15 | Production build; Vite `import.meta.glob` with `query: '?raw'` and JSON named-export imports (`import: 'files'`) in `src/ui/assets.ts` | no Vite | `npm run build` (expect `dist/`; then grep `dist/assets/*.js` for `"flows"` — expected absent if named-export tree-shaking works; if present, record it, it is synthetic fixture data) |
| D16 | Browser check of the UI slice: loads, banner text, identity and naive diffs for s01–s03, the planted `<script>alert(1)</script>` shown as text with no alert, Cancel works, no network request after asset load | no dev server/browser | claim a port first (`agent-ports` skill: `python <skills>/agent-ports/scripts/ports.py claim ...`), then `npm run dev -- --port <claimed> --strictPort`; open DevTools Network, run each arm on each case |
| D17 | Worker 5 s hard deadline (App.tsx terminates the worker) and timeout = error; Cancel terminates the run | needs a browser; the smoke cases finish far below 5 s | in the D16 session, set DevTools CPU throttling to the slowest preset and run naive-mask on s02 (expect the timeout message and no output if it exceeds 5 s), press Cancel during a run (expect "Cancelled", no output); an automated check is planned with the M6 browser tests |
| D18 | Batfish parse of the three smoke configs (`fileParseStatus = PASSED`, no unexplained `initIssues`, connected/static/local-only RIB) and the intended smoke dispositions | needs R1 (Python/Docker) and G0 | per `docs/RECORDING.md` (M5) once R1 is answered |
| D19 | CI workflow `.github/workflows/ci.yml` (tsc, eslint, vitest, build) | PLAN.md row 32: deferred, no remote | write after Dirty Mode closes; run `npm ci && npm run typecheck && npm run lint && npm test && npm run build` |
| D20 | `npm run eval` | M4 source now exists; execution remains forbidden until R5 | after M4: `npm run eval -- --split dev` |
| D21 | `scripts/ledger-validate.ts` on a vault directory layout (`h01/…`) | no held-out data exists; author-side use | author runs `npx tsx scripts/ledger-validate.ts <vault-dir>` (AUTHOR-BRIEF item 9) |

## M2–M6 construction validation (all runtime pending)

| Package | What remains unverified | Exact later step after R5 closure |
|---|---|---|
| M2 | PRNG determinism, 4 families × 3–8 nodes, traps, ledger/label spans, topology constraints, flow quotas | `npx vitest run tests/gen` |
| M2 | Generate dev 8+4 and 49 decoys per family/count cell; generator source has never run | `npx tsx scripts/gen-dev.ts --dirty-mode-closed --seed 4302 --generator-commit <actual-generator-commit> --mode both` |
| M3 | HKDF, Crypto-PAn yacryptopan vector, prefix invariance, filename renaming, ASN pool bijections, random-consistent, @key2, ordinal correspondence | `npx vitest run tests/strategies tests/detect tests/eval/correspondence.test.ts` |
| M3 | Yawning conformance vector: deliberately skipped; only key prefix is known | Copy full 32-byte key from a pinned Yawning/cryptopan source revision, record source hash in REUSE, enable the skipped vector, then `npx vitest run tests/strategies/cryptopan.test.ts` |
| M3/M4/M6 | Custody sentinel: worker, Outcome, errors/console/storage, runner/report/download | `npx vitest run tests/custody` |
| M4 | Literal routing networks, findings, leakage variants, utility mutations, paired bootstrap and probes | `npx vitest run tests/eval/evaluator.test.ts tests/eval/metrics.test.ts` |
| M4 | Label-blind hash/schema check and manifest completeness; no vault data exists | Roy-appointed author supplies vault and pin; `npx tsx scripts/freeze-check.ts --g1 <vault>` then `npx tsx scripts/freeze-check.ts --preflight <vault>` |
| M4 | Candidate/preregistration/corpus binding; no lockfile or G1 exists | After candidate lightweight tag and lockfile: `npx tsx scripts/preregister.ts <vault> <40-char-candidate> <tag> <public-choices.json>` |
| M4 | Development execution and report re-render | After dev generation: `npm run eval -- --split dev`, then `npx tsx scripts/render-readme.ts results/dev.json` |
| M4 | Held-out gates, no rerun, oracle agreement | After G0/G1/G2 actually pass: `npm run eval -- --split heldout --vault <vault>`; an existing opening record must refuse a second confirmatory execution |
| M5 | Recording schema, raw re-normalisation, expected input/source/key/help/version pins and tamper rejection | `npx vitest run tests/eval/recordings.test.ts` |
| M5 | Import real recordings only after R1 admission and validated external interchange | `npx tsx scripts/verify-recordings.ts <bundle.json> <independent-expectation.json>`; see RECORDING for G0 version/help/parse checks |
| M6 | React/TSX, bundled assets/results, responsive UI, accessibility, safe text rendering, cancel/timeout | `npm run typecheck && npm run lint && npm test && npm run build`; then claimed-port browser session per D16 with all local arms, smoke cases and paste inspection |
| M6 | Aggregate allowlist and fixed filename, no raw value/map/key/filename exposure | `npx vitest run tests/ui/download.test.ts tests/custody`; inspect browser aggregate download |
| All | CI, runtime compatibility, lockfile and actual cryptographic behavior | R5 closure first, D1–D19 above. No benchmark, experiment or external tool was run in construction. |

M2/M3/M5 coder static checks reported 0 syntax failures; final integration source inspection and independent milestone reviews are tracked by the integrator in outer STATUS.md. Plain node --check of .ts is never accepted evidence. A source PASS does not establish runtime behavior. No external vector was fetched during construction.


M5 JSON Schema validation after R5: `npx --yes ajv-cli@5 compile --spec=draft2020 -s schemas/recording.schema.json`, then `npx --yes ajv-cli@5 validate --spec=draft2020 -s schemas/recording.schema.json -d <recording-bundle.json>` on a real R1-approved bundle. Schema validation alone does not verify input/source/key hashes; also run `npx tsx scripts/verify-recordings.ts <bundle.json> <independent-expectation.json>`. No recording instance exists now; schema compilation and instance validation both remain pending.

## Integration regression checks after M4/M6 review

- Candidate guard uses verified loose Git commit/tree/blob objects to compare committed source and synthetic evaluation-key bytes, rejecting dirty/missing/untracked selected files, links, corrupt objects and unavailable packed objects. For packed-only Git history it fails closed; make the authorized candidate's objects available locally before activation. No source/key bytes were read by running this guard during construction.
- Preregistration strict schema and exact held-out/flow/probe/pool/corpus selections: `npx vitest run tests/custody/preregister.test.ts tests/custody/guard.test.ts` after R5.
- Full trace/static-loop/ACL+reference mutations, failed/missing scheduled denominators, numeric contexts, repeated-token retention, varying-cluster resampling, report tables: `npx vitest run tests/eval/evaluator.test.ts tests/eval/metrics.test.ts tests/eval/results.test.ts`.
- UI source/evidence/table regression: `npx vitest run tests/ui/results.test.tsx tests/ui/download.test.ts`.
- Batfish trace port source expects the recorder envelope's answer to retain native disposition plus stable nodeIds/interfaceHops/aclDecision. Unknown native versions/shapes yield not_run; R1/G0 must validate the actual adapter against raw native answers before any claim. `npx vitest run tests/eval/oracle.test.ts`; verify real original/output bundle pairs through the importer after R1.
- Retention aligns stable file ID/line ordinal, then requires unique unchanged contiguous span mapping across all optimal edits. Earlier name-length shifts can preserve labelled text; repeated-token ambiguities and oversized (>2m cells) alignments count changed. Verify positive-shift and repeated-token regressions before interpreting rates.


M6 worker race check (deferred browser validation): switch fixture/mode or press Cancel/timeout while an old worker response/error is queued, then start another run. Request-generation guards must discard all old events; no old-case output may reappear. This is a source-inspection correction; no browser execution has occurred.

Final M4 safe runner boundary regression (source authored; execution pending): `npx vitest run tests/eval/runner.test.ts tests/custody/report.test.ts`. Covers missing/error scheduled denominators, challenge utility exclusion, sentinel exception/report sinks, recorded-argument binding and prefix-mismatch availability. Probe A freezes only full host-address roles; canonicalised route/ACL prefix bases are excluded from full32-bit inference to avoid false constraints. Pair selection and targets use the same label-free helper.

## Final static syntax receipt

The final integration parser (Node built-in stripTypeScriptTypes plus unlinked/unevaluated VM module construction) parsed **112** TS/JS modules with **0 failures**. One earlier pass failed a postfix-nonnull/equality tokenisation typo in leakscore; corrected and rerun successfully. JSON syntax: **20** files parsed. Whitespace diff check: clean. Six TSX files received source inspection/review only. These checks execute no project module and do not substitute for typecheck/lint/tests/build/browser/cryptographic validation. All runtime items above remain pending.
