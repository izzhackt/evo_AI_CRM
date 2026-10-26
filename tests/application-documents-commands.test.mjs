// Student «Загрузить и отправить на проверку»: orchestration with injected upload/submit functions,
// the real pending-intent store and a lock model. Constructed protocol fixtures only: not runtime acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  runApplicationDocumentSubmit, runApplicationDocumentUpload, runApplicationDocumentUploadAndSubmit,
} from '../src/lib/portal/application-documents-commands.ts';
import {
  applicationDocumentPendingKey, persistApplicationDocumentPending, readApplicationDocumentPending,
} from '../src/lib/portal/application-documents-pending.ts';
import { freezeApplicationDocumentUploadIntent } from '../src/lib/portal/application-documents-upload.ts';
import { PORTAL_DICTIONARIES } from '../src/lib/portal/i18n.ts';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { organizationId: id(20), membershipId: id(21), studentCaseId: id(1), applicationId: id(2) };
const target = { studentCaseId: id(1), applicationId: id(2), requirementsRevisionId: id(3), requirementItemId: id(4), documentSlotId: id(5) };
const bytes = new TextEncoder().encode('%PDF-1.7\none tap fixture');
const sha256Hex = createHash('sha256').update(bytes).digest('hex');
const file = new File([bytes], 'справка.pdf', { type: 'application/pdf' });
const finalizedAt = '2026-10-26T10:00:00Z';
const submitRequestId = id(60);

/** In-memory Storage + Web Locks model that records the order of everything the commands do. */
function world({ blockSetFor, heldBy } = {}) {
  const map = new Map(); const log = []; const held = new Set(); let maxHeld = 0;
  const label = key => key.split(':').slice(-2).join(':').replace(id(4), 'item');
  const storage = {
    get length() { return map.size; }, key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.get(k) ?? null; },
    setItem(k, v) { if (blockSetFor && k.includes(blockSetFor)) throw new Error('quota'); log.push(`store ${label(k)}`); map.set(k, v); },
    removeItem(k) { log.push(`clear ${label(k)}`); map.delete(k); },
  };
  const locks = { request: async (k, o, cb) => {
    assert.equal(o.ifAvailable, true);
    if (held.has(k) || heldBy?.includes(label(k))) return cb(null);
    held.add(k); maxHeld = Math.max(maxHeld, held.size); log.push(`lock ${label(k)}`);
    try { return await cb({}); } finally { held.delete(k); log.push(`unlock ${label(k)}`); }
  } };
  return { map, log, storage, locks, env: { storage, locks }, get maxHeld() { return maxHeld; }, heldCount: () => held.size };
}
const receiptFor = intent => ({ ...intent, uploadContextId: id(7), documentVersionId: id(8), versionNo: '1', finalizedAt, publishedToLegacySlot: false });
function fakes(w, { uploadResult, submitResult, submitThrows } = {}) {
  const calls = { upload: [], submit: [] };
  const upload = async ({ intent }) => {
    calls.upload.push(intent);
    w.log.push('call upload');
    assert.deepEqual(readApplicationDocumentPending(scope, 'upload', id(4), w.storage).intent, intent, 'upload intent is persisted before the call');
    return uploadResult ? uploadResult(intent) : { ok: true, receipt: receiptFor(intent) };
  };
  const submit = async (_scope, intent) => {
    calls.submit.push(intent);
    w.log.push('call submit');
    assert.deepEqual(readApplicationDocumentPending(scope, 'submit', id(4), w.storage).intent, intent, 'submit intent is persisted before the call');
    assert.equal(w.heldCount(), 1, 'only the submit lock is held while submitting');
    if (submitThrows) throw new Error('network');
    return submitResult ?? { ok: true, receipt: { requestId: intent.requestId } };
  };
  return { calls, upload, submit };
}
const oneTap = (w, f, extra = {}) => runApplicationDocumentUploadAndSubmit({
  scope, audience: 'student', target, file, upload: f.upload, env: w.env, newRequestId: () => submitRequestId,
  sendAfterUpload: { previousSubmissionId: id(70), submit: f.submit }, ...extra,
});

