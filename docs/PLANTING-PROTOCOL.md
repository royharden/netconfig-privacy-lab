# Planting protocol

How identifiers, look-alikes and traps are planted in synthetic cases, and how each trap is scored or tested. Applies to the
builder's generator (M2), the builder smoke fixtures (`fixtures/smoke/`) and the independent held-out author (`AUTHOR-BRIEF.md`).
Source: PLAN.md §4 (trap union, classified), rows 6, 31, 41, 42. Test and function names marked *(planned)* belong to a later
milestone and do not exist yet; this file is their contract.

## Files per case

| File | Kind | Content |
|---|---|---|
| `nNN.cfg` (opaque path) | config | one device per file, grammar v1 (`docs/GRAMMAR.md`) |
| `case.json` | structure | stable IDs, ordinals, file display names, scheduled flows (`schemas/case.schema.json`) |
| `ledger.json` | label | every planted identifier occurrence (`schemas/ledger.schema.json`) |
| `labels.json` | label | benign look-alike spans and non-identifier free-text tokens (`schemas/labels.schema.json`) |
| `expected.json` | label | author's expected answers, semantic-positive practice/held-out cases only (`schemas/expected.schema.json`) |

On-disk paths are always opaque (`n01.cfg`); case IDs are opaque (`h01`). A **file-name trap** exists only as
`case.json` `files[].name` (row 41).

## Ledger rules

1. Every occurrence records `fileId`, `location` (`line` or `name`), `ordinal` (1-based line; 0 for `name`), `start`, `end`
   (0-based, exclusive, UTF-16 code units of the line text without terminator, or of the display name), the exact `text`, and a
   `variant`: `exact`, `case` (same letters, different case), `embedded` (inside a longer token), `split` (two halves adjacent
   across one space), `dotted` / `dashed` (separators normalised, e.g. MAC `00a1.b2c3.d4e5` for `00:a1:b2:c3:d4:e5`).
2. **Completeness.** Every occurrence of a planted entity's value or of one of its listed variants in the case is listed, in
   every location class (address slots, name slots, free text, unknown lines, file names).
   Numeric ASN entities are ledgered only in ASN-role positions (`router bgp`, `remote-as`) and explicitly planted free-text
   ASN spans. The same decimal text in an ACL number, port, mask or other benign numeric role is a benign label, not an ASN
   occurrence. Likewise, a deliberately benign substring look-alike is labelled benign and excluded from ledger completeness.
3. **One entity per exact span.** When two classes share a string (username equal to a hostname, file name equal to a hostname)
   the span belongs to the entity of the slot it sits in (`username`, `filename`), not to the hostname entity.
4. **Nesting allowed, partial overlap forbidden.** A hostname inside a domain, a domain inside an email, an org inside an ACL name
   are separate occurrences of separate entities with nested spans.
5. **Caps:** ≤64 entities per case; ≤8 distinct occurrence strings per entity (row 6).
6. Secrets and communities are entities (classes `secret`, `community`); they are replaced in place, never mapped (row 10).
7. `scripts/ledger-validate.ts` must report zero problems before a case is handed over.

Ledger classes: `hostname, domain, ipv4, asn, username, secret, community, person, org, acl-name, email, serial, mac, filename`.

## Labels rules

- **Benign spans** are strings that are not identifiers and that every arm should leave alone: look-alike substrings, typed
  constants (masks, wildcards, ports, ACL numbers, `0.0.0.0`), HTML-ish text. `note` names the trap. Secret replacements are
  excluded from the over-redaction metric.
- **Free-text tokens** are the non-identifier words of descriptions, remarks, banners, comments and neighbour descriptions
  (punctuation excluded); they are the free-text retention denominator.

## Placement constraints (row 31, semantic-positive cases)

At most one static default per device; no two static routes with the same prefix on one device; a duplicate-interface-IP trap
never sits on a next hop or a flow endpoint; unique hostname per case and unique ACL name per node; interfaces /24 or /30; static
prefixes /0, /16, /24, /30, /32; host addresses never a subnet's network or broadcast address (/24: last octet 1–254; /30: host
offsets 1–2); scheduled flow endpoints appear in the original configs (interface addresses, ACL `host` entries, static next
hops); no scheduled flow crosses an interface with an undefined ACL or a `shutdown` interface; BGP neighbours are external peers
no case device answers. Addresses: mostly 10/8 plus one public-looking block and one documentation block per case. All names
are invented; no real organisation, person or customer.

## Classified trap list

Every trap has exactly one scoring rule or test name in the last column. "Smoke" shows where the builder smoke fixtures carry it
(builder fixtures only; never scored).

### Planting traps (generator function in M2 + scoring rule in M4)

