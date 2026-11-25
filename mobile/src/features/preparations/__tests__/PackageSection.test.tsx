// «Комплект программы» через настоящий экран «Требования программы»: выбор файлов, «Проверить состав», отправка комплекта,
// сбои, смена требований под выбором, последний комплект. Сеть и устройство подменены; хранилище записей - jest-мок AsyncStorage.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";

import { packageCandidates } from "@/features/preparations/PackageSelectionRow";
import { PreparationScreen } from "@/features/preparations/PreparationScreen";
import type { RpcTransport, RpcTransportResult } from "@/lib/rpc";
import {
  APPLICATION_ID,
  REVISION_ID,
  documentState,
  draftOf,
  itemId,
  readiness,
  readinessWithSelections,
  requirementItem,
  requirements,
  reusableVersion,
  selectionEcho,
  starterReadiness,
  submissionOf,
  uploadId,
  versionId,
} from "@/test-fixtures/preparations";
import { PACKAGE_REQUEST, packageDetail, packageItem, packageSummary, submitReceiptOf } from "@/test-fixtures/preparations-packages";
import { pressTwiceInOneTick } from "@/test-fixtures/press";
import { makeIo } from "@/test-fixtures/preparations-io";
import { PortalShell, renderPortal, testApi, testClient } from "@/test-fixtures/render";
import { failure, fakeTransport, preparationRow, uuidN } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
// Номер запроса задан, чтобы запись в хранилище и ответы сервера называли один запрос.
jest.mock("expo-crypto", () => ({ ...jest.requireActual("expo-crypto"), randomUUID: () => "99999999-0000-4000-8000-0000000000a1" }));

type Raw = Record<string, unknown>;
const FIRST = itemId(0);
const SECOND = itemId(1);
const NEW_REVISION = uuidN(2, "dddddddd");

/** Два требования: первое обязательное, второе нет. У первого сохранён файл (версия 4) и есть сохранённая версия 5, у второго версия 7. */
const items = (): Raw[] => [requirementItem(0), requirementItem(1, { required: false })];
const states = (): Raw[] => [documentState(0, { savedDraft: draftOf(0, 4), reusableVersions: [reusableVersion(5)] }), documentState(1, { reusableVersions: [reusableVersion(7)] })];
const current = (over: Raw = {}) => readiness(requirements(items()), states(), over);
const withPicked = (selected: Raw[], over: Raw = {}) => readinessWithSelections(requirements(items()), states(), selected, over);
const savedDraftChoice = () => selectionEcho(0, 4, { selection: { kind: "program_upload", documentVersionId: versionId(4), uploadContextId: uploadId(4) } });

async function open(options: { ready: unknown; extra?: Record<string, unknown>; lang?: "ru" | "ky"; wrap?: (inner: RpcTransport) => RpcTransport }) {
  const { transport, calls } = fakeTransport({ student_catalog_preparations_v1: [preparationRow(1)], application_package_readiness_v1: options.ready, ...options.extra });
  const view = await renderPortal(<PreparationScreen applicationId={APPLICATION_ID} io={makeIo().io} />, testApi(options.wrap ? options.wrap(transport) : transport), options.lang);
  return { ...view, calls, packageCalls: (name: string) => calls.filter((call) => call.name === name) };
}
const openChoice = async () => fireEvent.press(await screen.findByTestId("prep-package-choose-toggle"));
const packageKeys = async () => (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("evo.application-packages.v1:"));

let restore: () => void = () => undefined;
beforeEach(async () => {
  const spy = jest.replaceProperty(Platform, "OS", "android");
  restore = () => spy.restore();
  await AsyncStorage.clear();
});
afterEach(() => restore());

