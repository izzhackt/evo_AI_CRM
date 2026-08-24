# U2 — canonical EVO client and lead

Status: active repository/disposable-local implementation contract for issue
#379. Managed Supabase, provider, production and real-data work are excluded.

Block-ID: `EVO-U2-CANONICAL-CLIENT-LEAD-2026-08-24`.

Authority: parent issue #376, issue #379, ADR 0020, and the 2026-08-24 U2
entry in `docs/PLAN_CHANGES.md`.

## Outcome

U2 makes EVO/Supabase the operational authority for a human client record and
for every lead attached to that person. The connected staff UI reads these
records first. A conversation, Student Case, amoCRM ID, WAHA ID, SQLite row or
other historical record can be linked context, but it cannot decide the
current EVO owner, stage or identity.

This slice creates no provider import, no provider reconciliation and no full
sales mutation workflow. U3 owns receive-only WhatsApp linking, U4 owns the
complete qualification/owner/next-action workflow, and U10 owns real legacy
inventory, migration and cutover.

## Current-main gap map

| #379 criterion | Gap on base `86b82bd8787dacc99774696d76360de88088d4e2` | U2 closure |
| --- | --- | --- |
| One canonical person/lead with provenance, external IDs and duplicate rules | Platform has Student Cases and communications, but no shared client or lead identity | Add canonical client/lead records, external-identifier and provenance records, duplicate candidates, resolutions and aliases |
| Unified UI shows EVO truth and legacy references honestly | Connected `/sales` lists conversations and says amoCRM owns the deal; connected `/clients` presents Student Cases as client identity | Make canonical owner/stage/identity primary on list/detail pages; label external and linked module context as secondary |
| Pilot reads use a bounded canonical model | Existing connected pages are bounded, but they page communications or Student Cases instead of canonical leads/clients | Add role-scoped keyset page/detail RPCs and route both connected pages through them |
| Real isolated proof covers duplicates and provenance | No canonical model exists to test | Extend the clean 001-through-tip reset, PostgreSQL/RLS suites, real Auth/PostgREST traversal and connected browser proof |

## Canonical relational model

Migration `084_platform_canonical_client_lead.sql` is the next contiguous,
forward-only root migration. It adds:

- `platform.clients`: immutable EVO UUID, organization, display and normalized
  identity fields, lifecycle state and timestamps;
- `platform.leads`: immutable EVO UUID, organization, optional canonical
  client, canonical EVO owner membership, canonical EVO stage, source,
  lifecycle and timestamps;
- `platform.external_identifiers`: one organization/source/object/identifier
  tuple linked to exactly one client or lead, with observation/import time and
  safe source reference;
- `platform.subject_provenance`: append-only, safe source/freshness evidence
  linked to exactly one client or lead;
- private duplicate candidates and resolution events, plus an auditable alias
  from each superseded client to its surviving canonical client;
- nullable same-organization canonical client/lead links on existing Student
  Cases and communications. They remain empty for un-migrated historical rows;
  U2 does not invent a backfill.

The database, not TypeScript, enforces primary keys, same-organization foreign
keys, one-subject external-ID shape, immutable evidence, unique external
identity, valid lifecycle transitions and non-self aliases.

## Identity and duplicate semantics

Normalization exists only to compare candidates; raw display values remain
available for staff presentation.

- name: trim, collapse internal whitespace and lowercase;
- email: trim and lowercase;
- phone: retain a leading `+` when supplied and compare digits only otherwise;
- a strong person identity exists only when both normalized email and phone
  are present and equal inside one organization;
- a provider identity is strong only as the full organization, source system,
  external object type and external ID tuple.

The active strong email+phone tuple and every external-identity tuple are
database-unique. Exact strong retries return the same canonical UUID through
`INSERT ... ON CONFLICT`; external-key operations additionally serialize on
that exact key before linking. Concurrent identical requests therefore cannot
create two live canonical results or lose provenance.

A name-only, email-only or phone-only match is never a merge key. It creates an
open duplicate candidate for deliberate review. Multiple leads for one client
remain valid because lead uniqueness comes from its own EVO UUID or exact
external lead identity, not from the person identity.

Only an active Admin may resolve a candidate. Resolution requires a reason and
request UUID, records actor/time/survivor/superseded IDs, redirects canonical
relationships to the survivor, and retains the superseded row, its provenance
and its external IDs behind an auditable alias. Conflicts, malformed pairs,
cross-organization records, stale candidates and non-Admin calls fail closed.
If a prior survivor is later merged, alias lookup follows the complete chain
to the final active canonical client and its detail projection includes safe
provenance and external IDs from the full historical client family.

