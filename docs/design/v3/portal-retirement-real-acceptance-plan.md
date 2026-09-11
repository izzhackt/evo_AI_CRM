# Accepted portal retirement and real working checks

Date: 2026-09-11 (Asia/Dubai)
Status: portal retirement deployed and verified; real business/Student
acceptance remains partial pending genuine identities/data/connections
Baseline: main `4c090ca03ab76fc9d0e72782025749200a0c23dd`, accepted app `6ac8007f`
Related issues: #687 (portal retirement only), #693, #708

## Owner decision and limits

The owner accepts the new portal and requests removing the old one, then full
real checks wherever possible. Missing connections/inputs will be supplied
later. Use the existing persistent managed Supabase project and same-server
localhost tunnel. Do not reset/reseed it, invent customers, payments, employees,
documents or test results, impersonate Students, bypass Auth or expose secrets.
The earlier no-new-backup decision remains recorded; do not claim a new backup.

The approved removal is `platform.student_portal_overview_v1()` only. Do not
delete historical migrations, records, credentials, routes used by the accepted
portal, or the current v2 API. Issue #687 also contains an independent Admin
task-reason exception; changing that business rule is not portal retirement
and remains separately tracked.

## R0 — Retire the old portal API

- [x] Read current source/callers and live PostgreSQL catalog before editing.
- [x] Add immutable forward migration 152 dropping the exact zero-argument v1
  function with RESTRICT, without CASCADE, table changes or a fallback.
- [x] Retain v2, Student authority, private assessment isolation and all task
  function definitions/signatures/permissions unchanged.
- [x] Add scoped regression assertions and run real migration/schema checks;
  distinguish structural checks from real Student end-to-end acceptance.
  An owned ephemeral schema-only OrbStack database may use the existing real
  local Supabase foundation and actual forward migrations, without copied Auth
  or customer rows, fake bootstrap or source reset. Remove only that owned
  database after checks; this is not a second permanent product database or a
  managed backup/restore proof.
- [x] Independent exact-head review, protected PR checks, merge and one manual
  full release gate on frozen main `268bbdbc`: PR #735 and CI 34585205187 passed.
- [x] Existing guarded deployment: release 34585916884 attempt 2 accepted
  `268bbdbc` after managed migration 152 passed in schema run 34585949969.
- [x] Verify managed migration ledger, old function absence, current function
  presence, accepted release/health, real UI and final disarmed release state.

## R1 — Existing native platform paths

- [x] Inspect real current staff/session and data availability without exporting
  customer contents. Check Sales/report, Admissions, tasks, chat, universities,
  settings and Admin portal preview through normal routes.
- [x] Exercise valid non-consequential controls, read views and genuine work
  where inputs exist. Do not move customers, confirm money/contracts/arrival,
  grant access or manufacture records merely to make a checklist pass.
- [x] Verify available native chat/task journeys with genuine identities/work
  when available; otherwise name the exact missing identity/input. Connected
  realtime alone is not message delivery, unread or revocation proof. Actual
  one-Admin/two-tab delivery and persisted message-to-task completion passed;
  distinct-employee/unread/revocation acceptance remains open.
- [ ] Verify Student login/documents/help and test save/resume only through an
  authorized real Student session and genuine Student actions. Admin preview
  is not impersonation or evidence of private result persistence.
- [x] Record concrete observed defects and their exact scope. Two UI wording/
  monitoring issues and historical manager-label aliases remain follow-ups,
  without unrequested business-rule or provider changes in the retirement PR.

## R2 — Integrations and handoff

- [x] Read existing service/configuration health without printing credentials,
  sending provider messages, pairing/restarting WAHA or changing webhooks.
- [x] Keep WhatsApp/lead-agent/amoCRM provider activation, outgoing messages and
  missing owner connections separate from native platform acceptance.
- [x] Update GitHub/run records with completed checks, genuine defects and one
  consolidated remaining-input list; do not mark #693/#708 complete prematurely.

## Resume and evidence discipline

Detailed [real verification record](references/2026-09-11-portal-retirement-real-checks.md)
contains exact revisions/runs, actual completed checks, proof limits and the
minimal remaining inputs. Read it before repeating any check or migration.

