// Загрузка и отправка файла к требованию программы через настоящий экран: лист выбора, замок, запись запроса до сети, одно
// нажатие, неоконченная загрузка и отправка. Сеть и устройство подменены (транспорт RPC, загрузка, выбор файла).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { AccessibilityInfo, Alert, Platform } from "react-native";

import { documentsPending } from "@/features/preparations/documents-pending";
import { PreparationScreen } from "@/features/preparations/PreparationScreen";
import {
  APPLICATION_ID,
  REVISION_ID,
  STUDENT_CASE_ID,
  documentState,
  draftOf,
  itemId,
  readiness,
  requirementItem,
  requirements,
  reviewOf,
  slotId,
  submissionOf,
  submitReceipt,
  uploadId,
  versionId,
} from "@/test-fixtures/preparations";
import { FILE_BYTES, FILE_DIGEST, OTHER_PICKED, PICKED, makeIo, receiptFor, type FakeIo } from "@/test-fixtures/preparations-io";
import { pressTwiceInOneTick } from "@/test-fixtures/press";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { settle, waitForDisabled, waitForEnabled } from "@/test-fixtures/settle";
import { failure, fakeTransport, preparationRow } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));

const announceNative = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;
const ITEM = itemId(0);
const REQUEST = "99999999-0000-4000-8000-000000000001";
const scope = { organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", membershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID };

type Raw = Record<string, unknown>;
/** Требование без файла и его состояние документа. */
const emptyItem = () => requirementItem(0);
/** Требование с отправленной версией `n`. */
const sentItem = (n: number, extra: Raw = {}) => requirementItem(0, { slotStatus: "submitted", currentVersionId: versionId(n), currentVersionNo: String(n), technicalAvailability: "available", unavailableReasons: [], ...extra });
const answer = (item: Raw, state: Raw) => readiness(requirements([item]), [state]);

/** Ошибка базы с кодом и текстом, как её отдаёт PostgREST: по тексту разборщики веба различают причины. */
type DbError = Readonly<{ code: string; message: string; status: number }>;

async function open(options: { ready: unknown; extra?: Record<string, unknown>; errors?: Record<string, DbError>; io?: FakeIo; lang?: "ru" | "ky" }) {
  const fake = options.io ?? makeIo();
  const inner = fakeTransport({
    student_catalog_preparations_v1: [preparationRow(1)],
    application_package_readiness_v1: options.ready,
    ...options.extra,
  });
  const calls = inner.calls;
  const transport: typeof inner.transport = async (name, args, opts) => {
    const error = options.errors?.[name];
    if (error) {
      calls.push({ name, args: args as Record<string, unknown> | undefined, get: opts.get });
      return { data: null, error: { code: error.code, message: error.message }, status: error.status };
    }
    return inner.transport(name, args, opts);
  };
  const view = await renderPortal(<PreparationScreen applicationId={APPLICATION_ID} io={fake.io} />, testApi(transport), options.lang ?? "ru");
  return { ...view, calls, fake };
}

async function chooseFile() {
  await fireEvent.press(await screen.findByTestId(`prep-upload-button-${ITEM}`));
  await fireEvent.press(await screen.findByTestId("pick-file"));
}
const storedKeys = async () => (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("evo.application-documents.v1:"));

let restore: () => void = () => undefined;
beforeEach(async () => {
  // Без iOS-задержки перед системным выбором файла: выбор начинается сразу после закрытия листа.
  const spy = jest.replaceProperty(Platform, "OS", "android");
  restore = () => spy.restore();
  await AsyncStorage.clear();
  announceNative.mockClear?.();
});
afterEach(() => restore());

describe("одно нажатие: загрузить и отправить на проверку", () => {
  it("видна кнопка и подсказка «сразу уйдёт на проверку»; файл ещё не загружен", async () => {
    await open({ ready: answer(emptyItem(), documentState(0)) });
    // подпись и подсказка «одним нажатием» появляются, когда прочитана запись отправки: ждём её, а не кнопку
    await waitFor(() => expect(screen.getByTestId(`prep-upload-button-${ITEM}`)).toHaveTextContent("Загрузить и отправить на проверку", { exact: false }));
    expect(screen.getByText("Файл сразу уйдёт на проверку EVO.")).toBeTruthy();
    expect(screen.getByText("PDF, JPG или PNG, до 25 МБ.")).toBeTruthy();
    expect(screen.getByTestId(`prep-document-${ITEM}`)).toHaveTextContent("Файл ещё не загружен", { exact: false });
    // кнопки отправки нет, пока нечего отправлять
    expect(screen.queryByTestId(`prep-submit-button-${ITEM}`)).toBeNull();
    // подсказка под списком про «два шага» здесь неверна (студенту можно отправлять), поэтому её нет
    expect(screen.queryByTestId("prep-page-hint")).toBeNull();
  });

  it("лист «файл, фото, камера», запись запроса, загрузка, отправка именно этой версии и подтверждение, переживающее обновление", async () => {
    const t = await open({
      ready: (_a: unknown, call: number) => (call === 1 ? answer(emptyItem(), documentState(0)) : answer(sentItem(7), documentState(0, { submission: submissionOf(0, 7, null), canSubmit: false }))),
      extra: { submit_application_document_v1: (args: Record<string, unknown> | undefined) => submitReceipt(0, String(args?.p_request_id), versionId(7)) },
    });
    await chooseFile();
    await waitFor(() => expect(t.fake.uploads).toHaveLength(1));
    expect(t.fake.io.pick).toHaveBeenCalledWith("file");
    const intent = t.fake.uploads[0]!;
    expect(intent).toMatchObject({ studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requirementsRevisionId: REVISION_ID, requirementItemId: ITEM, documentSlotId: slotId(0), file: { originalFilename: "справка.pdf", declaredMimeType: "application/pdf" } });
    await waitFor(() => expect(screen.getByTestId(`prep-document-notice-${ITEM}`)).toHaveTextContent("Документ отправлен на проверку EVO.", { exact: false }));
    const submit = t.calls.find((c) => c.name === "submit_application_document_v1");
    expect(submit?.args).toMatchObject({
      p_student_case_id: STUDENT_CASE_ID,
      p_application_id: APPLICATION_ID,
      p_requirements_revision_id: REVISION_ID,
      p_requirement_item_id: ITEM,
      p_selection: { kind: "program_upload", uploadContextId: uploadId(7), documentVersionId: versionId(7) },
      p_expected_previous_submission_id: null,
    });
    expect(String(submit?.args?.p_request_id)).toMatch(/^[0-9a-f-]{36}$/u);
    // после записи требования читаются заново и показывают отправленный документ
    expect(await screen.findByTestId(`prep-document-${ITEM}-submission`)).toHaveTextContent("scan-7.pdf", { exact: false });
    expect(t.calls.filter((c) => c.name === "application_package_readiness_v1").length).toBeGreaterThanOrEqual(2);
    // записанных запросов не осталось
    expect(await storedKeys()).toEqual([]);
    expect(announceNative).toHaveBeenCalledWith("Документ отправлен на проверку EVO.");
    // обновление после действия не перебивает итог вторым сообщением («Состояние документов обновлено»)
    expect(announceNative).not.toHaveBeenCalledWith("Состояние документов обновлено.");
  });

  it("пока идёт загрузка, кнопка заблокирована, подпись и ход загрузки видны", async () => {
    let release: (value: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const io = makeIo({ upload: async (intent) => (await gate, { ok: true, receipt: receiptFor(intent) as never }) });
    await open({ ready: answer(emptyItem(), documentState(0)), io, extra: { submit_application_document_v1: (a: Record<string, unknown> | undefined) => submitReceipt(0, String(a?.p_request_id), versionId(7)) } });
    await chooseFile();
    await waitFor(() => expect(screen.getByTestId(`prep-upload-button-${ITEM}`)).toHaveTextContent("Загружаем…", { exact: false }));
    expect(screen.getByTestId(`prep-upload-button-${ITEM}`).props.accessibilityState).toMatchObject({ disabled: true });
    expect(await screen.findByRole("progressbar", { name: "Загружено 50%" })).toBeTruthy();
    await act(async () => release(null));
    await waitFor(() => expect(screen.getByTestId(`prep-upload-button-${ITEM}`).props.accessibilityState).toMatchObject({ disabled: false }));
  });

  it("пока запись незавершённой загрузки не прочитана, кнопка не принимает нажатий", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Подмена вручную, не `jest.spyOn`: `mockRestore` у мока AsyncStorage стёр бы его собственную реализацию для остальных тестов.
    const original = AsyncStorage.getItem;
    AsyncStorage.getItem = (async (key: string) => {
      if (key.startsWith("evo.application-documents.v1:")) await gate;
      return original(key);
    }) as typeof AsyncStorage.getItem;
    try {
      await open({ ready: answer(emptyItem(), documentState(0)) });
      const button = await screen.findByTestId(`prep-upload-button-${ITEM}`);
      expect(button.props.accessibilityState).toMatchObject({ disabled: true });
      await act(async () => release());
      await waitFor(() => expect(screen.getByTestId(`prep-upload-button-${ITEM}`).props.accessibilityState).toMatchObject({ disabled: false }));
    } finally {
      AsyncStorage.getItem = original;
    }
  });

  it("обновление посреди отправки пересоздаёт форму, но второй загрузки не будет: «Отправляем…» и кнопка заблокирована", async () => {
    let release: (value: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const io = makeIo({ upload: async (intent) => (await gate, { ok: true, receipt: receiptFor(intent) as never }) });
    const t = await open({
      // со второго чтения у требования появляется сохранённый файл: снимок изменился, форма пересоздаётся
      ready: (_a: unknown, call: number) => (call === 1 ? answer(emptyItem(), documentState(0)) : answer(emptyItem(), documentState(0, { savedDraft: draftOf(0, 4) }))),
      extra: { submit_application_document_v1: (a: Record<string, unknown> | undefined) => submitReceipt(0, String(a?.p_request_id), versionId(7)) },
      io,
    });
    await chooseFile();
    await waitFor(() => expect(t.fake.uploads).toHaveLength(1));
    await fireEvent.press(screen.getByTestId("prep-check"));
    await waitFor(() => expect(screen.getByTestId(`prep-document-${ITEM}-draft`)).toBeTruthy());
    const button = screen.getByTestId(`prep-upload-button-${ITEM}`);
    expect(button).toHaveTextContent("Отправляем…", { exact: false });
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => release(null));
    await waitFor(() => expect(t.calls.some((c) => c.name === "submit_application_document_v1")).toBe(true));
    expect(t.fake.uploads).toHaveLength(1);
  });

  it("сервер сказал «не записано»: сообщение, запрос снят, повторить можно с любым файлом", async () => {
    const io = makeIo({ upload: () => ({ ok: false, reason: "file_too_large", resolution: "not_written" }) });
    await open({ ready: answer(emptyItem(), documentState(0)), io });
    await chooseFile();
    expect(await screen.findByTestId(`prep-upload-message-${ITEM}`)).toHaveTextContent("Выберите PDF, JPG или PNG размером до 25 МБ.", { exact: false });
    expect(await storedKeys()).toEqual([]);
    expect(announceNative).toHaveBeenCalledWith("Выберите PDF, JPG или PNG размером до 25 МБ.");
  });

  it("исход загрузки неизвестен: запрос остаётся, кнопка «Проверить результат», тот же файл повторяет тот же запрос и доходит до отправки", async () => {
    let attempt = 0;
    const io = makeIo({ upload: (intent) => (++attempt === 1 ? { ok: false, reason: "unavailable", resolution: "retain" } : { ok: true, receipt: receiptFor(intent) as never }) });
    const t = await open({
      ready: (_a: unknown, call: number) => (call <= 2 ? answer(emptyItem(), documentState(0)) : answer(sentItem(7), documentState(0, { submission: submissionOf(0, 7, null), canSubmit: false }))),
      extra: { submit_application_document_v1: (args: Record<string, unknown> | undefined) => submitReceipt(0, String(args?.p_request_id), versionId(7)) },
      io,
    });
    await chooseFile();
    expect(await screen.findByTestId(`prep-upload-message-${ITEM}`)).toHaveTextContent("Не удалось получить результат", { exact: false });
    const [key] = await storedKeys();
    expect(key).toBeTruthy();
    // форма просит выбрать тот же файл ещё раз и называет файл
    await waitFor(() => expect(screen.getByTestId(`prep-upload-button-${ITEM}`)).toHaveTextContent("Проверить результат", { exact: false }));
    expect(screen.getByText("Чтобы проверить сохранение, выберите тот же файл ещё раз.")).toBeTruthy();
    expect(screen.getByTestId(`prep-upload-retained-${ITEM}`)).toHaveTextContent("справка.pdf", { exact: false });
    await chooseFile();
    await waitFor(() => expect(t.fake.uploads).toHaveLength(2));
    expect(t.fake.uploads[1]!.requestId).toBe(t.fake.uploads[0]!.requestId);
    await waitFor(() => expect(t.calls.some((c) => c.name === "submit_application_document_v1")).toBe(true));
    await waitFor(async () => expect(await storedKeys()).toEqual([]));
  });

  it("при неоконченной загрузке другой файл не принимается: «Это другой файл», загрузки нет", async () => {
    const io = makeIo({ upload: () => ({ ok: false, reason: "unavailable", resolution: "retain" }), picks: [OTHER_PICKED] });
    // первая попытка с тем же файлом оставляет запрос; вторая выбирает другой
    const first = makeIo({ upload: () => ({ ok: false, reason: "unavailable", resolution: "retain" }) });
    const t = await open({ ready: answer(emptyItem(), documentState(0)), io: first });
    await chooseFile();
    await screen.findByText("Не удалось получить результат. Повторите сохранённый запрос.");
    (first.io.pick as jest.Mock).mockImplementationOnce(io.io.pick as never);
    await chooseFile();
    expect(await screen.findByText("Это другой файл. Выберите файл из незавершённой загрузки.")).toBeTruthy();
    expect(t.fake.uploads).toHaveLength(1);
  });

  it("файл сохранён, а отправка отклонена: файл остаётся, сообщение объясняет причину, отправка кнопкой остаётся", async () => {
    const t = await open({
      ready: (_a: unknown, call: number) => (call === 1 ? answer(emptyItem(), documentState(0)) : answer(emptyItem(), documentState(0, { savedDraft: draftOf(0, 7) }))),
      errors: { submit_application_document_v1: { code: "PT409", message: "application_document_stale_requirements", status: 409 } },
    });
    await chooseFile();
    const notice = await screen.findByTestId(`prep-document-notice-${ITEM}`);
    expect(notice).toHaveTextContent("Файл сохранён, но не отправлен. Требования или документ изменились.", { exact: false });
    expect(await screen.findByTestId(`prep-document-${ITEM}-draft`)).toHaveTextContent("scan-7.pdf", { exact: false });
    // обычная кнопка «Отправить на проверку» может закончить дело
    expect(screen.getByTestId(`prep-submit-button-${ITEM}`)).toHaveTextContent("Отправить на проверку", { exact: false });
    expect(await storedKeys()).toEqual([]);
    expect(t.fake.uploads).toHaveLength(1);
  });

  it("студенту нельзя отправлять: «Сохранить файл», подсказка про два шага, запрос отправки не пишется", async () => {
    const t = await open({ ready: answer(emptyItem(), documentState(0, { canSubmit: false })) });
    expect(await screen.findByTestId(`prep-upload-button-${ITEM}`)).toHaveTextContent("Сохранить файл", { exact: false });
    expect(screen.getAllByText("После сохранения отправьте файл на проверку отдельной кнопкой.").length).toBeGreaterThanOrEqual(1);
    await chooseFile();
    await waitFor(() => expect(t.fake.uploads).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId(`prep-upload-message-${ITEM}`)).toHaveTextContent("Файл сохранён. Теперь его можно отправить на проверку.", { exact: false }));
    expect(t.calls.some((c) => c.name === "submit_application_document_v1")).toBe(false);
    // подсказка под списком про два шага: верна для каждого документа, куда можно загружать
    expect(screen.getByTestId("prep-page-hint")).toHaveTextContent("После сохранения отправьте файл", { exact: false });
  });

  it("загрузка закрыта (canUpload=false): кнопки загрузки нет", async () => {
    await open({ ready: answer(sentItem(1), documentState(0, { submission: submissionOf(0, 1, reviewOf(1, "approved")), canUpload: false, canSubmit: false })) });
    await screen.findByTestId(`prep-document-${ITEM}-submission`);
    expect(screen.queryByTestId(`prep-upload-button-${ITEM}`)).toBeNull();
  });

  it("после отказа выбора камеры: понятное сообщение; загрузки нет", async () => {
    const io = makeIo({ over: { pick: jest.fn(async () => ({ kind: "denied" as const, canAskAgain: false })) } });
    const t = await open({ ready: answer(emptyItem(), documentState(0)), io });
    await fireEvent.press(await screen.findByTestId(`prep-upload-button-${ITEM}`));
    await fireEvent.press(await screen.findByTestId("pick-camera"));
    expect(await screen.findByTestId(`prep-pick-notice-${ITEM}`)).toHaveTextContent("Нет доступа к камере.", { exact: false });
    expect(screen.getByText("Открыть настройки")).toBeTruthy();
    expect(t.fake.uploads).toHaveLength(0);
    // «alert» без объявления на iPhone молчит
    expect(announceNative).toHaveBeenCalledWith(expect.stringContaining("Нет доступа к камере."));
  });

  it("выбор файла не удался: сообщение", async () => {
    const io = makeIo({ over: { pick: jest.fn(async () => ({ kind: "failed" as const })) } });
    await open({ ready: answer(emptyItem(), documentState(0)), io });
    await chooseFile();
    expect(await screen.findByTestId(`prep-pick-notice-${ITEM}`)).toHaveTextContent("Не удалось получить файл.", { exact: false });
    expect(announceNative).toHaveBeenCalledWith(expect.stringContaining("Не удалось получить файл."));
  });

  it("неподходящий файл (HEIC): не уходит на сервер, сообщение о формате, запрос не записан", async () => {
    const io = makeIo({ picks: [{ uri: "file:///c/a.heic", name: "a.heic", size: 10, mimeType: "image/heic", source: "photo" }] });
    const t = await open({ ready: answer(emptyItem(), documentState(0)), io });
    await chooseFile();
    expect(await screen.findByTestId(`prep-upload-message-${ITEM}`)).toHaveTextContent("Выберите PDF, JPG или PNG размером до 25 МБ.", { exact: false });
    expect(t.fake.uploads).toHaveLength(0);
    expect(await storedKeys()).toEqual([]);
  });
});

