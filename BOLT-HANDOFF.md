# Bolt handoff — inspection/preparation only

Target: **No database**. React 18 + strict TypeScript + Vite browser app. No functions, auth, storage, server, external model service or secrets are required. This source does not provision infrastructure. Runtime readiness is unverified.

Repo root is this inner folder. Local-only Git, no remote; no import, push, publication or deploy is authorized. Dependencies are declared, not installed; no lockfile exists. After Roy closes Dirty Mode, generate and commit the lockfile with `npm install`; future builds use `npm ci && npm run build`, output `dist/`. Node20+ is the intended app baseline; source syntax parsing used Node24 erasable type stripping. Confirm actual version compatibility during validation.

Inventory: closed parser/contracts, generator source and smoke fixtures, local anonymisation strategies, deterministic evaluator/scoring/probes, guarded offline runner, hash-bound recording importer, local worker UI and aggregate-only export. Tests are authored but not executed. No generated dev split/results or external recordings exist. Held-out authoring and tool admission are owner prerequisites, never Bolt's job.

External steps: Roy R1 approval for offline Python/Java recorders and placement; R2 independent author; R5 runtime closure; R6 remote/visibility. Recorder source remains a text specification in docs/RECORDING. No database migrations, edge functions, buckets, policies, environment settings or provider keys: **Not required**.

Future inspection prompt (not submitted):

> Inspect the repository root and BOLT-HANDOFF.md. Preserve the no-database architecture and local-only processing. Do not provision services, request secrets, import held-out data or publish. First report missing dependencies/lockfile and unverified runtime checks. Once the owner authorizes validation, run npm ci, typecheck, lint, tests and build against the committed lockfile; verify the worker timeout/cancel, safe text rendering, no outbound application requests after asset load, and aggregate download excludes raw data/keys/maps/filenames. Correct concrete compatibility gaps only. Do not invent results or change frozen experiment inputs.
