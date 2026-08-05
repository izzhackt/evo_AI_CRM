# BW8 student document intelligence contract

Date: 2026-08-05 (Asia/Almaty)

Block-ID: `EVO-BW8-STUDENT-DOCUMENT-INTELLIGENCE-PLAN-2026-08-05`

## Outcome

BW8 is the bounded implementation lane for the student document workbench
requested by EVO Admissions. It connects the already-merged student-case,
country-requirement, private Storage, document-version, review, audit and
durable-queue foundations into one staff workflow:

`case checklist -> private intake -> validation -> extraction candidates ->
human confirmation -> canonical profile fields -> versioned DOCX/PDF export`.

The system must reduce repetitive data entry without allowing an LLM, OCR
provider or uploaded file to overwrite trusted student data by itself. A green
state means that the exact prerequisite checks for that state passed; it never
means merely that a file was selected or that a model returned text.

This plan changes execution priority. P4B mapping-selection implementation is
paused before any shared implementation PR or migration was merged. Its
docs-only contract remains valid and its local uncommitted worktree remains
untouched, but it no longer owns the next shared migration. After BW8 merges,
P4B must restart from fresh `origin/main`, recheck open ownership and select
the then-next free migration, expected `060` if BW8A consumes `059`.

## User outcome and accepted interaction

The existing `/documents` route is the sole staff document product surface.
BW8 replaces its honest legacy "files are not connected" state through the
existing Platform repository/session seams; it does not create a second app,
dashboard or parallel profile store.

The workbench has four connected regions:

1. case header with student, route, checklist version and honest completion;
2. versioned document checklist with upload/import action and one visible state
   per requirement;
3. evidence inspector for extracted field candidates, confidence, page/source
   anchor, conflicts and confirm/reject actions;
4. profile completion and versioned DOCX/PDF export.

Visual thesis: a calm white/graphite operational workspace with one existing
EVO accent color; semantic green/amber/red are reserved for states and are
always paired with text and icons. The UI is not a mosaic of decorative cards.

Interaction thesis: the checklist and selected evidence inspector stay in
context; persisted job events update the screen live through a reconnectable
server event stream, and normal refresh always reconstructs the same state.
Human confirm/reject actions are keyboard accessible, explicit and conflict
aware. A failed scanner, extractor or exporter keeps the allowed manual path
available and displays the exact retry or next action.

## Approved first checklist source

The first seeded overlay is the accessible China admissions checklist supplied
by the product owner:

<https://drive.google.com/file/d/1EKZOzQKli3Ub2tVxsX1qlpRj21kAJ6C9/view?pli=1>

Its 14 requirement labels are preserved as a versioned source-backed China
overlay:

1. passport;
2. China visa photos;
3. medical certificate;
4. diploma/certificate or current grade report;
5. current-study certificate;
6. criminal record certificate;
7. two teacher recommendations in English;
8. motivation letter/study plan in English;
9. video resume;
10. bank balance certificate;
11. notarized parental travel consent if the applicant is a minor;
12. original birth certificate if the applicant is a minor;
13. Application Form after contract/payment;
14. both parents' passports.

The source URL, source version, review status, reviewer role and review time are
stored with the overlay. Existing cases retain the version already applied.
The video-resume row is checklist/evidence-only in BW8: P2H currently permits
PDF/JPEG/PNG up to 25 MiB, so BW8 must not pretend that video bytes are
supported. Adding private video storage requires a separate reviewed security,
capacity, retention and preview contract.

The owner-supplied blank `EVO Admissions - Student Profile Form` is the initial
profile-export layout. Before it becomes a committed application asset, the
implementation PR must prove that it contains no student/customer data,
record its SHA-256, distill its field/layout contract, preserve the original
template unchanged and visually compare every rendered output page. The
exporter may fill a copy; it never edits the canonical template in place.

## Canonical data and state boundary

Existing canonical owners remain unchanged:

- amoCRM owns contact, lead, responsible Sales manager and sales stage;
- `platform.student_cases` owns the operational admissions case;
- versioned country requirements own expected checklist items;
- document slots/versions/reviews and private Storage own the submitted file
  lifecycle;
- Platform owns confirmed profile values and export versions;
- OpenAI or any later extraction provider owns no business field or decision.

BW8 adds an auditable evidence layer instead of writing model output directly
to `platform.student_profiles`:

- `document_extraction_runs`: immutable request identity plus queued,
  processing, succeeded, failed or superseded outcome;
