# Staff password onboarding

Implements the approved account block in [the staff activation plan](staff-sales-handoff-run-plan.md).
No private roster, email, password or real customer data belongs in this file.

## Authority and provider behavior

Migration 175 extends the existing 157 request ledger with `operation=password`.
Authenticated current Admin authority prepares and reconciles the request, using
the same role versions, scopes, collision locks, audit and identity protections.
The server's privileged Auth client creates the identity only; it never grants
business membership with its service key. Student identity adoption is rejected.

[Supabase createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
is server-only and accepts a password and `email_confirm: true`. Manual creation
uses the approved address without an email invitation. It is not mailbox delivery
or a successful employee login. Correlation uses protected
`app_metadata.evo_staff_password_request_id`, the exact normalized email, a new
Auth creation timestamp, confirmed email and an existing password hash. Reconcile
creates the profile, membership and prepared role assignments atomically.

Next's installed authentication and forms guides require authorization in every
Server Action; `staffAdminContext` and database `require_admin_actor` enforce it.
Admin presentation preview is not sufficient authority for these commands.

## Admin UI

Settings → Staff → «Создать аккаунт» asks for the name, email and approved roles
and scopes. A cryptographically generated 12-character password includes upper
and lower case letters, digits and punctuation. It exists only during the server
request and the successful UI response; no plaintext password is saved in the
database, audit, logs, localStorage or sessionStorage. Save it privately before
closing the result. Invitation by email remains a separate action.

An uncertain response never repeats Auth creation. The same request is reconciled
and can appear in «Журнал доступа». If access preparation becomes stale, update
the proposed roles there, then reconcile. If the initial password response is
lost, it cannot be displayed again; use the existing explicitly authorized
recovery flow. No automatic reset or fabricated delivery receipt is performed.

## Authorized initial operator protocol

1. Inventory the approved real recipients against Auth and staff memberships.
   Stop on an existing or ambiguous identity; never adopt, delete or reset it
   implicitly. Record the existing Admin Auth UUID, profile and membership IDs.
2. Resolve current published roles, role versions and scopes using the real
   authenticated Admin. Keep department/direction metadata separate from roles.
3. For each approved new employee, generate a unique random 12-character password
   in the private process and save it through the existing EVO encrypted SOPS
   access workflow before dispatch. Keep the plaintext process-only. Never print
   credentials, use shell command arguments for them, or save a plaintext file.
4. As the real authenticated Admin, call `platform.staff_workspace_claim_auth`
   with `p_operation=password`, a stable random `p_request_id`, the organization,
   approved email/name, `p_assignments` containing each `roleId`, `roleVersion`
   and `scope`, `p_no_access=false`, and an approved `p_reason`. Membership and
   expected-access-version parameters are null. Retain the immutable request ID
   privately. Only a matching `dispatch=true` receipt permits one provider call.
5. From the private server process, call Auth `admin.createUser` with that exact
   email/password, `email_confirm: true`, the display name in `user_metadata` and
   `{ evo_staff_password_request_id: requestId }` in `app_metadata`. Preserve only
   non-secret receipts. A timeout is uncertain: never blindly repeat creation.
6. As the real Admin, call `platform.staff_workspace_reconcile_auth` with the same
   organization and request ID. Only `completed` proves membership provisioning.
   `reconciliation_required` needs investigation or preparation correction;
   it never permits another provider call. Read back Auth UUID and membership.
7. Update the preserved Admin's approved recovery/login email through
   [updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid)
   on the existing Auth UUID. This API applies changes directly. Do not recreate
   the Admin, rotate its password or change its business identity implicitly.
   Set server-only `EVO_STAFF_ADMIN_LOGIN_EMAIL` to that approved email. No
   `NEXT_PUBLIC_` alias setting is permitted.
8. Verify actual employee sign-in, assigned work scope and denial of unrelated
   staff/Student-private access. Verify email and literal `admin` login resolve
   the same preserved Admin identity. The alias still requires its real password
   and a live protected Admin authority snapshot. Record only redacted evidence.

## Evidence boundary

Source checks do not prove real account creation, employee login or email
recovery delivery. Record real database migration and authorized Auth/UI results
in the release receipt; do not substitute test identities for approved staff.
