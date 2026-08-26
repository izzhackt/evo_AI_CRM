# U7 canonical Admissions case workspace contract

Status: active implementation contract for Issue #384. It starts from the
exact-main-verified U6 squash merge `1b8a806429f6164f873848770a838096816bab7a`.
Repository and disposable-local proof only.

## Outcome

One Admissions manager can return to and operate the single canonical Student
Case created by U6 from `/clients/[caseId]`. The same case context owns its
tasks, document checklist, one university-application track, one visa
milestone, bounded operational timeline and bounded audit history. No module
creates a second case identity or falls back to SQLite.

## Canonical boundary

- `platform.student_cases.id` is the only case identity. U7 consumes the row
  created or reused by U6; it never copies, replaces or re-keys that row.
- Supabase/PostgreSQL remains canonical. The connected `/clients/[caseId]`
  route must use only platform RPCs and server actions. The legacy fixture
  renderer may remain for its explicit fixture mode, but none of its SQLite
  queries or mutations may enter the connected branch.
- Existing `platform.case_tasks`, `platform.case_task_events`,
  `platform.student_case_updates`, `platform.university_applications`,
  `platform.university_application_events`, document tables,
  `platform.visa_cases`, `platform.visa_case_events` and
  `platform.audit_events` remain the domain records. U7 adds no parallel task,
  application, document, visa, timeline or audit tables.
- Finance data may remain visible where the pre-existing connected page
  already renders it, but payment control and finance stop-factor behavior are
  not U7 acceptance and must not change before U8/#385.
- Student Portal activation, notifications, uploads and student-facing
  workflow are not activated or broadened by U7.

## Existing operations to reuse

U7 wires existing case-scoped operations instead of duplicating them:

- case shell: `platform.staff_student_case_read_snapshot`;
- task creation and change: `platform.create_case_task` and
  `platform.change_case_task`;
- staff update: `platform.append_student_case_update`;
- application creation and status change:
  `platform.create_university_application` and
  `platform.change_university_application`, reached through the existing
  platform server actions;
- document checklist/read and internal review:
  `platform.staff_student_case_documents` and the base
  `platform.review_document_version` RPC through a U7 case-workspace server
  adapter. The adapter must not call
  `review_document_version_with_portal_notification_v1`, create a Portal
  notification or depend on the Portal-notification feature flag;
- visa read and milestone mutation: `platform.staff_case_visa` and the
  existing platform visa action;
- inherited Sales context: `platform.staff_student_case_handoff_context`.

Every mutation keeps its existing request UUID, permission, replay and audit
contract. U7 does not add a browser-only duplicate or authorization rule.

## Migration 089 read model

Migration 089 adds the smallest missing case-scoped read surface:

1. A task workspace RPC returns only tasks belonging to the requested
   canonical case plus active, same-organization Admin/Sales/Curator assignee
   options. It re-resolves the live actor and case scope before returning data.
2. A case activity RPC returns a bounded, newest-first timeline and audit
   projection. It relates events through the requested case and its task,
   application, document-version and visa child IDs. It returns action,
   resource kind, actor display name, event time, reason and a whitelisted
   change summary; it never returns raw `before_state`, raw `after_state`,
   evidence references, document storage paths, message bodies or secrets.
3. Both functions are `SECURITY DEFINER` with `search_path = ''`, fully
   schema-qualified relations, explicit `REVOKE` from public/anonymous/system
   roles and a narrow `GRANT EXECUTE` to `authenticated`.
4. Direct base-table grants remain revoked. RLS and the existing case-scope
   authorization helpers remain the source of truth; the RPCs do not trust a
   case ID, organization ID or role supplied by the browser.
5. Results are bounded and deterministically ordered. A malformed, foreign or
   unavailable case fails closed instead of returning an empty cross-tenant
   approximation.

The read model is intentionally presentation-safe. Complete raw audit search
and export remain the separate Admin-only audit surface; U7 exposes only the
case-linked operational subset needed to understand this case.

