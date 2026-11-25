import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import { InboxScreen } from "@/features/inbox/InboxScreen";
import { UpdatesScreen } from "@/features/inbox/UpdatesScreen";
import { notificationReadRequestId } from "@/domain/inbox-model";
import { MSG_A, chatMessage, chatPage } from "@/test-fixtures/inbox";
import { helpPageRow } from "@/test-fixtures/program-decisions";
import { NOTIFICATION_ID, NOTIFICATION_ROW } from "@/test-fixtures/rpc-rows";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }), usePathname: () => "/messages" }));
const AUTH = "11111111-1111-4111-8111-111111111111";
const navigate = router.navigate as jest.Mock;
beforeEach(() => navigate.mockClear());

const CHAT_ROW = { ...NOTIFICATION_ROW, notification_id: "66666666-6666-4666-8666-666666666668", category: "case", event_code: "case_chat_message", subject_label: "текст по-русски", created_at: "2026-09-07T09:00:00+00:00" };
const DOC_ROW = { ...NOTIFICATION_ROW, notification_id: "66666666-6666-4666-8666-66666666666a", category: "application.document.review", event_code: "application_document_review", subject_label: "Паспорт · Тестовый университет", detail: "Скан обрезан", created_at: "2026-09-07T06:00:00+00:00" };
const PACKAGE_ROW = { ...NOTIFICATION_ROW, notification_id: "66666666-6666-4666-8666-66666666666b", category: "application.package", event_code: "application_package_review", subject_label: "Комплект · Тестовый университет", detail: "Нужны исправления", created_at: "2026-09-07T05:00:00+00:00" };
const HELP_ROW = { ...NOTIFICATION_ROW, notification_id: "66666666-6666-4666-8666-666666666669", category: "case", event_code: "case_help_answer", subject_label: "Ответ куратора", detail: "Принесите справку", created_at: "2026-09-07T07:00:00+00:00" };

