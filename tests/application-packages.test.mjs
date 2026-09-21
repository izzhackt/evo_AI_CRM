// Offline codec and local persistence contracts; not business/runtime acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as c from '../src/lib/portal/application-packages.ts';
import * as p from '../src/lib/portal/application-packages-pending.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/application-packages-v1.json', import.meta.url), 'utf8'));
const copy = value => structuredClone(value);
const id = n => `c3a10000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const target = fixture.target, packageId = fixture.submitReceipt.packageId;
const readers = {
  submitIntent: c.parseApplicationPackageSubmitIntent,
  reviewIntent: c.parseApplicationPackageReviewIntent,
  submitReceipt: v => c.parseApplicationPackageSubmitReceipt(v, fixture.submitIntent),
  reviewReceipt: v => c.parseApplicationPackageReviewReceipt(v, fixture.reviewIntent),
  reuseReviewIntent: c.parseApplicationPackageReviewIntent,
  reuseReviewReceipt: v => c.parseApplicationPackageReviewReceipt(v, fixture.reuseReviewIntent),
  readiness: v => c.parseApplicationPackageReadiness(v, target),
  detail: v => c.parseApplicationPackageDetail(v, target, packageId),
  history: v => c.parseApplicationPackageHistory(v, target),
  reviewHistory: v => c.parseApplicationPackageReviewHistory(v, target, packageId),
  queue: c.parseApplicationPackageQueue,
  notification: v => c.parseApplicationPackageNotification(v, fixture.notification.notificationId, target.studentCaseId),
  recoveryCommitted: v => c.parseApplicationPackageRecovery(v, 'submit', fixture.submitIntent),
  recoveryAbsent: v => c.parseApplicationPackageRecovery(v, 'submit', fixture.submitIntent),
};

for (const [name, parse] of Object.entries(readers)) {
  test(`shared Swift/TypeScript fixture ${name} retains its exact shape`, () => {
    assert.deepEqual(parse(fixture[name]), fixture[name]);
    assert.equal(parse({ ...fixture[name], unexpected: true }), null);
  });
}

test('submit has a nonempty ordered unique composition and a 100 item bound', () => {
  const value = copy(fixture.submitIntent);
  value.items = Array.from({ length: 100 }, (_, i) => ({ ...copy(value.items[0]), requirementItemId: id(i + 1) }));
  assert.equal(c.parseApplicationPackageSubmitIntent(value)?.items.length, 100);
  value.items.push({ ...value.items[0], requirementItemId: id(101) });
  assert.equal(c.parseApplicationPackageSubmitIntent(value), null);
  for (const items of [[], [fixture.submitIntent.items[0], fixture.submitIntent.items[0]]]) {
    assert.equal(c.parseApplicationPackageSubmitIntent({ ...fixture.submitIntent, items }), null);
  }
  assert.deepEqual(c.parseApplicationPackageSelections([]), []);
  const missing = copy(fixture.submitIntent); delete missing.expectedPreviousPackageId;
  assert.equal(c.parseApplicationPackageSubmitIntent(missing), null);
});

test('receipt binds request, case, revision and ordered exact versions', () => {
  for (const field of ['requestId', 'studentCaseId', 'applicationId', 'requirementsRevisionId']) {
    assert.equal(c.parseApplicationPackageSubmitReceipt({ ...fixture.submitReceipt, [field]: id(500) }, fixture.submitIntent), null, field);
  }
  const reordered = copy(fixture.submitReceipt); reordered.items.reverse();
  assert.equal(c.parseApplicationPackageSubmitReceipt(reordered, fixture.submitIntent), null);
  const changed = copy(fixture.submitReceipt); changed.items[0].documentVersionId = id(501);
  assert.equal(c.parseApplicationPackageSubmitReceipt(changed, fixture.submitIntent), null);
  for (const invalid of ['0', '01', 1, '9223372036854775808']) {
    assert.equal(c.parseApplicationPackageSubmitReceipt({ ...fixture.submitReceipt, packageVersion: invalid }), null);
  }
});

test('package review distinguishes complete approved evidence from correction', () => {
  const invalid = copy(fixture.reviewReceipt); invalid.packageReview.documentReviews[0].review = null;
  assert.equal(c.parseApplicationPackageReviewReceipt(invalid), null);
  const correction = copy(fixture.reviewIntent);
  correction.decision = 'correction_required'; correction.reason = 'Нужна читаемая копия';
  correction.affectedItemIds = [correction.documentReviews[0].requirementItemId];
  assert.ok(c.parseApplicationPackageReviewIntent(correction));
  assert.equal(c.parseApplicationPackageReviewIntent({ ...correction, affectedItemIds: [id(505)] }), null);
  assert.equal(c.parseApplicationPackageReviewIntent({ ...correction, reason: ' '.repeat(10) }), null);
  assert.ok(c.parseApplicationPackageReviewIntent({ ...correction, reason: '😀'.repeat(5000) }));
  assert.equal(c.parseApplicationPackageReviewIntent({ ...correction, reason: '😀'.repeat(5001) }), null);
  assert.equal(c.parseApplicationPackageReviewIntent({ ...correction, reason: 'Fix\u0000page' }), null);
  assert.ok(c.parseApplicationPackageReviewIntent({ ...correction, reason: 'Fix\npage\t2\u0001' }));
  const wrongVector = copy(fixture.reviewReceipt); wrongVector.packageReview.documentReviews.reverse();
  assert.equal(c.parseApplicationPackageReviewReceipt(wrongVector, fixture.reviewIntent), null);
});

test('reuse cannot silently substitute evidence or promote an unreviewed file without explicit intent', () => {
  const receipt = copy(fixture.reuseReviewReceipt);
  assert.ok(c.parseApplicationPackageReviewReceipt(receipt, fixture.reuseReviewIntent));
  receipt.packageReview.documentReviews[0].reusedFromReview.reviewId = id(600);
  assert.equal(c.parseApplicationPackageReviewReceipt(receipt, fixture.reuseReviewIntent), null);
  const noReuse = { ...fixture.reuseReviewIntent, reuseApprovals: [] };
  assert.equal(c.parseApplicationPackageReviewReceipt(fixture.reuseReviewReceipt, noReuse), null);
  const alreadyReviewed = copy(fixture.reuseReviewIntent);
  const currentId = fixture.reuseReviewReceipt.packageReview.documentReviews[0].review.reviewId;
  alreadyReviewed.documentReviews[0].expectedReviewId = currentId;
  alreadyReviewed.reuseApprovals[0].expectedReviewId = currentId;
  assert.ok(c.parseApplicationPackageReviewReceipt(fixture.reuseReviewReceipt, alreadyReviewed));
  assert.equal(c.parseApplicationPackageReviewIntent({ ...alreadyReviewed, decision: 'correction_required', reason: 'Fix' }), null);
});

test('recovery absence is correlated to the exact frozen operation and target', () => {
  for (const key of ['requestId', 'studentCaseId', 'applicationId']) {
    assert.equal(c.parseApplicationPackageRecovery({ ...fixture.recoveryAbsent, [key]: id(700) }, 'submit', fixture.submitIntent), null);
  }
  assert.equal(c.parseApplicationPackageRecovery({ ...fixture.recoveryAbsent, operation: 'review' }, 'submit', fixture.submitIntent), null);
  const bare = { protocolVersion: 1, operation: 'submit', status: 'not_written', receipt: null };
  assert.equal(c.parseApplicationPackageRecovery(bare, 'submit', fixture.submitIntent), null);
  assert.equal(c.parseApplicationPackageRecovery({ ...fixture.recoveryAbsent, receipt: fixture.submitReceipt }, 'submit', fixture.submitIntent), null);
  const malformed = { code: 'PT409', message: 'application_package_not_ready' };
  assert.deepEqual(c.applicationPackageFailure(malformed), { ok: false, reason: 'not_ready', resolution: 'retain' });
});

test('readiness supports 100 items without relying on the legacy current pointer or staff approval', () => {
  const base = fixture.readiness, value = copy(base);
  value.requirements.origin = 'staff_confirmed'; value.requirements.configurationState = 'confirmed';
  value.requirements.items = []; value.documentItems = []; value.selections = [];
  for (let i = 0; i < 100; i++) {
    const itemId = id(1000 + i), slotId = id(2000 + i), fileId = id(3000 + i);
    value.requirements.items.push({ ...copy(base.requirements.items[0]), requirementItemId: itemId, documentSlotId: slotId,
      position: i + 1, requirementKey: `qa.item.${i}`, compatibilityKey: `qa.item.${i}` });
    const doc = { ...copy(base.documentItems[0]), requirementItemId: itemId, documentSlotId: slotId };
    doc.reusableVersions[0].selection.documentVersionId = fileId; doc.reusableVersions[0].file.documentVersionId = fileId;
    value.documentItems.push(doc);
    const selected = { ...copy(base.selections[0]), requirementItemId: itemId };
    selected.selection.documentVersionId = fileId; selected.file.documentVersionId = fileId;
    value.selections.push(selected);
  }
  assert.equal(c.parseApplicationPackageReadiness(value, target)?.documentItems.length, 100);
  assert(value.requirements.items.every(item => item.currentVersionId === null && item.reviewDecision === null));
  const missing = copy(base); missing.selections.pop();
  assert.equal(c.parseApplicationPackageReadiness(missing, target), null);
  missing.missingRequiredItemIds = [base.selections[1].requirementItemId]; missing.reasons = ['missing_required']; missing.canSubmit = false;
  assert.ok(c.parseApplicationPackageReadiness(missing, target));
});

test('an excluded optional material may need configuration without blocking package readiness', () => {
  const value = copy(fixture.readiness);
  value.requirements.origin = 'staff_confirmed'; value.requirements.configurationState = 'confirmed';
  const optional = { ...copy(value.requirements.items[0]), requirementItemId: id(4100), documentSlotId: id(4101),
    requirementKey: 'qa.optional', compatibilityKey: 'qa.optional', position: 3, required: false,
    slotStatus: null, unavailableReasons: ['application_link_missing'], technicalAvailability: 'unavailable' };
  value.requirements.items.push(optional); value.requirements.state = 'needs_configuration';
  value.requirements.configurationReasons = ['material_association_unavailable'];
  value.documentItems.push({ ...copy(value.documentItems[0]), requirementItemId: optional.requirementItemId,
    documentSlotId: optional.documentSlotId, reusableVersions: [], canUpload: false, canSubmit: false });
  assert.equal(c.parseApplicationPackageReadiness(value, target)?.canSubmit, true);
});

test('immutable approval remains distinguishable from a later negative file review', () => {
  const value = copy(fixture.detail), item = value.items[0];
  item.submission.review = { reviewId: id(4200), decision: 'correction_required', reason: 'Replace page', reviewedAt: '2026-09-21T11:00:00Z' };
  value.currentWarnings = [{ requirementItemId: item.requirementItemId, submissionId: item.submission.submissionId,
    reason: 'review_changed', currentReview: copy(item.submission.review) }];
  const parsed = c.parseApplicationPackageDetail(value, target, packageId);
  assert.equal(parsed?.package.latestReview.decision, 'approved');
  assert.equal(parsed?.currentWarnings[0].currentReview.decision, 'correction_required');
  assert.equal(c.parseApplicationPackageDetail({ ...value, currentWarnings: [] }, target, packageId), null);
  value.currentWarnings[0].submissionId = id(4201);
  assert.equal(c.parseApplicationPackageDetail(value, target, packageId), null);
});

test('history enforces exact cursor, unique identity and microsecond ordering', () => {
  const value = copy(fixture.history), first = value.packages[0];
  const older = { ...copy(first), packageId: id(4300), latestReview: null, submittedAt: '2026-09-21T10:20:30.123455+00:00' };
  value.packages.push(older); value.nextCursor = { createdAt: older.submittedAt, id: older.packageId };
  assert.ok(c.parseApplicationPackageHistory(value, target));
  value.packages.reverse(); assert.equal(c.parseApplicationPackageHistory(value, target), null);
  value.packages.reverse(); value.nextCursor.id = id(4301); assert.equal(c.parseApplicationPackageHistory(value, target), null);
});

function storage() {
  const values = new Map(), reads = [];
  return { values, reads, get length() { return values.size; }, key: i => [...values.keys()][i] ?? null,
    getItem(key) { reads.push(key); return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); }, removeItem(key) { values.delete(key); } };
}
const pendingTarget = fixture.submitIntent.requirementsRevisionId;

test('JSONB-incompatible correction reason cannot enter pending or replace an existing request', () => {
  const port = storage();
  const invalid = { ...copy(fixture.reviewIntent), decision: 'correction_required', reason: 'Fix\u0000page' };
  assert.throws(() => p.persistApplicationPackagePending(fixture.scope, 'review', packageId, invalid, port));
  assert.equal(port.length, 0);
  const valid = { ...invalid, reason: 'Fix\npage\t2\u0001' };
  p.persistApplicationPackagePending(fixture.scope, 'review', packageId, valid, port);
  const saved = [...port.values.entries()];
  assert.throws(() => p.persistApplicationPackagePending(fixture.scope, 'review', packageId, invalid, port));
  assert.deepEqual([...port.values.entries()], saved);
  assert.equal(p.readApplicationPackagePending(fixture.scope, 'review', packageId, port).intent.reason, valid.reason);
});

test('pending survives reload and revision replacement without overwriting an unknown intent', () => {
  const port = storage(), value = copy(fixture.submitIntent);
  p.persistApplicationPackagePending(fixture.scope, 'submit', pendingTarget, value, port);
  value.items.reverse();
  assert.deepEqual(p.readApplicationPackagePending(fixture.scope, 'submit', pendingTarget, port).intent, fixture.submitIntent);
  assert.throws(() => p.persistApplicationPackagePending(fixture.scope, 'submit', pendingTarget, value, port));
  const next = { ...copy(fixture.submitIntent), requirementsRevisionId: id(5000), requestId: id(5001) };
  p.persistApplicationPackagePending(fixture.scope, 'submit', next.requirementsRevisionId, next, port);
  assert.equal(p.listApplicationPackagePending(fixture.scope, port).length, 2);
  assert.deepEqual(p.listApplicationPackagePendingScopes(fixture.scope, port), [fixture.scope]);
});

test('pending cannot be cleared by stale proof, another composition or malformed response', () => {
  const port = storage();
  p.persistApplicationPackagePending(fixture.scope, 'submit', pendingTarget, fixture.submitIntent, port);
  for (const proof of [null, { ...fixture.recoveryAbsent, requestId: id(5100) }, { ...fixture.recoveryCommitted, receipt: null }]) {
    assert.equal(p.clearApplicationPackagePending(fixture.scope, 'submit', pendingTarget, fixture.submitIntent, proof, port), false);
    assert.ok(p.readApplicationPackagePending(fixture.scope, 'submit', pendingTarget, port).intent);
  }
  assert.equal(p.clearApplicationPackagePending(fixture.scope, 'submit', pendingTarget, fixture.submitIntent, fixture.recoveryAbsent, port), true);
  assert.equal(p.readApplicationPackagePending(fixture.scope, 'submit', pendingTarget, port).intent, null);
});

test('owner inventory never opens another owner value and malformed state remains blocked', () => {
  const port = storage(), other = { ...fixture.scope, membershipId: id(5200) };
  p.persistApplicationPackagePending(other, 'submit', pendingTarget, fixture.submitIntent, port);
  port.reads.length = 0;
  assert.deepEqual(p.listApplicationPackagePendingScopes(fixture.scope, port), []);
  assert.deepEqual(p.listApplicationPackagePending(fixture.scope, port), []);
  assert.equal(port.reads.length, 0);
  const key = p.applicationPackagePendingKey(fixture.scope, 'submit', pendingTarget);
  port.values.set(key, '{broken');
  assert.equal(p.readApplicationPackagePending(fixture.scope, 'submit', pendingTarget, port).blocked, true);
  assert.throws(() => p.persistApplicationPackagePending(fixture.scope, 'submit', pendingTarget, fixture.submitIntent, port));
});

test('pending lock and storage failure stop dispatch', async () => {
  let dispatched = false;
  const port = storage(), locks = { async request(_name, _options, fn) { return fn(null); } };
  assert.deepEqual(await p.withApplicationPackageLock(fixture.scope, 'submit', pendingTarget, async () => { dispatched = true; }, { storage: port, locks }), { acquired: false, reason: 'busy' });
  assert.equal(dispatched, false);
  port.getItem = () => { throw Error('storage unavailable'); };
  assert.deepEqual(await p.withApplicationPackageLock(fixture.scope, 'submit', pendingTarget, async () => { dispatched = true; }, { storage: port, locks }), { acquired: false, reason: 'storage_unavailable' });
  assert.equal(dispatched, false);
});
