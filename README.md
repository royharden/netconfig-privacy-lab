# netconfig-privacy-lab

A local research workbench for synthetic IOS-style configuration anonymisation. It compares residual identifiers and network utility without combining them into a safety score.

**Dirty Mode construction. Runtime unverified.** Dependencies were not installed. No typecheck, lint, tests, build, browser, generator, recorder or experiment has run. There are no measured results. No output is safe to share.

Source includes a closed parser/contracts, four-family dev/decoy generator, identity/naive/random-consistent/lab scrub/drop strategies, Crypto-PAn and HKDF primitives, ordinal correspondence, evaluator/findings/leakage/utility/probes/bootstrap, hash-bound recording importer, guarded runner and worker UI with aggregate download. Tests are source only. The UI is a local preview; pasted synthetic text gets public-pattern heuristics only.

## Validate later

Roy must close Dirty Mode first. Then `npm install` creates the pending lockfile; commit it and use `npm ci` afterward. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` (output `dist/`). Browser checks need a claimed port. Exact commands and outstanding assumptions: [DEFERRED-VALIDATION](docs/DEFERRED-VALIDATION.md).

There is **no database, no functions, no backend, no secrets, no model call and no account requirement**. See [BOLT-HANDOFF](BOLT-HANDOFF.md); this private fresh-history snapshot excludes fixture and Gold data and is not an activation or publication approval.

## Experiment admission

[G0/G1/G2](docs/G0.md) are PENDING. Offline external recorders require Roy R1. An independent non-builder author must supply held-out and two practice cases (R2). Recorders are text specification only; no Python/Java/Docker source or execution is included. Missing/tampered evidence stays `not_run`; zero support is `N/A`. The guarded held-out runner requires frozen hashes, candidate/tag, lockfile, preregistration and preflight; it refuses confirmatory reruns. Builder smoke data is never scored.

[GRAMMAR](docs/GRAMMAR.md) · [SEMANTICS](docs/SEMANTICS.md) · [RECORDING](docs/RECORDING.md) · [AUTHOR-BRIEF](docs/AUTHOR-BRIEF.md) · [LIMITATIONS](docs/LIMITATIONS.md) · [REUSE](docs/REUSE.md) · [ACCEPTANCE](docs/ACCEPTANCE.md).

<!-- results:start -->
Results: **not_run — admission gates and runtime validation pending**.
<!-- results:end -->

Only `scripts/render-readme.ts` writes result numbers into this section from immutable result bytes. No privacy/safety claim is made for real configurations. Code MIT; independently authored synthetic corpus intended CC0-1.0 with author provenance pending.

## Fresh-history snapshot

The private snapshot excludes all fixture and Gold trees, including the synthetic evaluation key, plus environment files and agent instructions. Tests or workflows requiring those files cannot run as-is. Original local history and data remain separate and untouched. Runtime validation and the listed owner gates remain open.
