// «Сохранить файл», «Отправить на проверку» и «Загрузить и отправить»: порядок записи запроса, замков и сетевых вызовов
// с настоящим хранилищем запросов и поддельными загрузкой и отправкой. Повторяет сценарии `tests/application-documents-commands.test.mjs` веба.
import { createHash } from "node:crypto";

import type { ApplicationDocumentSubmitIntent, ApplicationDocumentUploadIntent } from "@web/lib/portal/application-documents";

import type { PickedFile } from "@/domain/documents-model";
import { runSubmit, runUpload, runUploadAndSubmit, type SubmitFn, type UploadFn } from "@/features/preparations/document-commands";
import { documentsPending, isSubmitIntent, isUploadIntent } from "@/features/preparations/documents-pending";
import type { PendingScope } from "@/features/preparations/pending-store";
import { freezeUploadIntent, type Fingerprinter } from "@/features/preparations/upload-protocol";
import { memoryPendingStorage } from "@/test-fixtures/pending-storage";
import { APPLICATION_ID, REVISION_ID, STUDENT_CASE_ID, itemId, slotId, uploadId, versionId } from "@/test-fixtures/preparations";

const scope: PendingScope = { organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", membershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID };
const target = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requirementsRevisionId: REVISION_ID, requirementItemId: itemId(0), documentSlotId: slotId(0) };
const ITEM = itemId(0);
const bytes = new TextEncoder().encode("%PDF-1.7\none tap fixture");
const digest = createHash("sha256").update(bytes).digest("hex");
const fingerprint: Fingerprinter = async (file) => (file.name === "другой.pdf" ? { byteSize: 5, sha256Hex: createHash("sha256").update("другой").digest("hex") } : { byteSize: bytes.byteLength, sha256Hex: digest });
const file: PickedFile = { uri: "file:///cache/справка.pdf", name: "справка.pdf", size: bytes.byteLength, mimeType: "application/pdf", source: "file" };
const SUBMIT_REQUEST = "99999999-0000-4000-8000-000000000060";
const PREVIOUS = "33333333-0000-4000-8000-000000000070";

function world(over: { blockSetFor?: string; busySubmit?: boolean } = {}) {
  const storage = memoryPendingStorage();
  const log: string[] = [];
  const label = (key: string) => key.split(":").slice(-2).join(":").replace(ITEM, "item");
  const base = { ...storage };
  const wrapped = {
    ...storage,
    getItem: base.getItem,
    setItem: async (key: string, value: string) => {
      if (over.blockSetFor && key.includes(over.blockSetFor)) throw new Error("quota");
      log.push(`store ${label(key)}`);
      await base.setItem(key, value);
    },
    removeItem: async (key: string) => {
      log.push(`clear ${label(key)}`);
      await base.removeItem(key);
    },
  };
  return { storage: wrapped, data: storage.data, log };
}
type World = ReturnType<typeof world>;

const receiptFor = (intent: ApplicationDocumentUploadIntent) => ({ ...intent, uploadContextId: uploadId(7), documentVersionId: versionId(8), versionNo: "1", finalizedAt: "2026-10-26T10:00:00+00:00", publishedToLegacySlot: false as const });

/** Замороженный запрос прежней загрузки, оставшийся на телефоне. */
async function retainedUpload(over: Partial<typeof target> = {}) {
  const frozen = await freezeUploadIntent({ target: { ...target, ...over }, file, requestId: "99999999-0000-4000-8000-000000000006", fingerprint });
  if (frozen.status !== "frozen") throw new Error(`не заморозился: ${frozen.status}`);
  return frozen.intent;
}

function fakes(w: World, options: { uploadResult?: (intent: ApplicationDocumentUploadIntent) => Awaited<ReturnType<UploadFn>>; submitResult?: Awaited<ReturnType<SubmitFn>>; submitThrows?: boolean } = {}) {
  const calls = { upload: [] as ApplicationDocumentUploadIntent[], submit: [] as ApplicationDocumentSubmitIntent[] };
  const probes: { uploadFree?: boolean; submitHeld?: boolean } = {};
  const upload: UploadFn = async ({ intent }) => {
    calls.upload.push(intent);
    w.log.push("call upload");
    expect((await documentsPending.read(scope, "upload", ITEM, w.storage)).intent).toEqual(intent); // запрос записан до вызова
    return options.uploadResult ? options.uploadResult(intent) : { ok: true, receipt: receiptFor(intent) as never };
  };
  const submit: SubmitFn = async (intent) => {
    calls.submit.push(intent);
    w.log.push("call submit");
    expect((await documentsPending.read(scope, "submit", ITEM, w.storage)).intent).toEqual(intent);
    // замок загрузки уже отпущен, замок отправки держится
    probes.uploadFree = (await documentsPending.withLock(scope, "upload", ITEM, async () => true, w.storage)).acquired;
    probes.submitHeld = !(await documentsPending.withLock(scope, "submit", ITEM, async () => true, w.storage)).acquired;
    if (options.submitThrows) throw new Error("network");
    return options.submitResult ?? { ok: true, receipt: { requestId: intent.requestId } as never };
  };
  return { calls, probes, upload, submit };
}

