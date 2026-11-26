import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { AccessibilityInfo } from "react-native";

import { InboxScreen } from "@/features/inbox/InboxScreen";
import { applyReadOutcome } from "@/features/inbox/read-failures";
import { UpdatesScreen } from "@/features/inbox/UpdatesScreen";
import { useScreenVisible } from "@/features/inbox/visibility";
import { notificationReadRequestId } from "@/domain/inbox-model";
import { MSG_A, chatMessage, chatPage } from "@/test-fixtures/inbox";
import { helpPageRow } from "@/test-fixtures/program-decisions";
import { NOTIFICATION_ID, NOTIFICATION_ROW } from "@/test-fixtures/rpc-rows";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

// Стрелка «назад» (`useInboxBack`) читает состояние настоящего навигатора, которого в этом тесте нет: она проверена на настоящем
// expo-router в `src/__tests__/app-layout-inbox-back.test.tsx` (подмена состояния навигации прежде и скрывала ошибку подписи).
// Здесь нужна только кнопка, поэтому хук заменён.
jest.mock("@/features/inbox/useInboxBack", () => ({ useInboxBack: () => ({ label: "Назад", onPress: () => undefined }) }));
jest.mock("expo-router", () => ({
  router: { navigate: jest.fn() },
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }),
  usePathname: () => "/messages",
}));
const AUTH = "11111111-1111-4111-8111-111111111111";
jest.mock("@/features/inbox/visibility", () => ({ useScreenVisible: jest.fn(() => true) }));
const navigate = router.navigate as jest.Mock;
const visible = useScreenVisible as jest.Mock;
const announce = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;
const READ_FAILED = "Не удалось подтвердить отметку о прочтении. Повторите попытку.";
beforeEach(() => {
  navigate.mockClear();
  announce.mockClear();
  visible.mockReturnValue(true);
});
const WRITE = "mark_own_student_portal_notification_read_v2";

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

  it("строка читается целиком: подпись для читалки включает пояснение (причину, замечание) и срок, а не только название и время", async () => {
    const row = { ...DOC_ROW, due_at: "2026-12-01T12:00:00+00:00" };
    const { transport } = fakeTransport({ student_portal_notifications_v2: [row] });
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    const label = (await screen.findByTestId(`update-${row.notification_id}`)).props.accessibilityLabel as string;
    expect(label).toContain("Скан обрезан"); // пояснение видно на экране, значит и читается
    expect(label).toContain("Срок: 01.12.2026");
    expect(label).toContain("07.09.2026"); // время уведомления, как и раньше
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
    expect(announce).not.toHaveBeenCalled(); // удача читалке ничего не говорит: сбоев нет
  });

  it("нажатие на строку не ждёт записи: переход идёт сразу, сбой записи стоит ПОД этой строкой словами веба, с «Повторить», и читается вслух", async () => {
    const { transport } = fakeTransport({ student_portal_notifications_v2: [NOTIFICATION_ROW, CHAT_ROW], [WRITE]: failure("42501", 403) });
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(await screen.findByTestId(`update-${NOTIFICATION_ID}`));
    expect(navigate).toHaveBeenCalledWith("/documents");
    const plaque = await screen.findByTestId(`update-read-error-${NOTIFICATION_ID}`);
    expect(plaque).toHaveTextContent(READ_FAILED, { exact: false });
    // плашка внутри карточки нажатой строки, а не вверху ленты и не у соседней
    expect(within(screen.getByTestId(`update-card-${NOTIFICATION_ID}`)).getByTestId(`update-read-error-${NOTIFICATION_ID}`)).toBeTruthy();
    expect(screen.queryByTestId(`update-read-error-${CHAT_ROW.notification_id}`)).toBeNull();
    expect(screen.queryByTestId("updates-read-error")).toBeNull();
    expect(within(plaque).getByText("Повторить")).toBeTruthy();
    expect(announce).toHaveBeenCalledWith(READ_FAILED);
  });

  it("«Повторить» у строки шлёт ТОТ ЖЕ запрос (тот же id) и снимает плашку после удачи", async () => {
    let writes = 0;
    const { transport, calls } = fakeTransport({ student_portal_notifications_v2: [NOTIFICATION_ROW], [WRITE]: () => (++writes === 1 ? failure("42501", 403) : {}) }); // отказ не повторяется сам (в отличие от обрыва связи)
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(await screen.findByTestId(`update-read-${NOTIFICATION_ID}`));
    await fireEvent.press(await screen.findByText("Повторить"));
    await waitFor(() => expect(screen.queryByTestId(`update-read-error-${NOTIFICATION_ID}`)).toBeNull());
    const sent = calls.filter((c) => c.name === WRITE);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.args).toEqual(sent[0]!.args); // повтор не создаёт новый запрос
  });

  it("«Повторить» у строки не удалось снова: плашка остаётся под строкой, а верхней «для всех» нет (область «одна», не «все»)", async () => {
    const { transport, calls } = fakeTransport({ student_portal_notifications_v2: [NOTIFICATION_ROW, CHAT_ROW], [WRITE]: failure("42501", 403) });
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(await screen.findByTestId(`update-read-${NOTIFICATION_ID}`));
    await fireEvent.press(await screen.findByText("Повторить"));
    await waitFor(() => expect(calls.filter((c) => c.name === WRITE)).toHaveLength(2));
    expect(await screen.findByTestId(`update-read-error-${NOTIFICATION_ID}`)).toBeTruthy();
    expect(screen.queryByTestId("updates-read-error")).toBeNull();
  });

  it("прежний сбой не рисуется под строкой, которая уже прочитана (отмечена на сайте или на другом устройстве)", async () => {
    const readRow = { ...NOTIFICATION_ROW, read_at: "2026-09-07T10:00:00+00:00" };
    const { transport } = fakeTransport({ student_portal_notifications_v2: [readRow, CHAT_ROW] });
    const { client } = await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    await act(async () => applyReadOutcome(client, AUTH, { scope: "one", ok: false, succeeded: [], failed: [NOTIFICATION_ID, CHAT_ROW.notification_id] }));
    expect(await screen.findByTestId(`update-read-error-${CHAT_ROW.notification_id}`)).toBeTruthy(); // непрочитанная - плашка есть
    expect(screen.queryByTestId(`update-read-error-${NOTIFICATION_ID}`)).toBeNull(); // прочитанная - нет
  });

  it("лента ушла с экрана (другая вкладка): сбой не читается вслух поверх чужого экрана, но плашка ждёт под строкой", async () => {
    visible.mockReturnValue(false);
    const { transport } = fakeTransport({ student_portal_notifications_v2: [NOTIFICATION_ROW], [WRITE]: failure("42501", 403) });
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(await screen.findByTestId(`update-${NOTIFICATION_ID}`));
    expect(await screen.findByTestId(`update-read-error-${NOTIFICATION_ID}`)).toBeTruthy();
    expect(announce).not.toHaveBeenCalled();
  });

  it("«Отметить все»: по записи на каждое непрочитанное", async () => {
    const { transport, calls } = fakeTransport({ student_portal_notifications_v2: [NOTIFICATION_ROW, CHAT_ROW], mark_own_student_portal_notification_read_v2: {} });
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(await screen.findByTestId("updates-mark-all"));
    await waitFor(() => expect(calls.filter((c) => c.name === "mark_own_student_portal_notification_read_v2")).toHaveLength(2));
    const ids = calls.filter((c) => c.name === "mark_own_student_portal_notification_read_v2").map((c) => c.args!.p_notification_id);
    expect(new Set(ids)).toEqual(new Set([NOTIFICATION_ID, CHAT_ROW.notification_id]));
  });

  it("кнопка у строки: сбой стоит под строкой («markReadError»); «Отметить все» - своя плашка вверху («markAllReadError»); обе рядом", async () => {
    const { transport } = fakeTransport({ student_portal_notifications_v2: [NOTIFICATION_ROW, CHAT_ROW], [WRITE]: failure("42501", 403) });
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(await screen.findByTestId(`update-read-${NOTIFICATION_ID}`));
    expect(await screen.findByTestId(`update-read-error-${NOTIFICATION_ID}`)).toHaveTextContent(READ_FAILED, { exact: false });
    expect(screen.queryByTestId("updates-read-error")).toBeNull(); // вверху для одной строки ничего нет
    expect(navigate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("updates-mark-all"));
    expect(await screen.findByTestId("updates-read-error")).toHaveTextContent("Не удалось подтвердить отметку для всех уведомлений", { exact: false });
    expect(screen.getByTestId(`update-read-error-${NOTIFICATION_ID}`)).toBeTruthy(); // сбой строки остаётся, пока строка не отмечена
    expect(announce).toHaveBeenCalledWith(expect.stringContaining("для всех уведомлений"));
  });

  it("«Отметить все» при ровно одном непрочитанном: сбой словами «для всех» (веб), а не «о прочтении», и вверху, а не под строкой", async () => {
    const { transport } = fakeTransport({ student_portal_notifications_v2: [NOTIFICATION_ROW, { ...CHAT_ROW, read_at: "2026-09-07T10:00:00+00:00" }], [WRITE]: failure("42501", 403) });
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(await screen.findByTestId("updates-mark-all"));
    expect(await screen.findByTestId("updates-read-error")).toHaveTextContent("Не удалось подтвердить отметку для всех уведомлений", { exact: false });
    expect(screen.queryByTestId(`update-read-error-${NOTIFICATION_ID}`)).toBeNull();
    expect(screen.queryByText(READ_FAILED)).toBeNull();
  });

  it("плашка «Отметить все» с «Повторить»: повтор отмечает оставшиеся и снимает плашку", async () => {
    let writes = 0;
    const { transport, calls } = fakeTransport({ student_portal_notifications_v2: [NOTIFICATION_ROW, CHAT_ROW], [WRITE]: () => (++writes === 1 ? failure("42501", 403) : {}) });
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(await screen.findByTestId("updates-mark-all"));
    const plaque = await screen.findByTestId("updates-read-error");
    await fireEvent.press(within(plaque).getByText("Повторить"));
    await waitFor(() => expect(screen.queryByTestId("updates-read-error")).toBeNull());
    expect(calls.filter((c) => c.name === WRITE).length).toBeGreaterThanOrEqual(3); // первая неудачная и по записи на каждое непрочитанное
  });

  it("плашка «Отметить все» уходит, когда непрочитанных не осталось (другая отметка дошла)", async () => {
    const readIds = new Set<string>();
    let chatWrites = true;
    const rows = () => [NOTIFICATION_ROW, CHAT_ROW].map((row) => (readIds.has(row.notification_id) ? { ...row, read_at: "2026-09-07T10:00:00+00:00" } : row));
    const { transport } = fakeTransport({
      student_portal_notifications_v2: rows,
      [WRITE]: (args?: Record<string, unknown>) => {
        const id = String(args?.p_notification_id);
        if (id === CHAT_ROW.notification_id && !chatWrites) return failure(null, 503);
        readIds.add(id);
        return {};
      },
    });
    chatWrites = false; // «Отметить все»: первая запись проходит, вторая нет
    await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    await fireEvent.press(await screen.findByTestId("updates-mark-all"));
    expect(await screen.findByTestId("updates-read-error")).toBeTruthy();
    expect(readIds).toEqual(new Set([NOTIFICATION_ID]));
    chatWrites = true; // связь вернулась: оставшееся отмечено кнопкой у строки
    await fireEvent.press(await screen.findByTestId(`update-read-${CHAT_ROW.notification_id}`));
    await waitFor(() => expect(screen.queryByTestId("updates-read-error")).toBeNull());
    // плашка уходит сразу (записанный номер снят), а лента перечитывается следом: кнопки «Отметить все» нет, когда непрочитанного нет
    await waitFor(() => expect(screen.queryByTestId("updates-mark-all")).toBeNull());
  });

  it("плашка «Отметить все» стоит, пока не отмечены те, что не отметились; прочитали их на сайте или другом устройстве - уходит, новое непрочитанное её не воскрешает", async () => {
    const readIds = new Set<string>();
    let failing = true;
    let withNew = false;
    const NEWEST = { ...CHAT_ROW, notification_id: "66666666-6666-4666-8666-66666666666c", created_at: "2026-09-07T11:00:00+00:00" };
    const rows = () => [NOTIFICATION_ROW, CHAT_ROW, ...(withNew ? [NEWEST] : [])].map((row) => (readIds.has(row.notification_id) ? { ...row, read_at: "2026-09-07T10:00:00+00:00" } : row));
    const { transport } = fakeTransport({
      student_portal_notifications_v2: rows,
      [WRITE]: (args?: Record<string, unknown>) => {
        if (failing) return failure("42501", 403);
        readIds.add(String(args?.p_notification_id));
        return {};
      },
    });
    const { client } = await renderPortal(<UpdatesScreen />, testApi(transport, { userKey: AUTH }));
    const refetch = () =>
      act(async () => {
        await client.refetchQueries({ queryKey: ["portal", AUTH, "notifications"] });
      });
    await fireEvent.press(await screen.findByTestId("updates-mark-all"));
    expect(await screen.findByTestId("updates-read-error")).toBeTruthy();
    failing = false;
    await fireEvent.press(screen.getByTestId(`update-read-${NOTIFICATION_ID}`)); // отметили поодиночке в приложении: вторая ещё не отмечена
    await waitFor(() => expect(screen.queryByTestId(`update-read-${NOTIFICATION_ID}`)).toBeNull());
    expect(screen.getByTestId("updates-read-error")).toBeTruthy();
    readIds.add(CHAT_ROW.notification_id); // вторую прочитали на сайте (приложение об этом не писало)
    await refetch();
    await waitFor(() => expect(screen.queryByTestId("updates-mark-all")).toBeNull());
    expect(screen.queryByTestId("updates-read-error")).toBeNull();
    withNew = true; // позже пришло новое непрочитанное: прежний сбой к нему не относится
    await refetch();
    expect(await screen.findByTestId("updates-mark-all")).toBeTruthy();
    expect(screen.queryByTestId("updates-read-error")).toBeNull();
  });

  it("вышли и вошли заново (новый кабинет, новый кэш): сбой «Отметить все» прошлого входа не показывается", async () => {
    const { transport } = fakeTransport({ student_portal_notifications_v2: [NOTIFICATION_ROW, CHAT_ROW], [WRITE]: failure("42501", 403) });
    const api = testApi(transport, { userKey: AUTH });
    const before = await renderPortal(<UpdatesScreen />, api);
    await fireEvent.press(await screen.findByTestId("updates-mark-all"));
    expect(await screen.findByTestId("updates-read-error")).toBeTruthy();
    await before.unmount();
    await renderPortal(<UpdatesScreen />, api); // тот же студент и те же непрочитанные, но кабинет открыт заново
    expect(await screen.findByTestId("updates-mark-all")).toBeTruthy();
    expect(screen.queryByTestId("updates-read-error")).toBeNull();
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
    // счётчик читается другим запросом (уведомления), чем последнее сообщение (чат): ждём его отдельно
    expect(await screen.findByTestId("inbox-updates-badge")).toBeTruthy();
    expect(await screen.findByText("2")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("inbox-chat"));
    expect(navigate).toHaveBeenCalledWith("/messages/chat");
    await fireEvent.press(screen.getByTestId("inbox-updates"));
    expect(navigate).toHaveBeenCalledWith("/messages/updates");
  });
});
