# Recording specification — unexecuted

R1 (Python/Java tools and placement), R1b (operator), G0 admission and Dirty Mode closure remain pending. This is a text specification, not executable recorder source. No external-tool recording or normalization compatibility has been tested.

## Netconan options

The following argument arrays are **unverified until `--help` is captured at G0**. They omit the executable, whose approved installation and version are still unknown. Input/output path switches and the salt switch are deliberately unresolved rather than invented; G0 must replace placeholders with the pinned help's actual syntax and freeze the complete arrays before recording.

* minimal: `["-a", "-p", "<verified-salt-switch>", "s43-synthetic-salt-v1", "<verified-input-switch>", "<input-directory>", "<verified-output-switch>", "<output-directory>"]`
* operator: the same array plus `["-w", "<operator-word-list>", "-n", "<operator-asn-list>"]`
* ledger-informed: the same minimal array plus `["-w", "<ledger-word-list>", "-n", "<ledger-asn-list>"]`

The ledger-informed arm has an explicit information advantage. Use one identical original input byte set for all three configurations; capture a repeated smoke recording of one configuration to check determinism. The `-d` map is only a private correspondence cross-check in a test, never report evidence or exported output. File IDs stay stable even when output display names change.

Operator extraction follows `src/core/operatorList.ts`: read config text only, collect hostname, domain, BGP router/remote-as values and neighbor descriptions under that frozen rule; no ledger, sidecar, labels, generator vocabulary or filenames. Freeze exact extraction output and arguments. Never substitute a guessed tool flag for an unresolved placeholder.

## Batfish query recipe

Pin the image digest and pybatfish version. Capture `fileParseStatus` (original files must PASSED), `initIssues` (no unexplained issues), `routes` (connected/static/local only), one `traceroute` per scheduled flow, `testFilters` per ACL decision, `undefinedReferences`, and `ipOwners`. Traceroute parameters explicitly contain mapped ingress node/interface, all headers and `ignoreFilters=false`; never use differential reachability on renamed headers. Freeze the exact query JSON in the expectation. Record original and every arm output, including parse failures. Empty answers must be retained as an empty native answer in an explicit summary row.

## Closed interchange

`RecordingBundleV1` in `src/eval/recordings.ts` and `schemas/recording.schema.json` define the same closed shape. It retains tool/version; image/package pins; pybatfish pin; exact captured version/help text and hashes; argument arrays; query JSON; effective options; synthetic salt/key ID and `synthetic-evaluation` scope; all stable-ID input/output display names, texts and text-byte SHA-256; raw answers and their exact UTF-8 SHA-256; normalizer version and rows; process exit status; elapsed milliseconds; operator callsign; UTC date; case/arm/split; candidate commit; and recorder source SHA-256. Key ID is a label, never key material.

Raw answer string format is `{ "schema": "raw-recording-v1", "answers": [{ "query": "traceroute", "rowId": "f01", "answer": { "disposition": "ACCEPTED", "native": {} } }] }`. The offline adapter must preserve each complete native JSON answer under `native`; traceroute's disposition is extracted from that native answer, and the source-pinned recorder must be reviewed against actual pinned tool outputs at G0. Other query rows retain their native JSON directly. The importer cannot prove the honesty of a recorder or tool: hashes detect changes against independently frozen pins. Native parsing compatibility and this extraction remain deferred G0 validation.

Netconan raw answers use query `output`, rowId equal to stable fileId, answer exactly `{ "name": "display.cfg", "text": "output bytes decoded as strict UTF-8" }`. Its declared queries include `output`. Batfish rows use the seven query names above. Query/rowId pairs are unique. An empty query response uses a stable `summary` row with an empty JSON answer; it is never silently omitted. A traceroute rowId is the frozen scheduled flow ID.

The normalizer parses retained raw JSON, canonicalizes native object keys recursively, preserves arrays, sorts rows by query/rowId, and maps raw dispositions: ACCEPTED → delivered; DELIVERED_TO_SUBNET → delivered-to-subnet; DENIED_IN/OUT → deny-in/out; NO_ROUTE → no-route; LOOP → loop; EXITS_NETWORK → exits-network; NEIGHBOR_UNREACHABLE, INSUFFICIENT_INFO and all other values → unsupported. Raw strings remain retained. Evaluator activity, next-hop, undefined-ACL, ambiguous-name and hop-limit behavior is specified in SEMANTICS.md; disagreements are named modelling gaps, never repaired in the normalizer.

The importer compares independently frozen expectation pins, exact input bytes and names, input/output hashes and file sets, raw/version/help hashes, and reconstructs all normalized rows from raw answers. For netconan it also compares every output with the raw output entry. Rejected/missing bundles yield `not_run`; Batfish evidence is validated separately and never impersonates a strategy output. `verify-recordings.ts` accepts bundle and independently frozen expectation paths and reads only those files; it follows no embedded path and starts no process.

Runner wiring accepts `--recording-pins <expectations.json> --recording-pins-sha256 <independently-frozen-hash>`. The file is an array of RecordingExpectation objects; it is not created from untrusted bundles. Each context includes exact help/version capture hashes. The runner overrides case/arm/split/input bytes from the verified corpus. Confirmatory recordings additionally require preregistration's `recordingExpectationsSha256` to equal that hash and each candidate commit to match; absent pins leave rows `not_run`. Reports retain only tool/version/source-pin evidence metadata, never a raw bundle.

## Deferred acceptance

After approval and Dirty Mode closure: validate real G0 raw envelopes and every native-to-envelope extraction; freeze tool/source/query/option pins; run the recording tamper tests and TypeScript/lint/build checks; record all dev netconan configurations and Batfish originals/outputs; list all evaluator/Batfish/author disagreements. Every runtime check is pending. No result is measured.

## Full-trace comparison port (native compatibility pending)

The TypeScript oracle port additionally accepts stable nodeIds, interfaceHops and aclDecision in each traceroute envelope answer while retaining the untouched native disposition and raw answer bytes. These stable IDs must be obtained by recorder-side structural file/interface/ACL ordinal alignment, never by substituting the builder evaluator's trace. An unfamiliar native answer shape, absent IDs, ambiguous correspondence or missing independently pinned bundle produces not_run. This interchange has not been validated against Batfish; R1/G0 must approve and validate the native adapter before use. No recorder source is supplied by construction.
