// Экран «Требования программы»: шапка, список требований, состояние файла, «Проверить состояние», «Открыть список
// документов», пустые и ошибочные состояния. Сеть и устройство подменены: транспорт RPC поддельный, навигация записывается.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { AccessibilityInfo, Linking, StyleSheet } from "react-native";

import { PreparationScreen } from "@/features/preparations/PreparationScreen";
import {
  APPLICATION_ID,
  documentState,
  draftOf,
  initializeReceipt,
  itemId,
  noRevision,
  readiness,
  requirementItem,
  requirements,
  reviewOf,
  starterReadiness,
  submissionOf,
  uninitializedReadiness,
  versionId,
} from "@/test-fixtures/preparations";
import { pressTwiceInOneTick } from "@/test-fixtures/press";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport, preparationRow } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));

const navigate = router.navigate as jest.Mock;
const announceNative = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;

type Handlers = Record<string, unknown>;
const row = (status = "preparation", over: Record<string, unknown> = {}) => ({ ...preparationRow(1, status), ...over });
const handlers = (ready: unknown, extra: Handlers = {}, rows: unknown[] = [row()]): Handlers => ({
  student_catalog_preparations_v1: rows,
  application_package_readiness_v1: ready,
  ...extra,
});
async function open(h: Handlers, options: { api?: Parameters<typeof testApi>[1]; lang?: "ru" | "ky"; id?: string } = {}) {
  const { transport, calls } = fakeTransport(h);
  const view = await renderPortal(<PreparationScreen applicationId={options.id ?? APPLICATION_ID} />, testApi(transport, options.api), options.lang ?? "ru");
  return { ...view, calls };
}

beforeEach(() => {
  navigate.mockClear();
  announceNative.mockClear?.();
});

describe("шапка программы", () => {
  it("вуз, программа, набор, статус, пояснения и срок подачи набора", async () => {
    await open(handlers(starterReadiness()));
    expect(await screen.findByTestId("prep-title")).toHaveTextContent("Информатика", { exact: false });
    expect(screen.getByTestId("prep-university")).toHaveTextContent("Университет 1", { exact: false });
    expect(screen.getByTestId("prep-intake")).toHaveTextContent("Осень 2027", { exact: false });
    expect(screen.getByTestId("prep-status")).toHaveTextContent("Собираем документы", { exact: false });
    expect(screen.getByText("Программа добавлена в «Мои программы». Заявка в университет при этом не отправляется.")).toBeTruthy();
    expect(screen.getByText("Показаны сведения, сохранённые при выборе программы.")).toBeTruthy();
    expect(within(screen.getByTestId("prep-intake-deadline")).getByText("Срок подачи")).toBeTruthy();
    expect(within(screen.getByTestId("prep-intake-deadline")).getByText("1 мая 2027 г.")).toBeTruthy();
    expect(screen.getByTestId("prep-saved-deadline")).toHaveTextContent("Сроки этого набора нужно подтвердить с куратором.", { exact: false });
  });

  it("срок подачи с временем и поясом; сроки подтверждены - пометки нет; статус «Подано»", async () => {
    const content = preparationRow(1).content;
    const intake = { ...content.programs[0]!.intakes[0]!, deadlineTime: "18:00", timezone: "Asia/Shanghai" };
    const custom = { ...content, programs: [{ ...content.programs[0]!, intakes: [intake] }] };
    await open(handlers(starterReadiness(), {}, [row("submitted", { content: custom, deadlineStateAtSelection: "confirmed" })]));
    expect(await screen.findByText("1 мая 2027 г., 18:00 (Asia/Shanghai)")).toBeTruthy();
    expect(screen.getByTestId("prep-status")).toHaveTextContent("Подано", { exact: false });
    expect(screen.queryByTestId("prep-saved-deadline")).toBeNull();
  });

  it("набора без срока подачи нет блока срока", async () => {
    const content = preparationRow(1).content;
    const intake = { ...content.programs[0]!.intakes[0]!, applicationDeadline: null };
    const custom = { ...content, programs: [{ ...content.programs[0]!, intakes: [intake] }] };
    await open(handlers(starterReadiness(), {}, [row("preparation", { content: custom })]));
    await screen.findByTestId("prep-title");
    expect(screen.queryByTestId("prep-intake-deadline")).toBeNull();
  });

  it("кыргызский язык: слова берутся из общего словаря веба", async () => {
    await open(handlers(starterReadiness()), { lang: "ky" });
    await screen.findByTestId("prep-title");
    expect(screen.getByTestId("prep-status")).toHaveTextContent("Документтер даярдалууда", { exact: false });
    expect(screen.getByText("Бул программа үчүн документтер")).toBeTruthy();
    expect(screen.getByText("Бардык документтерим")).toBeTruthy();
    expect(screen.getByText("Кураторго жазуу")).toBeTruthy();
  });

  it("«К моему поступлению» ведёт на «Мои программы» на «Главной»", async () => {
    await open(handlers(starterReadiness()));
    await screen.findByTestId("prep-requirement-list");
    await fireEvent.press(screen.getByTestId("prep-back"));
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/home\?list=programs&at=\d+$/));
    expect(screen.getByTestId("prep-back")).toHaveTextContent("К моему поступлению", { exact: false });
  });
});