describe("устаревший вид: чтение не удалось, прежний ответ остался на экране", () => {
  const withDraft = () => answer(emptyItem(), documentState(0, { savedDraft: draftOf(0, 9) }));
  /** Первое чтение удаётся, второе (потянуть вниз) нет, третье (повтор в пометке) снова удаётся. */
  const staleScreen = (extra: Record<string, unknown> = {}) => open({ ready: (_a: unknown, call: number) => (call === 2 ? failure("PT500", 500) : withDraft()), extra });
  const goStale = async () => {
    await screen.findByTestId(`prep-submit-button-${ITEM}`);
    await act(async () => {
      await screen.getByTestId("screen-scroll").props.refreshControl.props.onRefresh();
    });
    return screen.findByTestId("prep-requirements-stale");
  };

  it("новая загрузка и отправка закрыты (форма и кнопка убраны, «Отправить на проверку» выключена); «Повторить» в пометке возвращает их", async () => {
    await staleScreen();
    await screen.findByTestId(`prep-upload-button-${ITEM}`);
    expect(screen.getByText("Загрузить другой файл")).toBeTruthy();
    await waitForEnabled(`prep-submit-button-${ITEM}`);
    const banner = await goStale();
    expect(screen.queryByTestId(`prep-upload-button-${ITEM}`)).toBeNull();
    expect(screen.queryByText("Загрузить и отправить на проверку")).toBeNull();
    // и заголовок с подсказкой убраны вместе с кнопкой: «Загрузить другой файл» без кнопки под ним читалось бы как обрыв
    expect(screen.queryByText("Загрузить другой файл")).toBeNull();
    expect(screen.getByTestId(`prep-submit-button-${ITEM}`).props.accessibilityState).toMatchObject({ disabled: true });
    // сам файл и скачивание остаются: читать прежний ответ можно
    expect(screen.getByTestId(`prep-document-${ITEM}-draft-file`)).toBeTruthy();
    await fireEvent.press(within(banner).getByText("Повторить"));
    expect(await screen.findByTestId(`prep-upload-button-${ITEM}`)).toBeTruthy();
    await waitForEnabled(`prep-submit-button-${ITEM}`);
    expect(screen.queryByTestId("prep-requirements-stale")).toBeNull();
  });

  it("неоконченная отправка из прошлого запуска на устаревшем виде доводится: «Проверить результат» нажимается", async () => {
    const stored = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requirementsRevisionId: REVISION_ID, requirementItemId: ITEM, requestId: REQUEST, selection: { kind: "program_upload", uploadContextId: uploadId(9), documentVersionId: versionId(9) }, expectedPreviousSubmissionId: null };
    await documentsPending.persist(scope, "submit", ITEM, stored as never);
    const t = await staleScreen({ submit_application_document_v1: (args: Record<string, unknown> | undefined) => submitReceipt(0, String(args?.p_request_id), versionId(9)) });
    await goStale();
    // «Проверить результат» и включённая кнопка появляются, когда прочитана запись отправки
    await waitFor(() => expect(screen.getByTestId(`prep-submit-button-${ITEM}`)).toHaveTextContent("Проверить результат", { exact: false }));
    await waitForEnabled(`prep-submit-button-${ITEM}`);
    await fireEvent.press(screen.getByTestId(`prep-submit-button-${ITEM}`));
    await waitFor(() => expect(t.calls.some((c) => c.name === "submit_application_document_v1")).toBe(true));
    expect(t.calls.find((c) => c.name === "submit_application_document_v1")!.args).toMatchObject({ p_request_id: REQUEST });
  });
});