- `document_extracted_facts`: typed candidate value, normalized value,
  confidence, document version, source/page locator, status and extractor
  policy/model version;
- `student_profile_field_values`: the current typed, confirmed value for the
  expanded profile field catalog, with optimistic revision and provenance;
- `student_profile_field_decisions`: append-only confirm, reject, manual edit
  and supersede evidence with actor, before/after, reason and request ID;
- `student_profile_exports`: immutable template/output/checksum/status evidence
  for DOCX and PDF generation.

The expanded field catalog covers the supplied form without putting passport
numbers or raw files in logs, URLs, Git or analytics: personal/contact and
language data; repeating education history; study goals; father, mother and
emergency-contact data; visa-refusal and health declarations; referral source;
and signature/date acknowledgement. Repeating education rows use one typed
array value rather than numbered columns. Sensitive identifiers are collected
only through approved private requirements and are masked by role.

Fields overlapping the minimized `platform.student_profiles` core are
projected deterministically after confirmation. Non-overlapping form fields
remain in the typed profile-field store. There is no second student identity,
checklist or document model.

## Status machines

The checklist presents these derived states:

- `missing`: no submitted current version;
- `received`: immutable bytes finalized but validation/extraction incomplete;
- `processing`: a persisted validation or extraction job holds a valid lease;
- `needs_review`: clean readable bytes produced proposed/conflicting facts or
  the document needs human-only review;
- `confirmed`: required deterministic checks and required human decisions for
  that item passed;
- `failed`: a persisted terminal attempt records an actionable failure;
- `not_required`: the versioned rule does not apply to this case.

These display states are projections; they do not replace existing document
slot, version, validation and review history. Refresh, worker restart and
reconnect must return the same result from persisted state.

`pending_information` is an internal applicability reason for a conditional
slot whose trusted date-of-birth/reference facts are not yet available. It is
not an eighth checklist display state; the read model projects it to
`needs_review` with the missing fact and next action.

Extraction candidates move only through `proposed`, `conflict`, `confirmed`,
`rejected` and `superseded`. A candidate from a rejected/correction-required or
superseded document version cannot update a profile. A stale profile revision
or newer confirmed source returns a visible conflict with no partial write.

## Intake, validation and live-work contract

BW8 reuses `reserve_document_upload`, private Storage upload,
`finalize_document_upload`, validation attestations, document review and
audited download grants. App code must never write `storage` tables directly.

Browser intake computes size, MIME and SHA-256, reserves an exact object, sends
the bytes to private Storage, then finalizes the matching reservation. A failed
finalization leaves the slot unpublished and records an actionable cleanup
state. Direct browser access to service credentials and cross-student objects
is denied.

Integrity verification and malware scanning happen before extraction or
preview. A declared MIME type, filename, test fixture or application flag is
not a scanner result. The implementation uses a real private scanner adapter
with evidence and fails closed if it is unavailable; it must not manufacture a
`clean` attestation. Scanner failure must not erase bytes or block authorized
manual metadata work.

Validation and extraction use the existing durable PGMQ ownership pattern with
bounded leases, idempotent request keys, retry budget and Admin-visible dead
letter. No in-memory-only queue or fire-and-forget route is accepted. A
reconnectable server-sent event endpoint exposes redacted persisted state
changes; polling/read-model fallback remains available.

## Drive and extraction provider contract

Drive is an import source, not a runtime database. Binary Drive files are
downloaded by exact file ID; Google Workspace documents are exported to PDF.
The adapter supports shared-drive semantics and fails clearly for inaccessible
files, unsupported types, resource-key requirements or export limits. A
service account can read only files explicitly shared with it (or an approved
Shared Drive/domain-delegated scope); no broad personal Drive crawling is
authorized.

Primary implementation references:

- Google Drive `files.get`: <https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get>
- Google Workspace export: <https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export>
- Drive least-privilege scopes: <https://developers.google.com/workspace/drive/api/guides/api-specific-auth>
- Drive shared-drive support: <https://developers.google.com/workspace/drive/api/guides/enable-shareddrives>

OpenAI extraction uses the official Node SDK, Responses API file/image input
and strict structured output. PDFs are sent as `input_file`; accepted images
as `input_image`. Requests use `store: false`. Temporary provider files receive
a bounded expiry and are deleted best-effort after a terminal run. Provider
file/response IDs may be stored as restricted evidence; prompts, logs and UI
must not expose raw document bodies or sensitive values.

Primary implementation references:

