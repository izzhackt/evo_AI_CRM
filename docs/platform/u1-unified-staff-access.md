# U1 — единый доступ сотрудников

Status: implemented in the repository for issue #378; managed-environment and
production proof are not part of U1.

Block-ID: `EVO-U1-UNIFIED-STAFF-ACCESS-2026-08-24`.

Authority: parent issue #376, ADR 0020 and the 2026-08-24 U1 entry in
`docs/PLAN_CHANGES.md`.

## Outcome

U1 gives EVO one Supabase-backed staff login and one live authority chain for
the first internal pilot. The accepted staff roles are exactly:

- `sales` — Sales Manager;
- `curator` — Admissions Manager;
- `admin` — Director/Admin.

Finance is a module and permission area, not a fourth staff role. The historical
`finance` enum value remains readable for later migration review, but the Auth
hook and live authority resolver do not issue or accept staff authority for it.
`student` remains a later Portal participant and is not accepted by the staff
guard.

## Pre-implementation gap map

| Boundary on prior `main` | U1 resolution |
| --- | --- |
| JWT carried only role and `access_version` | JWT now binds organization, membership, immutable bundle ID/version, role and `access_version`; every server/RLS request compares all values with live rows |
| `finance` was accepted by the generic staff guard | U1 staff guard accepts only `admin`, `sales`, `curator`; historical Finance authority fails closed |
| Membership had no `suspended` state | Lifecycle is `invited`, `active`, `suspended`, `inactive`, `blocked`; only `active` has authority |
| Payment confirmation followed a role-bundle permission | Contract and first-payment confirmations require the latest individual append-only grant; role title alone grants neither |
| No connected staff administration screen | `/settings?tab=staff` is an Admin-only Supabase screen backed by audited RPCs and no service-role key |
| JWT revocation checked role/access version but not the exact authority row | Role, status and sensitive-permission mutations increment `access_version`; old tokens fail on the next UI/API/RLS request |
| Draft PR #346 used four staff roles and lacked real Supabase E2E | #346 remains source material only; U1 was rebuilt from current `main` with the approved three-role/status/permission model |

## One authority chain

1. `/login` calls Supabase Auth password sign-in. Public self-registration stays
   disabled.
2. The custom access-token hook emits claims only when exactly one live
   profile/membership/organization/published-bundle authority exists.
3. `resolvePlatformActor()` verifies the signed token with `getClaims()` and
   calls `platform.current_actor_authority()`; it never trusts client-supplied
   organization, membership, role or version arguments.
4. The resolver and PostgreSQL helpers compare live organization, membership,
   bundle ID/version, role and access version. Missing, malformed, stale,
   ambiguous or cross-organization claims return no actor.
5. Server guards choose the role-appropriate module. PostgreSQL permissions and
   RLS make the same decision for RPC and table access.

This follows Supabase's current guidance that verified JWT claims are useful
for authorization but can be stale until refresh, while RLS remains the
database enforcement boundary. Service-role keys bypass RLS and therefore do
not appear in this browser/session path:

- <https://supabase.com/docs/guides/auth/server-side/creating-a-client>
- <https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac>
- <https://supabase.com/docs/guides/database/postgres/row-level-security>
- <https://supabase.com/docs/guides/api/securing-your-api>

## Role and permission matrix

| Capability | `sales` | `curator` | `admin` | Enforcement |
| --- | ---: | ---: | ---: | --- |
| Sign in to the one staff shell | yes | yes | yes | verified Auth token plus live authority RPC |
| Sales home and owned sales scope | yes | no | yes | server guard, bundle permission, RLS/object scope |
| Admissions case workspace | assigned/read scope | assigned case owner | organization scope | server guard, bundle permission, RLS/object scope |
| Staff directory read | no | no | yes | Admin guard plus `staff_directory` RPC |
| Provision an individual staff membership | no | no | yes | Admin guard plus `provision_pilot_staff_member` RPC |
| Change approved role/status | no | no | yes | Admin guard plus audited pilot-only RPC |
| Confirm contract evidence | default no; may receive individual grant | default no; may receive individual grant | default no; may receive individual grant | live individual `contract.evidence.confirm` event plus organization scope |
| Confirm first-payment evidence | default no; may receive individual grant | default no; may receive individual grant | default no; may receive individual grant | live individual `finance.first.payment.confirm` event plus organization scope |
| Send WhatsApp or write amoCRM | no | no | no | outside U1 and first-stage receive-only boundary |

The individual grant is the decisive sensitive-action gate. The existing
payment-event RPC maps its historical `finance.event.confirm` check onto the
same first-payment grant, so an old role-derived permission cannot bypass U1.
U5 remains responsible for the full contract/payment evidence objects and the
contract-plus-first-payment handoff.

## Lifecycle and audit

Only Admin may use the connected lifecycle RPCs. The old broad provisioning,
role and status functions are no longer executable by authenticated clients;
the U1 wrappers reject `finance` and `student` assignments. Direct writes to
membership and permission-event tables have no browser grants or policies.

Every successful provision, role change, status change or sensitive-permission
change records the actor, target, organization, before/after values, reason,
request ID and server timestamp in append-only audit. Role, status and
sensitive-permission changes increment the target profile's `access_version`.
Idempotent replay returns the original receipt; conflicting request-ID reuse
fails closed.

## Repository acceptance

The required local acceptance runs against disposable PostgreSQL and local
Supabase only. It must cover:

- all three pilot logins and one staff shell;
- wrong password, anonymous, no membership, historical Finance, inactive,
  suspended and blocked denial;
- exact-claim, stale-token and immediate-revocation behavior;
- same-organization and cross-organization positive/negative access;
- Admin lifecycle success and non-Admin denial at UI, RPC and direct-table
  seams;
- default-deny, grant, use, revoke and audit for both sensitive permissions;
- migration history/reset, PostgreSQL authorization, unit, lint, build and the
  affected Playwright browser partition.

These checks prove repository/disposable-local behavior only. U1 does not
exercise or claim managed Supabase, production, provider, backup or rollback
success; it sends no WhatsApp message and writes nothing to amoCRM.

## Candidate-local evidence

The clean U1 worktree based on
`466f3fef95b331d1d9ae4280511a189d8a12d704` passed the following on
2026-08-24 with Node `22.23.1`:

- `npm run test:supabase:local`: all 83 migrations, real local Auth hook,
  PostgREST/RLS, private Storage, PGMQ and all browser partitions passed; the
  harness removed its disposable resources;
- `npm run test:security:postgres`: the full isolated PostgreSQL authorization
  harness passed;
- `npm run test:unit`: 655/655 tests passed;
- `npm run test:security:node`: 598/598 tests passed after building the local
  `better-sqlite3` native test dependency for Node `22.23.1`;
- `npm run lint` and `npm run build`: both passed, including TypeScript and the
  production Next.js build.

These are candidate-local results. The immutable PR head still requires its own
independent review and repository-required GitHub CI before merge.