test('one tap: upload, then submit the saved version; separate locks, intent persisted before each call', async () => {
  const w = world(); const f = fakes(w); const stages = [];
  const outcome = await oneTap(w, f, { onStage: s => stages.push(s) });
  assert.equal(outcome.stage, 'done');
  assert.equal(outcome.upload.status, 'uploaded');
  assert.deepEqual(outcome.submit, { status: 'sent', cleared: true });
  assert.deepEqual(stages, ['upload', 'submit']);
  assert.deepEqual(w.log, [
    'lock upload:item', 'store upload:item', 'call upload', 'clear upload:item', 'unlock upload:item',
    'lock submit:item', 'store submit:item', 'call submit', 'clear submit:item', 'unlock submit:item',
  ]);
  assert.equal(w.maxHeld, 1, 'locks are sequential, never nested');
  assert.equal(w.map.size, 0, 'nothing is left pending after a confirmed send');
  assert.deepEqual(f.calls.submit, [{
    studentCaseId: id(1), applicationId: id(2), requirementsRevisionId: id(3), requirementItemId: id(4), requestId: submitRequestId,
    selection: { kind: 'program_upload', uploadContextId: id(7), documentVersionId: id(8) }, expectedPreviousSubmissionId: id(70),
  }]);
});

test('one tap: a first submission for the item has no previous submission', async () => {
  const w = world(); const f = fakes(w);
  await oneTap(w, f, { sendAfterUpload: { previousSubmissionId: null, submit: f.submit } });
  assert.equal(f.calls.submit[0].expectedPreviousSubmissionId, null);
});

test('upload failure never calls submit and never persists a submit intent', async () => {
  for (const [uploadResult, kept] of [
    [() => ({ ok: false, reason: 'unsupported_type', resolution: 'not_written' }), false],
    [() => ({ ok: false, reason: 'unavailable', resolution: 'retain' }), true],
  ]) {
    const w = world(); const f = fakes(w, { uploadResult });
    const outcome = await oneTap(w, f);
    assert.equal(outcome.stage, 'upload');
    assert.equal(outcome.upload.status, 'rejected');
    assert.equal(f.calls.submit.length, 0);
    assert.equal(readApplicationDocumentPending(scope, 'submit', id(4), w.storage).intent, null);
    assert.equal(readApplicationDocumentPending(scope, 'upload', id(4), w.storage).intent !== null, kept, 'a retained upload intent survives for recovery');
  }
});

test('submit rejected after a saved file: the file is kept, the ordinary send button can finish', async () => {
  const w = world();
  const f = fakes(w, { submitResult: { ok: false, reason: 'stale_context', resolution: 'not_written' } });
  const outcome = await oneTap(w, f);
  assert.equal(outcome.stage, 'done');
  assert.equal(outcome.upload.status, 'uploaded');
  assert.deepEqual(outcome.submit, { status: 'rejected', reason: 'stale_context', resolution: 'not_written' });
  assert.equal(w.map.size, 0, 'a certified no-write result releases both intents');
  // The saved draft is what the standalone button submits afterwards.
  const g = fakes(w);
  const again = await runApplicationDocumentSubmit({
    scope, target, previousSubmissionId: id(70), submit: g.submit, whenRetained: 'resend', env: w.env, newRequestId: () => id(61),
    selection: { kind: 'program_upload', uploadContextId: id(7), documentVersionId: id(8) },
  });
  assert.deepEqual(again, { status: 'sent', cleared: true });
  assert.equal(g.calls.submit.length, 1);
});

test('submit with an uncertain result keeps its intent and the standalone button repeats the same request', async () => {
  const w = world();
  const f = fakes(w, { submitResult: { ok: false, reason: 'unavailable', resolution: 'retain' } });
  const outcome = await oneTap(w, f);
  assert.deepEqual(outcome.submit, { status: 'rejected', reason: 'unavailable', resolution: 'retain' });
  assert.equal(readApplicationDocumentPending(scope, 'submit', id(4), w.storage).intent.requestId, submitRequestId);
  assert.equal(readApplicationDocumentPending(scope, 'upload', id(4), w.storage).intent, null);
  const g = fakes(w);
  const retry = await runApplicationDocumentSubmit({
    scope, target, previousSubmissionId: id(70), submit: g.submit, whenRetained: 'resend', env: w.env, selection: null,
  });
  assert.deepEqual(retry, { status: 'sent', cleared: true });
  assert.equal(g.calls.submit[0].requestId, submitRequestId, 'idempotent retry reuses the retained request');
  assert.equal(w.map.size, 0);
});