describe("замки: два нажатия раньше, чем кнопка выключилась", () => {
  const saved = () =>
    open({
      ready: (_a: unknown, call: number) => (call === 1 ? answer(emptyItem(), documentState(0, { savedDraft: draftOf(0, 9) })) : answer(sentItem(9), documentState(0, { submission: submissionOf(0, 9, null), canSubmit: false }))),
      extra: { submit_application_document_v1: (args: Record<string, unknown> | undefined) => submitReceipt(0, String(args?.p_request_id), versionId(9)) },
    });

  it("«Отправить на проверку»: запрос отправки уходит один раз и один раз озвучивается итог", async () => {
    const t = await saved();
    await waitForEnabled(`prep-submit-button-${ITEM}`);
    announceNative.mockClear();
    await pressTwiceInOneTick(`prep-submit-button-${ITEM}`);
    await waitFor(() => expect(screen.getByTestId(`prep-document-notice-${ITEM}`)).toHaveTextContent("Документ отправлен на проверку EVO.", { exact: false }));
    expect(t.calls.filter((c) => c.name === "submit_application_document_v1")).toHaveLength(1);
    // второе нажатие не успело сказать «ещё не подтверждено» и не заняло замок цели
    expect(announceNative.mock.calls.filter(([text]) => String(text).includes("Не уверены, дошёл ли файл"))).toHaveLength(0);
    expect(await storedKeys()).toEqual([]);
  });

  it("«Проверить результат» оборванной отправки: запрос повторяется один раз", async () => {
    const stored = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requirementsRevisionId: REVISION_ID, requirementItemId: ITEM, requestId: REQUEST, selection: { kind: "program_upload", uploadContextId: uploadId(9), documentVersionId: versionId(9) }, expectedPreviousSubmissionId: null };
    await documentsPending.persist(scope, "submit", ITEM, stored as never);
    const t = await saved();
    await screen.findByTestId(`prep-submit-retained-${ITEM}`);
    await waitForEnabled(`prep-submit-button-${ITEM}`);
    announceNative.mockClear();
    await pressTwiceInOneTick(`prep-submit-button-${ITEM}`);
    await waitFor(async () => expect(await storedKeys()).toEqual([]));
    expect(t.calls.filter((c) => c.name === "submit_application_document_v1")).toHaveLength(1);
    expect(announceNative.mock.calls.filter(([text]) => String(text).includes("Не уверены, дошёл ли файл"))).toHaveLength(0);
  });
});

