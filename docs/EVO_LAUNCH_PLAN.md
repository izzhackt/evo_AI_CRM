# EVO Launch Plan

Status: active managed-Supabase production-successor contract
Date: 2026-09-02 (Asia/Dubai)
Authority: owner direction, ADRs 0024 and 0025, this plan and the latest
append-only `docs/PLAN_CHANGES.md` entry, parent issue #543 and ordered children
#544 through #553
Verified starting baseline: GitHub `origin/main` at
`4a2984f55b13bf4fe416a70d7989b9311daa8055`
Latest verified shared main after the P5A provider contract:
`b3f0f45b3632b8db4b2723ffe0ae77b382f60da8`, with exact-main CI run
`33625536519` green for Main CRM, EVO Inbox and EVO Lead Agent.

## Current authority: one Supabase-backed production EVO

The owner has ended the self-hosted/no-Supabase direction. The target is one
EVO Admissions CRM: the accepted V2 interface, business workflows and provider
safety behavior running on the ready-made managed Supabase foundation retained
from V1. After controlled cutover, `V1` and `V2` are historical release labels,
not active products or parallel runtime choices.

The preferred foundation is the existing dedicated EVO managed Supabase
project. A read-only audit must first prove its project identity, applied
migration history, `platform`/`platform_private` schema state, staff/Auth state,
private buckets, RLS, data population, backup capability and current consumers.
If that proof fails, stop and record the exact discrepancy; do not silently
create another paid project, reset the existing project or substitute a fake
environment.

The production successor uses:

- root `supabase/` as the only target migration authority;
- managed Supabase Postgres as the only business-data authority;
- Supabase Auth plus server authorization/RLS for real staff identity;
- private Supabase Storage for accepted documents and WhatsApp media;
- Realtime only where a proved product interaction needs live updates;
- the current V2 Sales, Student 360, Admissions, documents, applications, visa,
  finance, WhatsApp and advisory-AI staff experience;
- the V2 human-reviewed Gemini, explicit WhatsApp send, ambiguity recovery and
  idempotent amoCRM command semantics;
- the already connected private sales WAHA transport session `crm_primary`,
  read-only verified `WORKING` with an identity on 2026-09-02, without another
  QR scan or an `evo-inbox` fallback;
- the existing EVO-owned VPS, Caddy, CI/release and private WAHA capabilities
  where the audit proves they are current and correctly isolated.

### V3 frontend coordination boundary

The unmerged `claude/v3-frontend` branch at
`147421c3129b6e938a168cdf8788687cddc07318` is a design-track reference, not a
release dependency or part of the exact-head candidate. Backend slices must not
merge it, plan around its arrival or edit `src/lib/v3/*`. When a canonical data
authority or response contract changes, record and communicate that contract
first; the V3 track owns the small source-adapter rewrite and its seven screens.

Do not rebuild schema or duplicate UI that already has a clear owner. Reuse the
existing Supabase document checklist/review model from migrations 043, 046, 053
and 055, visa cases and commands from migration 042, and lead ownership/stages
from migration 086. Backend work may expose and verify those canonical
contracts, while the V3 track owns the document-checklist, visa and lead-owner
screens. Do not add a third university-application status dictionary or an
in-app WhatsApp channel-connection flow. The genuine gaps recorded in the V3
branch -- staff as a person, payment plans, the client questionnaire,
application priority/deadline and document-to-application/visa links -- remain
coordination inputs and do not enter the active sequence without their own
prioritized slice.

The production successor does not keep Drizzle `evo_*`, SQLite, the two-field
development gate, application-local private document bytes, old manual or
autonomous messaging workers, superseded provider adapters, duplicate UI,
dual reads/writes or a fallback repository as a second active path. V2-only
business gaps move into `platform` or `platform_private` with immutable forward
Supabase migrations. Cleanup happens in the same slice after real replacement
proof; historical migrations, ADRs, runbooks, archived docs and evidence remain
preserved.

### Execution and production gates

Work executes as small sequential launch-control PRs. Every PR requires an
independent exact-head review, protected exact-head CI, match-head merge and
exact-main verification. A slice includes a scoped import/runtime inventory
showing that the superseded path is no longer active and a fail-closed proof
showing that the app does not fall back.

Repository changes, read-only provider/deployment inspection, isolated local
Supabase work and staging preparation continue without routine approval pauses.
Production data mutation or traffic cutover occurs only after all of these are
true:

1. the exact managed project and production runtime are identified;
2. a recoverable pre-change backup exists and a restore has been proved;
3. forward migrations and data reconciliation pass on an isolated copy or
   staging project using real schema and representative authorized data;
4. real Auth, RLS, Storage and CRM browser workflows plus provider
   configuration and fail-closed readiness checks pass; live Gemini/WhatsApp
   delivery is not an active gate and must not be claimed;
5. the no-dual-write/no-fallback inventory passes;
6. an exact rollback boundary and maintenance sequence are recorded.

The final cutover performs one bounded authority switch. It does not operate
V1 and the successor indefinitely. Active V1 code, SQLite data path, old
workers, old routes/config and stale dependencies are retired only after the
new path is accepted; historical and rollback material remains preserved.

### Active production-successor sequence

| Order | Issue | Slice | Outcome |
| --- | --- | --- | --- |
| 0 | #544 | Architecture and issue reset | ADR 0024, glossary, launch contract and exact GitHub sequence |
| 1 | #545 | Existing-state audit | read-only managed Supabase, VPS, data, Auth, Storage, migrations and runtime inventory |
| 2 | #546 | Real staff and Sales tracer | Supabase Auth/RBAC/RLS plus the accepted Sales lead workflow prove the first complete successor path |
| 3 | #547 | Student 360 and handoff tracer | contract/payment gate and accountable handoff run on the canonical Supabase model |
| 4 | #548 | Admissions and private files tracer | Admissions operations and Supabase Storage replace local files and remaining case paths |
| 5 | #549, #565-#568 | Provider tracer | Gemini, WhatsApp and amoCRM replace local state in order, then pass an exact-main single-runtime and fail-closed inventory without a live Gemini/WhatsApp exercise |
| 6 | #550 | Single deployment and cleanup | production image/Compose/env/release path drops SQLite, Drizzle authority, old workers and duplicate runtime dependencies |
| 7 | #551 | Staging and recovery acceptance | real staging, restore, migration rehearsal, browser, role, file and provider-configuration proof; no controlled-chat send test |
| 8 | #552 | Production cutover and retirement | bounded data/traffic switch, verification, rollback window and active V1 removal |
| 9 | #553 | Completion audit | exact-main proof of one UI, runtime, data, auth/session, file and provider authority |

### P1 existing-state finding

The sanitized read-only audit is recorded in
`docs/audits/evo-production-successor-existing-state-2026-09-02.md`. It proves
that the existing healthy managed Supabase project is the correct retained
foundation, but production is still split across Supabase `public`, Supabase
`platform`, CRM SQLite, lead-agent SQLite, separate CRM/Inbox apps and two WAHA
contours. The live migration ledger ends at `079`; root `080`–`092` remain
unapplied. The target private document and WhatsApp-media buckets are also
absent. Seven provider backups are listed, but a current pre-change artifact
and successful restore rehearsal are not proved.

Accordingly, #546 may proceed with isolated real-Supabase implementation and
proof, but no production migration, data write or traffic switch is authorized
by P1. The recovery and rehearsal gates remain mandatory before production
mutation.

### P2 delivery decomposition: real staff and Sales tracer

Issue #546 is delivered as P2A followed by one regression-free P2B/P2C
replacement PR. Exact-head review proved that merging the Supabase Sales read
switch while leaving its writes for a later PR would publish a read-only lead
workspace and break the first complete tracer. The read and workflow-write
authority therefore move together, while their tests and commits remain
separately reviewable inside the same PR:

1. **P2A — real staff session and role shell.** Replace the root two-field
   development gate with Supabase Auth SSR cookies, validate every protected
   request against the live Supabase membership authority, keep Admin as the
   full functional superset, and retain exact Sales/Admissions preview only as
   an Admin-authorized presentation choice. Delete the development-gate
   runtime, config and tests in this PR after real local Supabase and Chromium
   proof.
2. **P2B — canonical Sales reads.** Treat migrations 084-085 as the canonical
   lead and linked-conversation foundation, and wire the already-existing
   `staff_sales_lead_page` and `staff_sales_lead_detail` read RPCs from
   migration 086 as the exact bounded Sales read contract through authenticated
   Supabase/RLS. Forward-only migration 093 corrects the existing detail RPC
   so its displayed conversation list/count use the same exact Sales-intake
   authorization predicate as the nested transcript RPC. Forward-only
   migration 094 applies that same predicate to the existing page RPC's
   `is_connected` and `linked_conversation_count` values. These migrations
   replace the two existing functions in place; they do not add a wrapper or
   second read contract. Delete the corresponding Drizzle read path after
   authorized and unauthorized database, app and browser proof.
3. **P2C — canonical Sales writes and slice cleanup.** Move qualification,
   ownership and next-action mutation through only the mutation RPCs in
   migration 086, prove business outcomes and direct denial, then remove the
   replaced active Drizzle Sales workflow action, UI, route imports, tests and
   configuration. The inactive `updateCanonicalSalesLeadWorkflow` fixture
   helper and its old stage contract may remain reachable only from the named
   local #547/#549 preparation scripts/tests until those downstream slices move
   their gate, handoff and provider fixtures to Supabase; they have no active
   route/action import and must be deleted in those issues, not revived as a
   runtime path.
   P2B and P2C must merge together so `/sales/[id]` never lands as a read-only
   regression. Contract/payment gate and Sales-to-Admissions handoff remain
   owned by #547; the Sales amoCRM command surface remains owned by #549. Their
   old Drizzle controls and historical provider acceptance expectations must
   not be reactivated as a compatibility path. Close #546 only after the final
   scoped active-runtime legacy inventory is empty and the temporary fixture
   inventory names its #547/#549 exit.

Implementation inspection clarified the original migration boundary. P2B must
not add a migration 093 wrapper around the migration 086 read RPCs, because
duplicating an already bounded read contract would layer a second runtime path.
The exact-head review subsequently found a narrower detail/transcript predicate
mismatch inside that existing contract; migration 093 may therefore replace
the existing detail function in place solely to make both surfaces enforce the
same predicate.

A later exact-head review found the same legacy broad predicate in the
`staff_sales_lead_page` WhatsApp-derived queue values. Migration 094 must
replace that existing page function in place so `is_connected` and
`linked_conversation_count` accept only the exact verified Sales-intake link
used by detail and transcript. Its database proof must include exact intake,
client-only, non-intake and unverified/direct-link cases. No other queue
behavior, signature, ACL or authority may change.

### P3 delivery decomposition: Student 360, contract/payment and handoff

Issue #547 must publish one complete Supabase-backed Student 360 tracer from an
already qualified Sales lead through contract and first-payment evidence to one
accountable Sales-to-Admissions handoff. The active `/clients/[id]` route still
renders `CanonicalStudentCaseWorkspace`, which reads the old repository-backed
student case, handoff, task, operations, document and amoCRM surfaces. At the
same time, root Supabase migration history already contains the canonical
gate, handoff, contract and profile RPCs required for the local/rehearsal
replacement:
`platform.staff_student_profile_snapshot(UUID)`,
`platform.staff_case_contract_workspace(UUID, UUID)`,
`platform.staff_lead_admissions_gate(UUID)`,
`platform.mutate_lead_admissions_gate(...)`,
`platform.staff_lead_admissions_handoff(UUID)`,
`platform.staff_student_case_handoff_context(UUID)` and
`platform.handoff_lead_to_admissions(...)`.

Accordingly, #547 is a replace-not-layer slice with one active Student 360
runtime path:

1. **P3A - contract/payment gate and accountable handoff.** Add one typed
   Supabase boundary for the four existing gate/handoff RPCs and one server
   action module that uses the signed-in staff cookie client, never a service
   role. Restore the accepted Sales controls on `/sales/[id]` so authorized
   staff can confirm contract evidence, confirm first-payment evidence, select
   the Admissions owner and perform one normal or explicit Admin-override
   handoff. Database permissions, RLS, version checks, immutable request
   receipts and transaction locks remain the authority; the UI must surface
   invalid, forbidden, stale, request-conflict, gate-blocked and unavailable
   outcomes without blind retry.
2. **P3B - Student 360 Supabase path.** Replace the active `/clients/[id]`
   summary and handoff reads with authenticated calls to a typed
   `staff_student_case_handoff_context` adapter. Reuse
   `getPlatformStudentProfile`, `getPlatformCaseContractWorkspace`,
   `ContractDraftReportWorkspace` and the existing Supabase contract actions
   rather than rebuilding those ready-made capabilities. Admissions and Admin
   may open the full case only when the live database authority allows it;
   Sales receives the committed handoff result on Lead 360 but does not inherit
   full Admissions case access. Admin preview remains presentation-only and
   never creates a second authority path.
3. **P3C - real proof and bounded cleanup.** After authorized/unauthorized SQL,
   application and real Chromium proof, delete the superseded modules
   `src/components/platform/sales/CanonicalSalesGateCard.tsx`,
   `src/components/platform/sales/CanonicalSalesHandoffCard.tsx`,
   `src/lib/server/canonical-sales-gate-actions.ts` and
   `src/lib/server/canonical-sales-handoff-actions.ts`, plus the replaced
   repository-backed Student 360 summary/handoff shell and its implementation
   tests. Remove the #547 gate/handoff fixture callers from the old repository.
   The routes must fail clearly if Supabase is missing or rejects the request;
   they may not fall back to the old repository path.

#547 must not silently absorb later-owned surfaces. During #547, the only
temporary repository-backed containers created on `/clients/[id]` are
`src/app/(staff)/clients/[id]/AdmissionsCaseOperationsSection.tsx` and
`src/app/(staff)/clients/[id]/AmoCrmCaseCommandSection.tsx`. The first may
fetch props only for the existing `CanonicalAdmissionsTaskPanel`,
`CanonicalPrivateDocumentsPanel` and `CanonicalAdmissionsOperationsPanel`
through `canonical-crm-repository`, the two canonical Admissions action modules
and `private-document-repository`; #548 must replace and delete that container,
those panels and their superseded dependencies when Supabase Admissions and
Storage land. The second may fetch props only for
`CanonicalAmoCrmCommandPanel` through the canonical amoCRM command action and
repository modules; #549 must replace and delete that container, panel and
superseded dependencies when the provider tracer lands. These are
section-isolated unreplaced capabilities, not alternate Student 360 summary,
gate, handoff or contract paths. No other repository-backed wrapper or stub may
remain on the route.

The temporary fixture-only coexistence from #546 narrows here. #547 must remove
all gate/handoff preparation callers that still depend on
`updateCanonicalSalesLeadWorkflow` or the old stage contract. If the amoCRM
preparation callers remain after #547, they stay named and local to #549 only.
Before merge, attach a scoped `rg` inventory proving that no active route,
action, rendered UI or browser test still imports the superseded gate/handoff
runtime. Existing SQL proof for migrations 087-088 must run with all root
migrations in real local Supabase/PostgreSQL, including concurrent duplicate
handoff and request-id replay cases. The app proof must use real Supabase Auth,
RLS and Chromium. This scope is isolated/non-production: it does not apply the
migrations to the managed project, mutate production data, send a provider
message, write amoCRM or change V1 deployment/traffic.

### P4 delivery decomposition: Admissions operations and private documents

Issue #548 completes the post-handoff product path without rebuilding the
ready-made Supabase foundation. Migrations 042, 043, 046, 055 and 089 remain
the existing authority for tasks, applications, visa, finance controls,
immutable document versions, the private `platform-documents` bucket and
audited one-use download grants. One forward migration 095 may replace the
missing staff queue/workspace functions and narrow finance-stop role behavior;
it must not duplicate an existing Storage or case authority.

1. **P4A - bounded database contract.** Add one role-scoped task queue, visa
   queue, document queue and Student 360 document workspace over the existing
   canonical tables. Admin sees the tenant union; the assigned Admissions
   Manager sees only active or closed handed-off cases assigned to that live
   membership; Sales is denied. Admissions and Admin may assert a finance stop,
   while only Admin may release one. All writes retain exact request receipts,
   transaction locks and fail-closed response validation.
2. **P4B - one accepted Admissions interface.** Mount the typed Supabase task,
   application, visa, finance and document adapters directly in Student 360 and
   use the same adapters for `/tasks`, `/applications`, `/visa`, `/finance` and
   `/documents`. Admin preview changes presentation only; authenticated role,
   RLS and server authorization remain authoritative. An ambiguous mutation
   returns the same request identifier to the exact matching form so a retry
   replays rather than duplicates the business transition.
3. **P4C - private Storage lifecycle.** Upload PDF, JPEG or PNG bytes only after
   an authenticated reservation, through the actor's own Supabase session and
   the private insert-only Storage policy. Finalization and one-use signing use
   the server-only Supabase secret for their existing service-role-only RPCs;
   the secret never reaches browser code. Resubmission creates a new immutable
   object/version, and download uses a consumed grant plus a signed URL valid
   for at most 60 seconds. Direct user list/read/update/delete and public-bucket
   behavior remain denied.
4. **P4D - proof and replacement cleanup.** Real local Supabase/PostgreSQL,
   Storage API, application and Chromium checks must prove Admin and assigned
   Admissions success, Sales/anonymous/other-membership denial, immutable
   resubmission, audited short download and missing-primary failure. In the same
   slice delete the old local-file/Drizzle document stack, Busboy parser, old
   generic document routes, repository-backed Admissions actions/panels,
   implementation tests and dead environment/config references. A scoped
   inventory must show no active import or fallback remains.

Local #548 validation may record checksum and file-signature evidence through
the already documented `scanner_proof=false` contract; it must not be described
as antivirus or malware-provider acceptance. A real malware scanner and its
failure/recovery behavior remain mandatory in #551 before real staff,
production upload, public exposure or cutover. The only named temporary
coexistence after #548 is `AmoCrmCaseCommandSection` and the exact command-read
dependencies owned by #549; they may not read or render an alternate
Admissions, Student 360, document or finance path and expire in #549.

This Storage implementation follows Supabase's current private-bucket/RLS,
standard-upload and signed-download contracts. See the official
[bucket fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals),
[Storage access control](https://supabase.com/docs/guides/storage/security/access-control),
[standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
and [signed URL reference](https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl).

### P5 delivery decomposition: canonical provider workflows

Issue #549 is an ordered parent delivered through #565, #566, #567 and #568.
The current provider UI is useful product work, but its durable state is still
split: Gemini proposals/reviews, WhatsApp send attempts and amoCRM command
receipts remain partly in the local Drizzle runtime while root Supabase already
contains the accepted Gemini and WAHA foundations. The provider tracer must
replace those local authorities rather than copy them into a second path.

1. **#565 / P5A - bounded Supabase provider contract.** Inventory and reuse
   migrations 066, 078, 080, 081, 082 and 091. Add one forward migration only
   for the staff-safe initiation/audit and latest send-attempt/read/
   reconciliation shapes that the accepted UI genuinely lacks. Every claim is
   bound to one canonical organization, conversation, source message, staff
   actor and request identity. Real local Supabase/PostgreSQL and SQL/RLS proof
   must pass, but this contract-only slice does not import a new application
   adapter, contact a provider or activate a second runtime path. It expires
   into the atomic #566 cutover.
2. **#566 / P5B - one WhatsApp and Gemini runtime.** Atomically switch the
   accepted staff communications queue/thread, canonical inbound projection,
   Gemini proposal/result/read/review and explicit WhatsApp send/reconciliation
   path to Supabase. The signed-in staff session remains the authorization
   boundary and only the server contacts Gemini or private WAHA. The provider
   binding reuses the already connected sales session `crm_primary`; it does
   not require a new `evo-inbox` QR scan. This is transport session/container
   reuse only: the V2 command path must not execute the frozen V1 sender,
   writer or webhook worker, and Supabase remains the sole business authority.
   Active acceptance verifies the exact `crm_primary` binding and `WORKING`
   state read-only without selecting an inbound message, calling Gemini or
   sending through WhatsApp. Gemini stays
   advisory until explicit Accept/Edit/Reject review and can never invoke a
   command. One explicit staff action over final reviewed text may send; an
   unknown outcome blocks another send until exact WAHA readback reconciles the
   same request, recipient and text. After real local Supabase, application,
   Chromium, server-boundary and read-only provider-readiness proof, delete the active local
   Drizzle conversation/proposal/send state, superseded local inbound route,
   adapters/workers/imports/tests/config and every fallback path.
3. **#567 / P5C - Supabase-authoritative amoCRM commands.** Add the missing
   forward-only private command-attempt, immutable receipt and provider-binding
   model plus narrowly scoped staff/service RPCs. Explicit authorized commands
   cover the approved contact, lead, link, pipeline/status, note, task and tag
   operations, but Supabase remains business authority and amoCRM identifiers
   remain provider evidence. Replays return the original receipt; an ambiguous
   outcome must reconcile by provider readback before any retry. The inert
   replacement code lands only after real local Supabase, application and
   Chromium proof, with the local command repository/state, temporary
   `AmoCrmCaseCommandSection`, superseded provider UI/adapters/imports/tests and
   every fallback path deleted in that same code slice. Keep #567 open after
   the code merge. Its real-write acceptance then runs once from the reviewed,
   CI-green exact `main`, because the guarded provider harness rejects branch
   or dirty checkouts. #568 cannot start and #567 cannot close until that one
   bounded validation entity has matching amoCRM readback and sanitized
   PostgreSQL/application/browser evidence. A failed or ambiguous result stays
   blocked for reconciliation and never revives the deleted runtime.
4. **#568 / P5D - exact-main provider runtime inventory.** On exact main, prove
   that the Supabase-backed Gemini, WhatsApp and amoCRM modules have one active
   state/runtime path, that `crm_primary` is the only configured WAHA session,
   and that missing or ambiguous provider state fails closed. Use real database,
   application and Chromium outcome tests plus read-only configuration/session
   inspection. Do not require a selected inbound message, call Gemini, send a
   WhatsApp message or write amoCRM. Record explicitly that live Gemini/WhatsApp
   delivery was not exercised and is not being claimed.

Delivery status on 2026-09-03: #565 merged through PR #570, then #566 merged
through PR #571 at exact main
`8bb96c35b401c81e625773cc5ec594c68f956f39`; exact-main CI run `33683881377`
passed. #567's command cutover merged through PR #572 at exact main
`23360a9f3816f7de8d33c162d550fc56688b9c1d`; exact-main CI run `33695138189`
passed. PR #574 added the missing canonical Sales surface and merged at exact
main `a9da91a23c2c8c1f9c475ae72faf8c4a52e4789f`; exact-main CI run
`33699454396` passed.

The next guarded #567 run reached the real provider once. Contact creation,
lead creation, contact/lead linking, pipeline/status, responsible user and note
creation each returned HTTP 200, matched exact readback and persisted accepted
Supabase attempts/receipts/bindings. amoCRM also created exactly one task on
the exact validation lead with the expected text, but the deliberately distant
`2099-09-15` deadline returned as a negative provider timestamp instead of the
submitted Unix time. The command therefore stayed `unknown`, no tag operation
ran, no success marker was emitted and #567 remains open. A bounded read-only
task-list reconciliation proved the task exists uniquely; no provider write or
retry followed the mismatch.

The corrective slice must fail before dispatch for task deadlines above the
provider-safe signed 32-bit Unix range, keep all service/provider validation on
the same bound, and use a normal near-future deadline in connected acceptance.
It must add unit/browser regression proof and pass the normal exact-head and
exact-main gates. The already created validation entities and unknown attempt
remain immutable evidence; this code correction does not authorize another
provider run, cleanup mutation or acceptance claim. The owner removed the
controlled-inbound Gemini/WhatsApp send exercise from the active merge and
completion gates because the controlled account is unavailable.

PR #575 merged that fail-before-dispatch guard at exact main
`a572cd73f48c9d6020a2c532f0ec036e9b19c74a`; exact-main CI run
`33702536583` passed the CRM, Inbox and Lead Agent jobs. The corrective slice
made no provider call and did not resolve the unknown task attempt. Issue #567
therefore remains open at one fresh, separately authorized, bounded amoCRM
validation from reviewed and CI-green exact main. Issue #568 has not started
and remains sequenced after that validation. The V3 ownership and adapter
boundaries above are unchanged.

The owner-authorized fresh validation then ran from clean exact main
`8444b4cbcd648a28a929ae604597cecfeb35d06c`; exact-main CI run
`33704513203` had passed. Contact create, lead create, contact/lead link,
pipeline/status, responsible-user and note operations each returned HTTP 200
and persisted accepted exact readback. Task creation also returned HTTP 200,
but its immediate exact readback ended `provider_unavailable`, so the harness
failed closed at `unknown`; tag execution never started and no `success.json`
was emitted.

A bounded read-only task-list reconciliation found exactly one task on the
fresh validation lead with the exact reviewed text and corrected near-future
deadline. The existing service-only reconciliation RPC then changed only the
local Supabase attempt from `unknown` to `accepted`, retained exact hashed
readback and cleared the failure. It did not retry the task mutation or mutate
amoCRM. Sanitized evidence records seven accepted attempts and seven receipts,
one contact binding, one lead binding, one provenance record, zero tag attempts
and no full replay proof. Therefore #567 remains open and #568 must not start.
The completed one-run authority does not permit a later tag write or another
provider run; either needs a separate explicit owner continuation. WhatsApp,
Gemini, V1, deployment, customer migration and cutover remained untouched.

On 2026-09-03 the owner supplied that explicit continuation and clarified that
the goal is not a one-step tag patch: finish #567 as a complete product slice.
Before another live run, correct any product-path defect exposed by the failed
acceptance, including single-shot post-mutation readback and exact replay that
could re-derive `contact_update` / `lead_update` after newly created bindings.
The completed implementation must keep the original request's operation
sequence stable, retry only bounded read-only verification, and never repeat an
unreconciled mutation. A provider rejection or ambiguous write is reconciled
before any continuation; it is never converted into success or retried blindly.

After the correction is independently reviewed, merged and green on exact
main, run the complete guarded connected acceptance. Reuse valid checkpoints
when their canonical database state still exists. Because the earlier
disposable database was intentionally removed, do not reconstruct its private
IDs or invent bindings; if it cannot be resumed exactly, create one new clearly
marked validation entity and run the full canonical sequence. Completion
requires all eight operations accepted with exact provider readback, an exact
UI replay that adds no attempt, receipt, binding or provider entity, persistence
after reload, and a sanitized `success.json`. The owner permits the bounded
fresh attempts genuinely needed to reach that proof, but every attempt remains
fail-closed and must reuse confirmed results rather than repeat work without new
signal. Only then may #567 close and #568 start. The authorization still excludes
WhatsApp sends, Gemini calls, frozen V1 execution, customer-data mutation,
deployment, historical migration and cutover.

ADR 0026 records that scope correction; no synthetic or customer-chat
substitute is allowed. The existing
`src/lib/platform-communications.ts` authenticated Supabase reads and the
service-only provider contracts from migrations 080, 082, 091 and 096 are the
reuse boundary for schema and workflow behavior. Their historical
`evo-inbox` exact-session selection is superseded by ADR 0025; immutable past
migrations remain unchanged, while current runtime/provisioned configuration
must resolve only `crm_primary`. The local Drizzle communication, proposal and
send symbols,
their synthetic inbound implementation and their tests/config are deletion
targets after equivalent real PostgreSQL, application, Chromium, server-boundary
and read-only provider-readiness proof exists in the same slice.

All lower historical launch sections that name `evo-inbox` as the exact
forward session are preserved as V1/companion decision and rollback evidence,
not as current #566/#568 authority. They must not be imported as a compatibility
path. If a currently provisioned Supabase selector still names `evo-inbox`, use
a reviewed forward correction or current provisioning step; never rewrite an
immutable historical migration. A missing or unhealthy `crm_primary` stops
clearly instead of selecting another session or asking for a routine QR scan.

Production inbound ownership does not move during repository #566 acceptance. The
later controlled cutover must inventory per-session and global WAHA webhooks,
stop the superseded V1 sender/writer/webhook worker, transfer the one provider
webhook to the V2 Supabase-backed runtime, and prove that exactly one active
consumer can process an inbound event before traffic is accepted.

Each child is a separate launch-control PR with exact-head review/CI, match-head
merge and exact-main verification. A completed child has one active state and
execution path for the capability it replaces. Its scoped `rg` inventory must
show that the old Drizzle repository, worker, route, component, test and config
cannot be imported or called, and missing Supabase/provider configuration must
fail clearly instead of falling back. No Gemini call, WhatsApp send, amoCRM
write or selected customer/inbound message is part of active #566/#568
verification. This does not authorize frozen V1 execution, production
deployment, broad customer mutation, migration, public traffic or cutover.

This follows Supabase's current guidance that exposed tables remain protected
by RLS and authenticated RPCs carry the caller's authorization context, plus
PostgreSQL's transaction-level advisory-lock contract for short atomic
business commands. See the official
[RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security),
[database-functions guide](https://supabase.com/docs/guides/database/functions)
and [PostgreSQL explicit-locking reference](https://www.postgresql.org/docs/17/explicit-locking.html).

The existing database enum value `curator` is the retained technical name for
the human-facing **Admissions Manager** role. The server maps that one database
role to the single accepted Admissions interface; it does not create a second
role authority or compatibility runtime. A later forward migration may rename
the stored value only if the full dependent SQL inventory proves that change
is safer than the explicit mapping.

P2A follows Supabase's official SSR contract: cookie-backed server clients,
middleware/proxy token refresh, verified claims rather than a trusted
`getSession()` snapshot, and the existing custom-access-token hook plus live
membership/RLS checks. See the official
[server client](https://supabase.com/docs/guides/auth/server-side/creating-a-client),
[advanced SSR](https://supabase.com/docs/guides/auth/server-side/advanced-guide),
[JWT](https://supabase.com/docs/guides/auth/jwts) and
[custom-claims/RBAC](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac)
guidance.

Issue bodies must repeat their destructive/external boundary and legacy
eradication acceptance criteria. The sequence is strictly ordered unless the
plan records a justified dependency change before implementation.

## Completed historical V2 product-validation contract

This section preserves the product-validation contract and evidence completed
under ADRs 0022 and 0023. Its words such as `active`, `current` and `must` are
historical within this section and do not override ADR 0024 or the current
Supabase-backed production-successor authority above.

The completed historical goal was to prove the main EVO CRM product and its
real provider operations quickly in a private local contour. It was not a
production-readiness or replacement contract.

That completed V2 contour kept one staff interface and the core workflow
across Sales, Student 360, Admissions, Documents, Applications, Visa, Finance,
WhatsApp and advisory AI. It replaced the Supabase execution path with a
direct self-hosted runtime:

- a real private local PostgreSQL service;
- Drizzle schema definitions and committed, reviewed SQL migrations;
- a two-field server-side development gate with a short signed HttpOnly
  session cookie;
- three fixed test roles: Director/Admin, Sales Manager and Admissions Manager;
- server-side role authorization, with Admin as the full functional superset;
- Admin role-preview that renders the exact Sales or Admissions interface and
  permissions rather than a cosmetic approximation;
- application-owned private document bytes plus PostgreSQL metadata;
- a minimal append-only business event log sufficient to debug and verify
  consequential transitions.

The completed V2 product path did not use Supabase SDK/Auth/Storage/Realtime,
Supabase migrations or runtime environment variables. It did not dual-read,
dual-write, write through, fall back to Supabase/SQLite or preserve a
Supabase compatibility layer.

### Historical development access and fixed roles

The access page has exactly two fields. The first identifier selects one of
three technical profiles configured only through ignored local secrets; the
second value is that profile's secret. Both lookup and comparison happen only
on the server. A successful comparison creates a short-lived signed HttpOnly
cookie that carries only the selected technical role and expiry.

This is development access, not staff identity. There is no active account
lifecycle, signup, invitation, password recovery, per-user grant system,
membership administration or real-staff claim. The local contour remains
private/non-public. It does not ingest or migrate a broad real customer data
set; #464-#467 may use only the minimum fields and transcript context from one
owner-authorized exact provider target needed for proof: either an existing
real conversation/case or one clearly marked validation entity on the connected
session self identity. The run must never select an arbitrary customer merely
to satisfy acceptance.

The roles still have real server-side behavior:

- Sales Manager owns the Sales pipeline, lead qualification, next action and
  pre-handoff customer work;
- Admissions Manager owns handed-off Student 360 cases, tasks, documents,
  applications and visa work;
- Director/Admin can perform the union of both roles, exercise explicit
  overrides and preview the exact Sales or Admissions interface.

Role enforcement occurs in route handlers/server services and transactional
database commands. The active product-first build uses one local EVO
organization and does not build multi-organization tenancy, memberships,
cross-organization RLS or fine-grained per-user grants.

#### V2-3 fixed-role execution contract

V2-3 uses one canonical role vocabulary everywhere: `admin`, `sales` and
`admissions`. `curator`, `finance`, membership status and individual grant
vocabularies are not active authorization inputs. A server-resolved role policy
drives navigation, page guards, Server Actions, Route Handlers and repository
commands; a page-level redirect or hidden control is never the only check.

| Effective role | Allowed product responsibility | Required denial |
| --- | --- | --- |
| `sales` | Sales pipeline, qualification, ownership, next action and pre-handoff work | Admissions case/document/application/visa commands |
| `admissions` | handed-off Student 360, tasks, documents, applications, visa and the later minimal finance stop/release | Sales ownership and pre-handoff qualification commands |
| `admin` | union of Sales and Admissions plus explicit Admin controls | none inside the fixed-role product union |

The signed development session records both the gate-selected authority role
and the effective role. They are identical for Sales and Admissions. Admin may
ask a server action to reissue the same signed session with effective role
`sales` or `admissions`; while previewing, both the rendered interface and
server command checks use that effective role. Only the server-confirmed Admin
authority may enter, change or exit preview. Client state, query parameters and
unsigned cookies are never role or preview authority.

V2-3 replaces the historical staff-role shell in place. It removes the
`curator` projection, the fixture/connected/legacy staff-screen switches, the
staff fixture flag from those routes, and the real-staff lifecycle settings
surface that contradicts the three fixed profiles. The single surviving Sales,
Admissions and shared shell components receive neutral product names rather
than `Legacy*`, `Connected*` or `Fixture*` names. Supabase-backed business
repositories remain only under their already approved #429 expiry and are not
accepted as V2 proof; V2-3 adds no adapter, fallback or second UI around them.

Acceptance uses the real signed session, real Next.js routes/actions, real
PostgreSQL-connected app and real Chromium. It proves all three role shells,
Admin preview entry/exit, allowed route/command policy and direct denials without
creating fake leads or cases. Later business slices must exercise this same
policy when their real commands and canonical PostgreSQL records are added.

### Replace, do not layer

Each completed V2 slice leaves exactly one active runtime, data authority,
session/file path and UI for the capability it replaces. After real
database/application/browser proof, the same slice removes the superseded
runtime code, imports, dependencies, implementation tests, environment/config,
scripts, routes, webhooks/workers and parallel `Legacy*`/`Connected*`/
`Fixture*` screens. Its PR includes a scoped `rg` inventory and a real
fail-closed check showing no fallback survives.

Only frozen V1 staging/production and historical ADRs, migrations, runbooks,
archived docs, evidence and other historical decision/rollback documentation
may remain as inert deployment/rollback inputs; V2 may not import, execute,
bundle or treat them as authority. Temporary coexistence requires explicit
owner approval with named files, reason, expiry/exit criteria and a deletion
issue. Phase 0 records this rule and deletes no V1 code.

### Historical product paths that were proved

1. Start real local PostgreSQL, apply the complete migration chain and query it
   from the application.
2. Enter the real app through each fixed technical role and verify the exact
   role interface plus direct server denials.
3. Create and qualify a canonical Sales lead with owner and next action.
4. Show the lead and communications in the WhatsApp workflow and let an
   authorized staff role explicitly send final reviewed text through WAHA.
5. Enforce contract plus first mandatory payment before normal handoff.
6. Perform the audited Sales-to-Admissions handoff.
7. Operate Student 360: case, tasks, private documents, applications and visa.
8. Raise and release the minimal finance stop with a durable reason.
9. Produce a real Gemini draft and human-review it without granting the model
   action authority.
10. Execute the required amoCRM contact, lead, link, pipeline/status,
    responsible-user, note and tag commands while PostgreSQL remains canonical.
11. Explain every consequential transition and provider attempt through the
    minimal event log and durable command receipts.

In that completed local contour, private documents needed real local
persistence, authorized upload/download and resubmission, metadata, byte
length and checksum. Full backup/restore drills, off-host retention and
production rollback evidence were not active scope there.

Within that completed contour, WhatsApp, Gemini and amoCRM had to remain real
product paths rather than mocks or fake success. The owner authorized #464-#467
on 2026-08-29 to use the existing connected providers from the private V2
contour without routine confirmation. Credentials stay in ignored server-only
configuration. Gemini remains
advisory; only a staff role may send final reviewed text or invoke an explicit
amoCRM command. No autonomous reply, broadcast, fallback provider, blind retry
after an ambiguous result, V1 runtime change or production-readiness claim is
authorized.

### Completed foundation issue contract

| Order | Issue | Product outcome |
| --- | --- | --- |
| V2-0 | #424 | product-first architecture and issue reset |
| V2-1 | #425 | real private PostgreSQL and Drizzle migration gate |
| V2-2 | #426 | two-field development gate and three fixed role sessions |
| V2-3 | #427 | fixed Admin/Sales/Admissions server-side behavior and Admin preview |
| V2-4 | #428 | private local document persistence and authorized file routes |
| V2-5 | #429 | canonical CRM model and minimal business event log |
| V2-6 | #430 | Sales pipeline, lead qualification and inbound WhatsApp workflow |
| V2-7 | #431 | contract/payment gate and audited Admissions handoff |
| V2-8 | #432 | Student 360, tasks, documents, applications, visa and finance stop/release |
| V2-9 | #433 | staff WhatsApp workflow and human-reviewed Gemini draft |

#424 through #433 and parent #407 are completed foundation history. They are
not reopened or used as permission to revive deleted provider writers.

### Completed real-provider issue contract

| Order | Issue | Product outcome |
| --- | --- | --- |
| V2-10A | #464 | real Gemini provider acceptance on the canonical proposal/review path |
| V2-10B | #465 | one canonical human-reviewed WhatsApp outbound path through WAHA |
| V2-10C | #466 | permanent PostgreSQL-authoritative amoCRM writes and provider bindings |
| V2-10D | #467 | bounded real provider, PostgreSQL, application and browser acceptance |

Only #464 through #467 were active V2 long-run issues under parent #463. They
executed in this exact order as small PRs. Each PR required independent
exact-head review, all protected exact-head CI checks,
`gh pr merge --match-head-commit` and exact-main CI verification before the
next slice starts.

V2-8 (#432) is intentionally delivered as three internal vertical PRs under
the same issue:

1. replace the active Student 360 task path with canonical PostgreSQL reads and
   task commands in `/clients/:studentCaseId` and `/tasks`;
2. replace applications, visa milestones and minimal finance stop/release with
   canonical commands and UI;
3. wire the existing private-file foundation into the canonical document UI,
   then remove the remaining superseded Student 360/Admissions runtime paths.

#### V2-8B applications, visa and finance-stop execution contract

V2-8B has one write surface inside `/clients/:studentCaseId`. The
`/applications`, `/visa` and `/finance` routes are read-only queues over the
same canonical PostgreSQL authority and link back to the relevant Student 360
section; they are not parallel workflow implementations. Superseded dynamic
detail routes and their Supabase/RPC or SQLite actions, queries and
implementation tests are deleted after the canonical browser proof.

Admissions and Admin may create a university application as `draft`, update
its required next action, submit it and record an outcome. The allowed status
graph is `draft -> submitted -> accepted|rejected`, plus a reasoned withdrawal
from `draft` or `submitted`. Accepted, rejected and withdrawn applications are
terminal. Rejection and withdrawal require a durable reason. Every application
is owned by the fixed `admissions` role and is unique per case, institution,
program and intake.

Every newly handed-off case receives exactly one milestone for each canonical
visa kind: document preparation, appointment, submission, biometrics,
interview and decision. Allowed progress is `pending -> in_progress ->
completed`; `pending|in_progress -> blocked` requires a reason and `blocked ->
in_progress` resumes work. Completed milestones are terminal. Milestones keep
the fixed Admissions owner plus next action and due date where applicable.

Finance control is one case-level stop state, not a payment ledger or fourth
staff role. Admissions or Admin may assert the stop with a reason. Only Admin
may release an active stop, also with a reason. While stopped, server commands
reject both application submission and progress of the visa `submission`
milestone; no UI state, alternate route or legacy repository may bypass that
check. Other visa milestones remain operable.

All mutations require an active handed-off case, server-resolved Admissions or
Admin authority, optimistic row versions, idempotency receipts and an atomic
minimal business event. Exact replay returns the recorded result; a reused key
with a different request fails; a stale version or unavailable PostgreSQL
writes nothing and exposes no fallback. Sales is denied every mutation, while
Admin preview exercises the exact Admissions interface.

Each internal PR must remove the old runtime path for the capability it proves;
the split is not permission for dual read/write or fallback. Issue #432 remains
open until all three verticals and the final scoped legacy inventory are green.

#### V2-8C private documents and final Admissions replacement contract

V2-8C reuses the already proven #428 authority exactly: PostgreSQL
`evo_private_documents` and `evo_private_document_versions`, opaque objects
under the private `EVO_PRIVATE_DOCUMENT_ROOT`, and the three `/api/v2`
upload, resubmission and download routes. It does not copy bytes into
PostgreSQL, introduce a second document model, revive Supabase document slots
or use the legacy SQLite `documents` table.

Student 360 is the only document write UI. Admissions and Admin can upload a
PDF, JPEG or PNG of at most 25 MiB, see the stored metadata and immutable
version history, download any listed version and resubmit a new version of the
same document. `/documents` becomes a read-only PostgreSQL queue over the same
authority, showing the latest version and linking back to the owning Student
360 document section; the legacy numeric `/documents/:id` detail and its
mutation action are removed rather than adapted.

Every metadata read and byte download resolves the owning handed-off case on
the server. Upload and resubmission additionally require that case to be
active. Admissions and Admin are the only allowed roles; Sales, unknown UUIDs,
documents outside a handed-off canonical case, inactive-case writes, missing
PostgreSQL and missing or invalid private storage fail closed without an
alternate data or file path.
Responses and UI metadata never expose the opaque object key. Paused or closed
handed-off cases remain readable but render no upload or resubmission controls.

The slice replaces, rather than preserves, the old document review/status
workflow. V2-8C has no fake required-document slots or production review
approval lane: an uploaded document, its immutable versions, verified bytes
and owning case are the complete active product contract. After real
PostgreSQL, application, file-byte and Chromium proof, delete the inactive
`StudentWorkspace`/presenter, old Admissions case-workspace and document-review
actions/repositories, the SQLite staff document queue/detail/action path and
their implementation-level tests. Keep only outcome tests at the new
Student 360/private-document boundary and attach a scoped inventory proving no
active Student 360 or staff-document import, route or mutation can reach
SQLite, Supabase or a fallback.

#### V2-9 WhatsApp and advisory-Gemini execution contract

V2-9 is delivered as three small replacement PRs under Issue #433. The split
does not authorize two active implementations of any completed capability:

1. V2-9A replaces the staff `/whatsapp` queue and `/whatsapp/:conversationId`
   transcript with canonical PostgreSQL reads. Sales sees Sales-owned
   conversations, Admissions sees Admissions-owned conversations and Admin
   sees their union through the exact role-preview policy. Handoff transfers
   the lead's conversations to Admissions atomically with the canonical
   handoff; there is no second inbox, Supabase Realtime refresh, RPC read or
   SQLite fallback. This PR is read-only from the staff UI and exposes no send
   action. The superseded `/api/ai/draft` route is also removed in V2-9A:
   it reads the deleted SQLite WhatsApp tables and has no surviving UI caller.
   V2-9B introduces the canonical proposal adapter directly, without a
   compatibility window or fallback to that route.
2. V2-9B adds one server-only Gemini draft adapter over the canonical
   transcript and stores each successfully validated result in
   `evo_ai_proposals`. The persisted record identifies the conversation,
   optional Student Case, provider, configured model, provider time and exact
   source message context. The adapter requests structured JSON and validates
   the returned value again as untrusted application input. Missing key,
   disabled provider authorization, provider failure or invalid output reports
   a truthful blocked/error state and writes no proposal; no alternate model,
   local generator or canned draft may succeed instead.

   The active V2-9B entry point is a staff server action on the canonical
   `/whatsapp/:conversationId` page, not an internal HMAC endpoint. The
   provider uses the stable `v1` `@google/genai` Interactions API with `store: false`,
   synchronous execution, tools disabled and JSON `response_format`. The exact
   system instruction treats every transcript message as untrusted data rather
   than model instructions. The exact
   `EVO_V2_GEMINI_MODEL` value is required; EVO has no implicit model. A real
   call additionally requires both `EVO_V2_GEMINI_PROPOSALS_ENABLED=1` and
   `EVO_V2_GEMINI_PROVIDER_AUTHORIZED=1`, plus the server-only
   `EVO_V2_GEMINI_API_KEY`. All other states are blocked before provider
   execution and write no proposal. This replacement deletes the old
   HMAC/Supabase proposal execution, SQLite/Anthropic summary and deterministic
   Prepared AI canned-response contour; none remains as a callable fallback.

   Before any transcript reaches Gemini, the repository locks the canonical
   lead row, rechecks the caller's current owning-role access, reads the newest
   bounded transcript and reserves a deterministic command receipt. It keeps
   that same PostgreSQL transaction and lead lock through the configured
   provider call, whose timeout is bounded to at most 60 seconds, and through
   proposal/event persistence. Inbound ingestion and Sales-to-Admissions
   handoff take the same lead lock, so neither ownership nor source messages
   can change during disclosure. A concurrent duplicate waits, replays the
   completed receipt and does not call Gemini again. The latest-proposal read
   joins current conversation authorization and the proposal in one SQL
   statement, so it cannot return a draft after a role handoff between two
   reads.
3. V2-9C adds the human Accept/Edit/Reject workflow over that same PostgreSQL
   proposal and on the same canonical `/whatsapp/[id]` panel. It does not add a
   second review screen or review store. A role may review only a conversation
   it currently owns; Admin may operate the union. Accept preserves the stored
   proposal text, Edit requires the final reviewed text and Reject requires a
   non-empty reason. The repository rechecks current conversation ownership
   while locking the proposal/conversation boundary, writes the final review to
   the existing `evo_ai_proposals` row and appends exactly one
   `ai_proposal.accepted`, `ai_proposal.edited` or `ai_proposal.rejected` event
   in the same transaction. The same request replays only after a fresh access
   check; a different concurrent or later final decision fails closed. Review
   never authorizes send, creates an outbound message or changes consequential
   CRM state.

   V2-10B / #465 supersedes the V2-9 read-only WAHA preflight. The standalone
   preflight UI, action, module and retired flag alias are not active runtime
   paths. Session verification now belongs to the one canonical server-only
   WAHA provider adapter and is used inside the explicit outbound workflow,
   not exposed as a second staff operation. The active environment contract is
   `EVO_V2_WAHA_ENABLED`, `EVO_V2_WAHA_PROVIDER_AUTHORIZED`,
   `EVO_V2_WAHA_BASE_URL`, `EVO_V2_WAHA_API_KEY` and
   `EVO_V2_WAHA_SESSION_NAME`. Disabled, missing or invalid configuration,
   credentials or provider authorization is `blocked` and performs no provider
   request. Before the single outbound request, the adapter requires an
   authorized `GET /api/sessions/{session}` response for the exact configured
   session whose status is exactly `WORKING`; otherwise the send stops clearly.
   The API key stays server-only in `X-Api-Key`. Start, restart, logout and QR
   operations remain outside the V2 product path.

The current provider contract follows the official WAHA session and API-key
documentation and the official Gemini structured-output documentation. WAHA
uses a server-only `X-Api-Key`; only `WORKING` counts as ready. Gemini uses the
committed `@google/genai` SDK, a server-only key, an explicitly configured
model and a small JSON schema whose final value is parsed and business-
validated by EVO. The model name is configuration, not a silently changing
default. These contracts are documented at
<https://waha.devlike.pro/docs/how-to/security/>,
<https://waha.devlike.pro/docs/how-to/sessions/> and
<https://ai.google.dev/gemini-api/docs/structured-output>. The Interactions
selection also follows
<https://ai.google.dev/gemini-api/docs/interactions-overview> and the stable
API-version contract at
<https://ai.google.dev/gemini-api/docs/api-versions>.

At #433 exit, no V2-9 browser or server route could send WhatsApp, write
amoCRM, enable an autonomous reply or invoke a fallback provider. That was the
truthful pre-authorization boundary proved by V2-9. The 2026-08-29 owner
decision and ADR 0023 now supersede only the no-real-call/no-write restriction
for the new #464-#467 canonical paths; they do not revive any deleted V2-9
sender, writer, worker or fallback.

Each internal PR deletes the superseded active runtime for the capability it
proves. By #433 exit, the V2 app import/route graph contains no Supabase/SQLite
staff WhatsApp reads, Supabase browser realtime, old AI draft/summary route,
manual-send worker, autonomous-reply worker, Supabase-backed Gemini proposal
or review repository, or old WhatsApp/Gemini implementation test. Frozen V1
deployments and historical ADRs, migrations, runbooks, archived docs, evidence
and other decision/rollback documentation remain unchanged and are excluded
from the active-import inventory.

#### V2-10 real-provider execution contract

V2-10 uses the existing connected provider accounts and four sequential
issues. The owner granted standing authority for the actions inside this
contract; agents do not pause for routine confirmation after every provider
call. A missing secret, provider denial, unresolvable recipient/case or a side
effect outside the named issues remains a real stop rather than permission to
guess, simulate or fall back.

1. **V2-10A / #464 — Gemini acceptance.** Exercise the existing canonical
   Interactions adapter with `store: false`, tools disabled, one explicit model
   and structured JSON on the minimum authorized context from an existing real
   conversation. PostgreSQL locks the source context and command receipt as
   already defined by V2-9. The application validates the response, persists
   the provider-returned `created` timestamp and stores the proposal before it
   requires Accept/Edit/Reject in the actual staff UI. A stateless
   `store: false` response may omit the provider interaction ID; absence is
   stored as no reference, a returned reference must validate, and the app must
   never invent one. Current SDK HTTP failures are classified from structural
   status and bounded provider error-info reasons, never from provider message
   text. There is no artificial call-count or cost limit in the product
   contract, but a completed receipt replays instead of paying for or
   disclosing the same request again.
2. **V2-10B / #465 — WAHA outbound.** Add one server-only adapter for the
   official `POST /api/sendText` operation and one explicit send action on the
   canonical conversation UI. This slice deletes the separate WAHA preflight
   panel as an active surface: the same send path performs the exact `WORKING`
   session check internally and, after a successful send response, performs the
   immediate provider read-back needed to reconcile current delivery/ACK state.
   The action rechecks current role ownership and persists a unique send attempt
   and processing receipt before any provider request. Only the direct canonical
   chat identity (`@c.us` or `@lid`) already received from that conversation is
   eligible. The `WORKING` session response also proves its own `me.id` and
   optional `me.lid`; when the canonical recipient is one of those self
   identities, WAHA may return either member of that exact provider-proven pair.
   No unrelated or inferred recipient alias is accepted. Success records the
   provider message identity and timestamp, then creates the one canonical
   outbound message plus the latest reconciled ACK marker. A timeout, lost
   response, provider 5xx or malformed success response becomes a durable
   `unknown` result with no fake message and no blind resend. The same UI may
   perform a read-only, bounded reconciliation of that exact attempt: only one
   provider message matching its immutable text, time window, outbound direction
   and verified recipient identity may settle it; zero or multiple matches leave
   it `unknown`. An explicit provider rejection becomes a durable `rejected`
   result. Exact
   request replay returns the stored result, while changed-payload reuse
   conflicts. Sales and Admissions may send only while the conversation still
   belongs to their role, and Admin is the union. Staff-authored final text and
   the exact accepted/edited Gemini text share this one send command; the model
   cannot invoke it. No group/broadcast send, autonomous worker, second sender,
   standalone preflight UI, public webhook dependency or fallback route is
   allowed.
3. **V2-10C / #466 — amoCRM writes.** Add one canonical server-only integration
   over account metadata discovered from the real connected amoCRM account.
   The account read requests `with=datetime_settings` and obtains timezone only
   from the documented `_embedded.datetime_settings.timezone` object; it must
   not invent an undocumented top-level timezone field. Custom-field `code`
   values are bounded, exact, inert provider strings rather than application
   identifiers with an invented leading-character grammar. Only the exact
   unique `PHONE` and `EMAIL` codes have routing meaning; every other code is
   catalog evidence and is never executed or interpolated.
   PostgreSQL remains the business authority and stores durable provider
   bindings/command receipts. Explicit product commands may create, update and
   link contacts/leads and apply the required pipeline, status,
   responsible-user, note and tag operations. Every operation uses exact
   server-side role/workflow authorization, provider correlation and read-back.
   Managed Sales and Admissions tag names are part of the routing contract,
   but their provider IDs may be absent on the first command. In that case the
   same canonical lead-tag mutation adds the exact tag by name, reads back the
   provider-created ID and rejects duplicate exact-name matches; there is no
   separate tag-bootstrap writer or prerequisite manual setup. Existing tag
   IDs remain the preferred mutation identity after discovery.
   The active V2 auth path is one private-integration long-lived Bearer token
   stored only in ignored server-side secret material. V2 does not depend on
   `refresh_token` rotation, `client_id`, `client_secret`, `redirect_uri` or
   `POST /oauth2/access_token` during normal command execution. If the token is
   missing, expired, revoked, malformed or rejected, the command path fails
   clearly with no fallback auth path or blind retry.
   The active V2 amoCRM path does not require or exercise the private-
   integration permissions `files`, `files_delete`, `notifications` or
   `push_notifications`. Their presence on the already connected integration,
   if any, is pre-existing provider configuration rather than V2 authority:
   do not add, modify or reissue token permissions solely for this acceptance
   run.
   An ambiguous result is reconciled before retry; amoCRM is never a dual-write
   authority, fallback repository or source of a second workflow state.
4. **V2-10D / #467 — real acceptance.** Use one minimized owner-authorized
   exact provider target whose private identifiers stay out of Git and GitHub
   evidence: either an existing real conversation/case or one clearly marked
   validation entity on the connected session self identity. Prove `Gemini
   proposal -> human review -> explicit WAHA send -> provider identity/ACK ->
   amoCRM command/read-back` through the real application, PostgreSQL and
   Chromium. If no exact safe target can be resolved, the run blocks honestly
   rather than selecting an arbitrary customer or creating fake business data.
   Deliver this final proof through this reviewed plan stage, one separately
   reviewed inert harness PR and one bounded exact-main execution. The harness
   PR adds the combined runner and its fail-closed tests without calling a
   provider. Then run that merged harness against one disposable PostgreSQL
   database and the private local application. The run
   may request one real Gemini proposal automatically, but it must stop in a
   visible `review_required` state before any WAHA send or amoCRM command. One
   real human must inspect the actual proposal in Chromium and either accept it
   or edit it, then explicitly confirm the final send. This is required product
   input, not a new provider-operation approval; the standing #463 authority
   remains sufficient and no routine confirmation is added. Playwright, Codex
   and Gemini must not click the review or send controls on the human's behalf.
   After the reviewed send, the same run may execute the explicit amoCRM sync,
   reconcile provider identities and ACK, prove exact replay/no duplicates and
   finalize only hashed/count evidence. An interrupted or ambiguous run
   preserves its private database and dispatch markers and resumes by exact
   reconciliation; it never starts a second send or selects another target.
   Recovery has two explicit durable boundaries: the pre-send human-review
   checkpoint and a post-WAHA checkpoint created only after PostgreSQL plus an
   exact read-only provider lookup prove the one reviewed message identity and
   ACK. A run resumed from the post-WAHA boundary disables Gemini and WAHA
   mutation authority, performs no inbound seed, review action or send, and may
   continue only with the one remaining amoCRM sync, read-back and exact replay.
   A provider rejection before a proposal exists, with zero downstream
   mutations, writes immutable exact-SHA failure evidence and stops. A fresh
   attempt is permitted only after a concrete new provider signal such as an
   owner-supplied credential that passes a real non-mutating provider check,
   an append-only authorization entry, a newly reviewed and merged exact-main
   SHA and an empty evidence directory for that SHA. The prior failure marker
   is never edited, moved or deleted, and the fresh attempt remains single and
   bounded rather than becoming an automatic retry loop.

Provider secrets remain in ignored server-only files or the authorized secret
injection workflow and never enter browser state, PostgreSQL business rows,
logs, Git, issues or PR evidence. #465 and #466 replace the completed read-only
restrictions with exactly one active provider path each; their slices delete
any superseded active writer, token/config dependency, route, script and
implementation test after real proof. Frozen V1 deployments and historical
artifacts remain inert and unchanged.

The contracts follow the current official provider documentation:

- WAHA send, session, event and API-key contracts:
  <https://waha.devlike.pro/docs/how-to/send-messages/>,
  <https://waha.devlike.pro/docs/how-to/sessions/>,
  <https://waha.devlike.pro/docs/how-to/events/> and
  <https://waha.devlike.pro/docs/how-to/security/>;
- Gemini Interactions and structured output:
  <https://ai.google.dev/gemini-api/docs/interactions-overview> and
  <https://ai.google.dev/gemini-api/docs/structured-output>;
- amoCRM/Kommo OAuth, contacts, leads, links and notes:
  <https://developers.kommo.com/docs/oauth-20>,
  <https://developers.kommo.com/reference/add-contacts>,
  <https://developers.kommo.com/reference/adding-leads>,
  <https://developers.kommo.com/reference/link-entities> and
  <https://developers.kommo.com/reference/add-notes>.

### Real validation boundary

- Use Node `22.23.1` and OrbStack with Docker context exactly `orbstack`.
- Use real PostgreSQL, actual SQL migrations, actual application routes, real
  file bytes and a real browser.
- Isolated technical records may prove mechanics, but no fake/demo record may
  be presented as business acceptance.
- Do not invent provider success. A missing real credential is a named blocked
  state, not a mock, fallback or skipped-success result.
- Ordinary lint, typecheck, unit/integration, browser and build checks remain
  required in proportion to each slice.

### Historical deferred set before ADR 0024

The following were preserved as one deferred-before-broad-real-use note and
were not active dependencies for local product and bounded provider validation:
production-grade staff authentication/account lifecycle; multi-organization
tenancy and cross-organization RLS; fine-grained per-user grants; public/VPS
deployment, DNS/TLS/Caddy and paid infrastructure; production monitoring,
health center, compliance-style audit/export; full database/file restore drills
and production rollback proof; managed staff acceptance; a 10-day or five-case
pilot; broad or historical customer migration; replacement, cutover and
tagging.

ADR 0024, parent #543 and children #544-#553 are now the separately authorized
plan covering the applicable controls. The historical bounded provider
authority in #463-#467 by itself granted no deployment, broad migration or
cutover authority.

V1 staging and production, their code, data, images, runbooks and rollback
artifacts remained unchanged during that program. The V1 history below is
retained as evidence and does not override the current ADR 0024 successor
contract.

## Frozen unified V1 authority and execution evidence

- EVO is one internal platform with one login, one accepted UI, one pilot role
  model and one end-to-end workflow. CRM, Inbox, Lead Agent, Admissions,
  Finance, Tasks, Documents and AI are modules, not separate products.
- Supabase is canonical for operational client, lead, stage, ownership, next
  action, Student Case, documents, applications, visa, payment control, tasks,
  communications and audit. SQLite runtime/fallback, dual-read, dual-write and
  compatibility layers are prohibited.
- amoCRM is a temporary read/import adapter. WAHA is a private transport
  adapter. Gemini Flash is the single pilot AI provider; every result is a
  human-reviewed draft and cannot act autonomously.
- The normal Admissions handoff requires confirmed contract plus first
  mandatory payment. Director/Admin override requires a reason and audit.
- The first live stage is receive-only: no outbound WhatsApp and no amoCRM
  write. Repository evidence does not prove managed Supabase, provider,
  deployment, backup or rollback behavior.
- The pilot is net-new after an explicit cutoff or an authorized small
  allowlist. Existing active and historical legacy records stay excluded or
  read-only until separately approved post-pilot work. No coexistence bridge,
  broad pre-pilot migration or fallback write path is authorized.
- For #382-#388, exact-diff self-review, all required exact-head CI,
  `--match-head-commit` and exact-main verification are mandatory. A separate
  GitHub Reviews API `APPROVED` record is not a merge gate for this owner-
  authorized program.

The historical V1 dependency order was:

| Slice | Issue | Outcome |
| --- | --- | --- |
| U0 | #377 | Authority docs and complete legacy crosswalk |
| U1 | #378 | One login and three pilot roles |
| U2 | #379 | Canonical Supabase client and lead |
| U3 | #380 | Receive-only WhatsApp in the unified Sales queue |
| U4 | #381 | Sales qualification, owner and next action |
| U5 | #382 | Contract and first-payment evidence |
| U6 | #383 | Audited Sales-to-Admissions handoff |
| U7 | #384 | First complete Admissions case |
| U8 | #385 | Minimal payment control and finance stop-factor |
| U9 | #386 | One Gemini Flash assistant with human review |
| U10 | #387 | Net-new pilot cohort and legacy isolation |
| U11 | #388 | Truthful admin health, audit, backup and rollback |
| U12 | #389 | Real managed receive-only acceptance |
| U13 | #390 | Ten-workday, five-case internal pilot |
| U14 | #391 | Historical closed-record migration/archive |

U0 merged as one reviewed docs-only PR. Its complete disposition of the 16
then-current draft PRs and 11 pre-#376 open issues remains in
`docs/platform/u0-draft-pr-issue-crosswalk.md`. U1 merged in PR #393 with one
login, exactly `sales`/`curator`/`admin`, live Supabase claim-to-row validation,
Admin-only lifecycle management, immediate revocation and explicit individual
contract/first-payment permissions. U2 added the canonical client/lead
identity, provenance, duplicate and bounded read contract described in
`docs/platform/u2-canonical-client-lead.md`. U3 merged in PR #395 with signed
receive-only WAHA intake, canonical conversation linkage and bounded Sales
intake/history reads described in
`docs/platform/u3-receive-only-sales-queue.md`. U4 merged in PR #396 and owns
only canonical
Sales qualification, eligible owner assignment, paired next action/deadline,
truthful connected/unconnected queue filters and durable audit described in
`docs/platform/u4-sales-qualification-owner-next-action.md`. U5 merged in PR
#397 and owns the contract/first-payment gate described in
`docs/platform/u5-contract-first-payment-gate.md`. U6 merged in PR #398 and
owns the audited canonical handoff described in
`docs/platform/u6-sales-admissions-handoff.md`. U7/#384 merged in PR #399 at
`bbc78a376b017a1d068c20ccce7978a128858371`; exact-main run `33004299957`
completed successfully. Its workspace contract remains
`docs/platform/u7-admissions-case-workspace.md`. U8/#385 merged in PR #400 at
`e3a681774bcb2c37a7f4c1600341cc16d6282892`; exact-main run `33013322714`
completed successfully. Its implementation contract is
`docs/platform/u8-payment-control-stop-factor.md`. U9/#386 merged in PR #401 at
`48d15818d51a629ea97f914b93c2beca82ee0c2b`; exact-main run `33017855457`
completed successfully. Its human-review contract remains
`docs/platform/u9-gemini-human-review.md`; repository evidence does not claim
live Gemini or production proof. U10/#387 merged in PR #402 at
`2ea92ac547d7f526f0e886a81f871936af456635`; exact-main run `33024106321`
completed successfully. Its contract remains
`docs/platform/u10-net-new-pilot-cohort-legacy-isolation.md`. U10 extends
canonical Student Cases with explicit pilot membership and a truthful
legacy-write boundary; it does not authorize a legacy fallback, provider
action or production rollout.

U11 repository implementation merged in PR #404 at
`6d2109b865da334bd41ad8c432147a2f7045937b`; exact-main run `33073539999`
completed successfully. On 2026-08-27 the owner-authorized staging execution
created a data-less persistent Supabase Micro branch, applied migrations
`001-092`, provisioned one approved Admin, passed protected validation-only
GitHub run `33084233185`, and started only the exact V1 CRM app under Compose
project `evo-crm-staging`. Production remained on
`ee8a825ebc72f84449636e3feaefab7a330913d4` with restart count `0`.
Canonical `staging.crm.evoadmissions.com` DNS, real browser UI acceptance and
the Database plus separate Storage recovery drill remain blocked/open, so this
execution does not close #388, complete R3 or authorize R4 production
promotion.

## Historical pre-#376 execution record

Everything below this boundary records earlier P/BW/NW/P8 planning and exact
historical evidence. It is not an active execution sequence and cannot
override #407, ADR 0022 or active V2 issues #424-#433.

Historical P1, reusable greenfield P2A-P2H, BW0, P3A-P3C, BW1-BW7,
P2R0-P2R4 and P4A are merged. PR #118 merged the P4B docs-only contract, PR
#128 merged the owner-authorized correction that keeps Student Profile document
automation outside `evo_AI_CRM`, and PRs #129-#130 merged the local-validation
prerequisite and repair, PR #132 merged the disabled-by-default P5A WAHA
ingress, PR #133 merged the disabled-by-default P5B projection, PR #137 merged
the P5C available-history reconciliation lane, and PR #138 merged the
disabled-by-default P5D private WAHA media archive and accepted media display.
PR #141 merged the disabled-by-default P5E ACK/session projection and private
Realtime invalidation lane, PR #142 merged the bounded P4R1 read-only
canonical amoCRM context lane, PR #144 merged the disabled-by-default P5F1
Platform-owned memory/retrieval foundation, PR #145 merged the disabled-by-
default P5F2 stateless Gemini proposal adapter, PR #146 merged the disabled-by-
default P5F3 deterministic autonomous inbound-reply lane, and PR #147 merged
the reviewed P6A-P6D implementation contract. PRs #148, #149, #152 and #153
then merged P6A read-only attention, P6B durable Student Portal notifications,
P6C overdue-transition publication and P6D cross-domain Student 360 closure.
PR #154 merged the P7 security/reliability contract, PR #156 merged P7A safe
Admin-only audit search/export, PR #157 refreshed accepted status and the
OrbStack-only rule, PR #160 merged P7B private observability, PR #163 merged
the P7C authority contract plus the `evo-platform-prod` organization and name
consolidation, PR #164 deferred the P7C drill, PR #165 merged the local
knowledge-ingestion contract, PR #166 merged its deterministic Takeout
preparation pipeline, PR #170 merged the real lead-processing proof plan, and
PR #171 merged Codex review plus Obsidian publication. PR #169 merged the
focused P7D accessibility contract, and PRs #172-#174 hardened the local
knowledge-ingestion path. PRs #208, #212 and #214 then merged knowledge
audience isolation, atomic Obsidian bundle sync and audited staff assistants;
PR #215 merged the P8D4 staff-pilot contract, PR #216 merged the supervised
Lead Agent sales policy, PR #218 unified Platform intake memory with the
draft-only consultative-sales proposal path, and PRs #220 and #222 refreshed
and bound the unified P8D4 portable candidate. PRs #224 and #226 then applied
production migrations `073-076` and froze the final 11/291 knowledge identity,
PR #228 repaired the isolated importer Compose invocation, PR #230 packaged
the importer as a runnable, UUID-redacting production-image artifact, and PRs
#232-#233 built and independently verified the exact P8D4F `linux/amd64`
candidate, and PR #235 authorized the closed P8D4G production execution order.
Repository status through PR #374: the single active WAHA session authority
merged at 2026-08-23 02:12:16 UTC, which is 2026-08-23 08:12:16 in the workspace
timezone (+06), as `2db8810213c7944aaf2f1b8e52ef4c0ab7824aa5`; the canonical
migration chain is contiguous through `001-082`; and exact-head PR CI run
`32611834420` passed Changed range, Main CRM, EVO Inbox and EVO Lead Agent. A
post-merge tree comparison also confirmed that the merge commit is equivalent
to the reviewed PR head `9f7901d7cf2c434819b86d634fd26af102302615`.
Always re-query `origin/main` and exact-main CI before a release instead of
treating this recorded merge SHA as a moving-current alias.

P4B implementation is preserved on remote branch
`izzhackt/evo-platform-p4b-mapping-approval` at
`e53ba94954f147b295f596421a255591fa343ce8`; no implementation PR exists.
Focused repository checks passed, but its attempted full local Supabase gate
failed closed in the real Auth/PostgREST hook before Playwright and is
failed/non-evidence. The owner keeps P4B activation/writes deferred but resumes
a bounded read-mostly P4R lane after the messaging foundation. P9 remains
removed. Lead Agent, the legacy webhook/session path and rollback path remain
deployed/frozen. P5A-P5F3 and P4R1 are merged without real-provider proof. The
completed P6A-P6D evidence is synthetic/local and authorizes no managed or
production claim. P7A and P7B are repository/local evidence only and remain
disabled by default. On 2026-08-14 the owner deferred the P7C restore drill
until the Platform is functionally complete and concretely operating.
Supabase Pro scheduled database backups remain enabled, but they are not
restore evidence and do not include Storage object bytes. `inbox-prod` is a
currently separate deployment contour, not a separate target product. Keep it
stable until a separately authorized unified-Platform cutover proves the
replacement path, then retire the contour without a dual-read/write bridge.
Read-only server evidence on 2026-08-23 (+06) shows healthy CRM, Inbox and Lead
Agent application images at release
`ee8a825ebc72f84449636e3feaefab7a330913d4`, with the sslip.io CRM and Inbox
health routes returning HTTP 200. That release predates PRs #371-#374 and still
runs three application boundaries plus two WAHA services; it is not the target
all-in-one proof. Canonical DNS/TLS is deferred by owner direction. P8R5 and
P8R6 are merged in the repository, but production still runs the older
`ee8a825e...` release and there is no real provider proof for the new path. The
active non-runtime lane is BH1 repository branch/worktree hygiene; it cannot
authorize deployment or provider activity. All outbound WhatsApp and amoCRM
writes remain disabled.

Separate owner-authorized hygiene on 2026-08-23 removed only the superseded
temporary revision `2c38a325e85fe798ccece31c4e91db909a49246d`: its three
unused EVO application image tags and exact `/opt/evo-releases/<sha>` checkout.
No active container, WAHA image, volume, rollback tag or `ee8a825e...` release
was removed; CRM and Inbox fallback health remained HTTP 200 afterward.

The previously active P8D4S lane under issue #270 remains historical evidence.
P8D4R safely verified the exact candidate,
migrations `001-076`, staging, rollback capture and disabled configuration,
then stopped with `knowledge_failed` before any database import, application
deployment or pilot. Cleanup removed all four local build roots, the remote
knowledge directory and the isolated importer; all five production containers
retained their prior image IDs, healthy state and restart count zero. The
immutable P8D4R result is retained with SHA-256
`9217322cf48f96daadd8ef780732b8c29cc54e9234bc4c6e2b8ecfbe4c459577`.
Its evidence incorrectly records account resolution and deterministic builds
as `not_run` even though four removed build roots prove those pre-effect
substeps ran. P8D4S corrects only this evidence integrity gap: partial
knowledge progress and a fixed redacted failure step/attempt must be retained
on failure, while credentials, UUIDs, content, stderr and private paths remain
excluded. The existing three spaced `scp` attempts, byte/deadline checks and
all remote/container SHA-256 gates remain unchanged. It uses new
collision-free release, rollback and evidence roots.
After independent review, merge, exact-main CI, execution-control rebinding,
fresh preflight and a new action-time confirmation, it may resume the frozen
11/291 import, deploy the three application boundaries with outbound behavior
disabled, and run only the two fixed staff draft pilots under
`docs/platform/p8d4-current-main-staff-pilot.md`. The owner
deferred the large capacity stress test and approved a small-launch monitoring
envelope plus focused human review on the exact P8 candidate.
Updated 2026-08-17 in the workspace timezone.

This document is the execution contract for the current EVO Platform MVP lane in
this repo. The current detailed contract is
`docs/EVO_PLATFORM_LONG_RUN_PLAN.md`. New implementation lanes are blocked
until their plan and `docs/PLAN_CHANGES.md` amendment are independently
reviewed and merged. If scope, architecture, API/schema, acceptance criteria,
file ownership or merge order changes, stop the affected code change and merge
a separate plan amendment first.

## Lead-processing real-proof lane

Block-ID: `EVO-LEAD-PROCESSING-REAL-PROOF-PLAN-2026-08-14`.
Tracking issue: [#168](https://github.com/izzhackt/evo_AI_CRM/issues/168).

This lane converts the merged, disabled Platform messaging capabilities into a
reviewable sequence for later real-provider proof. It authorizes documentation
only. It does not authorize deployment, a managed Supabase migration, WAHA
webhook/session changes, WhatsApp messages, amoCRM writes, Gemini calls,
autonomous replies or provider-side configuration.

### Verified baseline

- Current GitHub `main` is `f363630cd2296da32930f18e64c2895e60475818`.
  Push CI run `31804372439` was still in progress when this docs head was
  created. PR #166 merged the separate knowledge-ingestion K2 implementation
  while this plan was under review; its files remain outside this lane. No
  lead-processing implementation PR was open when this refreshed baseline was
  recorded.
- P5A-P5F3 and P4R1 are merged and disabled by default. Repository contracts
  cover signed raw ingress, idempotent projection, history/media handling,
  ACK/session state, read-only canonical amoCRM context, Platform-owned memory
  and approved-knowledge retrieval, structured Gemini proposals,
  qualification, deterministic send eligibility, staff takeover/pause/resume
  and append-only audit evidence.
- Production `/opt/evo-crm` was inspected read-only on 2026-08-14. Its running
  app image and source revision are
  `564332b420a1fb1bd6232dda945d044bb922d3f0`, started 2026-07-24. The running
  app and `.env.production` expose none of the Platform enablement flags. The
  merged Platform lane is therefore not deployed or enabled there.
- No accepted evidence proves the real chain from WhatsApp through Platform
  persistence, amoCRM context, approved-knowledge retrieval, Gemini proposal,
  governed reply or handoff, WAHA ACK and staff-visible audit. Local and CI
  fixtures remain repository proof only.

### External contracts rechecked

- WAHA documents `message` as inbound, `message.any` as every message creation
  including messages sent through its API, `message.ack` as delivery/read/error
  progression, and `session.status` as the session lifecycle. The Platform must
  keep inbound identity, outbound observation, ACK and session reconciliation
  distinct: <https://waha.devlike.pro/docs/how-to/events/>.
- Kommo documents contacts as people, leads as sales opportunities and explicit
  links between them. P4R1 may read canonical linked context; creation, linking
  or stage mutation remains a separately approved write:
  <https://developers.kommo.com/reference/link-entities>.
- Gemini structured outputs constrain the final JSON shape but do not make its
  facts or reply safe. The deterministic Platform policy remains the only send
  authority: <https://ai.google.dev/gemini-api/docs/structured-output>.

### Approval-gated execution order

1. **L0 — contract (this block).** Merge this docs-only baseline after
   independent exact-head review and CI. No runtime or provider action.
2. **L1 — deploy disabled capability.** With explicit action-time deployment
   approval, deploy an exact reviewed Git SHA and apply the already-merged
   additive migrations. Keep every Platform enablement flag off and the
   autonomous-reply kill switch engaged. Prove revision, migration inventory,
   private routing, health and rollback without provider calls.
3. **L2 — receive-only intake.** With explicit WAHA webhook/session-cutover and
   managed-Supabase approval, use one EVO-controlled sanitized sender. Prove
   HMAC verification, raw persistence before processing, replay safety,
   operator-visible text and media, history reconciliation and private
   Realtime. Send no reply and write nothing to amoCRM.
4. **L3 — canonical context and retrieval.** With explicit approval for one
   real amoCRM read and the approved-knowledge publication contract available,
   resolve the sanitized sender to canonical contact/lead context or record a
   fail-closed human handoff. Consume only versioned approved knowledge and
   persist retrieval evidence; never read the raw ingestion archive directly.
5. **L4 — structured proposal and governance.** With explicit Gemini-call
   approval, produce one schema-valid proposal bound to the exact message,
   memory version, qualification version, amoCRM-context observation and
   knowledge evidence. Exercise forced-human, staff takeover/pause and audited
   resume without sending WhatsApp.
6. **L5 — one governed outbound proof.** Only if the owner separately approves
   a real WhatsApp send, queue one eligible single-use reply to the sanitized
   number, reconcile `message.any`, ACK and session evidence, and prove that an
   unknown transport outcome cannot retry automatically. Otherwise L5 remains
   blocked and the accepted milestone is receive-only plus draft/handoff.

Every block requires its own linked issue/PR, exact-head independent review,
green exact-head CI, real-path evidence, rollback record and final provider-
state recheck. A block must stop before the first externally visible action if
its action-time approval or credential is absent.

### Inputs and blockers

- deployment approval for `/opt/evo-crm` and the managed Supabase target;
- explicit ownership/cutover choice for the single target `evo-inbox` WAHA
  session and webhook, without altering the retained Lead Agent rollback path;
- sanitized EVO-controlled test sender and an identifiable test lead;
- backend-only WAHA, Supabase, amoCRM-read and Gemini credentials;
- approved, versioned knowledge artifacts and their retrieval publication
  interface from the independent ingestion lane;
- separate action-time approvals for one amoCRM read, one Gemini call and, if
  L5 is attempted, one WhatsApp send.

The default milestone is L4 with no send. No amoCRM write is required or
authorized anywhere in L0-L5.

## Local EVO Knowledge Ingestion Lane

Proposed independent slice: `EVO-KNOWLEDGE-INGESTION-LOCAL-2026-08-14`.
This slice does not modify or deploy the production CRM, EVO Inbox, WAHA,
amoCRM, Supabase, or any managed provider. It creates a local, resumable
pipeline that prepares the owner-supplied Gmail and Google Drive Takeout data
for semantic review by the authenticated Codex app or CLI without using the
OpenAI API or storing an API key.

### Scope

1. Add a Python CLI under `scripts/knowledge_ingestion/` and focused tests under
   `tests/knowledge_ingestion/`.
2. Read source roots without modifying them. The first real sources are the
   Gmail MBOX and Google Drive snapshot in
   `/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Сырой архив ЭВО`.
3. Write generated manifests, checkpoints, extracted business text and Codex
   review queues only beneath a caller-supplied output root. The default
   operational output is the internal Obsidian vault's `Входящие кандидаты`.
4. Use SHA-256 as content identity, preserve every source path as provenance,
   and avoid re-extracting content that a completed checkpoint already covers.
5. Exclude every Google Drive path beneath `Корзина` and every Gmail message
   labelled Spam or Trash from analysis.
6. Detect sensitive applicant files conservatively from path, filename and file
   type. Record only archive metadata for them; do not extract document text,
   OCR, previews, or attachment bodies.
7. Extract supported business content locally from plain text, HTML, PDF,
   DOCX, XLSX and PPTX. Unsupported or failed files remain explicit manifest
   records; there is no fake or empty-text success.
8. Extract Gmail business attachments under the same rules as Drive files and
   deduplicate them by SHA-256 across all sources.
9. Generate bounded Codex review batches and a Russian instruction contract.
   The preparation CLI must never call an LLM API. An optional operator command
   may invoke the installed authenticated `codex exec` CLI, so usage remains
   Codex-plan usage rather than OpenAI API billing.
10. Keep the client-facing Obsidian vault outside direct ingestion. Only
    reviewed outputs may be promoted there under the knowledge authority rules
    in `AGENTS.md`, `CONTEXT.md`, and ADR 0014.

### Delivery blocks

- **K1 — Contract and fixtures:** merge this plan amendment, domain vocabulary,
  ADR and repository rules before implementation.
- **K2 — Deterministic preparation:** implement source discovery, exclusions,
  sensitive classification, local extraction, SHA-256 deduplication,
  checkpoints, manifests and bounded review batches.
- **K3 — Codex review and Obsidian publication:** add the authenticated Codex
  CLI operator command, structured review schema, authority resolution and
  idempotent Russian Markdown publication to the internal vault.
- **K4 — Real corpus completion:** run K2 and K3 against all accepted source
  material, record counts and failures, resolve escalated conflicts, and verify
  that prohibited content never enters either AI vault.

### K2 acceptance criteria

- The CLI runs against the real Gmail and Drive roots and exits non-zero for a
  missing source, extraction failure that was incorrectly marked successful,
  corrupt checkpoint, or output outside the caller-authorized root.
- Re-running unchanged real inputs produces no duplicate extraction or review
  item and reports a zero-new-work result.
- No item beneath Drive `Корзина`, no Gmail Spam/Trash item, and no extracted
  sensitive applicant content appears in generated text or review batches.
- The manifest preserves source path, source kind, size, modified time,
  SHA-256, classification, extraction status and all duplicate locations.
- Tests cover the real supported parsers with repository-owned non-sensitive
  files; the end-to-end gate additionally runs against the owner-supplied real
  Takeout roots and reports real counts without printing personal content.

### K2 validation commands

- `python3 -m unittest discover -s tests/knowledge_ingestion -v`
- `python3 scripts/knowledge_ingestion/prepare.py --help`
- a real preparation run with explicit Gmail, Drive and output roots;
- the same real command a second time to prove resumability and idempotence;
- a manifest audit that fails if excluded or sensitive content entered a review
  batch.

### Stop conditions

- Stop before reading source content if the expected real roots are missing or
  their recorded Takeout checksums no longer verify.
- Stop before Codex execution if CLI authentication is unavailable or the
  prepared batch contains a prohibited classification.
- Stop before client-vault publication when authority is unresolved, a source
  conflict is escalated, or the destination is not the configured client vault.

For the currently active owner-authorized MVP lane, older references in this
file to a scheduled Launch Auditor, controller-only merge, or globally
draft-only/manual-send AI are historical unless restated inside the active
slice. The superseding rule is:

- one fresh independent read-only exact-head review is required;
- exact-head GitHub CI must be green;
- before merge, refresh `origin/main` and the PR base and confirm the reviewed
  head SHA and reviewed base/main still match the evidence;
- the executor may merge only that exact reviewed head directly;
- exact-main push CI must then be re-verified before the next block starts.

## Historical goal slice before #376

> Superseded by #376, ADR 0020 and U0-U14. This section is retained only to
> explain prior repository evidence and does not authorize P8 or runtime work.

The active planning slice at that historical checkpoint was P8 controlled
release-candidate preparation under
`EVO-P8-CONTROLLED-RELEASE-CANDIDATE-2026-08-14`. P6A-P6D, P7A and
P7B are merged, PR #163 merged the P7C authority contract and managed project
consolidation, PR #164 merged its deferral, and exact-main run `31820931774` is
green. The owner has deferred P7C database plus separate
private Storage recovery execution and the large P7D capacity stress test; those
deferrals do not count as recovery or capacity acceptance. The P7D contract is
merged; P8 now prepares the exact candidate. Accessibility closure still
requires exact-candidate automated evidence and the approved human review
before a release decision.
Each block still requires its own
fresh exact-head review, exact-head CI, exact-base recheck, reviewed merge and
green exact-main push CI. No P7 block inherits managed, provider or production
proof.

### Historical goal

Build the unified EVO Platform in ordered, independently reviewed blocks while
preserving the accepted frontend contract and current production safety.
amoCRM remains canonical for contact, lead, responsible sales manager and
sales stage. One greenfield Supabase-native backend becomes the platform-owned
operational store, with physically isolated dev/staging/preview environments.
The existing unified frontend from PRs #64/#71/#72 is the sole product UI
contract and must be wired through repository/session seams, not replaced or
paralleled. The MVP priority is the real operator workspace: available WAHA
history and private media, ACK and true realtime, then bounded canonical
amoCRM reads, Platform-owned lead memory/pgvector retrieval and real Gemini
qualification/replies.

Gemini may only return a structured RU/EN proposal. Deterministic server policy
may auto-send it solely as a reply inside the WhatsApp 24-hour service window
when every consent, opt-out, language, evidence, risk/confidence,
business-hours, cooldown/rate, staff-takeover, session-health, idempotency and
policy-version gate passes, explicit runtime enablement is present, and the
emergency stop/kill switch is not engaged. Cold outbound, broadcasts, autonomous follow-ups,
re-engagement, out-of-window free-form sends and direct model-to-WAHA access are
prohibited. Every other result becomes a durable human-review handoff.

This amendment preserves P4B activation/write work, recognizes merged bounded
read-only P4R1, and keeps P9 removed. The deployed Lead Agent remains frozen
only as a current-state rollback/cutover input; its useful orchestration belongs
inside the one Platform product and the separate contour is not retained as
target architecture. No mock, SQLite shim, hardcoded mapping, fake provider or
silent fallback may substitute for canonical amoCRM or provider evidence.

### Reconciled baseline

The first bullets below retain the P0 snapshot. The current sequential
checkpoint is:

- P0 plan/TZ/architecture merged in PR #75.
- P1A no-Visa-role migration merged in PR #76.
- P1B Admin-only Curator assignment/lifecycle merged in PR #77.
- P1C current-app object scope merged in PR #78.
- P1D current-root WhatsApp object-scope containment merged in PR #80.
- P2 Supabase-foundation decomposition merged in PR #81.
- P2A canonical migration authority merged in PR #82.
- P2B-P2H merged sequentially on `main`; this amendment recognizes them as
  reusable greenfield foundation rather than the active product slice.
- PR #93 merged the greenfield/UI boundary; PR #94 merged BW0; PRs #95-#97
  merged P3A-P3C; PRs #100-#103 merged BW1-BW4; PR #104 merged P2R0; PR #105
  merged P2R1; PR #107 merged the BW5 checkpoint amendment; PR #109 merged the
  P2R2 plan gate; PR #111 merged the P2R3 plan gate; PR #112 merged the P2R3
  repair; PR #113 merged BW5; PR #114 merged BW6; PR #116 merged BW7; PR #117
  merged P4A; and PR #118 merged the P4B plan at
  `10e5d85147ed6b87bfbd0281fc6ccce5464e8d3b`.
- PR #119 is immutable merged history but PR #128 supersedes it as current
  product authority. PRs #120, #122 and #124 were removed by reviewed revert
  PRs #127, #126 and #125. PRs #129-#130 then merged the bounded local-validation
  plan and repair. PR #132 merged the disabled-by-default P5A WAHA ingress,
  PR #133 merged the disabled-by-default P5B projection, PR #137 merged the
  P5C available-history reconciliation lane, PR #138 merged the P5D private
  WAHA media archive/display lane, PR #141 merged P5E ACK/session plus private
  Realtime, PR #142 merged bounded P4R1 read-only canonical amoCRM context,
  PRs #144-#146 merged P5F1-P5F3, PR #147 merged the P6A-P6D contract,
  and PRs #148/#149/#152/#153 completed P6A-P6D. PR #154 merged the P7
  contract, PR #156 completed P7A, PR #157 refreshed the accepted status and
  OrbStack-only rule, PR #160 completed P7B, and PR #163 merged the P7C
  authority contract plus managed project consolidation. Current `origin/main`
  is `8d16a551111add9d5e299db66bb519812473a89a`. Exact-main push CI
  `31810033100` is green, and migrations end at `072`.
- P4B implementation is preserved on remote branch
  `izzhackt/evo-platform-p4b-mapping-approval` at
  `e53ba94954f147b295f596421a255591fa343ce8`, with no implementation PR.
  Focused checks passed; the later full local Supabase gate failed closed in
  the real Auth/PostgREST hook before Playwright. Cleanup verification found no
  exact Platform resources/process/lock. This is failed/non-evidence, not P4B
  acceptance or provider proof.
- PR #108 exact head `f719b749efaadaf02c6344c5d01cd4b6bbe3d79c`
  is historical recovery evidence: it passed focused tests and CI but was
  closed without merge after controller
  comment `5166574008`: no prior plan authorization and no independently
  reproducible real local reset exit zero.
- PR #110 exact head `fd4428451793bdc59b3b183dcc9dde7518e80201`
  passed executor proof, exact-head CI and independent review but was closed
  without merge after controller comment `5171649961`: connected-route stale
  authority did not clear the resident Supabase browser cookie, and the
  controller's OrbStack endpoint did not permit the second physical-worktree
  local proof.
- Root `/whatsapp` remains a SQLite `wa_*` shadow surface with P1D
  authorization containment. It is not the unified communications backend;
  the greenfield application seam was established through P3C, while real
  provider completion remains P5.

- At the P0 snapshot, GitHub `main` and the clean P0 worktree resolved to
  `a16cd3fb`; the exact `EVO platform CI` run for that SHA was green and there
  were no open PRs.
- Production Inbox runs revision `a09a72fc`, release `2026-07-24.2`.
  Production CRM and Lead Agent run revision `564332b4`, release
  `2026-07-24.1`.
- The root app still uses SQLite/custom auth and local `wa_*` shadow tables;
  EVO Inbox still uses a separate Supabase model.
- The retained Lead Agent is frozen with worker, outbound, and automatic reply
  paths disabled; amoCRM readiness remains false.
- Read-only WAHA session queries returned `401` without a key, so current
  session state was not re-proved and no secret was read.
- No real WhatsApp/amoCRM end-to-end proof exists. Missing gates include exact
  amoCRM mappings/credentials, a dedicated sanitized test lead and number, QR
  owner, controlled-send authorization, release window, reconciliation window
  and rollback evidence.

### Immediate execution order

0. PRs #148, #149, #152 and #153 completed P6A-P6D, PR #154 merged the P7
   contract, PR #156 completed P7A, PR #157 refreshed accepted status plus the
   OrbStack-only rule, PR #160 completed P7B, and PR #163 merged the P7C
   authority contract plus managed project consolidation. Current main is
   `a8474eb57f94f952711e953be21b5e6041d2f36e`, migrations end at `072`,
   and exact-main push run `31820931774` is green. Preserve this accepted
   repository/local evidence and its non-production truth boundary.
1. Preserve P4B at
   `izzhackt/evo-platform-p4b-mapping-approval` / `e53ba94954f147b295f596421a255591fa343ce8`.
   Keep mapping activation and writes deferred. Merged P4R1 remains bounded
   read-only context without provider proof or mutation authority.
2. Defer the P7C encrypted database plus separate Storage recovery drill until
   the Platform is functionally complete and concretely operating. Keep
   automatic database backups enabled, do not create a billed recovery project,
   and leave the current `inbox-prod` runtime stable until the separately
   authorized unified cutover; do not add features or a second data authority
   there.
3. Preserve the merged focused P7D contract. Defer the large load test and
   temporary managed load environment without calling capacity passed. Prepare
   the real P8 candidate, then run the existing automated accessibility gate and the
   owner-led Mac/iPhone/Android human matrix on that exact candidate.
4. Do not infer canonical sales identity, responsible Sales, stage, Portal
   activation or contract handoff, and do not convert missing managed/provider
   evidence into a passed P7 claim.
5. P8 may prepare the real candidate after the P7D contract merges. A release
   decision remains blocked until focused accessibility and external-evidence
   accounting complete. Prove only executable P5-P7 plus P4R read paths. Report
   P4B activation/writes and unavailable provider segments as deferred, never
   passed or synthetically replaced.
6. Skip P9. Keep Lead Agent and the legacy webhook/session path deployed/frozen
   only until the unified replacement is proven and a separate retirement
   operation is authorized. Do not extend either contour or introduce a
   compatibility bridge. Run P10 directly after P8 as an authorized-scope audit
   that lists P4B activation/writes deferred and does not claim full Platform
   completion.

### P7 authority and sequence

The implementation authority for P7 is append-only Block
`EVO-P7-SECURITY-RELIABILITY-PLAN-2026-08-13` in `docs/PLAN_CHANGES.md` and the
P7 section of `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`, expanded by
`docs/platform/p7-security-reliability.md` and the primary-source note
`docs/research/p7-official-evidence-2026-08-13.md`. P7A removes direct browser
audit-table access and connects the accepted Platform Settings surface to a
safe, bounded, replay-aware Supabase audit projection/export. P7B keeps
readiness, metrics, internal routes and Lead Agent operational surfaces private.
P7C follows `docs/platform/p7c-managed-recovery-contract.md` when the owner
resumes it: it will use the real managed source, a newly owned empty managed
destination, and separate encrypted database and Storage evidence. It excludes
the current companion-era `inbox-prod` runtime because that runtime is not the
P7 recovery target; this physical exclusion does not make it a separate target
product or data authority. P7D now follows the focused
accessibility contract: high-load capacity stays deferred/unproved, while the
exact release candidate must pass the retained automated gate and approved
human review before release.

No P7 block authorizes public metrics, provider calls, customer-data exposure,
live sends, amoCRM writes, retention deletion or deployment. Only the exact
managed Supabase transfer and rename already completed under the P7C contract
supersede the earlier blanket provider/service prohibition. The deferred
recovery drill, production migration and destructive restore require fresh
action-time authority. P8 remains blocked until P7D completes and unavailable
evidence is recorded. P8 preparation may begin after the focused P7D contract
merges, but the release decision remains blocked until its accessibility proof
is complete.

### P5B authority and rollback contract

PR #133 merged as `18e0e0855fda31cba1fa837d81b3a75cedd585e9`
after its corrected exact head passed independent review, exact-head CI and the
full local Supabase/browser gate. Its accepted scope remains only a
disabled-by-default, amoCRM-independent projection worker behind the accepted
`/whatsapp` UI:

- private bodyless `POST /api/internal/platform-messaging/waha/work`, called by
  a private scheduler with UUID request ID, Unix-millisecond timestamp,
  `sha256` algorithm header and lowercase HMAC-SHA256 of
  `<request-id>.<timestamp>`;
- configured organization, exact `evo-inbox` session and `waha:evo-inbox`
  account only; verified inbound `provider_webhook_process` work only;
- service-only organization/session/provenance-bound claim, project and finish
  RPCs with a lease, bounded retry/manual-review disposition and no finish on
  invalid repository output;
- `sales_authority_source='platform_intake'` means only a Platform intake queue,
  never canonical amoCRM Sales ownership;
- raw WAHA chat/message identifiers stay in private append-only bindings and
  never appear as phone-bearing identifiers in public rows;
- valid media-only inbound remains pending/actionable and operator-visible; it
  is never terminally consumed solely because text is absent;
- no provider call, send, amoCRM write, production migration or legacy
  cutover. Rollback keeps feature flags off, reverts code and forward-fixes the
  additive schema; no destructive down migration. Lead Agent and the legacy
  path remain available.

P5B does not authorize AI or provider claims. History/media reconciliation,
ACK projection and Supabase Realtime are later independently reviewed P5
blocks and precede the autonomous-reply lane.

### P5C authority and rollback contract

Block `EVO-P5C-WAHA-HISTORY-2026-08-10` adds only a disabled-by-default,
server-side reconciliation lane for history that the existing WAHA store can
actually return for the exact `evo-inbox` session:

- the private trigger is HMAC-authenticated and requires an explicit feature
  flag, tenant, private WAHA origin, provider credential and service-only
  Supabase credential;
- provider access is read-only: session preflight plus paginated `GET` chat and
  message history with `downloadMedia=false`. It sends no message, sets no read
  marker and changes no WAHA session or webhook;
- NOWEB must explicitly report its store enabled; supported engines and
  `WORKING` session state fail closed before reconciliation;
- only direct chats enter this block. Inbound and historical outbound rows are
  projected behind the accepted `/whatsapp` UI, while raw WAHA chat/message
  identifiers remain private and browser-visible provider/amoCRM IDs stay null;
- cursor movement, page effects, replay evidence and lifecycle state are
  service-only, organization/session-bound and atomic. A provider/repository
  failure leaves the last committed cursor resumable;
- media-only history becomes an operator-visible marker. P5C does not download,
  archive or display media bytes; private media is the next P5 block;
- the configured Sales membership is an intake authorization only. P5C creates
  no canonical amoCRM identity, Sales owner, stage or handoff claim;
- synthetic local adapter/browser evidence proves the Platform path only.
  Real WAHA history completeness and provider behavior remain blocked until a
  separately authorized controlled provider run.

Rollback keeps P5C disabled, reverts the route/worker code and forward-fixes
the additive migration. It performs no destructive down migration, provider
mutation, production migration or legacy-path retirement.

### P5D private WAHA media authority and rollback contract

Block `EVO-P5D-PRIVATE-WAHA-MEDIA-2026-08-10` adds only the private-media
archive and authorized display path behind the accepted root `/whatsapp` UI.
It is deliberately separate from ACK/session projection and Supabase Realtime,
which remain the next independently reviewed P5 block:

- the Platform may archive media only for an already projected P5B/P5C
  communication message whose raw WAHA identity and source evidence remain in
  the reviewed private bindings;
- the server re-fetches one exact message with `downloadMedia=true`, validates
  the exact `evo-inbox` session, direct chat, message identity and configured
  private WAHA origin, rejects redirects and enforces bounded timeout/size;
- WAHA URLs and API keys never reach the browser. Object names are opaque,
  contain no phone, chat, contact, student or provider locator, stay out of RPC
  rows/page content and may appear only inside a short-lived audited Storage
  download URL;
- bytes are written through the Supabase Storage API to the fixed private
  `platform-whatsapp-media` bucket. Application SQL never inserts or updates
  Storage catalog rows directly;
- missing provider media, unsupported or unsafe inline content, oversize
  objects, Storage failure and binding conflict remain explicit archive states
  or staff handoff. They never become silent success or fabricated media;
- media-only messages stay operator-visible and remain in human-review state.
  P5D performs no media understanding, Gemini call or autonomous reply;
- no WAHA send/read marker, ACK/session mutation, amoCRM write, production
  migration, legacy-path change or service deletion is authorized.

Rollback keeps the archive worker disabled, reverts server/UI code and
forward-fixes additive schema. It does not delete archived objects or apply a
destructive down migration. Real-provider completeness and production
retention/restore remain blocked until separately authorized evidence exists.

### P5E WAHA ACK/session projection and private Realtime authority and rollback contract

Block `EVO-P5E-WAHA-ACK-SESSION-REALTIME-2026-08-10` keeps the accepted Claude
Design `/whatsapp` UI and adds only the next bounded P5 truth path after P5D:
durable ACK/session projection plus private Realtime invalidation. It consumes
only already verified P5A signed WAHA work and exposes only safe delivery and
session-health state through the existing server truth path:

- the disabled-by-default server worker may project exact `message`,
  `message.any`, `message.ack` and `session.status` observations for one
  organization-bound, session-bound lane. Existing P5B message projection
  semantics remain unchanged;
- ACK projection requires the exact documented integer/name pairs
  `ERROR/-1`, `PENDING/0`, `SERVER/1`, `DEVICE/2`, `READ/3` and `PLAYED/4`,
  plus exact private message binding and observation time. Missing bindings,
  cross-tenant/session mismatches, malformed pairs, inbound targets or stale
  regressions fail closed;
- current session health is bounded to the exact `evo-inbox` session and is
  observe-only. The Platform may not start, restart, log out, pair, mark read
  or reconfigure WAHA in this block;
- record-free private Database Broadcast invalidations may be emitted only on
  `platform-messaging:<organization UUID>`. Browser subscribers are
  receive-only and authenticated; no browser send/insert permission exists;
- Broadcast data is an invalidation hint only. The browser must refetch
  authoritative RLS-scoped state after subscribe, reconnect, visibility restore
  and accepted invalidation through bounded `router.refresh()`. Payload fields
  never merge directly into UI state;
- the accepted UI may show safe ACK name/time and safe session health, but raw
  WAHA chat/message/contact identifiers and raw provider payloads remain
  private. Unknown session values render unhealthy/unknown, never healthy;
- this block does not authorize provider send/read markers, amoCRM writes,
  production mutation, legacy-path retirement or any change to the autonomous
  send gate. The later AI/send lane still follows the ADR 0019 deterministic
  reply-only policy.

Validation requires focused ACK/session parser and replay-denial tests,
disposable PostgreSQL RLS/grant/topic checks, no raw-ID exposure proof,
private receive-only Realtime authorization, accepted browser update without
reload plus reconnect catch-up proof, and the full local Supabase/Auth/Storage/
PGMQ/browser gate under the repo singleton protocol. Synthetic local WAHA and
Broadcast evidence prove only the adapter, authorization and UI integration;
real-provider proof remains blocked.

Rollback keeps P5E disabled, reverts worker/UI code and forward-fixes additive
schema. It does not apply destructive down migration, mutate WAHA session
state, delete historical evidence or retire the frozen Lead Agent / legacy
rollback path.

### P4R1 bounded live canonical amoCRM read authority and rollback contract

Block `EVO-P4R1-AMOCRM-CANONICAL-CONTEXT-2026-08-10` adds the smallest
read-only amoCRM context behind the accepted `/whatsapp/[id]` thread. It does
not resume the deferred P4B approval/activation implementation.

- The server may read only the exact amoCRM account, contact, lead,
  responsible-user, pipeline and status identified by provider IDs already
  attached to the authorized Platform conversation. It may not search by name
  or phone, infer a link, select a mapping, or create an identity.
- The adapter is disabled by default and accepts only a validated HTTPS
  `<subdomain>.amocrm.ru` or `<subdomain>.kommo.com` origin plus a server-only
  read credential. The credential never reaches browser code, URLs, logs,
  errors or committed configuration.
- The provider account ID must equal the conversation account ID. Contact and
  lead responses must cross-reference each other, the lead's pipeline/status
  must resolve inside the exact provider pipeline, and a returned user must
  equal the lead's responsible-user ID. Any mismatch fails closed.
- The accepted UI may show only sanitized contact, lead, responsible-manager,
  pipeline/stage names, active status and the observation time. Missing IDs,
  configuration, scope, provider availability or administrator-only user
  access produces an explicit disabled, blocked, degraded or stale state.
- Supabase records an append-only refresh observation for each completed live
  attempt and a bounded current read projection for the authorized UI. A
  failed refresh preserves the last successful value only with an explicit
  `stale` state and original observation time. Browser actors receive it only
  through the existing live-authority and conversation-scope checks.
- The projection records the provider account/entity relationships actually
  verified, the exact adapter-contract version, observed endpoint
  capabilities, refresh outcome and time. It is not P4B mapping approval,
  custom-field semantic mapping, provider proof, AI authority or a handoff
  signal.
- No legacy SQLite settings or existing mutable amoCRM adapter may supply this
  Platform path. This block adds no approved mapping pointer, P4B event,
  task/call/chat read, webhook/poll reconciler or autonomous-send input.
- Official GET-only CRM endpoints are the account, contact-by-ID,
  lead-by-ID, pipeline-by-ID and user-by-ID APIs. The user lookup is allowed to
  degrade independently because the official Users API is administrator-only.
  Kommo Chats API is not required when the exact CRM entity IDs already exist.

Validation requires focused config/parser/client/repository and fail-closed
tests, append-only/idempotency/RLS/tenant/conversation-scope SQL tests,
secret-containment/client-boundary checks, accepted-thread integration checks,
root lint/type/build/unit/security gates, exact-head CI and one fresh
independent exact-head review. Synthetic fetch responses are adapter tests, not
real-provider proof. A live sanitized amoCRM read remains `blocked` until a
valid read credential and dedicated test entities are separately supplied and
authorized.

Rollback leaves the feature disabled or reverts server/UI code and forward-
fixes the additive schema; no destructive database down migration is allowed.
P4B remains preserved/deferred and Lead Agent plus the legacy rollback path
remain frozen and available.

### P5F authority and sequence

Block `EVO-P5F-AI-MEMORY-REPLY-LANE-2026-08-10` was the accepted docs-only
authority gate after merged P4R1. It preserves the accepted Claude Design
frontend as the sole UI contract, keeps P4B activation/writes deferred, keeps
P9 removed, and retains Lead Agent plus the legacy rollback path as
deployed/frozen current-state safety contours. The later 2026-08-22 all-in-one
authority supersedes their target retention: useful orchestration moves inside
the unified product and the separate contour is retired only after proof. Its
P5F1-P5F3 implementation slices are merged, and P6A-P6D are now complete.
P7-PLAN, P7A and P7B are also complete. The active plan group is P7C, gated
P7D, narrowed P8 and P10.

P5F SHALL be implemented in three independently reviewed slices:

- `P5F1` — Platform-owned durable conversation-scoped memory, approved-
  knowledge chunks, retrieval audit, RLS and pgvector foundation.
- `P5F2` — stateless Gemini structured qualification/reply proposal adapter.
- `P5F3` — deterministic policy-owned autonomous reply intent and worker.

Every P5F implementation slice SHALL remain disabled by default, SHALL carry no
real-provider success claim without sanctioned credentials and runtime proof,
and SHALL fail closed to durable human review whenever any required runtime
input, policy gate or provider response is missing, invalid or ambiguous.

### P5F1 authority and rollback contract

`P5F1` SHALL add only the Platform-owned memory and retrieval foundation.

- Supabase SHALL own durable conversation-scoped memory, explicit facts,
  qualification state, takeover/pause state, approved-knowledge chunk
  references and retrieval audit. Neither per-client filesystem agents nor
  Gemini server-side state/cache may be a source of truth.
- Migration `065` SHALL establish only additive schema for staff-controlled
  memory, approved-knowledge chunks, retrieval audit, RLS and pgvector. It
  SHALL NOT add Gemini execution, WAHA send, amoCRM writes or production
  enablement.
- The embedding target SHALL be `gemini-embedding-2` at a fixed `1536`
  dimensions. Provider-backed ingestion remains disabled by default and real
  provider proof remains blocked until sanctioned credentials and test data
  exist.
- Any lexical-only retrieval preview SHALL be explicit degraded staff preview
  only. It SHALL NOT authorize deterministic autonomous replies, SHALL NOT be
  presented as equivalent to approved retrieval, and SHALL fail closed for
  autonomous policy evaluation.
- No public RPC or UI may expose raw WAHA identifiers, phone-bearing provider
  identifiers, raw amoCRM entity identifiers, private retrieval internals or
  provider secrets.

Validation SHALL require focused schema/RLS/retrieval tests, build/lint/
typecheck, exact-head CI and one fresh independent exact-head read-only review.
Rollback SHALL keep runtime flags off, revert code, and forward-fix additive
schema only.

### P5F2 authority and rollback contract

`P5F2` SHALL add only the Gemini proposal adapter.

- Gemini SHALL be called through stateless Interactions with storage disabled
  (`store=false`). Official provider retention is finite and SHALL NOT replace
  Platform-owned durable memory or audit.
- The model SHALL be runtime-configured through an allowlist. The P5F-specific
  initial sanctioned model is the owner-named `gemini-3.5-flash`. Google's
  current catalog also lists `gemini-3.6-flash` as stable, but the older generic
  target note does not authorize it for P5F without a separate eval and plan
  update. Any later model change requires a decision-log update and fresh
  validation.
- The adapter SHALL use bounded conversation context, bounded retrieval
  evidence, bounded read-only amoCRM context and explicit token budgets. It
  SHALL return JSON-schema-constrained structured RU/EN proposals only.
- Gemini SHALL NOT call WAHA, SHALL NOT own transport retries, SHALL NOT imply
  send success, and SHALL NOT write amoCRM.
- Missing credentials, invalid provider configuration, malformed structured
  output, unsupported language, low confidence, missing evidence or unsafe
  semantics SHALL fail closed to durable human review.

Validation SHALL require focused adapter/contract tests, structured-output
validation, build/lint/typecheck, exact-head CI and one fresh independent
exact-head read-only review. Real provider execution remains honestly blocked
until sanctioned credentials exist. Rollback SHALL keep the adapter disabled
and forward-fix additive audit schema only.

### P5F3 authority and rollback contract

`P5F3` SHALL add only deterministic autonomous reply gating and durable send
intents.

- Deterministic Platform policy SHALL be the only authority that can create a
  WAHA `reply_to` send intent. Gemini SHALL remain proposal-only.
- An autonomous reply SHALL be permitted only for the same conversation and the
  exact inbound trigger, inside the rolling WhatsApp `<=24h` service window,
  with fresh consent/opt-out, approved citations/evidence, known language,
  confidence/risk pass, business-hours pass, cooldown/rate pass, staff
  takeover/pause clear, session-health pass, unused idempotency key, matching
  policy version, explicit autonomous-reply runtime enablement and an emergency
  stop/kill switch that is not engaged.
- The worker SHALL re-check every mutable gate immediately before transport.
  Media-only, unsupported or ambiguous inputs SHALL fail closed to human
  review.
- No cold outbound, campaign/broadcast, autonomous follow-up/re-engagement,
  out-of-window free-form send, direct model send or silent fallback is
  authorized.
- The owner authorized autonomous-reply code only. Production enablement, live
  customer sends, provider credentials and real provider proof remain separate
  blocked events that require explicit later authority.

Validation SHALL require focused policy/queue/worker/idempotency tests,
exact-head CI and one fresh independent exact-head read-only review. Synthetic
local adapter proof does not count as real provider proof. Rollback SHALL keep
autonomous runtime flags off, hold or drain queued intents safely, and
forward-fix additive schema without destructive down migration.

### P6 authority and sequence

Block `EVO-P6-OPERATIONS-PORTAL-PLAN-2026-08-11` decomposes P6 into four
sequential gates. The exact contract is
`docs/platform/p6-operations-portal.md`.

- `P6A` makes existing Platform-owned overdue/attention state explicit in the
  accepted Portal without any notification side effect or read-time write.
- `P6B` wires durable self-only notifications and persisted read state into the
  accepted Student Portal, starts with reviewed negative document outcomes and
  uses private Realtime invalidation rather than polling or public payload.
- `P6C` adds disabled-by-default, idempotent overdue-transition publication
  from explicit Platform task/payment due data. Reading a page never writes a
  notification and no deadline may be inferred from amoCRM.
- `P6D` proves the final two-Student and cross-organization path across
  applications, visa, reasoned close/reopen, private documents, manual finance,
  overdue Portal action and notification/read state.

Migration 043 remains immutable. Its consent-gated individual-WhatsApp intent
is durable state only; P6 does not claim, route or dispatch it. P6 also does not
copy the legacy SQLite staff notification feed or infer sales identity, stage,
responsible Sales, Portal activation or canonical handoff. P6 is complete only
after P6D passes. Individual WhatsApp notification delivery remains a separate
future target; this P6 plan neither cancels nor activates it.

P6A-P6D merged in PRs #148, #149, #152 and #153. Exact-main push run
`31650640795` is green at
`1e53d93d8c70c286e56c5d057928e9f080c58a44`; this completes the repository
and synthetic/local P6 gate without creating managed, provider or production
proof.

### Merged P2R3 acceptance record

- The server verifies the exact access token returned by successful Supabase
  login with `getClaims(accessToken)` before resolving the live database
  authority bundle. Missing/invalid claims, blocked membership or RPC failure
  fail closed and clear the Platform session.
- Protected connected routes hand invalid authority to the exact same-origin
  `src/app/auth/platform-session/route.ts`. That response-writable handler
  independently rechecks claims plus live authority, preserves a recovered
  valid actor, and otherwise expires only the Platform Supabase auth-token
  cookie/chunks before redirecting to a bounded login error. Query parameters
  are not authorization proof; legacy root-auth cookies remain untouched.
- Real local Playwright starts with an authenticated Platform session, makes
  the live authority revoked or version-stale, exercises the connected route,
  and proves the browser no longer holds the Platform auth cookie. A direct
  handler request with valid authority must preserve the session.
- `getSession()` is never a server authorization source; self-registration,
  legacy-account import and root-auth fallback stay disabled.
- The deadline runner executes its child and propagates the true exit code from
  both logical symlink and physical worktree paths.
- The normal real `npm run test:supabase:local` path exits zero after migrations
  001-055 and proves Auth/PostgREST/RLS/browser/Storage/PGMQ behavior. Retries
  remain bounded and transient-only; diagnostic output is redacted.
- Cleanup proves no exact-project lock, container, volume or network remains and
  preserves unrelated Inbox resources. Broad prune and daemon restart are
  forbidden.
- P2R3 owns only the original P2R2 auth/reset files plus
  `src/lib/platform-guards.ts`, `src/proxy.ts`,
  `src/lib/supabase/auth-cookies.ts`,
  `src/app/auth/platform-session/route.ts` and
  `tests/platform-auth/platform-auth.spec.ts`. It owns no migration, provider,
  production, restore or cutover behavior.
  Executor and independent physical-worktree evidence, exact-head CI and a new
  SHA-bound review are all required before controller merge.

### Business-workflow scope

- OP active stages: new, contacting, qualified, meeting scheduled, meeting
  completed, potential and contract signed. No-answer/no-show are follow-up
  outcomes; event/collaboration values are source/deal metadata; closure
  requires an explicit result and reason. amoCRM mappings remain
  account-specific and canonical.
- OZO uses one common admissions lifecycle with independent application,
  document, visa, finance, housing, insurance and travel statuses. China,
  Italy, Czech/Poland, UAE/Turkey and Malaysia are versioned overlays, not
  separate applications.
- Student Profile uses a minimized country-neutral core plus versioned
  country-specific requirements. Sensitive documents use the private document
  path only.
- Requirements/checklists, prompt/knowledge, Q&A decisions, catalogs/imports,
  document templates and generated contracts are versioned, source-aware and
  approval-gated. Generated contracts remain drafts until authorized staff
  approval.
- University import is blocked while the linked Notion workspace is
  inaccessible. Colleges and Accounting/Bema remain discovery gaps rather than
  invented modules.
- AI produces RU/EN structured proposals from approved knowledge and Platform
  memory. Deterministic server policy may auto-send only a qualified inbound
  reply inside the 24-hour window; Kyrgyz, uncertain language, sensitive/media
  input or any failed guardrail requires durable human review.
- Linked Google Docs/Sheets/Drive/PDF/Notion inputs are discovery/import
  sources, never the runtime database or a public dependency. No customer PII,
  folder names or documents may enter Git, fixtures or logs.

### Business-workflow acceptance

- BW1 proves versioned source/provenance and normalized domain contracts
  without PII.
- BW2 proves OP/OZO actions through real repositories, RLS, permissions and
  audit behind the existing frontend, with no localStorage or demo fallback.
- BW3 proves Student Profile and country checklists across staff and portal,
  including cross-student denial and historical overlay-version retention.
- BW4 proves approved prompt/knowledge, Platform memory, structured proposal,
  deterministic send/handoff lifecycle, RU/EN and the manual-language failure
  path.
- BW5 performs no real catalog import until authorized source access exists;
  staging/validation/rejection must not auto-publish.
- BW6 proves typed approved-field contract generation, draft/approval
  separation, immutable versions and audit.
- BW7 proves the complete local/staging Supabase workflow through the accepted
  frontend. It does not imply production/provider readiness without real
  authorized service exercise.

### Merge-order boundary

BW0, P3A-P3C, BW1-BW7, P2R0-P2R4, P4A, PR #128 and P5A are merged history.
This amendment is the only active docs-only block. P4B activation/writes are
preserved/deferred; P4R owns bounded canonical reads, P5 owns real WAHA/
history/media/realtime/AI/ACK proof, and P6-P7 own independent operational/
security scope. No lane may replace amoCRM with a mock, SQLite shim, hardcoded
mapping, fake provider or silent fallback. P10 follows P8; P9 is removed from
the authorized scope and Lead Agent remains deployed/frozen.
Shared migrations are selected only after fetching current main and checking
open ownership; merged migrations are immutable.
- `crm.evoadmissions.com` and `inbox.evoadmissions.com` have no DNS answer.
  The fallback CRM URL responds.
- The original checkout's modified Malaysia knowledge-base document and
  untracked presentation archive are owner work outside this goal.

### Ordered platform blocks

P0–P10, their exact exit evidence, validation commands, protected operations,
remaining owner decisions and the independent-review/merge-controller protocol
are defined in `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`.

- P0: plan/TZ/DOCX/ADR and target architecture, docs-only.
- P1: current-app role/RBAC/handoff correction. P1A-P1D are merged.
- P2: unified Supabase foundation. P2A is merged; P2B–P2H are reusable
  foundation and former P2I restore duties move to a later reliability lane.
- P2R0/P2R1: merged docs-only reliability gate and bounded local Supabase
  proof-path/document lock-order repair in PRs #104/#105.
- P3: thin messaging slice behind the existing unified frontend; P3A-P3C are
  merged with local-only, no-provider evidence.
- P4/P4R: preserve P4B activation/write checkpoint; resume bounded canonical
  reads after the messaging foundation.
- P5: unified Inbox/WAHA/Lead Agent messaging capability with history/media,
  ACK, true realtime, Platform memory and gated inbound-reply autonomy.
- P6: amoCRM-independent Admissions/Portal/Documents/Finance/Notifications.
- P7: security, reliability and operations.
- P8: narrowed real executable P5-P7 plus proved P4R read evidence; P4B
  activation/writes and unavailable provider segments remain deferred, and no
  production action is authorized.
- P9: removed from current execution scope; no soak or Lead Agent retirement.
- P10: authorized-scope evidence audit, with P4R read evidence, P4B activation/
  writes deferred and Lead Agent retained; not a full-Platform completion claim.

Only one implementation PR may be open. The owner removed the scheduled Launch
Auditor and separate merge-controller. After a separate independent read-only
reviewer approves the exact head and every required exact-head CI job passes,
the executor may directly merge that same SHA with a head-matching merge
command. Green exact-main push CI is required before the next implementation
PR. No production deployment, migration, DNS, WAHA session mutation, live
customer send, real amoCRM mutation or service deletion is authorized by this
plan.

### Completed P1D contract: current-root WhatsApp object scope

P1D applies only to the root CRM's current SQLite/custom-auth `/whatsapp`
surface. It is authorization containment before P2-P5, not a substitute for the
unified Supabase/Inbox/WAHA target.

The merged implementation:

- scope list/detail/message reads in SQL to Admin, responsible Sales before
  handoff, assigned Curator after handoff, and a safe summary-only projection
  for the former responsible Sales user;
- deny Finance, Student, unrelated staff, broken links and unlinked rows for
  every non-Admin actor;
- grant lead-only Sales access only when both the conversation and the resolved
  lead have no case link; indirect lead-to-case and conflicting case links are
  Admin-only until reconciliation;
- keep post-handoff Sales away from transcript, phone/message previews,
  provider/amoCRM/WAHA identifiers, draft/reason metadata and send/read/draft
  actions;
- enforce the same object policy in direct routes, lead-page lookups, replayed
  Server Actions and `/api/ai/draft` before protected reads, mutation, AI or
  WhatsApp provider access;
- suppress WhatsApp-derived unread/count/recency/response aggregates at the
  shared query boundary for Sales, dashboard, calls and tasks whenever the
  actor lacks full conversation access;
- make manual conversation creation Admin-only until P4/P5 can prove canonical
  ownership during resolution/linking;
- preserve the accepted frontend structure while hiding inbox and shared
  TopBar controls that cannot succeed for the current actor.

P1D has no database migration and no real-provider proof requirement. It must
not change the WAHA session/webhook, Lead Agent, EVO Inbox Supabase model,
message transport, ACK/outbox/retry/reconciliation behavior, provider
configuration or production state. Full details and the actor matrix are in
`docs/platform/p1d-root-whatsapp-scope.md`.

### P2 plan amendment: canonical Supabase foundation

ADR 0014 remains the unified target decision. ADR 0015 refines its Supabase
implementation boundary:

- root `supabase/` becomes the sole migration authority in P2A;
- legacy migrations 001–039 move byte-for-byte with a checksum manifest and no
  migration 040 in P2A;
- `public` remains the legacy Inbox compatibility schema;
- `platform` is the new exposed schema with explicit grants and RLS on every
  table;
- `platform_private` is backend-only and absent from the Data API;
- browser roles have no `platform_private` or `pgmq_public` access;
- legacy Inbox `owner/admin/agent/viewer` roles never map implicitly to
  Platform `admin/sales/curator/finance/student`;
- target machine role `student` is displayed as Client/Student; the current
  root `client` identifier is not imported or mapped into Platform without a
  later explicit scoped decision;
- the legacy signup trigger may keep legacy Inbox behavior but grants no
  Platform membership.

P2 has the following strict dependency order:

1. P2A establishes the canonical root config/history/test harness without a
   new migration.
2. P2B begins at the next free migration number, expected 040, and establishes
   schemas/grants plus verified legacy secret-bearing-column containment while
   preserving current Inbox compatibility.
3. P2C adds Platform identity, RBAC and base audit.
4. P2D adds cases, assignments/handoff, applications, visa and tasks.
5. P2E adds document metadata, finance and durable notification state.
6. P2F adds communications/provider mappings, raw events, approved knowledge
   and draft-only AI records without a live-provider claim.
7. P2G proves retryable work through real local Supabase Queues/PGMQ, including
   idempotency, dead-letter and reconciliation.
8. P2H proves new private Platform buckets/policies through the real local
   Supabase Storage API.
9. P2R1 repaired only the already-merged local proof path and merged immutable
   migration `055_platform_document_finalization_lock_order.sql` in PR #105. It
   added no production apply, provider call, restore claim or product feature.
10. Former P2I whole-foundation reset/RLS/grant/secret and separate database/
    Storage restore duties are transferred to P7.

Merged migrations are immutable; defects use the next free forward migration.
P2 is additive and does not rename/drop legacy tables, cut root auth over,
copy real secrets, silently privatize legacy `avatars`/`flow-media`, or apply a
production migration. A handcrafted queue or Storage mock is not service
proof. Local service evidence does not prove remote migration-ledger parity,
managed branching, production configuration, paid-plan PITR or managed
restore; those remain blocked by region/plan, credentials and production
authority.

Detailed ownership, negative matrices, rollback and provider boundaries are in
`docs/platform/p2-supabase-foundation.md`.

P2R1 exits only when the real local `npm run test:supabase:local` path proves
admin-provisioned Auth/RLS, private Storage, PGMQ terminal semantics and exact
disposable-resource cleanup under Node 22.23.1. The document finalization lock
repair must be a next-free forward migration with concurrent finalization and
review regression evidence. Local proof is not managed Supabase, provider,
backup/restore or production proof.

### Historical pre-platform blocks

The following A–G record is retained as prior hardening history. It is not the
active merge order; P0–P10 above and the long-run plan now control new work.
Any retirement or full-target completion language below is historical and is
superseded for current execution by ADR 0018.

Every block starts from refreshed GitHub `main`, has one coherent PR, real
validation, and a separate launch-control reviewer verdict of `approved`.
Shared migrations, deployment files, and plan files merge sequentially.

1. **A — critical authorization containment**
   - Prevent profile, account, membership, ownership, or role self-promotion.
     System-owned identity, membership, role, account, and provider/audit fields
     may change only through authorized server paths.
   - Inventory exposed Supabase tables, views, RPCs, grants, RLS/storage
     policies, and `SECURITY DEFINER` functions. Deny cross-account writes and
     remove unnecessary authenticated/anonymous grants.
   - Add disposable PostgreSQL role-policy tests using JWT claims for ordinary
     staff, privileged staff, and `service_role`, including negative
     insert/update/delete/RPC and cross-account cases. Table-owner execution
     does not prove RLS because owners normally bypass it.

2. **B — main CRM sensitive surfaces**
   - Authenticate and admin-gate Transcription Lab plus upload, job, SSE,
     detail, and improvement endpoints, or disable the complete production
     surface when no approved operator role can be proven.
   - Enforce server-side upload type/size/count limits, bounded processing, safe
     names, failure cleanup, retention/deletion, and non-sensitive audit output.
     Edge limits supplement but do not replace application validation.
   - Require production-safe secret encryption and fail closed when secure
     encryption configuration is unavailable.
   - Add negative permission tests for finance, documents, client/portal data,
     AI routes, and transcription routes.
   - Public registration versus invite-only access is an owner decision. Stop
     before changing `/register`, account creation, or invite policy without it.

3. **C — privacy and media truthfulness**
   - Keep customer documents/media in private storage with account-scoped RLS
     and short-lived authorized access. Never expose public bucket URLs or
     service-role keys. Audit upload, access grant, deletion, and retention
     without customer content.
   - Verify real WAHA media receive/send support. Disable unsupported media UI
     instead of storing or displaying simulated capability.
   - Define retention/deletion for CRM files, Inbox media, transcripts, AI
     drafts, outbound attempts/messages, ACK evidence, and logs. Preserve
     #47/#48's append-only delivery evidence; do not recreate or weaken it.

4. **D — Lead Agent minimal containment**
   - Prove whether the production Lead Agent is still an active inbound webhook
     owner. Keep outbound and automatic replies disabled.
   - If active, add bounded replay rejection, atomic crash-claim
     lease/recovery, idempotent amoCRM side effects, deterministic
     phone/contact/lead selection, and non-sensitive liveness/readiness output.
   - If unused or blocked by credentials, freeze it disabled and document the
     exact blocker. Retirement requires a separate future owner decision.

5. **E — runtime and deployment hardening**
   - Build on PR #46 rather than repeating it. Verify third-party images by
     immutable digest and first-party images by Git revision/version labels.
   - Separate liveness from dependency/provider readiness. Validate private
     endpoints, Caddy routing, CSP/cache/security headers, application/edge
     request limits, resource limits, correlation IDs, actionable logs/alerts,
     and rollback evidence.
   - Use current official Docker, Caddy, Next.js, Supabase, WAHA, and amoCRM
     documentation. Validate real Compose/Caddy/runtime state without secrets or
     customer data. Canonical DNS remains an owner-controlled external action.

6. **F — backup and disaster recovery**
   - Inventory main CRM SQLite/files, managed Supabase database and Storage
     objects, retained Lead Agent SQLite/token state, encrypted settings, WAHA
     session/relink material, and release configuration.
   - Define owner-approved RPO/RTO per store. Supabase database backups do not
     include Storage objects, so their recovery procedures are separate.
   - Restore only into isolated disposable destinations, never production.
     Verify integrity, schema/version, application reads, protected-key
     decryption, and the documented WAHA relink procedure.

7. **G — final acceptance and completion audit**
   - Map every requirement to merged PRs, clean Git state, real test/runtime
     evidence, or an exact external blocker.
   - Prove role denials, restart persistence, duplicate/replay behavior,
     provider-outage handling, zero automatic customer reply, isolated restore,
     production image-to-Git mapping, and no open hardening PR.
   - Run a real WhatsApp/amoCRM path only with real credentials, an
     EVO-controlled sender/recipient, and explicit approval for the visible
     manual reply. Missing inputs are blockers; mocks do not satisfy this plan.

### Remaining internal closure lanes

These lanes close newly confirmed internal gaps before Block G can be
re-audited. Each lane starts from refreshed `main`, uses a coherent PR, passes
real validation, and receives a separate launch-control reviewer verdict.

1. **CI enforcement for PostgreSQL authorization**
   - Require the existing real-role harness
     `scripts/test-postgres-authorization.sh` through the
     repository-root `npm run test:security` gate in GitHub Actions.
   - Provision only safe ephemeral/disposable PostgreSQL for CI. Do not connect
     the harness to production or require committed/runtime secrets.
   - Prove the workflow actually executes ordinary-staff, privileged-staff, and
     `service_role` allow/deny cases, including forbidden writes, rather than
     accepting SQL text inspection as equivalent evidence.

2. **Non-disruptive CRM checkout and permission reconciliation**
   - Inventory `/opt/evo-crm` and preserve every dirty or untracked item in a
     recoverable, access-restricted archive before changing the operational
     checkout.
   - Reconcile `/opt/evo-crm` to the exact reviewed source corresponding to the
     currently deployed CRM/Lead Agent revision. Prove the resulting Git state
     and image-to-Git mapping without building, recreating, restarting, or
     otherwise changing running services.
   - Audit legacy environment/configuration file ownership and modes without
     printing values. Tighten permissions only when the target and runtime
     access requirements are proven and the change is non-disruptive; otherwise
     record the exact blocker.

3. **WAHA runtime-limit drift containment**
   - Record the live finding that WAHA has unset `Memory`, `NanoCpus`, and
     `PidsLimit` despite reviewed Compose limits.
   - Do not recreate, restart, relink, or mutate WAHA to apply those limits
     until a QR/relink and session-continuity procedure is ready and the owner
     explicitly approves the user-visible provider risk.
   - Until approval, treat the runtime drift as an explicit Block E/G blocker,
     preserve WAHA privacy, and make no claim that its Compose limits are active
     in the running container.

Owner/external gates remain unchanged: canonical DNS, public registration
policy, monitoring destination and responsible owner, retention schedule and
owner, CSP enforcement, RPO/RTO, provider acceptance inputs/approval, and the
deferred real Supabase database-plus-Storage backup and isolated restore
rehearsal. None may be inferred or marked complete from automated tests.

### Historical write boundaries and merge order

The ownership list below applied to the pre-platform A–G hardening program. It
does not authorize current P2 work; P2A–P2H, later reliability work and the
long-run contract control.

- Plan-only PR: `docs/EVO_LAUNCH_PLAN.md` and append-only
  `docs/PLAN_CHANGES.md`.
- A owns Inbox authorization migrations/helpers/policy tests and merges before
  any later Inbox schema work.
- B owns main CRM guards, transcription, secret handling, and sensitive-surface
  tests.
- C owns private media/storage policy, signed access, truthful media UI,
  retention/deletion, and audit events; it starts after A and B.
- D owns only `evo-lead-agent/**` plus directly required deployment/docs.
- E owns shared Dockerfiles, Compose, Caddy, observability, deployment
  scripts/runbooks, and release metadata.
- F owns backup/restore scripts and runbooks and follows E for shared files.
- G owns audit evidence and plan status. DNS/provider mutation is excluded
  unless separately authorized with required inputs.

### Required evidence

- Real disposable PostgreSQL role-policy execution, not SQL text matching.
- Focused negative tests plus full affected lint/type/test/build/audit gates.
- Real browser allow/deny checks for affected roles and surfaces.
- `git diff --check origin/main..BLOCK_SHA` and redacted secret scanning.
- Real production Compose/Caddy rendering without printing secret values.
- Restart/persistence and isolated restore evidence where applicable.
- Separate independent reviewer approval before each merge.
- No scheduled Launch Auditor or separate merge-controller wait. Direct merge
  is allowed only for the independently approved SHA after exact-head CI, and
  exact-main push CI must pass before continuing.
- The full Codex Security workflow is not required for this run; focused
  authorization/RLS/security tests and scoped secret/PII checks remain gates.

### Stop conditions

- Stop before changing registration/invite behavior without the owner's policy.
- Stop before DNS mutation without authoritative access and owner approval.
- Stop before real outbound WhatsApp without real credentials, a dedicated test
  sender/recipient, and explicit approval for that reply.
- Stop before destructive or production restore actions; rehearsals must be
  isolated.
- Stop Lead Agent expansion if active ownership cannot be proven.
- Stop if architecture, schema, acceptance, or merge-order changes lack an
  append-only `PLAN_CHANGES.md` entry.
- Never print, commit, or copy secrets or customer data into evidence.

## Historical Completed EVO Platform Frontend Slice

Historical slice: `/goal-evo-platform-frontend`.

This section records the then-current runtime and acceptance contract for the
completed frontend work. Its legacy `visa` role matrix is historical evidence
only and is superseded for all P1+ implementation by
`docs/EVO_PLATFORM_LONG_RUN_PLAN.md` and `docs/specs/EVO_PLATFORM_TZ.md`.

This slice ran after its planning-only PR was independently reviewed and
merged. It did not close or weaken `/goal-evo-preplatform-hardening`; the
remaining owner/external gates in that goal stayed open.

### Goal

Turn the reviewed Claude Design handoff into the real, responsive and
accessible EVO Platform frontend inside the root Next.js CRM application.
The result should present one coherent staff workspace and student portal while
preserving the current system ownership boundaries:

- amoCRM remains authoritative for contact/lead identity, responsible manager
  and sales-pipeline stage;
- the root CRM remains the canonical host for staff operations and the student
  portal;
- EVO Inbox remains the current WhatsApp conversation runtime and Supabase
  owner until a later backend/data migration decision;
- AI customer replies remain draft-only and require a human to send;
- the retained Lead Agent remains frozen and backend-only.

One frontend does not imply one physical database or one runtime in this slice.
No schema merge, Supabase consolidation, Lead Agent deletion, live provider
mutation, production deployment or outbound WhatsApp test is authorized here.

### Reviewed design baseline

- Source bundle:
  `docs/design/evo-platform/prototype/`.
- Completion contract:
  `docs/design/evo-platform/COMPLETION_CHECKLIST.md`.
- Browser and static audit:
  `docs/design/evo-platform/AUDIT_2026-07-24.md`.
- The handoff covers the main information architecture, seven staff roles,
  Student Portal, design tokens and eight core flows.
- The handoff is not production code. Its known gaps include broken staff
  tablet/mobile layouts, a phone-shaped rather than native desktop Student
  Portal, incomplete navigable system states, CDN runtime dependencies,
  inaccessible clickable `div` controls and unlabelled/unmanaged overlays.

### Role mapping for this frontend slice

The prototype's seven staff personas are design viewpoints, not permission
records to add to production. This slice preserves the five existing staff
roles in `src/lib/domain.ts`:

| Prototype viewpoint | Existing application role in this slice |
|---|---|
| Руководство | `admin` dashboard/report viewpoint; no new role |
| Администратор | `admin` |
| Продажи | `sales` |
| Куратор | `curator` |
| Визовый специалист | `visa` |
| Финансы | `finance` |
| Оператор Inbox | existing `admin`/`sales`/`curator` WhatsApp access; no new role |

The student remains the existing `client` role. Role switching in the design
bundle is demonstration-only and must not be copied into the real application
as an authorization mechanism. Adding a distinct leadership or Inbox-operator
role requires a later role-policy amendment and server-side authorization
work. The completion checklist's permissions-matrix item means documenting and
testing the current five staff roles plus `client`, not silently expanding
them.

### Inbox data boundary for this frontend slice

The root `/whatsapp` route currently reads and writes the main CRM's local
`wa_*` shadow tables through existing CRM queries/actions. It does not read the
separate EVO Inbox Supabase project. Therefore:

- this slice may redesign `/whatsapp` over the existing root CRM read/action
  path and must label its source truthfully;
- it must preserve all current send/configuration guards and draft-only AI;
- it must not claim that the root view is connected to EVO Inbox Supabase;
- the shell may link to or report the separate EVO Inbox runtime status only
  when that status is available through an already-authorized read path;
- a real Supabase-to-root read bridge, shared Inbox API or data migration is a
  later backend/integration slice with its own authentication, ownership,
  privacy and failure-mode design.

“Unified Inbox” in this frontend slice means one consistent interaction design,
not a hidden cross-database integration.

### Architecture and implementation order

1. **Planning and evidence**
   - Commit the unmodified Claude Design source, completion checklist, browser
     evidence and gap audit.
   - Keep the prototype clearly labelled as reference-only.
2. **Frontend foundation**
   - Implement EVO brand tokens, real logo treatment, typography, primitives,
     semantic tables, tabs, dialogs, drawers, feedback and state components.
   - Keep data-reading pages as Server Components and isolate only interactive
     controls in focused Client Components.
   - Implement keyboard focus, reduced-motion handling and native semantic
     controls.
3. **Unified responsive shell**
   - Rebuild the root staff shell and topbar for desktop, tablet and urgent
     mobile work without replacing existing authentication or role checks.
   - Expose truthful amoCRM, WAHA and AI status labels without implying that a
     provider was exercised.
4. **Staff workspaces**
   - Recreate the reviewed dashboard, sales funnel/list, Lead 360, Student 360,
     applications, documents, visa, finance, tasks/calendar, calls/meetings,
     Inbox, notifications, reports and administration surfaces on existing
     root routes where possible.
   - Add only read-model/UI routes required for missing surfaces; do not change
     provider ownership or create a second source of truth.
   - Keep `/whatsapp` on the existing CRM `wa_*` read/action path and label the
     separate EVO Inbox bridge as deferred.
5. **Student Portal**
   - Rebuild `/portal` as a true mobile-first surface with an actual desktop
     layout, accessible document resubmission and the reviewed progress,
     applications, visa, payments, messages, team and security views.
6. **Validation and handoff**
   - Run lint, type/build, relevant unit/e2e suites and secret scanning.
   - Exercise the critical flows in a real browser at 1440x1024, 834x1194 and
     390x844, save screenshots and audit keyboard/focus behavior.
   - Keep provider-dependent flows labelled blocked or simulated unless real
     credentials and explicit mutation/send approval are separately supplied.

### Named write set

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`,
  `docs/design/evo-platform/**`: contract, source handoff and audit evidence.
- `eslint.config.mjs`: ignore only the immutable, reference-only Claude Design
  export under `docs/design/evo-platform/prototype/**`; application source
  remains linted.
- `src/app/globals.css`, `src/app/layout.tsx`,
  `src/app/(staff)/**`, `src/app/login/**`, `src/app/portal/**`:
  responsive application surfaces.
- `src/components/**`, `src/lib/domain.ts`, `src/lib/i18n*.ts`:
  shared design system, navigation, truthful presentation models and copy.
- `src/lib/queries.ts`, `src/lib/actions.ts` only for presentation/read-model
  adaptation of existing root CRM data and existing guarded actions. No new
  cross-runtime provider write path is included.
- `tests/**`, `playwright.config.ts` only where required for frontend
  acceptance and regression coverage.

Database migrations, provider clients, webhook handlers, Compose/Caddy,
production secrets and deployments are outside this slice unless a later
append-only plan amendment explicitly adds them.

### Acceptance criteria

- Every applicable item in the completion checklist maps to a real application
  route, component state or explicitly recorded provider blocker.
- The permissions matrix covers the current `admin`, `sales`, `curator`,
  `visa`, `finance` and `client` roles; prototype-only leadership/Inbox
  personas do not become production roles in this slice.
- Staff views are usable without horizontal page overflow at 1440x1024 and
  834x1194; Inbox, tasks and notifications have an intentional 390x844 urgent
  mobile experience.
- Student Portal uses native mobile and desktop layouts rather than a device
  frame embedded in a marketing page.
- Navigation, cards, forms, tabs, tables, kanban, drawers and dialogs are
  keyboard-operable with visible focus and appropriate semantics.
- No frontend success state claims a real amoCRM, WAHA, Supabase, AI or
  telephony result unless that real service was exercised.
- Sales stages and operational student stages remain visibly distinct.
- AI auto-send remains blocked unless the currently active owner-authorized MVP
  autonomous-reply slice explicitly permits it under its reply-only,
  policy-gated boundary; outside that slice, the manual-send boundary is
  explicit.
- The root application lint, build and affected automated/browser tests pass.

### Merge order and stop conditions

1. Planning/design-evidence PR, including the narrow lint ignore required to
   store the immutable design exporter source outside the runtime.
2. Design-system and responsive-shell PR.
3. Staff workspace PRs split by non-overlapping route ownership.
4. Student Portal PR.
5. Cross-flow browser acceptance and final integration PR.

Stop before changing backend ownership, merging databases, deleting a runtime,
changing role policy, deploying to production or sending a real message. Those
actions require a separate architecture amendment and, where applicable,
explicit owner approval and real provider inputs.

## Completed Main Production Consolidation Slice

Completed slice: `/goal-evo-main-production-consolidation`.

### Goal

Make GitHub `main` the reviewed source of truth for the complete EVO platform,
then deploy that exact release to `hermes-vps` and prove the real EVO Inbox
WhatsApp path without losing active server configuration or claiming provider
success that was not exercised.

Candidate ancestry at planning time is linear:

- `origin/main`: `c1a00b0a3013946a94677fc0f01838740217b622`
- integration candidate after PR #40:
  `8116aad7c6cc97c3de198e3de1c7cad020105416`
- distance: zero commits behind and 41 commits ahead of `main`

The candidate is not releasable as-is. Current audits find vulnerable runtime
dependencies, no effective repository-root GitHub Actions workflow, three
full-range whitespace failures, dirty production checkouts, missing canonical
DNS, and incomplete real-provider readiness.

### Ordered blocks

Each block requires its own branch, PR, real validation evidence, and
independent launch-control approval. Do not begin a later block before the prior
block is merged or explicitly abandoned.

1. **Security and repository gates**
   - Upgrade both Next.js applications to the current secure stable patch.
   - Remove the shadcn code-generation CLI from production dependencies; invoke
     it through the documented ephemeral package runner when future component
     generation is needed. Preserve the small runtime Tailwind extension
     currently imported from that package as a reviewed, tracked local
     stylesheet so removing the CLI does not alter the rendered UI.
   - Apply safe transitive dependency updates until
     `npm audit --audit-level=moderate` passes for both applications.
   - Fix the three existing `git diff --check` findings without unrelated
     formatting churn.
   - Add repository-root GitHub Actions coverage for the main CRM, EVO Inbox,
     and EVO Lead Agent. A workflow nested under an application directory is
     documentation only because GitHub discovers workflows from root
     `.github/workflows/`.
   - Open a dedicated issue for normalizing the pre-existing EVO Inbox formatter
     baseline without mixing hundreds of unrelated rewrites into this release.

2. **Frozen integration promotion**
   - Open an integration-to-`main` PR from one frozen, fully validated candidate
     SHA.
   - Preserve the 41-commit implementation history with a merge commit; do not
     squash the umbrella promotion.
   - Reconfirm `main` and the candidate SHA immediately before merge. Merge only
     the independently approved unchanged candidate.

3. **Production release reconciliation**
   - Do not deploy from either dirty production checkout.
   - Preserve the active Caddy additions currently routing
     `invite-bishkek.72.62.119.112.sslip.io` and
     `inbox.72.62.119.112.sslip.io` as a separately reviewed infrastructure
     change before replacing the server checkout.
   - Preserve the `/opt/evo-crm/evo-lead-agent.git-backup-*` material until the
     owner explicitly approves archival or removal.
   - Build release images from the merged `main` SHA and add OCI source,
     revision, and version labels so a running image can be mapped back to Git.
   - Back up persistent data and record current image digests before deployment.
   - Move EVO CRM services off `acadis_*` networks onto EVO-owned networks while
     preserving private WAHA access and existing volumes.
   - Validate Compose and Caddy before restart, deploy one service boundary at a
     time, and retain the previous image digests for rollback.

4. **Canonical domains**
   - Create `A` records for `crm.evoadmissions.com` and
     `inbox.evoadmissions.com` pointing to `72.62.119.112` only through the
     authoritative DNS provider.
   - Verify public resolution, valid TLS, the expected login redirect, and Caddy
     routing. If authoritative DNS access is unavailable, record that exact
     external blocker and keep the working sslip.io routes.

5. **Real production proof**
   - Use a dedicated EVO-controlled test WhatsApp sender and the connected
     `evo-inbox` WAHA session.
   - Confirm real Supabase, encrypted WAHA, amoCRM, Gemini, and knowledge-base
     configuration through authenticated production readiness checks.
   - Keep unattended auto-reply disabled.
   - Send one controlled inbound message, verify the persisted message and
     amoCRM contact/lead identity, generate one knowledge-grounded Gemini draft,
     have the operator inspect/edit it, and send one manual WAHA reply.
   - Verify delivery and confirm no additional automatic outbound message
     exists in WAHA, Supabase, or amoCRM.
   - Run the legacy receive-only Lead Agent proof separately only after
     `crm_primary` is relinked and its missing amoCRM OAuth configuration is
      supplied. Do not reuse EVO Inbox credentials or its WAHA session.

6. **Provider-proof audit hardening**
   - Before any real outbound proof, persist every generated AI draft with its
     account, conversation, requesting operator, provider, model, knowledge
     evidence, generated text, and timestamp. Return the draft to the composer
     only after that audit record exists.
   - Carry the generated draft identifier through the editable composer to the
     manual-send request. A manual message may omit that identifier when the
     operator wrote the reply without AI.
   - Require a client-generated UUID for every manual send. Persist the complete
     send intent, operator (`messages.sender_id`), optional AI draft reference,
     and a `sending` provider state before calling WAHA. Enforce a unique
     request identifier so concurrent or repeated requests cannot call WAHA
     twice.
   - Treat a lost/ambiguous WAHA response as an uncertain operation and never
     retry it automatically. WAHA documents `POST /api/sendText`, returned
     message identifiers, `message.ack` events, and message lookup by provider
     identifier, but it does not document a caller-supplied idempotency key:
     https://waha.devlike.pro/docs/how-to/send-messages/
     https://waha.devlike.pro/docs/how-to/events/
     https://waha.devlike.pro/docs/how-to/chats/
   - Subscribe the signed EVO Inbox webhook to `message.ack`, persist
     acknowledgement history idempotently, and advance message state
     monotonically. Add a secret-protected reconciliation path only for rows
     that have a stable WAHA message identifier; do not infer provider success
     by matching message text or timestamps.
   - Keep first-launch automatic reply disabled. This block may create local
     migrations, tests, and reviewed code, but it must not send a real WhatsApp
     message. Apply the migration to the intended Supabase project before
     deploying the corresponding application image.

### Named write boundaries

- Security/gates block: root and EVO Inbox package manifests/lockfiles, the
  EVO Inbox global-style import plus its local shadcn Tailwind extension, the
  three whitespace-only files, root `.github/workflows/`, and plan evidence.
- Promotion block: plan evidence and GitHub PR state only; no runtime feature
  changes.
- Production block: EVO-owned Dockerfiles, Compose/Caddy configuration,
  deployment scripts/runbooks, and release metadata. Provider data may change
  only during the explicitly controlled production proof.
- DNS changes are limited to the two canonical EVO `A` records.
- Provider-proof audit block: EVO Inbox Supabase migrations/schema contract,
  AI draft route/composer state, manual WAHA send service/route, signed WAHA
  acknowledgement handling, bounded reconciliation route, focused tests, and
  implementation/runbook evidence. No provider message or customer record is
  created during implementation validation.

### Required validation

Run under Node `22.23.1`:

```bash
# Main CRM
npm ci
npm run lint
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit
npm run build
npm run scenarios
npm audit --audit-level=moderate

# EVO Inbox
cd agent-lead2-inbox
npm ci --include=dev
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=moderate

# EVO Lead Agent
cd evo-lead-agent
uv sync --extra dev
uv run ruff check .
uv run pytest
```

Also require:

- `git diff --check origin/main..CANDIDATE_SHA`
- a redacted Git-history secret scan over the same range
- validated production Compose rendering with real server environment files,
  without printing secret values
- real browser checks of the CRM and Inbox login/operator surfaces
- the authenticated production readiness and provider proof described above

`npm run format:check` currently fails across hundreds of pre-existing EVO
Inbox files. It is not a release gate for this slice because fixing the whole
format baseline would mix unrelated source churn into the security block.
Changed files must still match the repository formatter, and a separate
format-baseline issue must remain visible.

### Rollback and stop conditions

- Stop before DNS mutation if authoritative provider access or the exact zone is
  unavailable.
- Stop before the real message proof if an EVO-controlled test number,
  authenticated Inbox operator, connected WAHA session, or real
  Supabase/amoCRM/Gemini configuration is unavailable.
- Stop deployment if backups, current image digests, Caddy validation, Compose
  validation, or a rollback image is missing.
- Stop if the active dirty Caddy routes cannot be preserved without ownership
  clarification.
- Stop if dependency audit, CI, full-range diff, independent review, or frozen
  candidate checks fail.
- Never print, commit, or copy secret values into logs or repository files.

## Most Recently Completed Goal Slice

Completed slice: `/goal-evo-knowledge-business-context`.

This slice turns the two owner-supplied country drafts into clean text that can
be pasted into EVO Inbox and consolidates the company's business model into one
team-facing context document. The user has explicitly approved the supplied
China and Malaysia content as trusted business input. This slice therefore
cleans and structures that content without external fact-checking or silent
changes to its substantive claims.

Named write set:

- `docs/EVO_LAUNCH_PLAN.md` and `docs/PLAN_CHANGES.md`: execution contract and
  append-only decision record for issue #36.
- `docs/business/knowledge-base/README.md`: upload workflow, document registry,
  ownership, review rules, and current EVO Inbox text-input limitation.
- `docs/business/knowledge-base/ready-to-upload/`: normalized China and Malaysia
  Markdown texts, each intended to be pasted as one separate knowledge document.
- `docs/business/evo-business-context.md`: company, customer, service,
  operating-model, system, data, AI, measurement, governance, and risk context.
- `docs/business/README.md`, `docs/README.md`, and `CONTEXT.md`: discoverability
  and canonical business vocabulary.

Deliverables:

- Preserve the supplied Downloads files byte-for-byte and create reviewed copies
  under stable ASCII filenames in the repository.
- Remove draft labels, warning markers, unresolved transcription notes, open
  questions, broken numbering, and repeated FAQ copies.
- Preserve the owner-approved country claims, prices, routes, service promises,
  office details, and process content while making cost categories and steps
  independently understandable to retrieval.
- Add instructions that keep the assistant inside the approved text, collect a
  minimal admissions profile, avoid requesting sensitive documents in ordinary
  chat, and hand case-specific or uncovered questions to an EVO manager.
- Explain the current upload path accurately: EVO Inbox accepts a title and
  pasted text, then chunks and embeds the saved content; this slice does not add
  binary Markdown-file upload behavior.
- Build the business context from supplied company documents, existing business
  docs, implemented CRM entities, EVO Inbox contracts, Lead Agent contracts,
  and the current data-ownership map. Unknown owners and KPIs remain explicit
  gaps rather than invented facts.
- Do not change runtime code, database schemas, provider settings, deployment,
  DNS, production data, or WhatsApp behavior.

Acceptance evidence:

- SHA-256 checks prove the two supplied source files are unchanged.
- Both upload texts have no `⚠️`, draft/open-question markers, placeholder
  instructions, duplicated FAQ section, secret, or real client personal data.
- A chunk preview using the application's 1,200-character boundary shows both
  documents split into bounded, readable retrieval units.
- Repository links resolve, `git diff --check` passes, and a diff scan finds no
  secrets, bank values, private legal identifiers, or copied customer records.
- Required repository validation passes, or an exact unrelated blocker is
  recorded.
- An independent launch-control reviewer approves the final diff before merge.

Implementation evidence recorded 2026-07-13:

- The supplied China and Malaysia source SHA-256 values still match the values
  recorded in the knowledge registry.
- The real EVO Inbox `chunkText` function produced 14 China chunks with a
  1,197-character maximum and 13 Malaysia chunks with a 1,185-character
  maximum. No chunk exceeded 1,200 characters, ended with an orphan heading, or
  split a handoff lead-in from its trigger list.
- Relative-link, draft-marker, secret/credential, and diff-whitespace checks
  passed with no finding.
- Root lint, Next route generation, TypeScript, production build, all 39
  repository scenarios, and `npm audit --audit-level=moderate` passed under
  Node 22.23.1. The scenario report generated by validation was restored and is
  not part of this slice.
- The two focused EVO Inbox chunk/retrieval test files passed all 16 tests.
- Independent reviewers approved the final China document, Malaysia document,
  business context, data ownership, upload mechanics, privacy controls, and
  named write-set compliance.

## Previous Goal Slice

Completed slice: `/goal-evo-platform-source-of-truth`.

Next major lanes require their own reviewed slice: integration into `main`,
then the real production proofs tracked by GitHub issues #5 and #20.

This slice makes the current repository understandable and usable as the EVO
Admissions Platform source of truth without moving runtime code or changing
production. It is documentation, governance, and controlled source-document
work.

Deliverables:

- Replace the generic root README with a team-facing platform entrypoint.
- Add a complete documentation index, platform/system map, data-ownership
  registry, current-status page, onboarding guide, and business knowledge map.
- Add an EVO company profile based only on supplied real company documents,
  with no bank account values, personal identity numbers, signatures, or home
  addresses copied into tracked Markdown.
- Store the supplied public brand book in a tracked company brand folder.
- Store supplied bank/legal originals in a local Git-ignored private folder
  with restrictive permissions and a tracked safe manifest/checksum registry.
- Add a branded team overview presentation and a concise demo/presenter script.
- Mark historical handoffs and copied issue plans as archived or superseded;
  keep GitHub Issues as the changing work-status authority.
- Correct the active deployment documentation where it still names the Acadis
  proxy instead of the EVO-owned edge boundary.
- Track the safe root `.env.example` while continuing to ignore real `.env*`
  files.
- Do not move `src/`, `agent-lead2-inbox/`, `evo-lead-agent/`, change
  APIs/data models, deploy, alter DNS, or exercise outbound WhatsApp.

Acceptance evidence:

- All four supplied PDFs are identified by page count and SHA-256 checksum;
  the 24-page brand book is tracked and visually reviewed.
- Private source PDFs are present locally, ignored by Git, and not present in
  the staged diff.
- The presentation renders without overflow, overlap, clipping, or unresolved
  placeholders and is visually reviewed slide by slide.
- Repository links and source-of-truth statements are internally consistent.
- `git diff --check`, a staged-diff secret/PII scan, root lint/typecheck/build,
  and an independent launch-control review pass before merge.

Historical implementation material below remains as prior-slice context until
the documentation archive pass is complete.

The EVO Inbox companion lane is specified in
`docs/EVO_INBOX_COMPANION_PRD.md`. It creates a WACRM-derived, fully redesigned
standalone companion app at `agent-lead2-inbox/`, hosted at
`inbox.evoadmissions.com`, using managed Supabase Cloud, WAHA session
`evo-inbox`, WACRM's own draft-only AI assistant, and amoCRM as the identity
source of truth.

Deliverables for the reliable amoCRM sync buffer slice:

- Inbound WAHA `message` webhooks must save the local Supabase contact,
  conversation, and message before attempting amoCRM identity sync.
- Missing amoCRM configuration or temporary amoCRM provider failure must not
  prevent the message from appearing in EVO Inbox.
- Conversations and messages must expose `crm_sync_status` as `pending`,
  `synced`, `not_configured`, or `blocked`, with a safe operator-visible error.
- WAHA must receive HTTP 200 after local save, including the CRM sync state, so
  a saved message is not retried as a failed webhook.
- Add a bounded internal retry endpoint protected by `AUTOMATION_CRON_SECRET`
  to process pending/not configured CRM sync rows and optionally blocked rows
  after operator repair.
- Settings, Inbox UI, public API serializers, readiness, deployment docs, and
  proof checklist must show the new local-save-first behavior truthfully.
- Add migration `036_reliable_amocrm_sync_buffer.sql`.
- Run targeted WAHA/amoCRM/readiness/schema tests plus `npm test`,
  `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`,
  and a PR diff secret scan.
- Commit only this slice with a Conventional Commit.
- Request independent launch-control code-reviewer approval before merge.

Out of scope for this slice:

- Creating the real amoCRM external integration or token in the owner's browser.
- Claiming live WhatsApp, amoCRM, Gemini, Supabase migration, or deployment
  success before the real production services are exercised.
- Auto-reply, broadcast, template, historical import, or `/opt/evo-crm` changes.

Previous Gemini/preflight slice deliverables:

- Update the lead-agent readiness/preflight path so receive-only rollout
  readiness is distinct from outbound WhatsApp readiness.
- Make missing WAHA, amoCRM, CRM sync, Gemini, and admin configuration report
  exact input names.
- Keep local smoke no-outbound and failing when outbound is enabled.
- Update production env examples and deployment docs with Gemini configuration
  and receive-only safety flags.
- For the EVO Inbox companion, add Gemini as an encrypted account-level AI
  provider with a repeatable VPS seed command; keep the assistant draft-only.
- Run lead-agent `uv run pytest` and `uv run ruff check .`.
- Run parent CRM validation because deployment docs and Compose are touched, or
  record the exact blocker.
- Commit only this slice with a Conventional Commit.
- Request independent code-reviewer approval before merge.

Out of scope for this slice:

- Executing the production receive-only proof from issue #5.
- Enabling outbound WhatsApp.
- Claiming live WAHA, amoCRM, Gemini, or CRM sync success without real
  credentials and real provider responses.
- Merging or transplanting the unrelated Kant/Bitrix workspace.
- Rebuilding the CRM UI, role model, student portal, or amoCRM architecture.

The repository snapshot, old write sets, acceptance lists and merge orders below
are retained as historical execution evidence. They do not override the active
goal, immediate execution order or ADR 0019 at the top of this document.

## Execution Rules

- Use the real repo stack and real execution paths.
- Do not claim integration success from mocks, fallback paths, demo modes, sample
  payloads, or synthetic data.
- If a real service or credential is unavailable, the lane must fail clearly and
  name the missing input.
- Prepared AI responses are allowed only for the first presentation because the
  user explicitly requested them. They must not be represented as live Anthropic
  integration success.
- Keep each future lane small enough for review and tied to one mergeable block.
- Every future implementation block needs independent code-reviewer approval
  before merge.

## Repository Snapshot

The current repo is a Next.js App Router application for an education CRM.
Primary stack observed in `package.json`:

- Next.js `16.2.9`
- React `19.2.4`
- TypeScript `^5`
- Tailwind CSS `^4`
- ESLint `^9` with `eslint-config-next`
- SQLite through `better-sqlite3`
- Anthropic TypeScript SDK `@anthropic-ai/sdk`

Important source areas:

- `src/app/`: App Router pages, layouts, and route handlers.
- `src/app/api/ai/*/route.ts`: AI draft and client summary endpoints.
- `src/app/api/webhooks/*/route.ts`: WhatsApp and telephony webhook endpoints.
- `src/lib/db.ts`: SQLite schema bootstrap, seed data, settings, password hash
  helpers, and database access.
- `src/lib/auth.ts`: HTTP-only cookie session handling.
- `src/lib/actions.ts`: Server Actions for auth, CRM operations, WhatsApp send,
  settings, and locale.
- `src/lib/ai.ts`: Anthropic client and prompt execution.
- `src/lib/whatsapp.ts`: WhatsApp Cloud API send/receive integration.
- `src/lib/queries.ts`: read models for dashboard, CRM, WhatsApp, calls, and
  portal views.

## Research Summary

Research was checked on 2026-06-24 against current local and online sources:

- Local Next.js docs in `node_modules/next/dist/docs/` were inspected as required
  by `AGENTS.md`, including App Router route handlers, environment variables, and
  the production checklist.
- Context7 official Next.js docs for `/vercel/next.js/v16.2.9` confirm route
  handlers live under `app/**/route.ts`, supported HTTP methods are exported
  functions, `next build` is the production build gate, and `next typegen && tsc
--noEmit` is the documented route/type validation path.
- Context7 official Anthropic TypeScript SDK docs confirm server-side SDK usage
  through `client.messages.create`, API-key configuration, and message arrays as
  the real request path. Launch validation must use a real configured API key or
  explicitly report `not_configured`.
- Context7 `better-sqlite3` docs confirm direct database opening, prepared
  statements, PRAGMA usage, transactions, and WAL mode as normal production
  patterns for SQLite-backed Node.js apps.
- amoCRM's current developer docs describe `/api/v4/leads` as the deal endpoint
  with pipeline/status IDs, responsible user IDs, custom field values, and
  embedded contacts/companies; `/api/v4/contacts` carries contact custom field
  values; OAuth access and refresh tokens come from `POST /oauth2/access_token`.
- The existing README describes demo accounts, WhatsApp demo mode, IP telephony
  webhooks, client portal, multilingual UI, SQLite backup, and Anthropic-powered
  AI features. Those claims must be verified against the actual app before any
  production or sales-readiness claim.

Current risk surfaced by repo inspection:

- The repo has demo accounts and seeded demo data in `src/lib/db.ts`.
- `src/lib/auth.ts` has a development fallback `AUTH_SECRET`.
- `src/lib/whatsapp.ts` must not return a `demo` send status when WhatsApp
  credentials are missing; missing credentials must produce a visible failed
  send state rather than fake delivery success.
- README must not say missing WhatsApp keys use demo mode. Prepared AI text is
  acceptable only for explicitly labeled presentation behavior, not production
  launch or delivery success.
- AI routes depend on live Anthropic configuration and should fail as
  `not_configured` when no key exists.
- There is currently no explicit `typecheck` script and no test script in
  `package.json`.
- `npm audit --audit-level=moderate` currently fails on an existing PostCSS XSS
  advisory reached through Next.js. The suggested `npm audit fix --force` would
  install an incompatible Next.js downgrade, so this must be handled in a future
  security or dependency lane, not hidden inside this docs-only slice.
- `npm run build` passes after local dependency repair, but Next.js warns that it
  inferred the workspace root from `/Users/iskhak.tazhibaev/package-lock.json`
  because another lockfile exists above the repo. A future config lane should
  either set the documented Turbopack root or remove the stray parent lockfile.

## Acceptance Criteria

### This QA Launch Readiness Slice

- `docs/PLAN_CHANGES.md` has an append-only `/goal-qa-launch` entry before
  runtime or test coding because this lane changes active scope, acceptance
  criteria, file ownership, merge-order status, and validation evidence.
- `docs/QA_LAUNCH_REPORT.md` records the QA method, scored checklist, desktop
  and mobile screenshots paths, pass/fail evidence, changes made, validation
  output, stop reason, and named blockers.
- Browser QA starts from a fresh context with no saved login, cookies, or site
  data, then covers login and critical staff/client flows at 1440x900 and
  390x844 or comparable desktop/mobile sizes.
- The single checklist scores auth/role routing, staff CRM flow, student portal
  flow, integration truthfulness, AI/prepared boundary, i18n/language switching,
  responsive layout, security/secret handling, validation/build readiness, and
  presentation demo clarity.
- Any implementation change is limited to launch-blocking bug fixes, blocker or
  prepared/live copy clarity, validation/scenario coverage, QA report/runbook
  documentation, or small UI polish needed for critical flows.
- Missing WhatsApp, telephony, amoCRM, and Anthropic credentials are reported as
  explicit `not_configured` / `blocked` states or blockers, never as demo or
  hidden mock success.
- Existing staff CRM, student portal, amoCRM settings/status, WhatsApp,
  telephony, and AI boundaries continue to build and smoke successfully after
  the changes.
- Validation is run through the real repo commands for this slice:
  `node node_modules/eslint/bin/eslint.js .`,
  `node node_modules/next/dist/bin/next typegen`,
  `node node_modules/typescript/bin/tsc --noEmit`,
  `node node_modules/next/dist/bin/next build`, `npm run scenarios`, fresh
  browser QA rerun, and `npm audit --audit-level=moderate`.
- Pre-commit security audit is run with `npm audit --audit-level=moderate`; any
  existing advisory is documented rather than bypassed.
- The QA launch commit uses a Conventional Commit message.
- An independent code-reviewer reviews the QA launch diff and evidence against
  this goal before merge and returns `approved` or `changes_requested`.

### Launch Acceptance

The app is launch-ready only when all items below are true and evidenced:

- Auth: no production deployment uses default secrets, demo passwords, or
  unlabeled seeded demo accounts.
- Database: SQLite file path, WAL behavior, schema bootstrap, backup/restore, and
  seed policy are documented and verified on the real runtime target.
- CRM core: staff login, dashboard, sales pipeline, lead-to-client conversion,
  client profile, tasks, finance, reports, and client portal complete real flows
  against the real SQLite database.
- WhatsApp: Cloud API credentials and webhook verification are configured against
  Meta's real service, or the feature is visibly blocked. A `demo` status cannot
  be counted as send success.
- Telephony: webhook authentication and payload handling are validated against a
  real provider configuration or blocked with the missing provider named.
- AI: draft and summary endpoints run through the real Anthropic SDK with a real
  key, or return clear `not_configured`. Prepared responses may be used only in
  the first presentation and must be labeled as prepared content.
- Security: server inputs are schema-validated at API and Server Action
  boundaries, sensitive errors are not leaked, secrets are only environment or
  settings values, and role checks match the feature surface.
- UI: production-critical pages render without broken layout at desktop and
  mobile widths, with Russian/Kyrgyz/English locale switching preserved.
- Validation: lint, typecheck, build, and critical real E2E flows pass. Any
  unavailable credential or external system is a named blocker, not a fake pass.

## File Ownership

Planning and governance:

- `docs/EVO_LAUNCH_PLAN.md`: launch contract owner. Changes require a
  corresponding entry in `docs/PLAN_CHANGES.md` after this slice lands.
- `docs/PLAN_CHANGES.md`: append-only change log. Never rewrite prior entries.

Application architecture:

- `src/app/(staff)/**`: staff-facing CRM pages and navigation.
- `src/app/portal/**`: client portal experience.
- `src/app/login/**`, `src/app/register/**`, `src/app/page.tsx`: auth entry and
  role routing.
- `src/app/api/ai/**`: Anthropic-backed AI endpoints.
- `src/app/api/webhooks/**`: external webhook boundaries.
- `src/components/**`: shared UI and client components.
- `src/lib/db.ts`: schema, connection, seed, settings, password hashing.
- `src/lib/auth.ts`: session token signing and current user resolution.
- `src/lib/actions.ts`: Server Action mutations.
- `src/lib/queries.ts`: read models.
- `src/lib/ai.ts`: Anthropic client and AI generation contract.
- `src/lib/prepared-ai.ts`: deterministic prepared prompt library and response
  scenario generator for the first presentation.
- `src/lib/whatsapp.ts`: WhatsApp Cloud API integration.
- `src/lib/i18n.ts`: locale keys and translations.
- `src/lib/domain.ts`: canonical CRM roles, route map, status values, domain
  entity types, and route access helpers.
- `src/lib/contracts/amo-crm.ts`: amoCRM adapter interface and sync DTOs.
- `src/lib/contracts/student-portal.ts`: client-visible portal contract.
- `src/lib/contracts/prepared-ai.ts`: prepared response boundary for the first
  presentation.
- `src/lib/contracts/index.ts`: public export surface for integration contracts.
- `package.json`, `eslint.config.mjs`, `tsconfig.json`, `next.config.ts`:
  validation and build configuration.

Future lanes must name their write set before coding. If a lane needs to edit
outside its named ownership area, update `docs/PLAN_CHANGES.md` first.

`/goal-evo-inbox-companion` planned write set:

- `docs/EVO_INBOX_COMPANION_PRD.md`: product contract and acceptance context.
- `docs/EVO_LAUNCH_PLAN.md`: lane status, phase plan, write sets, and
  validation gates.
- `docs/PLAN_CHANGES.md`: append-only decisions and scope changes.
- `CONTEXT.md` and `docs/adr/**`: domain language and architectural decisions.
- `agent-lead2-inbox/**`: WACRM-derived EVO Inbox app, Supabase
  migrations, WAHA transport, amoCRM resolver, AI draft surfaces, redesigned UI,
  tests, and MIT license notice.
- `docker-compose.prod.yml`, deployment docs, and Caddy deployment notes only
  when the deployable companion service is introduced.

`/goal-evo-inbox-companion` phase plan:

1. Source setup: create a clean implementation branch from the intended base,
   copy WACRM into `agent-lead2-inbox/`, preserve MIT license notice, and
   establish local install/build/test commands.
2. Product pruning: remove or hide Meta Cloud API, broadcasts, broad
   automations, flow-driven sending, and first-launch-disabled WACRM surfaces.
3. WAHA transport: replace Meta send/webhook/session assumptions with WAHA
   session `evo-inbox`, authenticated webhooks, idempotent inbound persistence,
   and manual outbound send.
4. Supabase foundation: configure managed Supabase, migrations, Auth, storage,
   RLS, service-role server paths, and companion shadow records.
5. amoCRM identity: resolve by phone, create missing contact/lead, store
   `amo_contact_id` and `amo_lead_id`, and block local-only lead presentation
   when amoCRM is unavailable.
6. AI draft and knowledge: keep WACRM's OpenAI/Anthropic draft assistant and
   knowledge base, default auto-reply off, and route manual sends through WAHA.
7. Full EVO Inbox redesign: redesign retained surfaces around admissions
   operators, integration status, lead profile, AI draft, knowledge base, and
   production readiness.
8. VPS deployment: add a separate `hermes-vps` service and Caddy route for
   `inbox.evoadmissions.com`; verify only with real DNS, Supabase, WAHA, amoCRM,
   and AI provider credentials.

`/goal-evo-inbox-companion` acceptance criteria:

- The companion app runs from `agent-lead2-inbox/` without depending on
  Meta Cloud API configuration.
- First launch supports one WAHA session named `evo-inbox`.
- Inbound WAHA messages are authenticated, idempotent, persisted in Supabase,
  and visible in the redesigned EVO Inbox.
- The app resolves or creates amoCRM identity before presenting a lead as real.
- Supabase stores shadow records and app data, not canonical CRM identity.
- AI draft works through the companion app's own assistant; auto-reply is off by
  default.
- An operator can send one manual WhatsApp reply through WAHA after reviewing
  the conversation and optional AI draft.
- Broadcasts, broad automations, flow-driven sending, and Meta templates are
  absent or disabled in first-launch UI and runtime paths.
- `inbox.evoadmissions.com` deployment is only claimed after a real
  `hermes-vps` deployment, Caddy routing, DNS, WAHA, Supabase, amoCRM, and AI
  provider check succeeds.

`/goal-qa-launch` named write set:

- `docs/EVO_LAUNCH_PLAN.md`: current-slice and acceptance update.
- `docs/PLAN_CHANGES.md`: append-only QA launch entry.
- `docs/QA_LAUNCH_REPORT.md`: QA checklist, screenshot paths, validation, stop
  reason, and blockers.
- `docs/SCENARIO_EVALUATION.md`: refreshed only by the required scenario runner
  as validation evidence.
- Runtime, scenario, or copy files only if the QA pass exposes a
  launch-blocking bug, fake-success claim, missing validation evidence, or small
  critical-flow UI issue inside this slice.

`/goal-lead-agent-webhook-ownership` named write set:

- `docs/EVO_LAUNCH_PLAN.md`: append this implementation block.
- `docs/PLAN_CHANGES.md`: append webhook ownership and source-of-truth decision.
- `AGENTS.md`, `deploy/README.md`, `docker-compose.prod.yml`,
  `deploy/env.lead-agent.example`, `.gitignore`, `.dockerignore`,
  `eslint.config.mjs`, `tsconfig.json`: deployment, repo-boundary, and
  validation configuration for the lead-agent sibling service.
- `src/lib/db.ts`, `src/lib/whatsapp.ts`, `src/lib/actions.ts`,
  `src/lib/queries.ts`, `src/lib/i18n-data.ts`,
  `src/app/(staff)/settings/page.tsx`,
  `src/app/(staff)/whatsapp/[id]/page.tsx`, `scripts/bootstrap-admin.mjs`: CRM
  schema, settings, read models, bootstrap schema, and operator-visible
  source-of-truth state.
- `src/app/api/internal/lead-agent/**`: private internal sync endpoint from the
  lead-agent service into EVO CRM.
- `evo-lead-agent/AGENTS.md`, `evo-lead-agent/README.md`,
  `evo-lead-agent/.env.example`, `evo-lead-agent/Dockerfile`,
  `evo-lead-agent/docker-compose.yml`, `evo-lead-agent/pyproject.toml`,
  `evo-lead-agent/uv.lock`, `evo-lead-agent/SECURITY.md`,
  `evo-lead-agent/functional-spec.md`, `evo-lead-agent/technical-spec.md`,
  `evo-lead-agent/implementation-plan.md`,
  `evo-lead-agent/token-cost-estimate.md`, `evo-lead-agent/research/README.md`,
  `evo-lead-agent/*context-report.md`,
  `evo-lead-agent/src/evo_lead_agent/**`, `evo-lead-agent/tests/**`:
  product rename, lead-agent runtime packaging, callback configuration, signed
  CRM sync client, service pipeline, and focused tests.

Acceptance criteria:

- WAHA webhook ownership moves to the lead-agent service. Production/session
  configuration should point WAHA at `http://evo-lead-agent:8000/webhooks/waha`
  on the private Docker network, not the public CRM route.
- The lead-agent resolves or creates amoCRM contact/lead first, then sends a
  signed internal sync payload to EVO CRM.
- EVO CRM persists remote amoCRM identifiers and lead-agent state on the local
  lead/conversation records without making local state the source of truth.
- EVO CRM keeps the staff WhatsApp inbox/operator UI usable by storing inbound
  and outbound message copies linked to the resolved amoCRM lead/contact.
- Both internal CRM sync and WAHA webhooks must be authenticated with shared
  secrets/HMAC-style verification; no public unauthenticated mutation endpoint
  is allowed.
- The first live receive-only test may enable autoreply only for Gemini draft
  review, but must keep outbound disabled until WAHA, amoCRM, CRM internal sync,
  and Gemini configuration are verified with real credentials and a later
  outbound send test is explicitly approved.
- The parent repo owns the EVO-specific `evo-lead-agent` source. Parent CRM
  validation must still avoid scanning lead-agent Python/runtime internals with
  Next.js tooling, and `evo-lead-agent/research/repos` stays untracked so
  unrelated reference snapshots do not become production source.

`/goal-gemini-receive-only-production-preflight` named write set:

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`, `deploy/README.md`,
  `deploy/env.lead-agent.example`, `docker-compose.prod.yml`: parent launch
  contract and production deployment readiness path.
- `evo-lead-agent/README.md`, `evo-lead-agent/.env.example`,
  `evo-lead-agent/PLAN_CHANGES.md`, `evo-lead-agent/implementation-plan.md`,
  `evo-lead-agent/technical-spec.md`,
  `evo-lead-agent/src/evo_lead_agent/readiness.py`,
  `evo-lead-agent/src/evo_lead_agent/preflight.py`,
  `evo-lead-agent/src/evo_lead_agent/cli.py`,
  `evo-lead-agent/tests/test_readiness.py`,
  `evo-lead-agent/tests/test_preflight.py`,
  `evo-lead-agent/tests/test_cli.py`: parent-tracked lead-agent receive-only readiness,
  preflight, local smoke, docs, and regression coverage.

Acceptance criteria:

- Env examples and deploy docs include Gemini configuration and receive-only
  safety flags.
- Readiness and preflight distinguish `receive_only_rollout` from
  `live_whatsapp_outbound`.
- Missing WAHA, amoCRM, CRM sync, Gemini, and admin configuration is reported
  by exact missing input name.
- Local smoke remains no-outbound and fails if outbound is enabled.
- `uv run pytest` and `uv run ruff check .` pass in `evo-lead-agent`.
- Parent CRM validation runs because deployment docs and Compose are touched.

## Merge Order

1. `plan-contract`: docs-only launch contract. Blocks implementation lanes.
2. `brand-research`: docs-only product/domain research for copy and education
   flow realism.
3. `architecture-contract`: role, route, entity, amoCRM adapter, student portal,
   and prepared AI contracts.
4. `crm-baseline`: separate runtime baseline commit required so later slices can
   build from a clean checkout without mixing baseline and prepared-AI review.
5. `prepared-ai-prompts`: user-requested first-presentation prepared response
   layer with explicit prepared/live boundaries.
6. `admissions-crm-core`: core staff CRM surfaces for Command Center,
   Admissions Pipeline, Student 360, tasks, documents, applications, and finance
   overview.
7. `student-portal`: first production-quality authenticated student portal over
   the stable student, application, document, payment, task, and update
   contracts.
8. `amocrm-integration`: runtime amoCRM settings/status/adapter foundation with
   truthful configured/not-configured/blocked behavior. Completed before
   `/goal-qa-launch`.
9. `/goal-qa-launch`: combined release/presentation QA readiness lane covering
   validation-baseline, production truthfulness, security/secret checks,
   CRM-core flow verification, real integration blocker recording,
   presentation-readiness evidence, release-readiness reporting, and clean-tree
   final audit without rebuilding feature architecture.
10. `/goal-lead-agent-webhook-ownership`: make the lead-agent service the
    private WAHA webhook owner, use amoCRM as source of truth, and sync local
    CRM shadow state for the operator UI.
11. `/goal-gemini-receive-only-rollout`: replace Anthropic drafting with
    Gemini 3.5 Flash draft review in the EVO lead-agent, then prove receive-only
    production WhatsApp rollout on `hermes-vps` with real WAHA, amoCRM, CRM sync,
    and Gemini credentials while outbound WhatsApp remains disabled.

Each lane must be merged or intentionally abandoned before the next lane starts.

## Required Validation Commands

Current baseline commands for this repo:

```bash
node node_modules/eslint/bin/eslint.js .
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build
npm run scenarios
npm audit --audit-level=moderate
```

Future implementation lanes should add real integration and E2E checks to this
list rather than replacing these gates.

## Dependency Audit Hardening And Frontend Merge Readiness

Active slice: `/goal-evo-dependency-hardening`.

This slice restores a truthful green dependency gate after two advisories were
published against the already-merged frontend dependency graph. It must merge
before the independent design-polish PR is rebased and merged.

### Scope

- Update the root CRM and `agent-lead2-inbox` PostCSS resolutions to a current
  patched release and regenerate both lockfiles under the repository Node 22
  runtime.
- Keep `npm audit --omit=dev --audit-level=moderate` blocking for both deployed
  Next.js applications.
- Add a repository-owned development-audit verifier that accepts only
  `GHSA-mh99-v99m-4gvg` and only the known ESLint/minimatch package chain.
- Give the temporary allowlist an explicit owner, reason, and review deadline.
- Keep every other direct or transitive advisory blocking, including any new
  advisory that appears after this plan is written.
- Do not use `npm audit fix --force`, unsupported transitive major overrides,
  broad `continue-on-error`, or an unbounded audit exception.

Named write set:

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`: launch contract and
  append-only decision record.
- `package.json`, `package-lock.json`,
  `agent-lead2-inbox/package.json`,
  `agent-lead2-inbox/package-lock.json`: patched PostCSS resolution and locked
  dependency graphs.
- `.github/workflows/evo-platform-ci.yml`: separate blocking production and
  constrained development audit gates.
- `scripts/check-npm-audit-allowlist.mjs`,
  `config/npm-audit-allowlist.json`: real npm audit execution and the
  time-bounded exception contract.

### Acceptance criteria

- Root CRM and EVO Inbox production audits return zero vulnerabilities.
- Full development audits may contain only the known
  `brace-expansion -> minimatch -> ESLint/Next lint plugins` chain recorded in
  the allowlist.
- The verifier fails closed on malformed npm output, an expired allowlist, an
  unknown advisory URL, or an unknown affected package.
- Root CRM and EVO Inbox install, lint, type-check, test and production build
  gates pass from their committed lockfiles.
- The hardening PR passes GitHub CI and receives an independent launch-control
  `approved` verdict before merge.
- After the hardening PR merges, PR #72 is rebased onto current `main`, reruns
  the complete CI workflow, receives an independent freshness/correctness
  confirmation, and only then merges.
- No deployment, provider mutation, production database change, live WhatsApp
  send, or amoCRM write occurs in this slice.

### Current primary sources

- npm audit supports separate omitted dependency classes and severity-based
  exit thresholds:
  <https://docs.npmjs.com/cli/v11/commands/npm-audit/>.
- `brace-expansion` advisory:
  <https://github.com/advisories/GHSA-mh99-v99m-4gvg>.
- PostCSS advisory:
  <https://github.com/advisories/GHSA-r28c-9q8g-f849>.

## EVO Platform Post-Design Review Polish Slice

Historical completed slice: `/goal-evo-platform-design-polish`.

This slice applies the independent Claude Design review dated 2026-07-25 to
the already-merged unified frontend. It is a frontend refinement pass, not a
rebuild. The reviewed baseline is `origin/main` at
`3dd571bf302bd46dd020e029eb5ab40da5a1a277`.

### Product and technical boundaries

- amoCRM remains canonical for lead/contact identity and sales stage.
- For this historical design-polish slice, AI customer replies remained
  draft-only and required explicit operator send.
- Provider status remains honest; no WAHA, amoCRM, AI, telephony, storage or
  payment connection may be presented as verified without a real exercise.
- Existing roles and server-side authorization are unchanged.
- This slice changes frontend presentation and frontend regression coverage
  only. It does not change database schemas, webhook/provider contracts,
  Compose/Caddy, secrets, deployment or production state.

### Public test seams

The agreed seams for test-first changes are browser-visible behavior and
accessible DOM on existing routes. Tests should assert what an operator or
student can see and operate at `1440x1024`, `834x1194` and, where applicable,
`390x844`; they should not assert private helper implementation.

- WhatsApp: bubble semantics by delivery state, honest context summary,
  compact mobile source disclosure, useful empty state and non-duplicated
  composer guidance.
- Staff navigation: distinct application/visa destinations, discoverable
  icon-rail labels on hover and keyboard focus, and no horizontal overflow.
- Dashboard: one attention heading and an action-first queue that handles
  zero-count/all-clear states.
- Student 360, permissions and portal: collapsed data-entry affordances,
  semantic permission indicators, useful desktop density and brand-consistent
  system copy.

### Implementation waves

1. **P1 isolated refinements:** F1 outgoing WhatsApp bubbles, F2 distinct visa
   icon and F4 useful Inbox empty state.
2. **P1 responsive navigation:** F3 tablet icon rail with durable
   hover/focus-visible labels and explicit active state.
3. **P2 dashboard and Inbox:** F5 duplicated dashboard eyebrow, F6 zero-first
   priority queue, F7 repeated unverified-sync values, F8 oversized mobile
   source banner and F10 duplicated composer label/placeholder.
4. **P2 structure and polish:** F9 Student 360 anchor/form density, F11
   permission glyphs, F12 portal desktop lower-zone utility and F13 system
   update emoji.

### Acceptance

- Three consecutive outgoing messages do not create a red wall; red is
  reserved for `failed`, and all supported delivery states retain their exact
  mapping.
- `/applications` and `/visa` are visually distinct at 834px, every icon-rail
  destination has an accessible label, and that label becomes visible on
  hover and keyboard focus.
- The no-selection Inbox state explains the next action and repeats that AI
  only creates a draft.
- Dashboard attention content leads with real actions; when every count is
  zero it shows the all-clear copy from the design review.
- At 390px at least two messages are visible without scrolling while provider
  source detail remains available.
- Student 360 keeps deep links and mutations available without showing all
  add forms by default.
- Portal desktop uses existing data to reduce the empty lower zone and does
  not invent a provider result.
- Lint, TypeScript, production build, scenarios, security checks, Playwright
  and automated accessibility checks pass under Node 22.
- Fresh screenshots cover affected routes at required viewports, including
  both light and dark WhatsApp message treatment where supported.
- An independent reviewer checks the final diff against this contract before
  the pull request is offered for merge.

### Named write set

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`,
  `docs/design/evo-platform/COMPLETION_CHECKLIST.md` and frontend screenshot or
  audit evidence under `docs/design/evo-platform/**`.
- `src/app/globals.css`, affected routes under `src/app/(staff)/**` and
  `src/app/portal/**`.
- Shared presentation components under `src/components/**` and existing
  presentation/query copy under `src/lib/**` only when needed for F1-F13.
- Focused public-behavior regression coverage under `tests/**`.

## Stop Conditions

Stop and escalate when:

- Required real credentials, provider accounts, data, or deployment targets are
  missing.
- A lane would need hidden mocks, demo paths, or fake success to pass.
- Scope, architecture, acceptance criteria, file ownership, or merge order needs
  to change and `docs/PLAN_CHANGES.md` has not been updated first.
- Independent reviewer approval is unavailable and the user has not explicitly
  waived the launch-control gate.
- Validation fails for reasons outside the lane's scope and cannot be fixed
  without changing the contract.

## Historical Final EVO Platform Technical Specification Slice

Completed predecessor slice: `/goal-evo-platform-final-tz`.

This slice turns the completed frontend, the audited repository, the
owner-supplied OZO technical brief, current production boundaries, business
process documentation, ADRs and design evidence into the implementation
contract for the unified EVO Admissions platform. P0 now corrects its remaining
role, ownership, environment, retention and release-gate gaps. Repository
implementation starts only after P0 merges; production mutations still require
their own explicit authorization.

### Scope

- Produce one canonical Russian-language specification covering business
  outcomes, actors, roles, workflows, data ownership, integrations,
  non-functional requirements, migration, release gates and acceptance tests.
- Treat the owner-supplied OZO brief as contextual input, not as automatically
  correct architecture or product truth. Preserve useful process requirements,
  record corrections, and expose unresolved decisions explicitly.
- Keep amoCRM canonical for lead/contact identity, responsible manager and
  sales stage. Keep operational admissions stages separate from the sales
  pipeline.
- Define one dedicated Supabase production project for all EVO-owned platform
  data. Keep local/dev, persistent staging and preview branches/projects
  physically isolated with the same migrations and no production-data copy by
  default. Do not create separate production projects for Inbox and CRM.
- Define one WAHA/WhatsApp ingress, idempotent event handling, durable message
  history, draft-only AI, manual outbound confirmation and delivery/read audit.
- Specify how useful Lead Agent responsibilities move into the unified backend.
  Retirement is allowed only after a controlled real end-to-end proof,
  reconciliation, rollback window and owner approval.
- Reuse the accepted EVO frontend and brand evidence as the interaction
  contract. Figma or prototype files are supporting design evidence, not a
  substitute for this technical specification.
- Distinguish verified current behavior, target requirements, assumptions,
  external blockers and future options throughout the document.

### Named write set

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`: launch contract and
  append-only decision record.
- `docs/specs/EVO_PLATFORM_TZ.md`: canonical reviewable specification source.
- `docs/specs/EVO_PLATFORM_TZ.docx`: editable owner-facing specification.
- `docs/specs/EVO_PLATFORM_TZ_VALIDATION.md`: reproducible validation and
  page-inspection ledger.
- `scripts/generate-evo-platform-tz.py`: deterministic DOCX builder.
- `scripts/verify-evo-platform-tz.py`,
  `scripts/requirements-evo-platform-tz.txt`: isolated dependency, real
  LibreOffice/Poppler render and accessibility/traceability verification
  contract.
- Existing brand and implementation screenshots under `docs/company/brand/**`
  and `docs/design/evo-platform/**` may be read and embedded; they are not
  modified by this slice.

### Acceptance criteria

- Every `FR`, `NFR`, `INT`, `DATA`, `SEC`, `ACC` and `DEC` ID is listed
  individually in a provenance matrix that points to repository evidence,
  official provider documentation, the OZO brief or an explicit owner
  decision. Every requirement also has an explicit priority and verification
  method.
- Data ownership and synchronization rules prevent two independently writable
  lead/contact/sales-stage sources of truth.
- Roles and permissions cover both server-side authorization and visible UI,
  including denial, audit and privileged-action rules.
- The current plan keeps the production path reversible and leaves Lead Agent,
  the legacy webhook/session and rollback path deployed/frozen only as
  current-state cutover inputs. It does not authorize their retirement in this
  slice and does not preserve them as separate target products.
- The original full-target journey remains explicit but deferred with P4:
  `WhatsApp -> amoCRM -> EVO Platform -> AI draft -> manual send ->
  delivery/read status -> audit history`. Current P8 accepts only the real
  executable amoCRM-independent P5-P7 portion and records the amoCRM segment as
  deferred, never passed.
- Unknown provider states, missing credentials and unverified integrations
  remain visibly blocked; no mock or configured flag is described as production
  proof.
- The DOCX uses the EVO brand, has a real heading hierarchy, marked table
  headers, meaningful image alt text and no secret or applicant personal data.
- A fresh Python environment installs the pinned DOCX dependency manifest, the
  repo-owned verifier builds the DOCX, renders it through real
  LibreOffice/Poppler, validates item-level traceability and writes structured
  accessibility evidence. The packaged document renderer is also used for the
  final owner-facing render.
- Every final page is visually inspected at original resolution and recorded in
  `docs/specs/EVO_PLATFORM_TZ_VALIDATION.md`; the automated accessibility audit
  has zero unresolved high, medium or low findings.
- All substantive owner-facing content comes from
  `docs/specs/EVO_PLATFORM_TZ.md`; the generator adds only presentation
  mechanics such as the branded cover, footer and Word TOC field.
- An independent reviewer checks the final specification against source
  evidence, architecture boundaries and acceptance criteria before merge.
- No production deployment, provider mutation, database migration, live
  WhatsApp send or amoCRM write occurs in this slice.

## Current P8D Disabled Deployment Slice

The first P8D attempt stopped safely before CRM or Inbox recreation because the
retained P8B images were `linux/arm64` while Hermes is `linux/amd64`. Lead Agent
was restored healthy and all production configuration was rolled back. The
P8B2 under issue #188 produced the exact platform-bound `linux/amd64`
candidate. P8C2 then bound its real retained manifest, evidence, SBOM/smoke
identities and current environment reconciliation. P8D2 under issue #202 loaded
the verified archives but stopped without restarts because its contract compared
platform-manifest digests with their parent OCI-index digests. P8B3 under issue
#205 then bound both identities and the exact portable archive graph. The active
next slice is staging-only P8D3 under issue #209 and
`docs/platform/p8d3-portable-amd64-staging.md`.

Current accepted release-control main:
`81ef7a6cb6d16404fbba53af695a80b04140cfa3`. Its exact-main CI run
`31894158294` completed successfully. P8C2 reconciled the real environments
without mutation, retained P8B application provenance at `050514...`, bound
the exact AMD64 image identities, and truthfully returned `blocked` because
portable identity, fresh staging, provider prerequisites, and deployment remain
incomplete.

The owner-authorized P8D2 attempt is closed as failed-safe evidence. All running
CRM, Inbox, Lead Agent and WAHA identities, start times, health and zero restart
counts remained unchanged; no provider call occurred. P8B3 now binds both the
OCI index and its portable AMD64 manifest plus archive/config/layer bytes. It is
local evidence generation only and grants no Hermes retry.

The current preflight records Inbox WAHA as `SCAN_QR_CODE`, canonical DNS as
absent and amoCRM credentials as incomplete. P8D must preserve those external
blockers truthfully rather than silently fixing or relabelling them. P8D3 may
reuse only the freshly hash-proven P8D2 transfer/load checkpoint, creates a new
rollback/evidence boundary and may not change a running service. Application
activation remains a later separately approved block. Current main now includes
migration `073` and updated future-candidate inventory; P8D3 does not relabel or
rebuild the frozen pre-`073` P8B3 application candidate. P8D4 must reconcile
that database/application compatibility before any deployment authorization.

## EVO Knowledge Launch Finalization

Block-ID: `EVO-KNOWLEDGE-LAUNCH-FINALIZE-2026-08-15`.

The owner authorizes finalizing the current Obsidian knowledge bases for first
AI use without making semantic Gmail processing or missing WhatsApp media a
launch blocker. Those archived sources remain preserved for later incremental
improvement. This block does not deploy an AI, send messages, inspect applicant
documents, process Gmail, retry WhatsApp media, or expose raw/sensitive content.

### Delivery blocks

1. Resolve the remaining manually created review notes by archiving status-only
   checklists and promoting only current, non-personal, sourced facts.
2. Create the client-vault marker `.evo-vault.json` with the closed object
   `{"kind":"evo_client_knowledge","canonical_path":"<resolved exact path>"}`.
   Publication rejects a missing, malformed, extra-key, symlinked or path-
   mismatched marker and any destination outside that exact marked vault.
3. Add a deterministic client-publication command that reads only approved
   internal Markdown, requires an explicit Russian allowlist, rejects sensitive
   or unresolved material, preserves provenance, and writes only beneath the
   marked client vault.
4. Publish a useful Russian client set covering EVO, services, admissions,
   countries, universities, prices and response policies. Mutable external
   facts must carry an official source and verification date; otherwise the
   client note must instruct staff to verify before quoting it.
5. Add a deterministic local retrieval check for both marked vaults and run
   real Russian control questions against the actual published Markdown. This
   proves the local knowledge artifacts are retrievable; it is not proof of a
   deployed model or provider integration.
6. Record an operational readiness report with exact counts, exclusions,
   deferred Gmail/WhatsApp work and remaining risks.

### Closed publication contract

- Allowlist path: `<client vault>/.Публикация клиентской базы.json`. It is a
  closed version-1 object with only `version` and `entries`. Every entry has
  exactly: `source_relative_path`, `source_sha256`, `destination_relative_path`,
  `content_class`, `personal_data_reviewed`, `authority`,
  `authority_reference`, `official_url`, and `verified_at`.
- `content_class` is only `stable_evo_policy` or `mutable_official_fact`, and
  `personal_data_reviewed` must be the JSON boolean `true`. Stable policy accepts
  only `owner_decision`; mutable facts accept only `official_source`. A source
  containing an email address or phone-like sequence is rejected regardless of
  the review flag. The publisher does not infer or downgrade a content class
  from keywords.
- `authority` is only `owner_decision` or `official_source`. Owner decisions
  require a non-empty internal decision-note reference; their `official_url`
  and `verified_at` are JSON null. Official-source entries require an HTTPS URL
  and ISO `YYYY-MM-DD` verification date; their `authority_reference` names the
  internal verification note. No missing/extra fields or mixed authority form
  is accepted.
- Source paths are normalized relative paths beneath the exact approved
  internal vault, must name regular non-symlink Markdown files and must match
  `source_sha256`. Destination paths are normalized Russian `.md` paths beneath
  the exact client vault and may not overwrite unmanaged files.
- The approved source is accepted only at the exact non-symlink path
  `<marked internal root>/Утверждено для внутреннего ИИ`; raw CLI path
  components are checked before canonicalization. Authority references are safe
  relative regular non-symlink Markdown paths in that approved vault. Owner
  references require exact frontmatter `тип: решение_владельца` and
  `статус: решено`; official references require `тип: протокол_проверки` and a
  valid `дата_проверки` ISO date.
- Published frontmatter contains exactly traceable fields for publication:
  `тип: клиентское_знание`, `управляется: evo_client_publisher`, source relative
  path/SHA, authority/reference, official URL and verification date. Null
  provenance remains explicit for owner decisions.
- Managed state lives at `<client vault>/.Манифест клиентской публикации.json`,
  a closed version-1 object containing the exact generated destination paths
  and their source/output SHA values. Stale deletion is restricted to paths in
  the prior valid manifest whose current file still has the managed marker.
- The publisher validates marker, allowlist, all sources, all destinations,
  provenance and the existing managed manifest before any write or deletion.
  It also resolves and reads every stale managed candidate before mutation.
  Missing/malformed/traversal/symlink/hash/provenance errors fail with zero
  mutation.

### Deterministic retrieval gate

- CLI: `scripts/knowledge_ingestion/check_retrieval.py`; committed cases:
  `scripts/knowledge_ingestion/retrieval_cases.json`; report:
  `<internal vault>/Панель управления/Отчёт проверки поиска.json`.
- Cases use a closed version-1 schema with `vault` (`internal` or `client`),
  Russian `query`, `top_k`, and one or more exact expected relative paths. A
  case passes only when an expected path is in the deterministic top-k result.
- The initial fixed cases cover client questions about EVO, result wording,
  China documents, study price and admissions; internal cases cover client
  handoff, source authority, review flow and China working data.
- The checker accepts only the two exact marked roots, walks regular non-symlink
  Markdown beneath the selected root and records result paths/scores. It rejects
  any case/path resolving into `Сырой архив ЭВО` or `Секреты и доступы ЭВО`,
  any root/marker mismatch and any unexpected fixture field. Exit is non-zero
  if any expected top-k result or forbidden-root assertion fails.

### Acceptance criteria

- Gmail semantic processing and 396 failed WhatsApp media downloads are marked
  deferred, not complete and not required for first launch.
- Raw exports, correspondence, applicant files, credentials, contracts with
  personal fields, and internal-only process notes never enter the client vault.
- Client publication is allowlist-only, fail-closed, repeatable and tested for
  traversal, unmanaged-file preservation, sensitive-content rejection and
  deterministic stale cleanup.
- Marker tests reject missing, malformed, symlinked and canonical-path-mismatched
  client markers; allowlist tests reject unknown fields, wrong SHA, invalid
  provenance and destinations outside the exact client vault before mutation.

## Active slice: `/goal-evo-platform-knowledge`

### Outcome

Connect the two approved Obsidian knowledge layers to the production EVO Inbox
without exposing raw archives or internal notes to client-reply generation.
Obsidian remains the owner-edited source; Supabase is the account-scoped runtime
index; Gemini produces operator-reviewed drafts only. No autonomous WhatsApp
send is authorized.

### Delivery blocks

1. `K1` records this architecture and its closed publication, database,
   retrieval, deployment and real-evaluation contract. It changes no runtime.
2. `K2` adds an explicit `client` / `internal` audience to knowledge documents,
   chunks and retrieval RPCs; existing unclassified production documents become
   `internal`. Client draft and playground paths request only `client` chunks.
3. `K3` adds deterministic bundle construction from the two exact marked local
   vaults and a one-shot server-side importer. The client bundle contains all
   regular non-symlink Markdown in the exact client vault except `.obsidian`,
   publication journals and hidden control files. The internal bundle contains
   only regular non-symlink Markdown under `Утверждено для внутреннего ИИ`.
4. `K4` adds an authenticated staff-only internal assistant surface. It retrieves
   only `internal` chunks, calls the account's existing active Gemini config,
   returns a draft plus source-note identities, records the same provider and
   retrieval audit metadata used by client drafts, and cannot send WhatsApp.
5. `K5` deploys only after reviewed PRs, green exact-head/main CI and the current
   release gate. It applies the migration, imports both real bundles, reindexes,
   runs fixed Russian retrieval cases and executes one explicitly authorized
   real Gemini draft for each audience. Automatic reply remains disabled.

### Closed data and sync contract

- `ai_knowledge_documents.audience` and `ai_knowledge_chunks.audience` are
  required text values restricted to `client` or `internal`. Chunk audience is
  copied from its parent document; retrieval RPCs require an audience argument
  and filter it together with `account_id` before ranking.
- Managed documents also carry `source_path`, `source_sha256` and
  `managed_by = 'evo_obsidian_sync'`. A closed check constraint requires all
  three to be non-null for managed rows and all three to be null for manual
  rows. The unique partial managed identity is
  `(account_id, audience, source_path)`. Existing/manual documents remain
  preserved but migrate to `internal`; they are never silently promoted to
  client knowledge.
- A bundle is UTF-8 canonical JSON (`sort_keys=true`, compact separators, one
  final LF) named `evo-knowledge-<audience>.json`. It is a closed version-1
  object with `version`, `account_id`, `audience`, `vault_kind`, `marker_sha256`,
  and `documents`; it contains no clock-derived field. Each
  document has exactly `source_path`, `source_sha256`, `title`, and `content`.
  `source_path` is NFC-normalized POSIX syntax relative to the exact marked
  client root for `client`, and relative to the exact approved child for
  `internal`. It must be a non-empty visible `.md` path with no absolute form,
  backslash, dot segment, hidden segment or symlink component and must resolve
  to a regular file strictly inside that lexical root.
- Its manifest is exactly `evo-knowledge-<audience>.sha256.json`, canonicalized
  the same way, with only `version`, `account_id`, `audience`, `bundle_file`,
  and `bundle_sha256`; the SHA covers the exact bundle bytes. The importer
  requires exact account/audience/file agreement and re-hashes before parsing.
  `marker_sha256` binds the exact local `.evo-vault.json` bytes; the server does
  not treat the workstation absolute path inside that marker as authorization.
  Generation time belongs only to the unhashed operational report. Rebuilding
  the same account/audience/vault bytes produces byte-identical bundle and
  manifest files and the same SHA.
- Bundle creation validates the exact non-symlink vault marker and every path,
  rejects symlink components, invalid UTF-8, non-Markdown files, duplicate
  paths, wrong hashes and any path containing raw/secrets roots. Both audiences
  unconditionally reuse `contains_email()` and `contains_phone()` from
  `scripts/knowledge_ingestion/review.py`; either match aborts the entire bundle.
  Tests include formatted/international phones, continuous 10/16-digit runs,
  email case variants, invalid UTF-8 and symlinked parent components.
- The importer runs inside the private EVO Inbox execution boundary with the
  existing service-role credential. It requires an explicit account id, validates
  the complete bundle before mutation, upserts only managed identities for the
  declared audience, rebuilds their chunks, and deletes stale documents only
  when they are still marked `evo_obsidian_sync` for that audience. Manual and
  opposite-audience documents are never deleted.
- Before database mutation, the importer deterministically chunks every document
  and obtains/validates every required embedding in memory. It then calls the
  single service-role-only Postgres function
  `public.sync_ai_knowledge_bundle(uuid,text,text,jsonb)`, passing account,
  audience, bundle SHA and the fully materialized documents/chunks. The function
  revokes `PUBLIC`/`anon`/`authenticated`, grants only `service_role`, validates
  the closed payload again, takes `pg_advisory_xact_lock` on the account/audience
  identity, upserts documents, replaces their chunks, deletes only stale managed
  rows for that audience, records the bundle SHA, and returns counts in its one
  database transaction. Any exception rolls back every write. The existing
  delete-then-insert `ingestDocument()` is not used by this importer.
- The fourth RPC argument is a closed JSON object with exactly `version: 1` and
  `documents`. Each document has exactly `source_path`, `source_sha256`, `title`,
  `content`, and `chunks`. Each chunk has exactly `chunk_index`, `content`,
  `content_sha256`, and `embedding`; indices are consecutive integers from zero,
  content is non-empty and SHA-256 matches its UTF-8 bytes, and embedding is an
  array of exactly 1,536 finite JSON numbers. Document identity is the managed
  `(account_id,audience,source_path)` row; chunk identity is that document plus
  `chunk_index`. Empty documents/chunks, duplicate paths/indices and extra keys
  reject the whole RPC. The lock is exactly
  `pg_advisory_xact_lock(hashtextextended(account_id::text || chr(31) || audience, 0))`.
  The RPC returns exactly `version`, `account_id`, `audience`, `bundle_sha256`,
  `documents_upserted`, `documents_deleted`, and `chunks_replaced`; counts are
  non-negative integers and are committed in the same transaction.
- A failed validation, embedding/provider error or database error is reported as
  failure. There is no keyword, mock or partial-success fallback during import.

### Security and behavior invariants

- Client reply generation, playground evaluation and any later auto-reply path
  can retrieve only `client` knowledge. Internal retrieval is available only to
  authenticated EVO staff and never enters a client reply prompt.
- `owner`, `admin` and `agent` are staff for this slice; `viewer` has no direct
  document/chunk/RPC or assistant access. Direct table SELECT and retrieval RPCs
  require `is_account_member(account_id, 'agent')`; document mutation remains
  admin/owner-only. Retrieval RPCs remain `authenticated` but are SECURITY
  INVOKER and RLS-bound. The sync RPC is service-role-only. Client draft and
  playground routes require `agent` and hard-code `client`; the internal route
  requires `agent` and hard-codes `internal`; manual knowledge CRUD requires
  `admin`, always creates/updates `internal` manual rows, and cannot accept an
  audience override. Negative route/RLS tests cover
  anonymous, viewer, cross-account, client-to-internal parameter injection and
  direct internal table/RPC reads.
- `Сырой архив ЭВО`, `Секреты и доступы ЭВО`, WhatsApp originals, Gmail MBOX,
  applicant files and unapproved review notes are rejected at bundle creation
  and absent from runtime storage.
- Gemini credentials stay encrypted in the existing account configuration.
  Logs, reports, bundles, Git and chat output never contain keys, message bodies
  or customer personal data.
- All generated answers are drafts. No endpoint in this slice calls WAHA or
  changes the existing disabled automatic-reply state.

### Assistant API and immutable audit contract

- Existing `POST /api/ai/playground` remains agent-or-higher and accepts only
  `{messages,evaluation_case_id?}`. `messages` contains 1–20 exact objects with
  only `role` (`user` or `assistant`) and trimmed `content` (1–4,000 characters).
  The optional id is only `client_china_documents`; unknown/extra fields return
  HTTP 400. It hard-codes `client` retrieval.
- New `POST /api/ai/internal-assistant` is agent-or-higher and accepts only
  `{message,evaluation_case_id?}` with trimmed `message` of 1–4,000 characters;
  the optional id is only `internal_malaysia_handoff`. It hard-codes `internal`.
  Both success responses contain exactly `reply`, `handoff`, `sources`, and
  `audit_id`; each source has only UUID `chunk_id` and normalized `source_path`.
  Errors contain only `error` and stable `code`, with 400 validation/config,
  401 unauthenticated, 403 insufficient role, 429 limit, or 502 provider/audit
  failure. A generation is never returned if its audit insert fails.
- `ai_assistant_audits` has UUID `id`, required account FK, audience check,
  nullable evaluation-case id restricted to the case matching its audience,
  provider/model text, and non-empty closed JSONB `knowledge_sources`; every
  element has exactly UUID `chunk_id` and normalized `source_path`, chunk ids
  are unique and repeated source paths are allowed. It also has 64-lowercase-hex
  `response_sha256`, boolean
  `handoff`/`success`, required actor FK, `created_at`, and `expires_at` fixed to
  `created_at + interval '90 days'`. It stores no prompt or response body.
  Account agents may SELECT through RLS. `anon`/`authenticated` cannot
  INSERT/UPDATE/DELETE; server routes insert with service role after role checks.
  UPDATE always raises; DELETE raises before expiry. A service-role-only
  `purge_expired_ai_assistant_audits()` deletes only expired rows and returns a
  count. Existing conversation-bound `ai_drafts` remains unchanged.

### Bundle transport and retention

- The builder writes the bundle, manifest and body-free generation report to a
  fresh `mktemp -d` directory under local `/private/tmp`, directory mode 0700
  and files 0600. It never writes them to Git, an Obsidian vault or an image.
- The operator transfers exactly the bundle and manifest over the existing SSH
  host `hermes-vps` into a collision-free
  `/opt/evo-inbox/knowledge-imports/<UTC>-<bundle-sha-prefix>/` directory owned
  by root mode 0700 with files mode 0600. The import id is strict UTC basic time
  plus the first 12 lowercase bundle-SHA characters; no glob is accepted.
  Host SHA and manifest/account/audience are verified before `docker cp` copies
  the two exact files into `/tmp/evo-knowledge-import/<import-id>/` in the exact
  Inbox app container with the same modes. The importer re-verifies before RPC.
- A trap runs on success and failure and removes only the two exact files and
  their now-empty exact staging directory from container, host and local temp;
  cleanup failure makes K5 fail. Bundles never persist in an image or volume.
  Only a root-owned 0600 redacted report containing hashes, counts, statuses and
  no note body remains under `/opt/evo-inbox/evidence/knowledge/`.

### Acceptance and real proof

- Migration/RLS/grant tests prove account and audience isolation, required
  audience filtering and fail-closed invalid values.
- Unit/integration tests use the real local Supabase stack on OrbStack; no mocked
  database/provider result counts as acceptance. UI/build/type/lint checks pass.
- Real vault bundle reports include exact document counts and hashes while
  excluding raw, secrets, hidden controls and symlinks. Repeated import is
  idempotent; a removed managed note is deleted only from its own audience.
- Production proof records image/revision, migration state, managed document and
  chunk counts per audience, retrieval case results, active provider/model,
  auto-reply disabled state and source identities for two real Gemini drafts.
  Fixed committed cases live in
  `scripts/knowledge_ingestion/platform_eval_cases.json`: client case
  `client_china_documents` asks in Russian which China-admission documents to
  prepare and requires exact source `Страны/Китай/Документы для поступления — порядок уточнения.md`;
  internal case `internal_malaysia_handoff` asks in Russian how sales hands a
  Malaysia student to the overseas-education team and requires exact source
  `Процессы/Передача студента из ОП в ОЗО по Малайзии — 68fe88af5a26.md`.
  Both run through authenticated admin playground/assistant routes with synthetic
  non-customer messages, never a real conversation. Each route writes an
  immutable `ai_assistant_audits` row containing account, audience, case id,
  provider, model, closed knowledge sources, response SHA-256, success, actor and
  timestamp but no prompt or draft body. Rows are retained 90 days. The report
  `docs/evidence/evo-platform-knowledge-k5-eval.json` contains only those safe
  fields plus HTTP status, expected-source match, cross-audience-source count
  (must be zero), auto-reply state and send-endpoint-call count (must be zero).
  Draft text and private source contents are neither committed nor logged.
- Any missing credential, migration drift, account ambiguity, provider failure,
  retrieval leakage, unexpected production image, failed CI or release-gate
  conflict stops deployment and is reported plainly.
- Tests also reject symlinked approved/client roots or path components,
  misclassified stable/mutable material, false personal-data review flags,
  email/phone content and unreadable stale candidates with zero mutation.
- Every published client note is Russian, has provenance and is either stable
  owner-approved EVO knowledge or has an official URL plus verification date.
- Actual internal and client vault retrieval checks pass every committed case's
  expected-path-in-top-k assertion and the machine-readable report confirms
  that neither raw nor secrets roots were searched.
- Focused tests pass, an independent reviewer approves the exact PR head, CI is
  green and the final report does not claim a live AI/provider deployment.

### P8D4I deterministic knowledge report correction

Issue #238 corrects only the deterministic knowledge report comparison used by
the production runner. Canonical bundle and manifest bytes must match exactly
across the two builds. The reports must validate as closed objects and match on
all stable fields; only their deliberately different generation time and
temporary output directory are excluded. Reports remain UUID-bearing temporary
validation artifacts and must be removed before deployment under P8D4H. This
does not add provider, production, customer-data or outbound authority.

### P8D4J merged-runner execution control

Issue #239 requires P8D4G to remain blocked after the implementation merge
until a separate reviewed control artifact binds that merged implementation's
commit, tree, exact-main CI and exact runner-file hashes. A production preflight
must additionally prove a clean checkout at current GitHub `main` with green
required checks and record the actual execution commit/tree/CI. This prevents a
later or dirty runner from claiming the earlier reviewed identity and grants no
production authority by itself.

### P8D4K live Inbox pilot fallback correction

Issue #242 corrects the pre-deployment connectivity gate discovered after the
P8D4J control merged. `inbox.evoadmissions.com` currently has no DNS record,
while the already-configured and TLS-valid EVO edge fallback
`evo-inbox.72.62.119.112.sslip.io` reaches the same Inbox application. The two
authorized draft-only staff pilot POSTs must use that exact fallback origin;
all paths, cookie handling, call limits, body-free audit verification,
side-effect checks and rollback rules remain unchanged. This correction makes
no DNS, Caddy, WAHA, Supabase, container, customer-data or candidate change.
Its merged operations hash must be rebound by a separate reviewed execution-
control metadata update before a fresh preflight or production execution.

### P8D4L Hermes preflight source-mode correction

Issue #245 records the first real P8D4G preflight's safe stop before any
provider or production mutation. The corrected preflight keeps the four secret
environment sources at exact `root:root 0600`, accepts only the observed exact
retained Compose modes (CRM `0644`, Inbox `0644`, Lead Agent `0600`), and keeps
regular-file, non-symlink, ownership, path, root-absence and candidate-tag
checks fail closed. The failed result remains preserved. A retry uses the new
collision-free release/evidence identity `2026-08-16.p8d4l.1` and release
version `p8d4l-20260816`.

No candidate, migration, knowledge, secret, Supabase, Gemini, WhatsApp/WAHA,
amoCRM, DNS, Caddy, container or autonomous-reply boundary changes. The
corrected implementation and then its separate execution-control metadata must
each be independently reviewed, merged and green on exact main before a fresh
read-only production preflight.

### P8D4M Hermes container-row protocol correction

Issue #248 records the P8D4L preflight's second safe stop. All five named
production containers were independently observed with their expected images,
healthy state and restart count zero; only the verifier failed because Docker
printed `\t` literally while the parser expected tab bytes. P8D4M uses one
closed literal `|` row protocol with behavioral coverage and advances the retry
to collision-free release ID `2026-08-16.p8d4m.1` and release version
`p8d4m-20260816`.

No application image, migration, knowledge, secret, provider, Supabase,
Gemini, WhatsApp/WAHA, amoCRM, DNS/Caddy, container or autonomous-reply
boundary changes. The verifier fix and its later execution-control rebind must
each pass independent review, merge and exact-main CI before another read-only
production preflight.

### P8D4N optional Docker image Variant correction

Issue #251 records the P8D4M staging stop. The read-only P8D4M preflight was
green, but Hermes omitted the optional Docker image `Variant` key for the exact
`linux/amd64` CRM candidate. Docker's Go template treated the missing key as an
error, so execution stopped before configuration, migrations, knowledge,
deployment or Gemini. All five running production containers remained healthy
on their prior images with restart count zero.

P8D4N parses full inspect JSON and accepts only `linux/amd64` with either an
omitted or empty variant. Any other or malformed platform remains blocking.
The P8D4M failure roots and result remain immutable. The already-loaded exact
CRM source tag may be reused only after its frozen image ID, candidate revision
and `linux/amd64` missing/empty-variant platform verify; the CRM Compose tag and
all Inbox/Lead candidate tags must remain absent. The next attempt uses
collision-free release ID `2026-08-16.p8d4n.1`, release version
`p8d4n-20260816`, and confirmation
`EXECUTE-P8D4N-2026-08-16.P8D4N.1`.

Candidate images, `001-076`, frozen 11/291 knowledge, disabled outbound state,
two staff-only draft pilots, cleanup, rollback and privacy boundaries do not
change. Implementation and its separate execution-control metadata must pass
independent review, merge and exact-main CI before another read-only preflight.

### P8D4O Hermes runtime image identity correction

Issue #254 records the safe P8D4N preflight stop. No staging, configuration,
migration, knowledge import, Gemini call, application deployment, WhatsApp
send or amoCRM write occurred. All five production containers remain on the
prior exact images, healthy, with restart count zero.

The immutable portable identity contains two distinct identities per image:
the OCI index digest used by OrbStack/archive provenance and the selected
`linux/amd64` platform-manifest digest used as Docker's runtime image ID on
Hermes. P8D4O keeps both and checks them at their actual boundaries. Archive
evidence remains bound to the OCI index; Hermes tag/container/importer/deploy
evidence is bound to CRM `34c0f380...`, Inbox `dfc1aae9...`, and Lead Agent
`a50289ff...`. Revision, platform, tag absence, rollback and disabled-state
checks remain mandatory.

The prior P8D4N local failure result is immutable. The next collision-free
identity is release ID `2026-08-16.p8d4o.1`, release version
`p8d4o-20260816`, and confirmation
`EXECUTE-P8D4O-2026-08-16.P8D4O.1`. Implementation and its separate
execution-control metadata must pass independent review, merge and exact-main
CI before another fresh read-only preflight.

### P8D4P named non-root importer correction

Issue #257 records the real P8D4O `knowledge_failed` stop. The exact 11-client
and 291-internal production-account bundles rebuild twice with byte-identical
frozen hashes, so neither the live account identity nor the knowledge vault is
the failure. The isolated Inbox importer was created from exact runtime image
`sha256:dfc1aae9743e2b6bf6d7e174933c36cd89e03e5d769b859f2aaaa557a7a68af3`,
but Docker reports its configured user as the Dockerfile name `nextjs`; the
adapter incorrectly required the literal string `1001`.
That image creates `nextjs:nodejs` with UID/GID `1001:1001` before switching to
`USER nextjs`.

P8D4P must verify both layers: exact `.Config.User=nextjs`, then an actual
container command proving username `nextjs`, UID `1001`, GID `1001`, and a
non-root process. Empty, numeric-only, root, wrong-name, wrong-UID/GID, command
failure, wrong image, platform or revision all fail closed before bundle copy.

P8D4O staging left the exact source and Compose tags for CRM, Inbox and Lead
Agent on Hermes while all running application containers remained unchanged.
P8D4P therefore requires one exact inventory record for each of those six tags,
full image/revision/platform validation, and performs no image load or retag.
It still transfers and verifies the four reviewed portable artifacts under its
new absent release root so the new result remains independently auditable.

The P8D4O local and Hermes failure results remain immutable at SHA-256
`35720cbdc88a9d4407d734c62a10f75f31dcaa6b58d88675a9a25587e1b87ce0`.
The retry uses release ID `2026-08-16.p8d4p.1`, release version
`p8d4p-20260816`, importer name `evo-p8d4p-knowledge-import`, and confirmation
`EXECUTE-P8D4P-2026-08-16.P8D4P.1`. A separate execution-control rebind and
fresh successful preflight are mandatory before requesting the new action-time
confirmation.

### P8D4Q bounded knowledge transfer retry

Issue #260 records the real P8D4P stop. P8D4P completed preflight, exact
candidate staging, rollback capture, disabled configuration and a verified
`001-076` migration no-op. It also resolved exactly one active production
account, rebuilt both frozen 11/291 audiences twice, and verified the isolated
`nextjs|1001|1001` importer. The first client knowledge `scp` failed before a
remote audience pair was recorded. Finally-style cleanup removed every created
local bundle root and the importer; no database import, deployment, restart,
Gemini pilot, WhatsApp send or amoCRM write occurred.

A later read-only diagnostic repeated the real client build and the same two
SSH/SCP transfers without importing. Both remote hashes matched the locally
built bytes and cleanup verified absence. P8D4Q therefore changes only that
transport seam: each of the four unchanged knowledge bundle/manifest `scp`
operations may be attempted at most three times, within the existing operation
deadline. The source path, destination path and bytes cannot change between
attempts. The existing remote and container SHA-256 comparisons remain
mandatory before either import.

The immutable P8D4P evidence remains retained. The retry uses release ID
`2026-08-17.p8d4q.1`, release version `p8d4q-20260817`, importer
`evo-p8d4q-knowledge-import`, and confirmation
`EXECUTE-P8D4Q-2026-08-17.P8D4Q.1`. Independent review, merge, exact-main CI,
a separate reviewed execution-control rebind, fresh successful preflight and
new action-time confirmation are required before execution. No provider,
deployment, send, customer-data, credential or knowledge-content authority is
added.

### P8D4R time-spaced knowledge transfer retry

Issue #267 records the real P8D4Q stop. The run verified preflight, exact
candidate staging, rollback capture, disabled configuration and the
`001-076` migration no-op, then stopped with `knowledge_failed`. Cleanup
removed all four local build roots and the isolated importer. No complete
remote audience pair, database import, application deployment, restart,
Gemini pilot, WhatsApp send or amoCRM write occurred. Its closed local result
is retained at release identity `2026-08-17.p8d4q.1` with SHA-256
`233d69ad88664500354be880e328a1618dffbd646085c08a1f5cb28f4064e90a`.

The later bounded transfer-only diagnostic succeeded with the same live
account resolution, frozen client input, builder, SSH route and exact remote
hash checks, then removed every diagnostic artifact. This proves that a later
transfer can succeed; it does not prove an import or deployment. P8D4R keeps
the same maximum of three attempts per bundle or manifest, but schedules them
at 0, 10 and 40 seconds from the start of that file's transfer sequence. Before
each attempt it recomputes the source SHA-256 and the remaining authorization
time. It must stop before sleeping or copying if the next pause cannot fit, and
must recheck the deadline after the pause. Only the exact `scp` operation has
this behavior; no build, import, migration, deployment, provider or pilot call
gains retries. Node's documented promise-based timer is the implementation
primitive, while `scp` remains the same SFTP-over-SSH command whose nonzero
exit is treated as failure:
https://nodejs.org/api/timers.html#timers-promises-api and
https://man.openbsd.org/scp.1.

The retry advances to release ID `2026-08-17.p8d4r.1`, release version
`p8d4r-20260817`, importer `evo-p8d4r-knowledge-import`, and confirmation
`EXECUTE-P8D4R-2026-08-17.P8D4R.1`. P8D4Q and all prior local/Hermes release,
rollback and evidence roots remain immutable. The exact candidate, six staged
image tags, portable artifacts, 11/291 knowledge contents, `001-076` migration
boundary, disabled outbound state, two-call pilot cap, cleanup, rollback,
privacy, no-WAHA-change, no-amoCRM-write, no-autonomous-send and
no-customer-send boundaries are unchanged. Independent review, merge,
exact-main CI, a separate reviewed execution-control rebind, fresh successful
preflight and a new action-time confirmation are required before execution.

### P8D4S truthful partial knowledge failure evidence

Issue #270 records the real P8D4R stop and the independent review finding. The
P8D4R result is retained unchanged at release identity
`2026-08-17.p8d4r.1`, locally and on Hermes as a regular mode-`0600` file with
SHA-256
`9217322cf48f96daadd8ef780732b8c29cc54e9234bc4c6e2b8ecfbe4c459577`.
It truthfully proves preflight, staging, disabled configuration and the
`001-076 -> 001-076` migration no-op, plus `knowledge_failed`, verified
cleanup, no deployment and no pilot. It does not truthfully preserve partial
knowledge progress: `cleanup.local_roots_removed=4` proves both deterministic
audience build paths created their two independent roots, while
`knowledge.account_resolution`, `knowledge.deterministic_builds` and both
audiences are recorded as `not_run`.

P8D4S makes partial progress part of the closed result contract. The
production adapter reports a UUID-free snapshot after singular account
resolution, after every deterministic audience build, before each transfer
attempt and after each completed audience import. On terminal knowledge
failure the result retains only safe status, document counts, bundle/manifest
SHA-256 values already approved for evidence, a fixed failure-step enum and a
bounded attempt number when the failed step is an `scp` transfer. It never
retains the account UUID, customer/staff content, command text, stderr,
credentials, cookies, provider payloads or private filesystem paths. A
successful result still requires two fully verified database revisions and no
failure marker.

The retry advances to release ID `2026-08-17.p8d4s.1`, release version
`p8d4s-20260817`, importer `evo-p8d4s-knowledge-import`, and confirmation
`EXECUTE-P8D4S-2026-08-17.P8D4S.1`. P8D4R and all prior local/Hermes release,
rollback and evidence roots remain immutable. The exact candidate, portable
artifacts, staged image identities, frozen 11/291 knowledge, migrations
`001-076`, disabled outbound flags, cleanup, rollback, no-WAHA-change,
no-amoCRM-write, no-autonomous-send, no-customer-send and maximum two fixed
staff-only draft calls do not change.

Another production attempt remains blocked until this implementation has an
independently approved exact-head PR, merge and exact-main green CI; a separate
reviewed execution-control metadata PR is merged and green; a new real
read-only preflight passes; and the owner provides the exact new action-time
confirmation. P8D4S grants no new production, provider, customer-data,
knowledge-content, outbound or billed-resource authority.

## P8D4T transfer evidence correction

Issue #273 and Plan Block-ID
`EVO-PLATFORM-P8D4T-TRANSFER-EVIDENCE-2026-08-18` close the final two
read-only review findings before an owner token is requested. Every
client/internal bundle/manifest transfer now distinguishes four safe states:
backoff, authorization deadline, local bytes and the real `scp` attempt. Only
the real `scp` failure may retain an attempt number. The adapter publishes the
UUID-free knowledge progress projection at each retry-state boundary, so a
terminal failure retains the exact safe step rather than an inferred one.

P8D4T uses release ID `2026-08-18.p8d4t.1`, version `p8d4t-20260818`, importer
`evo-p8d4t-knowledge-import` and confirmation
`EXECUTE-P8D4T-2026-08-18.P8D4T.1`. The schema and behavioral tests pin the
new deadline enum, null attempt on every non-`scp` state and ordered progress
callbacks. P8D4S preflight SHA-256
`27bcb7e425b991051c462523414c46091f960f90abe8155cba5beadabbfc3a26`
and every earlier artifact remain immutable.

Candidate images, `001-076`, frozen 11/291 knowledge, disabled outbound state,
cleanup, reverse rollback, maximum two staff-only draft calls, no WAHA change,
no amoCRM access and no customer send remain unchanged. Implementation review,
merge, exact-main CI, a separate execution-control rebind, fresh read-only
preflight, process-only staff-session verification and a new owner token remain
mandatory before execution.

## P8U1 root-owned staff knowledge seam

Issue #278 implements the first repository block under the merged P8U private
single-UI contract. The root CRM owns one protected
`POST /api/platform-ai/staff-assistant` seam for the reviewed `client` and
`internal` audiences and packages the deterministic knowledge importer in the
root candidate. It does not copy, proxy or expose the companion UI.

Auth activation remains deferred, not bypassed. Anonymous, invalid, Finance and
Student actors fail before repository/provider access; only Admin, Sales and
Curator may use the future configured route. Exact organization-to-knowledge
account binding is server-owned, never supplied by a browser. Missing or
conflicting configuration fails closed.

The future enabling set is exact and deliberately absent now: public Supabase
URL plus publishable key for the existing request-scoped Auth client, separate
server secret for knowledge/audit access, configured Platform organization and
knowledge account UUIDs, the Gemini server key and the sole `=1` feature flag.
P8U1 freezes a `65,536`-byte request, `20` turns, `4,000` bytes per text,
`32,000` transcript bytes, five lexical matches, `12,000` excerpt bytes,
`60,000` prompt bytes, a `15,000` ms single Gemini call and `2,048` output
tokens. Success and error bodies are closed; no runtime choice remains.

Retrieval stays audience-scoped and source-bound. A Gemini response remains a
staff-triggered draft, is returned only after body-free immutable audit
storage, and has no send, WAHA, amoCRM, memory-write or autonomous authority.
The root importer preserves the reviewed canonical bundle/manifest/account
contract, materializes 1536-dimensional `gemini-embedding-2` vectors before one
atomic sync RPC, and prints only the UUID-free safe result projection. It
requires the CLI account to equal `EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID` and caps
work before Gemini at 16 MiB bundle, 16 KiB manifest, 512 documents, 256 KiB
per document, 12 MiB total content and 8,000 chunks.

P8U1 is repository-only. Tests inject local seams and make no provider or
production calls. Independent exact-head review, 4/4 CI, merge and exact-main
CI are mandatory before P8U2 may build the private `linux/amd64` candidate.

## P8U2 private root candidate

Issue #280 and `docs/platform/p8u2-private-root-candidate.md` freeze the next
repository/local-only block. The application identity is P8U1 merge
`b798c7d36be8e3325a9621d96e496ec0a2bb624f`, tree
`eb3a8a863e014606e707bd279f67d9194663e30a`, parent
`42dc877b6ce3a2c5c8f7f42c6adc192399322d07`, with successful exact-main CI
`32072948258`. P8U2 produces exactly one private root image tagged
`evo-crm:b798c7d36be8e3325a9621d96e496ec0a2bb624f-p8u2-linux-amd64` on OrbStack.

The reviewed runner must prove exact `linux/amd64` identity, OCI labels,
non-root execution, a fresh image-bound SPDX SBOM, network-none liveness and
the exact `503 assistant_disabled` staff-route response with Auth and enabling
configuration absent. All evidence stays under a new local mode-`0700` ignored
root with a closed result schema and mode-`0600` files. Provider credentials,
customer data and external networks are absent.

P8U2 stops after independent evidence review. It does not transfer, route,
deploy or expose the image and does not mutate production or providers. Later
Auth activation still requires real Supabase URL/publishable key, authority,
sign-in, RLS/object-scope, refresh and logout proof, followed by a separate
release contract, fresh preflight and owner token.

## P8U3 canonical SPDX namespace correction

Issue #282 and `docs/platform/p8u3-spdx-namespace-correction.md` preserve the
failed P8U2 evidence and local image unchanged. The sole observed blocker was
the standard Syft UUID in top-level SPDX `documentNamespace`; no secret,
contact, private path, provider, database or production effect occurred.

P8U3 adds only an exact image-bound namespace exception while retaining the
untouched credential/private-path scan and rejecting every other or duplicate
UUID. A collision-free P8U3 tag/container/evidence root permits one new private
OrbStack build only after review, merge and exact-main CI. All no-Auth,
network-none, no-provider and no-production boundaries remain unchanged.

## P8U4 root staff-assistant proxy correction

Issue #284 and `docs/platform/p8u4-root-assistant-proxy.md` preserve the
immutable P8U2 and P8U3 stopped attempts. P8U3 proved that the reviewed route
handler was unreachable in the real candidate because the root proxy returned
the generic disconnected-API `403` before the handler could return its exact
disabled `503` contract.

P8U4A connects only `/api/platform-ai/staff-assistant` to its existing repeated
configuration, same-origin, actor, role, organization, retrieval, provider and
audit checks. Auth and the enable flag remain absent, so the expected behavior
is still fail-closed before actor, database or provider work. Descendants,
siblings and every unrelated disconnected API stay blocked.

P8U4A is repository-only. After its independently reviewed merge and green
exact-main CI, a separate P8U4B contract must freeze the new application
commit/tree/parent/CI and collision-free local candidate identities. Only then
may one new private OrbStack `linux/amd64` candidate attempt run. No production,
provider, customer-data, import, routing, Auth activation or deployment
authority is granted.

P8U4A is now merged as `93d07740e15b05067af31b4aa03c865b6b1cebda`,
tree `6ef0aea5eedaa26bd4d7de857bfa9bee9ff4e888`, parent
`a63236838964542f712639aae83597747fee639f`, with successful exact-main CI
`32081894062`. P8U4B freezes that exact application source and a new private
tag/version/container/evidence root. It must verify the immutable P8U2 and
P8U3 roots, file hashes, tags and image IDs before and after every effect.

The one permitted post-merge P8U4B attempt remains local to OrbStack, builds
`linux/amd64`, uses immutable-image SBOM and network-none UID/GID-1001 smoke,
and proves `/api/health` plus exact `503 assistant_disabled`. It does not enable
Auth, import knowledge, call Gemini, transfer or deploy an image, change public
routing, access customer data, or mutate Supabase, WAHA, WhatsApp or amoCRM.
Smoke injects only the exact P7B observability enabled flag and a fresh random
process-only HMAC required for startup; the HMAC is never retained, and all
staff-assistant/Supabase/Gemini/WAHA/amoCRM settings remain absent.

## P8U single-UI private preparation

Issue #276 and `docs/platform/p8u-single-ui-private-preparation.md` supersede
P8D4T as the active next block. The owner deferred Auth activation and asked to
prepare the product first. Preparation means repository implementation and a
private candidate; it does not mean a public unauthenticated CRM.

The accepted root EVO CRM remains the sole Platform UI. P8U ports only the
remaining staff knowledge-assistant/importer capability still owned by the EVO
Inbox companion into the root Platform boundary, then builds a private
`linux/amd64` root candidate. It does not embed, proxy or revive the companion
as a second UI. The current public CRM, companion Inbox, Lead Agent, WAHA,
amoCRM, managed Supabase data, knowledge revisions, Gemini and outbound state
remain unchanged.

P8D4T's preflight is retained as no-effect evidence, but its action-time token
is retired because the candidate and release contract change. A later Auth
block must configure and prove the real Supabase sign-in/authority/RLS path.
Only a new reviewed release contract, fresh preflight and new owner token may
then authorize production mutation.

## P8V v1 production closure

Issue #287 and `docs/platform/p8v-v1-production-closure.md` supersede local-only
P8U preparation as the active rollout contract. The read-only baseline confirms
that repository capability is substantially ahead of Hermes: production CRM,
Inbox and Lead Agent images are old; root Platform/Auth/Gemini configuration is
absent; managed knowledge is only 2 internal documents / 26 chunks with no
bundle revision or assistant audit; amoCRM has no runtime token; and the
durable manual-send authorization has no real sending worker.

P8V closes the engine first, then freezes production artifacts/config/rollback,
deploys one application boundary at a time and finally proves the real staff
journey. The frozen public seams preserve Lead-Agent-owned WAHA intake with
amoCRM-first identity and signed CRM sync, durable manual-send execution,
protected staff-assistant HTTP route, authenticated browser workflow and
redacted reconciliation evidence. The only manual-send trigger owner is the
private `evo-crm-manual-send-worker` Compose service from the reviewed CRM
image: one in-flight claim, five-second cadence, ten-second route deadline,
thirty-second heartbeat health and a dedicated process-only HMAC. Pre-route
transport failure affects only sidecar health; the CRM transaction alone owns
durable claim/lease state, and a lost response is recovered through lease
expiry plus reconciliation. Real services are mandatory for live
claims; an unavailable independent boundary is recorded and skipped rather
than replaced by a mock or weakened credential contract.

The start identity is main `8dfeb7b8cc85588b1d886e61fb843a14122f5b16`,
tree `879c9fcdedca442c1bad750ae485f850aa8c5e90`, parent
`93d07740e15b05067af31b4aa03c865b6b1cebda`, exact-main CI
`32084838298`. P8U4 evidence remains immutable preparation evidence. Every P8V
implementation/release block still requires independent PR review, exact-head
and exact-main CI, closed evidence, safe rollback and a fresh action-time
production gate. Autonomous/customer sending remains disabled; only one later
owner-approved non-customer manual-send proof is in scope. Production authority
remains closed until the exact four P8V Draft 2020-12 result schemas and runtime
validators merge; success requires complete ordered records, while blocked or
failed evidence permits only a truthful prefix with no later effects.

### P8V2 exact production-preparation slice

Issue #290 advances only Block V2 from the merged core-engine application
commit `0f1454d014bbc9eca9d7381dfe557e980965543e`, tree
`19599bcf043dc4a555c8996c21e7801934b64633`, parent
`a7c589c2c735d4ef2d15ab5153eb07dba07d6286`, and exact-main push run
`32093566626`. The three immutable local linux/amd64 source tags are
`evo-crm:0f1454d014bbc9eca9d7381dfe557e980965543e-linux-amd64`,
`evo-inbox:0f1454d014bbc9eca9d7381dfe557e980965543e-linux-amd64`, and
`evo-lead-agent:0f1454d014bbc9eca9d7381dfe557e980965543e-linux-amd64`. Their image,
OCI-index and platform-manifest identities are observed only after the reviewed
OrbStack build and then frozen into the implementation/result schema.

V2 preserves the five current production containers and seven exact
Compose/env sources recorded in the active P8V contract. It prepares three
portable archives, rollback/config capture, migration/config identity proof,
and deterministic production-account-bound bundles from the unchanged
11-client/291-internal vaults. A missing current credential or singular
account/organization proof blocks only the dependent record; independent image,
rollback and vault-integrity work continues and is retained as component
evidence. The final V2 result is `preparation_verified` only when every ordered
record, including final evidence publication, is verified. A normal prerequisite
gap is `preparation_blocked`; an atomic-write, privacy, graph or cleanup failure
is the distinct `evidence_failed` result. Both are truthful prefixes, contain no
later effect, and grant no V3 authority.

The observed production configuration does not currently satisfy the new
Platform contract: root CRM lacks the new publishable/secret Supabase keys,
organization/account, Gemini, staff-assistant and worker settings, and Lead
Agent lacks its configured amoCRM token file/OAuth refresh material. Legacy
anon/service-role JWTs are not substituted. V2 may prove and report these
absences but may not create, rotate, print or weaken credentials. There is no
image transfer, database migration/import, provider call, container change,
restart, WAHA/amoCRM mutation, customer send or public-route change in V2.

### P8V2 final frozen-vault path correction

Issue #294 corrects the local source binding before the first V2 execution.
The obsolete `EVO_Knowledge_Vault` paths are not valid inputs. The exact
read-only frozen sources are:

- client: `/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Клиентская база знаний ЭВО` (11 Markdown documents);
- internal: `/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Внутренняя база знаний ЭВО/Утверждено для внутреннего ИИ` (291 Markdown documents).

Each source must be a real non-symlink directory and must pass the existing
canonical `.evo-vault.json`, path, PII and forbidden-root checks before any
bundle is accepted. The vaults remain read-only. This correction changes no
candidate, evidence, authorization, production, provider or rollout identity;
the merged P8V2 preparation token remains unconsumed until the correction is
reviewed, merged and green on current main.

### P8V2 executable CLI import correction

The first exact-main P8V2 invocation on `2a34408d115fa1daa94b85c5b419e453d73a18d5`
stopped before any preparation operation because the executable module
dynamically imported the operations module while that module imported the
still-evaluating preparation library. Node reported an unsettled top-level
await. No evidence root, candidate tag, Docker build, SSH call, provider call,
database call, migration, knowledge import, deployment, restart, WAHA action,
amoCRM action or customer-data action occurred; the P8V2 preparation
authorization is unconsumed.

Issue #296 separates the executable CLI from the pure preparation library and
keeps the existing `npm run p8v2:prepare -- --application-root <path>` operator
interface. The CLI statically imports the acyclic library and operations graph.
A real child-process negative must prove missing authorization returns the
closed `p8v2_failed:operation_failed` result with exit status `2` and never
emits the unsettled-await warning. The correction must pass independent review,
exact-head CI, merge and exact-main CI before the same collision-free P8V2
preparation may be retried. All P8V2 authority and evidence boundaries remain
unchanged.

### P8V2A nested OCI-index retry

The first effectful P8V2 preparation stopped safely at candidate-image
verification after producing only local CRM build/SBOM/smoke/archive artifacts.
The immutable failure result SHA-256 is
`c57ffdd2b572d42d52c5106f7c926dbd89596690f557e4113e45cdd494110c1b`;
no production, provider, database, knowledge, deploy, restart, WAHA, amoCRM or
customer-data operation ran.

Issue #298 corrects the portable verifier for the current Buildx archive graph:
the tagged top-level descriptor is an OCI index containing one linux/amd64 image
manifest and one exactly bound provenance attestation. The retry keeps the
frozen application and production contract but advances every writable identity
to P8V2A: release `2026-08-18.p8v2a.1`, version
`p8v2a-0f1454d0-20260818`, authorization
`PREPARE-P8V2A-2026-08-18.P8V2A.1`, `-p8v2a-linux-amd64` tags/archives,
`p8v2a-` local evidence roots and a `p8v2a-rollback-` remote root. Historical
P8V2 evidence and its CRM tag remain immutable. Retry requires independent
review, merge, exact-main green CI and a fresh exact owner token.

### P8V2B bounded Lead Agent smoke readiness retry

The exact P8V2A preparation on merged main
`df29599da8ca7f85354f233c6333d5e018d94977` stopped safely in
`candidate_images` with result SHA-256
`cc902099b2864327897ca278d656f5180c81235cfb0b71f2b1ffb0b5a6401acc`.
All three local images built; CRM and Inbox completed smoke, SBOM and archive;
Lead Agent completed build and SBOM but stopped before smoke/archive. Production
baseline, SSH, migration, identity resolution, knowledge build/import, provider,
deployment, restart, WAHA, amoCRM and customer-data operations were `not_run`.
Every P8V2A root, artifact and tag is immutable.

A real isolated diagnostic against the retained immutable Lead Agent image
proved that the image is healthy but its HTTP process is not ready at the
runner's immediate first probe. It returned the exact frozen response after
approximately one second. Issue #300 changes only the release-tool readiness
seam: Lead Agent smoke polls at most 30 times, waits 500 milliseconds between
failed attempts, and accepts only HTTP 200 with exact JSON
`{"frozen":true,"ok":true,"ready":false,"status":"live"}`. Each probe has a
one-second request timeout. Any response drift, container exit, deadline
exhaustion, Docker/context drift, restart, ownership drift or cleanup failure
remains blocking. CRM and Inbox retain their existing exact smoke contract.

P8V2B is collision-free: release `2026-08-18.p8v2b.1`, image version
`p8v2b-0f1454d0-20260818`, authorization
`PREPARE-P8V2B-2026-08-18.P8V2B.1`, tags/archives suffixed
`-p8v2b-linux-amd64`, local roots prefixed `p8v2b-`, and remote rollback root
prefixed `p8v2b-rollback-`. It adds no production/provider/import/deployment
authority. Retry requires reviewed implementation, exact-head CI, merge,
exact-main CI and a fresh exact owner token.

### V2.6 P8V2C read-only production-baseline template correction

P8V2B retained all three verified local candidates but stopped before any
production effect. Its immutable mode-0600 result SHA-256 is
`855ed075be872550322d273f9fb36da0dffccec39b9331e921579e704399779d`.
The five real production containers still match their exact frozen IDs/images,
are healthy, and have restart count zero. The blocker is solely the invalid
read-only Docker Go template used to collect those rows.

P8V2C replaces that template with Docker's supported inline `if/else/end`
actions. One shared producer renders the byte-checked production command and a
real local five-container OrbStack fixture in canonical order. One guarded
executor checks OrbStack `Running` and context exactly `orbstack` immediately
before every Docker command, including cleanup; no fallback is allowed.
Fixtures use collision-free names, a cryptographic owner label, one already-present immutable
image ID, no network/mount/restart/pull, and verified-ID finally cleanup with
foreign-name refusal and absence proof. It advances every writable retry
identity to `p8v2c` / `2026-08-18.p8v2c.1` /
`PREPARE-P8V2C-2026-08-18.P8V2C.1`; P8V2B evidence remains immutable. It
changes no application candidate, production boundary, provider permission or
deployment authority. A retry is blocked until implementation review, exact-head
CI, merge, exact-main CI and the new exact token required after this code change.

### V2.7 P8V2D CRM/Inbox smoke readiness correction

P8V2C retained fail-closed result SHA-256
`b22ab4614f893a0577d42976612e00cc4b74466886d27c31cf49f03d41642c2a`.
It stopped during candidate images before any production baseline or later
phase. The exact Inbox image subsequently passed six real OrbStack smoke
starts, proving an initial cold-start timing defect in the single immediate
CRM/Inbox health probe.

P8V2D keeps the exact health response contract and adds at most 30 probes with
a one-second request timeout and 500-millisecond waits only for the explicit
transient connection/startup result. Exact owned container/image/running state
is rechecked before every probe. Wrong HTTP/JSON, exit, identity, ownership,
restart, OrbStack/context, exhaustion or cleanup drift stays fail-closed. All
writable retry identities advance to `p8v2d` /
`2026-08-18.p8v2d.1` / `PREPARE-P8V2D-2026-08-18.P8V2D.1`; P8V2C evidence is
immutable. No production/provider/import/deployment authority is added.

### V2.8 P8V2E independent-readiness supplement

P8V2E preserves the immutable P8V2D result SHA-256
`a050cd16b1d48fa089031bc3a4240b8e55f3b492c89addc7376d8016de5e63b7`,
all P8V2D roots/tags and the Hermes rollback root. It performs no candidate
build, smoke, SBOM, archive, rollback capture or production effect.

The supplement closes the P8V2D evidence gap with four independent read-only
records: exact retained-result validation; UUID-free source-vault validation
for frozen client `11` / source-set SHA
`c8dcfdd7911fdf2b97204c5d843dbf45f701d5dbee72e78cfaea17ea7ab18689`
and internal `291` / source-set SHA
`1bd7458ff70c0a31fde9f6bb1abfb7ec0152c1f286caf2a1de48081860121f9f`;
schema-qualified bounded identity observation through the Supabase Management
API read-only SQL endpoint; and UUID/value-free configuration observation.
Missing identity or settings remain blockers, but cannot suppress independent
vault/configuration evidence. No account-bound bundle is built unless the live
account is singular; no identity is invented.

Source-set bytes are the source-path-sorted array of exact
`{source_path,source_sha256}` records, using NFC POSIX-relative paths,
lexicographically sorted keys, UTF-8 JSON with `ensure_ascii=false`, compact
comma/colon separators and one final LF. Management API verification requires
separate exact-project HTTP 200/`ACTIVE_HEALTHY` and read-only-query HTTP 201
responses. The bounded official project object is validated through exact
`ref` and `status` fields; unrelated official fields are ignored. Any singular
UUID reaches Hermes only through bounded three-line SSH stdin to one fixed
`bash -seu` command; output/evidence remains UUID-free. Malformed/duplicate env
input, unsafe amoCRM token files and remote transport/parse failure have closed
blockers. Retained-result,
source-vault, identity/project and configuration drift each has a closed
`readiness_blocked` code; only unsafe result publication/removal is
`evidence_failed`.

The only writable path is a new local mode-`0700`
`p8v2e-readiness-0f1454d014bbc9eca9d7381dfe557e980965543e-20260818`
root containing one closed-schema mode-`0600` result. Authorization is exactly
`PREPARE-P8V2E-2026-08-18.P8V2E.1`. It grants no Docker, SSH write, migration,
import, provider, deployment, restart, WAHA/amoCRM, outbound, Auth or
customer-data effect. After reviewed merge and exact-main CI, one P8V2E run may
precede the single minimal production preflight and one deployment-plus-rollback
authorization.

### V2.9 P8V2F Supabase connection and first-organization bootstrap

The reviewed P8V2E result and a fresh 2026-08-19 read-only audit establish one
healthy managed project, one Auth user, one active knowledge account, zero
Platform organizations, a contiguous production ledger through `076`, and a
Data API configuration that exposes only `public,graphql_public`. Hermes has a
real root-owned mode-`0600` `/opt/evo-crm/.env.production`, but none of the
Platform Supabase settings are present. This is a missing Platform connection,
not a reason to create or migrate to a second Supabase project.

P8V2F is one bounded configuration operation. It may add `platform` to the
existing PostgREST exposed-schema set while preserving `public` and
`graphql_public`; call the existing service-role-only,
advisory-lock/idempotency/audit protected
`platform.bootstrap_organization_admin` routine exactly once for organization
name `EVO Admissions` and the singular existing Auth user; and atomically add
only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`EVO_PLATFORM_SUPABASE_SECRET_KEY`, `EVO_PLATFORM_ORGANIZATION_ID`, and
`EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID` to the existing Hermes CRM environment.
The secret and both UUIDs are process-only and enter Hermes only through SSH
stdin. They never enter argv, stdout, stderr, Git, PR text or retained safe
evidence.

Before effects, require exact project health, exact pre-state cardinalities,
exact `001-076` migration ledger, exact current PostgREST configuration, valid
new-format publishable/secret keys, successful bounded project-URL probes for
both keys, and a safe Hermes environment source. Every HTTP body is streamed
under its fixed byte ceiling rather than buffered before the limit. The
remote write first captures the exact original environment in a new
Hermes-only root-owned mode-`0700` rollback root, then uses a temporary regular
mode-`0600` file plus atomic rename and verifies exact values in process. A
remote write failure restores and verifies the original bytes. P8V2F does not
apply migration `077`, import knowledge, deploy/restart a container, enable the
staff assistant, enable manual-send/lead-sync/autonomous behavior, call Gemini,
touch WAHA/amoCRM, or send customer/outbound data.

Post-state must prove one active `EVO Admissions` organization, one Admin
membership linked to the same singular Auth user, one bootstrap audit event,
one active knowledge account, `platform` Data API access through the secret
server key by deterministic replay of the service-role-granted bootstrap RPC,
unchanged `001-076` migration ledger, and the five exact Hermes
settings. Evidence is one closed-schema, UUID/secret/private-path-free JSON in
a new local mode-`0700` root with a regular mode-`0600` result. Failure after
the database bootstrap is reconciliation-required rather than destructive
database rollback. The exact action-time token is
`CONFIGURE-P8V2F-2026-08-19.P8V2F.1`; implementation review, exact-head CI,
merge and exact-main green CI must precede its use.

An exact already-prepared database state is a supported reconciliation entry:
the runner revalidates the same Auth user, account, organization, Admin,
bootstrap audit and deterministic RPC result, skips the PostgREST patch and
creation effect, then completes or verifies Hermes and evidence. The rollback
copy must reconstruct the current configured environment exactly when the five
target settings are reapplied; any tamper or failed read-back restoration is
blocking. Publication failure is a distinct `evidence_failed` terminal attempt,
not a configuration success or a swallowed error.

### P8V2G — bounded PostgREST readiness correction

The first authorized P8V2F attempt is complete and failed closed. Preserve its
exact result SHA-256
`706dc7f9cdfb88b383a0e6e3314925bfdec7fe741f74acbfcbb700fdb7eddf6c`,
its local and remote roots, and its consumed token. The retained result and
fresh read-only checks prove the old exposed schemas were restored and no
database identity, Hermes setting, migration, import, deployment, restart,
provider or outbound effect occurred. Supabase logs show the only runtime
blocker: the first Platform RPC received HTTP `406` while the newly accepted
schema exposure had not yet propagated to PostgREST.

P8V2G adds no feature and changes no production target. After the official
Management API returns the exact requested schema set, the bootstrap seam may
make at most 12 byte-identical deterministic RPC attempts under one 30-second
readiness deadline, waiting exactly 1 second only after a bounded valid JSON
HTTP `406` whose exact PostgREST code is `PGRST106`. No other status/code,
malformed/oversized body, timeout or transport error is retryable. Every such
failure immediately enters the existing potentially-committed readback before
any restoration. Exhaustion is blocking and cannot reach Hermes.

All writable identities advance to collision-free P8V2G values, including
authorization `CONFIGURE-P8V2G-2026-08-19.P8V2G.1` and new local/remote result
roots. Issue #309, behavioral negative coverage, independent review,
exact-head and exact-main green CI, and a final read-only preflight must precede
the new owner token. P8V2G retains P8V2F's singular Auth/account checks,
`EVO Admissions` application organization, migration `001-076`/pending `077`,
project-key probes, process-only UUID/secrets, Hermes atomic write/rollback,
closed evidence and zero unrelated effects.

## P8V2H: explicit PostgREST reload

P8V2G is an immutable failed attempt with result SHA-256
`63049414f61ba895e20ebf5900d2badcf0b306635f574fad7fddb77aebc89514`.
Independent review proves restored original schema exposure, zero Platform
identity rows, zero Hermes settings and zero unrelated effects. Its token is
consumed.

P8V2H adds one fixed cache-reload operation after every successful PostgREST
schema PATCH: official Management API `POST /v1/projects/{ref}/database/query`
with exact parameter-free SQL `NOTIFY pgrst, 'reload config'; NOTIFY pgrst,
'reload schema';` and exact `read_only: false`. Only bounded valid JSON HTTP
`201` is accepted. No caller-supplied SQL or additional statement is possible.
The reload must complete before the first deterministic bootstrap RPC attempt.
When zero-state rollback restores `public,graphql_public`, the same fixed reload
must complete before restoration is reported.

All P8V2G request-byte, PGRST106-only retry, deadline, ambiguous-response
readback, prepared-state replay, Hermes rollback, evidence, privacy and
zero-unrelated-effect boundaries remain. P8V2H advances only collision-prone
version/token/evidence/temp identities to `p8v2h` and requires issue #312,
independent review, exact-head/exact-main green CI and a fresh read-only
preflight before the exact token `CONFIGURE-P8V2H-2026-08-19.P8V2H.1` may be
requested.

## P8V3: one-boundary first-version production rollout

Tracking issue: #314.

P8V3 deploys the already reviewed application candidate
`0f1454d014bbc9eca9d7381dfe557e980965543e` without rebuilding it. One
temporary 30-minute preflight verifies the exact three portable archives and
their OCI index/platform identities, exact candidate Compose rendering on
OrbStack, required production secret names without values, production ledger
`001-076`, five exact healthy zero-restart containers, network/disk readiness
and the exact retained P8V2D rollback collection. The rollout retains the
preflight SHA-256 and requires identical execution commit/tree/CI plus
unchanged volatile container/ledger state before its first effect.

One 90-minute authorization `EXECUTE-P8V3-2026-08-20.P8V3.1` covers ordered
configuration installation and rollback, migration `077`, deterministic
11-client then 291-internal knowledge publication, knowledge-artifact cleanup,
and one-at-a-time CRM, Inbox and Lead Agent recreation. CRM includes the
manual-send worker; Inbox supplies the audited staff knowledge route; Lead
Agent keeps autonomous reply and outbound disabled. Both WAHA containers must
retain their exact container/image identities and are never recreated,
restarted or reconfigured.

The account UUID is resolved singularly and remains process-only except for
the immutable importer's transient matching `--account-id` process argument.
The two allowed Gemini embedding operations contain only frozen approved
knowledge; no applicant/customer content, staff draft call, amoCRM write,
WhatsApp send or WAHA mutation is authorized. UUID-bearing local, remote and
container knowledge artifacts are finally-cleaned before CRM deployment and
on every failure path.

A failed application boundary is included with all earlier attempted
boundaries in reverse rollback. Configuration is restored before old
application Compose is recreated from exact retained config/image bytes.
Migration `077` and completed knowledge imports are forward-only and make
later failures reconciliation-required even when application rollback
succeeds. A lost migration response with exact ledger readback `001-077` is
retained as `observed_applied`, never `not_run`. The single final result is
closed-schema, UUID-free, secret-free and
uses only `rollout_verified`, `rollout_failed_rolled_back`,
`rollout_failed_reconciliation_required`, or `evidence_failed`. Real login,
WhatsApp intake, amoCRM binding, retrieval/draft, manual approval/send, ACK and
audit verification belong to the post-deploy V4 staff proof.

### P8V3A final-preflight Compose env correction

The first final P8V3 preflight made no production or provider change and
stopped during disposable local candidate Compose validation. The validator
did not bind the Compose selector for the newly reviewed manual-send worker,
so Compose searched the archived application tree for the intentionally absent
default `.env.manual-send-worker`.

The only authorized correction is to add a disposable regular mode-`0600`
validation env for that service and pass its path through exact variable
`EVO_CRM_MANUAL_SEND_WORKER_ENV_FILE`, alongside the existing five validation
env selectors. The file carries only the inert local validation marker and is
removed with the existing temporary validation directory in the same
finally-style cleanup. All P8V3 candidate identities, release effects,
rollback rules and the exact owner authorization remain unchanged. A fresh
read-only preflight after reviewed merge and exact-main green CI is mandatory.

### P8V3B inert Inbox Compose build-value correction

The next fresh preflight also made no production or provider change and stopped
during disposable local candidate Compose validation. After P8V3A supplied the
manual-worker env selector, the archived Inbox Compose reached its required
public build-variable checks and correctly rejected the empty disposable env.

The only authorized correction is to populate the disposable mode-`0600`
Inbox validation env with fixed inert non-secret values for
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`NEXT_PUBLIC_SITE_URL`. The URLs use the reserved `.invalid` domain and the key
is an explicit non-credential sentinel. They are used only by local
`docker compose config -q`, are removed in the existing finally path, and may
never be used to build, run, deploy, reach Supabase, or enter evidence. All
P8V3 candidate identities, release effects, rollback rules and the exact owner
authorization remain unchanged. A fresh read-only preflight after reviewed
merge and exact-main green CI is mandatory.

### P8V3C canonical production container-name correction

The next fresh preflight also stopped before every release effect. Its remote
read-only inventory confirmed the exact expected images, networks, healthy
states and zero restart counts, but Docker inspect rendered `.Name` with its
API-leading slash while the closed verifier correctly expected the canonical
unprefixed Compose container name.

The only authorized correction is for the inventory producer to emit the
already fixed shell-loop name as the first field and use Docker inspect only
for the immutable container ID, image ID, health, restart count and networks.
The parser remains strict and must reject slash-prefixed or otherwise drifted
names. All candidate identities, production effects, rollback rules, provider
boundaries and the exact owner authorization remain unchanged. A fresh
read-only preflight after reviewed merge and exact-main green CI is mandatory.
### P8V3D — resume from the forward-only migration-077 boundary

The first P8V3 execution is immutable failed-attempt evidence at SHA-256
`d38283828f3b2d51c063e85617b6732be7a2a44f4cb00bd36d2aaa8051467db7`.
Production reconciliation proves migration ledger `001-077`/count `77`, the
original five containers healthy with restart count zero, restored CRM
configuration, no release root, no imports and no deployment/provider effects.
The retained rollback root `/opt/evo-release-rollback/2026-08-20.p8v3.1` is
preserved byte-for-byte.

P8V3D corrects only the validator/reconciliation seam. A fresh preflight must
accept exactly `001-077`. The rollout migration step is a read-only verified
no-op: it revalidates the exact contiguous ledger and migration-077 database
objects/grants and records before/after `001-077`, count `77`, with no applied
version. It must not run Supabase link, dry-run, push, SQL, or migration repair.
All later import, cleanup, deployment, rollback and safety boundaries are the
same as P8V3.

The collision-free runtime identity is release `2026-08-20.p8v3d.1`, version
`p8v3d-0f1454d0-20260820`, importer `evo-p8v3d-knowledge-import`, evidence root
`/opt/evo-release-evidence/p8v3d-20260820.1`, and final result
`p8v3d-rollout-result.json`. After reviewed merge, final CI and one fresh
preflight, the only valid new owner authorization is
`EXECUTE-P8V3D-2026-08-20.P8V3D.1`. The old P8V3 token is consumed.

### P8V3E — public knowledge schema and idempotent pre-stage cleanup

The P8V3D execution stopped at `client_import` with immutable result SHA-256
`d6c7174de9a56d53e9c30d498a1423cb3ad698869c1845155934d826fa90cfc3`.
Read-only reconciliation proves no client revision/document/chunk was written,
configuration was restored, staging/importer are absent, the migration ledger
remains exact `001-077`, and all five production containers are unchanged and
healthy with restart count zero.

P8V3E corrects only two coupled seams. Account resolution and bundle-revision
verification use exact PostgREST schema `public`, matching migrations 029 and
074. Cleanup treats an absent not-yet-created staging directory/importer as
verified clean, while continuing to block every unsafe replacement, remnant or
removal failure. Behavioral tests bind the exact request profile and the
pre-stage failure cleanup.

The retry advances to release `2026-08-20.p8v3e.1`, version
`p8v3e-0f1454d0-20260820`, importer `evo-p8v3e-knowledge-import`, evidence root
`/opt/evo-release-evidence/p8v3e-20260820.1`, result
`p8v3e-rollout-result.json`, preflight `p8v3e-production-preflight/v1`, and
authorization `EXECUTE-P8V3E-2026-08-20.P8V3E.1`. The P8V3D token is consumed.
Candidate bytes, frozen knowledge, migration no-op, ordered deployments,
rollback and provider/customer-effect boundaries remain unchanged.

### P8V3F — verified process-only Gemini key retry

The owner-authorized P8V3E attempt is immutable failed-attempt evidence with
result SHA-256
`328dd56efc616b1492b42c399651733186a5167e8214798b8e21eef5f60fa185`.
It stopped at the client knowledge embedding request with Gemini HTTP `429
RESOURCE_EXHAUSTED`. The atomic knowledge sync RPC was not called: live
read-only reconciliation proves zero client revisions/documents/chunks, the
existing two internal documents/26 chunks unchanged, migration ledger
`001-077`, restored configuration, no application/WAHA recreation, no amoCRM
write, no WhatsApp send and no staff draft call. The P8V3E release, rollback
and evidence roots remain immutable and its authorization is consumed.

P8V3F changes only the knowledge-import helper, Gemini credential delivery and
its readiness proof. The
owner-approved working key is accepted from exact process-only environment
name `GEMINI_API_KEY` through the encrypted Personal Secrets Vault. It is
forbidden in Git, CLI arguments, local plaintext files, stdout, stderr and
retained evidence. The final short preflight makes exactly one neutral
`gemini-embedding-2` request with output dimension `1536` and one neutral
structured `gemini-3.5-flash` request. Neither request contains knowledge,
customer, applicant or staff content; neither retries. Only closed boolean
success evidence is retained. Any HTTP, timeout, response-shape or vector
drift blocks before production effects.

The reviewed import helper removes the unsupported Embedding 2 `taskType`
field and formats every document chunk as exact `title: {title} | text:
{content}`, as required by current official Embedding 2 retrieval guidance.
The final execution checkout builds this single bundled importer twice;
byte-identical SHA-256/size become part of preflight evidence. Execution
rebuilds the same artifact, requires exact equality to preflight, transfers it
to the new release root, verifies its bytes in the importer container, and
uses only that immutable helper for both audience imports. The three deployed
application images remain unchanged.

During configuration the same process-only key is delivered over fixed SSH
stdin, never argv, and atomically replaces both `GEMINI_API_KEY` in the Lead
Agent root-only environment and `EVO_PLATFORM_GEMINI_API_KEY` in the CRM
root-only environment. Exact pre-change bytes for both files and the existing
manual-worker prestate are retained under the new rollback root. Any later
failure restores and read-back verifies both original environment files plus
the worker prestate before reporting rollback success. On rollout success the
new key remains only in those root-owned mode-0600 production secret files.

Writable identities advance collision-free to release
`2026-08-20.p8v3f.1`, version `p8v3f-0f1454d0-20260820`, importer
`evo-p8v3f-knowledge-import`, evidence root
`/opt/evo-release-evidence/p8v3f-20260820.1`, result
`p8v3f-rollout-result.json`, preflight `p8v3f-production-preflight/v1`, and
authorization `EXECUTE-P8V3F-2026-08-20.P8V3F.1`. Issue #331, one independent
review, one final CI, one fresh minimal preflight and the new exact owner token
remain mandatory. All application/image, frozen 11-client/291-internal
knowledge, migration-no-op, ordered deployment, provider/customer-send,
rollback and privacy boundaries are otherwise unchanged.

### P8V3F — Gemini 3.5 Flash readiness budget correction

The first real P8V3F preflight proved the new process-only credential can
produce the exact 1536-dimension `gemini-embedding-2` vector, then stopped
before effects because the neutral `gemini-3.5-flash` response exhausted the
old 32-token ceiling during default medium thinking and returned truncated
non-JSON. P8V3F therefore keeps the same collision-free release and unconsumed
authorization identity while correcting only that no-effect readiness call.

The draft request must use exact `thinkingConfig: { thinkingLevel: "MINIMAL" }`
and `maxOutputTokens: 128`; it must omit explicit `temperature`. All existing
prompt, schema, candidate, no-tools/no-store/no-retry, timeout, byte-ceiling,
privacy and exact-result checks remain mandatory. Tests must freeze the exact
request and reject `finishReason: MAX_TOKENS` with truncated JSON. Issue #335,
independent review, merge/final CI and one fresh real minimal preflight remain
required before requesting `EXECUTE-P8V3F-2026-08-20.P8V3F.1`.

### P8V3G — Hermes strict-shell startup correction

The consumed P8V3F attempt is retained immutably at result SHA-256
`02af7782d0ed7020c900109725f8b681504f68479cf90727127fd70d2aeb9f4d`.
It stopped at configuration, restored exact pre-change configuration, left all
five containers healthy on their prior IDs/images and produced zero migration,
knowledge, deployment, WAHA, amoCRM, WhatsApp or draft effects.

Hermes Bash reads its startup file on the `sshd` path. Starting it with `-u`
already active makes the startup file's unset `PS1` reference emit stderr
before the reviewed body runs. P8V3G therefore invokes fixed remote Bash with
`-e` only and requires literal `set -u` as the first reviewed command, before
stdin or effects. Empty stderr, sole process-only stdin, redaction, atomic
configuration writes, readback, cleanup and rollback remain mandatory. This
matches GNU Bash's documented remote-startup and `set -u` behavior:
<https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files> and
<https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html>.

P8V3G uses release `2026-08-21.p8v3g.1`, version
`p8v3g-0f1454d0-20260821`, importer `evo-p8v3g-knowledge-import`, evidence root
`/opt/evo-release-evidence/p8v3g-20260821.1`, result
`p8v3g-rollout-result.json`, preflight `p8v3g-production-preflight/v1`, and
authorization `EXECUTE-P8V3G-2026-08-21.P8V3G.1`. P8V3F roots and token are
immutable/consumed. Issue #338, independent review, final CI, fresh minimal
preflight and the new owner token gate execution. No product or production
authority is otherwise changed.

### P8V3H — final remote-command parity and pre-mutation readiness

The consumed P8V3G attempt is immutable failed-attempt evidence at SHA-256
`ce4f9d4b0c96cc6cbddbf3a7d759a84c4f2b806155d4b3f5bda6d1f033207243`.
It stopped at `client_import/knowledge_failed`, restored the exact prior
configuration, left migration `001-077` unchanged, and ran no deployment.
Live reconciliation found no new managed bundle revision: the observed two
documents and 26 chunks predate P8V3G. All five prior production containers
remain healthy with restart count zero. The P8V3G token is consumed.

P8V3H closes the environment-discovery gap as one final correction. Every
remote `bash -c` operation uses one shared argv renderer: Bash starts with
`-e` only, while literal `set -u` is the first command in the reviewed body.
Every operation still requires empty stderr and must not echo process-only
input. The no-effect preflight executes every structurally distinct remote
command form with the same argv and stdin mechanics used by rollout, including
the one-line stdin form used by knowledge import. This follows GNU Bash's
documented remote-startup and `nounset` behavior:
<https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files> and
<https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html>.

Before configuration can mutate production, the same preflight completes all
read-only migration-ledger/readiness, account/provider, frozen 11/291 vault,
deterministic importer/build, archive/Compose, current-container, remote-path,
rollback, evidence and deployment-readiness gates. No later phase may discover
one of those facts for the first time. Import retains the reviewed bounded
retry only for fully received HTTP 429 responses. The two audience bundle
revisions are each replaced by the existing single transactional
`ai_knowledge_managed_bundle_sync` RPC; a failed embedding sequence therefore
cannot publish a partial revision.

Writable identities advance to release `2026-08-21.p8v3h.1`, version
`p8v3h-0f1454d0-20260821`, importer `evo-p8v3h-knowledge-import`, evidence root
`/opt/evo-release-evidence/p8v3h-20260821.1`, result
`p8v3h-rollout-result.json`, preflight `p8v3h-production-preflight/v1`, and
authorization `EXECUTE-P8V3H-2026-08-21.P8V3H.1`. All P8V3G roots remain
immutable. Issue #340, one independent review, one final CI, one short real
preflight, and one new owner token covering deployment plus rollback are the
only remaining launch gates. Product scope and provider/customer-send
authority are unchanged.

## P8V3I safe knowledge-import diagnostic gate

P8V3I supersedes P8V3H only after the latter's immutable failed result SHA-256
`52710d73b6308db1d1e62af9a1a25cae0cc58c3ddfa67d40e84326c960933f04`.
P8V3H's token is consumed and its safe post-stop facts are not relabeled.

Before implementation, one no-production capacity diagnostic rebuilt the
exact frozen client sources and ran the shipped chunker and formatter. It
produced 11 documents and 17 chunks in one batch. The same process-only key,
`gemini-embedding-2`, and dimension 1536 returned exactly 17 valid embeddings
in one provider call. No database RPC or production effect occurred. The
result distinguishes current provider capacity from structural importer/RPC
failures without claiming what historically caused P8V3H.

Every expected client/internal import failure is classified at source into one
of exactly seven codes:

- `provider_rate_limited`: a fully received bounded HTTP 429;
- `provider_rejected`: any other provider rejection or invalid embedding
  response shape/cardinality/dimension;
- `bundle_invalid`: invalid canonical bundle bytes, document schema, limits or
  chunk construction;
- `manifest_mismatch`: invalid canonical manifest or bundle file/hash/audience
  mismatch;
- `account_binding_failed`: configured, argument, bundle or live account
  identity mismatch;
- `rpc_rejected`: managed-sync rejection or impossible RPC result; and
- `transport_failed`: fetch/read/timeout/SSH/SCP/output transport failure.

The importer emits expected blocked outcomes only as closed JSON with empty
stderr. The rollout maps that record to `failure.reason_code`. P8V3I requires
that field exactly for `client_import` or `internal_import` failures and
forbids it elsewhere. Historical D-H evidence remains schema-valid without it.
No raw error, response body, UUID, key, path, embedding, customer text or
private diagnostic enters stdout or evidence.

Tests must execute all seven classifications, including fully consumed 429,
non-429/malformed provider response, canonical bundle vs manifest vs account
separation, RPC rejection, and transport failure. They also prove that a
blocked importer produces one closed record, empty stderr, non-success rollout
evidence with the exact safe code, and no later phase.

New writable identities are release `2026-08-21.p8v3i.1`, version
`p8v3i-0f1454d0-20260821`, importer `evo-p8v3i-knowledge-import`, evidence root
`/opt/evo-release-evidence/p8v3i-20260821.1`, sole result
`p8v3i-rollout-result.json`, preflight `p8v3i-production-preflight/v1`, and
future authorization `EXECUTE-P8V3I-2026-08-21.P8V3I.1`. Issue #344 and the
single review/final-CI/preflight/owner-token sequence remain mandatory. This
block authorizes repository work only.

## P8V3J — importer network parity correction (2026-08-21)

P8V3I stopped at `client_import` with the closed reason
`transport_failed`. Its retained result remains immutable at SHA-256
`1709094ba438286f00d9ebb83ae6a7377f8cd7fdb2f2d4a72e1ef3eb08698e26`.
Cleanup and rollback were verified, the knowledge sync had no effect, and all
five production containers remained on their prior healthy identities. The
P8V3I authorization is consumed and must never be reused.

Read-only Hermes inspection found a concrete execution mismatch: the importer
was created without `--network`, while `evo-crm-app-1` is attached to
`evo_crm_private` and `evo_public_web`. The host resolver is
`127.0.0.53%lo`; the application container uses Docker's embedded resolver at
`127.0.0.11`. Docker documents that containers on the default bridge receive a
copy of the host resolver configuration, while containers on a user-defined
network use the embedded DNS server:
<https://docs.docker.com/engine/network/#dns-services> and
<https://docs.docker.com/engine/network/drivers/bridge/#differences-between-user-defined-bridges-and-the-default-bridge>.
The historical low-level exception was not retained, so P8V3J records this as
a confirmed network/DNS-path mismatch compatible with `transport_failed`, not
as proof of an exact historical `ENOTFOUND` message.

Before any mutation, preflight must require the existing network named exactly
`evo_crm_private` to be a local, non-internal bridge. Importer creation must use
exactly `--network evo_crm_private`. After start and before copying or running
the importer, the runner must bind the exact container ID, image ID, owner
nonce, name, running state, sole attached network `evo_crm_private`, and sole
resolver `127.0.0.11`. Any missing network, extra network, resolver drift,
ownership drift, or inspection failure blocks before provider or database
work. Each predicate must carry an explicit nonzero exit and must not rely on
`set -e` to interpret a standalone `[[ ... ]]` test. Existing exact-ID cleanup
and absence proof remain mandatory.

Tests must first reproduce the missing-network contract, then prove the exact
create argument, preflight network inspection, post-start sole-network and
resolver checks, and fail-closed behavior for network/resolver drift. A real
OrbStack check may exercise the reviewed image on a collision-free disposable
user-defined network; it is local-only and must clean up by verified identity.

Writable identities advance to release `2026-08-21.p8v3j.1`, version
`p8v3j-0f1454d0-20260821`, importer `evo-p8v3j-knowledge-import`, importer file
`p8v3j-platform-knowledge-import.mjs`, evidence root
`/opt/evo-release-evidence/p8v3j-20260821.1`, sole result
`p8v3j-rollout-result.json`, preflight `p8v3j-production-preflight/v1`, and
future authorization `EXECUTE-P8V3J-2026-08-21.P8V3J.1`. Issue #348, one
scoped PR, one independent review, final CI, a fresh short read-only preflight,
and a new owner token remain mandatory. This block authorizes repository work
only; it does not authorize production, provider, import, deployment,
WhatsApp, WAHA, amoCRM, or customer-data effects.

## P8V3K — Compose-native knowledge import runtime (2026-08-21)

P8V3J remains immutable audit history. Its reviewed result SHA-256 is
`45b67745d808333b74af8feeb7c1d213e2a018ac1690c0154212341591753486`; it stopped
at `client_import` with `transport_failed`, verified rollback and cleanup, and
left migrations `001-077`, managed client knowledge, the pre-existing internal
2 documents/26 chunks, and all five deployed containers unchanged. Its token is
consumed and is never accepted by P8V3K.

The prior helper container assembled a runtime with separate `docker create`,
`start`, `cp`, `exec`, network and cleanup steps. P8V3K replaces that lifecycle
with one foreground `docker compose run` job against service `app` in the exact
production Compose file. Docker documents that `compose run` uses the service
configuration, that `--no-deps` suppresses dependency startup, that `--rm`
removes the one-off container, and that `--pull never` forbids a pull:
<https://docs.docker.com/reference/cli/docker/compose/run/>.

The candidate image is intentionally still the reviewed linux/amd64 image from
application commit `0f1454d014bbc9eca9d7381dfe557e980965543e`, image ID
`sha256:fc3487ce079663694aee583891c3939296915634bea61dd293db235b57e748f3`.
It predates later importer retry and safe-diagnostic fixes. P8V3K therefore does
not execute the stale importer baked into that image. The final checkout builds
the current importer twice, binds its byte-identical SHA-256/size in preflight,
rebuilds and rechecks it for execution, transfers only that file, and bind-mounts
it read-only with each exact frozen bundle and manifest.

The frozen command seam is `docker compose --ansi never --progress quiet
--project-name evo-crm -f /opt/evo-crm/docker-compose.prod.yml --env-file
/opt/evo-crm/.env.production run --rm --no-deps --pull never -T`, followed by
the exact reserved name `evo-p8v3k-knowledge-import`, a fresh owner label,
process-only environment-name forwarding, read-only individual file mounts,
`--entrypoint /bin/sh`, service `app`, and a fixed shell that validates the
configured account against the separately resolved expected account before
executing the mounted importer with Node. No secret or UUID value appears in
argv, stdout, stderr or evidence. Build, pull fallback, port publication, extra
networks, `docker cp`, and the old sleep/start/exec lifecycle are forbidden.

Before any configuration, migration reconciliation or knowledge effect, the
short production preflight builds the same importer and runs its
`--verify-provider` mode on Hermes through the same Compose service, reviewed
image, environment, network, shell/output and cleanup seam. The probe makes one
non-retrying `gemini-embedding-2` batch with fixed neutral text, requires the
exact 1536-dimensional response, emits one closed JSON line with empty stderr,
and writes no Supabase, amoCRM, WAHA, application-volume or customer data. The
preflight also requires the exact production Compose hash/render, exact loaded
image, healthy current containers, migration ledger, capacity, rollback files,
absent reserved name/owner, and cleanup after the probe. Any mismatch blocks
before the owner token.

Execution keeps client before internal. The importer accepts only the existing
closed success/blocked JSON contract with empty stderr. After each audience,
the runner rereads the single managed revision and requires the exact bundle
SHA-256/document count and a positive chunk count before continuing. The RPC
remains the sole atomic database publication. A failed knowledge boundary keeps
all application deployment boundaries `not_run`, restores configuration, and
cleans only files/containers proven to belong to this attempt. `--rm` is primary
container cleanup; final inventory must prove both reserved name and owner label
absent, while a foreign occupant is never removed.

Writable identities advance to release `2026-08-21.p8v3k.1`, version
`p8v3k-0f1454d0-20260821`, importer file
`p8v3k-platform-knowledge-import.mjs`, result `p8v3k-rollout-result.json`,
evidence root `/opt/evo-release-evidence/p8v3k-20260821.1`, preflight
`p8v3k-production-preflight/v1`, and future authorization
`EXECUTE-P8V3K-2026-08-21.P8V3K.1`. Issue #350, one coherent PR, one independent
exact-head review, one final CI, one short real preflight, and one fresh owner
authorization covering import, deployment and rollback remain mandatory. This
block authorizes repository work only.

## P8V3K live Compose baseline correction (2026-08-21)

The first real P8V3K preflight stopped before its provider probe or any
production effect because `/opt/evo-crm/docker-compose.prod.yml` hashes to
`51b6a19cdf4797f7e882d4638c12177030fcb3e0258311a7682db7d959c28988`, while
the initial contract incorrectly required the not-yet-deployed candidate
Compose SHA-256
`ae3689f60d14c1463a77512afbe8d24db59d079473435e9c8b2d01c222eb7a6f` at
that live path. Read-only comparison proves the `app` service used by
`docker compose run` is unchanged between those files. The only observed
differences are the candidate's new `manual-send-worker` service and its WAHA
healthcheck path; neither participates in the knowledge-import job.

Issue #352 therefore binds the preflight and both knowledge-import jobs to the
exact observed live Compose SHA `51b6a19c...` at the existing canonical path.
The later deployment boundary remains bound to the reviewed candidate Compose
SHA `ae3689f6...` under the staged release repository. Preflight must still
validate the live file before the single provider probe, and execution must
revalidate it before each import. Deployment must still validate and invoke
the staged candidate file; no copy or replacement of the live Compose file is
authorized before the owner token.

No successful P8V3K preflight artifact, remote preflight root, import,
configuration change, deployment, restart or provider retry was retained.
Accordingly the existing collision-free P8V3K release, preflight format and
future authorization `EXECUTE-P8V3K-2026-08-21.P8V3K.1` remain unconsumed.
This correction requires one scoped review/CI and one fresh short preflight
before that single deployment-plus-rollback authorization may be requested.

## P8V3K Docker 29 OCI runtime-identity correction (2026-08-21)

Issue #354 records a second no-effect preflight observation. Docker Engine
`29.4.0` with its containerd image store loads each exact reviewed OCI archive
as the archive's top-level OCI index. For CRM, the exact source tag resolves to
index `sha256:711535e0d1216663e42b2d2dd4e2b042812d8bce8ebe82a5c3eb6ae866d60a45`;
the reviewed linux/amd64 manifest
`sha256:fc3487ce079663694aee583891c3939296915634bea61dd293db235b57e748f3`
remains a descriptor inside that index and is not a separately inspectable or
taggable Docker image. A container created from the loaded tag reports the
index digest as `.Image`. The same result was reproduced with
`docker image load --platform=linux/amd64`.

Docker documents that Engine 29 uses the containerd image store, which supports
multi-platform image indices and attestations, and that `docker image load`
restores the archive's images and tags:
<https://docs.docker.com/engine/storage/containerd/>,
<https://docs.docker.com/build/building/multi-platform/>, and
<https://docs.docker.com/reference/cli/docker/image/load/>. P8V3K therefore
separates three identities instead of treating them as interchangeable:

- the archive SHA-256 and size bind transferred and rollback file bytes;
- `platform` remains the exact offline-verified linux/amd64 manifest descriptor
  and revision/config provenance inside the archive;
- `index` is the Docker-inspectable runtime image ID used by the source tag,
  Compose tag, provider/import containers, deployed containers and candidate
  cleanup on the frozen backend.

Execution must load each exact archive, require `sourceTag -> index`, tag the
verified source tag to the fixed Compose tag, require `composeTag -> index`,
and compare every candidate container `.Image` and deployment
`after_image_id` to that same index. It must never tag or inspect `platform` as
a standalone Docker image. Historical rollback image IDs remain the exact
Docker runtime IDs already frozen in the rollback evidence.

The short final preflight may temporarily load only the CRM archive so the
neutral provider probe exercises the exact candidate runtime. Inbox and Lead
remain archive-only until the owner-authorized execution. Before the temporary
transaction, preflight must prove Docker `29.4.0`, API `1.54`,
`linux/amd64`, DriverStatus exactly
`[["driver-type","io.containerd.snapshotter.v1"]]`, candidate
source/Compose/nonce-tag state, candidate-index
visibility and container references, plus the unchanged five production
containers. It then loads only the exact CRM archive, proves
`sourceTag -> index`, creates the fixed Compose tag from that index, and runs
one two-phase owner-labelled `--pull never --no-deps` provider job. The
detached job initially runs only a fixed bounded wait shell. Preflight captures
and validates its exact ID, reserved name, owner label, `.Image == index`,
network, UID/GID and running state before an exact-ID gate release allows the
single neutral provider command. A wrong identity never opens the gate. The
non-auto-removed job is then waited, its closed output/exit verified, and its
exact owned ID removed in finally.
The accepted prestate is closed: either source tag/index are both absent with
no candidate reference, or the exact source tag is the sole tag on the exact
visible index; the Compose and nonce tags and all candidate-index containers
must be absent. Cleanup restores that exact prestate.

Finally cleanup is container-first and may remove only tags and the index that
were absent before this transaction, still resolve exactly to the reviewed
index, and have no foreign tag or container reference. No force, prune, pull,
build, broad deletion or offline conversion is allowed. A collision, repoint,
foreign reference, ambiguous inspection/removal or incomplete cleanup blocks
execution and requires reconciliation. Final evidence records the archive,
index and platform descriptor for all three portable files, plus a separate
CRM-only runtime-probe record with backend identity, runtime index, exact
provider container identity, pre/post state, cleanup and unchanged production.
Inbox and Lead records must not claim runtime verification before execution.
No UUID, credential or private path is retained. The proof covers
Docker-visible restoration; it does not claim byte-identical restoration of
unreferenced containerd blobs.

No provider probe or Docker-cache mutation is authorized by this repository
change. After one independent review, one final CI and merge, a fresh explicit
preflight authorization
`PREFLIGHT-P8V3K-2026-08-21.P8V3K.1`, supplied process-only as
`EVO_P8V3_PREFLIGHT_AUTHORIZATION`, gates the bounded temporary CRM
transaction. Absence or mismatch must stop before its first Docker/provider
effect. The retained canonical preflight evidence is the launch-control
consumption record and reuse is forbidden. A single later owner authorization
may then cover the defined import, one-boundary-at-a-time deployment and
rollback window. P8V3K release/result/execution-token identities stay unchanged
because no successful preflight artifact or execution was retained.

## P8R1 — Fast app-only release control (2026-08-22)

P8R1 adds a reusable fast lane for ordinary CRM application releases after the
controlled P8V3K first rollout succeeds. It does not amend, authorize, replace,
or bypass the frozen P8V3K knowledge import, migrations or one-boundary rollout.
The first production use of P8R1 requires its own activation and deployment
authorization after the repository change is reviewed and merged.

The operator supplies an exact 40-character commit that must equal current
`origin/main` and have green CI for that exact tree. GitHub Actions then builds
one linux/amd64 CRM image from that immutable commit, records its exact digest
and OCI release labels, and enters the protected `production` Environment.
That Environment supplies the dedicated SSH key, pinned Hermes host key and
non-secret deployment variables; none is stored in the repository. Production
concurrency permits only one deployment or rollback at a time.

The fast lane is deliberately narrow. A fail-closed changed-scope gate rejects
database migrations and schema, knowledge bundles/importers, provider or
credential configuration, authentication/authorization/security boundaries,
WhatsApp/WAHA, amoCRM, Lead Agent, Inbox, Compose/proxy/infrastructure and the
release controller itself. Rejected work must use the existing controlled
release path. Passing the path gate is necessary but not sufficient: exact-main
identity, exact CI, immutable artifact identity, current health, Compose
validation, required secret-name presence without values, disk capacity and an
immediate app-image rollback reference are all checked before mutation.

Deployment changes only the CRM `app` service. The reviewed image is imported
under the exact commit tag, the current app image and deployment metadata are
retained, and Compose starts only `app` with dependencies, builds and pulls
disabled. The controller requires Compose health, zero restart regression, the
exact running image and OCI labels, and an external health response. Failure
automatically restores only the prior app image and release metadata; it never
rewinds migrations, databases, volumes, knowledge, WAHA, amoCRM or customer
data. Evidence contains only release identities, timestamps and closed result
codes.

The application reads release metadata from validated runtime variables. Every
authenticated staff shell shows the deployed version and abbreviated revision,
and an authenticated version endpoint returns the same closed metadata. Public
`/api/health` stays minimal. Missing or malformed metadata is shown as
unavailable; no repository SHA, IP address, credential, account identifier or
environment-specific fallback is hardcoded.

The controller is tested first against a disposable OrbStack Compose project
using the real CRM image, including deploy, health failure and rollback. The
repository change then follows one PR, one independent review and one final CI.
GitHub Environment activation and the first real production deployment remain
separate, explicit operations.

References: [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
[manual workflow runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow),
[workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency),
[Docker Compose app-only update](https://docs.docker.com/reference/cli/docker/compose/up/).

## 2026-08-22 all-in-one Platform architecture authority

This decision supersedes older target-language that treats Main CRM, EVO Inbox,
or EVO Lead Agent as separate products or permanent boundaries. Historical
deployment facts, rollback controls, and provider cutover gates remain valid,
but their purpose is to reach one EVO Admissions product safely.

The target is one entry point, one accepted UI shell, one Supabase Auth/RBAC
organization model, and one cross-module workflow. Admissions/CRM,
communications/Inbox, and Lead Agent/orchestration are internal modules. They
must not expose competing staff applications or maintain competing operational
truths. The root `supabase/` migration chain and the Platform schemas are the
only forward data authority. Supabase Postgres stores Platform state, Auth owns
identity, private Storage owns applicant/media objects, Realtime may invalidate
authorized UI state, and Edge Functions may implement appropriate short-lived
integration boundaries. Those capabilities all serve the same domain model.
The target staff entry remains the unified CRM shell rather than a preserved
second Inbox application or separate Lead Agent UI.

WAHA transports WhatsApp, amoCRM supplies its explicitly owned sales fields,
and approved AI providers generate bounded proposals. Each is an adapter at the
Platform boundary. Provider identifiers and observations are normalized into
the Platform model; providers do not become separate products. No new SQLite
path, legacy-schema feature, dual-read, dual-write, fallback UI, or compatibility
layer may be added. Existing separate runtimes and legacy objects are frozen
cutover inputs to retire, not architecture to extend.

The unified Platform remains not live-ready until its real managed Supabase
Auth/RLS/Storage/data path and required provider adapters are exercised in the
authorized environment. Repository, local database, and UI checks prove only
their stated layers.

Research basis: [Supabase architecture](https://supabase.com/docs/guides/getting-started/architecture),
[Auth architecture](https://supabase.com/docs/guides/auth/architecture),
[Database overview](https://supabase.com/docs/guides/database/overview),
[Realtime authorization](https://supabase.com/docs/guides/realtime/authorization),
and [Edge Functions](https://supabase.com/docs/guides/functions).

## P8R2 — Connected Platform reliability repair (2026-08-22)

P8R2 repairs four connected-runtime defects verified on exact `origin/main`
`6f4041c2a82a8fd2b663322553a6e5035de8105f`. It is one bounded reliability
change: two implemented private APIs must reach their own handlers; the Lead
Agent probe must distinguish that handler from a generic proxy denial; staff
queues and message history must remain reachable beyond the Data API row cap;
and connected `/sales` must show a real read-only Platform work queue instead
of an unconditional empty result.

The private-route contract is an exact-match allowlist. Lead Agent sync and the
Gemini proposal route bypass staff-cookie handling but retain their handler-owned
HMAC, bearer-secret, configuration and disabled-state checks. Near paths remain
blocked. The deployment probe accepts only the Lead Agent handler's documented
unsigned-request response (`403` with `error=invalid_signature`); status alone
is never sufficient proof that the request reached the handler.

Admissions queues, communication queues and message history use bounded,
deterministically ordered server-side pages. Filters are applied before the
page window, record pages use stable tie-breakers, detail screens use direct
authorized snapshots, and older messages remain navigable. Each surface moves
to one canonical bounded read contract. Obsolete unbounded RPCs are removed
after repository callers move; no additive compatibility RPC, dual read, or
fallback remains. The UI must not download an entire queue and then filter or
locate one record in memory.

Connected `/sales` remains read-only and does not manufacture amoCRM deals
from Platform records. It may show the real Platform sales-intake work queue
with links to its native records, but it must label that queue as operational
work rather than the canonical pipeline. amoCRM remains authoritative for deal
identity, stage, amount and responsible sales manager until its real read-only
mapping is exercised and verified. `/sales` is a module of the same EVO UI and
uses the same Supabase identity and role model; it is not a second CRM.

This repository change does not authorize a provider call, production probe,
database migration, deployment, WAHA/WhatsApp write, amoCRM write or autonomous
reply. It also excludes a security scan at the owner's request. Validation is
local and evidence-based: focused repository tests, route-handler/proxy
contracts, a real disposable Supabase migration run, connected Playwright
coverage and the production build. Any unavailable runtime is reported as an
explicit blocker rather than replaced by fixtures or mocks.

The pre-change audit baseline remains approximately 55% code/UI readiness
(reasonable range 50–60%). No maintained repository source for the earlier 76%
claim was found. P8R2 fixes named defects but does not publish a higher readiness
percentage; that requires a fresh screen-by-screen acceptance audit after the
change is merged and exercised in its authorized environment.

Research basis: [Next.js proxy execution and testing](https://nextjs.org/docs/app/api-reference/file-conventions/proxy),
[Supabase range pagination](https://supabase.com/docs/reference/javascript/using-modifiers-range),
[PostgREST table-valued functions](https://postgrest.org/en/latest/references/api/functions.html),
and [PostgreSQL deterministic LIMIT/OFFSET](https://www.postgresql.org/docs/current/queries-limit.html).

## 2026-08-22 exact-main audit correction

The exact current `origin/main`
`ee8a825ebc72f84449636e3feaefab7a330913d4` no longer matches the full
pre-change P8R2 defect baseline. On this SHA, the repository already contains
bounded Supabase page/snapshot read models for communications, student cases,
applications and message history, and the lead-agent route probe requires the
exact handler denial `403|invalid_signature` rather than accepting an arbitrary
`403`.

The still-active remediation target is narrower and architectural. The forward
all-in-one EVO product remains Supabase-native, but the root CRM runtime still
ships legacy SQLite execution paths and `EVO_DB_PATH`-based production wiring.
Connected `/sales` also remains functionally incomplete: in connected mode it
switches away from the admissions lead board/list and renders only the
read-only sales-intake conversation queue. That queue is valid unified module
work, but it does not satisfy the unified sales surface by itself.

Implementation and validation after this audit must therefore focus on:
1. removing or quarantining live forward-runtime SQLite dependencies from the
   connected Platform path;
2. making `/sales` a coherent all-in-one staff surface on the bounded Supabase
   contracts;
3. preserving the exact existing bounded read-model behavior instead of
   reintroducing unpaged RPCs, dual reads/writes or fallback UI.

## P8R3 — Bounded catalog review and truthful Student 360 preview (2026-08-23)

P8R3 closes two exact-main scale gaps without changing the database schema or
provider boundaries. Catalog import candidates remain authorized and ordered
by the existing `admin_catalog_import_candidates` table-valued RPC, but the
server repository applies an explicit range with one look-ahead row. The
Applications page reads a bounded page number from its `searchParams` prop and
renders batch-scoped previous/next navigation. It never downloads the complete
batch to paginate in memory.

Student 360 keeps a bounded embedded application preview. If the canonical
application page reports more rows, the active-application number is rendered
as a lower bound rather than an exact total, and the applications section
visibly explains that only the newest bounded page is shown. The existing link
to `/applications?student_case_id=<case>` is the route to the complete,
server-paginated case queue.

Acceptance requires focused tests for inclusive RPC ranges, look-ahead trimming,
batch-isolated links, lower-bound metrics and visible disclosure, followed by
the non-security unit suite, lint, typecheck, production build, independent
exact-head review and normal exact-SHA CI. No database migration, provider
request, production operation, WhatsApp/WAHA send, amoCRM write, autonomous
reply, DNS/TLS change or dedicated security scan is authorized by P8R3.

Research basis: [Supabase range pagination](https://supabase.com/docs/reference/javascript/using-modifiers-range),
[PostgREST table-valued functions](https://postgrest.org/en/latest/references/api/functions.html),
[PostgREST pagination and count](https://postgrest.org/en/stable/references/api/pagination_count.html),
[PostgreSQL deterministic LIMIT/OFFSET](https://www.postgresql.org/docs/current/queries-limit.html),
and [Next.js search parameters for server data loading](https://nextjs.org/docs/app/getting-started/layouts-and-pages#rendering-with-search-params).

## P8R4 — Supabase-owned WAHA runtime binding for manual send (2026-08-23)

Exact-main audit on `7e99eff6c1890f234eabb9d18217fbe2dd43f500`
confirms that staff authorization, queue leasing, provider-result binding and
audit for manual WhatsApp send are already canonical Supabase contracts. The
remaining forward-runtime break is the transport adapter: it dynamically opens
legacy SQLite settings for `waha_base_url` and `waha_api_key`, while the worker
and migration 077 hard-code the retired `crm_primary` session.

P8R4 replaces that seam rather than layering another fallback over it. A new
Supabase migration owns one private, organization-scoped manual-send WAHA
runtime binding. Non-secret endpoint/session metadata stays in
`platform_private`; the API key is referenced from Supabase Vault and may be
resolved only by one service-role RPC. The accepted forward session is exactly
`evo-inbox`. The Next.js manual-send module loads that resolved binding through
its existing Supabase adapter, creates the WAHA adapter from it, and no longer
imports `src/lib/db.ts` or reads SQLite settings.

The migration must fail closed if historical manual-send provider bindings for
another session already exist. It must not rewrite provider provenance or keep
a dual-session compatibility branch. Migration 077 remains immutable history;
the new migration replaces only the active claim/finish and binding invariants
with the `evo-inbox` contract. Missing, disabled, duplicated, malformed or
undecryptable runtime configuration leaves the worker unavailable before it
claims queue work.

Acceptance requires runtime tests for Vault-binding parsing, exact private WAHA
transport serialization, fail-closed configuration and the absence of any
manual-send import of SQLite. A disposable local Supabase reset must prove the
new migration, service-only grants, Vault resolution, exact `evo-inbox` claim
and finish path, and refusal to migrate non-target provider history. Then run
the full non-dedicated-security unit suite, lint, route type generation,
TypeScript, production build, independent exact-head review and normal
exact-SHA CI.

P8R4 does not seed a real secret, create/start/restart/delete a WAHA session,
scan or mutate production, send WhatsApp, write amoCRM, enable autonomous
replies, change DNS/TLS or authorize a dedicated security scan. Provider and
production readiness remain unproved until a separately authorized cutover
seeds the Vault binding and verifies the real `evo-inbox` session without a
customer send.

Research basis: [Supabase Vault](https://supabase.com/docs/guides/database/vault),
[Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys),
[PostgreSQL safe `SECURITY DEFINER` functions](https://www.postgresql.org/docs/current/sql-createfunction.html),
[WAHA session lifecycle](https://waha.devlike.pro/docs/how-to/sessions/), and
[WAHA private API-key configuration](https://waha.devlike.pro/docs/how-to/security/).

Implementation evidence on 2026-08-23: migration 080 adds the private
Vault-backed binding and its service-only resolver, rejects non-target provider
history or live queued work, and replaces the active claim/finish contract with
the exact `evo-inbox` session. The worker now resolves configuration through
Supabase before leasing work and has no SQLite settings fallback. The SQL audit
also exposed and closed a pre-existing role mismatch: `admin` and `curator`
could authorize a send, but finish previously resolved only a `sales`
participant. Claim now verifies active staff authority and records the sender
participant before any provider request; finish accepts the same three staff
roles.

Disposable-local proof passed: migration reset and the conflict guard, Vault
resolution/grants, real SQL claim/finish, 651 unit tests, root and Inbox
typechecks/builds, lint, and the complete local Supabase/browser gate. An
independent diff review found no high- or medium-severity correctness issue.
Exact committed-head CI passed and PR #372 merged as
`d4d3272fcf730a4a273d52422d854e15c3b01a50`. No provider, production,
WhatsApp, amoCRM, DNS/TLS or dedicated security-scan action was performed by
P8R4.

## P8R5 — Provision and verify the Supabase-owned WAHA binding (2026-08-23)

Post-merge audit on `d4d3272fcf730a4a273d52422d854e15c3b01a50`
confirms that migration 080 deliberately creates no real Vault secret or
enabled runtime row. That is correct for a source-controlled migration, but
the repository has no supported provisioning path: only the disposable SQL
test creates the secret/binding. The worker therefore returns
`manual_send_unavailable` in every real environment until an operator performs
an undocumented direct database write. Historical P8V3 release scripts are
also exact evidence for migration 077 and must not be edited or reused as a
current-main gate.

P8R5 adds one forward migration with two service-only functions. Provisioning
creates or rotates the organization-specific Vault secret, enables the exact
`evo-inbox`/private-URL binding, records only a SHA-256 identity plus version in
Platform metadata and appends a secret-free audit event. Configuration status
returns one bounded non-secret row and proves that the stored Vault plaintext
still matches that hash; it does not call WAHA and must never claim provider
health. Both functions use a fixed empty `search_path`, validate the active
organization and request identity, revoke default execution, and are reachable
only through a dedicated server-side Supabase client.

Two small operator CLIs become the supported current-main path: one accepts the
WAHA key only from process environment and prints non-secret metadata; the
other checks the safe configuration-status RPC for release gating. Neither CLI
reads SQLite, writes a seed/migration secret, sends a message, changes a WAHA
session, or contacts the WAHA provider. The opaque `sb_secret_...` credential
is sent only in the Supabase `apikey` header; it is never misused as a bearer
JWT. The migration and SQL acceptance must
prove create, idempotent replay, rotation, hash agreement, audit redaction,
browser-role denial and resolver compatibility. Historical P8V3 artifacts stay
immutable and are explicitly ineligible for a migration-081 release.

Acceptance requires focused CLI tests with mocked Supabase HTTP, the disposable
Postgres authorization suite, migration inventory/schema-contract updates, the
full non-dedicated-security unit suite, lint, typecheck, builds, local Supabase
gate, independent exact-head review and normal exact-SHA CI. P8R5 authorizes no
managed migration, production change, real secret injection, WAHA request,
WhatsApp send, amoCRM write, DNS/TLS work or dedicated security scan.

Research basis: [Supabase Vault secret creation and rotation](https://supabase.com/docs/guides/database/vault),
[Supabase Database Function privileges](https://supabase.com/docs/guides/database/functions),
[Supabase server secret-key boundary](https://supabase.com/docs/guides/getting-started/api-keys),
[Supabase migration deployment](https://supabase.com/docs/guides/deployment/database-migrations),
and [PostgreSQL safe `SECURITY DEFINER`](https://www.postgresql.org/docs/current/sql-createfunction.html).

Implementation evidence on 2026-08-23 (+06): migration 081 and its exact-tip
SQL acceptance passed a fresh `001-081` reset and the complete disposable
Postgres authorization harness. The focused operator contract passed 55 tests,
P8V1 passed 85 tests, the complete ordinary unit suite passed 651 tests and the
Inbox schema contract passed 32 tests. Root and Inbox typechecks/builds passed;
root lint passed and Inbox lint completed with seven pre-existing warnings and
zero errors. The complete local Supabase/Auth/PostgREST/Storage/PGMQ/browser
gate passed and confirmed 81 contiguous applied migrations. Independent
correctness review found no high- or medium-severity P8R5 runtime issue; its only
initial docs concern used UTC instead of the authoritative Asia/Bishkek
workspace date and did not apply. Exact candidate CI run `32607745769` passed
all four checks and PR #373 merged as
`4aff8350eb4f2f839cf85f8a138828c913a76356`. No managed migration, real secret
injection, provider call, WhatsApp send, amoCRM write, DNS/TLS change or
dedicated security scan was performed.

## P8R6 — One active WAHA session authority (2026-08-23)

Exact post-merge audit on
`4aff8350eb4f2f839cf85f8a138828c913a76356` found one remaining contradiction:
the unified ingress, manual-send and autonomous-reply paths use only
`evo-inbox`, but the signed Lead Agent sync, current Supabase projection and
operator examples still use `crm_primary`. Because WAHA includes the created
session name in webhook payloads and session-scoped API paths, treating those
names as aliases would preserve two runtime truths.

P8R6 makes `evo-inbox` the only accepted forward session and
`waha:evo-inbox` the only new Lead Agent provider-account reference. Migration
082 replaces the active message/session-status projection and limits current
staff health selection to `evo-inbox`, while retaining old `crm_primary` rows
unchanged as historical provider evidence. Application types may distinguish
historical provenance from the current runtime session, but no fallback or
translation may turn legacy evidence into current health.

The Lead Agent runtime/deploy examples and fixture-only legacy settings guidance
must also name `evo-inbox` and the Platform webhook boundary. The old public CRM
webhook source remains frozen for the still-running old release and remains
blocked by connected Platform routing; deleting or switching the real session
is a later controlled production operation, not part of this repository slice.

Acceptance starts red-first and covers exact session/provider identity,
`crm_primary` rejection for new sync/current health, replay and grants,
historical-row preservation, Lead Agent emitted payloads and source/config
guidance. It then requires the disposable Postgres and full local Supabase
gates, ordinary unit and Lead Agent tests, typechecks, lints, builds,
independent review and exact-SHA CI.

No production session/webhook mutation, managed migration, real credential,
provider request, WhatsApp send, amoCRM write, autonomous activation, DNS/TLS
work or dedicated security scan is authorized. A later cutover must inspect
both per-session and global `WHATSAPP_HOOK_*` webhooks, retain HMAC verification
and require the canonical session to report `session.status=WORKING` before
ownership changes.

Research basis: [WAHA sessions](https://waha.devlike.pro/docs/how-to/sessions/),
[WAHA events](https://waha.dev/docs/how-to/events/),
[WAHA security](https://waha.dev/docs/how-to/security/), and
[WAHA quick start](https://waha.dev/docs/overview/quick-start/).

Implementation evidence: migration 082 and its acceptance test enforce exact
`evo-inbox` / `waha:evo-inbox` forward evidence and preserve old
`crm_primary` rows only as unchanged provenance. Current TypeScript, the frozen
Lead Agent, deploy examples and the release runbook now share that authority;
the dormant legacy QR/session-start/secret-write controls were removed rather
than retained as a compatibility path. A red-first source-contract test also
separates immutable migration-077 `crm_primary` evidence from the current-tip
P8R6 wrapper, which explicitly selects `evo-inbox`; both fresh-reset boundaries
now pass without treating the historical name as current authority.

Final local proof passed a fresh `001-082` Postgres authorization harness, the
complete local Supabase/Auth/RLS/Storage/Realtime/browser gate, 655 root unit
tests, 842 Inbox tests plus 32 schema-contract tests, 126 Lead Agent tests,
root/Inbox typechecks, lints and builds, Lead Agent Ruff, safe Compose rendering
and independent correctness/release review with no remaining high or medium
finding. This is repository/disposable-local evidence only. Exact-head CI and
merge remain mandatory; no managed migration, real provider/session/webhook,
WhatsApp, amoCRM, autonomous, deployment, DNS/TLS or security-scan action was
performed.

The first exact-head CI run `32610716487` on
`d21c60f5007fa6359580334f77d2dbc9fe771936` passed the changed-range, Inbox and
Lead Agent jobs. Its Main CRM job reached the scenario stage after the full
local Supabase gate, then correctly failed because the legacy S28/S28B/S29
fixtures still searched for WAHA/Meta controls removed by this slice and the
amoCRM S32/S36 action selector depended on one of those removed fields. The
scenario contracts now assert the server-managed `evo-inbox` boundary, the
retired QR route and a stable amoCRM check-form identity. A disposable SQLite
copy with an isolated report path passed the five safe affected scenarios
5/5. S36 is now explicitly fixture-only and records
`blocked:fixture_external_calls_disabled` before the adapter can run, so the
full CI suite cannot contact amoCRM. The regenerated full CRM scenario suite
then passed 39/39 with `provider calls 0`; the revised exact head must still
pass CI before merge.

The revised exact head
`9f7901d7cf2c434819b86d634fd26af102302615` passed all four required jobs in
run `32611834420`, and PR #374 squash-merged as
`2db8810213c7944aaf2f1b8e52ef4c0ab7824aa5`. A post-merge comparison proved
the merged tree equivalent to the reviewed head. This closes repository P8R6
only; no managed Supabase/provider or production proof was performed.

## BH1 — Repository branch and worktree hygiene (2026-08-23)

The current GitHub and local Git inventories contain historical delivery
residue: 96 GitHub branches, 273 pre-audit local branches, 150 pre-audit
worktrees, 16 draft PRs and 9 dirty worktrees. This is an operational hygiene
problem, not evidence of multiple supported EVO product versions. GitHub
`main` remains the only shared source of truth and production remains on its
separately recorded older release.

The exact audit, open-PR disposition and proposed deletion batches are recorded
in `docs/audits/git-branch-worktree-hygiene-2026-08-23.md`. Squash-merged work
must be classified by GitHub PR/head evidence and patch/recoverability checks,
not only by Git ancestry. The original dirty checkout, all dirty worktrees,
open PR branches, the changed-after-close document branch, the no-PR P4B
checkpoint, and every unreachable detached commit remain preserved.

BH1 first merges this docs-only contract through exact-head review and CI. A
later execution may delete only an owner-approved itemized batch, after a fresh
state check proves every name and SHA still matches the audit. Remote removal,
clean worktree removal, and safe local `git branch -d` happen as separate
verified stages. Force deletion, global prune/garbage collection, deployment,
DNS/TLS changes, live provider calls, WhatsApp sends, amoCRM writes, WAHA
session changes and the dedicated security scan are outside this lane.

## V1 staff rollout and isolated V2 continuation (2026-08-27)

Block-ID: `EVO-V1-STAFF-V2-STAGING-ROLLOUT-2026-08-27`.

### Owner outcome

The accepted target is one stable Version 1 used by EVO staff and one isolated
Version 2 derived from that accepted release for continued development. The
currently active production application is replaced only after the new V1 has
passed real managed acceptance, the owner has completed at least one hands-on
staging feedback/fix round and the owner then gives a separate explicit
production approval. Until that message, V1 stays outside production. The old
production release is retained as rollback inventory during the later cutover
and is not kept as a second active product.

This block starts the separately authorized post-Long-run-1 preparation. It
does not reinterpret repository evidence as managed or production proof and it
does not skip U11/#388, U12/#389 or the U13/#390 pilot evidence sequence.
Staff use begins with the approved net-new or explicitly allowlisted pilot
cohort. Existing legacy cases and history are preserved but are not broadly
migrated, silently copied or used as a runtime fallback; #391 remains the
post-pilot historical/archive boundary.

### Frozen identities and current blockers

The exact feature baseline completed by Long-run 1 is
`2ea92ac547d7f526f0e886a81f871936af456635`. That commit is the immutable
business-feature floor for V1, not yet the final release tag. The final
`V1_RELEASE_REVISION` is the protected exact-main commit after the U11
readiness/release work is reviewed and merged. No unrelated feature may enter
between the feature baseline and that release revision.

The read-only preflight on 2026-08-27 observed:

- production CRM is healthy on older application revision
  `ee8a825ebc72f84449636e3feaefab7a330913d4`;
- the last retained managed Supabase ledger evidence is `001-077`, while the
  V1 feature baseline requires the contiguous repository history `001-092`;
- the canonical hostname `crm.evoadmissions.com` does not resolve. A
  VPS-origin request with certificate verification bypassed returned HTTP
  `200` from the technical `sslip.io` fallback, a verified local TLS request
  failed its issuer check and a separate reviewer path returned HTTP `403`.
  Therefore that fallback is neither canonical nor stable acceptance proof;
- the newest visible logical SQLite backup predates later live WAL/SHM state;
- GitHub has no configured deployment Environments, repository deployment
  secrets or deployment variables;
- current main already contains the exact-SHA immutable fast app release
  workflow/controller. Its deliberately presentation-only scope correctly
  rejects the migration-bearing `ee8a825...` to V1 range, and GitHub has none
  of its required Environment secrets or variables configured;
- the managed Auth and settings endpoints respond, but provider-level email
  signup is still enabled and no real V1 staff login has been proved;
- the installed `/opt/evo-crm` checkout is stale and does not contain the
  current-main controller files or a configured migration-bearing cutover
  mode. The existing repository controller is the release authority to extend
  and install; its server configuration gap does not authorize a parallel
  controller.

Every observation is time-bound and must be re-read immediately before an
effect. These blockers prohibit a direct application-only production update.

### Two-environment topology

| Boundary | Stable V1 production | V2 staging and V1 acceptance |
| --- | --- | --- |
| Git | protected `main` plus immutable `v1.0.0` tag | protected long-lived `v2` branch created from `v1.0.0` |
| Public URL | `https://crm.evoadmissions.com` | temporary owner test URL `https://staging-crm.72.62.119.112.sslip.io`; canonical `https://staging.crm.evoadmissions.com` deferred |
| GitHub Environment | `production` | `staging` |
| Server root | `/opt/evo-crm` secrets plus immutable `/opt/evo-releases/<sha>/repo` source | `/opt/evo-crm-staging` secrets plus a distinct immutable release root |
| Compose project | `evo-crm` | `evo-crm-staging` |
| Private network and volumes | existing production-owned names | staging-owned names; no production volume mount |
| Supabase | dedicated production project | distinct managed project or persistent branch with distinct URL and keys |
| Auth | approved real EVO staff only | separately provisioned staging staff identities |
| Providers | receive-only gates remain explicit | external writes disabled; no production WAHA session or amoCRM mutation |
| Data | live production authority | no blanket production-data clone; only approved minimized acceptance records |

The same staging environment first runs the exact V1 release candidate for
acceptance. After that exact artifact is promoted to production and passes its
smoke gate, staging is re-baselined from tag `v1.0.0` and becomes Version 2.
Acceptance evidence is retained before the re-baseline.

Docker Compose project names, container names, networks, volumes, paths,
domains and environment files must all be distinct. Sharing the public edge
network for Caddy routing is permitted; sharing a mutable database, private
network, volume, Auth tenant, WAHA session or provider credential is not.

### Ordered execution blocks

#### R0 - freeze the plan and feature boundary

1. Merge this docs-only plan through protected exact-head and exact-main CI.
2. Record `2ea92ac...` as `V1_FEATURE_BASELINE`.
3. Permit only U11 readiness, truthful health, backup/rollback, environment
   isolation and fixes required by real acceptance before the final V1 tag.
4. Reject unrelated product features from the V1 release range.

R0 changes no server, DNS, provider, managed database, user or live data.

#### R1 - implement and close U11/#388

1. Implement truthful Admin readiness/audit visibility and explicitly blocked
   states; configured-only or generic HTTP success is not healthy.
2. Extend and harden the existing `.github/workflows/evo-fast-release.yml` and
   `scripts/evo-fast-release.sh` release authority with a reviewed
   migration-bearing mode for the V1 range. Keep the current presentation-only
   fast lane as a constrained mode; do not create a parallel second
   controller. The migration-bearing mode must pin exact current main, exact
   green CI, immutable linux/amd64 images, environment identity, managed
   migration ledger, app health and rollback inputs.
3. Add a staging deployment contour whose source, Compose project, paths,
   network, volumes, environment and Supabase identity cannot resolve to
   production.
4. Exercise backup and restore in non-production using the real managed schema
   and a real staging application path. Do not claim that a file merely exists;
   restore it and verify the restored service and authorization boundary.
5. Require an independent launch-control reviewer, protected merge and
   exact-main CI before infrastructure configuration.

R1 remains repository and non-production work. Its output defines the exact
`V1_RELEASE_REVISION` candidate; it does not yet deploy production.

#### R2 - provision isolated managed staging

1. Create protected GitHub `staging` and `production` Environments with
   environment-scoped secrets, branch restrictions, concurrency and owner
   review before secrets become available.
2. Select an owner-approved staging Supabase project or persistent branch.
   Record only non-secret project/environment identities in evidence.
3. Apply repository migrations `001-092` to staging through the reviewed
   migration path, then prove the exact ledger, exposed schemas, Auth hook,
   RLS, private Storage and negative cross-organization cases.
4. Configure staging Auth Site URL and redirect URLs for the staging hostname;
   disable public signup and provision only approved staging staff identities.
5. Deploy the exact release-candidate image as Compose project
   `evo-crm-staging` with separate secrets, network and volumes. Keep WhatsApp
   outbound, autonomous replies and amoCRM writes disabled.

Creating a billed Supabase project/branch stops until its expected cost and
exact target are approved. If an existing staging project is offered, its
ownership, data classification and current ledger must be proved before use.

#### R3 - complete real managed acceptance under U12/#389

1. Sign in through the real staging URL with an approved EVO Admin account and
   prove the live organization/membership/JWT/RLS authority chain.
2. Provision and verify approved `sales`, `curator` and `admin` staff roles;
   prove inactive, unauthorized and cross-organization denials.
3. Exercise the critical staff path through canonical Sales, contract/payment
   gate, Admissions handoff/case, finance control, human-reviewed Gemini state
   and pilot-cohort visibility using approved controlled acceptance records.
4. Prove blocked integrations are shown blocked, not healthy.
5. Exercise the one real receive-only inbound WhatsApp acceptance required by
   #389 only after the exact EVO-controlled sender/session/message is approved.
   Record zero outbound WhatsApp and zero amoCRM writes.
6. Exercise the staging backup/restore controller and repeat the login and
   tenant-isolation smoke after restore.
7. Give the owner a real staging URL and approved Admin login for at least one
   hands-on exploratory round. The owner may report both defects and places
   that feel wrong or need product/UI adjustment.
8. Record every accepted owner report, fix it through reviewed code, redeploy
   the new exact candidate to staging and repeat affected automated, security
   and hands-on checks. Any changed commit or image invalidates the earlier
   acceptance evidence for that surface.
9. Keep this feedback/fix loop open until the owner explicitly accepts the
   exact staging revision as Version 1. Silence, a green CI run or technical
   acceptance alone is not owner acceptance.

As of 2026-08-27, the app-only staging contour, approved Admin login and a
read-only smoke of `/sales`, `/clients`, `/applications`, `/whatsapp` and
`/settings?tab=staff` succeeded against the live staging app without fatal or
console errors by using a temporary SSH loopback path. That is operator smoke
evidence, not owner-network acceptance. Public owner testing through
`https://staging-crm.72.62.119.112.sslip.io` remains open, and certificate
warnings must never be bypassed. Local Fortinet interception previously caused
`ERR_CERT_AUTHORITY_INVALID` even though the sslip route answered HTTP 200 with
valid VPS-origin TLS.

Fixture-only, local-only, configured-only or synthetic provider evidence does
not close R3.

#### R4 - promote the exact accepted V1 to production

R4 has an additional owner gate: it is unauthorized until, after the staging
feedback/fix loop, the owner sends a separate explicit instruction that the
exact accepted V1 may replace production. The earlier instruction to make and
follow this plan does not satisfy that later production gate.

1. Freeze a maintenance window and recheck exact main, release-candidate image,
   CI, staging evidence, production containers, disk, DNS, managed project,
   migration ledger and all provider kill switches.
2. Capture a fresh logical SQLite backup, a consistent snapshot of every
   production volume, exact prior images/configuration and the provider-backed
   Supabase recovery point available on the approved plan. Verify backup
   readability before the first change.
3. Apply only missing reviewed forward migrations from the observed production
   ledger through `092`; re-read the exact ledger and stop on any drift or
   ambiguous response. Database migration rollback is forward reconciliation,
   never an unreviewed destructive down migration.
4. Configure production Auth hook, URLs and signup policy; provision the
   approved real staff identities through the reviewed bootstrap/admin path.
5. Deploy the exact image already accepted in staging. Change only the minimum
   required service boundaries and retain the prior `ee8a825...` images,
   configuration and backup evidence.
6. Verify production health, exact revision, real staff login, role/RLS
   negatives and critical staff pages on the technical route. Then establish
   canonical DNS/TLS and repeat the same checks on
   `https://crm.evoadmissions.com`.
7. Tag the exact deployed commit `v1.0.0` only after the protected production
   smoke passes. A changed commit or image invalidates staging acceptance.

If application verification fails before an irreversible database effect, the
controller restores the exact prior application image. If migrations have
already committed, the controller must not pretend the old application plus
new schema is a verified rollback: it stops in reconciliation-required state
and follows a reviewed forward fix or a proved provider recovery procedure.

#### R5 - run the U13/#390 internal staff pilot

1. Run the approved net-new/allowlisted cohort for ten consecutive working
   days and at least five real cases.
2. Keep receive-only, no-amoCRM-write and human-review constraints active.
3. Record critical blockers, workarounds, fallback pressure, revision changes
   and each case's inclusion basis without exposing client data in GitHub.
4. Finish with an evidence-backed go, hold or rollback recommendation.

Version 1 is the active staff system during this controlled pilot. The old
runtime is rollback inventory, not a second user-facing production version.

#### R6 - fork and operate Version 2

1. Create the protected `v2` branch from exact tag `v1.0.0`, not from a moving
   local branch or the pre-U11 feature baseline.
2. Re-baseline the isolated staging database from reviewed migrations without
   importing production customer data, then deploy `v2` through the staging
   Environment.
3. Keep `main` as the stable V1 release line. Production hotfixes branch from
   `main`, merge through the normal gates and are forward-ported to `v2`.
4. V2 changes reach staff production only through a later explicit promotion
   plan and never by pointing staging at production secrets or data.

### Effect-specific approval gates

The owner's instruction authorizes this plan, issue/PR preparation and safe
read-only preflights. Before the named external effect, the execution record
must also identify:

- staging resource creation: exact Supabase target, owner and expected billing;
- DNS: provider/account, exact `A`/`CNAME` record, TTL and rollback record;
- staff Auth: approved work email(s), role(s) and secure password-delivery path;
- real WhatsApp acceptance: dedicated sender, private `evo-inbox` session and
  one bounded inbound message;
- production cutover: maintenance window, exact release revision and named
  owner available for go/rollback.

Missing any input is a truthful blocked state, not permission to invent a
value, clone production data, create a billed resource or weaken a gate.

### Completion evidence

The program is complete only when all of the following are retained and tied
to exact revisions and dates:

- protected planning, U11 and any required correction PRs plus exact-main CI;
- distinct hashed production/staging environment and Supabase identities;
- staging and production migration ledgers through the exact release tip;
- real managed staff login and negative authorization evidence;
- staging backup/restore and fresh production backup readability evidence;
- immutable production release result and preserved prior-release manifest;
- canonical DNS/TLS and production health evidence;
- zero outbound WhatsApp and zero amoCRM-write evidence for acceptance/pilot;
- `v1.0.0` tag identity and protected V2 branch/staging deployment identity;
- U13 duration/case evidence and final go, hold or rollback decision.

Old images, paths and backups are not deleted by this program. Cleanup is a
later itemized, separately approved and recoverability-checked operation.

### Current official implementation basis

- GitHub Environments, protection rules, environment secrets and concurrency:
  <https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments>.
- Supabase separate staging/production projects and migration promotion:
  <https://supabase.com/docs/guides/deployment/managing-environments>.
- Supabase persistent branches and their isolated Database, Auth, Storage and
  API credentials: <https://supabase.com/docs/guides/deployment/branching>.
- Supabase production checklist and RLS/backup guidance:
  <https://supabase.com/docs/guides/deployment/going-into-prod>.
- Docker Compose project-name isolation:
  <https://docs.docker.com/compose/how-tos/project-name/>.

## Completed V2-11 — Staff frontend truth and journey completion (2026-08-31)

V2-11 was the frontend completion contract for the private local V2 product
contour. It remains accepted UI/product evidence, but ADR 0024 supersedes its
local-runtime and frozen-production assumptions.

### Outcome and evidence baseline

The frontend is complete only when one root Next.js application presents the
three fixed staff roles — Admin, Sales and Admissions — and the complete core
journey works against the real local PostgreSQL V2 authority:

`Sales pipeline -> Lead 360 and qualification -> contract/payment gate ->
audited handoff -> Student 360 -> tasks/documents/applications/visa/minimal
finance stop or release -> WhatsApp with a human-reviewed Gemini draft`.

Finance is a module available to Admin and Admissions, not a fourth role.
Marketing and Student Portal remain outside this active staff slice. The
Claude Design lineage committed under `docs/design/evo-platform` and the
2026-08-29 UX/UI evidence package are visual references only; no EVO-owned
Figma file is verified, and historical images never count as current runtime
or provider proof.

The exact starting baseline is `origin/main` commit
`f87bd37fa4ed2b88b35fc2a263459f5d1bcff0a0`, whose exact-head EVO Platform CI
was green when this block began. The live audit uses the root application and
the preserved local PostgreSQL V2 contract without
`EVO_UI_CONTRACT_FIXTURES`, demo seed, mock provider or fallback repository.
The route and state inventory is maintained in
`docs/frontend/V2_FRONTEND_COMPLETION_MATRIX.md`.

### Product and safety invariants

1. Keep exactly one staff product, one shell, one fixed-role policy, one active
   route per capability and PostgreSQL as the only V2 business authority.
2. Admin is the functional superset and may preview the exact Sales or
   Admissions interface. Sales cannot cross the audited handoff boundary;
   Admissions cannot perform Sales work before handoff.
3. `/applications`, `/documents`, `/visa` and `/finance` are operational queues;
   Student 360 remains the canonical case write surface. `/tasks` is the shared
   operational task queue. `/whatsapp` is the one role-scoped staff inbox.
4. Loading, empty, error, access-denied, blocked and not-configured states must
   be explicit. A configured provider is not described as verified; a provider
   previously accepted in a separate run is not described as available in a
   runtime that lacks its current server-side configuration.
5. Gemini is advisory. It may create a draft, but only a staff member may edit,
   approve and explicitly send the final text. No autonomous send, blind retry
   or fallback provider exists.
6. Preserve the accepted EVO visual language, responsive shell and semantic
   status treatment. Do not preserve stale Supabase/U2/PR copy, fixture labels,
   duplicate active routes or legacy runtime behavior for compatibility.
7. Keyboard navigation, visible focus, semantic headings, descriptive document
   titles, contrast, reflow and target sizing are release criteria, not polish.
8. Browser proof may read the real local V2 data and select Admin role previews.
   It must not send WhatsApp, request Gemini, write amoCRM, alter provider
   settings, deploy, or mutate real customer data.

### Delivery blocks

#### V2-11A — current-main matrix and implementation contract

- Record every core page, role, active route, code owner, runtime state and
  responsive/accessibility/provider observation.
- Attach only screenshots captured from the current no-fixture runtime.
- Separate verified defects from desired future work and from proof that is
  blocked by an absent external credential or service.

#### V2-11B — truthful shell, roles and navigation

- Make the visible navigation match the server-enforced fixed-role contract,
  including Visa and Finance for Admissions and Admin.
- Replace hard-coded global provider badges with runtime-derived,
  non-secret disclosure that distinguishes `not configured`, `configured but
  not verified here`, and a real blocked result.
- Remove stale active V2 references to Supabase, U2 delivery slices, old PRs or
  fixture-only behavior, without rewriting historical evidence.
- Give each core route a descriptive document title and one clear main heading.

#### V2-11C — core workflow usability, states and responsive access

- Make the Sales queue usable without a single unbounded mobile page while
  preserving cursor/query validation and one canonical read path.
- Keep Lead 360 and Student 360 information dense but navigable, with the
  required gate, owner, next action, blockers and linked work surfaces visible.
- Make a selected WhatsApp conversation reachable before or independently of
  a long mobile queue, while preserving the one-inbox authority.
- Add missing loading/error/not-found coverage at the closest useful route
  boundary, and verify safe recovery actions.
- Correct confirmed focus, target-size, contrast, label or heading defects using
  the existing design tokens and components.

#### V2-11D — real completion audit

- Run type checks, lint, focused outcome tests and a production build on the
  exact PR head with the repository Node 22 runtime.
- Start the real root app against the real local PostgreSQL V2 database with no
  fixture, demo, mock or fallback flag and verify Admin, Sales and Admissions.
- Check desktop (1280x720), tablet (834x1194) and mobile (390x844) for navigation,
  reflow, blocked/not-configured disclosure and the complete core journey.
- Capture fresh final screenshots and an explicit negative inventory for stale
  active frontend references. Record separately: code correctness, local real
  runtime proof, real provider proof and production proof.

### Merge and completion gates

Each V2-11 block is a small conventional-commit PR. A separate reviewer must
return `approved` for the exact PR head before the controller may merge it with
an exact-head guard. Exact-main CI must be green before the next block begins.
The long run must not claim frontend completion while a verified core route,
role, state, viewport, keyboard path or current-runtime provider disclosure is
unproved. An absent external provider credential blocks only that provider
proof; it does not block finishing the remaining local frontend work.

### V2-11 local frontend completion result

The implementation audit closed the verified local staff-frontend gaps on
current main `638a027fd9904e67105d2de51f559b2153752bc0`. PRs #509 through
#514 delivered the matrix, truthful shell, fixed-role navigation, bounded
mobile Sales and WhatsApp flows, nearest route states, Student 360 navigation,
mobile control sizing and dark-theme normal-text contrast. The accumulated
current-main implementation was then exercised through the root application
against the real local PostgreSQL V2 database without fixture, demo, mock or
fallback paths.

The real browser audit covered Admin, Sales and Admissions, direct negative
permissions, the contract/payment handoff evidence, Student 360 operational
modules, human-reviewed WhatsApp, safe empty and real database-error states,
light/dark themes and the required 1280x720, 834x1194 and 390x844 viewports.
Fresh current-main screenshots and the exact role/page/state measurements are
recorded in `docs/frontend/V2_FRONTEND_COMPLETION_MATRIX.md`.

This result proves code correctness and the sampled local real-runtime journey.
It does not prove Gemini, WAHA or amoCRM provider behavior and does not prove a
production deployment. No provider call, send, CRM write, customer-data
mutation or production change was attempted. Those external gates still
require their exact credential, authorization and resolvable target, while a
production check additionally requires separately authorized deployment.

### Current official implementation basis

- Next.js error boundaries and expected-error handling:
  <https://nextjs.org/docs/app/getting-started/error-handling>.
- Next.js route announcements, lint accessibility checks and semantic titles:
  <https://nextjs.org/docs/architecture/accessibility>.
- Next.js loading and navigation behavior:
  <https://nextjs.org/docs/app/getting-started/linking-and-navigating>.
- React action-state and form-status patterns:
  <https://react.dev/reference/react/useActionState> and
  <https://react.dev/reference/react-dom/hooks/useFormStatus>.
- Playwright accessibility testing and screenshots:
  <https://playwright.dev/docs/accessibility-testing> and
  <https://playwright.dev/docs/screenshots>.
- WCAG 2.2 reflow, target size and focus requirements:
  <https://www.w3.org/WAI/WCAG22/Understanding/reflow.html>,
  <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html> and
  <https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html>.