Retirement R0 is complete. Do not reapply 152 or restore v1. Resume R1 only for
genuine inputs that become available; do not recreate the already completed
verification message/task. UI wording/monitoring corrections and any historical
manager-label alias consolidation require a separate bounded change. The Mac
public-HTTPS certificate is intercepted by Fortinet on its network path;
the server certificate validates and the existing SSH tunnel works. The exact
local interception component is not identified; do not bypass TLS checks.

Read this file, the latest `docs/PLAN_CHANGES.md` entry and the top of
`docs/EVO_LAUNCH_PLAN.md`; refresh origin/main, open PRs and deployed revision.
Resume the first unfinished step. Never repeat the catalogue publication,
209-sale import or a previously applied migration. Keep customer/secret-bearing
artifacts outside Git; commit sanitized aggregate outcomes and exact release
references only. Missing data is a blocked check, not an application failure.

## Current official references

Checked 2026-09-11. Context7 documentation discovery was unavailable (monthly
quota); official PostgreSQL/Supabase documentation was read directly.

- PostgreSQL [DROP FUNCTION](https://www.postgresql.org/docs/current/sql-dropfunction.html):
  identify by input argument types; RESTRICT refuses dependent objects.
- Supabase [database migrations](https://supabase.com/docs/guides/deployment/database-migrations):
  maintain versioned migrations and use the migration ledger for deployment.

## Verification ledger

### Managed preflight and native working proof (before retirement)

- Real managed catalog via cached official CLI authentication and explicit
  read-only transactions: ledger001–151; exact v1/v2 zero-argument functions
  exist; both are security-definer and granted to authenticated only (plus
  postgres). The v2 result has the expected11 columns. No `pg_depend` entries
  or other stored routine bodies reference v1; active `src/` callers use v2.
- Actual canonical aggregate inventory: one active Admin membership, no other
  active staff/Student membership, zero leads and zero student cases. This does
  not erase or discount the separately imported historical sales register.
- Retained definition MD5 values for before/after comparison: portal v2
  `0bfe55ff50e206422e198ba17d1a8122`; public11-argument change_case_task
  `c04be49719e68cd92ecf8f789e6e1c50`; private coverage_change_task_body
  `3ee8944a687a499dfa621dfacefbdfe4`. Hashes are definition identity checks,
  not credential material or functional acceptance.
- Actual Admin through the production tunnel: one truthful operational message
  was sent in General. A second already-open tab received it without reload.
  Reload of the sender retained the message. An actual task documenting this
  verification was created from that message, assigned to the current Admin,
  completed with the observed result and reopened after reload successfully.
  The source message also shows the linked task. No fictional staff/client,
  payment, Student answer or case was created.
- Browser console observations for that flow showed only errors originating in
  a Chrome extension toolbar, not EVO application script errors. Desktop
  screenshot shows the persisted completed task/result.
- Admin lead-creation form opens with Admin selected as responsible; no lead
  submitted. Staff settings independently display exactly one active Admin and
  no invitation history.
- Read-only VPS checks: accepted6ac8007f, app/ClamAV healthy with0 restarts,
  public HTTPS health200/live. Private authenticated WAHA GET reports
  `crm_primary=SCAN_QR_CODE`; no QR retrieval/pairing/restart/send. Current app
  amoCRM command path is disabled and has no configured origin/token path;
  protected operational readiness is disabled. This is current runtime evidence,
  not a claim that no historical provider account/credential ever existed.

### Observed follow-ups and blocked real journeys

- Task selector labels `open` and `in_progress` both as «в работе» in the shared
  wording dictionary; the actual browser shows two indistinguishable options.
  Record as a wording defect, not failed task persistence or a reason to change
  task business semantics in this portal-retirement migration.
- Settings renders Supabase «unavailable» when operational observability is
  disabled, even though actual Auth/database/task/chat paths work. Distinguish
  disabled diagnostics from service downtime in a later targeted UI correction.
- Different-employee delivery/unread/access-revocation checks need another
  approved real employee. Student login/upload/help/test persistence and the
  full Sales→Finance→Admissions path need a real approved Student/client case.
  Existing Admin preview and empty-state screens do not satisfy those checks.