describe("отправка сохранённого файла и неоконченная отправка", () => {
  it("сохранённый файл: кнопка «Отправить на проверку» отправляет именно его, прежнюю отправку называет в запросе", async () => {
    const item = sentItem(1);
    const state = (extra: Raw) => documentState(0, { submission: submissionOf(0, 1, reviewOf(1, "correction_required", "Скан обрезан.")), savedDraft: draftOf(0, 9), ...extra });
    const t = await open({
      ready: (_a: unknown, call: number) => (call === 1 ? answer(item, state({})) : answer(sentItem(9), documentState(0, { submission: submissionOf(0, 9, null), canSubmit: false }))),
      extra: { submit_application_document_v1: (args: Record<string, unknown> | undefined) => submitReceipt(0, String(args?.p_request_id), versionId(9)) },
    });
    // решение «нужно исправить» меняет подпись загрузки
    expect(await screen.findByText("Загрузить исправленный файл")).toBeTruthy();
    await waitForEnabled(`prep-submit-button-${ITEM}`);
    await fireEvent.press(screen.getByTestId(`prep-submit-button-${ITEM}`));
    await waitFor(() => expect(t.calls.some((c) => c.name === "submit_application_document_v1")).toBe(true));
    const submit = t.calls.find((c) => c.name === "submit_application_document_v1")!;
    expect(submit.args).toMatchObject({
      p_selection: { kind: "program_upload", uploadContextId: uploadId(9), documentVersionId: versionId(9) },
      p_expected_previous_submission_id: "33333333-0000-4000-8000-000000000001",
    });
    await waitFor(() => expect(screen.getByTestId(`prep-document-notice-${ITEM}`)).toHaveTextContent("Документ отправлен на проверку EVO.", { exact: false }));
    expect(await storedKeys()).toEqual([]);
  });

  it("файл ещё проверяется (недоступен): кнопка отправки заблокирована", async () => {
    const draft = draftOf(0, 9, { technicalAvailability: "unavailable", unavailableReasons: ["malware_pending"] });
    await open({ ready: answer(emptyItem(), documentState(0, { savedDraft: draft })) });
    const button = await screen.findByTestId(`prep-submit-button-${ITEM}`);
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText("Файл проходит проверку безопасности.")).toBeTruthy();
  });

  it("неоконченная отправка из прошлого запуска: «Проверить результат» повторяет ТОТ ЖЕ запрос, а загрузка становится двухшаговой", async () => {
    const stored = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requirementsRevisionId: REVISION_ID, requirementItemId: ITEM, requestId: REQUEST, selection: { kind: "program_upload", uploadContextId: uploadId(9), documentVersionId: versionId(9) }, expectedPreviousSubmissionId: null };
    await documentsPending.persist(scope, "submit", ITEM, stored as never);
    const t = await open({
      ready: (_a: unknown, call: number) => (call === 1 ? answer(emptyItem(), documentState(0, { savedDraft: draftOf(0, 9) })) : answer(sentItem(9), documentState(0, { submission: submissionOf(0, 9, null), canSubmit: false }))),
      extra: { submit_application_document_v1: (args: Record<string, unknown> | undefined) => submitReceipt(0, String(args?.p_request_id), versionId(9)) },
    });
    // запись отправки читается в фоне: всё, что от неё зависит, ждём по условию
    expect(await screen.findByTestId(`prep-submit-retained-${ITEM}`)).toHaveTextContent("Не уверены, дошёл ли файл", { exact: false });
    await waitFor(() => expect(screen.getByTestId(`prep-submit-button-${ITEM}`)).toHaveTextContent("Проверить результат", { exact: false }));
    // пока запрос не доведён, загрузка новым файлом не отправляет его сама
    await waitFor(() => expect(screen.getByTestId(`prep-upload-button-${ITEM}`)).toHaveTextContent("Сохранить файл", { exact: false }));
    await waitForEnabled(`prep-submit-button-${ITEM}`);
    await fireEvent.press(screen.getByTestId(`prep-submit-button-${ITEM}`));
    await waitFor(() => expect(t.calls.some((c) => c.name === "submit_application_document_v1")).toBe(true));
    expect(t.calls.find((c) => c.name === "submit_application_document_v1")!.args).toMatchObject({ p_request_id: REQUEST, p_selection: stored.selection });
    await waitFor(async () => expect(await storedKeys()).toEqual([]));
  });

  it("исход отправки неизвестен: запрос остаётся и кнопка становится «Проверить результат»", async () => {
    const t = await open({
      ready: answer(emptyItem(), documentState(0, { savedDraft: draftOf(0, 9) })),
      errors: { submit_application_document_v1: { code: "PT500", message: "", status: 500 } },
    });
    await waitForEnabled(`prep-submit-button-${ITEM}`);
    await fireEvent.press(screen.getByTestId(`prep-submit-button-${ITEM}`));
    expect(await screen.findByTestId(`prep-submit-message-${ITEM}`)).toHaveTextContent("Не удалось получить результат", { exact: false });
    expect((await storedKeys()).length).toBe(1);
    await waitFor(() => expect(screen.getByTestId(`prep-submit-button-${ITEM}`)).toHaveTextContent("Проверить результат", { exact: false }));
    expect(t.calls.filter((c) => c.name === "submit_application_document_v1")).toHaveLength(1);
  });

  it("хранилище запросов испорчено: кнопки заблокированы, сказано словами", async () => {
    await AsyncStorage.setItem(documentsPending.key(scope, "upload", ITEM), "{bad");
    await open({ ready: answer(emptyItem(), documentState(0)) });
    // Ждём состояние, а не его соседа: текст об испорченной записи появляется и в разделе восстановления раньше, чем загрузится
    // список требований, а до чтения записи кнопка выключена по другой причине (проверка «до чтения» прошла бы и без блокировки).
    expect(await screen.findByTestId(`prep-upload-unreadable-${ITEM}`)).toHaveTextContent("повторять попытку бессмысленно", { exact: false });
    await waitForDisabled(`prep-upload-button-${ITEM}`);
  });
});