## Authorization contract

U2 reuses the U1 live authority chain. It adds a versioned v12 role bundle,
copies every v11 permission, adds `client.read` and `lead.read` to the three
pilot staff roles, and adds `client.duplicate.resolve` only to Admin. Rebinding
memberships increments `access_version`, so a pre-migration token is stale
until refreshed.

Every new exposed `platform` table enables and forces RLS. `anon` receives no
grant. `authenticated` receives read-only grants where a direct read is part
of the accepted surface; matching RLS still enforces:

- Sales: only clients reached through Sales-owned canonical leads and only
  those owned canonical leads;
- Admissions/Curator: only clients and linked leads reached through an
  assigned Student Case;
- Director/Admin: organization scope;
- every role: exact live U1 organization, membership, bundle, role and
  `access_version` claims.

Raw duplicate internals and create-or-link helpers stay in
`platform_private`, with no browser, `anon`, `authenticated`, `service_role` or
Auth-admin execute grant. The one exposed resolution RPC repeats Admin
authority inside the database. Direct table and RPC calls must not broaden the
same object scope.

## Bounded read contract

U2 adds four exposed read models:

- `staff_canonical_lead_page`;
- `staff_canonical_lead_detail`;
- `staff_canonical_client_page`;
- `staff_canonical_client_detail`.

List calls require an integer limit from 1 through 101. The application asks
for at most 51 rows to present a 50-row page. Ordering is
`updated_at DESC, id DESC`; both values form the cursor. A cursor must contain
both values or neither. Organization and role scope plus search/stage/lifecycle
filters apply before ordering and `LIMIT`. Detail calls return at most one
authorized record. External identifiers and safe provenance are bounded JSON
projections on that record; no raw provider payload is returned.

There is no unbounded compatibility RPC and no dependence on the PostgREST
Data API row cap. Invalid, incomplete or malformed limits/cursors fail with a
database input error rather than silently returning a different range.

## Unified UI contract

- Connected `/sales` renders canonical EVO leads, client identity, current EVO
  owner and current EVO stage. Linked conversations and external identifiers
  are secondary context. It no longer says amoCRM owns the deal.
- Connected `/sales/<lead UUID>` renders a bounded canonical lead detail. U4
  owns mutations, so U2 detail is read-only.
- Connected `/clients` renders canonical EVO clients rather than treating a
  Student Case as the person identity.
- Connected `/clients/<client UUID>` renders canonical identity, provenance,
  duplicate status, external identifiers and any authorized linked lead,
  Student Case or conversation context.
- Fixture mode remains historical UI-contract tooling only. The accepted
  connected routes import no SQLite query/action module and expose no silent
  fixture fallback.
- Empty and unavailable canonical paths are explicit. Missing canonical data
  is never replaced with a conversation, Student Case or legacy provider row.

## Required repository proof

Use Node `22.23.1`, OrbStack, the exact `orbstack` Docker context, and the real
disposable Supabase/PostgreSQL/Auth/PostgREST/browser path.

Focused proof must cover:

1. schema, constraints, grants, forced RLS, private-helper denial and v12
   authority rollover;
2. exact strong deduplication, ambiguous candidate creation, multiple leads
   per client, malformed/conflicting failure and Admin-only resolution with
   preserved external IDs/provenance/alias history;
3. concurrent same-key create-or-link returning one canonical result;
4. anonymous, no-membership, inactive, suspended, blocked, stale-claim and
   cross-organization denial plus Sales, Curator and Admin positive/negative
   object-scope cases;
5. more than 1,000 real rows traversed through authenticated PostgREST/RPC
   pages with every expected UUID exactly once, stable cursors, pre-pagination
   filters and invalid-input rejection;
6. authenticated connected `/sales`, `/sales/<UUID>`, `/clients` and
   `/clients/<UUID>` same-organization success, cross-organization absence,
   truthful empty/unavailable states and visible secondary provenance.

Then run the complete repository gates required by #379. Mocked clients,
in-memory repositories, SQLite stand-ins, fixture-mode UI and configured-only
provider claims are not acceptance evidence.

## Evidence and rollback boundary

U2 exercises no managed Supabase project, production deployment, real customer
record, WAHA session/event, WhatsApp send, amoCRM read/write/import or paid AI
provider. The migration is additive and forward-only. A defect is corrected by
the next reviewed forward migration; merged migration 084 is never edited.
Application rollback may return to the prior image only while the additive
tables/columns remain unused; it never drops U2 history or restores SQLite or
amoCRM authority.

Stop after #379. Do not start U3/#380 or any later U-slice.
