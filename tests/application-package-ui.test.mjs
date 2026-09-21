// Pure command/selection contracts; this does not claim authenticated UI acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildApplicationPackageSubmitIntent as submit,
  buildApplicationPackageReviewIntent as review,
  applicationPackageReviewBlockers as blockers,
  applicationPackageReuseCandidates as candidates,
} from '../src/lib/portal/application-package-ui.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/application-packages-v1.json', import.meta.url), 'utf8'));
const copy = value => structuredClone(value);
const id = n => `b3a20000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = overrides => ({ decision: 'approved', reason: null, affectedItemIds: [], reuseApprovals: [], requestId: id(1), ...overrides });

test('Student command preserves explicit preview order and requires no earlier staff approval', () => {
  const value = copy(fixture.readiness);
  assert.ok(value.documentItems.every(item => item.submission === null));
  value.selections.reverse();
  const result = submit(value, id(1));
  assert.ok(result);
  assert.deepEqual(result.items, value.selections.map(({ requirementItemId, selection, expectedPreviousSubmissionId }) => ({ requirementItemId, selection, expectedPreviousSubmissionId })));
  assert.equal(result.requirementsRevisionId, value.requirements.revisionId);
  assert.equal(result.expectedPreviousPackageId, value.latestPackage?.packageId ?? null);
  assert.equal(submit({ ...value, canSubmit: false }, id(1)), null);
});

test('a newer saved draft cannot silently replace the explicitly previewed version', () => {
  const value = copy(fixture.readiness), item = value.documentItems[0];
  const original = copy(value.selections[0].selection);
  item.savedDraft = { uploadContextId: id(2), requirementsRevisionId: value.requirements.revisionId,
    requirementItemId: item.requirementItemId, documentSlotId: item.documentSlotId,
    admittedAt: '2026-09-21T11:00:00Z',
    file: { ...copy(value.selections[0].file), documentVersionId: id(3), versionNo: '2', finalizedAt: '2026-09-21T11:00:00Z' } };
  assert.deepEqual(submit(value, id(1))?.items[0].selection, original);
});

test('all 100 previewed items survive command construction', () => {
  const value = copy(fixture.readiness);
  value.requirements.origin = 'staff_confirmed'; value.requirements.configurationState = 'confirmed';
  const requirement = copy(value.requirements.items[0]), document = copy(value.documentItems[0]), selection = copy(value.selections[0]);
  value.requirements.items = []; value.documentItems = []; value.selections = [];
  for (let i = 0; i < 100; i++) {
    const itemId = id(100 + i), slotId = id(300 + i);
    value.requirements.items.push({ ...copy(requirement), requirementItemId: itemId, documentSlotId: slotId,
      requirementKey: `qa.item${i}`, compatibilityKey: `qa.item${i}`, position: i + 1 });
    value.documentItems.push({ ...copy(document), requirementItemId: itemId, documentSlotId: slotId });
    value.selections.push({ ...copy(selection), requirementItemId: itemId });
  }
  assert.equal(submit(value, id(1))?.items.length, 100);
  assert.equal(submit(value, id(1))?.items.at(-1).requirementItemId, id(199));
});

test('excluded optional configuration failure does not become a package submission gate', () => {
  const value = copy(fixture.readiness), optional = { ...copy(value.requirements.items[0]),
    requirementItemId: id(500), documentSlotId: id(501), requirementKey: 'qa.optional', compatibilityKey: 'qa.optional',
    position: 3, required: false, slotStatus: null, unavailableReasons: ['application_link_missing'], technicalAvailability: 'unavailable' };
  value.requirements.origin = 'staff_confirmed'; value.requirements.configurationState = 'confirmed';
  value.requirements.items.push(optional);
  value.requirements.state = 'needs_configuration'; value.requirements.configurationReasons = ['material_association_unavailable'];
  value.documentItems.push({ ...copy(value.documentItems[0]), requirementItemId: optional.requirementItemId,
    documentSlotId: optional.documentSlotId, reusableVersions: [], canUpload: false, canSubmit: false });
  assert.equal(submit(value, id(1))?.items.length, 2);
});

test('staff review binds current file reviews while preserving the previous package decision', () => {
  const value = copy(fixture.detail), first = value.items[0];
  first.submission.review.reviewId = id(600);
  value.currentWarnings = [{ requirementItemId: first.requirementItemId, submissionId: first.submission.submissionId,
    reason: 'review_changed', currentReview: copy(first.submission.review) }];
  const result = review(fixture.target, value, input());
  assert.ok(result);
  assert.equal(result.expectedPreviousReviewId, value.package.latestReview.packageReviewId);
  assert.equal(result.documentReviews[0].expectedReviewId, id(600));
  assert.equal(result.documentReviews.length, value.items.length);
  assert.notEqual(value.package.latestReview.documentReviews[0].review.reviewId, id(600));
  assert.equal(review({ ...fixture.target, applicationId: id(601) }, value, input()), null);
});

function awaitingReview() {
  const value = copy(fixture.detail);
  value.package.latestReview = null;
  value.items[0].submission.review = null;
  value.currentWarnings = [];
  return value;
}

function previousEvidence(detail) {
  const item = detail.items[0], submission = { ...copy(item.submission), submissionId: id(700),
    requirementsRevisionId: id(701), requirementItemId: id(702),
    review: { reviewId: id(703), decision: 'approved', reason: null, reviewedAt: '2026-09-21T09:00:00Z' } };
  return { id: submission.submissionId, kind: 'submission', createdAt: submission.submittedAt,
    requirementsRevisionId: submission.requirementsRevisionId, requirementItemId: submission.requirementItemId,
    definition: copy(item.definition), materialSnapshot: copy(item.materialSnapshot), upload: null, submission };
}
const history = (detail, events) => ({ protocolVersion: 1, studentCaseId: detail.studentCaseId,
  applicationId: detail.applicationId, requirementItemId: null, events, nextCursor: null });

test('correction remains possible before individual approval, but whole approval is blocked', () => {
  const value = awaitingReview();
  assert.equal(blockers(value)[0].reason, 'document_unreviewed');
  assert.equal(review(fixture.target, value, input()), null);
  const corrected = review(fixture.target, value, input({ decision: 'correction_required', reason: 'Нужна другая страница', affectedItemIds: [value.items[0].requirementItemId] }));
  assert.ok(corrected);
  assert.equal(corrected.documentReviews[0].expectedReviewId, null);
  assert.equal(review(fixture.target, value, input({ decision: 'correction_required', reason: 'Fix\u0000page' })), null);
});

test('explicit candidate freezes its provenance without claiming client-side approval', () => {
  const value = awaitingReview(), source = previousEvidence(value);
  const matches = candidates(value, history(value, [source, source]));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].source, source);
  assert.equal(matches[0].approval.expectedReviewId, null);
  const result = review(fixture.target, value, input({ reuseApprovals: [matches[0].approval] }));
  assert.ok(result);
  assert.equal(result.documentReviews[0].expectedReviewId, null);
  assert.equal(result.reuseApprovals[0].sourceReviewId, source.submission.review.reviewId);
  assert.equal(value.items[0].submission.review, null);
});

test('reuse candidates exclude wrong scope, changed material/definition/slot/file, self and negative evidence', () => {
  const value = awaitingReview(), source = previousEvidence(value);
  assert.deepEqual(candidates(value, { ...history(value, [source]), applicationId: id(800) }), []);
  for (const mutate of [
    row => { row.definition.instructions = 'Different instructions'; },
    row => { row.materialSnapshot.sourceInstructions = 'Different origin'; },
    row => { row.submission.documentSlotId = id(801); },
    row => { row.submission.file.documentVersionId = id(802); },
    row => { row.submission.submissionId = value.items[0].submission.submissionId; },
    row => { row.submission.review.decision = 'correction_required'; row.submission.review.reason = 'Fix'; },
    row => { row.submission.file.technicalAvailability = 'unavailable'; },
  ]) {
    const changed = copy(source); mutate(changed);
    assert.deepEqual(candidates(value, history(value, [changed])), []);
  }
});

test('an old approval cannot override a current rejection or unavailable file', () => {
  const value = awaitingReview(), source = previousEvidence(value);
  const [candidate] = candidates(value, history(value, [source]));
  value.items[0].submission.review = { reviewId: id(900), decision: 'rejected', reason: 'Wrong document', reviewedAt: '2026-09-21T12:00:00Z' };
  const reuse = { ...candidate.approval, expectedReviewId: id(900) };
  assert.ok(blockers(value, [reuse]).some(item => item.reason === 'document_rejected'));
  assert.deepEqual(candidates(value, history(value, [source])), []);
  assert.equal(review(fixture.target, value, input({ reuseApprovals: [reuse] })), null);
  value.items[0].submission.review = null;
  value.items[0].submission.file.technicalAvailability = 'unavailable';
  assert.ok(blockers(value, [candidate.approval]).some(item => item.reason === 'file_unavailable'));
});

test('legacy null material is compared using the same custom definition as SQL', () => {
  const value = awaitingReview(), item = value.items[0];
  item.materialSnapshot = null;
  const source = previousEvidence(value);
  source.materialSnapshot = { intentKind: 'custom', requirementId: null,
    rawLabel: item.definition.label, rawGroupLabel: item.definition.groupLabel,
    label: item.definition.label, groupLabel: item.definition.groupLabel,
    sourceRequirementKey: null, sourceChecklistVersion: null, sourceInstructions: null };
  assert.equal(candidates(value, history(value, [source])).length, 1);
});
