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

## Local validation completed

A applied the independently reviewed migration through the repository's pinned
Supabase CLI2.116.0, `migration up --local`, after saving the separate PR935
receipt on001–208. The final ledger is001–209 without gaps. SQL209 SHA256:
`b3fb762b0f19e859e33c5705e078e465e2d1fbf69cf9a11b6057554d5685aa09`.

Two NEW local Student identities each followed the actual product account helper,
normal password Auth, submission and ordinary Admin approval. Both had no case
before approval. After approval the old JWT still returned no case; a fresh
password session returned exactly the applicant's own pending activated case.
The actual Next browser login then opened `/portal` and `/portal/home`.

- Exact approval replay returned the same result. Read-only database inspection
  after replay found one case and exactly one current-scope grant per applicant,
  with the actual approving profile recorded as user actor. No curator exists.
- Reusing the approval request with a changed reason, or using a new request on
  the already-approved application, returned `PT409`.
- Student and anonymous approval attempts returned `42501` without approval.
- Each Student's case projection excluded the other Student's case. Direct
  foreign-case help access returned `42501`; own pending-case help did too.
- Pending document projections were empty. No upload/download was exercised.
- The original pre209 failed case still returned no portal case: it was not
  manually repaired or silently granted access by the migration.
- Home displayed the four actual recently published local catalogue entries
  in RPC order. RU/KY at1280 and390 CSS px had no document overflow.

The shared Next server's frontend source was PR929
`6b6153125a6cf722ea2712367ec24552ede90423`;209 changes only PostgreSQL behavior,
whose tested source was `ffc1a6cb8f95006cc81349c05b2645fc6f7b442a`.
Node22.23.1, actual Auth/PostgREST and the composed207/208/209 database were used.
No fixture grant, response mock or business-row correction supplied access.

Local evidence directory: `/private/tmp/evo-database-foundation.WhSt8z`.
Private identity/request receipts remain outside Git. Safe evidence hashes:

| Artifact | SHA256 |
|---|---|
| b-209-scope-readback.json | `49ddf82cee2ca759a84659b6ae92ddb7a1bbe4aedaf2b771bd7b1874b576cd1f` |
| b-home-ui-evidence.json | `056cd49497861d65e7172efbea286224218edea9053bd8067c5e6a8cebdc973d` |
| b-209-home-desktop-ru.png | `9bb6baaadb68d060ec4a56c65126623aef6512f42cb28fa5fdec290dc1c52d01` |
| b-209-home-mobile-ru.png | `74932df3ea8da7897aeb8470270ed8753637d9b61124224ed7421e9b4672f6ff` |
| b-209-home-desktop-ky.png | `29e0c0dd1ee09ed9257989f56155081df93b608162930736bbc08b01989d45fb` |
| b-209-home-mobile-ky.png | `ae00aa50aab5e66dd88cea89d39c009e841e33adacb59ba8c2c464206a75a7fd` |

Not rerun: a second tenant, explicit case-scope revocation, invited approval,
later curator/scope rotation, reject, controlled transaction-failure injection,
document mutation/download or native iPhone. Those branches are unchanged by
the exact-body patch; this receipt is not a claim of their runtime acceptance.
Managed population impact/repair, managed SQL and production release remain
separate. The pending cabinet's assisted-only overview links are a separate
B-4 UX finding, not fixed by209.