describe("выбор файлов для комплекта", () => {
  it("блок «Комплект программы» закрыт до нажатия; у обязательного требования сразу выбор, у необязательного сначала «Включить в комплект»", async () => {
    await open({ ready: current() });
    const section = await screen.findByTestId("prep-package-section");
    expect(within(section).getByText("Комплект программы")).toBeTruthy();
    expect(screen.queryByTestId(`prep-package-row-${FIRST}`)).toBeNull();
    expect(screen.getByTestId("prep-package-choose-toggle").props.accessibilityState).toMatchObject({ expanded: false });
    await openChoice();
    expect(screen.getByTestId("prep-package-choose-toggle").props.accessibilityState).toMatchObject({ expanded: true });
    const first = screen.getByTestId(`prep-package-row-${FIRST}`);
    expect(within(first).getByText("Обязательно")).toBeTruthy();
    // выбор сразу: «Файл не выбран» выбрано, ниже сохранённый файл и сохранённая версия
    expect(screen.getByTestId(`prep-package-none-${FIRST}`).props.accessibilityState).toMatchObject({ selected: true });
    expect(within(first).getByText("scan-4.pdf")).toBeTruthy();
    expect(within(first).getByText("scan-5.pdf")).toBeTruthy();
    const second = screen.getByTestId(`prep-package-row-${SECOND}`);
    expect(within(second).getByText("Необязательно")).toBeTruthy();
    expect(screen.getByTestId(`prep-package-include-${SECOND}`).props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.queryByTestId(`prep-package-none-${SECOND}`)).toBeNull();
  });

  it("«Проверить состав» без выбора: пустой выбор уходит на сервер, видны причины, отправить нельзя", async () => {
    const t = await open({ ready: current() });
    await openChoice();
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    await screen.findByTestId("prep-package-preview-box");
    const reads = t.packageCalls("application_package_readiness_v1");
    expect(reads[reads.length - 1]!.args).toMatchObject({ p_selections: [] });
    const box = screen.getByTestId("prep-package-preview-box");
    expect(within(box).getByText("Состав перед отправкой")).toBeTruthy();
    expect(within(box).getByText("Добавьте обязательные материалы")).toBeTruthy();
    // название недостающего требования стоит списком под причиной
    expect(within(box).getByText("• Требование 1")).toBeTruthy();
    expect(screen.queryByTestId("prep-package-ready")).toBeNull();
    expect(screen.getByTestId("prep-package-submit").props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("выбор сохранённого файла уходит в запросе проверки как есть; предпросмотр показывает файл и «Комплект можно отправить»", async () => {
    const t = await open({ ready: (args: Raw | undefined) => ((args?.p_selections as unknown[] | undefined)?.length ? withPicked([selectionEcho(0, 5)]) : current()) });
    await openChoice();
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`));
    expect(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId(`prep-package-none-${FIRST}`).props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    await screen.findByTestId("prep-package-preview-box");
    const reads = t.packageCalls("application_package_readiness_v1");
    expect(reads[reads.length - 1]!.args).toMatchObject({
      p_student_case_id: expect.any(String),
      p_application_id: APPLICATION_ID,
      p_selections: [{ requirementItemId: FIRST, selection: { kind: "existing_version", documentVersionId: versionId(5) }, expectedPreviousSubmissionId: null }],
    });
    const chosen = screen.getByTestId(`prep-package-chosen-${FIRST}`);
    expect(within(chosen).getByText("Требование 1")).toBeTruthy();
    expect(within(chosen).getByText("scan-5.pdf")).toBeTruthy();
    expect(screen.getByTestId("prep-package-ready")).toHaveTextContent("Комплект можно отправить");
    expect(screen.getByTestId("prep-package-submit").props.accessibilityState).toMatchObject({ disabled: false });
  });

  it("сохранённый файл программы идёт как program_upload с номером загрузки; повторное нажатие на «Файл не выбран» снимает выбор", async () => {
    const t = await open({ ready: (args: Raw | undefined) => ((args?.p_selections as unknown[] | undefined)?.length ? withPicked([savedDraftChoice()]) : current()) });
    await openChoice();
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(4)}`));
    await fireEvent.press(screen.getByTestId(`prep-package-none-${FIRST}`));
    expect(screen.getByTestId(`prep-package-none-${FIRST}`).props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(4)}`));
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    await screen.findByTestId("prep-package-preview-box");
    const reads = t.packageCalls("application_package_readiness_v1");
    expect(reads[reads.length - 1]!.args).toMatchObject({ p_selections: [{ requirementItemId: FIRST, selection: { kind: "program_upload", documentVersionId: versionId(4), uploadContextId: uploadId(4) } }] });
  });

  it("выбранная прежняя отправка уходит как expectedPreviousSubmissionId", async () => {
    const withSubmission = [documentState(0, { submission: submissionOf(0, 3, null), reusableVersions: [reusableVersion(5)] }), documentState(1)];
    const echo = selectionEcho(0, 5, { expectedPreviousSubmissionId: uuidN(3, "33333333") });
    const ready = (args: Raw | undefined) => ((args?.p_selections as unknown[] | undefined)?.length ? readinessWithSelections(requirements(items()), withSubmission, [echo]) : readiness(requirements(items()), withSubmission));
    const t = await open({ ready });
    await openChoice();
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`));
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    await screen.findByTestId("prep-package-preview-box");
    const reads = t.packageCalls("application_package_readiness_v1");
    expect(reads[reads.length - 1]!.args).toMatchObject({ p_selections: [{ expectedPreviousSubmissionId: uuidN(3, "33333333") }] });
  });

  it("«Изменить состав» возвращает к выбору, прежний выбор остаётся; повторная проверка читает сервер заново", async () => {
    const t = await open({ ready: (args: Raw | undefined) => ((args?.p_selections as unknown[] | undefined)?.length ? withPicked([selectionEcho(0, 5)]) : current()) });
    await openChoice();
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`));
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    await screen.findByTestId("prep-package-preview-box");
    await fireEvent.press(screen.getByTestId("prep-package-edit"));
    expect(screen.queryByTestId("prep-package-preview-box")).toBeNull();
    expect(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`).props.accessibilityState).toMatchObject({ selected: true });
    const before = t.packageCalls("application_package_readiness_v1").length;
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    await screen.findByTestId("prep-package-preview-box");
    expect(t.packageCalls("application_package_readiness_v1")).toHaveLength(before + 1);
  });
});