| # | Trap (Claude / Codex name) | Generator function *(planned, M2)* | Scoring rule or test | Smoke |
|---|---|---|---|---|
| P1 | hostname in domain and description / hostname-in-domain | `plantHostnameInDomainAndDescription` | leak variant rule `embedded` (domain) and `exact` (description), per-variant column | s01 `brakefold` |
| P2 | mixed-case repeat / mixed-case | `plantMixedCaseRepeat` | leak variant rule `case` (case-insensitive for name classes) | s01 `BRAKEFOLD`, s02 `AUK` |
| P3 | embedded name in longer token / embedded-name | `plantEmbeddedName` | leak variant rule `embedded` (substring inside a longer token) | s01 `kestle-hub-gi0/2`, s02 `VELLORAN-AUK-IN` |
| P4 | IP in description, banner, comment | `plantIpInFreeText` | leak rule `ipv4` exact at a free-text location | s01 n02 remark, s01 n03 comment |
| P5 | IP in `A/len` text | `plantIpPrefixText` | leak rule `ipv4` exact on the `A` part (span excludes `/len`) | s01 n02, s02 n03 |
| P6 | split IP across one space / split-IP | `plantSplitIp` | leak variant rule `split` (two halves adjacent across one space) | s02 n03 `10.22. 255.5` |
| P7 | ASN equals numbered ACL | `plantAsnEqualsAcl` | numeric context rule: ASN scored at labelled ASN contexts only; ACL-number hits go to the ambiguous-support column | s02 `router bgp 110` / `access-list 110` |
| P8 | ASN equals port or benign number / ASN-equals-port-or-benign-number | `plantAsnEqualsPort` | numeric context rule (as P7); port hits in the ambiguous-support column | s02 `remote-as 443` / `eq 443` |
| P9 | common-word community / common-word-community | `plantCommonWordCommunity` | leak rule `community` exact (secret replacement expected) | s01 `heron` |
| P10 | username equals hostname / username-equals-hostname | `plantUsernameEqualsHostname` | leak rule `username` exact; span owned by the username entity (ledger rule 3) | s01 `username brakefold` |
| P11 | org/customer name inside ACL name / customer-in-ACL | `plantOrgInAclName` | leak variant rule `embedded` for class `org` | s01 `QUILLFEN-EDGE-IN`, s02 `VELLORAN-AUK-IN` |
| P12 | unknown-format secret / unknown-secret | `plantUnknownFormatSecret` | leak rule `secret` exact (a type-5 slot holding a non-`$1$` token must still be replaced) | s02 `hunter2plain` |
| P13 | email in banner | `plantEmailInBanner` | leak rule `email` exact | s02 `noc@velloran.example` |
| P14 | MAC and serial in description | `plantMacAndSerial` | leak rules `mac` (variant `dotted`) and `serial` exact | s01 n02, s03 n01 |
| P15 | file name equals hostname | `plantFilenameTrap` | leak rule `filename` at location `name` (scanner checks names and content) | s01 `brakefold.cfg`, s03 `LOAM-CORE.cfg` |
| P16 | `0.0.0.0` default route / default-route-zero | `plantDefaultRoute` | over-redaction on benign span `default-route-zero`; never counted as a leaked ipv4 | s02, s03 |
| P17 | mask that looks like an address / mask-as-IP | `plantMaskLikeAddress` | over-redaction on benign span `mask-like-address` | s01 mask, s03 wildcard |
| P18 | transformed network base / transformed-network-base | `plantNetworkBase` | utility rule address-in-subnet relation kept + canonicalisation by original prefix length (row 12); leak rule `ipv4` exact on the base | s01–s03 route prefixes |
| P19 | HTML in description / HTML-in-config | `plantHtmlInDescription` | over-redaction on benign span `html-in-description`; UI renders it as text (browser check, DEFERRED-VALIDATION) | s01 `<script>alert(1)</script>` |
| P20 | benign substring matching a planted name / benign-substring | `plantBenignSubstring` | over-redaction on benign span `benign-substring` | s02 `wrench` (hostname `wren`) |
| P21 | unsupported routing line → unsupported stratum / unsupported-routing | `plantUnsupportedRoutingLine` | stratum rule (forwarding-affecting keyword) — `tests/parser/forwardingKeywords.test.ts` | none (smoke cases are semantic-positive) |
| P22 | duplicate interface IP / duplicate-IP | `plantDuplicateInterfaceIp` | finding rule `duplicate-interface-address` (one finding per non-first copy) | none (dev generator; row 31 placement) |

### Evaluator test conditions (M4 hand-built networks)

| # | Condition | Test *(planned, M4)* |
|---|---|---|
| E1 | ACL direction / ACL-direction | `tests/eval/evaluator.test.ts` › wrong-direction ACL (parser side: `tests/parser/wrongDirectionAcl.test.ts`, M1) |
| E2 | implicit deny / implicit-deny | `tests/eval/evaluator.test.ts` › implicit deny |
| E3 | longest prefix / longest-prefix | `tests/eval/evaluator.test.ts` › longest-prefix tie and connected-over-static |
| E4 | unresolved next hop / unresolved-next-hop | `tests/eval/evaluator.test.ts` › unresolved next hop |
| E5 | renamed ingress interface / renamed-ingress | `tests/eval/evaluator.test.ts` › renamed ingress interface |
| E6 | naive many-to-one collapse / naive-many-to-one | `tests/eval/correspondence.test.ts` › naive many-to-one (M3) and `tests/eval/evaluator.test.ts` › ambiguous-name |

### Strategy / primitive tests (M3)

| # | Condition | Test *(planned, M3)* |
|---|---|---|
| S1 | query-only IP / query-only-IP (development check only; headline flows use config-present endpoints) | `tests/strategies/lab.test.ts` › query-only IP |

### Probe tests (M4)

| # | Condition | Test *(planned, M4)* |
|---|---|---|
| R1 | fingerprint tie / fingerprint-tie | `tests/eval/probes.test.ts` › fingerprint tie |
| R2 | known-prefix probe / known-prefix-probe | `tests/eval/probes.test.ts` › known-prefix |

A trap that is planted but never observed failing is coverage, not a measured failure; only observed instances are published in
`failures.json`.
