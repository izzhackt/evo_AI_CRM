// Файл к требованию программы через настоящий экран: сохранённые версии, скачивание, история (по требованию и по программе),
// «По предыдущим требованиям», неоконченные записи прежних требований. Сеть и устройство подменены.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";

import { documentsPending } from "@/features/preparations/documents-pending";
import { PreparationScreen } from "@/features/preparations/PreparationScreen";
import {
  APPLICATION_ID,
  REVISION_ID,
  STUDENT_CASE_ID,
  documentState,
  draftOf,
  historyPage,
  historySubmission,
  historyUpload,
  itemId,
  readiness,
  requirementItem,
  requirements,
  reusableVersion,
  reviewOf,
  slotId,
  submissionOf,
  submitReceipt,
  uploadId,
  versionId,
  versionsPage,
} from "@/test-fixtures/preparations";
import { makeIo, type FakeIo } from "@/test-fixtures/preparations-io";
import { pressTwiceInOneTick } from "@/test-fixtures/press";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport, preparationRow } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));

const spoken = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;
const ITEM = itemId(0);
const REQUEST = "99999999-0000-4000-8000-000000000001";
const scope = { organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", membershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID };
type Raw = Record<string, unknown>;
const emptyItem = () => requirementItem(0);
const sentItem = (n: number, extra: Raw = {}) => requirementItem(0, { slotStatus: "submitted", currentVersionId: versionId(n), currentVersionNo: String(n), technicalAvailability: "available", unavailableReasons: [], ...extra });
const answer = (item: Raw, state: Raw) => readiness(requirements([item]), [state]);

async function open(options: { ready: unknown; extra?: Record<string, unknown>; io?: FakeIo }) {
  const fake = options.io ?? makeIo();
  const { transport, calls } = fakeTransport({ student_catalog_preparations_v1: [preparationRow(1)], application_package_readiness_v1: options.ready, ...options.extra });
  const view = await renderPortal(<PreparationScreen applicationId={APPLICATION_ID} io={fake.io} />, testApi(transport));
  return { ...view, calls, fake };
}
const storedKeys = async () => (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("evo.application-documents.v1:"));

let restore: () => void = () => undefined;
beforeEach(async () => {
  const spy = jest.replaceProperty(Platform, "OS", "android");
  restore = () => spy.restore();
  await AsyncStorage.clear();
});
afterEach(() => restore());

describe("«Использовать сохранённый файл»", () => {
  const withVersions = (extra: Raw = {}) => answer(sentItem(1), documentState(0, { submission: submissionOf(0, 1, reviewOf(1, "correction_required", "Скан обрезан.")), reusableVersions: [reusableVersion(5), reusableVersion(3)], ...extra }));

  it("список версий раскрывается; текущая отправленная версия в него не входит; недоступная версия не выбирается", async () => {
    const unavailable = reusableVersion(2, { technicalAvailability: "unavailable", unavailableReasons: ["malware_pending"] });
    await open({ ready: answer(sentItem(1), documentState(0, { submission: submissionOf(0, 1, null), reusableVersions: [reusableVersion(5), unavailable, reusableVersion(1)] })) });
    await fireEvent.press(await screen.findByTestId(`prep-versions-${ITEM}-toggle`));
    expect(screen.getByTestId(`prep-version-${versionId(5)}`)).toBeTruthy();
    // версия, которая уже отправлена, выбору не подлежит
    expect(screen.queryByTestId(`prep-version-${versionId(1)}`)).toBeNull();
    const blocked = screen.getByTestId(`prep-version-${versionId(2)}`);
    expect(blocked.props.accessibilityState).toMatchObject({ disabled: true, selected: false });
    expect(blocked.props.accessibilityLabel).toContain("Файл проходит проверку безопасности.");
    // нажатие на недоступную версию ничего не выбирает: кнопки отправки не появляется
    await fireEvent.press(blocked);
    expect(screen.getByTestId(`prep-version-${versionId(2)}`).props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.queryByTestId(`prep-submit-button-${ITEM}`)).toBeNull();
    expect(screen.getByTestId(`prep-versions-${ITEM}`)).toHaveTextContent("Выберите версию для отправки", { exact: false });
  });

  it("выбор версии показывает её файл и открывает отправку; отправка идёт с выбором existing_version и прежней отправкой", async () => {
    const t = await open({
      ready: (_a: unknown, call: number) => (call === 1 ? withVersions() : answer(sentItem(5), documentState(0, { submission: submissionOf(0, 5, null), canSubmit: false }))),
      extra: { submit_application_document_v1: (args: Record<string, unknown> | undefined) => submitReceipt(0, String(args?.p_request_id), versionId(5), { reused: true }) },
    });
    expect(screen.queryByTestId(`prep-submit-button-${ITEM}`)).toBeNull();
    await fireEvent.press(await screen.findByTestId(`prep-versions-${ITEM}-toggle`));
    await fireEvent.press(screen.getByTestId(`prep-version-${versionId(5)}`));
    expect(screen.getByTestId(`prep-version-${versionId(5)}`).props.accessibilityState).toMatchObject({ selected: true });
    expect(within(screen.getByTestId(`prep-version-chosen-${ITEM}`)).getByText("scan-5.pdf")).toBeTruthy();
    await fireEvent.press(await screen.findByTestId(`prep-submit-button-${ITEM}`));
    await waitFor(() => expect(t.calls.some((c) => c.name === "submit_application_document_v1")).toBe(true));
    expect(t.calls.find((c) => c.name === "submit_application_document_v1")!.args).toMatchObject({
      p_selection: { kind: "existing_version", documentVersionId: versionId(5) },
      p_expected_previous_submission_id: "33333333-0000-4000-8000-000000000001",
    });
    await waitFor(() => expect(screen.getByTestId(`prep-document-notice-${ITEM}`)).toHaveTextContent("Документ отправлен на проверку EVO.", { exact: false }));
  });

  it("повторное нажатие на выбранную версию снимает выбор, кнопка отправки уходит", async () => {
    await open({ ready: withVersions() });
    await fireEvent.press(await screen.findByTestId(`prep-versions-${ITEM}-toggle`));
    await fireEvent.press(screen.getByTestId(`prep-version-${versionId(3)}`));
    expect(await screen.findByTestId(`prep-submit-button-${ITEM}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`prep-version-${versionId(3)}`));
    await waitFor(() => expect(screen.queryByTestId(`prep-submit-button-${ITEM}`)).toBeNull());
  });

  it("«Показать ещё» читает следующую страницу по курсору и не повторяет версии; сбой чтения - сообщение", async () => {
    const cursor = { versionNo: "3", documentVersionId: versionId(3) };
    const t = await open({
      ready: withVersions({ reusableVersionsNextCursor: cursor }),
      // вторая страница снова называет версию 3 (она уже есть на первой): повторов быть не должно
      extra: { application_document_reusable_versions_v1: versionsPage(0, [reusableVersion(3), reusableVersion(2), reusableVersion(1)], null) },
    });
    await fireEvent.press(await screen.findByTestId(`prep-versions-${ITEM}-toggle`));
    await fireEvent.press(screen.getByTestId(`prep-versions-more-${ITEM}`));
    await waitFor(() => expect(screen.getByTestId(`prep-version-${versionId(2)}`)).toBeTruthy());
    expect(t.calls.find((c) => c.name === "application_document_reusable_versions_v1")!.args).toMatchObject({ p_requirement_item_id: ITEM, p_cursor: cursor, p_limit: 20 });
    // версия 1 уже отправлена: в списке её нет, и кнопки «Показать ещё» больше нет
    expect(screen.queryByTestId(`prep-version-${versionId(1)}`)).toBeNull();
    expect(screen.queryByTestId(`prep-versions-more-${ITEM}`)).toBeNull();
    expect(screen.getAllByTestId(`prep-version-${versionId(3)}`)).toHaveLength(1);
    expect(screen.getAllByTestId(`prep-version-${versionId(5)}`)).toHaveLength(1);
  });

  it("сбой чтения следующей страницы: «Не удалось загрузить историю», кнопка остаётся для повтора", async () => {
    await open({
      ready: withVersions({ reusableVersionsNextCursor: { versionNo: "3", documentVersionId: versionId(3) } }),
      extra: { application_document_reusable_versions_v1: failure("PT500", 500) },
    });
    await fireEvent.press(await screen.findByTestId(`prep-versions-${ITEM}-toggle`));
    await fireEvent.press(screen.getByTestId(`prep-versions-more-${ITEM}`));
    expect(await screen.findByText("Не удалось загрузить историю. Повторите попытку.")).toBeTruthy();
    expect(screen.getByTestId(`prep-versions-more-${ITEM}`)).toBeTruthy();
  });

  it("версий нет и курсора нет: блока выбора нет", async () => {
    await open({ ready: answer(emptyItem(), documentState(0)) });
    await screen.findByTestId(`prep-document-${ITEM}`);
    expect(screen.queryByTestId(`prep-versions-${ITEM}`)).toBeNull();
  });
});

describe("скачивание файла", () => {
  const submitted = () => answer(sentItem(1), documentState(0, { submission: submissionOf(0, 1, null), canSubmit: false }));

  it("«Скачать файл» отправленного документа: два шага через портал и хранилище, затем открытие просмотром", async () => {
    const storage = "https://storage.example.test/object/sign/private/abc?token=SIGNED";
    const fake = makeIo({ fetchResponses: [{ status: 302, ok: false, headers: new Headers({ location: storage }), arrayBuffer: async () => new ArrayBuffer(0) }] });
    await open({ ready: submitted(), io: fake });
    await fireEvent.press(await screen.findByTestId(`prep-document-${ITEM}-submission-file-download`));
    await waitFor(() => expect(fake.opened).toHaveLength(1));
    expect(fake.opened[0]).toBe("file:///cache/scan-1.pdf");
    expect(fake.fetches[0]!.url).toBe(
      `https://portal.example.test/api/portal/application-document-downloads?studentCaseId=${STUDENT_CASE_ID}&applicationId=${APPLICATION_ID}&requirementsRevisionId=${REVISION_ID}&requirementItemId=${ITEM}&documentSlotId=${slotId(0)}&documentVersionId=${versionId(1)}`,
    );
    expect(fake.fetches[0]!.headers.Authorization).toBe("Bearer synthetic-token");
    expect(fake.fetches[1]).toEqual({ url: storage, headers: { Accept: "*/*" } });
    expect(fake.io.openLocalFile).toHaveBeenCalledWith("file:///cache/scan-1.pdf", "application/pdf");
  });

  it("два нажатия «Скачать файл» раньше, чем кнопка выключилась: файл скачивается и открывается один раз", async () => {
    const storage = "https://storage.example.test/object/sign/private/abc?token=SIGNED";
    const fake = makeIo({ fetchResponses: [{ status: 302, ok: false, headers: new Headers({ location: storage }), arrayBuffer: async () => new ArrayBuffer(0) }] });
    await open({ ready: submitted(), io: fake });
    await screen.findByTestId(`prep-document-${ITEM}-submission-file-download`);
    await pressTwiceInOneTick(`prep-document-${ITEM}-submission-file-download`);
    await waitFor(() => expect(fake.opened).toHaveLength(1));
    // одно скачивание = два запроса (портал и подписанный адрес хранилища)
    expect(fake.fetches).toHaveLength(2);
    expect(fake.io.openLocalFile).toHaveBeenCalledTimes(1);
  });

  it("файл недоступен (идёт проверка): кнопка скачивания заблокирована", async () => {
    const file = { technicalAvailability: "unavailable", unavailableReasons: ["integrity_pending"] };
    await open({ ready: answer(sentItem(1), documentState(0, { submission: submissionOf(0, 1, null, file), canSubmit: false })) });
    const button = await screen.findByTestId(`prep-document-${ITEM}-submission-file-download`);
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("сбой скачивания: сообщение без текста сервера, кнопка снова доступна", async () => {
    const fake = makeIo({ fetchResponses: [{ status: 403, ok: false, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }] });
    await open({ ready: submitted(), io: fake });
    await fireEvent.press(await screen.findByTestId(`prep-document-${ITEM}-submission-file-download`));
    expect(await screen.findByTestId(`prep-document-${ITEM}-submission-file-download-error`)).toHaveTextContent("Файл сейчас недоступен.", { exact: false });
    expect(fake.opened).toHaveLength(0);
    expect(screen.getByTestId(`prep-document-${ITEM}-submission-file-download`).props.accessibilityState).toMatchObject({ disabled: false });
  });

  it("файл скачан, а системный просмотр не открылся: тоже сообщение", async () => {
    const fake = makeIo({ over: { openLocalFile: jest.fn(async () => { throw new Error("no viewer"); }) }, fetchResponses: [{ status: 302, ok: false, headers: new Headers({ location: "https://storage.example.test/x" }), arrayBuffer: async () => new ArrayBuffer(0) }] });
    await open({ ready: submitted(), io: fake });
    await fireEvent.press(await screen.findByTestId(`prep-document-${ITEM}-submission-file-download`));
    expect(await screen.findByTestId(`prep-document-${ITEM}-submission-file-download-error`)).toBeTruthy();
  });

  it("сохранённый файл можно скачать до отправки", async () => {
    const fake = makeIo({ fetchResponses: [{ status: 302, ok: false, headers: new Headers({ location: "https://storage.example.test/x" }), arrayBuffer: async () => new ArrayBuffer(0) }] });
    await open({ ready: answer(emptyItem(), documentState(0, { savedDraft: draftOf(0, 4) })), io: fake });
    await fireEvent.press(await screen.findByTestId(`prep-document-${ITEM}-draft-file-download`));
    await waitFor(() => expect(fake.opened).toEqual(["file:///cache/scan-4.pdf"]));
  });
});

describe("история", () => {
  const events = [historySubmission(0, 4, reviewOf(4, "approved"), "2026-10-09T10:00:00+00:00"), historyUpload(0, 3, "2026-10-08T10:00:00+00:00")];

  it("история требования читается при первом раскрытии: решение EVO, сохранённый файл, определение требования", async () => {
    const t = await open({ ready: answer(emptyItem(), documentState(0)), extra: { application_document_history_v1: historyPage(events, ITEM) } });
    expect(t.calls.some((c) => c.name === "application_document_history_v1")).toBe(false);
    await fireEvent.press(await screen.findByTestId(`prep-history-${ITEM}-toggle`));
    await waitFor(() => expect(screen.getByTestId(`prep-history-${ITEM}-entry-${events[0]!.id}`)).toBeTruthy());
    expect(t.calls.find((c) => c.name === "application_document_history_v1")!.args).toMatchObject({ p_requirement_item_id: ITEM, p_cursor: null, p_limit: 20 });
    const first = screen.getByTestId(`prep-history-${ITEM}-entry-${events[0]!.id}`);
    expect(within(first).getByText("Принят для этой программы")).toBeTruthy();
    expect(within(first).getByText("Требование 1")).toBeTruthy();
    expect(within(first).getByText("Основные документы · Обязательно")).toBeTruthy();
    const second = screen.getByTestId(`prep-history-${ITEM}-entry-${events[1]!.id}`);
    expect(within(second).getByText("Сохранённый файл")).toBeTruthy();
    // повторное раскрытие страницу не перечитывает
    await fireEvent.press(screen.getByTestId(`prep-history-${ITEM}-toggle`));
    await fireEvent.press(screen.getByTestId(`prep-history-${ITEM}-toggle`));
    expect(t.calls.filter((c) => c.name === "application_document_history_v1")).toHaveLength(1);
  });

  it("«Показать ещё» добавляет страницу по курсору без повторов, «Обновить документы» читает первую страницу заново", async () => {
    const cursor = { createdAt: "2026-10-08T10:00:00+00:00", id: uploadId(3) };
    let page = 0;
    const t = await open({
      ready: answer(emptyItem(), documentState(0)),
      extra: {
        application_document_history_v1: () => {
          page += 1;
          return page === 1 ? historyPage([events[0]!, events[1]!], ITEM, cursor) : page === 2 ? historyPage([historyUpload(0, 2, "2026-10-07T10:00:00+00:00")], ITEM) : historyPage([events[0]!], ITEM);
        },
      },
    });
    await fireEvent.press(await screen.findByTestId(`prep-history-${ITEM}-toggle`));
    await fireEvent.press(await screen.findByTestId(`prep-history-${ITEM}-more`));
    await waitFor(() => expect(screen.getByTestId(`prep-history-${ITEM}-entry-${uploadId(2)}`)).toBeTruthy());
    // первая страница осталась на месте, новая добавлена под ней
    expect(screen.getByTestId(`prep-history-${ITEM}-entry-${events[0]!.id}`)).toBeTruthy();
    expect(screen.getByTestId(`prep-history-${ITEM}-entry-${events[1]!.id}`)).toBeTruthy();
    expect(t.calls.filter((c) => c.name === "application_document_history_v1")[1]!.args).toMatchObject({ p_cursor: cursor });
    expect(screen.queryByTestId(`prep-history-${ITEM}-more`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`prep-history-${ITEM}-refresh`));
    await waitFor(() => expect(screen.queryByTestId(`prep-history-${ITEM}-entry-${uploadId(2)}`)).toBeNull());
    expect(screen.getByTestId(`prep-history-${ITEM}-entry-${events[0]!.id}`)).toBeTruthy();
  });

  it("история пуста: «Сохранённых файлов и отправок пока нет»; сбой чтения: сообщение и повтор", async () => {
    let call = 0;
    await open({ ready: answer(emptyItem(), documentState(0)), extra: { application_document_history_v1: () => (++call === 1 ? failure("PT500", 500) : historyPage([], ITEM)) } });
    await fireEvent.press(await screen.findByTestId(`prep-history-${ITEM}-toggle`));
    expect(await screen.findByTestId(`prep-history-${ITEM}-error`)).toHaveTextContent("Не удалось загрузить историю.", { exact: false });
    // сбой первой страницы: раскрытое состояние остаётся, повтор закрытием и открытием
    await fireEvent.press(screen.getByTestId(`prep-history-${ITEM}-toggle`));
    await fireEvent.press(screen.getByTestId(`prep-history-${ITEM}-toggle`));
    expect(await screen.findByTestId(`prep-history-${ITEM}-empty`)).toHaveTextContent("Сохранённых файлов и отправок пока нет.", { exact: false });
  });

  it("история всей программы: запрос без требования, подпись «История всех документов программы»", async () => {
    const t = await open({ ready: answer(emptyItem(), documentState(0)), extra: { application_document_history_v1: historyPage([events[0]!], null) } });
    await fireEvent.press(await screen.findByTestId("prep-program-history-toggle"));
    expect(screen.getByText("История всех документов программы")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId(`prep-program-history-entry-${events[0]!.id}`)).toBeTruthy());
    expect(t.calls.find((c) => c.name === "application_document_history_v1")!.args).toMatchObject({ p_requirement_item_id: null });
  });

  it("после «Проверить состояние» история закрывается и при раскрытии читается заново, а не показывает прежние страницы", async () => {
    let page = 0;
    const t = await open({ ready: answer(emptyItem(), documentState(0)), extra: { application_document_history_v1: () => (++page === 1 ? historyPage([events[0]!, events[1]!], ITEM) : historyPage([events[0]!], ITEM)) } });
    await fireEvent.press(await screen.findByTestId(`prep-history-${ITEM}-toggle`));
    await waitFor(() => expect(screen.getByTestId(`prep-history-${ITEM}-entry-${events[1]!.id}`)).toBeTruthy());
    await fireEvent.press(screen.getByTestId("prep-check"));
    await waitFor(() => expect(t.calls.filter((c) => c.name === "application_package_readiness_v1").length).toBeGreaterThanOrEqual(2));
    // блок истории пересоздан: свёрнут и без прежних записей
    await waitFor(() => expect(screen.getByTestId(`prep-history-${ITEM}-toggle`).props.accessibilityState).toMatchObject({ expanded: false }));
    expect(screen.queryByTestId(`prep-history-${ITEM}-entry-${events[1]!.id}`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`prep-history-${ITEM}-toggle`));
    await waitFor(() => expect(screen.getByTestId(`prep-history-${ITEM}-entry-${events[0]!.id}`)).toBeTruthy());
    expect(screen.queryByTestId(`prep-history-${ITEM}-entry-${events[1]!.id}`)).toBeNull();
    expect(t.calls.filter((c) => c.name === "application_document_history_v1")).toHaveLength(2);
  });

  it("«По предыдущим требованиям»: прежний файл и решение под раскрывающимся блоком с пояснением", async () => {
    const previous = historySubmission(0, 6, reviewOf(6, "approved"));
    // у требования с прежней ревизией свой идентификатор: previousEvidence принадлежит другому требованию
    const prevOfOther = { ...previous, requirementItemId: itemId(5), submission: { ...(previous.submission as Raw), requirementItemId: itemId(5), documentSlotId: slotId(5) }, definition: { ...(previous.definition as Raw), documentSlotId: slotId(5) } };
    await open({ ready: answer(emptyItem(), documentState(0, { previousEvidence: prevOfOther })) });
    await fireEvent.press(await screen.findByTestId(`prep-previous-${ITEM}-toggle`));
    expect(screen.getByText("Это прежний файл и решение. Для текущего требования выберите подходящую версию и отправьте её на проверку.")).toBeTruthy();
    expect(screen.getByText("Принят для этой программы")).toBeTruthy();
  });
});

describe("неоконченные записи прежних требований", () => {
  const OLD_ITEM = itemId(8);
  const OLD_REVISION = slotId(33);

  it("запись загрузки по прежней ревизии показана внизу: просит тот же файл и доводится до конца с прежним запросом", async () => {
    const intent = { protocolVersion: 1, studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requirementsRevisionId: OLD_REVISION, requirementItemId: OLD_ITEM, documentSlotId: slotId(8), requestId: REQUEST, file: { originalFilename: "справка.pdf", declaredMimeType: "application/pdf", byteSize: "37", sha256Hex: "" } };
    // отпечаток файла из подставленного устройства
    const fake = makeIo();
    const print = await fake.io.fingerprint({ uri: "file:///cache/picker/справка.pdf", name: "справка.pdf", size: 37, mimeType: "application/pdf", source: "file" });
    const stored = { ...intent, file: { ...intent.file, byteSize: String(print.byteSize), sha256Hex: print.sha256Hex } };
    await documentsPending.persist(scope, "upload", OLD_ITEM, stored as never);
    const t = await open({ ready: answer(emptyItem(), documentState(0)), io: fake });
    const section = await screen.findByTestId("prep-recovery");
    expect(within(section).getAllByText("Проверить результат", { exact: false }).length).toBeGreaterThanOrEqual(2); // заголовок раздела и кнопка
    await fireEvent.press(await screen.findByTestId(`prep-upload-button-${OLD_ITEM}`));
    await fireEvent.press(await screen.findByTestId("pick-file"));
    await waitFor(() => expect(t.fake.uploads).toHaveLength(1));
    expect(t.fake.uploads[0]).toMatchObject({ requestId: REQUEST, requirementsRevisionId: OLD_REVISION, requirementItemId: OLD_ITEM });
    await waitFor(async () => expect(await storedKeys()).toEqual([]));
    await waitFor(() => expect(screen.queryByTestId("prep-recovery")).toBeNull());
  });

  it("запись отправки по прежнему требованию: «Проверить результат» повторяет ТОТ ЖЕ запрос", async () => {
    const stored = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requirementsRevisionId: OLD_REVISION, requirementItemId: OLD_ITEM, requestId: REQUEST, selection: { kind: "existing_version", documentVersionId: versionId(9) }, expectedPreviousSubmissionId: null };
    await documentsPending.persist(scope, "submit", OLD_ITEM, stored as never);
    const t = await open({
      ready: answer(emptyItem(), documentState(0)),
      extra: { submit_application_document_v1: (args: Record<string, unknown> | undefined) => ({ ...submitReceipt(0, String(args?.p_request_id), versionId(9)), requirementsRevisionId: OLD_REVISION, requirementItemId: OLD_ITEM, documentSlotId: slotId(8) }) },
    });
    await fireEvent.press(await screen.findByTestId(`prep-recover-submit-${OLD_ITEM}`));
    await waitFor(() => expect(t.calls.some((c) => c.name === "submit_application_document_v1")).toBe(true));
    expect(t.calls.find((c) => c.name === "submit_application_document_v1")!.args).toMatchObject({ p_request_id: REQUEST, p_requirements_revision_id: OLD_REVISION, p_requirement_item_id: OLD_ITEM });
    await waitFor(async () => expect(await storedKeys()).toEqual([]));
    await waitFor(() => expect(screen.queryByTestId("prep-recovery")).toBeNull());
  });

  it("два нажатия «Проверить результат» раньше, чем кнопка выключилась: тот же запрос уходит один раз", async () => {
    const stored = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requirementsRevisionId: OLD_REVISION, requirementItemId: OLD_ITEM, requestId: REQUEST, selection: { kind: "existing_version", documentVersionId: versionId(9) }, expectedPreviousSubmissionId: null };
    await documentsPending.persist(scope, "submit", OLD_ITEM, stored as never);
    const t = await open({
      ready: answer(emptyItem(), documentState(0)),
      extra: { submit_application_document_v1: (args: Record<string, unknown> | undefined) => ({ ...submitReceipt(0, String(args?.p_request_id), versionId(9)), requirementsRevisionId: OLD_REVISION, requirementItemId: OLD_ITEM, documentSlotId: slotId(8) }) },
    });
    await screen.findByTestId(`prep-recover-submit-${OLD_ITEM}`);
    spoken.mockClear();
    await pressTwiceInOneTick(`prep-recover-submit-${OLD_ITEM}`);
    await waitFor(async () => expect(await storedKeys()).toEqual([]));
    expect(t.calls.filter((c) => c.name === "submit_application_document_v1")).toHaveLength(1);
    // второе нажатие не дошло до замка цели и не сказало «Не уверены, дошёл ли файл»
    expect(spoken.mock.calls.filter(([text]) => String(text).includes("Не уверены, дошёл ли файл"))).toHaveLength(0);
  });

  it("запись видимого требования внизу не дублируется: её доводит само требование", async () => {
    const stored = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requirementsRevisionId: REVISION_ID, requirementItemId: ITEM, requestId: REQUEST, selection: { kind: "program_upload", uploadContextId: uploadId(9), documentVersionId: versionId(9) }, expectedPreviousSubmissionId: null };
    await documentsPending.persist(scope, "submit", ITEM, stored as never);
    await open({ ready: answer(emptyItem(), documentState(0, { savedDraft: draftOf(0, 9) })) });
    await screen.findByTestId(`prep-submit-retained-${ITEM}`);
    expect(screen.queryByTestId("prep-recovery")).toBeNull();
  });

  it("испорченная запись внизу: «не удалось проверить незавершённое действие», ничего не стирается", async () => {
    const key = documentsPending.key(scope, "upload", OLD_ITEM);
    await AsyncStorage.setItem(key, "{bad");
    await open({ ready: answer(emptyItem(), documentState(0)) });
    const section = await screen.findByTestId("prep-recovery");
    expect(within(section).getByText("Не удалось проверить незавершённое действие на этом телефоне. Повторите попытку позже.")).toBeTruthy();
    expect(await AsyncStorage.getItem(key)).toBe("{bad");
  });

  it("записи другой программы и другого студента внизу не показываются", async () => {
    const other = { ...scope, applicationId: itemId(9) };
    const stored = { protocolVersion: 1, studentCaseId: STUDENT_CASE_ID, applicationId: itemId(9), requirementsRevisionId: OLD_REVISION, requirementItemId: OLD_ITEM, documentSlotId: slotId(8), requestId: REQUEST, file: { originalFilename: "x.pdf", declaredMimeType: "application/pdf", byteSize: "1", sha256Hex: "a".repeat(64) } };
    await documentsPending.persist(other, "upload", OLD_ITEM, stored as never);
    await open({ ready: answer(emptyItem(), documentState(0)) });
    await screen.findByTestId(`prep-document-${ITEM}`);
    expect(screen.queryByTestId("prep-recovery")).toBeNull();
  });
});