describe("необязательные материалы", () => {
  it("включённый без файла блокирует «Проверить состав» и называет материал; после выбора файла кнопка доступна; снятая галочка убирает материал из запроса", async () => {
    const t = await open({ ready: (args: Raw | undefined) => ((args?.p_selections as unknown[] | undefined)?.length ? withPicked([selectionEcho(0, 5), selectionEcho(1, 7)]) : current()) });
    await openChoice();
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`));
    await fireEvent.press(screen.getByTestId(`prep-package-include-${SECOND}`));
    expect(screen.getByTestId(`prep-package-include-${SECOND}`).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByText("Выберите файл для включённых необязательных материалов или уберите их из комплекта.")).toBeTruthy();
    expect(screen.getByText("• Требование 2")).toBeTruthy();
    expect(screen.getByTestId("prep-package-preview").props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId(`prep-package-version-${SECOND}-${versionId(7)}`));
    expect(screen.queryByText("Выберите файл для включённых необязательных материалов или уберите их из комплекта.")).toBeNull();
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    await screen.findByTestId("prep-package-preview-box");
    const reads = t.packageCalls("application_package_readiness_v1");
    expect((reads[reads.length - 1]!.args as Raw).p_selections).toHaveLength(2);
    // галочку снимают: второй материал в запрос больше не входит, даже если файл для него выбирали
    await fireEvent.press(screen.getByTestId("prep-package-edit"));
    await fireEvent.press(screen.getByTestId(`prep-package-include-${SECOND}`));
    expect(screen.getByTestId(`prep-package-include-${SECOND}`).props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    await waitFor(() => expect(t.packageCalls("application_package_readiness_v1").length).toBeGreaterThan(reads.length));
    const after = t.packageCalls("application_package_readiness_v1");
    expect((after[after.length - 1]!.args as Raw).p_selections).toEqual([expect.objectContaining({ requirementItemId: FIRST })]);
  });
});

describe("«Отправить комплект в EVO»", () => {
  /** Ответы экрана: до отправки состав без комплекта, после - с последним комплектом. */
  const sendable = (extra: Record<string, unknown> = {}) => {
    let sent = false;
    return {
      ready: (args: Raw | undefined) => ((args?.p_selections as unknown[] | undefined)?.length ? withPicked([selectionEcho(0, 5)]) : sent ? current({ latestPackage: packageSummary(1, 1) }) : current()),
      extra: {
        application_package_submit_v1: (args: Raw | undefined) => {
          sent = true;
          return submitReceiptOf(args!.p_intent as Raw, 1);
        },
        ...extra,
      },
    };
  };
  const toPreview = async () => {
    await openChoice();
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`));
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    await screen.findByTestId("prep-package-preview-box");
  };

  it("отправка идёт точным запросом со своим номером; запись в хранилище ставится до сети и снимается после квитанции; экран перечитывается", async () => {
    let seenBeforeSubmit: string[] = [];
    const t = await open({
      ...sendable(),
      // до вызова сети смотрим, что лежит в хранилище
      wrap: (inner) => async (name, args, options) => {
        if (name === "application_package_submit_v1") seenBeforeSubmit = await packageKeys();
        return inner(name, args, options);
      },
    });
    await toPreview();
    const reads = t.packageCalls("application_package_readiness_v1").length;
    await fireEvent.press(screen.getByTestId("prep-package-submit"));
    await waitFor(() => expect(screen.getByTestId("prep-package-message")).toHaveTextContent("Комплект отправлен в EVO", { exact: false }));
    const sent = t.packageCalls("application_package_submit_v1");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.args).toEqual({
      p_intent: {
        studentCaseId: expect.any(String),
        applicationId: APPLICATION_ID,
        requirementsRevisionId: REVISION_ID,
        expectedPreviousPackageId: null,
        items: [{ requirementItemId: FIRST, selection: { kind: "existing_version", documentVersionId: versionId(5) }, expectedPreviousSubmissionId: null }],
        requestId: PACKAGE_REQUEST,
      },
    });
    // до сети запись уже лежала, после квитанции её нет
    expect(seenBeforeSubmit).toHaveLength(1);
    expect(seenBeforeSubmit[0]).toContain(`:${APPLICATION_ID}:submit:${REVISION_ID}`);
    expect(await packageKeys()).toEqual([]);
    // предпросмотр снят, экран перечитан (после отправки список требований читается заново)
    expect(screen.queryByTestId("prep-package-preview-box")).toBeNull();
    await waitFor(() => expect(t.packageCalls("application_package_readiness_v1").length).toBeGreaterThan(reads));
    // время отправки стоит в той же строке, что и сообщение
    expect(screen.getByTestId("prep-package-message")).toHaveTextContent("(Бишкек)", { exact: false });
  });

  it("после отправки появляется «Открыть комплект» и последний комплект со статусом «Отправлен на проверку EVO · Комплект 1»", async () => {
    const t = await open(sendable());
    expect(screen.queryByTestId("prep-package-open-toggle")).toBeNull();
    await toPreview();
    await fireEvent.press(screen.getByTestId("prep-package-submit"));
    await waitFor(() => expect(screen.getByTestId("prep-package-open-toggle")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("prep-package-latest")).toHaveTextContent("Отправлен на проверку EVO · Комплект 1"));
    expect(t.packageCalls("application_package_detail_v1")).toHaveLength(0);
  });

  it("сеть оборвалась без ответа: «Не удалось обновить данные… ещё не подтверждено», запись остаётся, дальше отправка закрыта до проверки результата", async () => {
    const t = await open(sendable({ application_package_submit_v1: new Error("network down") }));
    await toPreview();
    await fireEvent.press(screen.getByTestId("prep-package-submit"));
    const error = await screen.findByTestId("prep-package-error");
    expect(error).toHaveTextContent("Не удалось обновить данные. Попробуйте ещё раз.", { exact: false });
    expect(error).toHaveTextContent("Это действие ещё не подтверждено. Проверьте результат или повторите его.", { exact: false });
    // запись осталась: исход неизвестен, повтор пойдёт с тем же номером
    expect(await packageKeys()).toHaveLength(1);
    expect(await screen.findByTestId("prep-package-recovery")).toBeTruthy();
    expect(screen.getByTestId("prep-package-submit").props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId("prep-package-preview-box")).toBeTruthy();
    // сеть пробовали три раза с теми же аргументами
    const sent = t.packageCalls("application_package_submit_v1");
    expect(sent.length).toBeGreaterThanOrEqual(1);
    for (const call of sent) expect(call.args).toEqual(sent[0]!.args);
  });

  it("отказ сервера (состав устарел): сообщение и «ещё не подтверждено», запись остаётся, сообщения об отправке нет", async () => {
    const stale: RpcTransportResult = { data: null, error: { code: "P0001", message: "application_package_stale_requirements" }, status: 400 };
    await open({
      ...sendable(),
      wrap: (inner) => async (name, args, options) => (name === "application_package_submit_v1" ? stale : inner(name, args, options)),
    });
    await toPreview();
    await fireEvent.press(screen.getByTestId("prep-package-submit"));
    expect(await screen.findByTestId("prep-package-error")).toHaveTextContent("Это действие ещё не подтверждено", { exact: false });
    expect(screen.queryByTestId("prep-package-message")).toBeNull();
    // точный отказ записи запрос не снимает: судит проверка результата
    expect(await packageKeys()).toHaveLength(1);
  });
});