describe("файл не прочитался и сбой до отправки", () => {
  it("файл исчез или не открылся: «Не удалось прочитать файл. Выберите его ещё раз.», а не «Выберите PDF…»; запись не создана", async () => {
    const io = makeIo({
      over: {
        fingerprint: async () => {
          throw new Error("file vanished");
        },
      },
    });
    const t = await open({ ready: answer(emptyItem(), documentState(0)), io });
    await chooseFile();
    const message = await screen.findByTestId(`prep-upload-message-${ITEM}`);
    expect(message).toHaveTextContent("Не удалось прочитать файл. Выберите его ещё раз.", { exact: false });
    expect(message).not.toHaveTextContent("Выберите PDF");
    expect(t.fake.uploads).toHaveLength(0);
    expect(await storedKeys()).toEqual([]);
    expect(announceNative).toHaveBeenCalledWith("Не удалось прочитать файл. Выберите его ещё раз.");
  });

  it("сбой до отправки (нет сессии, файл не скопировался): «Файл не сохранён…», запись снята, ждать «тот же файл» не нужно", async () => {
    const io = makeIo({ upload: () => ({ ok: false, reason: "not_sent", resolution: "not_written" }) });
    await open({ ready: answer(emptyItem(), documentState(0)), io });
    await chooseFile();
    expect(await screen.findByTestId(`prep-upload-message-${ITEM}`)).toHaveTextContent("Файл не сохранён. Проверьте формат и соединение", { exact: false });
    expect(await storedKeys()).toEqual([]);
    await settle();
    expect(screen.queryByTestId(`prep-upload-retained-${ITEM}`)).toBeNull();
    expect(screen.getByTestId(`prep-upload-button-${ITEM}`)).not.toHaveTextContent("Проверить результат");
    expect(screen.queryByTestId(`prep-discard-upload-${ITEM}`)).toBeNull();
  });
});

