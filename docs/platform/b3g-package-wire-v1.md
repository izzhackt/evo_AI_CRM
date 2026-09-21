# B3g.1 — package wire v1

Frozen before implementation on 2026-09-21, based on merged #998.
Migration 232 only; 230/231 belong to other owners. This specifies source behavior,
not executed database or UI evidence. The functional contract remains
[B3g](b3g-program-package-contract.md).

All objects below have exactly the listed keys. `?` means explicit JSON null,
never an omitted field. UUIDs are lowercase canonical UUID strings; positive
versions/byte sizes are decimal strings bounded by signed bigint. Timestamps
follow the existing 228 codec. Arrays preserve their order, have unique item IDs,
and contain at most 100 items unless the paginated limit is stated.
Existing 228 File, Selection, Definition, MaterialSnapshot, Review, Submission,
ItemState and `{createdAt,id}` Cursor retain their exact current wire shapes.
Requirements means the 226 V2 requirements DTO. Do not nest the 228 Documents
aggregate: it has a 50-item client bound while packages allow 100 requirements.

## Commands

```text
Target = {studentCaseId, applicationId}
SelectionItem = {requirementItemId, selection: Selection, expectedPreviousSubmissionId: UUID?}
SubmitIntent = Target + {requirementsRevisionId, expectedPreviousPackageId: UUID?,
  items: SelectionItem[1..100], requestId}
DocumentReviewExpectation = {requirementItemId, submissionId, expectedReviewId: UUID?}
ReuseApproval = DocumentReviewExpectation + {sourceSubmissionId, sourceReviewId}
ReviewIntent = Target + {packageId, expectedPreviousReviewId: UUID?,
  decision: approved|correction_required, reason: string?, affectedItemIds: UUID[0..100],
  documentReviews: DocumentReviewExpectation[1..100], reuseApprovals: ReuseApproval[0..100], requestId}
```

