// «История комплектов» и «Комплект подробно» через настоящий экран: страницы по курсору, решение EVO и исправления, что
// изменилось после решения, история решений, скачивание файла из комплекта. Сеть и устройство подменены.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { Platform } from "react-native";

import { PreparationScreen } from "@/features/preparations/PreparationScreen";
import {
  APPLICATION_ID,
  REVISION_ID,
  STUDENT_CASE_ID,
  documentFile,
  documentState,
  itemId,
  readiness,
  requirementItem,
  requirements,
  slotId,
  versionId,
} from "@/test-fixtures/preparations";
import { makeIo } from "@/test-fixtures/preparations-io";
import {
  docReviewFor,
  packageDetail,
  packageHistoryPage,
  packageId,
  packageItem,
  packageReview,
  packageReviewId,
  packageSummary,
  reviewHistoryPage,
} from "@/test-fixtures/preparations-packages";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport, preparationRow, uuidN } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));

type Raw = Record<string, unknown>;
const FIRST = itemId(0);
const base = () => readiness(requirements([requirementItem(0)]), [documentState(0)]);
const submission = (n: number) => uuidN(n, "33333333");
const cursorOf = (summary: Raw) => ({ createdAt: summary.submittedAt, id: summary.packageId });

async function open(extra: Record<string, unknown>, ready: unknown = base(), io = makeIo()) {
  const { transport, calls } = fakeTransport({ student_catalog_preparations_v1: [preparationRow(1)], application_package_readiness_v1: ready, ...extra });
  const view = await renderPortal(<PreparationScreen applicationId={APPLICATION_ID} io={io.io} />, testApi(transport));
  return { ...view, calls, io, named: (name: string) => calls.filter((call) => call.name === name) };
}

let restore: () => void = () => undefined;
beforeEach(async () => {
  const spy = jest.replaceProperty(Platform, "OS", "android");
  restore = () => spy.restore();
  await AsyncStorage.clear();
});
afterEach(() => restore());

