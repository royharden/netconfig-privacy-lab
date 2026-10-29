# Forwarding semantics, dispositions and findings

What the deterministic TypeScript evaluator (M4, `src/eval/evaluator.ts`) implements and what the independent author derives
expected answers against (`expected.json`, PLAN.md row 38). Source: PLAN.md §2 rows 7, 8, 9 and 31. It models only the closed
grammar in `docs/GRAMMAR.md`: connected and static IPv4 routes, interface ACLs, no dynamic routing (BGP lines are metadata toward
external peers that never answer, so every RIB holds connected, static and local routes only).

## Ordinals and identifiers

- **Node, interface, ACL, ACL-entry and flow IDs** come from `case.json`; they never change under any arm.
- **Interface source ordinal** = 1-based position among the file's `interface` blocks.
- **ACL entry ordinal** = 1-based position among that ACL's `permit`/`deny` entries (remarks excluded). **0 = implicit deny**.
- **Line ordinal** = 1-based line number in the original file.
- A **hop** is one device visit. A flow's first hop enters on the flow's `ingressInterfaceId`.

## Active interfaces (row 7)

An interface is **inactive** when it has `shutdown`, or when its address is its own subnet's network or broadcast address
(a modelling choice of this lab, diagnostic `invalid-host-address`, to be checked against Batfish on dev). An inactive interface
contributes no connected route, owns no address for delivery or next-hop resolution, and cannot be ingress or egress. A flow whose
ingress interface is inactive → `unsupported` (diagnostic `ingress-inactive`).

## Per-hop precedence (row 7)

At each device, with the ingress interface known:

1. **Inbound ACL.** If the ingress interface has an inbound `access-group`, evaluate it first-match; if nothing matches the ACL
   denies implicitly. A deny → **`deny-in`** (deciding entry ordinal, 0 for implicit deny).
2. **Local delivery.** If the destination is owned by an active interface of this device → **`delivered`**.
3. **Route lookup** over connected routes (from active interfaces) then static routes, **longest prefix wins**, and on an equal
   prefix length a **connected route is preferred** over a static route. No match → **`no-route`**.
   - 3b. **Egress resolution.** Connected route: egress = that route's interface, next hop = the destination. Static route: egress
     = the active interface whose connected subnet contains the next hop; none → **`unsupported`** (the Batfish label for this
     case is uncertain; raw answers are kept and disagreements recorded).
4. **Outbound ACL** on the egress interface, first-match, implicit deny → **`deny-out`**.
5. **End of hop.**
   - Connected route and the destination is owned by **no** active interface in the case → **`delivered-to-subnet`**.
   - Static route whose next hop lies inside a connected subnet of this device but is owned by no active case interface (an ISP
     or external peer), and the destination is outside every case-owned address and every case connected subnet →
     **`exits-network`**.
   - Next hop owned by exactly one active case interface → continue on that device with that interface as ingress.
   - Otherwise → **`unsupported`**: next hop in no connected subnet, next hop owned by more than one active interface, two
     equal-length static routes to choose between, or an unowned next hop while the destination is case-internal.

## Case-level and guard rules (row 7)

- An interface whose `access-group` names an **undefined ACL** makes any flow crossing it `unsupported` (diagnostic
  `undefined-acl`); the finding `unresolved-acl-reference` is still reported.
- **Duplicate ACL names on one node**, or **duplicate hostnames in a case** (for example the naive arm's `MASKED` collapse), make
  every flow of that case `unsupported` (diagnostic `ambiguous-name`), counted as not preserved in the scheduled rate. Naive-mask
  flow rows are therefore zero by construction, not by measurement (row 45).
- Revisiting a (device, ingress interface) pair → **`loop`**.
- A **hop limit** (evaluator option, default 2 × device count) is a defensive guard; exceeding it → `loop` with diagnostic
  `hop-limit`.

## Dispositions and the Batfish mapping (row 8)

| Disposition | Meaning | Batfish raw disposition |
|---|---|---|
| `delivered` | destination owned by an active interface of the current device | ACCEPTED |
| `delivered-to-subnet` | left on a connected route toward an address no case interface owns | DELIVERED_TO_SUBNET |
| `deny-in` | inbound ACL denied (explicit entry or implicit deny) | DENIED_IN |
| `deny-out` | outbound ACL denied | DENIED_OUT |
| `no-route` | no connected or static route matches | NO_ROUTE |
| `loop` | a (device, ingress) pair repeated, or hop limit exceeded (`hop-limit`) | LOOP |
| `exits-network` | left via a static route toward an external next hop with an external destination | EXITS_NETWORK |
| `unsupported` | any case the rules above send here | NEIGHBOR_UNREACHABLE, INSUFFICIENT_INFO, any other |

The raw Batfish disposition is always kept beside the mapped one. A flow is preserved under an arm when its disposition, ordered
node IDs, ordered interface hops and deciding ACL entry ordinal are all equal between original and output after correspondence.

## Findings (row 9)

| Rule | Fires when | Finding ordinal |
|---|---|---|
| `permit-ip-any-any` | an ACL entry is `permit ip any any` | ACL entry ordinal of that entry |
| `duplicate-acl-entry` | an ACL entry exactly duplicates an earlier entry of the same ACL (same action, protocol, source, destination, port) — not general shadowing | ACL entry ordinal of the second (duplicate) entry |
| `duplicate-interface-address` | two interfaces in the case carry the same address | interface source ordinal of each non-first copy (copies ordered by node order in `case.json`, then source ordinal); one finding per non-first copy |
| `unresolved-acl-reference` | an `access-group` names an ACL not defined on that device | interface source ordinal of that interface; `direction` recorded |
| `default-snmp-community` | an `snmp-server community` string is `public` or `private` | line ordinal of that line |

Findings are compared as multisets of `{rule, nodeId, aclId?, direction?, ordinal}`. Secret and community replacement removes the
default-community finding under every replacing arm; the findings table reports that loss rather than hiding it.

## Duplicate interface ACL application

If an interface has more than one access-group statement in the same direction, a flow crossing that direction is unsupported with duplicate-access-group. No last-write-wins behavior is inferred. This is outside semantic-positive author/generator cases; use at most one application per direction. Renamed interface and ACL identities are aligned by original structural ordinals and stable file IDs, never repaired by a name lookup.