describe("требования", () => {
  it("начальный список EVO: заметка, два обязательных требования с группой и инструкцией, файла нет", async () => {
    const { calls } = await open(handlers(starterReadiness()));
    expect(await screen.findByTestId("prep-starter")).toHaveTextContent("Начальный список EVO: фото и паспорт.", { exact: false });
    expect(screen.getByText("Документы для этой программы")).toBeTruthy();
    for (const index of [0, 1]) {
      const card = screen.getByTestId(`prep-requirement-${itemId(index)}`);
      expect(within(card).getByText(`Требование ${index + 1}`)).toBeTruthy();
      expect(within(card).getByText("Обязательно")).toBeTruthy();
      expect(within(card).getByText("Основные документы")).toBeTruthy();
      expect(within(card).getByText(`Инструкция к требованию ${index + 1}.`)).toBeTruthy();
      expect(screen.getByTestId(`prep-document-${itemId(index)}`)).toHaveTextContent("Файл ещё не загружен", { exact: false });
    }
    expect(screen.queryByTestId("prep-uninitialized")).toBeNull();
    expect(calls.filter((c) => c.name === "application_package_readiness_v1")).toHaveLength(1);
    expect(calls.find((c) => c.name === "application_package_readiness_v1")?.args).toMatchObject({ p_application_id: APPLICATION_ID, p_selections: [] });
  });

  // QA 25.11.2026: при самом крупном шрифте системы (AX3) «Обязательно» занимало полстроки, и «Загранпаспорт» ломалось на «Загранпа / спорт».
  // Правило: строка переносится, у названия нет `flex: 1`; плашка идёт после названия и, когда тесно, оказывается под ним.
  // Раскладку проверяли настоящим Yoga из react-native 0.88.1 (описано в PR); здесь закреплено правило, а не пиксели.
  it("название и плашка «Обязательно»: строка переносится, название не растягивается (`flex: 1` его сжимало), плашка идёт после названия", async () => {
    const items = [requirementItem(0), requirementItem(1, { required: false })];
    await open(handlers(readiness(requirements(items))));
    await screen.findByTestId("prep-requirement-list");
    for (const index of [0, 1]) {
      const id = itemId(index);
      const head = screen.getByTestId(`prep-requirement-head-${id}`);
      expect(StyleSheet.flatten(head.props.style)).toMatchObject({ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" });
      const title = StyleSheet.flatten(screen.getByTestId(`prep-requirement-title-${id}`).props.style);
      expect(title.flexShrink).toBe(1);
      expect(title.flex).toBeUndefined();
      expect(title.flexGrow).toBeUndefined();
      // порядок в строке: название, затем плашка (при переносе плашка оказывается под названием, а не над ним)
      expect(head.children.map((child) => (typeof child === "string" ? child : child.props.testID))).toEqual([`prep-requirement-title-${id}`, `prep-requirement-pill-${id}`]);
    }
    expect(screen.getByTestId(`prep-requirement-pill-${itemId(0)}`)).toHaveTextContent("Обязательно");
    expect(screen.getByTestId(`prep-requirement-pill-${itemId(1)}`)).toHaveTextContent("Необязательно");
  });

  it("подтверждённый сотрудником состав: заметка «подтверждён», необязательное требование с пометкой", async () => {
    const items = [requirementItem(0), requirementItem(1, { required: false })];
    await open(handlers(readiness(requirements(items))));
    expect(await screen.findByTestId("prep-confirmed")).toHaveTextContent("Состав требований подтверждён сотрудником EVO.", { exact: false });
    expect(screen.queryByTestId("prep-starter")).toBeNull();
    expect(within(screen.getByTestId(`prep-requirement-${itemId(1)}`)).getByText("Необязательно")).toBeTruthy();
  });

  it("срок документа: дата, время, пояс, дата проверки и источник; источник открывается в браузере", async () => {
    const spy = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
    const deadline = { date: "2026-12-31", time: "23:59", timezone: "Asia/Bishkek", sourceUrl: "https://example.org/rules", verifiedOn: "2026-11-01" };
    await open(handlers(readiness(requirements([requirementItem(0, { deadline })]))));
    const block = await screen.findByTestId(`prep-deadline-${itemId(0)}`);
    expect(within(block).getByText("Срок документа")).toBeTruthy();
    expect(within(block).getByText("31.12.2026, 23:59 (Asia/Bishkek)")).toBeTruthy();
    expect(within(block).getByText("Срок проверен: 01.11.2026")).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`prep-deadline-${itemId(0)}-source`));
    expect(spy).toHaveBeenCalledWith("https://example.org/rules");
    expect(screen.getByText("Источник срока (откроется в браузере)")).toBeTruthy();
    spy.mockRestore();
  });

  it("срок без источника: ссылки нет; требование изменилось: пометка", async () => {
    const deadline = { date: "2026-12-31", time: null, timezone: null, sourceUrl: null, verifiedOn: "2026-11-01" };
    await open(handlers(readiness(requirements([requirementItem(0, { deadline, definitionImpact: "changed" })]))));
    const block = await screen.findByTestId(`prep-deadline-${itemId(0)}`);
    expect(within(block).getByText("31.12.2026")).toBeTruthy();
    expect(screen.queryByTestId(`prep-deadline-${itemId(0)}-source`)).toBeNull();
    expect(screen.getByTestId(`prep-changed-${itemId(0)}`)).toHaveTextContent("Требование изменилось.", { exact: false });
  });

  it("недоступная связь документа с программой: причины словами, перечень настройки куратором", async () => {
    const items = [
      requirementItem(0, { slotStatus: null, unavailableReasons: ["slot_removed", "slot_metadata_changed"] }),
      requirementItem(1),
    ];
    const reqs = requirements(items, { state: "needs_configuration", configurationReasons: ["material_association_unavailable", "material_metadata_changed"] });
    await open(handlers(readiness(reqs)));
    const card = await screen.findByTestId(`prep-requirement-${itemId(0)}`);
    expect(within(card).getByText("Документ удалён из действующего списка.")).toBeTruthy();
    expect(within(card).getByText("Назначение документа изменилось; нужна проверка куратора.")).toBeTruthy();
    // у второго требования связь в порядке: причины связи нет, а «Файл не загружен» - не причина связи
    expect(within(screen.getByTestId(`prep-requirement-${itemId(1)}`)).queryByText("Файл")).toBeNull();
    const notice = screen.getByTestId("prep-needs-configuration");
    expect(within(notice).getByText("Куратору нужно уточнить список документов")).toBeTruthy();
    expect(within(notice).getByText("• Связь одного из документов с программой недоступна.")).toBeTruthy();
    expect(within(notice).getByText("• Назначение одного из документов изменилось и требует проверки.")).toBeTruthy();
  });

  it("нужна настройка без ревизии: причины и объяснение, списка требований нет", async () => {
    await open(handlers(readiness(noRevision("needs_configuration", ["legacy_case_checklist"]))));
    const notice = await screen.findByTestId("prep-needs-configuration");
    expect(within(notice).getByText("Выбор сохранён. Документы доступны в общем разделе; куратор поможет связать их с программой.")).toBeTruthy();
    expect(within(notice).getByText("• В деле уже есть список документов, который нужно проверить.")).toBeTruthy();
    expect(screen.queryByTestId("prep-requirement-list")).toBeNull();
  });
});