const oneTap = (w: World, f: ReturnType<typeof fakes>, extra: Record<string, unknown> = {}) =>
  runUploadAndSubmit({ scope, target, file, fingerprint, upload: f.upload, env: { storage: w.storage, newRequestId: () => SUBMIT_REQUEST }, sendAfterUpload: { previousSubmissionId: PREVIOUS, submit: f.submit }, ...extra } as Parameters<typeof runUploadAndSubmit>[0]);

describe("одно нажатие: загрузить и отправить", () => {
  it("загрузка, затем отправка именно этой версии; запросы записаны до вызовов, замки по очереди", async () => {
    const w = world();
    const f = fakes(w);
    const stages: string[] = [];
    const outcome = await oneTap(w, f, { onStage: (s: string) => stages.push(s) });
    expect(outcome).toMatchObject({ stage: "done", upload: { status: "uploaded", cleared: true }, submit: { status: "sent", cleared: true } });
    expect(stages).toEqual(["upload", "submit"]);
    expect(w.log).toEqual(["store upload:item", "call upload", "clear upload:item", "store submit:item", "call submit", "clear submit:item"]);
    expect(f.probes).toEqual({ uploadFree: true, submitHeld: true });
    expect(w.data.size).toBe(0);
    expect(f.calls.submit).toEqual([
      {
        studentCaseId: STUDENT_CASE_ID,
        applicationId: APPLICATION_ID,
        requirementsRevisionId: REVISION_ID,
        requirementItemId: ITEM,
        requestId: SUBMIT_REQUEST,
        selection: { kind: "program_upload", uploadContextId: uploadId(7), documentVersionId: versionId(8) },
        expectedPreviousSubmissionId: PREVIOUS,
      },
    ]);
  });

  it("первая отправка по требованию: прежней отправки нет", async () => {
    const w = world();
    const f = fakes(w);
    await oneTap(w, f, { sendAfterUpload: { previousSubmissionId: null, submit: f.submit } });
    expect(f.calls.submit[0]?.expectedPreviousSubmissionId).toBeNull();
  });

  it("сбой загрузки: отправка не вызывается и её запрос не пишется; неизвестный исход оставляет запрос загрузки", async () => {
    for (const [uploadResult, kept] of [
      [() => ({ ok: false, reason: "unsupported_type", resolution: "not_written" }), false],
      [() => ({ ok: false, reason: "unavailable", resolution: "retain" }), true],
    ] as const) {
      const w = world();
      const f = fakes(w, { uploadResult: uploadResult as never });
      const outcome = await oneTap(w, f);
      expect(outcome).toMatchObject({ stage: "upload", upload: { status: "rejected" } });
      expect(f.calls.submit).toHaveLength(0);
      expect((await documentsPending.read(scope, "submit", ITEM, w.storage)).intent).toBeNull();
      expect((await documentsPending.read(scope, "upload", ITEM, w.storage)).intent !== null).toBe(kept);
    }
  });

  it("отправка отклонена после сохранения: файл остался, обычная кнопка «Отправить» может закончить", async () => {
    const w = world();
    const f = fakes(w, { submitResult: { ok: false, reason: "stale_context", resolution: "not_written" } });
    const outcome = await oneTap(w, f);
    expect(outcome).toMatchObject({ stage: "done", upload: { status: "uploaded" }, submit: { status: "rejected", reason: "stale_context", resolution: "not_written" } });
    expect(w.data.size).toBe(0);
    const g = fakes(w);
    const again = await runSubmit({ scope, target, previousSubmissionId: PREVIOUS, submit: g.submit, whenRetained: "resend", env: { storage: w.storage, newRequestId: () => "99999999-0000-4000-8000-000000000061" }, selection: { kind: "program_upload", uploadContextId: uploadId(7), documentVersionId: versionId(8) } });
    expect(again).toEqual({ status: "sent", cleared: true });
    expect(g.calls.submit).toHaveLength(1);
  });

  it("исход отправки неизвестен: запрос остаётся, отдельная кнопка повторяет ТОТ ЖЕ запрос", async () => {
    const w = world();
    const f = fakes(w, { submitResult: { ok: false, reason: "unavailable", resolution: "retain" } });
    const outcome = await oneTap(w, f);
    expect(outcome).toMatchObject({ submit: { status: "rejected", reason: "unavailable", resolution: "retain" } });
    const retained = (await documentsPending.read(scope, "submit", ITEM, w.storage)).intent;
    expect(isSubmitIntent(retained) && retained.requestId).toBe(SUBMIT_REQUEST);
    expect((await documentsPending.read(scope, "upload", ITEM, w.storage)).intent).toBeNull();
    const g = fakes(w);
    const retry = await runSubmit({ scope, target, previousSubmissionId: PREVIOUS, submit: g.submit, whenRetained: "resend", env: { storage: w.storage }, selection: null });
    expect(retry).toEqual({ status: "sent", cleared: true });
    expect(g.calls.submit[0]?.requestId).toBe(SUBMIT_REQUEST);
    expect(w.data.size).toBe(0);
  });

  it("исключение после записи запроса отправки: «неизвестно», запрос остался", async () => {
    const w = world();
    const f = fakes(w, { submitThrows: true });
    const outcome = await oneTap(w, f);
    expect(outcome).toMatchObject({ submit: { status: "unknown" } });
    const retained = (await documentsPending.read(scope, "submit", ITEM, w.storage)).intent;
    expect(isSubmitIntent(retained) && retained.requestId).toBe(SUBMIT_REQUEST);
    expect(f.calls.submit).toHaveLength(1);
  });

  it("запрос отправки не удалось записать: отправка не вызывается", async () => {
    const w = world({ blockSetFor: "submit:" });
    const f = fakes(w);
    const outcome = await oneTap(w, f);
    expect(outcome).toMatchObject({ upload: { status: "uploaded" }, submit: { status: "locked", reason: "storage_unavailable" } });
    expect(f.calls.submit).toHaveLength(0);
  });

  it("запись отправки в хранилище испорчена: отправка не вызывается", async () => {
    const w = world();
    const f = fakes(w);
    w.data.set(documentsPending.key(scope, "submit", ITEM), "garbage");
    const outcome = await oneTap(w, f);
    expect(outcome).toMatchObject({ submit: { status: "locked", reason: "storage_unavailable" } });
    expect(f.calls.submit).toHaveLength(0);
  });

  it("замок отправки занят: файл сохранён, ничего не отправлено", async () => {
    const w = world();
    const f = fakes(w);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = documentsPending.withLock(scope, "submit", ITEM, () => gate, w.storage);
    const outcome = await oneTap(w, f);
    expect(outcome).toMatchObject({ upload: { status: "uploaded" }, submit: { status: "locked", reason: "busy" } });
    expect(f.calls.submit).toHaveLength(0);
    release();
    await holder;
  });

  it("неоконченная загрузка доходит до конца и продолжается отправкой со своим прежним запросом", async () => {
    const w = world();
    await documentsPending.persist(scope, "upload", ITEM, await retainedUpload(), w.storage);
    w.log.length = 0;
    const f = fakes(w);
    const outcome = await oneTap(w, f);
    expect(f.calls.upload[0]?.requestId).toBe("99999999-0000-4000-8000-000000000006");
    expect(outcome).toMatchObject({ submit: { status: "sent", cleared: true } });
    expect(f.calls.submit[0]?.selection.documentVersionId).toBe(versionId(8));
    expect(w.data.size).toBe(0);
  });

  it("неоконченная загрузка с другим файлом отклоняется до любой отправки", async () => {
    const w = world();
    await documentsPending.persist(scope, "upload", ITEM, await retainedUpload(), w.storage);
    const f = fakes(w);
    const outcome = await oneTap(w, f, { file: { ...file, name: "другой.pdf", size: 5 } });
    expect(outcome).toEqual({ stage: "upload", upload: { status: "wrong_file" } });
    expect(f.calls.upload).toHaveLength(0);
    expect(f.calls.submit).toHaveLength(0);
  });

  it("неоконченная загрузка по прежним требованиям сохраняется, но не отправляется", async () => {
    const w = world();
    await documentsPending.persist(scope, "upload", ITEM, await retainedUpload({ requirementsRevisionId: slotId(33) }), w.storage);
    const f = fakes(w);
    const outcome = await oneTap(w, f);
    expect(outcome).toMatchObject({ upload: { status: "uploaded" }, submit: { status: "skipped", why: "target_changed" } });
    expect(f.calls.submit).toHaveLength(0);
  });

  it("прежний неоконченный запрос отправки не повторяется вместо нового файла", async () => {
    const w = world();
    const earlier: ApplicationDocumentSubmitIntent = {
      studentCaseId: STUDENT_CASE_ID,
      applicationId: APPLICATION_ID,
      requirementsRevisionId: REVISION_ID,
      requirementItemId: ITEM,
      requestId: "99999999-0000-4000-8000-000000000062",
      selection: { kind: "existing_version", documentVersionId: versionId(9) },
      expectedPreviousSubmissionId: null,
    };
    await documentsPending.persist(scope, "submit", ITEM, earlier, w.storage);
    const f = fakes(w);
    const outcome = await oneTap(w, f);
    expect(outcome).toMatchObject({ upload: { status: "uploaded" }, submit: { status: "retained" } });
    expect(f.calls.submit).toHaveLength(0);
    expect((await documentsPending.read(scope, "submit", ITEM, w.storage)).intent).toEqual(earlier);
  });

  it("студенту нельзя отправлять: только загрузка, запрос отправки не пишется", async () => {
    const w = world();
    const f = fakes(w);
    const outcome = await oneTap(w, f, { sendAfterUpload: null });
    expect(outcome).toMatchObject({ upload: { status: "uploaded" }, submit: { status: "skipped", why: "upload_only" } });
    expect(f.calls.submit).toHaveLength(0);
    expect(f.calls.upload).toHaveLength(1);
    expect((await documentsPending.read(scope, "submit", ITEM, w.storage)).intent).toBeNull();
  });
});

