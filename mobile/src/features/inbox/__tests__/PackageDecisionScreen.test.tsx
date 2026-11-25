import { fireEvent, screen, within } from "@testing-library/react-native";
import { router } from "expo-router";

import { PackageDecisionScreen } from "@/features/inbox/PackageDecisionScreen";
import { preparationHref } from "@/features/preparations/routes";
import {
  APPLICATION_ID,
  ITEM_1,
  PACKAGE_NOTIFICATION_ID,
  PACKAGE_REVIEW_2,
  REVIEW_1,
  REVIEW_2,
  REVIEW_3,
  SUBMISSION_1,
  packageDetailRow,
  packageItemRow,
  packageNotificationRow,
  packageHistoryRow,
  packageReviewRow,
  reviewRow,
  submissionRow,
} from "@/test-fixtures/program-decisions";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }), usePathname: () => "/messages/package-decision/x" }));
const navigate = router.navigate as jest.Mock;
const AUTH = "11111111-1111-4111-8111-111111111111";
beforeEach(() => navigate.mockClear());

const render = (transport: Parameters<typeof testApi>[0], lang: "ru" | "ky" = "ru", id = PACKAGE_NOTIFICATION_ID) =>
  renderPortal(<PackageDecisionScreen notificationId={id} />, testApi(transport, { userKey: AUTH }), lang);

const approvedReview = (id = PACKAGE_REVIEW_2) =>
  packageReviewRow({ id, decision: "approved", first: reviewRow(REVIEW_3, "approved", null, "2026-11-22T09:00:00+00:00"), second: reviewRow(REVIEW_2, "approved", null, "2026-11-21T09:00:00+00:00") });

