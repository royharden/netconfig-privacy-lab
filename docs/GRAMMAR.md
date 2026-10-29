# Grammar v1 (closed)

Source of truth for authors and builders: PLAN.md §2 row 4 and §3. Code: `src/core/grammar.ts` (patterns, construct registry,
keyword list) and `src/core/parser.ts` (one branch per construct). "IOS-style" names a syntax family, not a compatibility claim.
Written from generic concepts; no vendor documentation text is copied.

## Lines, ordinals and spans

- A file is split on LF; a CR before the LF is part of the terminator, not the line. A trailing newline adds no extra line.
  Re-joining every line with its terminator reproduces the input byte for byte.
- **Line ordinal** = 1-based line number. **Spans** (ledger, labels) index into one line's text without its terminator:
  0-based start, exclusive end, UTF-16 code units (equal to bytes for ASCII). For a file-name occurrence the span indexes into
  the display name and the ordinal is 0.
- **Blocks.** A non-indented line is top level and closes any open block. An indented line (leading space or tab) is a
  sub-command of the most recent block header: `interface ...`, `ip access-list extended ...` or `router bgp ...`. A
  non-indented `!` line closes the block; blank lines and indented comments do not. Indented lines after an unknown top-level
  line, or with no open block, are unknown.
- Keywords are exact lower-case words (`RO`, `RW` and `GigabitEthernet` exactly as shown). Tokens are separated by runs of
  spaces or tabs. Identifiers are ASCII; free text (descriptions, remarks, banner, comments) may be any UTF-8 except that the
  banner text may not contain `#`.

## Supported constructs

Each construct has one parser branch and one dedicated test file under `tests/parser/` (registry: `SUPPORTED_CONSTRUCTS`).