describe("отправка отдельной кнопкой", () => {
  it("ничего не выбрано и запроса нет: команда не запускается", async () => {
    const w = world();
    const f = fakes(w);
    expect(await runSubmit({ scope, target, selection: null, previousSubmissionId: null, submit: f.submit, whenRetained: "resend", env: { storage: w.storage } })).toEqual({ status: "idle" });
    expect(f.calls.submit).toHaveLength(0);
    expect(w.log).toEqual([]);
  });

  it("выбранная версия: запрос с id, выбором и прежней отправкой записывается и снимается после квитанции", async () => {
    const w = world();
    const f = fakes(w);
    const selection = { kind: "existing_version" as const, documentVersionId: versionId(4) };
    const outcome = await runSubmit({ scope, target, selection, previousSubmissionId: PREVIOUS, submit: f.submit, whenRetained: "resend", env: { storage: w.storage, newRequestId: () => SUBMIT_REQUEST } });
    expect(outcome).toEqual({ status: "sent", cleared: true });
    expect(f.calls.submit[0]).toMatchObject({ requestId: SUBMIT_REQUEST, selection, expectedPreviousSubmissionId: PREVIOUS });
    expect(w.log).toEqual(["store submit:item", "call submit", "clear submit:item"]);
  });

  it("«stop»: сохранённый запрос не повторяется, команда сообщает «оставлен»", async () => {
    const w = world();
    const f = fakes(w, { submitResult: { ok: false, reason: "unavailable", resolution: "retain" } });
    await oneTap(w, f);
    const g = fakes(w);
    expect(await runSubmit({ scope, target, selection: null, previousSubmissionId: null, submit: g.submit, whenRetained: "stop", env: { storage: w.storage } })).toEqual({ status: "retained" });
    expect(g.calls.submit).toHaveLength(0);
  });

  it("хранилище не очищается после квитанции: «sent», но cleared=false (студенту скажут, что запрос можно проверить)", async () => {
    const w = world();
    const f = fakes(w);
    const stubborn = { ...w.storage, removeItem: async () => { throw new Error("disk"); } };
    const outcome = await runSubmit({ scope, target, selection: { kind: "existing_version", documentVersionId: versionId(4) }, previousSubmissionId: null, submit: f.submit, whenRetained: "resend", env: { storage: stubborn } });
    expect(outcome).toEqual({ status: "sent", cleared: false });
  });
});

