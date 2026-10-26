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
import { applicationDocumentNoticeVisible, nextOneTapRun, studentDocumentPageHint } from '../src/lib/portal/application-documents-one-tap.ts';
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
  for (const key of ['uploadAndSend', 'saveHintOneTap', 'uploading', 'savedNotSent', 'savedSendBusy']) {
    assert.ok(ru[key].trim() && ky[key].trim(), key);
  }
  assert.match(ru.savedNotSent, /^Файл сохранён, но не отправлен\. \{reason\}$/u);
  assert.match(ky.savedNotSent, /\{reason\}/u);
  // Busy submit lock: the text says the file is saved, and does not point at a «Проверить результат» button that may not exist.
  assert.match(ru.savedSendBusy, /^Файл сохранён, но не отправлен/u);
  assert.doesNotMatch(ru.savedSendBusy, /Проверить результат/u);
  assert.doesNotMatch(ru.savedSendBusy, /\{reason\}/u);
  assert.equal(ru.saved, 'Файл сохранён. Теперь его можно отправить на проверку.', 'upload-only copy is unchanged');
  assert.equal('uploadCopy' in PORTAL_DICTIONARIES.preparations.ru, false, 'the contrast sentence about a missing send button is gone');
  assert.equal('uploadCopy' in PORTAL_DICTIONARIES.preparations.ky, false);
});

const draftVersion = id(8);
const view = (over = {}) => ({ submittedVersionId: null, reviewed: false, unsentDraftVersionId: null, ...over });
const sent = { tone: 'success', text: 'Документ отправлен на проверку EVO.', versionId: draftVersion };
const notSent = { tone: 'error', text: 'Файл сохранён, но не отправлен. …', versionId: draftVersion };

test('success notice survives the remount and shows only for the version that was sent', () => {
  assert.equal(applicationDocumentNoticeVisible(null, view()), false);
  // Before the refresh brings the new submission the form still shows its own message, so the item stays quiet.
  assert.equal(applicationDocumentNoticeVisible(sent, view()), false);
  assert.equal(applicationDocumentNoticeVisible(sent, view({ submittedVersionId: draftVersion })), true);
  assert.equal(applicationDocumentNoticeVisible(sent, view({ submittedVersionId: id(9) })), false, 'another version is the current submission');
  assert.equal(applicationDocumentNoticeVisible(sent, view({ submittedVersionId: draftVersion, reviewed: true })), false, 'a staff decision replaces «sent»');
});

test('«saved, not sent» notice shows while that file waits and goes once it is sent or replaced', () => {
  assert.equal(applicationDocumentNoticeVisible(notSent, view()), true, 'right after the failure, before the refresh');
  assert.equal(applicationDocumentNoticeVisible(notSent, view({ unsentDraftVersionId: draftVersion })), true);
  assert.equal(applicationDocumentNoticeVisible(notSent, view({ unsentDraftVersionId: id(9) })), false, 'a newer unsent file replaces it');
  assert.equal(applicationDocumentNoticeVisible(notSent, view({ submittedVersionId: draftVersion })), false, 'it was sent afterwards');
  assert.equal(applicationDocumentNoticeVisible(notSent, view({ submittedVersionId: id(9), unsentDraftVersionId: draftVersion })), true, 'an older submission does not hide it');
});

test('page hint claims two steps only when it is true for every uploadable document, and never claims one tap', () => {
  const doc = (canUpload, canSubmit) => ({ canUpload, canSubmit });
  assert.equal(studentDocumentPageHint(undefined), null, 'nothing loaded: no claim, no flicker');
  assert.equal(studentDocumentPageHint(null), null);
  assert.equal(studentDocumentPageHint([]), null);
  // A document with an unfinished earlier send on this device falls back to two steps; server flags cannot see that.
  assert.equal(studentDocumentPageHint([doc(true, true), doc(true, true)]), null, 'one tap is left to each document');
  assert.equal(studentDocumentPageHint([doc(true, false), doc(true, false)]), 'two_step');
  assert.equal(studentDocumentPageHint([doc(true, true), doc(true, false)]), null, 'mixed page: each document speaks for itself');
  assert.equal(studentDocumentPageHint([doc(true, false), doc(false, true)]), 'two_step', 'a document that cannot be uploaded is not part of the claim');
  assert.equal(studentDocumentPageHint([doc(false, true)]), null);
});

