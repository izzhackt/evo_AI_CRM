// RPC документов программы: отправка на проверку, сохранённые версии, история.
import { DOCUMENT_PAGE_SIZE, readDocumentHistory, readReusableVersions, submitApplicationDocument } from "@/api/preparations-documents";
import { PortalDecodeError } from "@/domain/portal-source";
import { RpcError, type RpcTransport, type RpcTransportResult } from "@/lib/rpc";
import {
  APPLICATION_ID,
  STUDENT_CASE_ID,
  REVISION_ID,
  historyPage,
  historySubmission,
  historyUpload,
  itemId,
  reusableVersion,
  reviewOf,
  submitReceipt,
  uploadId,
  versionId,
  versionsPage,
} from "@/test-fixtures/preparations";
import { failure, fakeTransport } from "@/test-fixtures/universities";

const REQUEST = "99999999-0000-4000-8000-000000000001";
const intent = (over: Record<string, unknown> = {}) => ({
  studentCaseId: STUDENT_CASE_ID,
  applicationId: APPLICATION_ID,
  requirementsRevisionId: REVISION_ID,
  requirementItemId: itemId(0),
  requestId: REQUEST,
  selection: { kind: "program_upload", uploadContextId: uploadId(1), documentVersionId: versionId(1) },
  expectedPreviousSubmissionId: null,
  ...over,
});

function scripted(results: (RpcTransportResult | Error)[]) {
  const calls: { name: string; args: unknown; get: boolean }[] = [];
  const transport: RpcTransport = async (name, args, options) => {
    calls.push({ name, args, get: options.get });
    const next = results.shift();
    if (next === undefined) throw new Error("no more");
    if (next instanceof Error) throw next;
    return next;
  };
  return { transport, calls };
}
const ok = (data: unknown): RpcTransportResult => ({ data, error: null, status: 200 });
const bad = (code: string | null, status: number, message: string | null = null): RpcTransportResult => ({ data: null, error: { code, message }, status });