describe("устаревший вид списка: комплект собирается из свежего ответа", () => {
  it("чтение списка не удалось, прежний ответ на экране: «Проверить состав» читает заново, отправка идёт только из этого ответа", async () => {
    let plain = 0;
    const t = await open({
      ready: (args: Raw | undefined) => {
        if ((args?.p_selections as unknown[] | undefined)?.length) return withPicked([selectionEcho(0, 5)]);
        plain += 1;
        return plain === 2 ? failure("PT500", 500) : current();
      },
      extra: { application_package_submit_v1: (args: Raw | undefined) => submitReceiptOf(args!.p_intent as Raw, 1) },
    });
    await openChoice();
    await act(async () => {
      await screen.getByTestId("screen-scroll").props.refreshControl.props.onRefresh();
    });
    expect(await screen.findByTestId("prep-requirements-stale")).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`));
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    await screen.findByTestId("prep-package-preview-box");
    // выбор ушёл на сервер: состав проверен по свежему ответу, а не по прежнему списку
    const reads = t.packageCalls("application_package_readiness_v1");
    expect((reads[reads.length - 1]!.args as Raw).p_selections).toHaveLength(1);
    await fireEvent.press(screen.getByTestId("prep-package-submit"));
    await waitFor(() => expect(screen.getByTestId("prep-package-message")).toHaveTextContent("Комплект отправлен в EVO", { exact: false }));
    expect(t.packageCalls("application_package_submit_v1")).toHaveLength(1);
  });
});

describe("замки: два нажатия раньше, чем кнопка выключилась", () => {
  const spoken = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;
  const ready = (args: Raw | undefined) => ((args?.p_selections as unknown[] | undefined)?.length ? withPicked([selectionEcho(0, 5)]) : current());

  it("«Проверить состав»: состав читается один раз", async () => {
    const t = await open({ ready });
    await openChoice();
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`));
    const reads = t.packageCalls("application_package_readiness_v1").length;
    await pressTwiceInOneTick("prep-package-preview");
    await screen.findByTestId("prep-package-preview-box");
    expect(t.packageCalls("application_package_readiness_v1")).toHaveLength(reads + 1);
  });

  it("«Отправить комплект в EVO»: комплект уходит один раз, второе нажатие не говорит «действие уже выполняется»", async () => {
    const t = await open({ ready, extra: { application_package_submit_v1: (args: Raw | undefined) => submitReceiptOf(args!.p_intent as Raw, 1) } });
    await openChoice();
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`));
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    await screen.findByTestId("prep-package-preview-box");
    spoken.mockClear();
    await pressTwiceInOneTick("prep-package-submit");
    await waitFor(() => expect(screen.getByTestId("prep-package-message")).toHaveTextContent("Комплект отправлен в EVO", { exact: false }));
    expect(t.packageCalls("application_package_submit_v1")).toHaveLength(1);
    expect(spoken.mock.calls.filter(([text]) => String(text).includes("Действие уже выполняется"))).toHaveLength(0);
    expect(await packageKeys()).toEqual([]);
  });
});

describe("сбои чтения", () => {
  it("состав не читается: «Не удалось обновить данные»; чужой доступ: «Нет доступа к этому действию»", async () => {
    let call = 0;
    await open({ ready: (args: Raw | undefined) => ((args?.p_selections as unknown[] | undefined)?.length ? (++call === 1 ? failure("PT500", 500) : failure("42501", 403)) : current()) });
    await openChoice();
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`));
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    expect(await screen.findByTestId("prep-package-error")).toHaveTextContent("Не удалось обновить данные. Попробуйте ещё раз.");
    expect(screen.queryByTestId("prep-package-preview-box")).toBeNull();
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    await waitFor(() => expect(screen.getByTestId("prep-package-error")).toHaveTextContent("Нет доступа к этому действию"));
  });

  it("список требований не прочитан: вместо выбора «Не удалось обновить данные», выбора нет", async () => {
    await open({ ready: failure("PT500", 500) });
    expect(await screen.findByTestId("prep-package-unavailable")).toHaveTextContent("Не удалось обновить данные. Попробуйте ещё раз.");
    expect(screen.queryByTestId("prep-package-choose")).toBeNull();
  });

  it("пока идёт первое чтение, вместо выбора «Загружаем…»; когда ответ пришёл, выбор появляется", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await open({
      ready: current(),
      wrap: (inner) => async (name, args, options) => {
        if (name === "application_package_readiness_v1") await gate;
        return inner(name, args, options);
      },
    });
    const section = await screen.findByTestId("prep-package-section");
    expect(within(section).getByText("Загружаем…")).toBeTruthy();
    expect(screen.queryByTestId("prep-package-choose")).toBeNull();
    release();
    expect(await screen.findByTestId("prep-package-choose")).toBeTruthy();
    expect(within(screen.getByTestId("prep-package-section")).queryByText("Загружаем…")).toBeNull();
  });
});

