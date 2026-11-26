import {
  isNotificationId,
  readCaseHelpPage,
  readDocumentNotification,
  readHelpReply,
  readPackageDetail,
  readPackageNotification,
  readPackageReviewHistory,
} from "@/api/inbox-detail-api";
import { PortalDecodeError } from "@/domain/portal-source";
import { RpcError } from "@/lib/rpc";
import {
  APPLICATION_ID,
  DOCUMENT_NOTIFICATION_ID,
  HELP_ID,
  HELP_NOTIFICATION_ID,
  PACKAGE_ID,
  PACKAGE_NOTIFICATION_ID,
  documentNotificationRow,
  helpPageRow,
  helpReplyRow,
  helpRequestRow,
  packageDetailRow,
  packageHistoryRow,
  packageNotificationRow,
  packageReviewRow,
} from "@/test-fixtures/program-decisions";
import { STUDENT_CASE_ID, failure, fakeTransport } from "@/test-fixtures/universities";

describe("идентификатор уведомления из адреса экрана", () => {
  it("UUID годится, всё остальное нет (экран не ходит на сервер)", () => {
    expect(isNotificationId(HELP_NOTIFICATION_ID)).toBe(true);
    for (const bad of ["", "abc", "../x", `${HELP_NOTIFICATION_ID}/x`, null, undefined, 5]) expect(isNotificationId(bad)).toBe(false);
  });
});

describe("ответ куратора: student_portal_help_reply_v1", () => {
  it("GET с одним аргументом; обращение и время прочтения из ответа", async () => {
    const { transport, calls } = fakeTransport({ student_portal_help_reply_v1: helpReplyRow() });
    const reply = await readHelpReply(transport, HELP_NOTIFICATION_ID, STUDENT_CASE_ID);
    expect(calls).toEqual([{ name: "student_portal_help_reply_v1", args: { p_notification_id: HELP_NOTIFICATION_ID }, get: true }]);
    expect(reply.readAt).toBeNull();
    expect(reply.request).toMatchObject({ id: HELP_ID, status: "answered", subject: "Какие документы нужны для визы" });
  });

  it("уже прочитано: время прочтения возвращается как есть", async () => {
    const { transport } = fakeTransport({ student_portal_help_reply_v1: helpReplyRow({ readAt: "2026-11-20T10:00:00+00:00" }) });
    expect((await readHelpReply(transport, HELP_NOTIFICATION_ID, STUDENT_CASE_ID)).readAt).toBe("2026-11-20T10:00:00+00:00");
  });

  it.each([
    ["чужое дело", { ...helpReplyRow(), caseId: "99999999-9999-4999-8999-999999999999" }],
    ["обращение без ответа", helpReplyRow({ request: { status: "open", answer: null, answeredAt: null } })],
    ["две записи", { ...helpReplyRow(), items: [helpRequestRow(), helpRequestRow({ id: "97979797-9797-4797-8797-979797979797" })] }],
    ["нет readAt", (() => { const { readAt: _readAt, ...rest } = helpReplyRow(); return rest; })()],
    ["readAt не время", helpReplyRow({ readAt: "вчера" })],
    ["не объект", "строка"],
    ["пусто", null],
  ])("плохая форма отвергается: %s", async (_name, payload) => {
    const { transport } = fakeTransport({ student_portal_help_reply_v1: payload });
    await expect(readHelpReply(transport, HELP_NOTIFICATION_ID, STUDENT_CASE_ID)).rejects.toBeInstanceOf(PortalDecodeError);
  });

  it("негодный идентификатор: на сервер не ходит", async () => {
    const { transport, calls } = fakeTransport({ student_portal_help_reply_v1: helpReplyRow() });
    await expect(readHelpReply(transport, "../x", STUDENT_CASE_ID)).rejects.toBeInstanceOf(PortalDecodeError);
    expect(calls).toHaveLength(0);
  });

  it("отказ сервера доходит как RpcError без текста сервера", async () => {
    const { transport } = fakeTransport({ student_portal_help_reply_v1: failure("42501", 403) });
    await expect(readHelpReply(transport, HELP_NOTIFICATION_ID, STUDENT_CASE_ID)).rejects.toMatchObject({ kind: "forbidden" });
    await expect(readHelpReply(transport, HELP_NOTIFICATION_ID, STUDENT_CASE_ID)).rejects.toBeInstanceOf(RpcError);
  });
});