describe("submit_application_document_v1", () => {
  it("аргументы веба по именам, выбор объектом, тот же p_request_id; квитанция принимается только точная", async () => {
    const { transport, calls } = scripted([ok(submitReceipt(0, REQUEST, versionId(1)))]);
    const result = await submitApplicationDocument(transport, intent());
    expect(result).toMatchObject({ ok: true, receipt: { requestId: REQUEST, documentVersionId: versionId(1), reused: false } });
    expect(calls).toEqual([
      {
        name: "submit_application_document_v1",
        get: false,
        args: {
          p_student_case_id: STUDENT_CASE_ID,
          p_application_id: APPLICATION_ID,
          p_requirements_revision_id: REVISION_ID,
          p_requirement_item_id: itemId(0),
          p_selection: { kind: "program_upload", uploadContextId: uploadId(1), documentVersionId: versionId(1) },
          p_expected_previous_submission_id: null,
          p_request_id: REQUEST,
        },
      },
    ]);
  });

  it("негодный запрос не уходит на сервер", async () => {
    const { transport, calls } = scripted([]);
    for (const value of [null, {}, intent({ requestId: "x" }), intent({ selection: { kind: "existing_version" } })]) {
      expect(await submitApplicationDocument(transport, value)).toEqual({ ok: false, reason: "invalid", resolution: "retain" });
    }
    expect(calls).toHaveLength(0);
  });

  it("отказы базы: точные «не записано» и «осталось» как у веба", async () => {
    const cases: [RpcTransportResult, string, string][] = [
      [bad("42501", 403), "forbidden", "retain"],
      [bad("PT409", 409, "application_document_stale_requirements"), "stale_context", "not_written"],
      [bad("PT409", 409, "application_document_mapping_changed"), "stale_context", "not_written"],
      [bad("PT409", 409, "application_document_previous_submission_changed"), "stale_context", "not_written"],
      [bad("PT409", 409, "application_document_file_unavailable"), "file_unavailable", "not_written"],
      [bad("22023", 400, "application_document_intent_conflict"), "request_conflict", "retain"],
      [bad("22023", 400, "application_document_invalid_intent"), "invalid", "retain"],
      [bad("PT418", 418, "что-то непонятное"), "unavailable", "retain"],
    ];
    for (const [response, reason, resolution] of cases) {
      const { transport } = scripted([response]);
      expect([response.error?.message, await submitApplicationDocument(transport, intent())]).toEqual([response.error?.message, { ok: false, reason, resolution }]);
    }
  });

  it("обрыв: тот же запрос повторяется; нет связи совсем - неизвестно, запись не отвергнута", async () => {
    const first = scripted([new Error("offline"), bad(null, 503), ok(submitReceipt(0, REQUEST, versionId(1)))]);
    expect((await submitApplicationDocument(first.transport, intent())).ok).toBe(true);
    expect(new Set(first.calls.map((c) => JSON.stringify(c.args))).size).toBe(1);
    const second = scripted([new Error("a"), new Error("b"), new Error("c")]);
    expect(await submitApplicationDocument(second.transport, intent())).toEqual({ ok: false, reason: "unavailable", resolution: "retain" });
    expect(second.calls).toHaveLength(3);
  });

  it("квитанция на другой запрос, другую версию или чужой формы не считается успехом", async () => {
    for (const receipt of [
      submitReceipt(0, "99999999-0000-4000-8000-000000000002", versionId(1)),
      submitReceipt(0, REQUEST, versionId(2)),
      submitReceipt(1, REQUEST, versionId(1)),
      submitReceipt(0, REQUEST, versionId(1), { reused: "нет" }),
      { ...submitReceipt(0, REQUEST, versionId(1)), extra: 1 },
      null,
    ]) {
      const { transport } = scripted([ok(receipt)]);
      expect(await submitApplicationDocument(transport, intent())).toEqual({ ok: false, reason: "unavailable", resolution: "retain" });
    }
  });
});

describe("application_document_reusable_versions_v1", () => {
  const input = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requirementItemId: itemId(0) };

  it("страница по двадцать, курсор уходит как есть; ответ разбирается строго", async () => {
    const page = versionsPage(0, [reusableVersion(5), reusableVersion(3)], { versionNo: "3", documentVersionId: versionId(3) });
    const { transport, calls } = fakeTransport({ application_document_reusable_versions_v1: page });
    const result = await readReusableVersions(transport, input, { versionNo: "9", documentVersionId: versionId(9) });
    expect(result.versions.map((v) => v.file.documentVersionId)).toEqual([versionId(5), versionId(3)]);
    expect(result.nextCursor).toEqual({ versionNo: "3", documentVersionId: versionId(3) });
    expect(calls[0]).toMatchObject({
      name: "application_document_reusable_versions_v1",
      get: false,
      args: { p_student_case_id: STUDENT_CASE_ID, p_application_id: APPLICATION_ID, p_requirement_item_id: itemId(0), p_cursor: { versionNo: "9", documentVersionId: versionId(9) }, p_limit: DOCUMENT_PAGE_SIZE },
    });
    expect(DOCUMENT_PAGE_SIZE).toBe(20);
  });

  it("первая страница без курсора (null), пустая страница", async () => {
    const { transport, calls } = fakeTransport({ application_document_reusable_versions_v1: versionsPage(0, []) });
    expect((await readReusableVersions(transport, input)).versions).toEqual([]);
    expect(calls[0]?.args).toMatchObject({ p_cursor: null });
  });

  it("чужая форма, порядок не от новых к старым и чужое требование отклоняются целиком", async () => {
    for (const bad of [null, {}, versionsPage(0, [reusableVersion(3), reusableVersion(5)]), versionsPage(1, [reusableVersion(3)]), { ...versionsPage(0, []), extra: 1 }]) {
      const { transport } = fakeTransport({ application_document_reusable_versions_v1: bad });
      await expect(readReusableVersions(transport, input)).rejects.toBeInstanceOf(PortalDecodeError);
    }
  });

  it("негодные идентификаторы и курсор не уходят на сервер; сбой сети - RpcError", async () => {
    const { transport, calls } = fakeTransport({ application_document_reusable_versions_v1: versionsPage(0, []) });
    await expect(readReusableVersions(transport, { ...input, requirementItemId: "x" })).rejects.toBeInstanceOf(PortalDecodeError);
    await expect(readReusableVersions(transport, input, { versionNo: "0", documentVersionId: "x" })).rejects.toBeInstanceOf(PortalDecodeError);
    expect(calls).toHaveLength(0);
    const down = fakeTransport({ application_document_reusable_versions_v1: failure("PT500", 500) });
    await expect(readReusableVersions(down.transport, input)).rejects.toBeInstanceOf(RpcError);
  });
});