describe("обновление требований", () => {
  it("пока идёт «Проверить состояние», выбор закрыт («Загружаем…»); ответ приходит - выбор возвращается раскрытым", async () => {
    let release: () => void = () => undefined;
    let held = false;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await open({
      ready: current(),
      wrap: (inner) => async (name, args, options) => {
        // первое чтение проходит сразу, второе (по нажатию) ждёт
        if (name === "application_package_readiness_v1") {
          if (held) await gate;
          held = true;
        }
        return inner(name, args, options);
      },
    });
    await openChoice();
    expect(screen.getByTestId("prep-package-preview")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("prep-check"));
    await waitFor(() => expect(screen.queryByTestId("prep-package-preview")).toBeNull());
    expect(within(screen.getByTestId("prep-package-section")).getByText("Загружаем…")).toBeTruthy();
    release();
    expect(await screen.findByTestId("prep-package-preview")).toBeTruthy();
    expect(screen.getByTestId("prep-package-choose-toggle").props.accessibilityState).toMatchObject({ expanded: true });
  });
});

describe("изменились требования", () => {
  it("выбор сделан по прежней ревизии: он показан, «Проверить состав» закрыт; сброс по кнопке открывает выбор заново", async () => {
    let call = 0;
    const next = readiness(requirements(items(), { revisionId: NEW_REVISION, revisionVersion: "2" }), [documentState(0, { reusableVersions: [reusableVersion(5)] }), documentState(1)]);
    await open({ ready: () => (++call === 1 ? current() : next) });
    await openChoice();
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`));
    expect(screen.queryByTestId("prep-package-revision-changed")).toBeNull();
    await fireEvent.press(screen.getByTestId("prep-check"));
    const banner = await screen.findByTestId("prep-package-revision-changed");
    expect(within(banner).getByText("Требования изменились. Прежний выбор сохранён ниже. Перед новым выбором подтвердите его сброс.")).toBeTruthy();
    // выбранное требование названо
    expect(within(banner).getByText("• Требование 1")).toBeTruthy();
    // блок выбора после обновления остаётся раскрытым: его состояние держит экран, а не сам блок
    expect(screen.getByTestId("prep-package-choose-toggle").props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByTestId("prep-package-preview").props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId("prep-package-reset"));
    await waitFor(() => expect(screen.queryByTestId("prep-package-revision-changed")).toBeNull());
    expect(screen.getByTestId("prep-package-preview").props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.getByTestId(`prep-package-none-${FIRST}`).props.accessibilityState).toMatchObject({ selected: true });
  });
});

describe("последний комплект и стартовый список", () => {
  it("последний комплект: строка статуса; «Открыть комплект» читает комплект по номеру, второе нажатие его скрывает", async () => {
    const summary = packageSummary(2, 1, { latestReview: null });
    const t = await open({ ready: current({ latestPackage: summary }), extra: { application_package_detail_v1: packageDetail(summary, [packageItem(0, 5)]) } });
    expect(await screen.findByTestId("prep-package-latest")).toHaveTextContent("Отправлен на проверку EVO · Комплект 2");
    expect(screen.getByTestId("prep-package-open-toggle").props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(screen.getByTestId("prep-package-open-toggle"));
    const view = await screen.findByTestId(`prep-package-detail-${summary.packageId as string}`);
    expect(screen.getByTestId("prep-package-open-toggle").props.accessibilityState).toMatchObject({ expanded: true });
    expect(within(view).getByText("Информатика · Осень 2027")).toBeTruthy();
    expect(t.packageCalls("application_package_detail_v1")[0]!.args).toMatchObject({ p_package_id: summary.packageId });
    await fireEvent.press(screen.getByTestId("prep-package-open-toggle"));
    expect(screen.queryByTestId(`prep-package-detail-${summary.packageId as string}`)).toBeNull();
  });

  it("стартовый список EVO: подписи «Стартовый комплект EVO» и «Полный перечень университета ещё нужно уточнить»", async () => {
    await open({ ready: starterReadiness() });
    const section = await screen.findByTestId("prep-package-section");
    expect(within(section).getByText("Стартовый комплект EVO")).toBeTruthy();
    expect(within(section).getByText("Полный перечень университета ещё нужно уточнить.")).toBeTruthy();
  });

  it("на кыргызском текст комплекта берётся из словаря сайта", async () => {
    await open({ ready: current(), lang: "ky" });
    const section = await screen.findByTestId("prep-package-section");
    expect(within(section).getByText("Программанын топтому")).toBeTruthy();
  });
});

describe("состояние выбора", () => {
  it("пока записи устройства читаются, выбор и «Проверить состав» закрыты; потом открываются", async () => {
    const original = AsyncStorage.getAllKeys;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    (AsyncStorage as { getAllKeys: typeof AsyncStorage.getAllKeys }).getAllKeys = jest.fn(async () => {
      await gate;
      return original();
    });
    try {
      await open({ ready: current() });
      await openChoice();
      expect(screen.getByTestId("prep-package-preview").props.accessibilityState).toMatchObject({ disabled: true });
      expect(screen.getByTestId(`prep-package-none-${FIRST}`).props.accessibilityState).toMatchObject({ disabled: true });
      release();
      await waitFor(() => expect(screen.getByTestId("prep-package-preview").props.accessibilityState).toMatchObject({ disabled: false }));
    } finally {
      release();
      (AsyncStorage as { getAllKeys: typeof AsyncStorage.getAllKeys }).getAllKeys = original;
    }
  });

  it("«Проверить состояние» при открытом предпросмотре снимает его: комплект отправляется только из ответа, прочитанного в этом показе", async () => {
    await open({ ready: (args: Raw | undefined) => ((args?.p_selections as unknown[] | undefined)?.length ? withPicked([selectionEcho(0, 5)]) : current()) });
    await openChoice();
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`));
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    await screen.findByTestId("prep-package-preview-box");
    await fireEvent.press(screen.getByTestId("prep-check"));
    await waitFor(() => expect(screen.queryByTestId("prep-package-preview-box")).toBeNull());
    expect(screen.queryByTestId("prep-package-submit")).toBeNull();
    // выбор остался: его можно проверить снова
    expect(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`).props.accessibilityState).toMatchObject({ selected: true });
  });

  it("выбранный файл пропал из списка сохранённых: строка «Выбранный файл недоступен» стоит выбранной, отправить его нельзя случайно", async () => {
    let call = 0;
    const gone = readiness(requirements(items()), [documentState(0), documentState(1)]);
    await open({ ready: () => (++call === 1 ? current() : gone) });
    await openChoice();
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`));
    await fireEvent.press(screen.getByTestId("prep-check"));
    const missing = await screen.findByTestId(`prep-package-missing-${FIRST}`);
    expect(missing).toHaveTextContent("Выбранный файл недоступен");
    expect(missing.props.accessibilityState).toMatchObject({ selected: true, disabled: true });
    expect(screen.queryByTestId(`prep-package-version-${FIRST}-${versionId(5)}`)).toBeNull();
  });

  it("смена участника или программы начинает выбор с чистого состояния", async () => {
    const { transport } = fakeTransport({ student_catalog_preparations_v1: [preparationRow(1)], application_package_readiness_v1: current() });
    const client = testClient();
    const tree = (membershipId: string) => (
      <PortalShell api={testApi(transport, { membershipId })} client={client}>
        <PreparationScreen applicationId={APPLICATION_ID} io={makeIo().io} />
      </PortalShell>
    );
    const view = await render(tree("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    await openChoice();
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`));
    expect(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`).props.accessibilityState).toMatchObject({ selected: true });
    await view.rerender(tree("aaaaaaaa-0000-4000-8000-0000000000ff"));
    // блок начал заново: закрыт и без выбора прежнего участника
    await waitFor(() => expect(screen.getByTestId("prep-package-choose-toggle").props.accessibilityState).toMatchObject({ expanded: false }));
    await openChoice();
    expect(screen.getByTestId(`prep-package-none-${FIRST}`).props.accessibilityState).toMatchObject({ selected: true });
  });
});