describe("два ответа выбора файла в одном кадре", () => {
  it("загрузка идёт одна; второй ответ остановлен раньше замка и не говорит «Не уверены, дошёл ли файл»", async () => {
    const fingerprint = jest.fn(async () => ({ byteSize: FILE_BYTES.byteLength, sha256Hex: FILE_DIGEST }));
    const t = await open({ ready: answer(emptyItem(), documentState(0, { canSubmit: false })), io: makeIo({ over: { fingerprint } }) });
    await waitForEnabled(`prep-upload-button-${ITEM}`);
    await fireEvent.press(screen.getByTestId(`prep-upload-button-${ITEM}`));
    announceNative.mockClear();
    await pressTwiceInOneTick("pick-file");
    await waitFor(() => expect(screen.getByTestId(`prep-upload-message-${ITEM}`)).toHaveTextContent("Файл сохранён", { exact: false }));
    await settle();
    // выбор файла запускался дважды (защита стоит не в нём), а читался и загружался файл один раз
    expect(t.fake.io.pick).toHaveBeenCalledTimes(2);
    expect(fingerprint).toHaveBeenCalledTimes(1);
    expect(t.fake.uploads).toHaveLength(1);
    expect(announceNative.mock.calls.filter(([text]) => String(text).includes("Не уверены, дошёл ли файл"))).toHaveLength(0);
  });
});

