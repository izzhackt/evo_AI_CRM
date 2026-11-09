import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AdmissionScreen } from "@/features/admission/AdmissionScreen";
import { NOTIFICATION_ROW, OVERVIEW_ROW, OVERVIEW_ROW_EMPTY, PAYMENT_ROW } from "@/test-fixtures/rpc-rows";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport, preparationRow, universityRow, uuidN } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));

const navigate = router.navigate as jest.Mock;
const params = useLocalSearchParams as jest.Mock;
const saved = (country: string) => ({ country, source: "saved", savedAt: "2026-11-01T08:00:00+00:00" });
const favorites = (n: number) => Array.from({ length: n }, (_, i) => ({ institutionId: uuidN(i + 1), createdAt: "2026-10-01T00:00:00+00:00" }));
const byIds = (args?: Record<string, unknown>) => ({ items: ((args?.p_institution_ids as string[]) ?? []).map((id) => universityRow(Number(id.slice(-12)))), nextOffset: null });

function handlers(country = "MY", extra: Record<string, unknown> = {}) {
  return {
    student_portal_overview_v2: [OVERVIEW_ROW],
    student_portal_finance_v2: [PAYMENT_ROW],
    student_portal_notifications_v2: [NOTIFICATION_ROW],
    student_country_choice_v1: saved(country),
    student_university_favorites_v1: favorites(2),
    student_university_catalog_by_ids_v1: byIds,
    student_catalog_preparations_v1: [preparationRow(1)],
    ...extra,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  navigate.mockClear();
  params.mockReturnValue({});
});

describe("Поступление: сводка", () => {
  it("название, плитки с числами, задача EVO", async () => {
    const { transport } = fakeTransport(handlers());
    await renderPortal(<AdmissionScreen />, testApi(transport));
    expect(screen.getByText("Моё поступление")).toBeTruthy();
    expect(await screen.findByTestId("tile-favorites")).toBeTruthy();
    expect(screen.getByTestId("tile-favorites").props.accessibilityLabel).toBe("Вузов в избранном: 2");
    expect(await screen.findByTestId("tile-programs")).toBeTruthy();
    expect(screen.getByTestId("tile-programs").props.accessibilityLabel).toBe("Выбранных программ: 1");
    expect(await screen.findByTestId("evo-title")).toHaveTextContent("Проверить анкету");
    expect(screen.getByText("в работе")).toBeTruthy();
    expect(screen.getByText("Срок: 13.09.2026")).toBeTruthy();
  });

  it("approved: «Ваша анкета», без задачи EVO и без чтений дела", async () => {
    const { transport, calls } = fakeTransport(handlers());
    await renderPortal(<AdmissionScreen />, testApi(transport, { tier: "approved" }));
    expect(screen.getByText("Ваша анкета")).toBeTruthy();
    expect(screen.getByText("Менеджер свяжется с вами.")).toBeTruthy();
    await screen.findByTestId("journey-fold");
    expect(screen.queryByTestId("evo-title")).toBeNull();
    expect(calls.map((c) => c.name)).not.toContain("student_portal_overview_v2");
    // без дела прогресса нет: строки «Сейчас:» нет, весь путь виден сразу
    expect(screen.queryByTestId("journey-now")).toBeNull();
    expect(screen.getByTestId("journey-body")).toBeTruthy();
    expect(screen.queryByTestId("meter-current", { hidden: true })).toBeNull();
  });

  it("сбой обзора: плашка с повтором, остальное на месте", async () => {
    const { transport } = fakeTransport(handlers("MY", { student_portal_overview_v2: failure(null, 503) }));
    await renderPortal(<AdmissionScreen />, testApi(transport));
    expect(await screen.findByTestId("overview-error")).toBeTruthy();
    expect(screen.getByText("Сервис временно недоступен. Повторите позже.")).toBeTruthy();
    expect(await screen.findByTestId("tile-favorites")).toBeTruthy();
    expect(screen.getByTestId("journey-fold")).toBeTruthy();
  });
});

