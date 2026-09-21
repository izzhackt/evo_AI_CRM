# CRM-09e: scoped authority for existing-payment receipts

Precode, 2026-09-21. Baseline `35a11aa02b1445d18980a91ba669649e2d61ee6b`. ROOT reserves migration **229**, after B228; this document does not authorize apply or runtime. No new UI, payment event, financial calculation, Storage bucket, or provider integration.

## Observed failure and scope

Actual local QA has **zero successful receipt uploads**. Initial unhydrated submit performed native GET without POST; hydration hardening followed. One subsequent POST hit proxy403; exact receipt routes were connected. On35a11aa0 the handler's service-role SELECT payment_events failed42501 and was masked as404 payment_event_not_found. Root reports final283-table/financial/Storage/Auth-session parity against original baseline after logout and owned-runtime shutdown. These are negative-path/no-effect proofs, not successful scanner/Storage/metadata/download acceptance. Payment receipt download also directly selects its table; denial there is a source-derived risk, not an executed result.

## Existing contracts to preserve

- HTTP POST `/api/v2/payment-receipts/{paymentEventId}`; GET `/api/v2/payment-receipt-files/{studentCaseId}/{fileId}/download`; exact UUIDv1–5 routing and ordinary staff-cookie proxy remain.
- Migration189 `staff_case_agreement_v1`: resource-scoped read authority and can_write (`case.update.append` OR responsible Sales on pending case). Reuse this policy; role labels alone never grant access. Do not broaden financial permissions.
- `record_payment_receipt_file_metadata` remains service-only, additive, payment-only; receipt does not alter payments/obligations/evidence. Existing request replay/result shape and historical receipts remain compatible.
- **Contract-file functions and route behavior stay untouched**, including record_case_contract_file_metadata and existing signAndRedirect contract branch. Their separate connectivity/lookup gaps remain recorded, not silently fixed here.
- Existing bytes/MIME/size/scanner checks, private bucket,60-second signed URL and cleanup behavior remain. No blanket SELECT grant, direct-table access, service-role actor impersonation, public route or new user identities.

## New narrow authenticated readers

Names proposed for229:

1. `platform.staff_payment_receipt_upload_target_v1(p_payment_event_id UUID) RETURNS JSONB`: authenticated only. Resolve current staff authority; derive organization/case from exact event, reject refund; require current case-agreement read access AND can_write, as current HTTP path does. No caller-supplied organization/member authority. Return exactly `{organization_id,student_case_id,payment_event_id}` UUID strings; no money, customer details or storage path. Missing/inaccessible target fails closed without cross-tenant existence disclosure.
2. `platform.staff_payment_receipt_download_target_v1(p_student_case_id UUID,p_file_id UUID) RETURNS JSONB`: authenticated only. Reuse staff_case_agreement_v1 read authority (does not require can_write); bind receipt to exact case, organization and payment event. Return exactly `{organization_id,student_case_id,payment_receipt_file_id,storage_object_name}`. No bulk listing, arbitrary table/bucket selector or caller path. Source Storage object comes only from stored receipt. Read-only staff can download where existing case read policy allows; Student cannot use staff readers.

Both SECURITY DEFINER, empty search_path, fully qualified objects; revoke PUBLIC/anon/service_role/auth-admin execute and grant authenticated only. They use the actual caller JWT, not a service-role call with fake actor arguments. Preserve current actor/profile/organization activity checks. Reusing staff_case_agreement_v1 internally may be less lightweight than a bespoke predicate but avoids policy divergence; returned public JSON remains minimal. No new table or capability is presumed necessary.

## Metadata write and delegated principal

229 forward-updates ONLY receipt metadata function where necessary. Before both a fresh insert **and replay return**, validate actual active staff membership/profile/organization from p_uploaded_by_membership_id, exact payment organization/case/type, and current read+write policy. Service role is transport authority, not evidence that this principal may access the case. The handler takes membership only from resolvePlatformActor; client cannot supply it.

Do not call auth.uid-dependent staff_case_agreement_v1 under service_role and mistake that for delegated authority. Implement a narrowly scoped private delegated check using existing staff_membership_identity/staff_can_access and the exact resource/read-policy equivalents, including responsible pending Sales; independently review equivalence to189. Lock relevant mutable authority/case rows consistently with existing finance/request lock order so revocation concurrent with finalization cannot pass a stale pre-upload check. Do not grant execute on private helpers.

Historical replay digest/shape must not be rewritten. For replay, also bind existing resulting receipt to the requested principal/payment/case and full immutable metadata (filename, MIME, size, hash, object name); mismatched reuse is conflict, not another success. Preserve same-request same-payload receipt return when current principal remains authorized; revoked principal is denied even if the historical request succeeded. No second receipt/audit on replay. Check actual existing audit/result columns before coding; if faithful compatibility cannot be expressed, stop for amendment rather than weaken principal binding or fabricate an admission token.

This is service-delegated principal revalidation, not a newly claimed browser-token cryptographic attestation. Trusted service credentials retain their existing backend role; no extra public service access is introduced.

## Handler and decoder integration

