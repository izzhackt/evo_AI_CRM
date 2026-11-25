import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { InboxScreen } from "@/features/inbox/InboxScreen";
import { MSG_A, chatMessage, chatPage } from "@/test-fixtures/inbox";
import { helpPageRow, helpRequestRow } from "@/test-fixtures/program-decisions";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }), usePathname: () => "/messages" }));

const base = { student_portal_notifications_v2: [], portal_case_chat_page_v1: chatPage([chatMessage(MSG_A, "11", false, "Здравствуйте", "2026-09-07T08:00:00+00:00")]) };
const ANSWERED = helpRequestRow();
const OPEN = helpRequestRow({ id: "97979797-9797-4797-8797-979797979797", subject: "Когда оплачивать", body: "Сроки оплаты?", answer: null, answeredAt: null, status: "open", createdAt: "2026-11-20T05:00:00+00:00" });

describe("«Прежние вопросы куратору и ответы» под списком «Входящих»", () => {
  it("нет обращений: блока нет", async () => {
    const { transport } = fakeTransport({ ...base, case_help_workspace_v1: helpPageRow([]) });
    await renderPortal(<InboxScreen />, testApi(transport));
    expect(await screen.findByText("Здравствуйте")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("help-foot")).toBeNull());
  });

  it("все с ответами: свёрнут; открывается нажатием; вопрос, ответ EVO, статус и время по Бишкеку", async () => {
    const { transport, calls } = fakeTransport({ ...base, case_help_workspace_v1: helpPageRow([ANSWERED]) });
    await renderPortal(<InboxScreen />, testApi(transport));
    expect(await screen.findByText("Прежние вопросы куратору и ответы")).toBeTruthy();
    expect(calls.find((c) => c.name === "case_help_workspace_v1")).toMatchObject({ get: true });
    expect(screen.queryByTestId(`help-item-${ANSWERED.id}`)).toBeNull(); // свёрнут
    expect(screen.getByTestId("help-toggle").props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(screen.getByTestId("help-toggle"));
    const item = await screen.findByTestId(`help-item-${ANSWERED.id}`);
    expect(item).toHaveTextContent("Какие документы нужны для визы", { exact: false });
    expect(item).toHaveTextContent("Подскажите, нужен ли нотариальный перевод свидетельства о рождении?", { exact: false });
    expect(item).toHaveTextContent("Ответ EVO", { exact: false });
    expect(item).toHaveTextContent("Да, перевод нужен. Заверьте его у нотариуса и загрузите в «Документы».", { exact: false });
    expect(item).toHaveTextContent("Ответ получен · 18.11.2026, 11:00", { exact: false }); // 05:00 UTC = 11:00 Бишкек
    expect(screen.getByTestId("help-toggle").props.accessibilityState).toMatchObject({ expanded: true });
    await fireEvent.press(screen.getByTestId("help-toggle"));
    expect(screen.queryByTestId(`help-item-${ANSWERED.id}`)).toBeNull();
  });

  it("есть обращение без ответа: раскрыт сразу, у него «Ожидает ответа» и нет блока ответа", async () => {
    const { transport } = fakeTransport({ ...base, case_help_workspace_v1: helpPageRow([OPEN, ANSWERED]) });
    await renderPortal(<InboxScreen />, testApi(transport));
    const open = await screen.findByTestId(`help-item-${OPEN.id}`);
    expect(open).toHaveTextContent("Ожидает ответа · 20.11.2026, 11:00", { exact: false });
    expect(open).not.toHaveTextContent("Ответ EVO", { exact: false });
    expect(screen.getByTestId(`help-item-${ANSWERED.id}`)).toHaveTextContent("Ответ EVO", { exact: false });
  });

  it("кыргызский язык: заголовок и подписи", async () => {
    const { transport } = fakeTransport({ ...base, case_help_workspace_v1: helpPageRow([OPEN]) });
    await renderPortal(<InboxScreen />, testApi(transport), "ky");
    expect(await screen.findByText("Кураторго мурунку суроолор жана жооптор")).toBeTruthy();
    expect(screen.getByTestId(`help-item-${OPEN.id}`)).toHaveTextContent("Жооп күтүлүүдө", { exact: false });
  });

  it("чтение не удалось: «Помощь по делу» с причиной и повтором; повтор читает снова", async () => {
    let calls = 0;
    const { transport } = fakeTransport({ ...base, case_help_workspace_v1: () => (++calls === 1 ? failure(null, 503) : helpPageRow([ANSWERED])) });
    await renderPortal(<InboxScreen />, testApi(transport));
    expect(await screen.findByText("Помощь по делу")).toBeTruthy();
    expect(screen.getByText("Обращения пока недоступны. Потяните вниз, чтобы повторить чтение.")).toBeTruthy();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Прежние вопросы куратору и ответы")).toBeTruthy();
    expect(screen.queryByText("Помощь по делу")).toBeNull();
  });

  describe("страницы по 50", () => {
    const many = Array.from({ length: 51 }, (_, i) =>
      helpRequestRow({ id: `98989898-9898-4898-8898-${String(i).padStart(12, "0")}`, subject: `Вопрос ${i}`, createdAt: `2026-10-${String(30 - Math.floor(i / 3)).padStart(2, "0")}T0${i % 3}:00:00+00:00` }),
    );
    const older = helpRequestRow({ id: "98989898-9898-4898-8898-aaaaaaaaaaaa", subject: "Самый ранний вопрос", createdAt: "2026-01-05T05:00:00+00:00" });

    it("«Более ранние обращения» показывают следующую страницу, «Последние обращения» возвращают первую", async () => {
      const { transport, calls } = fakeTransport({ ...base, case_help_workspace_v1: (args?: Record<string, unknown>) => (args && "p_before_at" in args ? helpPageRow([older]) : helpPageRow(many)) });
      await renderPortal(<InboxScreen />, testApi(transport));
      await fireEvent.press(await screen.findByTestId("help-toggle"));
      expect(await screen.findByText("Вопрос 0")).toBeTruthy();
      expect(screen.queryByText("Вопрос 50")).toBeNull(); // 51-я запись только признак «есть ещё»
      await fireEvent.press(screen.getByTestId("help-older"));
      expect(await screen.findByText("Самый ранний вопрос")).toBeTruthy();
      expect(screen.queryByText("Вопрос 0")).toBeNull();
      const second = calls.filter((c) => c.name === "case_help_workspace_v1")[1]!;
      expect(second.args).toMatchObject({ p_before_id: "98989898-9898-4898-8898-000000000049" });
      expect(screen.queryByTestId("help-older")).toBeNull(); // дальше страниц нет
      await fireEvent.press(screen.getByTestId("help-latest"));
      expect(await screen.findByText("Вопрос 0")).toBeTruthy();
    });

    it("сбой следующей страницы: сообщение под списком, прежняя страница остаётся", async () => {
      const { transport } = fakeTransport({ ...base, case_help_workspace_v1: (args?: Record<string, unknown>) => (args && "p_before_at" in args ? failure("42501", 403) : helpPageRow(many)) });
      await renderPortal(<InboxScreen />, testApi(transport));
      await fireEvent.press(await screen.findByTestId("help-toggle"));
      await fireEvent.press(await screen.findByTestId("help-older"));
      expect(await screen.findByText("Не удалось прочитать обращения. Проверьте доступ и повторите.")).toBeTruthy();
      expect(screen.getByText("Вопрос 0")).toBeTruthy();
    });
  });
});
