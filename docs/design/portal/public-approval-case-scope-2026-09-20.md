# Public approval: Student access to the new case

## Contract

Migration209 is a prospective correction to ordinary public Student approval.
The root coordinator reserved209 after the real local reproduction below;
A recorded B-2a in the shared launch plan and decision log before coding.
This PR is separate from recent-university PR929/SQL207 and Sales PR935/SQL208.

Ordinary approval must grant the freshly provisioned Student membership access
to its exact newly created case scope. Use `append_scope_event` with the real
approving actor and a deterministic `public_student_case_scope` child request.
Keep the existing transaction, revision/request replay, organization and identity
checks, final access-version bump, invited branch and insert-then-activate order.
No curator, sale, assisted tier, permission-predicate change or wider scope is
introduced. Email confirmation and program selection are outside this fix.

No historical case, explicit revoke or existing assignment history is repaired.
Old approval replay remains read-only. Any repair requires a separate read-only
impact manifest and authorization; managed application and release are deferred.

## Reproduced defect before209

Source: `6b6153125a6cf722ea2712367ec24552ede90423` (PR929). The disposable
local stack contains actual Auth, PostgREST and PostgreSQL with migrations001–208;
A owns its setup/application. Its only intake bootstrap binds one active local
organization to its active review department through the guarded local helper.
The nullable intake owner affects lead ownership, not Student case-scope access.

The existing product `createPublicStudentAccount` created a labelled local QA
identity. Ordinary password Auth, `submit_student_application_v1`, and an
ordinary signed-in Admin's five-argument `decide_student_application_v1` all
succeeded. The application was approved at revision2. After normal re-login:

- `current_actor_authority`: one Student row.
- Case: pending, activated, active Student membership.
- Scope assignments: organization1, exact case0.
- `student_portal_cases`: empty, with no database error.
- Actual browser login reached the approved application; “Открыть кабинет”
  failed to resolve the cabinet.
- The independent SQL207 Student RPC returned the true empty `{items: []}`.

Read-only live function/trigger inspection confirmed the pending-state gate
exists, but the current approval function has no `append_scope_event` call.
Its SHA256 was `90beb61c65388d1f9034aed84a5f9030c324d7a6950cbb6812091202a21dd6ec`.
No business-row patch, forged JWT, disabled RLS or mock response was used.

Source explanation: migration177 used curator assignment, whose helper in126
also granted the Student case scope. Migration180 removed curator assignment
and retained only the organization grant and creation of the case/scope.
Migration193 corrected activation but did not restore the exact-case grant.
The gate from042, broadened to pending by180, still requires that grant through
the Student scope predicate preserved by155 from083. No insertion trigger
supplies it. Two independent read-only reviews reached the same conclusion.

These are isolated local findings. The affected population and behavior of
existing managed accounts have not been claimed or repaired.

## Validation status

Post209 real-path acceptance is pending: A must apply the reviewed hash to the
composed local001–209 stack, then a NEW ordinary signup/submission/approval must
open its own pending cabinet/Home through normal Auth and the actual Next app.
Check exact request replay, changed-request conflict, another Student's case,
unauthenticated/staff denial and the pending tier's document/help boundary.
Record unsupported tenant/revocation scenarios as unverified; do not simulate
success or patch authorization rows to obtain green results.