Replace upload's direct payment_events lookup with cookie-authenticated upload target RPC before file/scanner/Storage work. Validate exact bounded scalar JSON: plain object, exact key set, UUID syntax and IDs equal requested/actor context. Download receipt branch uses its authenticated target reader; validate same bindings and bounded nonempty object name under existing payment-receipts/{org}/{case}/ prefix; reject control characters, traversal or unexpected shape. Do not expose target storage metadata in HTTP JSON/logs. Service client performs Storage operation only after accepted target.

Preserve201 existing metadata receipt body and307 download. Malformed IDs400; unauthenticated401; explicit SQL42501 authority denial403 with existing safe message; missing target may use same closed denial. SQL/transport/config failures and malformed DTO are503, never misleading404 empty. Unexpected/unknown upload outcome retains UI no-auto-retry behavior. Metadata denial after upload must preserve existing owned-object cleanup handling and report actual failure, never201. No claimed idempotency for the whole Storage upload; replay testing covers metadata RPC only.

## Required focused checks and later actual QA

Pure decoder: exact keys/types/bounds/request binding, wrong case/org/versionless IDs, invalid path. SQL/source: authenticated staff success; Student/anon/service direct reader denial; foreign org/case; refund; read-only allowed download/denied upload; pending responsible Sales versus other Sales; inactive/revoked profile/membership/permission before write and before replay; payload/principal request conflicts; exact replay one row/audit; no monetary mutations. Check grants, search_path and legacy function/receipt compatibility.

Handler checks distinguish authority denial from infrastructure503 without mocked success being called business acceptance. Later root-owned actual ordinary Admin upload of the retained technical QA artifact, metadata/readback and download, with exact existing-payment and full-state observers; negative roles only within authorized local QA packet. No new payment, fictional receipt facts or extra actors. Source lint/typecheck and relevant tests precede independent exact-head review; migration229 apply waits B228 and explicit coordinated window. Current precode is not runtime readiness.


## 2026-09-21 — CRM-09e actual-path blocker: saved versions without a current pointer

Ordinary local Admin opening the existing B209 Student1 case on source
fcfabafa/schema229 hit the real profile error boundary before any receipt upload.
The authenticated staff document-workspace RPC returned200: both228 saved file
versions are finalized/verified/clean and download-ready, but `is_current` is NULL
because migration113 projects `slot.current_version_id = version.id` while228
intentionally leaves the legacy pointer absent. The strict TypeScript boolean
decoder rejected that legitimate SQL result and crashed the entire case.

Before coding, extend this receipt-path fix narrowly: accept literal NULL only
as `isCurrent:false`; preserve exact keys, rejection of missing/string/numeric
flags, other boolean/security guards and slot current-ID/number consistency.
No new migration, current pointer, approval, download authority or file rewrite.
Add regression coverage for no-current versions and malformed/current-pointer
mismatches, then reopen this same actual case and complete the ordinary receipt
journey. Source229 apply proof remains atfcfabafa with unchanged SQL; subsequent
UI evidence must record its newer runtime head separately, never relabel the apply.


## 2026-09-21 — CRM-09e actual audit-action failure and forward migration230

Actual ordinary Admin upload on e17e1e52/schema229 reached real ClamAV and
Storage (POST200), then PostgreSQL rejected `case.payment_receipt.upload` against
the existing041 `audit_events_action_check`: every dot-separated action segment
permits lowercase letters/digits, not underscores. The handler returned503 and
removed only its new object (DELETE200). Full287-table, financial, audit, Storage,
prefix and Auth-session before/after comparisons are exactly equal; no successful
receipt exists and no retry has been performed.

Before coding, ROOT reserves230 for a forward-only fix of this receipt function's
two internal action literals to canonical `case.payment.receipt.upload`. Preserve
the041 constraint,229 SQL/ledger, all auth/lock/idempotency/body/ACL semantics,
receipt result and financial data. Assert the expected two replacements and exact
function identity; fail on an unexpected predecessor. No contract-file expansion.
Use the canonical action in later actual metadata replay/evidence. The former
action could not persist under the unchanged mandatory audit constraint.

Website receiver PR996 moves its unapplied migration230 to231; B3g package
precode moves231 to232. OnlyROOT applies, in order. Verify230 on the actual local
229 baseline with rollback first, canonicalCLI apply once, preserved full state,
then a separately recorded new ordinary UI attempt. The prior503 remains failure
evidence; never relabel it or rewrite migration229.

Implementation reference (checked2026-09-21): PostgreSQL17 [CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html) preserves ownership/permissions with CREATE OR REPLACE; other attributes come from the definition. The forward patch therefore reuses the complete existing definition and verifies full metadata/ACL equality apart from its two action literals.


## 2026-09-21 — bounded local acceptance

[Actual QA report](payment-receipt-local-qa-2026-09-21.md) records the ordinary
Admin upload/download on source3e83d495 and local001–230, retained negative
evidence, six target probes, exact replay/size conflict and four row-lock barriers.
Other branches listed above remain unverified by this packet, including inactive
uploader because the last-live-admin invariant prevents that dataset mutation.
No safeguard was weakened and no new identity was created. The current owned
session was logged out; one identified earlier orphan remains. The full local
runtime is released to A15f. This is not production or full financial acceptance.