describe("файл у требования", () => {
  it("отправленный документ: имя, версия, время по Бишкеку, ожидание проверки", async () => {
    const items = [requirementItem(0, { slotStatus: "submitted", currentVersionId: versionId(1), currentVersionNo: "1", technicalAvailability: "available", unavailableReasons: [] })];
    await open(handlers(readiness(requirements(items), [documentState(0, { submission: submissionOf(0, 1, null), canSubmit: false })])));
    const block = await screen.findByTestId(`prep-document-${itemId(0)}-submission`);
    expect(within(block).getByText("Отправленный документ")).toBeTruthy();
    expect(within(block).getByText("scan-1.pdf")).toBeTruthy();
    expect(within(block).getByText("Версия 1")).toBeTruthy();
    expect(within(block).getByText("7 окт. 2026 г., 16:05 (Бишкек)")).toBeTruthy();
    expect(screen.getByTestId(`prep-document-${itemId(0)}-submission-decision`)).toHaveTextContent("Ожидает проверки EVO", { exact: false });
    expect(within(block).queryByText(/Проверен:/u)).toBeNull();
  });

  it("решения EVO: принят, нужно исправить с замечанием, не принят", async () => {
    const cases: [string, ReturnType<typeof reviewOf>, string][] = [
      ["approved", reviewOf(1, "approved"), "Принят для этой программы"],
      ["correction_required", reviewOf(2, "correction_required", "Скан обрезан справа."), "Нужно исправить"],
      ["rejected", reviewOf(3, "rejected", "Документ не по форме."), "Не принят"],
    ];
    for (const [decision, review, word] of cases) {
      const items = [requirementItem(0, { slotStatus: decision === "approved" ? "approved" : decision, currentVersionId: versionId(1), currentVersionNo: "1", technicalAvailability: "available", unavailableReasons: [], reviewDecision: decision, reviewReason: review.reason, reviewedAt: review.reviewedAt })];
      const view = await open(handlers(readiness(requirements(items), [documentState(0, { submission: submissionOf(0, 1, review) })])));
      const block = await screen.findByTestId(`prep-document-${itemId(0)}-submission`);
      expect(screen.getByTestId(`prep-document-${itemId(0)}-submission-decision`)).toHaveTextContent(word, { exact: false });
      if (review.reason) expect(within(block).getByText(review.reason as string)).toBeTruthy();
      expect(within(block).getByText("8 окт. 2026 г., 11:30 (Бишкек)")).toBeTruthy();
      expect(within(block).getByText("Проверен:", { exact: false })).toBeTruthy();
      await view.unmount();
    }
  });

  it("сохранён, но не отправлен: заголовок, имя и версия; при уже отправленном прежнем - подсказка про историю", async () => {
    const items = [requirementItem(0, { slotStatus: "required" }), requirementItem(1, { slotStatus: "submitted", currentVersionId: versionId(1), currentVersionNo: "1", technicalAvailability: "available", unavailableReasons: [] })];
    const docs = [documentState(0, { savedDraft: draftOf(0, 4) }), documentState(1, { submission: submissionOf(1, 1, null), savedDraft: draftOf(1, 5) })];
    await open(handlers(readiness(requirements(items), docs)));
    const first = await screen.findByTestId(`prep-document-${itemId(0)}-draft`);
    expect(within(first).getByText("Сохранён, ещё не отправлен")).toBeTruthy();
    expect(within(first).getByText("scan-4.pdf")).toBeTruthy();
    expect(within(first).queryByText("Новый файл сохранён. Прежняя отправка и решение остаются в истории.")).toBeNull();
    const second = screen.getByTestId(`prep-document-${itemId(1)}-draft`);
    expect(within(second).getByText("Новый файл сохранён. Прежняя отправка и решение остаются в истории.")).toBeTruthy();
    expect(screen.getByTestId(`prep-document-${itemId(1)}-submission`)).toBeTruthy();
  });

  it("файл недоступен: причина словами, неизвестная причина общей строкой", async () => {
    const file = { technicalAvailability: "unavailable", unavailableReasons: ["malware_pending", "integrity_pending"] };
    const items = [requirementItem(0, { slotStatus: "submitted", currentVersionId: versionId(1), currentVersionNo: "1", unavailableReasons: ["integrity_pending", "malware_pending"] })];
    await open(handlers(readiness(requirements(items), [documentState(0, { submission: submissionOf(0, 1, null, file) })])));
    const block = await screen.findByTestId(`prep-document-${itemId(0)}-submission`);
    expect(within(block).getByText("Файл проходит проверку безопасности.")).toBeTruthy();
    expect(within(block).getByText("Проверяем файл.")).toBeTruthy();
  });
});