| Construct id | Block | Syntax | Test file |
|---|---|---|---|
| hostname | top | `hostname NAME` (letter, then letters/digits/`-`, ≤63; case-insensitive identifier) | hostname.test.ts |
| domain-name | top | `ip domain-name NAME` (dot-separated DNS labels, ≤253; case-insensitive identifier) | domainName.test.ts |
| interface | top | `interface GigabitEthernetN/N` (N = 1–2 digits) | interface.test.ts |
| if-description | interface | ` description TEXT` (TEXT = rest of line, ≥1 token) | interfaceDescription.test.ts |
| if-address | interface | ` ip address A M` (A dotted quad, M contiguous mask /1–/32) | interfaceAddress.test.ts |
| if-access-group | interface | ` ip access-group NAME\|100-199 in\|out` (direction taken as written) | accessGroup.test.ts |
| if-shutdown | interface | ` shutdown` | shutdown.test.ts |
| if-no-shutdown | interface | ` no shutdown` | noShutdown.test.ts |
| static-route | top | `ip route P M NH` (P = network base of P/M, M contiguous, NH dotted quad; NH must be directly connected for forwarding, see SEMANTICS) | staticRoute.test.ts |
| acl-named-header | top | `ip access-list extended NAME` (NAME starts with a letter; letters, digits, `_ . -`; ≤64; case-sensitive) | namedAcl.test.ts |
| acl-entry | acl | ` permit\|deny ip\|tcp\|udp\|icmp SRC DST [eq PORT]` | aclEntry.test.ts |
| acl-numbered-entry | top | `access-list 100-199 permit\|deny PROTO SRC DST [eq PORT]` (the number is the ACL's name) | numberedAcl.test.ts |
| acl-remark | acl / top | ` remark TEXT` in a named ACL, or `access-list 100-199 remark TEXT` | aclRemark.test.ts |
| bgp-router | top | `router bgp ASN` (any decimal ASN 0–4294967295) | bgpRouter.test.ts |
| bgp-remote-as | bgp | ` neighbor IP remote-as ASN` | bgpRemoteAs.test.ts |
| bgp-description | bgp | ` neighbor IP description TEXT` | bgpDescription.test.ts |
| snmp-community | top | `snmp-server community STR RO\|RW` (STR = any non-space token) | snmpCommunity.test.ts |
| username | top | `username NAME secret 5\|9 HASH` (HASH = any non-space token) | username.test.ts |
| enable-secret | top | `enable secret 5\|9 HASH` | enableSecret.test.ts |
| banner-motd | top | `banner motd #text#` (one line, `#` delimiters) | banner.test.ts |
| comment | any | `!` followed by optional text | comment.test.ts |
| end | top | `end` | end.test.ts |

`SRC`/`DST` = `any` \| `host A` \| `A WILDCARD`, where WILDCARD is a contiguous inverse mask and `A` has no bits set inside the
wildcard. `eq PORT` (0–65535) is destination-only and only for `tcp`/`udp`. Blank lines are allowed anywhere.

**Typed constants** (never identifiers; never rewritten by any lab or naive arm): netmasks, ACL wildcards, ports, `any`, `host`,
`0.0.0.0`, numbered ACL numbers 100–199, interface names.

**Not supported:** OSPF and other IGPs, VRF, NAT, port ranges, non-contiguous wildcards, object groups, route maps, recursive next
hops, ECMP, tunnels, IPv6, BGP `network`/`redistribute`/`address-family`, secondary addresses, any interface type other than
`GigabitEthernetN/N`.

## Unknown lines and the unsupported stratum

A line that matches no construct exactly (including a malformed supported line) is **unknown**: it passes through byte for byte,
is counted per file, and is reported with diagnostic `unknown-line` or `unknown-line-forwarding`. An unknown line is
**forwarding-affecting** when its leading tokens (trimmed, lower-cased) equal an entry of the list below, or when it sits inside
an ACL or BGP block (every unknown line there is forwarding-affecting). A case with at least one forwarding-affecting unknown
line is in the **unsupported stratum** (leak-scored only, no utility claim). Other unknown lines (e.g. `logging buffered 16384`,
`service password-encryption`, `ntp server ...`) leave a case semantic-positive.

Forwarding-affecting keyword list (kept identical to `FORWARDING_AFFECTING_KEYWORDS`; checked by
`tests/parser/grammarRegistry.test.ts`):

<!-- forwarding-keywords:start -->
- `router`
- `ip route`
- `ipv6`
- `ip address`
- `ip unnumbered`
- `ip access-group`
- `ip access-list`
- `access-list`
- `permit`
- `deny`
- `neighbor`
- `network`
- `redistribute`
- `address-family`
- `default-information`
- `distance`
- `maximum-paths`
- `ip nat`
- `ip policy`
- `ip local policy`
- `route-map`
- `ip prefix-list`
- `object-group`
- `vrf`
- `ip vrf`
- `interface`
- `encapsulation`
- `switchport`
- `bridge-group`
- `channel-group`
- `standby`
- `vrrp`
- `glbp`
- `ip default-gateway`
- `ip default-network`
- `ip routing`
- `ip classless`
- `ip forward-protocol`
- `ip helper-address`
- `ip directed-broadcast`
- `ip proxy-arp`
- `ip verify`
- `ip ospf`
- `ip rip`
- `ip multicast-routing`
- `ip pim`
- `ip sla`
- `track`
- `tunnel`
- `crypto`
- `mpls`
- `shutdown`
- `no shutdown`
- `no ip route`
- `no ip address`
- `no ip access-group`
- `no ip routing`
- `no ip classless`
- `no ip proxy-arp`
- `no access-list`
- `no router`
- `no interface`
- `no neighbor`
- `no switchport`
<!-- forwarding-keywords:end -->

## Limits (PLAN.md §3; `src/core/limits.ts`)

| Limit | Value |
|---|---|
| Devices (config files) per case | 3–8 |
| Bytes per file (UTF-8) | 64 KiB (65,536) |
| Bytes per case | 512 KiB (524,288) |
| Lines per file | 1,000 |
| Interfaces per device | 16 |
| Static routes per device | 32 |
| ACL entries per device (all ACLs) | 32 |
| BGP neighbours per device | 4 (external-only peers, row 5) |
| Scheduled flows per case | 32 |
| Sensitive entities per case | 64 |
| Distinct occurrence strings ("variants") per entity | 8 |
| Parse + strategy deadline (worker) | 5 s; timeout = error |

Input must be valid UTF-8; a violated cap yields an explicit error (`LimitViolation` code) and no output, never a partial parse.
