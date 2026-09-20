# Item 29 — optional fields and canonical profile QA

Snapshot: 2026-09-21. Existing owned-local Supabase only; no managed deployment.

## Result and source

- Migration219 (`f4e0ffdbdfee39d886937526077ab28762652379`) applied with data
  unchanged, but its first function run failed in the old184 helper: PostgreSQL
  does not support the regexp bound `{1,1990}`. The original219 SQL and
  `APPLIED_QA_FAILED` receipt remain unchanged.
- Forward220 (`10f4edc1fb7a0b1ba3c3f9a35391898c6efd1743`) preserves the intended
  HTTPS length using a separate9..1998 length check and unbounded character
  pattern. The same real PostgreSQL packet passed111 validator and20 helper
  parity cases. These are function calls, not new business records.
- Real Admin UI initially failed before save because181 lawfully has no legacy
  handoff for some activated canonical cases. Fix
  `99b4a3fb487f3af95d4b2db5d98675f12e0efe77` resolves explicit-case and direct-lead
  routes through the authorized105 link. The broad184 same-client discovery is
  only a candidate; nonnull contradictions and read errors remain failures.
  Both routes then displayed the same existing case, application and permitted
  tabs through ordinary login on local port33230. ESLint and TypeScript passed;
  two independent reviewers approved the exact runtime revision.

## Actual browser persistence

The only business write used the existing application in an active unpinned
case. Its four optional inputs were already blank. The real UI-generated
request/case/application/version was captured privately before one Save click;
hidden DOM attributes were inspected directly because the high-level browser
snapshot omits their values. No request ID or business value was invented.

The Save changed raw details from `{}` to the four existing blank strings,
version1→2, updated time and exactly one `application.partner.details.update`
audit row. The re-rendered form read back version2. This intentional normalized
state remains; there was no raw-state restoration or deletion of history.

One ordinary-Auth RPC replay used that exact captured UI envelope. It returned
HTTP200 and the exact saved audit result; the complete scoped after snapshot was
unchanged. The first local response assertion incorrectly expected a
`request_id` property not returned by this RPC. The successful response was
retained and checked offline against the recorded audit result; no RPC retry.

The scoped observer verified unchanged parent case, other applications/audits,
all218 requirement revisions/items/slots/links and Auth identity counts. A final
full observation found only the expected application/audit changes among281
business tables; the other279, schema/ledger and Auth identity counts were
unchanged. Its initial overly broad comparison included the expected target
application and an218 audit projection; the corrected offline comparison checks
those exact permitted changes against the scoped proof. The window was released
with the full state; root dev server stopped and its browser tab closed.

## Preserved failed/environmental evidence

Packetv1 mistakenly bound the intermediate218 metadata state. Its failed
baseline remains; packetv2 corrected only the reference to final218, preserving
all assertions. Independently reviewedv3 binds the approved profile revision.
The first219 CLI launch failed before SQL execution; the later apply receipt
records the actual applied SQL. Neither failure is relabeled a successful run.

Host ENOSPC interrupted tooling, stopped local OrbStack and invalidated browser
sessions before the save. Only owned disposable build outputs and the newly
created empty B QA simulator were removed. Existing Docker/DB recovered without
reset/recreation; a fresh scoped baseline passed before ordinary login/save.
The failed read-only capture is retained. Native B build failure remains separate.

Impeccable `harden` informed this narrow repair: lawful absent optional context
must not blank a working screen; contradictory or unavailable reads remain
errors. The actual restored desktop UI was inspected without visual redesign.

## Evidence bindings

Private originals are under `/private/tmp/evo-database-foundation.WhSt8z/`;
only aggregate results and hashes belong in Git, never identifiers/credentials.
The219/220 apply receipts still correctly say no UI check at their own earlier
phase. The later UI release receipt is a separate artifact.

| Artifact | SHA-256 |
| --- | --- |
| SQL219 | `7a3e25f4c8e4eee5f908b26aa34418a7861c72285cd16cb8209f2a99b608236a` |
| SQL220 | `705cb0fa652fada4e1da4e8a52316cdab44ed97096ed64048c28e60bd9fdcc12` |
| Function QA packet | `37f9b1a0087a62f1315fe0927418673126937dc13b59b0f77bfc38d1aae9e6b0` |
| Original219 receipt | `3601794df1278a900eb9a0cb3a335c4c66d3bcef79233c3af576392fe88efdbd` |
| Local220 receipt | `3c3adae2078d21f78c86a6d22513a4faac097b1e4c8972a1235756fbd7e705bd` |
| UI packetv3 | `e5ba32c88cda576a742557c081bfda1fb2fc84363de0ee2cc628b1129bd71661` |
| UI observerv3 | `8be88e21751e06bdf206d5b0c1a7ae786da2972652bb65dc80d02c38d304181a` |
| UI after snapshot | `d459d1c591d0413ea7a2c692aa296dacd676535c37c7113ceecf89254778f21f` |
| UI release receipt | `8a96440cc83fd2139f85e97a53c2d471505fd657cb2792691dbe75763319a0cc` |

## Limits

No suitable existing playbook-pinned legacy application or nonempty HTTPS field
was available. Do not call this pinned219 persistence or nonempty URL browser
acceptance. Negative access/mismatched-handoff runtime cases were not synthesized;
the unchanged authority and nonnull guards received source review. Discovery184
selects the latest same-client case, so it is not an exhaustive canonical-case
search. These limits remain open; item29 and the entire1–36 plan are not fully
accepted on this slice alone. Managed DB, provider/customer flows, production
release, final product E2E and App Store readiness were not performed.