describe("история комплектов", () => {
  const p1 = packageSummary(1, 1);
  const p2 = packageSummary(2, 1, { latestReview: packageReview(1, 2, [0], "approved") });
  const p3 = packageSummary(3, 1, { latestReview: packageReview(2, 3, [0], "correction_required", "Нужна чёткая копия.", [0]) });

  it("читается при первом раскрытии и один раз: комплекты от новых к старым со статусом и временем", async () => {
    const t = await open({ application_package_history_v1: packageHistoryPage([p3, p2, p1]) });
    const toggle = await screen.findByTestId("prep-package-history-toggle");
    expect(t.named("application_package_history_v1")).toHaveLength(0);
    await fireEvent.press(toggle);
    await waitFor(() => expect(screen.getByTestId(`prep-package-row-${p3.packageId as string}`)).toBeTruthy());
    expect(t.named("application_package_history_v1")[0]!.args).toMatchObject({ p_student_case_id: STUDENT_CASE_ID, p_application_id: APPLICATION_ID, p_cursor: null, p_limit: 20 });
    expect(within(screen.getByTestId(`prep-package-row-${p3.packageId as string}`)).getByText("Комплект 3 · Нужны исправления")).toBeTruthy();
    expect(within(screen.getByTestId(`prep-package-row-${p2.packageId as string}`)).getByText("Комплект 2 · Комплект проверен")).toBeTruthy();
    expect(within(screen.getByTestId(`prep-package-row-${p1.packageId as string}`)).getByText("Комплект 1 · Отправлен на проверку EVO")).toBeTruthy();
    expect(within(screen.getByTestId(`prep-package-row-${p1.packageId as string}`)).getByText(/\(Бишкек\)/)).toBeTruthy();
    // закрыли и открыли: страницы не перечитываются
    await fireEvent.press(screen.getByTestId("prep-package-history-toggle"));
    await fireEvent.press(screen.getByTestId("prep-package-history-toggle"));
    expect(t.named("application_package_history_v1")).toHaveLength(1);
  });

  it("комплектов нет: «Комплекты ещё не отправлены»", async () => {
    await open({ application_package_history_v1: packageHistoryPage([]) });
    await fireEvent.press(await screen.findByTestId("prep-package-history-toggle"));
    expect(await screen.findByTestId("prep-package-history-empty")).toHaveTextContent("Комплекты ещё не отправлены");
  });

  it("сбой чтения: сообщение; «Обновить» читает первую страницу заново", async () => {
    let call = 0;
    await open({ application_package_history_v1: () => (++call === 1 ? failure("PT500", 500) : packageHistoryPage([p1])) });
    await fireEvent.press(await screen.findByTestId("prep-package-history-toggle"));
    expect(await screen.findByTestId("prep-package-history-error")).toHaveTextContent("Не удалось обновить данные. Попробуйте ещё раз.");
    await fireEvent.press(screen.getByTestId("prep-package-history-refresh"));
    await waitFor(() => expect(screen.getByTestId(`prep-package-row-${p1.packageId as string}`)).toBeTruthy());
    expect(screen.queryByTestId("prep-package-history-error")).toBeNull();
  });

  it("«Показать ещё» идёт по курсору последнего комплекта и не повторяет строки; «Обновить» возвращает первую страницу", async () => {
    let page = 0;
    const t = await open({
      application_package_history_v1: () => {
        page += 1;
        return page === 1 ? packageHistoryPage([p3, p2], cursorOf(p2)) : page === 2 ? packageHistoryPage([p1], null) : packageHistoryPage([p3, p2], cursorOf(p2));
      },
    });
    await fireEvent.press(await screen.findByTestId("prep-package-history-toggle"));
    await fireEvent.press(await screen.findByTestId("prep-package-history-more"));
    await waitFor(() => expect(screen.getByTestId(`prep-package-row-${p1.packageId as string}`)).toBeTruthy());
    expect(t.named("application_package_history_v1")[1]!.args).toMatchObject({ p_cursor: cursorOf(p2) });
    expect(screen.getAllByTestId(`prep-package-row-${p2.packageId as string}`)).toHaveLength(1);
    expect(screen.queryByTestId("prep-package-history-more")).toBeNull();
    await fireEvent.press(screen.getByTestId("prep-package-history-refresh"));
    await waitFor(() => expect(screen.queryByTestId(`prep-package-row-${p1.packageId as string}`)).toBeNull());
    expect(screen.getByTestId(`prep-package-row-${p3.packageId as string}`)).toBeTruthy();
    expect(screen.getByTestId("prep-package-history-more")).toBeTruthy();
  });

  it("следующая страница снова называет уже показанный комплект: он остаётся в списке один раз", async () => {
    let page = 0;
    await open({ application_package_history_v1: () => (++page === 1 ? packageHistoryPage([p3, p2], cursorOf(p2)) : packageHistoryPage([p2, p1], null)) });
    await fireEvent.press(await screen.findByTestId("prep-package-history-toggle"));
    await fireEvent.press(await screen.findByTestId("prep-package-history-more"));
    await waitFor(() => expect(screen.getByTestId(`prep-package-row-${p1.packageId as string}`)).toBeTruthy());
    expect(screen.getAllByTestId(`prep-package-row-${p2.packageId as string}`)).toHaveLength(1);
    expect(screen.getAllByTestId(`prep-package-row-${p3.packageId as string}`)).toHaveLength(1);
  });

  it("после «Проверить состояние» история закрывается и при раскрытии читается заново", async () => {
    let page = 0;
    const t = await open({ application_package_history_v1: () => (++page === 1 ? packageHistoryPage([p1]) : packageHistoryPage([p2, p1], cursorOf(p1))) });
    await fireEvent.press(await screen.findByTestId("prep-package-history-toggle"));
    await screen.findByTestId(`prep-package-row-${p1.packageId as string}`);
    await fireEvent.press(screen.getByTestId("prep-check"));
    await waitFor(() => expect(screen.getByTestId("prep-package-history-toggle").props.accessibilityState).toMatchObject({ expanded: false }));
    expect(screen.queryByTestId(`prep-package-row-${p1.packageId as string}`)).toBeNull();
    await fireEvent.press(screen.getByTestId("prep-package-history-toggle"));
    await waitFor(() => expect(screen.getByTestId(`prep-package-row-${p2.packageId as string}`)).toBeTruthy());
    expect(t.named("application_package_history_v1")).toHaveLength(2);
  });
});

