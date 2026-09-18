# Shared staff roles and immediate report handoff

Active, owner-confirmed 2026-09-18. Parent: [EVO_LAUNCH_PLAN](../../EVO_LAUNCH_PLAN.md).
Implementation complete; release and actual account activation remain pending.
Never publish the private roster.

## Approved contract

- Reusable Admin, Sales Manager, Sales, Admissions Manager and Admissions roles.
  Publishing a role changes all members. Only Admin manages accounts and roles.
  Marketing/Accountant remain dormant without invented access or functionality.
- Sales head sees Sales department; Admissions head sees all directions and may
  personally curate China. Regular employees see actual own records. Country
  responsibilities are independent of role: CN, MY, EUROPE, AE; no named people
  in application code. Preserve Student-private assessments and tenant isolation.
- Admin and Sales Manager can confirm contracts/payments through shared role
  authority, replacing individual exceptions for these confirmation actions.
- New manual sale requires a curator. One atomic save records sale, explicitly
  links an existing student or creates a canonical client/lead, and creates or
  reuses one case with curator assignment and starter work. Sales owner remains
  distinct. Transfer immediately, even with contract/payment evidence pending;
  never mark either confirmed merely because the report contains amounts.
- Historical manual/imported rows and edits do not transfer or reassign. No
  historical backfill. Retries and later payments cannot create duplicate cases.
- Four privately approved real employees get permanent Gmail/password accounts,
  unique cryptographically random 12-character passwords. Preserve existing
  Admin identity/history, set owner-approved recovery email and configured
  `admin` alias. No Auth bypass or shared employee login. Credentials go only to
  existing encrypted EVO access storage; no Git/chat/log secret values. No
  email/SMS/WhatsApp delivery is implied by manual password provisioning.

## Parallel blocks

1. Roles: forward migration and reusable templates, actual department/own scope.
2. Handoff: atomic command, report UI/source/contracts, one active creation path.
3. Accounts: Admin-authenticated password provisioning, durable reconciliation,
   server-only provider calls and login alias. Inventory identities before writes.
4. Integrate: changed-file checks, actual Auth/DB/UI paths, independent exact-head
   review, protected short checks and managed release. No heavy blanket suite.
   Student-signup draft migration172 belongs to another task; never apply its
   draft silently. Coordinate numbering/application before release.

## UX and acceptance

Calm existing EVO form, clear labels and one primary save action. Reveal new
student fields only when needed; keep meaningful saving/errors without technical
captions or sidebar redesign. No new decorative design system.

- Role publication updates current assignees; revoked rights do not persist.
- New sale is all-or-nothing, validates curator/tenant, handles retry and leaves
  existing history unchanged. Use real database commands, no mock/fake sales.
- Real staff can sign in, reach their work and cannot access unrelated records,
  account administration or Student-private assessments without authority.
- Admin alias and email resolve the same authorized account.
- Record exact migration/release/health evidence. Missing real sale input is an
  explicit acceptance gap, not permission to invent a customer.

## Integration evidence — 2026-09-18

- Changed TypeScript passes `tsc --noEmit`; changed UI/action files pass scoped
  ESLint. Focused migration-source/release-control checks: 35 passed, one existing
  skip. Source checks are not runtime or business acceptance.
- Exact 173–175 compiled against the current production schema171 inside one
  transaction ending with ROLLBACK; no durable migration or business writes.
  This exposed and corrected nonexistent permission names. Both department-head
  templates are department-scoped; generated role IDs satisfy the strict UUID
  contract. Shared organization features remain a separate reusable role.
- Existing Admin identity and 209 historical report rows inventoried read-only.
  Approved credentials prepared only in the encrypted access vault. No Auth
  account was changed by compilation or password preparation.
- Still required: independent frozen-head review, protected short PR checks,
  exact migration application, actual account/RPC checks and managed release.
  Record final receipts in this run's GitHub PR; never put credentials there.

## Research

Context7 quota exhausted; use current official references:
[Supabase createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser),
[Admin account update](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid),
[PostgreSQL transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html).