describe("загрузка отдельно", () => {
  it("замок, запись, загрузка, снятие; квитанция с отпечатком файла", async () => {
    const w = world();
    const f = fakes(w);
    const outcome = await runUpload({ scope, target, file, fingerprint, upload: f.upload, env: { storage: w.storage } });
    expect(outcome).toMatchObject({ status: "uploaded", cleared: true, receipt: { file: { sha256Hex: digest } } });
    expect(w.log).toEqual(["store upload:item", "call upload", "clear upload:item"]);
  });

  it("ход загрузки доходит до вызывающего", async () => {
    const w = world();
    const percents: number[] = [];
    const upload: UploadFn = async ({ intent, onProgress }) => {
      onProgress?.(10);
      onProgress?.(100);
      return { ok: true, receipt: receiptFor(intent) as never };
    };
    await runUpload({ scope, target, file, fingerprint, upload, onProgress: (p) => percents.push(p), env: { storage: w.storage } });
    expect(percents).toEqual([10, 100]);
  });

  it("негодный файл: запрос не пишется, сеть не вызывается", async () => {
    const w = world();
    const f = fakes(w);
    expect(await runUpload({ scope, target, file: { ...file, mimeType: "image/heic", name: "a.heic" }, fingerprint, upload: f.upload, env: { storage: w.storage } })).toEqual({ status: "invalid_file" });
    expect(f.calls.upload).toHaveLength(0);
    expect(w.data.size).toBe(0);
  });

  it("файл не прочитался: «не прочитался», а не «не годится»; запрос не пишется, сеть не вызывается", async () => {
    const w = world();
    const f = fakes(w);
    const unreadable: Fingerprinter = async () => {
      throw new Error("file vanished");
    };
    expect(await runUpload({ scope, target, file, fingerprint: unreadable, upload: f.upload, env: { storage: w.storage } })).toEqual({ status: "unreadable" });
    expect(f.calls.upload).toHaveLength(0);
    expect(w.data.size).toBe(0);
  });

  it("неоконченная загрузка и файл, который не прочитался: запись цела, чужим файлом это не считается", async () => {
    const w = world();
    const f = fakes(w);
    const retained = await retainedUpload();
    await documentsPending.persist(scope, "upload", ITEM, retained, w.storage);
    const unreadable: Fingerprinter = async () => {
      throw new Error("file vanished");
    };
    expect(await runUpload({ scope, target, file, fingerprint: unreadable, upload: f.upload, env: { storage: w.storage } })).toEqual({ status: "unreadable" });
    expect((await documentsPending.read(scope, "upload", ITEM, w.storage)).intent).toEqual(retained);
    expect(f.calls.upload).toHaveLength(0);
  });

  it("сбой до отправки (`not_sent`, «не записано»): запись о загрузке снимается, файл можно выбрать любой", async () => {
    const w = world();
    const f = fakes(w, { uploadResult: () => ({ ok: false, reason: "not_sent", resolution: "not_written" }) });
    expect(await runUpload({ scope, target, file, fingerprint, upload: f.upload, env: { storage: w.storage } })).toEqual({ status: "rejected", reason: "not_sent", resolution: "not_written" });
    expect(w.data.size).toBe(0);
    expect(w.log).toEqual(["store upload:item", "call upload", "clear upload:item"]);
  });

  it("сбой до отправки на ПОВТОРЕ после неизвестного исхода: запись прежней попытки остаётся (она могла дойти), исход по-прежнему неизвестен", async () => {
    const w = world();
    const first = fakes(w, { uploadResult: () => ({ ok: false, reason: "unavailable", resolution: "retain" }) });
    await runUpload({ scope, target, file, fingerprint, upload: first.upload, env: { storage: w.storage, newRequestId: () => "99999999-0000-4000-8000-000000000006" } });
    const kept = (await documentsPending.read(scope, "upload", ITEM, w.storage)).intent;
    expect(isUploadIntent(kept) && kept.requestId).toBe("99999999-0000-4000-8000-000000000006");
    // нет сессии без связи: файл выбран заново, а до отправки дело не дошло
    const offline = fakes(w, { uploadResult: () => ({ ok: false, reason: "not_sent", resolution: "not_written" }) });
    expect(await runUpload({ scope, target, file, fingerprint, upload: offline.upload, env: { storage: w.storage } })).toEqual({ status: "rejected", reason: "unavailable", resolution: "retain" });
    expect((await documentsPending.read(scope, "upload", ITEM, w.storage)).intent).toEqual(kept);
    // следующая настоящая попытка идёт с тем же номером запроса: на сервере дубля не будет
    const again = fakes(w);
    expect((await runUpload({ scope, target, file, fingerprint, upload: again.upload, env: { storage: w.storage } })).status).toBe("uploaded");
    expect(again.calls.upload[0]?.requestId).toBe("99999999-0000-4000-8000-000000000006");
    expect(w.data.size).toBe(0);
  });

  it("сбой до отправки на ПЕРВОЙ попытке (записи не было): запись, которую написала эта же команда, снимается", async () => {
    const w = world();
    const offline = fakes(w, { uploadResult: () => ({ ok: false, reason: "not_sent", resolution: "not_written" }) });
    expect(await runUpload({ scope, target, file, fingerprint, upload: offline.upload, env: { storage: w.storage } })).toEqual({ status: "rejected", reason: "not_sent", resolution: "not_written" });
    expect(w.data.size).toBe(0);
  });

  it("испорченная запись загрузки блокирует: «хранилище недоступно», сеть не вызывается", async () => {
    const w = world();
    const f = fakes(w);
    w.data.set(documentsPending.key(scope, "upload", ITEM), "{bad");
    expect(await runUpload({ scope, target, file, fingerprint, upload: f.upload, env: { storage: w.storage } })).toEqual({ status: "locked", reason: "storage_unavailable" });
    expect(f.calls.upload).toHaveLength(0);
  });

  it("запрос не записался: сеть не вызывается", async () => {
    const w = world({ blockSetFor: "upload:" });
    const f = fakes(w);
    expect(await runUpload({ scope, target, file, fingerprint, upload: f.upload, env: { storage: w.storage } })).toEqual({ status: "locked", reason: "storage_unavailable" });
    expect(f.calls.upload).toHaveLength(0);
  });

  it("повторное нажатие во время загрузки: «занято», вторая загрузка не стартует", async () => {
    const w = world();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: UploadFn = async ({ intent }) => {
      await gate;
      return { ok: true, receipt: receiptFor(intent) as never };
    };
    const first = runUpload({ scope, target, file, fingerprint, upload: slow, env: { storage: w.storage } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const f = fakes(w);
    expect(await runUpload({ scope, target, file, fingerprint, upload: f.upload, env: { storage: w.storage } })).toEqual({ status: "locked", reason: "busy" });
    expect(f.calls.upload).toHaveLength(0);
    release();
    expect((await first).status).toBe("uploaded");
  });

  it("точный отказ «не записано» снимает запрос, неизвестный оставляет", async () => {
    for (const [resolution, kept] of [["not_written", false], ["retain", true]] as const) {
      const w = world();
      const f = fakes(w, { uploadResult: () => ({ ok: false, reason: "unavailable", resolution }) });
      expect(await runUpload({ scope, target, file, fingerprint, upload: f.upload, env: { storage: w.storage } })).toEqual({ status: "rejected", reason: "unavailable", resolution });
      const left = (await documentsPending.read(scope, "upload", ITEM, w.storage)).intent;
      expect(isUploadIntent(left)).toBe(kept);
    }
  });

  it("повтор после обрыва использует прежний запрос и тот же файл; чужой файл - отказ без сети", async () => {
    const w = world();
    const first = fakes(w, { uploadResult: () => ({ ok: false, reason: "unavailable", resolution: "retain" }) });
    await runUpload({ scope, target, file, fingerprint, upload: first.upload, env: { storage: w.storage, newRequestId: () => "99999999-0000-4000-8000-000000000006" } });
    const other = fakes(w);
    expect(await runUpload({ scope, target, file: { ...file, name: "другой.pdf", size: 5 }, fingerprint, upload: other.upload, env: { storage: w.storage } })).toEqual({ status: "wrong_file" });
    expect(other.calls.upload).toHaveLength(0);
    const again = fakes(w);
    const outcome = await runUpload({ scope, target, file, fingerprint, upload: again.upload, env: { storage: w.storage } });
    expect(outcome.status).toBe("uploaded");
    expect(again.calls.upload[0]?.requestId).toBe("99999999-0000-4000-8000-000000000006");
    expect(w.data.size).toBe(0);
  });
});