describe("Решение по комплекту (веб: /portal/package-notifications/[id])", () => {
  it("исправления: слово, время по Бишкеку, замечание, какие материалы исправить, состав и проверки, учтённые в решении", async () => {
    const { transport, calls } = fakeTransport({
      application_package_notification_v1: packageNotificationRow(),
      application_package_detail_v1: packageDetailRow(),
    });
    await render(transport);
    expect(await screen.findByTestId("package-detail")).toBeTruthy();
    expect(screen.getByTestId("detail-title")).toHaveTextContent("Решение по комплекту");
    expect(screen.getByTestId("package-decision-word")).toHaveTextContent("Нужны исправления");
    expect(screen.getByText("Решение от: 21.11.2026, 17:00 (Бишкек)")).toBeTruthy(); // 11:00 UTC
    expect(screen.getByTestId("package-decision-reason")).toHaveTextContent("Заверьте перевод и пришлите чёткий скан паспорта.");
    // какие материалы нужно исправить: название из состава, а не идентификатор
    expect(within(screen.getByTestId("package-affected")).getByText("Паспорт")).toBeTruthy();
    expect(screen.getByText("Комплект 2")).toBeTruthy();
    expect(screen.getByText("Программная инженерия · Осень 2027")).toBeTruthy();
    const passport = screen.getByTestId("package-item-e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1");
    expect(passport).toHaveTextContent("Личные документы · Обязательно", { exact: false });
    expect(passport).toHaveTextContent("passport.pdf", { exact: false });
    expect(passport).toHaveTextContent("Проверки, учтённые в решении", { exact: false });
    expect(passport).toHaveTextContent("Нужно исправить", { exact: false });
    const diploma = screen.getByTestId("package-item-e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2");
    expect(diploma).toHaveTextContent("Принят для этой программы", { exact: false });
    expect(screen.queryByTestId("package-warnings")).toBeNull(); // после решения ничего не менялось
    expect(screen.queryByTestId("package-newer")).toBeNull();
    // два чтения: уведомление, затем состав комплекта этого уведомления; оба GET
    expect(calls.map((c) => [c.name, c.get])).toEqual([["application_package_notification_v1", true], ["application_package_detail_v1", true]]);
    expect(calls[1]!.args).toMatchObject({ p_application_id: APPLICATION_ID });
  });

  it("комплект проверен: слово «Комплект проверен», без замечания и без списка исправлений", async () => {
    const approved = approvedReview();
    const { transport } = fakeTransport({
      application_package_notification_v1: packageNotificationRow({ review: approved }),
      application_package_detail_v1: packageDetailRow({
        latest: approved,
        items: [
          packageItemRow(1, { submission: submissionRow({ item: ITEM_1, review: reviewRow(REVIEW_3, "approved", null, "2026-11-22T09:00:00+00:00") }) }),
          packageItemRow(2),
        ],
      }),
    });
    await render(transport);
    expect(await screen.findByTestId("package-decision-word")).toHaveTextContent("Комплект проверен");
    expect(screen.queryByTestId("package-decision-reason")).toBeNull();
    expect(screen.queryByTestId("package-affected")).toBeNull();
  });

  it("позднее решение и изменения после решения видны отдельно от решения из уведомления", async () => {
    // В уведомлении «нужны исправления», но по комплекту уже есть новое решение «проверен», а по паспорту новая проверка.
    const frozen = packageReviewRow();
    const latest = approvedReview();
    const { transport } = fakeTransport({
      application_package_notification_v1: packageNotificationRow({ review: frozen }),
      application_package_detail_v1: packageDetailRow({
        latest,
        items: [
          packageItemRow(1, { submission: submissionRow({ item: ITEM_1, submission: SUBMISSION_1, review: reviewRow(REVIEW_3, "approved", null, "2026-11-22T09:00:00+00:00") }) }),
          packageItemRow(2),
        ],
      }),
    });
    await render(transport);
    expect(await screen.findByTestId("package-decision-word")).toHaveTextContent("Нужны исправления"); // решение из уведомления не подменяется
    expect(within(screen.getByTestId("package-newer")).getByText("Есть более позднее решение по комплекту")).toBeTruthy();
    expect(screen.getByTestId("package-newer-decision-word")).toHaveTextContent("Комплект проверен");
    expect(within(screen.getByTestId("package-warnings")).getByText("Паспорт: Решение по файлу изменилось")).toBeTruthy();
    expect(screen.getByText("Это решение из уведомления. Более поздние решения доступны в истории.")).toBeTruthy();
  });

  it("файл больше недоступен: предупреждение «Выбранный файл недоступен» и причина у файла", async () => {
    const frozen = packageReviewRow();
    const item = packageItemRow(1, { submission: submissionRow({ item: ITEM_1, file: { technicalAvailability: "unavailable", unavailableReasons: ["storage_object_unavailable"] }, review: reviewRow(REVIEW_1, "correction_required", "Скан обрезан: нужны все четыре края страницы.") }) });
    const { transport } = fakeTransport({
      application_package_notification_v1: packageNotificationRow({ review: frozen }),
      application_package_detail_v1: packageDetailRow({
        latest: frozen,
        items: [item, packageItemRow(2)],
        warnings: [{ requirementItemId: ITEM_1, submissionId: SUBMISSION_1, reason: "file_unavailable", currentReview: item.submission.review }],
      }),
    });
    await render(transport);
    expect(await screen.findByText("Паспорт: Выбранный файл недоступен")).toBeTruthy();
    expect(screen.getByText("Сохранённый файл недоступен. Обратитесь к куратору.")).toBeTruthy();
  });

  it("стартовый комплект и прежняя редакция требований подписаны", async () => {
    const { transport } = fakeTransport({
      application_package_notification_v1: packageNotificationRow(),
      application_package_detail_v1: packageDetailRow({ origin: "evo_starter", current: false }),
    });
    await render(transport);
    expect(await screen.findByText("Стартовый комплект EVO")).toBeTruthy();
    expect(screen.getByText("Полный перечень университета ещё нужно уточнить.")).toBeTruthy();
    expect(screen.getByText("Прежняя редакция требований")).toBeTruthy();
  });

  it("срок материала и источник срока", async () => {
    const deadline = { date: "2026-12-01", time: "18:00", timezone: "Asia/Bishkek", sourceUrl: "https://university.edu/rules", verifiedOn: "2026-11-01" };
    const { transport } = fakeTransport({
      application_package_notification_v1: packageNotificationRow(),
      application_package_detail_v1: packageDetailRow({ items: [packageItemRow(1, { definition: { deadline } }), packageItemRow(2)] }),
    });
    await render(transport);
    expect(await screen.findByText("Срок: 01.12.2026 18:00 (Asia/Bishkek)")).toBeTruthy();
    expect(screen.getByText("Источник срока")).toBeTruthy();
  });

  it("состав не прочитался: решение остаётся на экране, под ним плашка с «Обновить»; повтор читает состав снова", async () => {
    let reads = 0;
    const { transport } = fakeTransport({
      application_package_notification_v1: packageNotificationRow(),
      application_package_detail_v1: () => (++reads === 1 ? failure(null, 503) : packageDetailRow()),
    });
    await render(transport);
    expect(await screen.findByTestId("package-detail-error")).toBeTruthy();
    expect(screen.getByText("Не удалось обновить данные. Попробуйте ещё раз.")).toBeTruthy();
    expect(screen.getByTestId("package-decision-word")).toHaveTextContent("Нужны исправления");
    await fireEvent.press(within(screen.getByTestId("package-detail-error")).getByText("Обновить"));
    expect(await screen.findByTestId("package-detail")).toBeTruthy();
  });

  it("уведомление не прочиталось (обрыв, сервер): «Не удалось обновить данные» и «Обновить»; повтор читает снова", async () => {
    let reads = 0;
    const { transport } = fakeTransport({
      application_package_notification_v1: () => (++reads === 1 ? failure(null, 503) : packageNotificationRow()),
      application_package_detail_v1: packageDetailRow(),
    });
    await render(transport);
    expect(await screen.findByTestId("package-decision-error")).toBeTruthy();
    expect(screen.getByText("Не удалось обновить данные. Попробуйте ещё раз.")).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId("package-decision-error")).getByText("Обновить"));
    expect(await screen.findByTestId("package-detail")).toBeTruthy();
  });

  it("чужое или несуществующее уведомление (сервер: «нет доступа»): «Такой страницы здесь нет» без «Обновить»", async () => {
    const { transport, calls } = fakeTransport({ application_package_notification_v1: failure("42501", 403) });
    await render(transport);
    expect(await screen.findByTestId("detail-not-found")).toHaveTextContent("Такой страницы здесь нет", { exact: false });
    expect(screen.queryByTestId("package-decision-error")).toBeNull();
    expect(screen.queryByText("Обновить")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("«Открыть программу» ведёт на экран требований программы; «Что нового» на ленту", async () => {
    const { transport } = fakeTransport({ application_package_notification_v1: packageNotificationRow(), application_package_detail_v1: packageDetailRow() });
    await render(transport);
    await fireEvent.press(await screen.findByTestId("decision-open-program"));
    expect(navigate).toHaveBeenCalledWith(preparationHref(APPLICATION_ID));
    await fireEvent.press(screen.getByTestId("decision-all"));
    expect(navigate).toHaveBeenCalledWith("/messages/updates");
  });

  it("негодный идентификатор: на сервер не ходит", async () => {
    const { transport, calls } = fakeTransport({ application_package_notification_v1: packageNotificationRow() });
    await render(transport, "ru", "не-uuid");
    expect(await screen.findByTestId("detail-not-found")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("кыргызский язык: слова решения из пакетного словаря", async () => {
    const { transport } = fakeTransport({ application_package_notification_v1: packageNotificationRow(), application_package_detail_v1: packageDetailRow() });
    await render(transport, "ky");
    expect(await screen.findByTestId("package-decision-word")).toHaveTextContent("Оңдоолор керек");
    expect(screen.getByTestId("detail-title")).toHaveTextContent("Топтом боюнча чечим");
  });

  describe("«История решений»", () => {
    const earlier = packageReviewRow({ id: "f3f3f3f3-f3f3-43f3-83f3-f3f3f3f3f3f3", reviewedAt: "2026-11-20T12:00:00+00:00", reason: "Не хватает перевода диплома.", affected: [ITEM_1] });
    const latest = approvedReview();

    it("свёрнута; по раскрытию читается POST с курсором null и лимитом 20; решения новыми первыми, с материалами и проверками", async () => {
      const { transport, calls } = fakeTransport({
        application_package_notification_v1: packageNotificationRow(),
        application_package_detail_v1: packageDetailRow(),
        application_package_review_history_v1: packageHistoryRow([latest, earlier]),
      });
      await render(transport);
      await screen.findByTestId("package-detail");
      expect(calls.some((c) => c.name === "application_package_review_history_v1")).toBe(false); // без раскрытия не читается
      expect(screen.getByTestId("package-history-toggle").props.accessibilityState).toMatchObject({ expanded: false });
      await fireEvent.press(screen.getByTestId("package-history-toggle"));
      expect(await screen.findByTestId(`package-history-${latest.packageReviewId}`)).toBeTruthy();
      const read = calls.find((c) => c.name === "application_package_review_history_v1")!;
      expect(read.get).toBe(false); // курсор — объект (jsonb), поэтому POST
      expect(read.args).toMatchObject({ p_cursor: null, p_limit: 20, p_application_id: APPLICATION_ID });
      expect(screen.getByTestId(`package-history-decision-${latest.packageReviewId}-word`)).toHaveTextContent("Комплект проверен");
      expect(screen.getByTestId(`package-history-decision-${earlier.packageReviewId}-word`)).toHaveTextContent("Нужны исправления");
      expect(within(screen.getByTestId(`package-history-${earlier.packageReviewId}`)).getByText("Не хватает перевода диплома.")).toBeTruthy();
      // «Паспорт»: в списке «Какие материалы нужно исправить» и заголовком проверки; «Диплом» только заголовком проверки
      expect(within(screen.getByTestId(`package-history-${earlier.packageReviewId}`)).getAllByText("Паспорт")).toHaveLength(2);
      expect(within(screen.getByTestId(`package-history-${earlier.packageReviewId}`)).getByText("Диплом")).toBeTruthy();
      expect(screen.queryByTestId("package-history-more")).toBeNull();
      await fireEvent.press(screen.getByTestId("package-history-toggle"));
      expect(screen.queryByTestId(`package-history-${latest.packageReviewId}`)).toBeNull();
    });

    it("«Показать ещё» дописывает следующую страницу с курсором, повторов нет", async () => {
      const cursor = { createdAt: latest.reviewedAt, id: latest.packageReviewId };
      const { transport, calls } = fakeTransport({
        application_package_notification_v1: packageNotificationRow(),
        application_package_detail_v1: packageDetailRow(),
        application_package_review_history_v1: (args?: Record<string, unknown>) => (args?.p_cursor ? packageHistoryRow([earlier]) : packageHistoryRow([latest], cursor)),
      });
      await render(transport);
      await fireEvent.press(await screen.findByTestId("package-history-toggle"));
      await fireEvent.press(await screen.findByTestId("package-history-more"));
      expect(await screen.findByTestId(`package-history-${earlier.packageReviewId}`)).toBeTruthy();
      expect(screen.getByTestId(`package-history-${latest.packageReviewId}`)).toBeTruthy();
      expect(calls.filter((c) => c.name === "application_package_review_history_v1")[1]!.args).toMatchObject({ p_cursor: cursor });
      expect(screen.queryByTestId("package-history-more")).toBeNull();
    });

    it("решений нет: «Решения пока нет»; сбой чтения: «Не удалось обновить данные», «Обновить» читает снова", async () => {
      let reads = 0;
      const { transport } = fakeTransport({
        application_package_notification_v1: packageNotificationRow(),
        application_package_detail_v1: packageDetailRow(),
        application_package_review_history_v1: () => (++reads === 1 ? failure(null, 503) : packageHistoryRow([])),
      });
      await render(transport);
      await fireEvent.press(await screen.findByTestId("package-history-toggle"));
      expect(await screen.findByTestId("package-history-error")).toBeTruthy();
      await fireEvent.press(screen.getByTestId("package-history-refresh"));
      expect(await screen.findByText("Решения пока нет")).toBeTruthy();
      expect(screen.queryByTestId("package-history-error")).toBeNull();
    });
  });
});