describe("«Открыть список документов»", () => {
  const uninitializedThenStarter = (extra: Handlers = {}) =>
    handlers((_args: unknown, call: number) => (call <= 2 ? uninitializedReadiness() : starterReadiness()), {
      student_initialize_application_requirements_v1: (args: Record<string, unknown> | undefined) => initializeReceipt(String(args?.p_request_id)),
      ...extra,
    });

  it("список не открыт, дело на сопровождении: пояснение и кнопка; нажатие открывает список по ответу сервера", async () => {
    const { calls } = await open(uninitializedThenStarter());
    expect(await screen.findByTestId("prep-uninitialized")).toHaveTextContent("Программа сохранена. Откройте список документов", { exact: false });
    expect(screen.getByTestId("prep-starter")).toBeTruthy();
    expect(screen.queryByTestId("prep-requirement-list")).toBeNull();
    await fireEvent.press(screen.getByTestId("prep-continue"));
    expect(await screen.findByTestId("prep-requirement-list")).toBeTruthy();
    // свежее чтение, запись с запросом, контрольное чтение
    expect(calls.map((c) => c.name).filter((name) => name !== "student_catalog_preparations_v1")).toEqual([
      "application_package_readiness_v1",
      "application_package_readiness_v1",
      "student_initialize_application_requirements_v1",
      "application_package_readiness_v1",
    ]);
    const write = calls.find((c) => c.name === "student_initialize_application_requirements_v1");
    expect(write?.args).toMatchObject({ p_application_id: APPLICATION_ID });
    expect(String(write?.args?.p_request_id)).toMatch(/^[0-9a-f-]{36}$/u);
    expect(screen.queryByTestId("prep-uninitialized")).toBeNull();
    expect(screen.queryByTestId("prep-error")).toBeNull();
    // читалке сказано, что список открыт
    expect(announceNative).toHaveBeenCalledWith("Список документов открыт.");
  });

  it("два нажатия раньше, чем экран успел выключить кнопку: чтение и запись идут один раз (замок экрана)", async () => {
    const { calls } = await open(uninitializedThenStarter());
    await screen.findByTestId("prep-continue");
    await pressTwiceInOneTick("prep-continue");
    expect(await screen.findByTestId("prep-requirement-list")).toBeTruthy();
    expect(calls.filter((c) => c.name === "student_initialize_application_requirements_v1")).toHaveLength(1);
    // чтение при открытии экрана, свежее чтение перед записью и контрольное после неё: по одному разу
    expect(calls.filter((c) => c.name === "application_package_readiness_v1")).toHaveLength(3);
  });

  it("два нажатия «Проверить состояние» в одном кадре читают один раз", async () => {
    const { calls } = await open(handlers(starterReadiness()));
    await screen.findByTestId("prep-requirement-list");
    const before = calls.filter((c) => c.name === "application_package_readiness_v1").length;
    await pressTwiceInOneTick("prep-check");
    await waitFor(() => expect(screen.getByTestId("prep-check")).toHaveTextContent("Проверить состояние", { exact: false }));
    expect(calls.filter((c) => c.name === "application_package_readiness_v1")).toHaveLength(before + 1);
  });

  it("пока идёт запись, кнопки заблокированы, подписи сменились", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { transport } = fakeTransport({
      student_catalog_preparations_v1: [row()],
      application_package_readiness_v1: (_args: unknown, call: number) => (call <= 2 ? uninitializedReadiness() : starterReadiness()),
      student_initialize_application_requirements_v1: undefined,
    });
    const slow: typeof transport = async (name, args, options) => {
      if (name === "student_initialize_application_requirements_v1") {
        await gate;
        return { data: initializeReceipt(String((args as Record<string, unknown>).p_request_id)), error: null, status: 200 };
      }
      return transport(name, args, options);
    };
    await renderPortal(<PreparationScreen applicationId={APPLICATION_ID} />, testApi(slow));
    await fireEvent.press(await screen.findByTestId("prep-continue"));
    await waitFor(() => expect(screen.getByTestId("prep-continue")).toHaveTextContent("Открываем список…", { exact: false }));
    expect(screen.getByTestId("prep-continue").props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId("prep-check").props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => release?.());
    expect(await screen.findByTestId("prep-requirement-list")).toBeTruthy();
    expect(screen.getByTestId("prep-check").props.accessibilityState).toMatchObject({ disabled: false });
  });

  it("дело без сопровождения: пояснение «нельзя открыть автоматически» и кнопки нет", async () => {
    const { calls } = await open(handlers(uninitializedReadiness()), { api: { canSelectPrograms: false } });
    expect(await screen.findByTestId("prep-uninitialized")).toHaveTextContent("Начальный список сейчас нельзя открыть автоматически.", { exact: false });
    expect(screen.queryByTestId("prep-continue")).toBeNull();
    expect(screen.queryByTestId("prep-starter")).toBeNull();
    expect(calls.some((c) => c.name === "student_initialize_application_requirements_v1")).toBe(false);
  });

  it("программа уже подана: кнопки нет, как у веба", async () => {
    await open(handlers(uninitializedReadiness(), {}, [row("submitted")]));
    expect(await screen.findByTestId("prep-uninitialized")).toBeTruthy();
    expect(screen.queryByTestId("prep-continue")).toBeNull();
  });

  it("отказ сервера: понятный текст, прежний запрос снят, чтение обновляется", async () => {
    const { calls } = await open(
      handlers(uninitializedReadiness(), {
        student_initialize_application_requirements_v1: failure("42501", 403),
      }),
    );
    await fireEvent.press(await screen.findByTestId("prep-continue"));
    expect(await screen.findByTestId("prep-error")).toHaveTextContent("Не получается открыть это сейчас. Проверьте, что вы вошли в свой аккаунт, и повторите.", { exact: false });
    expect(announceNative).toHaveBeenCalledWith("Не получается открыть это сейчас. Проверьте, что вы вошли в свой аккаунт, и повторите.");
    expect(calls.filter((c) => c.name === "application_package_readiness_v1")).toHaveLength(3);
    // кнопка снова доступна
    expect(screen.getByTestId("prep-continue").props.accessibilityState).toMatchObject({ disabled: false });
  });

  it("связи нет: «не получилось проверить», повторное нажатие шлёт ТОТ ЖЕ запрос", async () => {
    let first: string | null = null;
    let attempt = 0;
    const { calls } = await open(
      handlers((_args: unknown, call: number) => (call <= 4 ? uninitializedReadiness() : starterReadiness()), {
        student_initialize_application_requirements_v1: (args: Record<string, unknown> | undefined) => {
          attempt += 1;
          first ??= String(args?.p_request_id);
          // три первых вызова (одно нажатие с двумя повторами) - обрыв, четвёртый - успех
          if (attempt <= 3) throw new Error("Network request failed");
          return initializeReceipt(String(args?.p_request_id));
        },
      }),
    );
    await fireEvent.press(await screen.findByTestId("prep-continue"));
    expect(await screen.findByTestId("prep-error")).toHaveTextContent("Не получилось проверить, сохранилось ли действие.", { exact: false });
    await fireEvent.press(screen.getByTestId("prep-continue"));
    expect(await screen.findByTestId("prep-requirement-list")).toBeTruthy();
    const ids = calls.filter((c) => c.name === "student_initialize_application_requirements_v1").map((c) => c.args?.p_request_id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe(first);
  });

  it("список уже открыт другим путём: кнопка не пишет, показывается ответ сервера", async () => {
    // первое чтение (по нажатию «Проверить состояние») уже видит начальный список
    const { calls } = await open(handlers((_args: unknown, call: number) => (call === 1 ? uninitializedReadiness() : starterReadiness())));
    await screen.findByTestId("prep-continue");
    await fireEvent.press(screen.getByTestId("prep-continue"));
    await waitFor(() => expect(screen.queryByTestId("prep-uninitialized")).toBeNull());
    expect(calls.some((c) => c.name === "student_initialize_application_requirements_v1")).toBe(false);
    expect(screen.getByTestId("prep-requirement-list")).toBeTruthy();
  });
});