describe("читалка экрана слышит итог", () => {
  const spoken = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;
  beforeEach(() => spoken.mockClear());

  const readyAnswer = (args: Raw | undefined) => ((args?.p_selections as unknown[] | undefined)?.length ? withPicked([selectionEcho(0, 5)]) : current());
  const toPreview = async () => {
    await openChoice();
    await fireEvent.press(screen.getByTestId(`prep-package-version-${FIRST}-${versionId(5)}`));
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    await screen.findByTestId("prep-package-preview-box");
  };

  it("проверка состава: «Состав перед отправкой. Комплект можно отправить»", async () => {
    await open({ ready: readyAnswer });
    await toPreview();
    expect(spoken).toHaveBeenCalledWith("Состав перед отправкой. Комплект можно отправить");
  });

  it("состав не готов: озвучен только заголовок, без «Комплект можно отправить»", async () => {
    await open({ ready: current() });
    await openChoice();
    await fireEvent.press(screen.getByTestId("prep-package-preview"));
    await screen.findByTestId("prep-package-preview-box");
    expect(spoken).toHaveBeenCalledWith("Состав перед отправкой");
    expect(spoken).not.toHaveBeenCalledWith(expect.stringContaining("Комплект можно отправить"));
  });

  it("отправка: «Комплект отправлен в EVO»; сбой: текст ошибки", async () => {
    await open({ ready: readyAnswer, extra: { application_package_submit_v1: (args: Raw | undefined) => submitReceiptOf(args!.p_intent as Raw, 1) } });
    await toPreview();
    spoken.mockClear();
    await fireEvent.press(screen.getByTestId("prep-package-submit"));
    await waitFor(() => expect(spoken).toHaveBeenCalledWith("Комплект отправлен в EVO"));
  });

  it("сеть оборвалась при отправке: озвучено «ещё не подтверждено», «отправлен» не озвучено", async () => {
    await open({ ready: readyAnswer, extra: { application_package_submit_v1: new Error("network down") } });
    await toPreview();
    spoken.mockClear();
    await fireEvent.press(screen.getByTestId("prep-package-submit"));
    await screen.findByTestId("prep-package-error");
    expect(spoken).toHaveBeenCalledWith(expect.stringContaining("Это действие ещё не подтверждено"));
    expect(spoken).not.toHaveBeenCalledWith(expect.stringContaining("Комплект отправлен"));
  });
});

describe("кто может быть выбран для комплекта", () => {
  it("текущая отправка, сохранённый файл и сохранённые версии: без повторов по версии, в этом порядке; дополнительные страницы добавляются", () => {
    const state = {
      submission: submissionOf(0, 3, null),
      savedDraft: draftOf(0, 4),
      reusableVersions: [reusableVersion(5), reusableVersion(3)],
    } as never;
    const ids = (more: never[] = []) => packageCandidates(state, more).map((candidate) => candidate.file.documentVersionId);
    expect(ids()).toEqual([versionId(3), versionId(4), versionId(5)]);
    expect(ids([reusableVersion(5), reusableVersion(2)] as never[])).toEqual([versionId(3), versionId(4), versionId(5), versionId(2)]);
    expect(packageCandidates(state)[0]!.selection).toEqual({ kind: "existing_version", documentVersionId: versionId(3) });
    expect(packageCandidates(state)[1]!.selection).toEqual({ kind: "program_upload", documentVersionId: versionId(4), uploadContextId: uploadId(4) });
  });
});