- Responses file input: <https://developers.openai.com/api/docs/guides/file-inputs>
- vision input: <https://developers.openai.com/api/docs/guides/images-vision>
- Structured Outputs: <https://developers.openai.com/api/docs/guides/structured-outputs>
- data controls and retention: <https://developers.openai.com/api/docs/guides/your-data>

No real student document may be sent to OpenAI until the Product/Legal/Data
owner approves that processing purpose, provider retention posture and allowed
field classes. Before that decision, real-provider proof is limited to the
public checklist and the verified blank template; local deterministic fixtures
may test all other behavior. Missing provider approval/configuration produces a
truthful `manual extraction required` state, not fake output.

The structured result is validated twice: strict schema/type validation at the
adapter boundary, followed by deterministic field rules for dates, names,
country codes, phone/email shape, document-to-requirement compatibility,
minor-only applicability and cross-document consistency. Confidence is review
priority, not truth. Low confidence and contradictory candidates are never
auto-confirmed.

## Deterministic profile and export contract

Manual questionnaire entry and confirmed extracted facts use the same typed
field commands and append-only decision ledger. The exporter reads one exact
profile revision and one exact template version, maps approved values to the
template contract, and records the input manifest, checksums and outcome.

DOCX output is generated without rasterizing the document. PDF output uses a
private LibreOffice-compatible conversion service or sidecar; development may
use headless LibreOffice. Conversion failure leaves the DOCX available and the
PDF honestly failed/retryable. Neither format is called approved or signed;
both remain generated drafts until an authorized staff decision. Export and
download use private Storage and audited short-lived access.

## Authorization and privacy

- Admin and assigned Curator may intake, review candidates, edit the operational
  profile and generate exports within current live authority.
- Sales receives only the already-approved limited student summary; it cannot
  read private document bytes or sensitive family/health/identifier fields.
- Finance receives no document/profile access beyond its separately approved
  evidence scope.
- Student may access only self-scoped document versions/profile fields and may
  not confirm staff review decisions.
- Cross-organization, cross-student, stale membership, blocked membership,
  anon and direct browser table mutations fail closed.
- Raw bytes, extracted sensitive values and provider payloads are absent from
  application logs, error trackers, analytics, URLs, Git fixtures and CI
  artifacts.

## Ordered implementation blocks and ownership

Only one implementation PR may be open at a time. Every block starts from
fresh `origin/main`, rechecks migration/file ownership and receives exact-head
independent review before a separate controller merges it.

### BW8A - schema, RLS and deterministic domain

Expected next-free migration: `059`, only after exact-main recheck.

Authorized files:

- one new forward-only Supabase migration;
- focused Supabase inventory/RLS/concurrency tests;
- typed document/profile domain modules and focused unit tests;
- the current status/evidence ledger for this block.

Exit: contiguous migrations; immutable extraction/decision/export ledgers;
typed expanded field catalog; same-org/object-scope RLS; Admin/Curator positive
and role/cross-org/stale-authority negative tests; idempotency and stale
revision/concurrency proof; no provider call or UI claim.

#### BW8A candidate evidence ledger

- Status: implementation candidate in PR #120; exact-head independent review,
  controller merge and exact-main CI remain pending.
- Starting main: `791a43aaa6d02aa6b72429121680939163ccc601`.
- Additive migration:
  `059_platform_student_document_intelligence.sql`, SHA-256
  `785ebd0d3ddd0602a14a8f893dba940291a3ffc073124aeaad8d7b0ad6028d12`.
- The migration adds the missing typed candidate/decision/current-value/export
  evidence, version-pinned China overlay, reviewed applicability recompute,
  RBAC v12, private export Storage contract and document validation,
  extraction and export work kinds on the existing durable-work ledger.
- `npm run test:security` passed on a fresh disposable PostgreSQL database with
  migrations 001-059, exact inventory/RLS suites and real two-session races for
  replay, stale revision, overlay recompute, reservation renewal, latest-only
  finalize and one-time download consumption.
- `npm run test:unit` passed 171/171; focused domain coverage keeps the 62-field
  TypeScript and SQL catalogs aligned and validates deterministic normalization,
  applicability, projection, lifecycle and conflict guards.
- Root lint, Next route generation, strict TypeScript and production build
  passed under Node `22.23.1`; EVO Inbox schema-contract compatibility passed
  21/21.
- The connected local Supabase reset was not claimed in this candidate because
  another live `evo-platform-local` singleton held the reset lock; the lock was
  not removed or interrupted. Disposable PostgreSQL proof is complete, while
  exact-head CI and independent review remain mandatory.