describe("Поступление: путь страны", () => {
  it("assisted: «Сейчас:» с текущим шагом, полоса с маркером, путь свёрнут", async () => {
    const { transport } = fakeTransport(handlers("MY"));
    await renderPortal(<AdmissionScreen />, testApi(transport));
    expect(await screen.findByText("Путь поступления: Малайзия")).toBeTruthy();
    const now = await screen.findByTestId("journey-now");
    expect(now.props.accessibilityLabel).toContain("Договор и документы");
    expect(now.props.accessibilityLabel).toContain("Шаг 2 из 7");
    expect(screen.getAllByTestId("meter-done", { hidden: true })).toHaveLength(1);
    expect(screen.getAllByTestId("meter-current", { hidden: true })).toHaveLength(1);
    expect(screen.getAllByTestId("meter-upcoming", { hidden: true })).toHaveLength(5);
    expect(screen.queryByTestId("journey-body")).toBeNull(); // свёрнут, пока есть текущий шаг
    expect(screen.getByText("Все шаги")).toBeTruthy();
  });

  it("«Все шаги» раскрывает путь; пройденные в одной строке; шаг раскрывается в пункты", async () => {
    const { transport } = fakeTransport(handlers("MY"));
    await renderPortal(<AdmissionScreen />, testApi(transport));
    await screen.findByTestId("journey-now");
    await fireEvent.press(screen.getByTestId("journey-fold"));
    expect(await screen.findByTestId("journey-body")).toBeTruthy();
    expect(screen.getByText("Свернуть")).toBeTruthy();
    expect(screen.getByText("Пройдено")).toBeTruthy();
    expect(screen.queryByTestId("step-my-1-route")).toBeNull(); // пройденный скрыт, пока не раскрыта строка
    expect(screen.getByTestId("step-my-2-documents")).toBeTruthy();
    expect(screen.getByTestId("step-my-7-first-weeks")).toBeTruthy();

    const toggle = screen.getByTestId("step-toggle-my-2-documents");
    expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });
    expect(toggle.props.accessibilityLabel).toContain("Шаг 2 из 7");
    expect(toggle.props.accessibilityLabel).toContain("Сейчас");
    await fireEvent.press(toggle);
    await waitFor(() => expect(screen.getByTestId("step-toggle-my-2-documents").props.accessibilityState).toMatchObject({ expanded: true }));
    const step = screen.getByTestId("step-my-2-documents");
    expect(within(step).getByText("Что входит в шаг")).toBeTruthy();
    expect(within(step).getByText("Когда шаг пройден")).toBeTruthy();
    expect(within(step).getAllByText(/^(Вы|EVO|Университет|Посольство)$/).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByTestId("journey-done-toggle"));
    expect(await screen.findByTestId("step-my-1-route")).toBeTruthy();
    expect(screen.getByText("Важно знать")).toBeTruthy();
  });

  it("строка «Сейчас» раскрывает путь и текущий шаг", async () => {
    const { transport } = fakeTransport(handlers("MY"));
    await renderPortal(<AdmissionScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("journey-now"));
    await screen.findByTestId("journey-body");
    await waitFor(() => expect(screen.getByTestId("step-toggle-my-2-documents").props.accessibilityState).toMatchObject({ expanded: true }));
  });

  it("переход «Весь путь» с Главной раскрывает путь", async () => {
    params.mockReturnValue({ path: "open" });
    const { transport } = fakeTransport(handlers("MY"));
    await renderPortal(<AdmissionScreen />, testApi(transport));
    expect(await screen.findByTestId("journey-body")).toBeTruthy();
  });

  it("текущий шаг документов ведёт в Документы; ссылка на CSCA ведёт во вкладку", async () => {
    const { transport } = fakeTransport(handlers("CN"));
    await renderPortal(<AdmissionScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("journey-now"));
    await fireEvent.press(await screen.findByTestId("journey-open-documents"));
    expect(navigate).toHaveBeenCalledWith("/documents");
    await waitFor(() => expect(screen.getByTestId("link-csca")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("link-csca"));
    expect(navigate).toHaveBeenCalledWith("/csca");
  });

  it("без дела на сопровождении (план не опубликован) путь без прогресса", async () => {
    const { transport } = fakeTransport(handlers("MY", { student_portal_overview_v2: [], student_portal_finance_v2: [] }));
    await renderPortal(<AdmissionScreen />, testApi(transport));
    await screen.findByTestId("journey-fold");
    await waitFor(() => expect(screen.queryByTestId("journey-now")).toBeNull());
    expect(screen.getByTestId("journey-body")).toBeTruthy();
  });

  it("«Пока не решил»: общий путь без названия страны", async () => {
    const { transport } = fakeTransport(handlers("UNDECIDED"));
    await renderPortal(<AdmissionScreen />, testApi(transport));
    expect(await screen.findByText("Путь поступления")).toBeTruthy();
  });

  it("смена страны: выбор открывается, пишет запрос и обновляет путь", async () => {
    let choice: unknown = saved("MY");
    const { transport, calls } = fakeTransport(
      handlers("MY", {
        student_country_choice_v1: () => choice,
        set_student_country_choice_v1: (args: Record<string, unknown> | undefined) => (choice = saved(args?.p_country as string)),
      }),
    );
    await renderPortal(<AdmissionScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("change-country"));
    const my = await screen.findByTestId("country-MY");
    expect(my.props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByTestId("country-AE"));
    await screen.findByText("Путь поступления: ОАЭ");
    expect(screen.queryByTestId("country-AE")).toBeNull(); // выбор закрылся
    expect(calls.find((c) => c.name === "set_student_country_choice_v1")?.args).toMatchObject({ p_country: "AE" });
  });

  it("повторный выбор уже сохранённой страны ничего не пишет", async () => {
    const { transport, calls } = fakeTransport(handlers("MY"));
    await renderPortal(<AdmissionScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("change-country"));
    await fireEvent.press(await screen.findByTestId("country-MY"));
    await waitFor(() => expect(screen.queryByTestId("country-MY")).toBeNull());
    expect(calls.map((c) => c.name)).not.toContain("set_student_country_choice_v1");
  });

  it("страна из анкеты: подпись источника; выбор той же страны всё же сохраняется", async () => {
    const { transport, calls } = fakeTransport(
      handlers("MY", {
        student_country_choice_v1: { country: "MY", source: "application", savedAt: null },
        set_student_country_choice_v1: saved("MY"),
      }),
    );
    await renderPortal(<AdmissionScreen />, testApi(transport));
    expect(await screen.findByText("Страна из вашей анкеты.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("change-country"));
    await fireEvent.press(await screen.findByTestId("country-MY"));
    await waitFor(() => expect(calls.map((c) => c.name)).toContain("set_student_country_choice_v1"));
  });

  it("страны нет: вместо пути выбор страны", async () => {
    const { transport } = fakeTransport(handlers("MY", { student_country_choice_v1: { country: null, source: "none", savedAt: null } }));
    await renderPortal(<AdmissionScreen />, testApi(transport));
    expect(await screen.findByText("Выберите страну")).toBeTruthy();
    expect(screen.queryByTestId("journey-fold")).toBeNull();
  });

  it("кыргызский язык: заголовок и подписи шагов", async () => {
    const { transport } = fakeTransport(handlers("MY"));
    await renderPortal(<AdmissionScreen />, testApi(transport), "ky");
    expect(await screen.findByText("Менин тапшыруум")).toBeTruthy();
    expect(await screen.findByText("Бардык кадамдар")).toBeTruthy();
  });
});

describe("Поступление: вкладки", () => {
  it("Вузы по умолчанию; Программы показывают выбор и статус", async () => {
    const { transport } = fakeTransport(handlers("MY"));
    await renderPortal(<AdmissionScreen />, testApi(transport));
    expect(await screen.findByTestId(`fav-${uuidN(1)}`)).toBeTruthy();
    expect(screen.getByTestId("tab-universities").props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByTestId("tab-programs"));
    const row = await screen.findByTestId(`program-${uuidN(1, "bbbbbbbb")}`);
    expect(within(row).getByText("Информатика")).toBeTruthy();
    expect(within(row).getByText("Осень 2027")).toBeTruthy();
    expect(within(row).getByText("Сроки этого набора нужно подтвердить с куратором.")).toBeTruthy();
    expect(screen.getByText("Выбранные программы")).toBeTruthy();
  });

  it("пустые состояния: нет вузов, нет программ", async () => {
    const { transport } = fakeTransport(handlers("MY", { student_university_favorites_v1: [], student_catalog_preparations_v1: [] }));
    await renderPortal(<AdmissionScreen />, testApi(transport));
    expect(await screen.findByText("Пока ничего не сохранено")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("tab-programs"));
    expect(await screen.findByText("Вы пока не выбрали программу. Откройте университет и выберите подходящий набор.")).toBeTruthy();
  });

  it("выбор программ закрыт для дела: подсказка про каталог", async () => {
    const { transport } = fakeTransport(handlers("MY", { student_catalog_preparations_v1: [] }));
    await renderPortal(<AdmissionScreen />, testApi(transport, { canSelectPrograms: false }));
    await fireEvent.press(screen.getByTestId("tab-programs"));
    expect(await screen.findByText(/Пока здесь пусто\. Программы появятся/)).toBeTruthy();
  });

  it("сбой чтения программ: плашка и повтор, без текста сервера", async () => {
    let attempt = 0;
    const { transport } = fakeTransport(handlers("MY", { student_catalog_preparations_v1: () => (++attempt === 1 ? failure("XX000", 500) : [preparationRow(1)]) }));
    await renderPortal(<AdmissionScreen />, testApi(transport));
    await fireEvent.press(screen.getByTestId("tab-programs"));
    const alert = await screen.findByTestId("programs-error");
    expect(within(alert).getByText("Сервис временно недоступен. Повторите позже.")).toBeTruthy();
    await fireEvent.press(within(alert).getByText("Повторить"));
    expect(await screen.findByTestId(`program-${uuidN(1, "bbbbbbbb")}`)).toBeTruthy();
  });

  it("чужая форма строки подготовки не показывается", async () => {
    const { transport } = fakeTransport(handlers("MY", { student_catalog_preparations_v1: [{ ...preparationRow(1), studentCaseId: uuidN(9) }] }));
    await renderPortal(<AdmissionScreen />, testApi(transport));
    await fireEvent.press(screen.getByTestId("tab-programs"));
    expect(await screen.findByTestId("programs-error")).toBeTruthy();
  });

  it("пустой обзор без плана и без задач не ломает экран", async () => {
    const { transport } = fakeTransport(handlers("MY", { student_portal_overview_v2: [OVERVIEW_ROW_EMPTY], student_portal_finance_v2: [] }));
    await renderPortal(<AdmissionScreen />, testApi(transport));
    await screen.findByTestId("tile-favorites");
    expect(screen.queryByTestId("evo-title")).toBeNull();
  });
});