test('during a one-tap send the stored submit intent is that send\'s own, not an unfinished earlier one', async () => {
  // While the server action runs, the submit intent is on the device and a second press is refused by the lock.
  // The item therefore keeps the tap-time view and the standalone control stays quiet until the run ends.
  const w = world(); let seen = null; let second = null;
  const submit = async (_scope, intent) => {
    seen = readApplicationDocumentPending(scope, 'submit', id(4), w.storage).intent;
    second = await runApplicationDocumentSubmit({ scope, target, selection: null, previousSubmissionId: null, submit, whenRetained: 'resend', env: w.env });
    return { ok: true, receipt: { requestId: intent.requestId } };
  };
  const upload = async ({ intent }) => ({ ok: true, receipt: receiptFor(intent) });
  const outcome = await runApplicationDocumentUploadAndSubmit({ scope, audience: 'student', target, file, upload, env: w.env,
    newRequestId: () => submitRequestId, sendAfterUpload: { previousSubmissionId: null, submit } });
  assert.equal(seen?.requestId, submitRequestId, 'the intent seen mid-send is the running one');
  assert.deepEqual(second, { status: 'locked', reason: 'busy' }, 'a press beside the running send sends nothing');
  assert.equal(outcome.submit.status, 'sent');
  assert.equal(readApplicationDocumentPending(scope, 'submit', id(4), w.storage).intent, null);

  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const item = read('src/components/portal/admissionPreparations/ProgramDocumentItem.tsx');
  assert.match(item, /const sendAfterSave = oneTapRun \?\? \(audience === "student"/u, 'the tap-time view holds while the run lasts');
  assert.match(item, /onSendingChange=\{onOneTapRun\}[^\n]*\/>\n\s*<\/details> : <ProgramDocumentUpload[^\n]*\n[^\n]*onSendingChange=\{onOneTapRun\}/u, 'both upload forms report the run');
  assert.match(item, /suppressed=\{oneTapRun !== null\}/u);
  const controls = read('src/components/portal/admissionPreparations/ProgramDocumentControls.tsx');
  assert.match(controls, /const retained = !suppressed && pending\.intent && "selection" in pending\.intent/u, 'no «Проверить результат» for the running send');
  assert.match(controls, /if \(sending\.current \|\| suppressed \|\|/u);
  assert.match(controls, /disabled=\{!hydrated \|\| busy \|\| suppressed \|\|/u);
  const save = controls.slice(controls.indexOf('async function save('), controls.indexOf('if (disabled && !retained && !pending.blocked) return null;'));
  const started = save.indexOf('onSendingChange?.(run, true)'), runs = save.indexOf('runApplicationDocumentUploadAndSubmit('),
    ended = save.indexOf('onSendingChange?.(run, false)'), refreshed = save.indexOf('onSaved()');
  assert.ok(started > 0 && started < runs && runs < ended && ended < refreshed, 'reported before the run, released before the refresh');
  assert.match(save, /const run = oneTap && sendAfterSave \? \{ previousSubmissionId: sendAfterSave\.previousSubmissionId \} : null;/u, 'a fresh run object per tap');
  assert.match(item, /setOneTapRun\(current => nextOneTapRun\(current, run, active\)\)/u, 'only the run that started the view ends it');
  assert.match(item, /itemSending=\{oneTapRun !== null\}[^\n]*\/>\n\s*<\/details> : <ProgramDocumentUpload[^\n]*\n[^\n]*itemSending=\{oneTapRun !== null\}/u, 'both upload forms know a send runs');
  // A form remounted during the send waits for it; the upload this form itself is making is not shown as unfinished.
  assert.match(controls, /const elsewhere = itemSending && !busy;/u);
  assert.match(controls, /const shownRetained = busy \|\| elsewhere \? null : retained;/u);
  assert.match(controls, /if \(sending\.current \|\| elsewhere \|\|/u);
  assert.match(controls, /const inert = !hydrated \|\| busy \|\| elsewhere \|\|/u);
  assert.match(controls, /\{shownRetained && !succeeded \? <p className=\{styles\.note\}>\{strings\.pending\}/u);
  assert.match(controls, /\{shownRetained \? strings\.reselectFile : strings\.chooseFile\}/u);
});

test('only the one-tap run that started the item\'s «sending» view can end it', () => {
  const first = { previousSubmissionId: null }, second = { previousSubmissionId: null };
  assert.equal(nextOneTapRun(null, first, true), first);
  assert.equal(nextOneTapRun(first, first, false), null, 'the run ends its own view');
  assert.equal(nextOneTapRun(first, second, false), first, 'a second run that fails fast does not lift the first run\'s view');
  assert.equal(nextOneTapRun(second, first, false), second, 'a late first run does not end a newer one');
  assert.equal(nextOneTapRun(null, first, false), null);
});

test('a standalone send keeps its confirmation through the refresh, for students only', () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const controls = read('src/components/portal/admissionPreparations/ProgramDocumentControls.tsx');
  const submitBody = controls.slice(controls.indexOf('export function ProgramDocumentSubmit('));
  assert.match(submitBody, /const sentVersionId = \(retained\?\.selection \?\? selection\)\?\.documentVersionId \?\? null;/u, 'the confirmation names the version that was actually sent');
  const sentAt = submitBody.indexOf('onSent?.(sentVersionId, text)'), refreshAt = submitBody.indexOf('onSaved()', sentAt);
  assert.ok(sentAt > 0 && sentAt < refreshAt, 'kept before the refresh remounts the control');
  const item = read('src/components/portal/admissionPreparations/ProgramDocumentItem.tsx');
  assert.match(item, /onSent=\{audience === "student" \? \(versionId, text\) => onNotice\(\{ tone: "success", text, versionId \}\) : undefined\}/u, 'staff copy and behaviour stay as they were');
  // The kept «sent» line shows only once the refreshed item has that very version as its submission.
  assert.equal(applicationDocumentNoticeVisible({ tone: 'success', text: 'x', versionId: id(30) }, { submittedVersionId: id(30), reviewed: false, unsentDraftVersionId: null }), true);
  assert.equal(applicationDocumentNoticeVisible({ tone: 'success', text: 'x', versionId: id(30) }, { submittedVersionId: id(31), reviewed: false, unsentDraftVersionId: null }), false);
});

test('screens wire the one tap for students who may submit and keep staff two-step', () => {
  // Source-pattern checks: the components cannot be rendered in this runner, so the wiring is pinned by text.
  // The real behaviour is exercised in the browser QA stream.
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const item = read('src/components/portal/admissionPreparations/ProgramDocumentItem.tsx');
  assert.match(item, /audience === "student" && item\.canSubmit && !submitPending\.intent && !submitPending\.blocked/u);
  assert.match(item, /hideWhenIdle=\{audience === "student"\}/u);
  assert.match(item, /applicationDocumentNoticeVisible\(notice,/u);
  const controls = read('src/components/portal/admissionPreparations/ProgramDocumentControls.tsx');
  assert.match(controls, /runApplicationDocumentUploadAndSubmit/u);
  assert.match(controls, /runApplicationDocumentSubmit/u);
  assert.match(controls, /outcome\.reason === "busy" \? strings\.savedSendBusy/u);
  assert.match(controls, /tone: "success"/u);
  assert.doesNotMatch(controls, /persistApplicationDocumentPending|withApplicationDocumentLock/u, 'components reuse the shared commands instead of forking them');
  const staff = read('src/components/v3/profile/StaffPreparationPanel.tsx');
  assert.doesNotMatch(staff, /sendAfterSave/u);
  const recovery = read('src/components/portal/admissionPreparations/ProgramDocumentRecovery.tsx');
  assert.doesNotMatch(recovery, /sendAfterSave/u);
  const page = read('src/components/portal/admissionPreparations/ApplicationRequirementsUI.tsx');
  assert.match(page, /studentDocumentPageHint\(documents\?\.documentItems\)/u);
  assert.doesNotMatch(page, /saveHintOneTap/u, 'the page never promises one tap for every document');
  assert.doesNotMatch(page, /some\(item => item\.canSubmit\)/u, 'one uploadable document must not decide the whole page');
});
