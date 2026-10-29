# Acceptance matrix

PLAN.md row 25. Every criterion lists its evidence file and two statuses: **static** (checkable without executing project code;
`checked` means the builder performed the check named in the evidence column, `pending` means not yet) and **runtime** (needs
installed tooling or execution; `pending` until it has actually run, with its command in `docs/DEFERRED-VALIDATION.md`). Dirty
Mode is active: no runtime item is `pass`. A reviewer's independent check is recorded separately by S43-INT, not here.

## M1 — template, closed grammar, parser, contracts, identity + naive, UI slice

| # | Criterion (PLAN.md §7 M1) | Evidence | Static | Runtime |
|---|---|---|---|---|
| 1 | One parser test file per supported construct, plus unknown-line passthrough, caps and wrong-direction ACL parsed as written | `tests/parser/*.test.ts` (22 construct files named in `SUPPORTED_CONSTRUCTS`, `unknownPassthrough`, `forwardingKeywords`, `caps`, `wrongDirectionAcl`, `grammarRegistry`) | checked (files exist; registry→file check by data-only script) | pending (D10) |
| 2 | `docs/GRAMMAR.md` lists every supported construct and the forwarding-affecting keyword list; each construct has a parser branch | `docs/GRAMMAR.md`, `src/core/grammar.ts`, `src/core/parser.ts` | checked (keyword lists identical, 64 entries; every construct id in the doc; branches by inspection) | pending (D10 `grammarRegistry.test.ts`) |
| 3 | Caps in `src/core/limits.ts` equal §3 | `src/core/limits.ts`, `docs/GRAMMAR.md` "Limits" | checked (constants listed by grep) | pending (D10 `caps.test.ts`) |
| 4 | `docs/SEMANTICS.md` states rows 7–9 in substance | `docs/SEMANTICS.md` | checked (inspection) | n/a |
| 5 | `src/core/expected.ts`, `manifest.ts`, `labels.ts` and their schemas match rows 38, 41, 42 | `src/core/{expected,manifest,labels,ledger,sidecar}.ts`, `schemas/*.schema.json` | checked (inspection) | pending (D3 type check, D14 schema validation) |
| 6 | `docs/AUTHOR-BRIEF.md` covers every row 43 item | `docs/AUTHOR-BRIEF.md` | checked (inspection, item by item) | n/a |
| 7 | Ledger schema has `location`; ledger-validate checks name spans (row 41) | `schemas/ledger.schema.json`, `src/core/ledgerValidate.ts`, `scripts/ledger-validate.ts` | checked (inspection) | pending (D11, D13) |
| 8 | Smoke cases obey row 31 and §3 caps | `fixtures/smoke/*`, `fixtures/smoke/README.md` | checked (inspection: /24 and /30 interfaces, host offsets, ≤1 static default, unique names, config-present endpoints, no flow across a shut interface; ≤8 devices, ≤64 entities) | pending (D10 smoke parse in `unknownPassthrough.test.ts`, D18 Batfish) |
| 9 | Reviewer recomputes ≥10 ledger spans against the config bytes | `fixtures/smoke/*/ledger.json` | builder pre-check done (data-only script: 269/269 spans match, 0 partial overlaps); reviewer recomputation pending | n/a |
| 10 | UI renders config text only via React text nodes (no `dangerouslySetInnerHTML`, no `innerHTML`) | `src/ui/App.tsx`; grep over `src/` | checked (grep: no match) | pending (D16 browser check of the planted `<script>`) |
| 11 | naive-mask follows rows 30/41 and imports nothing from `core/ledger`, `core/sidecar`, `core/labels`, `core/expected`, `src/eval`, `src/gen`, `fixtures` | `src/strategies/naiveMask.ts`; grep of its imports | checked (grep: imports are `./types`, `../core/model`, `../core/parser`, `../core/ipv4` only) | pending (D12, D8) |
| 12 | `eslint.config.js` has the row 28 ban with `src/ui/assets.ts` the only exemption, and the row 44 `child_process` ban | `eslint.config.js` | checked (inspection) | pending (D4–D8) |
| 13 | Every `.ts` parses | all `.ts`/`.js` files | checked — 52/52 via Node's `stripTypeScriptTypes` + `node --check` on the stripped `.mjs` (plain `node --check file.ts` is not evidence here; see DEFERRED-VALIDATION). `.tsx` by inspection only | pending (D3) |
| 14 | Every JSON file parses | all 16 `.json` files | checked (`JSON.parse`) | pending (D14 schema validation) |
| 15 | Worker runs strategies with a 5 s deadline and Cancel; timeout is an error | `src/ui/worker.ts`, `src/ui/App.tsx` | checked (inspection) | pending (D17) |
| 16 | Banner text of row 27 shown verbatim | `src/ui/App.tsx` `BANNER_TEXT` | checked (inspection) | pending (D16) |
| 17 | No secrets, no backend, no database, `.env.example` holds one comment | repo root | checked (inspection) | n/a |