describe("прежние обращения: case_help_workspace_v1", () => {
  it("первая страница: GET только с делом, пустые курсоры опущены", async () => {
    const { transport, calls } = fakeTransport({ case_help_workspace_v1: helpPageRow([helpRequestRow()]) });
    const page = await readCaseHelpPage(transport, STUDENT_CASE_ID);
    expect(calls).toEqual([{ name: "case_help_workspace_v1", args: { p_case_id: STUDENT_CASE_ID }, get: true }]);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it("51 запись: страница обрезается до 50, курсор ведёт к более ранним; следующий запрос с курсором", async () => {
    const many = Array.from({ length: 51 }, (_, i) =>
      helpRequestRow({ id: `98989898-9898-4898-8898-${String(i).padStart(12, "0")}`, createdAt: `2026-10-${String(30 - Math.floor(i / 3)).padStart(2, "0")}T0${i % 3}:00:00+00:00` }),
    );
    const { transport, calls } = fakeTransport({ case_help_workspace_v1: helpPageRow(many) });
    const first = await readCaseHelpPage(transport, STUDENT_CASE_ID);
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toEqual({ at: first.items[49]!.createdAt, id: first.items[49]!.id });
    await readCaseHelpPage(transport, STUDENT_CASE_ID, first.nextCursor);
    expect(calls[1]).toEqual({ name: "case_help_workspace_v1", args: { p_case_id: STUDENT_CASE_ID, p_before_at: first.nextCursor!.at, p_before_id: first.nextCursor!.id }, get: true });
  });

  it.each([
    ["чужое дело", { ...helpPageRow([helpRequestRow()]), caseId: "99999999-9999-4999-8999-999999999999" }],
    ["без ответа, но с ответом в тексте", helpPageRow([helpRequestRow({ status: "open" })])],
    ["не страница", { items: "нет" }],
  ])("плохая форма отвергается: %s", async (_name, payload) => {
    const { transport } = fakeTransport({ case_help_workspace_v1: payload });
    await expect(readCaseHelpPage(transport, STUDENT_CASE_ID)).rejects.toBeInstanceOf(PortalDecodeError);
  });
});

describe("решение по документу программы: student_application_document_notification_v1", () => {
  it("GET с идентификатором уведомления; разобрано строгим разборщиком веба", async () => {
    const { transport, calls } = fakeTransport({ student_application_document_notification_v1: documentNotificationRow() });
    const notification = await readDocumentNotification(transport, DOCUMENT_NOTIFICATION_ID, STUDENT_CASE_ID);
    expect(calls).toEqual([{ name: "student_application_document_notification_v1", args: { p_notification_id: DOCUMENT_NOTIFICATION_ID }, get: true }]);
    expect(notification.applicationId).toBe(APPLICATION_ID);
    expect(notification.submission.review?.decision).toBe("correction_required");
    expect(notification.submission.file.originalFilename).toBe("passport.pdf");
  });

  it.each([
    ["чужое уведомление", { ...documentNotificationRow(), notificationId: "99999999-9999-4999-8999-999999999990" }],
    ["чужое дело", { ...documentNotificationRow(), studentCaseId: "99999999-9999-4999-8999-999999999999" }],
    ["лишнее поле", { ...documentNotificationRow(), extra: 1 }],
    ["решение без замечания", documentNotificationRow({ review: { reviewId: "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1", decision: "rejected", reason: null, reviewedAt: "2026-11-21T10:30:00+00:00" } })],
  ])("плохая форма отвергается: %s", async (_name, payload) => {
    const { transport } = fakeTransport({ student_application_document_notification_v1: payload });
    await expect(readDocumentNotification(transport, DOCUMENT_NOTIFICATION_ID, STUDENT_CASE_ID)).rejects.toBeInstanceOf(PortalDecodeError);
  });
});

describe("решение по комплекту: application_package_notification_v1 и application_package_detail_v1", () => {
  it("уведомление: GET с идентификатором; решение и номер комплекта", async () => {
    const { transport, calls } = fakeTransport({ application_package_notification_v1: packageNotificationRow() });
    const notification = await readPackageNotification(transport, PACKAGE_NOTIFICATION_ID, STUDENT_CASE_ID);
    expect(calls).toEqual([{ name: "application_package_notification_v1", args: { p_notification_id: PACKAGE_NOTIFICATION_ID }, get: true }]);
    expect(notification.packageId).toBe(PACKAGE_ID);
    expect(notification.review.decision).toBe("correction_required");
  });

  it("уведомление: чужое дело отвергается", async () => {
    const { transport } = fakeTransport({ application_package_notification_v1: { ...packageNotificationRow(), studentCaseId: "99999999-9999-4999-8999-999999999999" } });
    await expect(readPackageNotification(transport, PACKAGE_NOTIFICATION_ID, STUDENT_CASE_ID)).rejects.toBeInstanceOf(PortalDecodeError);
  });

  it("состав: GET с делом, программой и комплектом; состав сверен с запросом", async () => {
    const { transport, calls } = fakeTransport({ application_package_detail_v1: packageDetailRow() });
    const detail = await readPackageDetail(transport, { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID }, PACKAGE_ID);
    expect(calls).toEqual([
      { name: "application_package_detail_v1", args: { p_student_case_id: STUDENT_CASE_ID, p_application_id: APPLICATION_ID, p_package_id: PACKAGE_ID }, get: true },
    ]);
    expect(detail.items.map((item) => item.definition.label)).toEqual(["Паспорт", "Диплом"]);
    expect(detail.currentWarnings).toEqual([]);
  });

  it("состав: чужой комплект и чужая программа отвергаются", async () => {
    const { transport } = fakeTransport({ application_package_detail_v1: packageDetailRow() });
    await expect(readPackageDetail(transport, { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID }, "f9f9f9f9-f9f9-49f9-89f9-f9f9f9f9f9f9")).rejects.toBeInstanceOf(PortalDecodeError);
    await expect(readPackageDetail(transport, { studentCaseId: STUDENT_CASE_ID, applicationId: "99999999-9999-4999-8999-999999999999" }, PACKAGE_ID)).rejects.toBeInstanceOf(PortalDecodeError);
  });
});

describe("история решений по комплекту: application_package_review_history_v1", () => {
  const target = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID };

  it("POST (курсор — объект jsonb): первая страница с курсором null и лимитом 20", async () => {
    const { transport, calls } = fakeTransport({ application_package_review_history_v1: packageHistoryRow([packageReviewRow()]) });
    const history = await readPackageReviewHistory(transport, target, PACKAGE_ID);
    expect(calls).toEqual([
      { name: "application_package_review_history_v1", args: { p_student_case_id: STUDENT_CASE_ID, p_application_id: APPLICATION_ID, p_package_id: PACKAGE_ID, p_cursor: null, p_limit: 20 }, get: false },
    ]);
    expect(history.reviews).toHaveLength(1);
    expect(history.nextCursor).toBeNull();
  });

  it("следующая страница: курсор уходит объектом как есть", async () => {
    const review = packageReviewRow();
    const cursor = { createdAt: review.reviewedAt, id: review.packageReviewId };
    const { transport, calls } = fakeTransport({ application_package_review_history_v1: packageHistoryRow([review], cursor) });
    const history = await readPackageReviewHistory(transport, target, PACKAGE_ID);
    expect(history.nextCursor).toEqual(cursor);
    await readPackageReviewHistory(transport, target, PACKAGE_ID, history.nextCursor);
    expect(calls[1]!.args).toMatchObject({ p_cursor: cursor });
  });

  it.each([
    ["чужой комплект", { ...packageHistoryRow([packageReviewRow()]), packageId: "f9f9f9f9-f9f9-49f9-89f9-f9f9f9f9f9f9" }],
    ["курсор не на последней записи", packageHistoryRow([packageReviewRow()], { createdAt: "2026-01-01T00:00:00+00:00", id: "f3f3f3f3-f3f3-43f3-83f3-f3f3f3f3f3f3" })],
    ["не по убыванию", packageHistoryRow([packageReviewRow({ reviewedAt: "2026-11-20T00:00:00+00:00" }), packageReviewRow({ id: "f3f3f3f3-f3f3-43f3-83f3-f3f3f3f3f3f3", reviewedAt: "2026-11-21T00:00:00+00:00" })])],
  ])("плохая форма отвергается: %s", async (_name, payload) => {
    const { transport } = fakeTransport({ application_package_review_history_v1: payload });
    await expect(readPackageReviewHistory(transport, target, PACKAGE_ID)).rejects.toBeInstanceOf(PortalDecodeError);
  });
});