- No scanner, Drive/OpenAI call, UI upload, managed apply, production mutation
  or real student-data processing is claimed by BW8A.

### BW8B - private intake, scanner and durable worker

Authorized files:

- Platform document intake/repository/actions;
- durable queue lease/finish integration and worker entrypoint;
- private scanner adapter/config and Compose/build surfaces;
- focused upload/scanner/worker tests and runbook/evidence updates.

Exit: real local private upload/reserve/finalize/download; SHA/type/size checks;
real scanner clean and infected/error evidence; worker restart/retry/dead-letter
proof; no extraction before clean attestation; exact cleanup; no public scanner
or Storage port.

### BW8C - Drive/OpenAI extraction adapters

Authorized files:

- server-only Drive and OpenAI adapters, schemas and configuration validation;
- extraction orchestration and deterministic validators;
- provider contract tests, redaction tests and evidence ledger;
- safe environment examples and operator runbook.

Exit: inaccessible/unsupported Drive failures, blob download and Google Doc
export contracts, strict OpenAI structured output, provider expiry/deletion
attempt, no response storage, idempotent retry, conflict/low-confidence path,
manual degradation and secret/browser-bundle scan. Real calls may use only the
public checklist and verified blank template until student-data approval.

### BW8D - accepted workbench, live state and exports

Authorized files:

- existing `/documents` staff routes/actions and Platform document components;
- existing Student 360/Portal read models only where the same state is surfaced;
- persisted event-stream/read-model endpoints;
- template/export modules and the sanitized immutable template asset;
- focused unit, browser, accessibility and document-render evidence.

Exit: the accepted UI handles missing/received/processing/needs-review/
confirmed/failed/not-required; upload and Drive import use real repositories;
candidate evidence confirms/rejects atomically; manual edits share provenance;
page refresh/reconnect reconstructs live state; profile DOCX and PDF are
generated from an exact revision; keyboard/mobile/desktop and cross-student
denial pass; every template/output page is inspected.

### BW8E - integrated proof and completion audit

Authorized files are tests, runbooks and evidence/status docs unless a failed
acceptance requires a separately planned repair. Exit requires one synthetic
two-student local Supabase scenario across checklist, upload/import, scan,
extract, conflict, human confirmation, profile and export; a second physical
worktree rerun; all exact-head CI; independent review; no unexplained skipped
gate. Managed Supabase, production deployment and real-student provider use
remain separate authorization gates.

## Acceptance matrix

The complete BW8 lane must prove at least:

1. the 14-item China overlay is source/version backed and case-pinned;
2. conditional minor requirements resolve deterministically;
3. upload and Drive import publish only an exact finalized private version;
4. invalid MIME/size/hash, infected bytes and unavailable scanner fail closed;
5. worker restart/retry/dead-letter does not duplicate terminal outcomes;
6. extraction produces typed candidates with evidence and never direct profile
   writes;
7. low-confidence, conflicting, stale-revision and rejected-version candidates
   cannot silently replace confirmed values;
8. Admin/assigned Curator confirmation and manual edit append auditable
   before/after decisions;
9. all other roles, anon, cross-org and cross-student access are denied;
10. refreshed/reconnected UI derives identical persisted states;
11. AI/Drive/export failure leaves a truthful manual path;
12. exact profile revision produces deterministic versioned DOCX and PDF
    evidence without mutating the template;
13. logs, browser bundles, fixtures and CI artifacts contain no secrets or raw
    student data;
14. local and CI gates pass on the exact independently reviewed SHA.

## Validation and evidence boundary

This docs-only plan amendment authorizes no migration, application code,
provider credential/call, real student upload, managed Supabase change,
production deployment or runtime mutation. Its proof is document integrity,
traceability, independent exact-head review and green exact-main CI.

Later BW8 implementation proof must distinguish:

- deterministic fixtures and synthetic identities;
- real local Supabase/Auth/RLS/Storage/PGMQ/scanner execution;
- real provider calls using only authorized non-sensitive sources;
- managed/staging/production proof, which remains blocked until separately
  authorized and exercised.

## Rollback

This amendment is documentation-only and can be reverted before BW8
implementation. Each implementation block is additive. Runtime rollback stops
new intake/extraction/export consumers and returns the UI to a truthful manual
state; it does not delete document versions, extraction evidence, confirmed
profile history, export manifests or audit records. Irreversible automatic
retention/deletion remains prohibited until the existing Legal/Data decision.