describe("комплект подробно", () => {
  const detailOf = (summary: Raw, items: Raw[] = [packageItem(0, 5, null)], warnings: Raw[] = []) => packageDetail(summary, items, warnings);
  const toRowDetail = async (summary: Raw, extra: Record<string, unknown>, ready: unknown = base(), io = makeIo()) => {
    const t = await open({ application_package_history_v1: packageHistoryPage([summary]), ...extra }, ready, io);
    await fireEvent.press(await screen.findByTestId("prep-package-history-toggle"));
    await fireEvent.press(await screen.findByTestId(`prep-package-open-${summary.packageId as string}-toggle`));
    return t;
  };

  it("ждёт проверки: версия, программа, время отправки, файл с версией, «Отправлен на проверку EVO»", async () => {
    const summary = packageSummary(1, 1);
    const t = await toRowDetail(summary, { application_package_detail_v1: detailOf(summary) });
    const view = await screen.findByTestId(`prep-package-detail-${summary.packageId as string}`);
    // кнопка сообщает читалке, что комплект раскрыт, и называет его номер
    const toggle = screen.getByTestId(`prep-package-open-${summary.packageId as string}-toggle`);
    expect(toggle.props.accessibilityState).toMatchObject({ expanded: true });
    expect(toggle.props.accessibilityLabel).toBe("Открыть комплект: Комплект 1");
    expect(t.named("application_package_detail_v1")[0]!.args).toMatchObject({ p_package_id: summary.packageId, p_application_id: APPLICATION_ID });
    expect(within(view).getByText("Комплект 1")).toBeTruthy();
    expect(within(view).getByText("Информатика · Осень 2027")).toBeTruthy();
    expect(within(view).getByText(/Отправлен:/)).toBeTruthy();
    expect(within(view).getByText("Отправлен на проверку EVO")).toBeTruthy();
    const item = screen.getByTestId(`prep-package-item-${FIRST}`);
    expect(within(item).getByText("Требование 1")).toBeTruthy();
    expect(within(item).getByText("Основные документы · Обязательно")).toBeTruthy();
    expect(within(item).getByText("scan-5.pdf")).toBeTruthy();
    // повторное нажатие скрывает комплект
    await fireEvent.press(screen.getByTestId(`prep-package-open-${summary.packageId as string}-toggle`));
    expect(screen.queryByTestId(`prep-package-detail-${summary.packageId as string}`)).toBeNull();
    expect(screen.getByTestId(`prep-package-open-${summary.packageId as string}-toggle`).props.accessibilityState).toMatchObject({ expanded: false });
  });

  it("нужны исправления: решение, замечание, какие материалы исправить; проверен: «Комплект проверен» без списка исправлений", async () => {
    const correction = packageSummary(2, 1, { latestReview: packageReview(2, 2, [0], "correction_required", "Скан обрезан.", [0]) });
    await toRowDetail(correction, { application_package_detail_v1: detailOf(correction) });
    const view = await screen.findByTestId(`prep-package-detail-${correction.packageId as string}`);
    expect(within(view).getByText("Нужны исправления")).toBeTruthy();
    expect(within(view).getByText("Скан обрезан.")).toBeTruthy();
    expect(within(view).getByText("Какие материалы нужно исправить")).toBeTruthy();
    expect(within(view).getByText("• Требование 1")).toBeTruthy();
  });

  it("исправления без выбранных пунктов относятся ко всему составу", async () => {
    const general = packageSummary(2, 1, { latestReview: packageReview(2, 2, [0], "correction_required", "Пересоберите комплект.", []) });
    await toRowDetail(general, { application_package_detail_v1: detailOf(general) });
    const view = await screen.findByTestId(`prep-package-detail-${general.packageId as string}`);
    expect(within(view).getByText("Без выбранных пунктов замечание относится ко всему составу.")).toBeTruthy();
    expect(within(view).queryByText("Какие материалы нужно исправить")).toBeNull();
  });

  it("проверен: «Комплект проверен», решения по файлу видны, списка исправлений нет", async () => {
    const approved = packageSummary(2, 1, { latestReview: packageReview(1, 2, [0], "approved") });
    await toRowDetail(approved, { application_package_detail_v1: detailOf(approved, [packageItem(0, 5, docReviewFor(0))]) });
    const view = await screen.findByTestId(`prep-package-detail-${approved.packageId as string}`);
    expect(within(view).getAllByText("Комплект проверен").length).toBeGreaterThan(0);
    expect(within(view).queryByText("Какие материалы нужно исправить")).toBeNull();
    expect(within(screen.getByTestId(`prep-package-item-${FIRST}`)).getByText("Проверки, учтённые в решении")).toBeTruthy();
  });

  it("после решения файл стал недоступен: «Что изменилось после решения» называет требование", async () => {
    const summary = packageSummary(1, 1);
    const unavailable = packageItem(0, 5, null) as { submission: Raw } & Raw;
    const item = { ...unavailable, submission: { ...unavailable.submission, file: documentFile(5, { technicalAvailability: "unavailable", unavailableReasons: ["integrity_pending"] }) } };
    const warning = { requirementItemId: FIRST, submissionId: submission(1), reason: "file_unavailable", currentReview: null };
    await toRowDetail(summary, { application_package_detail_v1: detailOf(summary, [item], [warning]) });
    const block = await screen.findByTestId(`prep-package-warnings-${summary.packageId as string}`);
    expect(within(block).getByText("Что изменилось после решения")).toBeTruthy();
    expect(within(block).getByText("• Требование 1: Выбранный файл недоступен")).toBeTruthy();
  });

  it("прежняя редакция требований и стартовый список подписаны", async () => {
    const summary = packageSummary(1, 1, { isCurrentRequirements: false, origin: "evo_starter", configurationState: "needs_confirmation" });
    await toRowDetail(summary, { application_package_detail_v1: detailOf(summary) });
    const view = await screen.findByTestId(`prep-package-detail-${summary.packageId as string}`);
    expect(within(view).getByText("Прежняя редакция требований")).toBeTruthy();
    expect(within(view).getByText("Стартовый комплект EVO")).toBeTruthy();
  });

  it("сбой чтения комплекта: сообщение вместо комплекта; «Обновить» читает заново", async () => {
    const summary = packageSummary(1, 1);
    let call = 0;
    const t = await toRowDetail(summary, { application_package_detail_v1: () => (++call === 1 ? failure("PT500", 500) : detailOf(summary)) });
    expect(await screen.findByTestId(`prep-package-detail-error-${summary.packageId as string}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`prep-package-detail-refresh-${summary.packageId as string}`));
    await waitFor(() => expect(screen.getByTestId(`prep-package-detail-${summary.packageId as string}`)).toBeTruthy());
    expect(t.named("application_package_detail_v1")).toHaveLength(2);
  });

  it("«Скачать файл» в комплекте идёт по номеру той редакции требований, в которой файл отправлен", async () => {
    const storage = "https://storage.example.test/object/sign/private/pkg?token=SIGNED";
    const io = makeIo({ fetchResponses: [{ status: 302, ok: false, headers: new Headers({ location: storage }), arrayBuffer: async () => new ArrayBuffer(0) }] });
    const summary = packageSummary(1, 1);
    await toRowDetail(summary, { application_package_detail_v1: detailOf(summary) }, base(), io);
    await fireEvent.press(await screen.findByTestId(`prep-package-file-${FIRST}-download`));
    await waitFor(() => expect(io.opened).toHaveLength(1));
    expect(io.fetches[0]!.url).toBe(
      `https://portal.example.test/api/portal/application-document-downloads?studentCaseId=${STUDENT_CASE_ID}&applicationId=${APPLICATION_ID}&requirementsRevisionId=${REVISION_ID}&requirementItemId=${FIRST}&documentSlotId=${slotId(0)}&documentVersionId=${versionId(5)}`,
    );
  });
});

describe("история решений по комплекту", () => {
  const summary = packageSummary(2, 1, { latestReview: packageReview(2, 2, [0], "correction_required", "Скан обрезан.", [0]) });
  const older = packageReview(1, 2, [0], "approved");
  const open1 = async (extra: Record<string, unknown>) => {
    const t = await open({ application_package_history_v1: packageHistoryPage([summary]), application_package_detail_v1: packageDetail(summary, [packageItem(0, 5, null)], []), ...extra });
    await fireEvent.press(await screen.findByTestId("prep-package-history-toggle"));
    await fireEvent.press(await screen.findByTestId(`prep-package-open-${summary.packageId as string}-toggle`));
    await fireEvent.press(await screen.findByTestId(`prep-review-history-${summary.packageId as string}-toggle`));
    return t;
  };

  it("читается при раскрытии: решения от новых к старым, у каждого замечание и учтённые проверки", async () => {
    const t = await open1({ application_package_review_history_v1: reviewHistoryPage(2, [summary.latestReview as Raw, older]) });
    await waitFor(() => expect(screen.getByTestId(`prep-review-${packageReviewId(2)}`)).toBeTruthy());
    expect(t.named("application_package_review_history_v1")[0]!.args).toMatchObject({ p_package_id: packageId(2), p_cursor: null, p_limit: 20 });
    expect(within(screen.getByTestId(`prep-review-${packageReviewId(2)}`)).getByText("Скан обрезан.")).toBeTruthy();
    expect(within(screen.getByTestId(`prep-review-${packageReviewId(1)}`)).getByText("Комплект проверен")).toBeTruthy();
  });

  it("закрыли и открыли снова: решения не перечитываются, пока не нажали «Обновить»", async () => {
    const t = await open1({ application_package_review_history_v1: reviewHistoryPage(2, [summary.latestReview as Raw, older]) });
    await screen.findByTestId(`prep-review-${packageReviewId(2)}`);
    await fireEvent.press(screen.getByTestId(`prep-review-history-${summary.packageId as string}-toggle`));
    await fireEvent.press(screen.getByTestId(`prep-review-history-${summary.packageId as string}-toggle`));
    expect(t.named("application_package_review_history_v1")).toHaveLength(1);
    await fireEvent.press(screen.getByTestId(`prep-review-history-refresh-${packageId(2)}`));
    await waitFor(() => expect(t.named("application_package_review_history_v1")).toHaveLength(2));
  });

  it("решений нет: «Решения пока нет»; сбой: сообщение", async () => {
    let call = 0;
    await open1({ application_package_review_history_v1: () => (++call === 1 ? failure("PT500", 500) : reviewHistoryPage(2, [])) });
    expect(await screen.findByTestId(`prep-review-history-error-${packageId(2)}`)).toHaveTextContent("Не удалось обновить данные. Попробуйте ещё раз.");
    await fireEvent.press(screen.getByTestId(`prep-review-history-refresh-${packageId(2)}`));
    expect(await screen.findByTestId(`prep-review-history-empty-${packageId(2)}`)).toHaveTextContent("Решения пока нет");
    expect(screen.queryByTestId(`prep-review-history-error-${packageId(2)}`)).toBeNull();
  });

  it("«Показать ещё» добавляет страницу по курсору последнего решения", async () => {
    const latest = summary.latestReview as Raw;
    const cursor = { createdAt: latest.reviewedAt, id: latest.packageReviewId };
    let page = 0;
    const t = await open1({ application_package_review_history_v1: () => (++page === 1 ? reviewHistoryPage(2, [latest], cursor) : reviewHistoryPage(2, [older], null)) });
    await fireEvent.press(await screen.findByTestId(`prep-review-history-more-${packageId(2)}`));
    await waitFor(() => expect(screen.getByTestId(`prep-review-${packageReviewId(1)}`)).toBeTruthy());
    expect(t.named("application_package_review_history_v1")[1]!.args).toMatchObject({ p_cursor: cursor });
    expect(screen.getByTestId(`prep-review-${packageReviewId(2)}`)).toBeTruthy();
    expect(screen.queryByTestId(`prep-review-history-more-${packageId(2)}`)).toBeNull();
  });
});
