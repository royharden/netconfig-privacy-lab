# Author brief: independent held-out and practice cases

For the independent author appointed by Roy (ROY-DECISIONS R2; PLAN.md row 43). Until Roy appoints an author this brief is
unused and G0 item 3 / G1 stay PENDING. The builder lineage (S43-INT and its subagents) never writes, reads or checks held-out or
practice data, labels or expected answers. You receive only the author packet (this brief, `GRAMMAR.md`,
`PLANTING-PROTOCOL.md`, `SEMANTICS.md`, the five schemas, `scripts/ledger-validate.ts` usage and the Batfish parse recipe). You
never receive strategy code, generator vocabulary, dev outputs or scores. Do not use the builder's generator; write every case by
hand.

## What to write

1. **24 held-out cases**, per family **5 semantic-positive + 1 unsupported challenge**:
   - families: **ring** (exactly one shut link), **hub-and-spoke**, **campus tree**, **dual-ISP edge** (static defaults);
   - **3–8 devices** per case.
   - An unsupported challenge contains at least one forwarding-affecting unknown line (`GRAMMAR.md`); it gets configs,
     `case.json` (with `flows: []`), `ledger.json` and `labels.json`, and **no** `expected.json`.
2. **2 practice cases** (semantic-positive; rehearsal only, never scored) with the same files as a positive case.
3. Obey every **row 31 constraint** (`PLANTING-PROTOCOL.md` "Placement constraints") and the caps in `GRAMMAR.md`.
4. **Exactly 32 scheduled flows** per semantic-positive case in `case.json`, with **config-present endpoints** (interface
   addresses, ACL `host` entries, static next hops). Mix delivered, denied and no-route outcomes; each case should exercise at
   least one ACL deny that decides a scheduled flow.
5. Per semantic-positive held-out **and** practice case: **5 hand-derived expected flows** (disposition, ordered node IDs, ordered
   interface hops, deciding ACL entry ordinal or null) and the **five-finding table**, in `expected.json`
   (`schemas/expected.schema.json`), derived by hand against `SEMANTICS.md`. `expected.json` exists only for those cases.
6. Plant identifiers, look-alikes and traps per `PLANTING-PROTOCOL.md`, with **different seeds, names, address plans and text
   templates from the protocol's and the smoke fixtures' examples** (invent your own organisations, people and hostnames).
7. **Opaque file paths** (`h01/n01.cfg`, `h01/case.json`, ...) and opaque case IDs. A file-name trap lives only in
   `case.json` `files[].name`.
8. Write `MANIFEST.json` (`schemas/manifest.schema.json`, `split: "heldout"`) listing every vault file except itself exactly
   once, with roles and SHA-256 hashes; `PROVENANCE.md` is a `vaultFiles` entry with role `provenance`.
9. **Validate** every case: `npx tsx scripts/ledger-validate.ts <vault-dir>` must report 0 problems; then run the Batfish parse
   recipe (`fileParseStatus = PASSED`, no unexplained `initIssues`, connected/static/local-only RIB) on every semantic-positive
   original. The Batfish recipe needs Roy's R1 answer; until then that step is PENDING and you record it as such.
10. **Licence and provenance:** grant the corpus under **CC0-1.0** and record the authorship grant, your callsign, date and model
    in `PROVENANCE.md` (state that nothing was copied from real, client or third-party configs).

## Where to put it and what to hand over

- Write the held-out cases, `MANIFEST.json` and `PROVENANCE.md` into the outer-shell vault `heldout-vault/` (never the repo).
- **Copy the 2 practice cases**, with their **own** `MANIFEST.json` (`split: "practice"` only), into the outer-shell folder
  `practice-handoff/`; the builder commits them to `fixtures/practice/` at G1.
- **Hand over the SHA-256 of the held-out `MANIFEST.json`** (it becomes `gold/heldout/MANIFEST.sha256` at G1). Hand over nothing
  else from the vault.
- **The builder never reads vault contents.** Only `scripts/freeze-check.ts` reads vault files, and it emits receipts with case
  IDs, roles and hashes only (row 42d); label files are hashed, never parsed, by the label-blind preflight.
- An optional checker session (if Roy appoints one) may re-derive the expected flows of 4 sampled cases before freeze; you fix
  any disagreement before freezing.