## M2–M6 source acceptance

Runtime for every row below is **pending**. Static construction acceptance is separately recorded after reviewer disposition in outer STATUS.md; these rows identify inspected source and deferred commands, not executed product claims.

| Package | Criteria / evidence | Static | Runtime |
|---|---|---|---|
| M2 | Four topology families, seeded streams, 22 named planting traps, cap/span audits, exact32/0 flows; `src/gen/*`, `scripts/gen-dev.ts`, `schemas/pool.schema.json`, `tests/gen/*` | checked by source inspection + separate static review | pending M2 commands |
| M3 | Purpose-separated HKDF; raw-key Crypto-PAn; bijections and typed constants; label-free detector/operator list; ordinal correspondence/collisions; `src/strategies/*`, `src/detect/*`, `src/core/operatorList.ts`, `src/eval/correspondence.ts` | coder inspection and import/exposure grep clean; separate static review PASS | pending M3 commands |
| M3 | yacryptopan active vector and skipped Yawning vector attribution; base custody sentinel | tests and REUSE present; Yawning deferred explicitly | pending vectors/full-pool tests/sentinel |
| M4 | Routing precedence/dispositions, five findings, scheduled/evaluable denominators, leakage variants, counts/N/A, seeded paired resampling and probes; `src/eval/*` and literal tests | checked by source inspection + separate static review | pending M4 tests |
| M4 | Guarded runner, immutable preregistration and role/hash-only receipts; `scripts/{eval,preregister,freeze-check,custody}.ts`, `schemas/{preregister,preflight-receipt}.schema.json` | checked by source inspection + separate static review | pending G0/G1/G2, hash/schema/gate tests |
| M5 | RecordingBundleV1 type/schema/validator, raw re-normalisation, version/help/source/key/input pins, missing or tampered = not_run; `src/eval/{recordings,normalise,recorded}.ts`, `tests/eval/recordings.test.ts` | coder JSON/syntax/process-ban inspection clean; separate static review PASS | pending M5 commands |
| M5 | Recorder text spec only; no driver source, no process spawning; EvidencePanel safe projection | docs/RECORDING + tools/record README; mounted M6 | pending native tool compatibility / R1 |
| M6 | All local arms in cancellable worker; text-only original/output highlights; paste heuristics only; evaluator/evidence/results separation | checked by source inspection + separate static review | pending browser/build/type/lint |
| M6 | Aggregate allowlist with neutral filename; no configs, filenames, raw leaks, keys or maps | download.ts + tests/ui/download.test.ts + custody extension | pending sentinel/browser export |
| M6 | Author packet schemas/docs only; vault/practice-handoff READMEs only; G0/G1/G2 pending; no database/functions/secrets and honest Bolt handoff | checked by source inventory + separate static review | pending Roy gates and all runtime acceptance |

## Construction disposition

M1–M6 source packages passed separate static review and are accepted **for Dirty Mode construction — runtime unverified**. The final syntax check parsed112 TS/JS files and20 JSON files; six TSX files were inspected only. No install, typecheck, lint, tests, build, browser, generator, external recorder or experiment ran. G0/G1/G2 remain PENDING, including independent non-builder authorship. This matrix does not establish product/runtime readiness or output safety.
