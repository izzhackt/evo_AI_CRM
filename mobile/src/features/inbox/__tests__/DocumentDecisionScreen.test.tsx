import { fireEvent, screen } from "@testing-library/react-native";
import { router } from "expo-router";

import { DocumentDecisionScreen } from "@/features/inbox/DocumentDecisionScreen";
import { preparationHref } from "@/features/preparations/routes";
import { APPLICATION_ID, DOCUMENT_NOTIFICATION_ID, REVIEW_1, documentNotificationRow, reviewRow } from "@/test-fixtures/program-decisions";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }), usePathname: () => "/messages/document-decision/x" }));
const navigate = router.navigate as jest.Mock;
const AUTH = "11111111-1111-4111-8111-111111111111";
beforeEach(() => navigate.mockClear());

const render = (transport: Parameters<typeof testApi>[0], lang: "ru" | "ky" = "ru", id = DOCUMENT_NOTIFICATION_ID) =>
  renderPortal(<DocumentDecisionScreen notificationId={id} />, testApi(transport, { userKey: AUTH }), lang);

describe("Решение по документу программы (веб: /portal/document-notifications/[id])", () => {
  it("исправить: слово решения, замечание, файл с версией, времена по Бишкеку и пояснение «решение из уведомления»", async () => {
    const { transport, calls } = fakeTransport({ student_application_document_notification_v1: documentNotificationRow() });
    await render(transport);
    expect(await screen.findByText("Отправленный документ")).toBeTruthy();
    expect(screen.getByTestId("detail-title")).toHaveTextContent("Открыть решение по документу");
    expect(screen.getByTestId("decision-snapshot")).toHaveTextContent("Это решение из уведомления.", { exact: false });
    expect(screen.getByText("passport.pdf")).toBeTruthy();
    expect(screen.getByText("Версия 2")).toBeTruthy();
    expect(screen.getByText("Отправлен: 20.11.2026, 14:00 (Бишкек)")).toBeTruthy(); // 08:00 UTC
    expect(screen.getByTestId("review-word")).toHaveTextContent("Нужно исправить");
    expect(screen.getByTestId("review-reason")).toHaveTextContent("Скан обрезан: нужны все четыре края страницы.");
    expect(screen.getByText("Проверен: 21.11.2026, 16:30 (Бишкек)")).toBeTruthy(); // 10:30 UTC
    expect(calls).toEqual([{ name: "student_application_document_notification_v1", args: { p_notification_id: DOCUMENT_NOTIFICATION_ID }, get: true }]);
  });

  it.each([
    ["approved", null, "Принят для этой программы"],
    ["rejected", "Документ не подходит для этой программы.", "Не принят"],
  ] as const)("решение «%s»: своё слово; замечание только если оно есть", async (decision, reason, word) => {
    const { transport } = fakeTransport({ student_application_document_notification_v1: documentNotificationRow({ review: reviewRow(REVIEW_1, decision, reason) }) });
    await render(transport);
    expect(await screen.findByTestId("review-word")).toHaveTextContent(word);
    if (reason) expect(screen.getByTestId("review-reason")).toHaveTextContent(reason);
    else expect(screen.queryByTestId("review-reason")).toBeNull();
  });

  it("файл недоступен: причина понятными словами из общего словаря", async () => {
    const { transport } = fakeTransport({
      student_application_document_notification_v1: documentNotificationRow({ file: { technicalAvailability: "unavailable", unavailableReasons: ["malware_infected"] } }),
    });
    await render(transport);
    expect(await screen.findByText("Файл не прошёл проверку безопасности. Выберите другой файл.")).toBeTruthy();
  });

  it("«Открыть программу» ведёт на экран требований программы через общий помощник маршрута", async () => {
    const { transport } = fakeTransport({ student_application_document_notification_v1: documentNotificationRow() });
    await render(transport);
    await fireEvent.press(await screen.findByTestId("decision-open-program"));
    expect(navigate).toHaveBeenCalledWith(preparationHref(APPLICATION_ID));
    expect(navigate).toHaveBeenCalledWith({ pathname: "/preparations/[applicationId]", params: { applicationId: APPLICATION_ID } });
  });

  it("сбой чтения: слова веба «readUnavailable» и кнопка «Обновить документы»; повтор читает снова", async () => {
    let reads = 0;
    const { transport } = fakeTransport({ student_application_document_notification_v1: () => (++reads === 1 ? failure("42501", 403) : documentNotificationRow()) });
    await render(transport);
    expect(await screen.findByText("Не удалось открыть документ. Обновите страницу или вернитесь к уведомлениям.")).toBeTruthy();
    await fireEvent.press(screen.getByText("Обновить документы"));
    expect(await screen.findByText("passport.pdf")).toBeTruthy();
  });

  it("чужое дело в ответе: показывается как недоступное, а не содержимое", async () => {
    const { transport } = fakeTransport({ student_application_document_notification_v1: { ...documentNotificationRow(), studentCaseId: "99999999-9999-4999-8999-999999999999" } });
    await render(transport);
    expect(await screen.findByTestId("document-decision-error")).toBeTruthy();
    expect(screen.queryByText("passport.pdf")).toBeNull();
  });

  it("негодный идентификатор: на сервер не ходит", async () => {
    const { transport, calls } = fakeTransport({ student_application_document_notification_v1: documentNotificationRow() });
    await render(transport, "ru", "не-uuid");
    expect(await screen.findByTestId("document-decision-error")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("кыргызский язык: слова решения и заголовки из общего словаря", async () => {
    const { transport } = fakeTransport({ student_application_document_notification_v1: documentNotificationRow() });
    await render(transport, "ky");
    expect(await screen.findByText("Жөнөтүлгөн документ")).toBeTruthy();
    expect(screen.getByTestId("review-word")).toHaveTextContent("Оңдоо керек");
  });
});