describe("отказ от незавершённого действия", () => {
  type AlertButton = { text?: string; style?: string; onPress?: () => void };
  let alert: jest.SpyInstance;
  beforeEach(() => {
    alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });
  afterEach(() => alert.mockRestore());

  const upload = (over: Raw = {}) => ({
    protocolVersion: 1,
    studentCaseId: STUDENT_CASE_ID,
    applicationId: APPLICATION_ID,
    requirementsRevisionId: REVISION_ID,
    requirementItemId: ITEM,
    documentSlotId: slotId(0),
    requestId: REQUEST,
    file: { originalFilename: "справка.pdf", declaredMimeType: "application/pdf", byteSize: String(FILE_BYTES.byteLength), sha256Hex: FILE_DIGEST },
    ...over,
  });
  const submit = (over: Raw = {}) => ({
    studentCaseId: STUDENT_CASE_ID,
    applicationId: APPLICATION_ID,
    requirementsRevisionId: REVISION_ID,
    requirementItemId: ITEM,
    requestId: REQUEST,
    selection: { kind: "program_upload", uploadContextId: uploadId(9), documentVersionId: versionId(9) },
    expectedPreviousSubmissionId: null,
    ...over,
  });
  const lastAlert = () => ({ title: String(alert.mock.lastCall![0]), body: String(alert.mock.lastCall![1]), buttons: alert.mock.lastCall![2] as AlertButton[] });
  /** Нажать кнопку отказа и ответить в окне подтверждения. */
  async function discard(testID: string, answerText: "Отказаться" | "Оставить") {
    await fireEvent.press(await screen.findByTestId(testID));
    const answerButton = lastAlert().buttons.find((button) => button.text === answerText)!;
    await act(async () => answerButton.onPress?.());
  }

  it("исход загрузки неизвестен: «Оставить» ничего не меняет, «Отказаться» снимает запись, и форма снова принимает любой файл", async () => {
    let attempt = 0;
    const io = makeIo({ picks: [PICKED, OTHER_PICKED], upload: (intent) => (++attempt === 1 ? { ok: false, reason: "unavailable", resolution: "retain" } : { ok: true, receipt: receiptFor(intent) as never }) });
    const t = await open({ ready: answer(emptyItem(), documentState(0, { canSubmit: false })), io });
    await chooseFile();
    expect(await screen.findByTestId(`prep-upload-message-${ITEM}`)).toHaveTextContent("Не удалось получить результат", { exact: false });
    const button = await screen.findByTestId(`prep-discard-upload-${ITEM}`);
    expect(button).toHaveTextContent("Отказаться от незавершённой загрузки");
    expect(button).toHaveStyle({ minHeight: 44 });

    await discard(`prep-discard-upload-${ITEM}`, "Оставить");
    // честный текст окна: если файл уже дошёл, новая отправка может добавить версию (ничего сверх этого не обещано)
    const { title, body, buttons } = lastAlert();
    expect(title).toBe("Отказаться от незавершённого действия?");
    expect(body).toContain("Если файл уже дошёл до EVO, новая отправка может добавить в список ещё одну версию.");
    expect(buttons.map((b) => [b.text, b.style])).toEqual([["Оставить", "cancel"], ["Отказаться", "destructive"]]);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(await storedKeys()).toHaveLength(1);
    expect(screen.getByTestId(`prep-discard-upload-${ITEM}`)).toBeTruthy();

    await discard(`prep-discard-upload-${ITEM}`, "Отказаться");
    await waitFor(async () => expect(await storedKeys()).toEqual([]));
    await waitFor(() => expect(screen.queryByTestId(`prep-discard-upload-${ITEM}`)).toBeNull());
    expect(screen.getByTestId(`prep-upload-message-${ITEM}`)).toHaveTextContent("Незавершённое действие снято с этого телефона.", { exact: false });
    expect(announceNative).toHaveBeenCalledWith("Незавершённое действие снято с этого телефона.");
    await waitFor(() => expect(screen.getByTestId(`prep-upload-button-${ITEM}`)).toHaveTextContent("Сохранить файл", { exact: false }));
    expect(screen.queryByTestId(`prep-upload-retained-${ITEM}`)).toBeNull();

    // теперь принимается другой файл: новый запрос под новым номером
    await chooseFile();
    await waitFor(() => expect(t.fake.uploads).toHaveLength(2));
    expect(t.fake.uploads[1]!.requestId).not.toBe(t.fake.uploads[0]!.requestId);
    expect(t.fake.uploads[1]!.file.originalFilename).toBe("другой.pdf");
    await waitFor(() => expect(screen.getByTestId(`prep-upload-message-${ITEM}`)).toHaveTextContent("Файл сохранён.", { exact: false }));
  });

  it("снимается только запись загрузки этого требования: другое требование и запись отправки этого же требования целы", async () => {
    const OLD_ITEM = itemId(8);
    await documentsPending.persist(scope, "upload", ITEM, upload() as never);
    await documentsPending.persist(scope, "submit", ITEM, submit() as never);
    await documentsPending.persist(scope, "upload", OLD_ITEM, upload({ requirementItemId: OLD_ITEM, documentSlotId: slotId(8) }) as never);
    await open({ ready: answer(emptyItem(), documentState(0)) });
    await discard(`prep-discard-upload-${ITEM}`, "Отказаться");
    await waitFor(async () => expect((await storedKeys()).sort()).toEqual([documentsPending.key(scope, "submit", ITEM), documentsPending.key(scope, "upload", OLD_ITEM)].sort()));
  });

  it("испорченная запись загрузки: сказано, что повторять бессмысленно; после отказа форма снова рабочая", async () => {
    const key = documentsPending.key(scope, "upload", ITEM);
    await AsyncStorage.setItem(key, "{bad");
    const t = await open({ ready: answer(emptyItem(), documentState(0, { canSubmit: false })) });
    expect(await screen.findByTestId(`prep-upload-unreadable-${ITEM}`)).toHaveTextContent("Запись о незавершённом действии на этом телефоне не читается, повторять попытку бессмысленно.", { exact: false });
    await waitForDisabled(`prep-upload-button-${ITEM}`);
    // испорченная запись не стирается втихую: до отказа она на месте
    expect(await AsyncStorage.getItem(key)).toBe("{bad");
    await discard(`prep-discard-upload-${ITEM}`, "Отказаться");
    await waitFor(async () => expect(await AsyncStorage.getItem(key)).toBeNull());
    await waitFor(() => expect(screen.queryByTestId(`prep-upload-unreadable-${ITEM}`)).toBeNull());
    await waitForEnabled(`prep-upload-button-${ITEM}`);
    await chooseFile();
    await waitFor(() => expect(t.fake.uploads).toHaveLength(1));
  });

  it("испорченная запись отправки: сказано словами, после отказа кнопка «Отправить на проверку» работает", async () => {
    const key = documentsPending.key(scope, "submit", ITEM);
    await AsyncStorage.setItem(key, "{bad");
    const t = await open({
      ready: (_a: unknown, call: number) => (call === 1 ? answer(emptyItem(), documentState(0, { savedDraft: draftOf(0, 9) })) : answer(sentItem(9), documentState(0, { submission: submissionOf(0, 9, null), canSubmit: false }))),
      extra: { submit_application_document_v1: (args: Record<string, unknown> | undefined) => submitReceipt(0, String(args?.p_request_id), versionId(9)) },
    });
    expect(await screen.findByTestId(`prep-submit-unreadable-${ITEM}`)).toHaveTextContent("повторять попытку бессмысленно", { exact: false });
    await waitForDisabled(`prep-submit-button-${ITEM}`);
    expect(screen.getByTestId(`prep-discard-submit-${ITEM}`)).toHaveTextContent("Отказаться от незавершённой отправки");
    await discard(`prep-discard-submit-${ITEM}`, "Отказаться");
    expect(lastAlert().body).toContain("обновите список документов");
    await waitFor(async () => expect(await AsyncStorage.getItem(key)).toBeNull());
    await waitForEnabled(`prep-submit-button-${ITEM}`);
    await fireEvent.press(screen.getByTestId(`prep-submit-button-${ITEM}`));
    await waitFor(() => expect(t.calls.some((c) => c.name === "submit_application_document_v1")).toBe(true));
  });

  it("хранилище не удаляет: сказано словами, запись на месте, кнопка остаётся", async () => {
    const key = documentsPending.key(scope, "upload", ITEM);
    await documentsPending.persist(scope, "upload", ITEM, upload() as never);
    await open({ ready: answer(emptyItem(), documentState(0)) });
    const original = AsyncStorage.removeItem;
    AsyncStorage.removeItem = (async () => {
      throw new Error("disk");
    }) as typeof AsyncStorage.removeItem;
    try {
      await discard(`prep-discard-upload-${ITEM}`, "Отказаться");
      expect(await screen.findByTestId(`prep-discard-upload-${ITEM}-error`)).toHaveTextContent("Повторите попытку позже", { exact: false });
      expect(announceNative).toHaveBeenCalledWith(expect.stringContaining("Повторите попытку позже"));
    } finally {
      AsyncStorage.removeItem = original;
    }
    expect(await AsyncStorage.getItem(key)).not.toBeNull();
    expect(screen.getByTestId(`prep-discard-upload-${ITEM}`)).toBeTruthy();
  });

  it("пока идёт повторная проверка загрузки, кнопки отказа нет", async () => {
    let release: (value: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await documentsPending.persist(scope, "upload", ITEM, upload() as never);
    const io = makeIo({ upload: async (intent) => (await gate, { ok: true, receipt: receiptFor(intent) as never }) });
    const t = await open({ ready: answer(emptyItem(), documentState(0, { canSubmit: false })), io });
    await screen.findByTestId(`prep-discard-upload-${ITEM}`);
    await chooseFile();
    await waitFor(() => expect(t.fake.uploads).toHaveLength(1));
    expect(screen.queryByTestId(`prep-discard-upload-${ITEM}`)).toBeNull();
    await act(async () => release(null));
    await waitFor(async () => expect(await storedKeys()).toEqual([]));
  });

  it("кыргызский язык: кнопка и окно написаны по-кыргызски", async () => {
    await documentsPending.persist(scope, "upload", ITEM, upload() as never);
    await open({ ready: answer(emptyItem(), documentState(0)), lang: "ky" });
    await fireEvent.press(await screen.findByTestId(`prep-discard-upload-${ITEM}`));
    expect(screen.getByTestId(`prep-discard-upload-${ITEM}`)).toHaveTextContent("Бүтпөгөн жүктөөдөн баш тартуу");
    expect(lastAlert().title).toBe("Бүтпөгөн аракеттен баш тартасызбы?");
  });

  it("запись загрузки и запись отправки сразу: две «Проверить результат» называются по-разному для читалки", async () => {
    await documentsPending.persist(scope, "upload", ITEM, upload() as never);
    await documentsPending.persist(scope, "submit", ITEM, submit() as never);
    await open({ ready: answer(emptyItem(), documentState(0, { savedDraft: draftOf(0, 9) })) });
    const forUpload = await screen.findByRole("button", { name: "Проверить результат: загрузка файла" });
    const forSubmit = await screen.findByRole("button", { name: "Проверить результат: отправка на проверку" });
    expect(forUpload).toHaveTextContent("Проверить результат");
    expect(forSubmit).toHaveTextContent("Проверить результат");
    expect(forUpload).toBe(screen.getByTestId(`prep-upload-button-${ITEM}`));
    expect(forSubmit).toBe(screen.getByTestId(`prep-submit-button-${ITEM}`));
  });
});

describe("после успешной отправки чтение не удалось", () => {
  const SENT = "Документ отправлен на проверку EVO.";
  const STALE = "Не удалось обновить. Показаны последние полученные данные.";
  const queued = AccessibilityInfo.announceForAccessibilityWithOptions as unknown as jest.Mock;
  /** Сохранённый файл отправляется, а обновление после отправки (второе чтение) не удаётся. */
  async function sendThenFailToRefresh() {
    const t = await open({
      ready: (_a: unknown, call: number) => (call === 1 ? answer(emptyItem(), documentState(0, { savedDraft: draftOf(0, 9) })) : failure("PT500", 500)),
      extra: { submit_application_document_v1: (args: Record<string, unknown> | undefined) => submitReceipt(0, String(args?.p_request_id), versionId(9)) },
    });
    await waitForEnabled(`prep-submit-button-${ITEM}`);
    announceNative.mockClear();
    queued.mockClear();
    await fireEvent.press(screen.getByTestId(`prep-submit-button-${ITEM}`));
    await screen.findByTestId("prep-requirements-stale");
    return t;
  }

  it("подтверждение «отправлено» остаётся на экране рядом с пометкой «Не удалось обновить»; читалке сначала итог, потом пометка", async () => {
    await sendThenFailToRefresh();
    expect(screen.getByTestId(`prep-document-notice-${ITEM}`)).toHaveTextContent(SENT, { exact: false });
    const spoken = announceNative.mock.calls.map(([text]) => String(text));
    expect(spoken).toContain(SENT);
    expect(spoken).toContain(STALE);
    expect(spoken.indexOf(SENT)).toBeLessThan(spoken.indexOf(STALE));
    // и только по разу
    expect(spoken.filter((text) => text === SENT)).toHaveLength(1);
    expect(spoken.filter((text) => text === STALE)).toHaveLength(1);
  });

  it("на iPhone пометка встаёт в очередь за итогом, а не обрывает его", async () => {
    restore();
    const ios = jest.replaceProperty(Platform, "OS", "ios");
    restore = () => ios.restore();
    await sendThenFailToRefresh();
    expect(screen.getByTestId(`prep-document-notice-${ITEM}`)).toHaveTextContent(SENT, { exact: false });
    expect(announceNative).toHaveBeenCalledWith(SENT);
    expect(queued).toHaveBeenCalledWith(STALE, { queue: true });
    expect(announceNative).not.toHaveBeenCalledWith(STALE);
  });

  it("обычное «Проверить состояние» со сбоем чтения по-прежнему не встаёт в очередь (никакого итога перед ним нет)", async () => {
    restore();
    const ios = jest.replaceProperty(Platform, "OS", "ios");
    restore = () => ios.restore();
    await open({ ready: (_a: unknown, call: number) => (call === 1 ? answer(emptyItem(), documentState(0)) : failure("PT500", 500)) });
    await screen.findByTestId("prep-requirement-list");
    announceNative.mockClear();
    queued.mockClear();
    await fireEvent.press(screen.getByTestId("prep-check"));
    await screen.findByTestId("prep-requirements-stale");
    expect(announceNative).toHaveBeenCalledWith(STALE);
    expect(queued).not.toHaveBeenCalled();
  });
});