## Connected UI contract

The existing `/clients/[caseId]` page remains the one Admissions workspace.

- The case overview and navigation continue to use the canonical connected
  case snapshot and `/clients` queue/search. Direct links keep the same case
  UUID and return not-found/access-denied when the actor loses scope.
- Tasks show real platform rows, ownership, due date, priority and status.
  Admin or the assigned Curator can create a task and change its status or
  assignee through platform server actions. The connected branch never calls
  `src/lib/actions.ts` task functions.
- Applications expose one inline platform create/status path in the case
  context. Platform-specific field names, evidence requirements and request
  IDs are not translated through the legacy SQLite form.
- Documents reuse the existing checklist and bounded review form, but the
  connected case uses the U7 internal-review adapter to the base audited RPC.
  It remains available to an authorized case operator without activating or
  notifying Student Portal. U7 does not upload files.
- Visa reuses the existing platform form for one milestone/status path.
- Staff updates and case activity render actor and time. The case audit card
  renders the bounded case-linked actions and safe change summary.
- Existing U6 inherited context remains visible to Admissions and remains
  unavailable to Sales beyond the bounded handoff summary.

## Authorization matrix

- Admin can read the case workspace and use operations granted by the
  published Admin bundle.
- The active assigned Curator can read and operate the case when the existing
  case-scope helper and published bundle permit the action.
- Sales retains only the already-approved Sales surfaces; U7 does not grant
  Sales the connected Admissions workspace, task workspace or case audit.
- Inactive memberships/profiles/organizations, unpublished bundles,
  cross-organization actors, unrelated Curators and unassigned direct-link
  requests are denied.
- Task assignees must be active same-organization Admin/Sales/Curator
  memberships accepted by the existing database assertion. The UI list is
  discoverability only; the mutation revalidates the assignee.
- Application, document and visa actions keep their existing database-level
  permission checks. The internal document action must prove that it writes no
  Portal notification. Hiding a form is never considered authorization.

## Required evidence

- Migration history is contiguous through 089 and a clean reset succeeds.
- PostgreSQL/RLS tests prove allowed Admin/assigned-Curator reads and
  operations plus unrelated-case, cross-tenant, inactive and unauthorized
  denials for task/activity reads and task, document, application and visa
  mutations. Existing older tests may be reused only when they exercise the
  exact U7 RPC path and actor/case boundary.
- Document proof calls the internal base review path and asserts that no
  Student Portal notification or activation is created or changed.
- Tests prove the activity projection relates only child records of the target
  case and does not leak raw audit JSON, evidence references, storage paths or
  another case's events.
- Unit tests prove strict task/activity normalization, exact RPC arguments,
  platform-only form parsing, request IDs, response ownership and fail-closed
  malformed/cross-case responses.
- Real local Auth/PostgREST/Next.js browser proof starts from a real U6 handoff,
  returns to that exact `/clients/[caseId]`, performs one task flow, one
  application flow, one document review and one visa milestone, and shows
  actor/time/change history on the same canonical case.
- The browser proof also demonstrates canonical search/direct navigation and
  denial for an unrelated/cross-tenant actor. It must assert that no SQLite
  fallback path is used.
- Existing U1-U6, security, migration, lint, typecheck and production-build
  gates remain green on Node.js 22.23.1.

## Explicit exclusions

No second Admissions application, no duplicate case copy, no SQLite or legacy
fallback, no Finance stop-factor, no new payment behavior, no Student Portal
activation, no provider call, no WhatsApp/WAHA/amoCRM change, no production
deployment, no managed Supabase mutation and no customer-data proof are part
of U7.

Official behavior revalidated on 2026-08-26:

- <https://supabase.com/docs/guides/database/functions>
- <https://supabase.com/docs/guides/database/postgres/row-level-security>
- <https://supabase.com/docs/guides/api/securing-your-api>