test('an exception after the submit intent is persisted is reported as unknown and stays retained', async () => {
  const w = world(); const f = fakes(w, { submitThrows: true });
  const outcome = await oneTap(w, f);
  assert.deepEqual(outcome.submit, { status: 'unknown' });
  assert.equal(readApplicationDocumentPending(scope, 'submit', id(4), w.storage).intent.requestId, submitRequestId);
  assert.equal(f.calls.submit.length, 1);
});

test('submit is never called when its intent cannot be persisted', async () => {
  const w = world({ blockSetFor: 'submit:' }); const f = fakes(w);
  const outcome = await oneTap(w, f);
  assert.equal(outcome.upload.status, 'uploaded');
  assert.deepEqual(outcome.submit, { status: 'locked', reason: 'storage_unavailable' });
  assert.equal(f.calls.submit.length, 0);
});

test('submit is never called when browser storage for it is unreadable', async () => {
  const w = world(); const f = fakes(w);
  w.storage.setItem(applicationDocumentPendingKey(scope, 'submit', id(4)), 'garbage');
  const outcome = await oneTap(w, f);
  assert.deepEqual(outcome.submit, { status: 'locked', reason: 'storage_unavailable' });
  assert.equal(f.calls.submit.length, 0);
});

test('submit lock busy in another tab: the file is saved and nothing is sent', async () => {
  const w = world({ heldBy: ['submit:item'] }); const f = fakes(w);
  const outcome = await oneTap(w, f);
  assert.equal(outcome.upload.status, 'uploaded');
  assert.deepEqual(outcome.submit, { status: 'locked', reason: 'busy' });
  assert.equal(f.calls.submit.length, 0);
});

test('a retained upload that completes continues into submit with its original request', async () => {
  const w = world();
  const retained = await freezeApplicationDocumentUploadIntent(target, file, id(6));
  persistApplicationDocumentPending(scope, 'upload', id(4), retained, w.storage);
  w.log.length = 0;
  const f = fakes(w);
  const outcome = await oneTap(w, f);
  assert.equal(f.calls.upload[0].requestId, id(6), 'the retained upload request is repeated, not replaced');
  assert.deepEqual(outcome.submit, { status: 'sent', cleared: true });
  assert.equal(f.calls.submit.length, 1);
  assert.equal(f.calls.submit[0].selection.documentVersionId, id(8));
  assert.equal(w.map.size, 0);
});

test('a retained upload with a different file is refused before anything is sent', async () => {
  const w = world();
  const retained = await freezeApplicationDocumentUploadIntent(target, file, id(6));
  persistApplicationDocumentPending(scope, 'upload', id(4), retained, w.storage);
  const f = fakes(w);
  const other = new File(['другой'], 'другой.pdf', { type: 'application/pdf' });
  const outcome = await oneTap(w, f, { file: other });
  assert.deepEqual(outcome, { stage: 'upload', upload: { status: 'wrong_file' } });
  assert.equal(f.calls.upload.length, 0);
  assert.equal(f.calls.submit.length, 0);
});

test('a retained upload for older requirements is saved but not sent', async () => {
  const w = world();
  const retained = await freezeApplicationDocumentUploadIntent({ ...target, requirementsRevisionId: id(33) }, file, id(6));
  persistApplicationDocumentPending(scope, 'upload', id(4), retained, w.storage);
  const f = fakes(w);
  const outcome = await oneTap(w, f);
  assert.equal(outcome.upload.status, 'uploaded');
  assert.deepEqual(outcome.submit, { status: 'skipped', why: 'target_changed' });
  assert.equal(f.calls.submit.length, 0);
});

test('an unfinished earlier send is never resent in place of the new file', async () => {
  const w = world();
  const earlier = { studentCaseId: id(1), applicationId: id(2), requirementsRevisionId: id(3), requirementItemId: id(4), requestId: id(62),
    selection: { kind: 'existing_version', documentVersionId: id(9) }, expectedPreviousSubmissionId: null };
  persistApplicationDocumentPending(scope, 'submit', id(4), earlier, w.storage);
  const f = fakes(w);
  const outcome = await oneTap(w, f);
  assert.equal(outcome.upload.status, 'uploaded');
  assert.deepEqual(outcome.submit, { status: 'retained' });
  assert.equal(f.calls.submit.length, 0);
  assert.deepEqual(readApplicationDocumentPending(scope, 'submit', id(4), w.storage).intent, earlier);
});