describe("«Проверить состояние» и сбои чтения", () => {
  it("перечитывает требования и подписывает кнопку на время чтения", async () => {
    const { calls } = await open(handlers((_args: unknown, call: number) => (call === 1 ? starterReadiness() : readiness(requirements([requirementItem(0, { label: "Новое требование" })])))));
    await screen.findByTestId("prep-requirement-list");
    expect(screen.getByTestId("prep-check")).toHaveTextContent("Проверить состояние", { exact: false });
    await fireEvent.press(screen.getByTestId("prep-check"));
    expect(await screen.findByText("Новое требование")).toBeTruthy();
    expect(calls.filter((c) => c.name === "application_package_readiness_v1")).toHaveLength(2);
    expect(screen.queryByTestId("prep-error")).toBeNull();
  });

  it("успешная проверка состояния озвучивается читалке; сбой при прежнем ответе озвучивается пометкой «Не удалось обновить»", async () => {
    await open(handlers((_args: unknown, call: number) => (call === 1 ? starterReadiness() : call === 2 ? starterReadiness() : failure("PT500", 500))));
    await screen.findByTestId("prep-requirement-list");
    announceNative.mockClear();
    await fireEvent.press(screen.getByTestId("prep-check"));
    await waitFor(() => expect(announceNative).toHaveBeenCalledWith("Состояние документов обновлено."));
    announceNative.mockClear();
    await fireEvent.press(screen.getByTestId("prep-check"));
    await waitFor(() => expect(announceNative).toHaveBeenCalledWith("Не удалось обновить. Показаны последние полученные данные."));
    expect(announceNative).not.toHaveBeenCalledWith("Состояние документов обновлено.");
  });

  it("чтение требований не удалось: «Не удалось загрузить требования», кнопка «Проверить состояние» читает снова", async () => {
    const { calls } = await open(handlers((_args: unknown, call: number) => (call === 1 ? failure("PT500", 500) : starterReadiness())));
    expect(await screen.findByTestId("prep-requirements-error")).toHaveTextContent("Не удалось загрузить требования этой программы.", { exact: false });
    // шапка при этом остаётся: выбор сохранён
    expect(screen.getByTestId("prep-title")).toHaveTextContent("Информатика", { exact: false });
    expect(screen.queryByTestId("prep-requirement-list")).toBeNull();
    await fireEvent.press(screen.getByTestId("prep-check"));
    expect(await screen.findByTestId("prep-requirement-list")).toBeTruthy();
    expect(screen.queryByTestId("prep-requirements-error")).toBeNull();
    expect(calls.filter((c) => c.name === "application_package_readiness_v1")).toHaveLength(2);
  });

  it("неудачное обновление оставляет прежний список с пометкой «Не удалось обновить»; повтор читает снова и убирает пометку", async () => {
    const { calls } = await open(handlers((_args: unknown, call: number) => (call === 1 ? starterReadiness() : call === 2 ? failure(null, 0) : readiness(requirements([requirementItem(0, { label: "Новое требование" })])))));
    await screen.findByTestId("prep-requirement-list");
    expect(screen.queryByTestId("prep-requirements-stale")).toBeNull();
    await fireEvent.press(screen.getByTestId("prep-check"));
    const stale = await screen.findByTestId("prep-requirements-stale");
    expect(within(stale).getByText("Не удалось обновить. Показаны последние полученные данные.")).toBeTruthy();
    // список остался, второго текста ошибки нет, полной ошибки «не удалось загрузить» тоже
    expect(screen.getByTestId("prep-requirement-list")).toBeTruthy();
    expect(screen.queryByTestId("prep-error")).toBeNull();
    expect(screen.queryByTestId("prep-requirements-error")).toBeNull();
    // «Повторить» в пометке читает требования заново
    await fireEvent.press(within(stale).getByText("Повторить"));
    expect(await screen.findByText("Новое требование")).toBeTruthy();
    expect(screen.queryByTestId("prep-requirements-stale")).toBeNull();
    expect(calls.filter((c) => c.name === "application_package_readiness_v1")).toHaveLength(3);
  });

  it("сбой чтения не от нажатия (опрос, возврат на экран) тоже оставляет список и показывает пометку", async () => {
    const view = await open(handlers((_args: unknown, call: number) => (call === 1 ? starterReadiness() : failure("PT500", 500))));
    await screen.findByTestId("prep-requirement-list");
    // обновление «потянуть вниз» читает без нажатия на «Проверить состояние»
    await act(async () => {
      await screen.getByTestId("screen-scroll").props.refreshControl.props.onRefresh();
    });
    expect(await screen.findByTestId("prep-requirements-stale")).toBeTruthy();
    expect(screen.getByTestId("prep-requirement-list")).toBeTruthy();
    expect(view.calls.filter((c) => c.name === "application_package_readiness_v1").length).toBeGreaterThanOrEqual(2);
  });

  it("первого ответа не было: полная ошибка, пометки «Не удалось обновить» нет", async () => {
    await open(handlers(failure("PT500", 500)));
    expect(await screen.findByTestId("prep-requirements-error")).toBeTruthy();
    expect(screen.queryByTestId("prep-requirements-stale")).toBeNull();
  });

  it("ответа не было, «Проверить состояние» снова не удалось: текст «не удалось загрузить» один раз и озвучен тот же", async () => {
    await open(handlers(failure("PT500", 500)));
    await screen.findByTestId("prep-requirements-error");
    announceNative.mockClear();
    await fireEvent.press(screen.getByTestId("prep-check"));
    await waitFor(() => expect(announceNative).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText(/Не удалось загрузить требования этой программы/u)).toHaveLength(1);
    expect(screen.queryByTestId("prep-error")).toBeNull();
    expect(announceNative).toHaveBeenCalledWith(expect.stringContaining("Не удалось загрузить требования этой программы."));
  });

  it("запись удалась, контрольное чтение нет, прежний список на экране: озвучена пометка со списка, а не «список открыт» и не ошибка раздела", async () => {
    const { calls } = await open(
      handlers((_args: unknown, call: number) => (call <= 2 ? uninitializedReadiness() : failure("PT500", 500)), {
        student_initialize_application_requirements_v1: (args: Record<string, unknown> | undefined) => initializeReceipt(String(args?.p_request_id)),
      }),
    );
    await fireEvent.press(await screen.findByTestId("prep-continue"));
    expect(await screen.findByTestId("prep-requirements-stale")).toBeTruthy();
    expect(calls.filter((c) => c.name === "student_initialize_application_requirements_v1")).toHaveLength(1);
    expect(announceNative).toHaveBeenCalledWith("Не удалось обновить. Показаны последние полученные данные.");
    expect(announceNative).not.toHaveBeenCalledWith("Список документов открыт.");
    // на экране одна пометка: ни второго текста ошибки, ни полной ошибки раздела
    expect(screen.queryByTestId("prep-error")).toBeNull();
    expect(screen.queryByTestId("prep-requirements-error")).toBeNull();
  });

  it("чужая форма ответа - это сбой данных, а не пустой список", async () => {
    await open(handlers({ protocolVersion: 1, requirements: null }));
    expect(await screen.findByTestId("prep-requirements-error")).toBeTruthy();
    expect(screen.queryByTestId("prep-requirement-list")).toBeNull();
  });
});