Approved reason is null and affectedItemIds is empty. Correction requires a
nonblank reason of at most 5000 Unicode scalars, excluding U+0000. Both clients
reject U+0000 before persisting an intent because PostgreSQL JSONB rejects it
before review or recovery can execute ([PostgreSQL 17 JSON types](https://www.postgresql.org/docs/17/datatype-json.html)).
Other supported control characters remain permitted. Affected items may be empty
for a whole-composition issue. Reuse is explicit and only for approval; its source
submission must differ from the current submission. Expectations
cover the complete package in its stored order. Reuse entries must be an exact
subset of that vector; the server proves predecessor lineage and all invariants.

## Stored decision evidence and readers

```text
ReviewEvidence = {requirementItemId, submissionId, review: Review?,
  reusedFromSubmissionId: UUID?, reusedFromReview: Review?}
PackageReview = {packageReviewId, packageId, decision, reason, affectedItemIds,
  documentReviews: ReviewEvidence[1..100], reviewedAt}
PackageSummary = {packageId, requirementsRevisionId, requirementsRevisionVersion,
  origin: evo_starter|staff_confirmed, configurationState: needs_confirmation|confirmed,
  packageVersion, previousPackageId: UUID?, compositionSha256, submittedAt,
  itemCount: integer[1..100], isCurrentRequirements: boolean, latestReview: PackageReview?}
Program = {institutionId, publicationId, programId, intakeId,
  universityTitle, programTitle, intakeLabel}
PackageItem = {packageItemId, requirementItemId, definition: Definition,
  materialSnapshot: MaterialSnapshot?, selection: Selection, submission: Submission}
CurrentWarning = {requirementItemId, submissionId,
  reason: review_changed|file_unavailable, currentReview: Review?}
Detail = {protocolVersion: 1} + Target + {package: PackageSummary, program: Program,
  items: PackageItem[1..100], currentWarnings: CurrentWarning[0..200]}
ReadinessSelection = SelectionItem + {file: File?, submissionId: UUID?, reasons: ReadyReason[]}
Readiness = {protocolVersion: 1} + Target + {requirements: Requirements,
  documentItems: ItemState[0..100], latestPackage: PackageSummary?,
  selections: ReadinessSelection[0..100], missingRequiredItemIds: UUID[0..100],
  reasons: ReadyReason[], canSubmit: boolean}
ReadyReason = requirements_unavailable|empty_composition|missing_required|
  material_unavailable|file_unavailable|previous_submission_changed
History = {protocolVersion: 1} + Target + {packages: PackageSummary[0..50], nextCursor: Cursor?}
ReviewHistory = {protocolVersion: 1} + Target + {packageId,
  reviews: PackageReview[0..50], nextCursor: Cursor?}
QueueItem = Target + {studentDisplayName, program: Program, package: PackageSummary}
Queue = {protocolVersion: 1, items: QueueItem[0..50], nextCursor: Cursor?}
Notification = {protocolVersion: 1, notificationId} + Target +
  {packageId, packageReviewId, review: PackageReview}
```

Origin/configuration are paired as in 226. Titles are nonblank strings. Program
institutionId/publicationId/intakeId are UUIDs; programId preserves the existing
214 slug (1–64 characters matching `^[a-z0-9][a-z0-9-]*$`), not a UUID.
Readiness validates required and explicitly included items. Aggregate requirements
state caused only by an excluded optional item does not block submission; the
revision must exist, and starter needs_confirmation is not an extra gate.
Reuse reference fields are both null or both populated. An approved PackageReview
has approved evidence for every included file. Its evidence is frozen; the
PackageItem submission contains the current individual review. A later different
review or unavailable file becomes a currentWarning, never a rewritten decision.
Warnings are unique by item/reason and must match the detail's current submission.
Items, evidence, itemCount, revision, slot and selected version references agree.
History/review-history/queue are descending by `(timestamp, UUID)` and nextCursor
equals the last returned row when present. Default page size 20, maximum 50.

## Receipts and recovery

```text
SubmitReceiptItem = {packageItemId, requirementItemId, documentSlotId, documentVersionId, submissionId}
SubmitReceipt = {protocolVersion: 1, requestId} + Target + {packageId,
  requirementsRevisionId, packageVersion, compositionSha256, submittedAt,
  reused: boolean, items: SubmitReceiptItem[1..100]}
ReviewReceipt = {protocolVersion: 1, requestId} + Target + {packageId, packageReview: PackageReview}
Recovery = {protocolVersion: 1, operation: submit|review, requestId} + Target + {
  status: committed|not_written, receipt: SubmitReceipt|ReviewReceipt|null}
```

Receipt identity/composition/vector must match the frozen intent. Recovery has
the corresponding receipt only for committed, otherwise null. It obtains the
request lock before proving absence, rechecks current owner/scope and exact
stored intent, and does not repeat a mutation. Unknown results, malformed payloads,
conflicts and revoked access retain pending state. Only a valid matching receipt
or this authoritative not_written permits clearing it. UI recovery inventory is
owner-scoped and detached from the current queue or requirements revision.
Both recovery outcomes echo requestId and Target and are checked against the
frozen intent; a delayed not_written response for another request cannot clear it.

## Ordinary authenticated RPCs

| RPC | Parameters |
| --- | --- |
| application_package_readiness_v1 | p_student_case_id UUID, p_application_id UUID, p_selections JSONB default [] |
| application_package_submit_v1 | p_intent JSONB |
| application_package_review_v1 | p_intent JSONB |
| application_package_recover_v1 | p_operation TEXT, p_intent JSONB |
| application_package_detail_v1 | p_student_case_id UUID, p_application_id UUID, p_package_id UUID |
| application_package_history_v1 | p_student_case_id UUID, p_application_id UUID, p_cursor JSONB default null, p_limit INTEGER default 20 |
| application_package_review_history_v1 | p_student_case_id UUID, p_application_id UUID, p_package_id UUID, p_cursor JSONB default null, p_limit INTEGER default 20 |
| application_package_queue_v1 | p_cursor JSONB default null, p_limit INTEGER default 20 |
| application_package_notification_v1 | p_notification_id UUID |

Web uses existing cookie-authenticated server actions; iPhone calls the same RPCs
under its ordinary session. No new HTTP transport, Storage or service-role reader.
Existing document.read.full/upload/review permissions and Student ownership apply;
staff preview cannot mutate. SQL remains the final authority, including unassigned
case visibility for eligible staff. Recover submit/review checks that operation's
authority as well as owner. Audit action segments contain only lowercase letters
and digits separated by dots; existing audit constraints stay intact.

SQL errors: 42501 `application_packages_unavailable`; 22023
`application_package_invalid_intent`; PT409 `application_package_intent_conflict`,
`application_package_stale_requirements`, `application_package_previous_package_changed`,
`application_package_previous_submission_changed`, `application_package_previous_review_changed`,
`application_package_document_review_changed`, `application_package_not_ready`,
`application_package_review_not_ready`, `application_package_reuse_unavailable`.
Inherited 228 failures remain safely mapped; raw provider errors are never UI text.
No mutation error alone is treated as not_written. Cache refresh failure after
a valid receipt does not turn the successful command into an unknown outcome.