describe("Что нового", () => {
  it("одно название; непрочитанное нажатием отмечается детерминированным id и ведёт в документы", async () => {
    const { transport, calls } = fakeTransport({ student_portal_notifications_v2: [NOTIFICATION_ROW], mark_own_student_portal_notification_read_v2: { notification_id: NOTIFICATION_ID, is_read: true } });
    const api = testApi(transport, { userKey: AUTH });
    await renderPortal(<UpdatesScreen />, api);
    expect(await screen.findByText("Что нового")).toBeTruthy();
    expect(screen.queryByText("Уведомления")).toBeNull();
    await fireEvent.press(await screen.findByTestId(`update-${NOTIFICATION_ID}`));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/documents"));
    const write = calls.find((c) => c.name === "mark_own_student_portal_notification_read_v2")!;
    expect(write.get).toBe(false);
    expect(write.args).toEqual({
      p_notification_id: NOTIFICATION_ID,
      p_request_id: notificationReadRequestId({ authUserId: api.userKey, membershipId: api.membershipId, organizationId: api.organizationId, studentCaseId: api.studentCaseId }, NOTIFICATION_ID),
    });
  });

  it("сообщение команды ведёт в чат; прочитанное не пишется повторно", async () => {
    const read = { ...CHAT_ROW, read_at: "2026-09-07T10:00:00+00:00" };
    const { transport, calls } = fakeTransport({ student_portal_notifications_v2: [read] });
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    expect(await screen.findByText("Новое сообщение от команды EVO")).toBeTruthy(); // подпись на языке студента, не русский текст из базы
    await fireEvent.press(screen.getByTestId(`update-${read.notification_id}`));
    expect(navigate).toHaveBeenCalledWith("/messages/chat");
    expect(calls.some((c) => c.name === "mark_own_student_portal_notification_read_v2")).toBe(false);
  });

  it("ответ куратора ведёт на свой экран с подписью ссылки, строка не раскрывается на месте", async () => {
    const { transport } = fakeTransport({ student_portal_notifications_v2: [{ ...HELP_ROW, read_at: "2026-09-07T10:00:00+00:00" }], mark_own_student_portal_notification_read_v2: {} });
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    expect(await screen.findByText("Прочитать ответ куратора")).toBeTruthy();
    await fireEvent.press(await screen.findByTestId(`update-${HELP_ROW.notification_id}`));
    expect(navigate).toHaveBeenCalledWith(`/messages/reply/${HELP_ROW.notification_id}`);
    // текст уведомления виден целиком сразу, без обрезки и без раскрытия (веб NotificationsView)
    expect(screen.getByText("Принесите справку").props.numberOfLines).toBeUndefined();
  });

  it("решение по документу и по комплекту ведут на свои экраны; у каждого вида своя подпись ссылки", async () => {
    const { transport } = fakeTransport({ student_portal_notifications_v2: [DOC_ROW, PACKAGE_ROW, NOTIFICATION_ROW, CHAT_ROW], mark_own_student_portal_notification_read_v2: {} });
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    expect(await screen.findByText("Открыть решение по документу")).toBeTruthy();
    expect(screen.getByText("Открыть решение по документам")).toBeTruthy();
    expect(screen.getByText("Открыть документы")).toBeTruthy();
    expect(screen.getByText("Открыть переписку")).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`update-${DOC_ROW.notification_id}`));
    expect(navigate).toHaveBeenLastCalledWith(`/messages/document-decision/${DOC_ROW.notification_id}`);
    await fireEvent.press(screen.getByTestId(`update-${PACKAGE_ROW.notification_id}`));
    expect(navigate).toHaveBeenLastCalledWith(`/messages/package-decision/${PACKAGE_ROW.notification_id}`);
  });

  it("кнопка «Отметить прочитанным» у каждого непрочитанного: пишет одну запись и никуда не ведёт", async () => {
    const readRow = { ...CHAT_ROW, read_at: "2026-09-07T10:00:00+00:00" };
    const { transport, calls } = fakeTransport({ student_portal_notifications_v2: [NOTIFICATION_ROW, readRow], mark_own_student_portal_notification_read_v2: {} });
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    expect(await screen.findByTestId(`update-read-${NOTIFICATION_ID}`)).toBeTruthy();
    expect(screen.queryByTestId(`update-read-${readRow.notification_id}`)).toBeNull(); // у прочитанного кнопки нет
    await fireEvent.press(screen.getByTestId(`update-read-${NOTIFICATION_ID}`));
    await waitFor(() => expect(calls.filter((c) => c.name === "mark_own_student_portal_notification_read_v2")).toHaveLength(1));
    expect(calls.find((c) => c.name === "mark_own_student_portal_notification_read_v2")!.args!.p_notification_id).toBe(NOTIFICATION_ID);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("нажатие на строку не ждёт записи: переход идёт сразу, а сбой записи виден на ленте словами веба", async () => {
    const { transport } = fakeTransport({ student_portal_notifications_v2: [NOTIFICATION_ROW], mark_own_student_portal_notification_read_v2: failure("42501", 403) });
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(await screen.findByTestId(`update-${NOTIFICATION_ID}`));
    expect(navigate).toHaveBeenCalledWith("/documents");
    expect(await screen.findByText("Не удалось подтвердить отметку о прочтении. Повторите попытку.")).toBeTruthy();
  });

  it("«Отметить все»: по записи на каждое непрочитанное", async () => {
    const { transport, calls } = fakeTransport({ student_portal_notifications_v2: [NOTIFICATION_ROW, CHAT_ROW], mark_own_student_portal_notification_read_v2: {} });
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(await screen.findByTestId("updates-mark-all"));
    await waitFor(() => expect(calls.filter((c) => c.name === "mark_own_student_portal_notification_read_v2")).toHaveLength(2));
    const ids = calls.filter((c) => c.name === "mark_own_student_portal_notification_read_v2").map((c) => c.args!.p_notification_id);
    expect(new Set(ids)).toEqual(new Set([NOTIFICATION_ID, CHAT_ROW.notification_id]));
  });

  it("кнопка у строки: сбой записи — «markReadError»; «Отметить все» — своё сообщение «markAllReadError»", async () => {
    const { transport } = fakeTransport({ student_portal_notifications_v2: [NOTIFICATION_ROW, CHAT_ROW], mark_own_student_portal_notification_read_v2: failure("42501", 403) });
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(await screen.findByTestId(`update-read-${NOTIFICATION_ID}`));
    expect(await screen.findByText("Не удалось подтвердить отметку о прочтении. Повторите попытку.")).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("updates-mark-all"));
    expect(await screen.findByText(/Не удалось подтвердить отметку для всех уведомлений/)).toBeTruthy();
    expect(screen.queryByText("Не удалось подтвердить отметку о прочтении. Повторите попытку.")).toBeNull();
  });

  it("лента не загрузилась: слова веба «updatesUnavailable» с повтором; повтор читает снова", async () => {
    let reads = 0;
    const { transport } = fakeTransport({ student_portal_notifications_v2: () => (++reads === 1 ? failure(null, 503) : [NOTIFICATION_ROW]) });
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    expect(await screen.findByText("Не удалось загрузить новости. Обновите страницу.")).toBeTruthy();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByTestId(`update-${NOTIFICATION_ID}`)).toBeTruthy();
  });

  it("пусто: пустое состояние", async () => {
    const { transport } = fakeTransport({ student_portal_notifications_v2: [] });
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    expect(await screen.findByText("Новых уведомлений нет")).toBeTruthy();
  });
});

describe("Входящие: список", () => {
  it("две беседы: счётчик непрочитанного у «Что нового», последнее сообщение у чата", async () => {
    const { transport } = fakeTransport({
      student_portal_notifications_v2: [NOTIFICATION_ROW, CHAT_ROW],
      portal_case_chat_page_v1: chatPage([chatMessage(MSG_A, "11", false, "Принесите оригинал", "2020-01-01T08:00:00+00:00")]),
      case_help_workspace_v1: helpPageRow([]),
    });
    await renderPortal(<InboxScreen />, testApi(transport, { userKey: AUTH }));
    expect(await screen.findByText("Принесите оригинал")).toBeTruthy();
    // время последнего сообщения стоит за любой день, не только за сегодняшний (веб: chatTime), 08:00 UTC = 14:00 в Бишкеке
    expect(screen.getByText("14:00")).toBeTruthy();
    // список назван для читалки (веб: InboxList aria-label = listAria)
    expect(screen.getByLabelText("Переписка и новости")).toBeTruthy();
    // без прежних обращений блока «Прежние вопросы куратору» нет (веб: CaseHelpPanel возвращает null)
    expect(screen.queryByTestId("help-foot")).toBeNull();
    expect(screen.getByTestId("inbox-updates-badge")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("inbox-chat"));
    expect(navigate).toHaveBeenCalledWith("/messages/chat");
    await fireEvent.press(screen.getByTestId("inbox-updates"));
    expect(navigate).toHaveBeenCalledWith("/messages/updates");
  });
});