describe("application_document_history_v1", () => {
  const program = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requirementItemId: null };

  it("история всей программы: требование null, курсор по моменту и id", async () => {
    const events = [historySubmission(0, 4, reviewOf(4, "approved"), "2026-10-09T10:00:00+00:00"), historyUpload(1, 3, "2026-10-08T10:00:00+00:00")];
    const cursor = { createdAt: "2026-10-08T10:00:00+00:00", id: uploadId(3) };
    const { transport, calls } = fakeTransport({ application_document_history_v1: historyPage(events, null, cursor) });
    const page = await readDocumentHistory(transport, program, { createdAt: "2026-10-10T10:00:00+00:00", id: uploadId(9) });
    expect(page.events.map((e) => e.kind)).toEqual(["submission", "upload"]);
    expect(page.nextCursor).toEqual(cursor);
    expect(calls[0]?.args).toMatchObject({ p_requirement_item_id: null, p_cursor: { createdAt: "2026-10-10T10:00:00+00:00", id: uploadId(9) }, p_limit: 20 });
  });

  it("история одного требования: идентификатор уходит, ответ обязан быть про него", async () => {
    const { transport, calls } = fakeTransport({ application_document_history_v1: historyPage([historyUpload(0, 3)], itemId(0)) });
    const page = await readDocumentHistory(transport, { ...program, requirementItemId: itemId(0) });
    expect(page.requirementItemId).toBe(itemId(0));
    expect(calls[0]?.args).toMatchObject({ p_requirement_item_id: itemId(0), p_cursor: null });
    const wrong = fakeTransport({ application_document_history_v1: historyPage([historyUpload(0, 3)], itemId(1)) });
    await expect(readDocumentHistory(wrong.transport, { ...program, requirementItemId: itemId(0) })).rejects.toBeInstanceOf(PortalDecodeError);
  });

  it("порядок не от новых к старым, чужая форма и несовпавший курсор отклоняются; негодные аргументы не уходят", async () => {
    const older = historyUpload(0, 3, "2026-10-08T10:00:00+00:00");
    const newer = historyUpload(1, 4, "2026-10-09T10:00:00+00:00");
    for (const bad of [null, historyPage([older, newer], null), historyPage([newer, older], null, { createdAt: "2026-10-08T10:00:00+00:00", id: uploadId(99) }), { ...historyPage([], null), extra: 1 }]) {
      const { transport } = fakeTransport({ application_document_history_v1: bad });
      await expect(readDocumentHistory(transport, program)).rejects.toBeInstanceOf(PortalDecodeError);
    }
    const { transport, calls } = fakeTransport({ application_document_history_v1: historyPage([], null) });
    await expect(readDocumentHistory(transport, { ...program, requirementItemId: "x" })).rejects.toBeInstanceOf(PortalDecodeError);
    await expect(readDocumentHistory(transport, program, { createdAt: "вчера", id: "x" })).rejects.toBeInstanceOf(PortalDecodeError);
    expect(calls).toHaveLength(0);
  });
});