describe("нет программы и сбой списка", () => {
  it("программы нет в прежнем списке, а свежий список не прочитался (нет связи): ошибка списка с повтором, а не «не найдена»", async () => {
    const { calls } = await open(
      handlers(starterReadiness(), {
        // прежний список без этой программы; обновление (потянуть вниз) не удаётся; повтор приносит список с программой
        student_catalog_preparations_v1: (_args: unknown, call: number) => (call === 1 ? [preparationRow(2)] : call === 2 ? failure("PT500", 500) : [preparationRow(1)]),
      }),
    );
    expect(await screen.findByTestId("prep-not-found")).toBeTruthy();
    await act(async () => {
      await screen.getByTestId("screen-scroll").props.refreshControl.props.onRefresh();
    });
    const alert = await screen.findByTestId("prep-error-list");
    expect(screen.queryByTestId("prep-not-found")).toBeNull();
    await fireEvent.press(within(alert).getByText("Повторить"));
    expect(await screen.findByTestId("prep-title")).toHaveTextContent("Информатика", { exact: false });
    expect(screen.queryByTestId("prep-error-list")).toBeNull();
    expect(calls.filter((c) => c.name === "student_catalog_preparations_v1")).toHaveLength(3);
  });

  it("программы с таким идентификатором в списке студента нет: «не найдена», запрос требований не уходит", async () => {
    const { calls } = await open(handlers(starterReadiness(), {}, [preparationRow(2)]));
    expect(await screen.findByTestId("prep-not-found")).toHaveTextContent("Эта программа не найдена в вашем списке.", { exact: false });
    expect(calls.some((c) => c.name === "application_package_readiness_v1")).toBe(false);
    expect(screen.getByTestId("prep-back")).toBeTruthy();
  });

  it("программу только что добавили, а список в кэше прежний: пока он перечитывается, «не найдена» не показывается", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let lists = 0;
    const { transport } = fakeTransport({ student_catalog_preparations_v1: [], application_package_readiness_v1: starterReadiness() });
    const slowSecond: typeof transport = async (name, args, options) => {
      if (name === "student_catalog_preparations_v1" && (lists += 1) === 2) {
        await gate;
        return { data: [row()], error: null, status: 200 };
      }
      return transport(name, args, options);
    };
    const view = await renderPortal(<PreparationScreen applicationId={APPLICATION_ID} />, testApi(slowSecond));
    expect(await screen.findByTestId("prep-not-found")).toBeTruthy();
    // страница вуза после «Добавить» объявляет список устаревшим
    await act(async () => {
      void view.client.invalidateQueries({ queryKey: ["portal", "user-test", "preparations"] });
    });
    await waitFor(() => expect(screen.getByTestId("prep-loading")).toBeTruthy());
    expect(screen.queryByTestId("prep-not-found")).toBeNull();
    await act(async () => release?.());
    expect(await screen.findByTestId("prep-title")).toHaveTextContent("Информатика", { exact: false });
    expect(screen.queryByTestId("prep-not-found")).toBeNull();
  });

  it("негодный идентификатор в ссылке: «не найдена» без единого запроса", async () => {
    for (const id of ["", "..", "not-a-uuid", "../universities"]) {
      const { calls, unmount } = await open(handlers(starterReadiness()), { id });
      expect(screen.getByTestId("prep-not-found")).toBeTruthy();
      expect(calls).toHaveLength(0);
      await unmount();
    }
  });

  it("идентификатор в верхнем регистре читается как нижний (как на веб-странице)", async () => {
    await open(handlers(starterReadiness()), { id: APPLICATION_ID.toUpperCase() });
    expect(await screen.findByTestId("prep-title")).toHaveTextContent("Информатика", { exact: false });
  });

  it("список программ не загрузился: плашка с повтором, без текста сервера", async () => {
    const { calls } = await open(handlers(starterReadiness(), { student_catalog_preparations_v1: failure("PT500", 500) }));
    expect(await screen.findByTestId("prep-error-list")).toBeTruthy();
    expect(screen.getByText("Сервис временно недоступен. Повторите позже.")).toBeTruthy();
    expect(screen.queryByTestId("prep-title")).toBeNull();
    expect(calls.some((c) => c.name === "application_package_readiness_v1")).toBe(false);
  });

  it("список программ загружается: скелетон с подписью для читалки", async () => {
    const never = new Promise(() => undefined);
    const { transport } = fakeTransport({ student_catalog_preparations_v1: [], application_package_readiness_v1: [] });
    const hung: typeof transport = (name, args, options) => (name === "student_catalog_preparations_v1" ? never.then(() => ({ data: null, error: null })) : transport(name, args, options));
    await renderPortal(<PreparationScreen applicationId={APPLICATION_ID} />, testApi(hung));
    expect(screen.getByTestId("prep-loading").props.accessibilityLabel).toBe("Загрузка");
  });
});

