// Real action/source control flow through synthetic ports. Offline protocol evidence only;
// no Auth, RPC, database, Storage or UI acceptance is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as codec from '../src/lib/portal/application-packages.ts';
import * as documents from '../src/lib/portal/application-documents.ts';
import { universityIntakeId } from '../src/lib/platform-university-catalog.ts';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const target = { studentCaseId: id(3), applicationId: id(4) };
const scope = { organizationId: id(1), membershipId: id(2), ...target };
const submitIntent = {
  ...target, requirementsRevisionId: id(5), expectedPreviousPackageId: null,
  items: [{ requirementItemId: id(6), selection: { kind: 'existing_version', documentVersionId: id(7) }, expectedPreviousSubmissionId: null }], requestId: id(8),
};
const submitReceipt = {
  protocolVersion: 1, requestId: id(8), ...target, packageId: id(9), requirementsRevisionId: id(5),
  packageVersion: '1', compositionSha256: 'a'.repeat(64), submittedAt: '2026-09-21T12:00:00Z', reused: false,
  items: [{ packageItemId: id(10), requirementItemId: id(6), documentSlotId: id(11), documentVersionId: id(7), submissionId: id(12) }],
};
const reviewIntent = {
  ...target, packageId: id(9), expectedPreviousReviewId: null, decision: 'approved', reason: null, affectedItemIds: [],
  documentReviews: [{ requirementItemId: id(6), submissionId: id(12), expectedReviewId: id(13) }], reuseApprovals: [], requestId: id(14),
};
const packageReview = {
  packageReviewId: id(15), packageId: id(9), decision: 'approved', reason: null, affectedItemIds: [],
  documentReviews: [{ requirementItemId: id(6), submissionId: id(12),
    review: { reviewId: id(13), decision: 'approved', reason: null, reviewedAt: '2026-09-21T12:01:00Z' },
    reusedFromSubmissionId: null, reusedFromReview: null }], reviewedAt: '2026-09-21T12:02:00Z',
};
const reviewReceipt = { protocolVersion: 1, requestId: id(14), ...target, packageId: id(9), packageReview };
const history = { protocolVersion: 1, ...target, packages: [], nextCursor: null };
const reviewHistory = { protocolVersion: 1, ...target, packageId: id(9), reviews: [], nextCursor: null };
const queue = { protocolVersion: 1, items: [], nextCursor: null };
const notification = { protocolVersion: 1, notificationId: id(16), ...target, packageId: id(9), packageReviewId: id(15), review: packageReview };
const requirements = JSON.parse(readFileSync(new URL('./fixtures/application-requirements-v2.json', import.meta.url), 'utf8')).cases[0].value;
const readiness = {
  protocolVersion: 1, ...target,
  requirements: { ...requirements, ...target },
  documentItems: requirements.items.map(item => ({ requirementItemId: item.requirementItemId, documentSlotId: item.documentSlotId,
    savedDraft: null, submission: null, previousEvidence: null, reusableVersions: [], reusableVersionsNextCursor: null, canUpload: true, canSubmit: true })),
  latestPackage: null, selections: [], missingRequiredItemIds: requirements.items.map(item => item.requirementItemId),
  reasons: ['empty_composition', 'missing_required'], canSubmit: false,
};
const actionSource = readFileSync(new URL('../src/lib/portal/application-packages-actions.ts', import.meta.url), 'utf8');
const initialSource = readFileSync(new URL('../src/lib/portal/application-packages-source.ts', import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const compiledActions = compile(actionSource), compiledSource = compile(initialSource);
function harness({ actor = scope, studentStatus = 'authenticated', preview = false, permissions = ['document.read.full', 'document.upload', 'document.review'], response = { data: submitReceipt, error: null }, refresh = () => {}, authThrows = false } = {}) {
  const calls = [], permissionsChecked = [], refreshed = [];
  const actions = {}, source = {};
  const actorPort = async () => { if (authThrows) throw Error('private Auth failure'); return actor; };
  const requirePort = name => {
    if (name === 'server-only') return {};
    if (name === 'next/cache') return { revalidatePath(path) { refreshed.push(path); refresh(path); } };
    if (name.endsWith('student-portal-guards')) return { requireStudentPortalActor: actorPort };
    if (name.endsWith('student-portal-auth.ts')) return { resolveStudentPortalActor: async () => studentStatus === 'authenticated' ? { status: studentStatus, actor } : { status: studentStatus } };
    if (name.endsWith('platform-guards')) return { requirePlatformStaffActor: actorPort };
    if (name.endsWith('platform-access.ts')) return { isStaffPreview: () => preview, staffHasPermission(_actor, permission) { permissionsChecked.push(permission); return permissions.includes(permission); } };
    if (name.endsWith('supabase/server')) return { createSupabaseServerClient: async () => ({ schema(schema) { assert.equal(schema, 'platform'); return this; }, async rpc(name, args) { calls.push([name, args]); return typeof response === 'function' ? response(name, args) : response; } }) };
    if (name.endsWith('platform-university-catalog.ts')) return { universityIntakeId };
    if (name.endsWith('application-documents.ts')) return documents;
    if (name.endsWith('application-packages.ts')) return codec;
    if (name.endsWith('application-packages-actions')) return actions;
    throw Error(`Unexpected import: ${name}`);
  };
  runInNewContext(compiledActions, { exports: actions, require: requirePort });
  runInNewContext(compiledSource, { exports: source, require: requirePort });
  return { actions, source, calls, permissionsChecked, refreshed };
}
const retain = result => { assert.equal(result.ok, false); assert.equal(result.resolution, 'retain'); };
const json = value => JSON.parse(JSON.stringify(value));

test('owner switch and foreign Student case reject before ordinary RPC', async () => {
  for (const actor of [{ ...scope, membershipId: id(90) }, { ...scope, organizationId: id(90) }]) {
    const h = harness({ actor });
    for (const name of ['submitStudentApplicationPackageAction', 'submitStaffApplicationPackageAction']) {
      const result = await h.actions[name](scope, submitIntent); retain(result); assert.equal(result.reason, 'forbidden');
    }
    assert.equal((await h.actions.readStudentApplicationPackageReadinessAction(scope, target)).reason, 'forbidden');
    assert.equal(h.calls.length, 0);
  }
  const h = harness({ actor: { ...scope, studentCaseId: id(90) } });
  assert.equal((await h.actions.submitStudentApplicationPackageAction(scope, submitIntent)).reason, 'forbidden');
  assert.equal(h.calls.length, 0);
});

test('staff preview and missing command permission cannot mutate or recover', async () => {
  for (const config of [{ preview: true }, { permissions: ['document.read.full'] }]) {
    const h = harness(config);
    for (const result of [await h.actions.submitStaffApplicationPackageAction(scope, submitIntent),
      await h.actions.reviewApplicationPackageAction(scope, reviewIntent),
      await h.actions.recoverStaffApplicationPackageAction(scope, 'review', reviewIntent)]) {
      retain(result); assert.equal(result.reason, 'forbidden');
    }
    assert.equal(h.calls.length, 0);
  }
});

test('invalid input and unknown operation stop before RPC, never erase pending', async () => {
  const h = harness();
  for (const result of [await h.actions.submitStudentApplicationPackageAction(scope, { ...submitIntent, actorId: id(99) }),
    await h.actions.readStudentApplicationPackageReadinessAction(scope, target, [{ ...submitIntent.items[0], required: true }]),
    await h.actions.recoverStudentApplicationPackageAction(scope, 'delete', submitIntent),
    await h.actions.readApplicationPackageHistoryAction(scope, target, { id: id(10), createdAt: 'not-a-time' })]) {
    retain(result); assert.equal(result.reason, 'invalid');
  }
  assert.equal(h.calls.length, 0);
});

test('submit forwards only the parsed frozen intent and confirmed success survives refresh failure', async () => {
  const h = harness({ refresh() { throw Error('cache unavailable'); } });
  const result = await h.actions.submitStudentApplicationPackageAction(scope, submitIntent);
  assert.equal(result.ok, true); assert.deepEqual(json(result.receipt), submitReceipt);
  assert.deepEqual(json(h.calls), [['application_package_submit_v1', { p_intent: submitIntent }]]);
});

test('review uses current staff permission and binds the complete receipt', async () => {
  const h = harness({ response: { data: reviewReceipt, error: null } });
  const result = await h.actions.reviewApplicationPackageAction(scope, reviewIntent);
  assert.equal(result.ok, true); assert.deepEqual(json(result.receipt), reviewReceipt);
  assert.deepEqual(h.permissionsChecked, ['document.review']);
  assert.deepEqual(json(h.calls), [['application_package_review_v1', { p_intent: reviewIntent }]]);
  assert.deepEqual(h.refreshed, ['/portal', '/portal/notifications', `/portal/preparations/${target.applicationId}`, '/v3/profile', '/v3/admissions-pipeline']);
});

test('mutation errors and thrown transport/Auth failures always retain without raw provider text', async () => {
  for (const error of [{ code: '42501', message: 'application_packages_unavailable' },
    { code: 'PT409', message: 'application_package_intent_conflict' },
    { code: 'PT409', message: 'application_package_previous_package_changed' },
    { code: 'PT409', message: 'application_document_previous_review_changed' },
    { code: 'XX000', message: 'private provider details' }]) {
    const h = harness({ response: { data: null, error } });
    const result = await h.actions.submitStaffApplicationPackageAction(scope, submitIntent);
    retain(result); assert.ok(!JSON.stringify(result).includes('private provider details'));
  }
  for (const config of [{ authThrows: true }, { response() { throw Error('private transport details'); } }]) {
    const h = harness(config); const result = await h.actions.submitStudentApplicationPackageAction(scope, submitIntent);
    retain(result); assert.equal(result.reason, 'unavailable');
  }
});

test('wrong request, target or selected version never becomes a successful submission receipt', async () => {
  for (const receipt of [{ ...submitReceipt, requestId: id(90) }, { ...submitReceipt, applicationId: id(90) },
    { ...submitReceipt, items: [{ ...submitReceipt.items[0], documentVersionId: id(90) }] }, { success: true }]) {
    const h = harness({ response: { data: receipt, error: null } });
    retain(await h.actions.submitStaffApplicationPackageAction(scope, submitIntent));
    assert.equal(h.refreshed.length, 0);
  }
});

test('detached recovery proves absence through its read-only RPC without current revision or queue preflight', async () => {
  const h = harness({ response: { data: { protocolVersion: 1, ...target, requestId: submitIntent.requestId, operation: 'submit', status: 'not_written', receipt: null }, error: null } });
  const result = await h.actions.recoverStudentApplicationPackageAction(scope, 'submit', submitIntent);
  assert.equal(result.ok, true); assert.equal(result.recovery.status, 'not_written');
  assert.deepEqual(json(h.calls), [['application_package_recover_v1', { p_operation: 'submit', p_intent: submitIntent }]]);
  assert.equal(h.refreshed.length, 0);
});

test('not_written proof for another request or target retains the frozen operation', async () => {
  for (const [operation, intent, action] of [
    ['submit', submitIntent, 'recoverStudentApplicationPackageAction'],
    ['review', reviewIntent, 'recoverStaffApplicationPackageAction'],
  ]) {
    const proof = { protocolVersion: 1, ...target, requestId: intent.requestId, operation, status: 'not_written', receipt: null };
    for (const data of [{ ...proof, requestId: id(90) }, { ...proof, studentCaseId: id(90) },
      { ...proof, applicationId: id(90) }, { protocolVersion: 1, operation, status: 'not_written', receipt: null }]) {
      const h = harness({ response: { data, error: null } });
      retain(await h.actions[action](scope, operation, intent));
      assert.equal(h.calls.length, 1); assert.equal(h.refreshed.length, 0);
    }
  }
});

test('committed recovery preserves matching receipt; malformed or conflicting proof retains', async () => {
  const good = { protocolVersion: 1, ...target, requestId: reviewIntent.requestId, operation: 'review', status: 'committed', receipt: reviewReceipt };
  const h = harness({ response: { data: good, error: null }, refresh() { throw Error('cache'); } });
  assert.equal((await h.actions.recoverStaffApplicationPackageAction(scope, 'review', reviewIntent)).ok, true);
  assert.deepEqual(h.permissionsChecked, ['document.review']);
  for (const data of [{ ...good, operation: 'submit' }, { ...good, receipt: { ...reviewReceipt, requestId: id(90) } },
    { protocolVersion: 1, ...target, requestId: reviewIntent.requestId, operation: 'review', status: 'not_written', receipt: reviewReceipt }]) {
    const bad = harness({ response: { data, error: null } });
    retain(await bad.actions.recoverStaffApplicationPackageAction(scope, 'review', reviewIntent));
  }
  const denied = harness();
  assert.equal((await denied.actions.recoverStudentApplicationPackageAction(scope, 'review', reviewIntent)).reason, 'forbidden');
  assert.equal(denied.calls.length, 0);
});

test('readiness preserves server missing reasons and does not equate permission with readiness', async () => {
  const h = harness({ response: { data: readiness, error: null } });
  const result = await h.actions.readStudentApplicationPackageReadinessAction(scope, target, []);
  assert.equal(result.ok, true); assert.equal(result.readiness.canSubmit, false);
  assert.deepEqual(json(result.readiness.missingRequiredItemIds), readiness.missingRequiredItemIds);
  assert.deepEqual(json(h.calls), [['application_package_readiness_v1', { p_student_case_id: target.studentCaseId, p_application_id: target.applicationId, p_selections: [] }]]);
  const differentSelection = await h.actions.readStudentApplicationPackageReadinessAction(scope, target, submitIntent.items);
  retain(differentSelection);
});

test('scoped readers reject different application and preserve default pagination arguments', async () => {
  const h = harness({ response(name) { return { data: name === 'application_package_review_history_v1' ? reviewHistory : history, error: null }; } });
  assert.equal((await h.actions.readApplicationPackageHistoryAction(scope, { ...target, applicationId: id(90) })).reason, 'forbidden');
  assert.equal(h.calls.length, 0);
  assert.equal((await h.actions.readApplicationPackageHistoryAction(scope, target)).ok, true);
  assert.equal((await h.actions.readApplicationPackageReviewHistoryAction(scope, target, id(9))).ok, true);
  assert.equal(h.calls[0][1].p_limit, 20); assert.equal(h.calls[0][1].p_cursor, null);
  assert.equal(h.calls[1][1].p_package_id, id(9));
  const malformed = harness({ response: { data: { ...history, studentCaseId: id(90) }, error: null } });
  retain(await malformed.actions.readApplicationPackageHistoryAction(scope, target));
});

test('staff queue uses existing document read permission and no client assignment filtering', async () => {
  const h = harness({ studentStatus: 'anonymous', response: { data: queue, error: null } });
  assert.equal((await h.actions.readStaffApplicationPackageQueueAction(scope)).ok, true);
  assert.deepEqual(h.permissionsChecked, ['document.read.full']);
  assert.deepEqual(json(h.calls), [['application_package_queue_v1', { p_cursor: null, p_limit: 20 }]]);
  const denied = harness({ permissions: [] });
  assert.equal((await denied.actions.readStaffApplicationPackageQueueAction(scope)).reason, 'forbidden');
  assert.equal(denied.calls.length, 0);
});

test('notification binds both notification ID and current Student case', async () => {
  const h = harness({ response: { data: notification, error: null } });
  assert.equal((await h.actions.readStudentApplicationPackageNotificationAction(scope, id(16))).ok, true);
  const foreign = harness({ response: { data: { ...notification, studentCaseId: id(90) }, error: null } });
  retain(await foreign.actions.readStudentApplicationPackageNotificationAction(scope, id(16)));
  const otherNotification = harness({ response: { data: { ...notification, notificationId: id(90) }, error: null } });
  retain(await otherNotification.actions.readStudentApplicationPackageNotificationAction(scope, id(16)));
});

test('initial source reads share action guards and safe typed failures', async () => {
  const h = harness({ response: { data: readiness, error: null } });
  assert.equal((await h.source.readStudentApplicationPackageReadiness(target.studentCaseId, target.applicationId)).canSubmit, false);
  const foreign = harness({ actor: { ...scope, studentCaseId: id(90) } });
  await assert.rejects(foreign.source.readStudentApplicationPackageReadiness(target.studentCaseId, target.applicationId), error => error instanceof codec.ApplicationPackageError && error.reason === 'forbidden');
  assert.equal(foreign.calls.length, 0);
  const preview = harness({ preview: true });
  await assert.rejects(preview.source.readStaffApplicationPackageReadiness(target.studentCaseId, target.applicationId), error => error instanceof codec.ApplicationPackageError && error.reason === 'forbidden');
});
