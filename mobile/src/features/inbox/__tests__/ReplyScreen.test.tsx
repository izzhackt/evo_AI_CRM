import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import { ReplyScreen } from "@/features/inbox/ReplyScreen";
import { notificationReadRequestId } from "@/domain/inbox-model";
import { HELP_NOTIFICATION_ID, helpReplyRow } from "@/test-fixtures/program-decisions";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useRouter: () => ({ back: mockBack, canGoBack: () => true, navigate: jest.fn() }), usePathname: () => "/messages/reply/x" }));
const navigate = router.navigate as jest.Mock;
const AUTH = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  navigate.mockClear();
  mockBack.mockClear();
});

describe("Ответ куратора (веб: /portal/notifications/[id])", () => {
  it("тема, «Ваш вопрос», «Ответ EVO» с временем по Бишкеку; запрос по идентификатору уведомления", async () => {
    const { transport, calls } = fakeTransport({ student_portal_help_reply_v1: helpReplyRow() });
    await renderPortal(<ReplyScreen notificationId={HELP_NOTIFICATION_ID} />, testApi(transport, { userKey: AUTH }));
    expect(await screen.findByText("Какие документы нужны для визы")).toBeTruthy();
    expect(screen.getByTestId("detail-title")).toHaveTextContent("Ответ куратора");
    expect(screen.getByText("Ваш вопрос")).toBeTruthy();
    expect(screen.getByTestId("reply-question")).toHaveTextContent("Подскажите, нужен ли нотариальный перевод свидетельства о рождении?");
    expect(screen.getByText("Ответ EVO")).toBeTruthy();
    expect(screen.getByTestId("reply-answer")).toHaveTextContent("Да, перевод нужен. Заверьте его у нотариуса и загрузите в «Документы».");
    expect(screen.getByText("19.11.2026, 13:15")).toBeTruthy(); // 07:15 UTC = 13:15 в Бишкеке
    expect(calls).toEqual([{ name: "student_portal_help_reply_v1", args: { p_notification_id: HELP_NOTIFICATION_ID }, get: true }]);
  });

  it("непрочитанное: кнопка пишет детерминированный запрос «прочитано», затем кнопки нет и ответ перечитан", async () => {
    let reads = 0;
    const { transport, calls } = fakeTransport({
      student_portal_help_reply_v1: () => (++reads === 1 ? helpReplyRow() : helpReplyRow({ readAt: "2026-11-20T10:00:00+00:00" })),
      mark_own_student_portal_notification_read_v2: {},
    });
    const api = testApi(transport, { userKey: AUTH });
    await renderPortal(<ReplyScreen notificationId={HELP_NOTIFICATION_ID} />, api);
    await fireEvent.press(await screen.findByTestId("reply-mark-read"));
    await waitFor(() => expect(screen.queryByTestId("reply-mark-read")).toBeNull());
    const write = calls.find((c) => c.name === "mark_own_student_portal_notification_read_v2")!;
    expect(write.get).toBe(false);
    expect(write.args).toEqual({
      p_notification_id: HELP_NOTIFICATION_ID,
      p_request_id: notificationReadRequestId({ authUserId: api.userKey, membershipId: api.membershipId, organizationId: api.organizationId, studentCaseId: api.studentCaseId }, HELP_NOTIFICATION_ID),
    });
    await waitFor(() => expect(calls.filter((c) => c.name === "student_portal_help_reply_v1")).toHaveLength(2));
  });

  it("после успешной записи кнопки нет сразу, не дожидаясь перечитывания (оно может ещё отдать «не прочитано»)", async () => {
    const { transport, calls } = fakeTransport({ student_portal_help_reply_v1: helpReplyRow(), mark_own_student_portal_notification_read_v2: {} });
    await renderPortal(<ReplyScreen notificationId={HELP_NOTIFICATION_ID} />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(await screen.findByTestId("reply-mark-read"));
    await waitFor(() => expect(calls.filter((c) => c.name === "student_portal_help_reply_v1")).toHaveLength(2));
    expect(screen.queryByTestId("reply-mark-read")).toBeNull();
  });

  it("сбой записи: слова веба «markReadError», кнопка остаётся, повтор возможен", async () => {
    const { transport } = fakeTransport({ student_portal_help_reply_v1: helpReplyRow(), mark_own_student_portal_notification_read_v2: failure("42501", 403) });
    await renderPortal(<ReplyScreen notificationId={HELP_NOTIFICATION_ID} />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(await screen.findByTestId("reply-mark-read"));
    expect(await screen.findByText("Не удалось подтвердить отметку о прочтении. Повторите попытку.")).toBeTruthy();
    expect(screen.getByTestId("reply-mark-read")).toBeTruthy();
  });

  it("уже прочитано: кнопки нет", async () => {
    const { transport } = fakeTransport({ student_portal_help_reply_v1: helpReplyRow({ readAt: "2026-11-20T10:00:00+00:00" }) });
    await renderPortal(<ReplyScreen notificationId={HELP_NOTIFICATION_ID} />, testApi(transport, { userKey: AUTH }));
    expect(await screen.findByText("Какие документы нужны для визы")).toBeTruthy();
    expect(screen.queryByTestId("reply-mark-read")).toBeNull();
  });

  it("ссылка «Что нового» и стрелка назад", async () => {
    const { transport } = fakeTransport({ student_portal_help_reply_v1: helpReplyRow() });
    await renderPortal(<ReplyScreen notificationId={HELP_NOTIFICATION_ID} />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(await screen.findByTestId("reply-all"));
    expect(navigate).toHaveBeenCalledWith("/messages/updates");
    await fireEvent.press(screen.getByTestId("detail-back"));
    expect(mockBack).toHaveBeenCalled();
  });

  it("сбой чтения: плашка с повтором, текст сервера не показывается; повтор читает снова", async () => {
    let reads = 0;
    const { transport } = fakeTransport({ student_portal_help_reply_v1: () => (++reads === 1 ? failure(null, 503) : helpReplyRow()) });
    await renderPortal(<ReplyScreen notificationId={HELP_NOTIFICATION_ID} />, testApi(transport, { userKey: AUTH }));
    expect(await screen.findByTestId("reply-error")).toBeTruthy();
    expect(screen.getByText("Сервис временно недоступен. Повторите позже.")).toBeTruthy();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Какие документы нужны для визы")).toBeTruthy();
  });

  it("негодный идентификатор в адресе: на сервер не ходит, плашка", async () => {
    const { transport, calls } = fakeTransport({ student_portal_help_reply_v1: helpReplyRow() });
    await renderPortal(<ReplyScreen notificationId="не-uuid" />, testApi(transport, { userKey: AUTH }));
    expect(await screen.findByTestId("reply-error")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("кыргызский язык: заголовок и подписи из общего словаря", async () => {
    const { transport } = fakeTransport({ student_portal_help_reply_v1: helpReplyRow() });
    await renderPortal(<ReplyScreen notificationId={HELP_NOTIFICATION_ID} />, testApi(transport, { userKey: AUTH }), "ky");
    expect(await screen.findByText("Сиздин суроо")).toBeTruthy();
    expect(screen.getByText("EVO жообу")).toBeTruthy();
    expect(screen.getByTestId("detail-title")).toHaveTextContent("Куратордун жообу");
    expect(screen.getByText("Окулду деп белгилөө")).toBeTruthy();
  });
});