describe("ссылки внизу", () => {
  it("сопровождение: «Все мои документы» и «Написать куратору» ведут в документы и в чат", async () => {
    await open(handlers(starterReadiness()));
    await fireEvent.press(await screen.findByTestId("prep-all-documents"));
    expect(navigate).toHaveBeenCalledWith("/documents");
    await fireEvent.press(screen.getByTestId("prep-write"));
    expect(navigate).toHaveBeenCalledWith("/messages/chat");
    expect(screen.getByTestId("prep-all-documents")).toHaveTextContent("Все мои документы", { exact: false });
    expect(screen.getByTestId("prep-write")).toHaveTextContent("Написать куратору", { exact: false });
  });

  it("без сопровождения (approved): раздела «Документы» и беседы нет, ссылок тоже нет", async () => {
    await open(handlers(starterReadiness()), { api: { tier: "approved", canSelectPrograms: false } });
    await screen.findByTestId("prep-requirement-list");
    expect(screen.queryByTestId("prep-all-documents")).toBeNull();
    expect(screen.queryByTestId("prep-write")).toBeNull();
  });
});

describe("читалка", () => {
  it("заголовки: программа и каждое требование; кнопки с понятными подписями", async () => {
    await open(handlers(starterReadiness()));
    await screen.findByTestId("prep-requirement-list");
    const headers = screen.getAllByRole("header").map((node) => node.props.children as string);
    expect(headers).toEqual(expect.arrayContaining(["Информатика", "Документы для этой программы", "Требование 1", "Требование 2"]));
    expect(screen.getByRole("button", { name: "Проверить состояние" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "К моему поступлению" })).toBeTruthy();
  });
});