test('staff and students who may not submit keep the two-step flow', async () => {
  for (const [audience, sendAfterUpload] of [['staff', 'given'], ['student', null]]) {
    const w = world(); const f = fakes(w);
    const outcome = await oneTap(w, f, { audience, sendAfterUpload: sendAfterUpload && { previousSubmissionId: null, submit: f.submit } });
    assert.equal(outcome.upload.status, 'uploaded');
    assert.deepEqual(outcome.submit, { status: 'skipped', why: 'upload_only' });
    assert.equal(f.calls.submit.length, 0);
    assert.equal(readApplicationDocumentPending(scope, 'submit', id(4), w.storage).intent, null);
    assert.equal(f.calls.upload.length, 1);
  }
});

test('standalone submit: nothing chosen and nothing retained does not run', async () => {
  const w = world(); const f = fakes(w);
  const none = await runApplicationDocumentSubmit({ scope, target, selection: null, previousSubmissionId: null, submit: f.submit, whenRetained: 'resend', env: w.env });
  assert.deepEqual(none, { status: 'idle' });
  assert.equal(f.calls.submit.length, 0);
  assert.equal(w.log.includes('store submit:item'), false);
});

test('upload command alone keeps the old contract: lock, persist, upload, clear', async () => {
  const w = world(); const f = fakes(w);
  const outcome = await runApplicationDocumentUpload({ scope, audience: 'student', target, file, upload: f.upload, env: w.env });
  assert.equal(outcome.status, 'uploaded');
  assert.equal(outcome.cleared, true);
  assert.equal(outcome.receipt.file.sha256Hex, sha256Hex);
  assert.deepEqual(w.log, ['lock upload:item', 'store upload:item', 'call upload', 'clear upload:item', 'unlock upload:item']);
});

test('new copy exists in Russian and Kyrgyz; the old two-step hint stays for staff', () => {
  const { ru, ky } = PORTAL_DICTIONARIES.programDocuments;
  assert.equal(ru.uploadAndSend, 'Загрузить и отправить на проверку');
  assert.equal(ky.uploadAndSend, 'Жүктөп, текшерүүгө жөнөтүү');
  assert.equal(ru.saveHintOneTap, 'Файл сразу уйдёт на проверку EVO.');
  assert.equal(ru.saveHint, 'После сохранения отправьте файл на проверку отдельной кнопкой.');
  assert.equal(ru.uploading, 'Загружаем…');
  assert.equal(ru.sending, 'Отправляем…');
  for (const key of ['uploadAndSend', 'saveHintOneTap', 'uploading', 'savedNotSent']) {
    assert.ok(ru[key].trim() && ky[key].trim(), key);
  }
  assert.match(ru.savedNotSent, /^Файл сохранён, но не отправлен\. \{reason\}$/u);
  assert.match(ky.savedNotSent, /\{reason\}/u);
  assert.equal(ru.saved, 'Файл сохранён. Теперь его можно отправить на проверку.', 'upload-only copy is unchanged');
  assert.equal('uploadCopy' in PORTAL_DICTIONARIES.preparations.ru, false, 'the contrast sentence about a missing send button is gone');
  assert.equal('uploadCopy' in PORTAL_DICTIONARIES.preparations.ky, false);
});

test('screens wire the one tap for students who may submit and keep staff two-step', () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const item = read('src/components/portal/admissionPreparations/ProgramDocumentItem.tsx');
  assert.match(item, /audience === "student" && item\.canSubmit && !submitPending\.intent && !submitPending\.blocked/u);
  assert.match(item, /hideWhenIdle=\{audience === "student"\}/u);
  const controls = read('src/components/portal/admissionPreparations/ProgramDocumentControls.tsx');
  assert.match(controls, /runApplicationDocumentUploadAndSubmit/u);
  assert.match(controls, /runApplicationDocumentSubmit/u);
  assert.doesNotMatch(controls, /persistApplicationDocumentPending|withApplicationDocumentLock/u, 'components reuse the shared commands instead of forking them');
  const staff = read('src/components/v3/profile/StaffPreparationPanel.tsx');
  assert.doesNotMatch(staff, /sendAfterSave/u);
  const recovery = read('src/components/portal/admissionPreparations/ProgramDocumentRecovery.tsx');
  assert.doesNotMatch(recovery, /sendAfterSave/u);
  const page = read('src/components/portal/admissionPreparations/ApplicationRequirementsUI.tsx');
  assert.match(page, /some\(item => item\.canSubmit\) \? documentStrings\.saveHintOneTap : documentStrings\.saveHint/u);
});
