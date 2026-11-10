import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router, useLocalSearchParams } from "expo-router";

import { HomeScreen } from "@/features/home/HomeScreen";
import { NOTIFICATION_ROW, OVERVIEW_ROW, OVERVIEW_ROW_EMPTY, PAYMENT_ROW } from "@/test-fixtures/rpc-rows";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport, preparationRow, universityRow, uuidN } from "@/test-fixtures/universities";

jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
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

describe("Главная: задача EVO и анкета (бывшая сводка «Поступления»)", () => {
  it("нет отдельного заголовка «Моё поступление» и плиток: числа стоят во вкладках «Мой список»; задача EVO есть", async () => {
    const { transport } = fakeTransport(handlers());
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(screen.queryByText("Моё поступление")).toBeNull();
    expect(screen.queryByTestId("tile-favorites")).toBeNull();
    expect(await screen.findByText("Вузы 2")).toBeTruthy();
    expect(await screen.findByText("Мои программы 1")).toBeTruthy();
    expect(await screen.findByTestId("evo-title")).toHaveTextContent("Проверить анкету");
    expect(screen.getByText("в работе")).toBeTruthy();
    expect(screen.getByText("Срок: 13.09.2026")).toBeTruthy();
  });

  it("approved: ровно одна карточка «Ваша анкета», без задачи EVO и без чтений дела", async () => {
    const { transport, calls } = fakeTransport(handlers());
    await renderPortal(<HomeScreen />, testApi(transport, { tier: "approved" }));
    expect(screen.getAllByText("Ваша анкета")).toHaveLength(1);
    expect(screen.getByText("Менеджер свяжется с вами.")).toBeTruthy();
    await screen.findByTestId("journey-fold");
    expect(screen.queryByTestId("evo-title")).toBeNull();
    expect(screen.queryByTestId("chat-fab")).toBeNull();
    expect(calls.map((c) => c.name)).not.toContain("student_portal_overview_v2");
    // без дела прогресса нет: строки «Сейчас:» нет, весь путь виден сразу
    expect(screen.queryByTestId("journey-now")).toBeNull();
    expect(screen.getByTestId("journey-body")).toBeTruthy();
    expect(screen.queryByTestId("meter-current", { hidden: true })).toBeNull();
  });

  it("сбой обзора: плашка с повтором в «Что сделать сейчас», остальное на месте", async () => {
    const { transport } = fakeTransport(handlers("MY", { student_portal_overview_v2: failure(null, 503) }));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByTestId("card-error")).toBeTruthy();
    expect(screen.getByText("Сервис временно недоступен. Повторите позже.")).toBeTruthy();
    expect(await screen.findByText("Вузы 2")).toBeTruthy();
    expect(screen.getByTestId("journey-fold")).toBeTruthy();
  });
});

describe("Главная: весь «Путь поступления»", () => {
  it("assisted: «Сейчас:» с текущим шагом, полоса с маркером, путь свёрнут", async () => {
    const { transport } = fakeTransport(handlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByText("Путь поступления: Малайзия")).toBeTruthy();
    const now = await screen.findByTestId("journey-now");
    expect(now.props.accessibilityLabel).toContain("Договор и документы");
    expect(now.props.accessibilityLabel).toContain("Шаг 2 из 7");
    // полоса есть и на карточке пути, и в полном пути (как на вебе): по одному набору на каждую
    expect(screen.getAllByTestId("meter-done", { hidden: true })).toHaveLength(2);
    expect(screen.getAllByTestId("meter-current", { hidden: true })).toHaveLength(2);
    expect(screen.getAllByTestId("meter-upcoming", { hidden: true })).toHaveLength(10);
    expect(screen.queryByTestId("journey-body")).toBeNull(); // свёрнут, пока есть текущий шаг
    expect(screen.getByText("Все шаги")).toBeTruthy();
  });

  it("«Все шаги» раскрывает путь; пройденные в одной строке; шаг раскрывается в пункты", async () => {
    const { transport } = fakeTransport(handlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
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
    await renderPortal(<HomeScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("journey-now"));
    await screen.findByTestId("journey-body");
    await waitFor(() => expect(screen.getByTestId("step-toggle-my-2-documents").props.accessibilityState).toMatchObject({ expanded: true }));
  });

  it("ссылка ?path=open (в том числе из старого /overview) раскрывает путь", async () => {
    params.mockReturnValue({ path: "open" });
    const { transport } = fakeTransport(handlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByTestId("journey-body")).toBeTruthy();
  });

  it("повторная ссылка ?path=open с новой меткой раскрывает путь, который студент свернул", async () => {
    params.mockReturnValue({ path: "open", at: "1" });
    const { transport } = fakeTransport(handlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport, { tier: "approved" }));
    expect(await screen.findByTestId("journey-body")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("journey-fold"));
    await waitFor(() => expect(screen.queryByTestId("journey-body")).toBeNull());
    params.mockReturnValue({ path: "open", at: "2" });
    // любое нажатие на экране перерисовывает его уже с новыми параметрами ссылки
    await fireEvent.press(screen.getByTestId("tab-programs"));
    expect(await screen.findByTestId("journey-body")).toBeTruthy();
  });

  it("approved: «Открыть анкету» ведёт на экран анкеты", async () => {
    const { transport } = fakeTransport(handlers());
    await renderPortal(<HomeScreen />, testApi(transport, { tier: "approved" }));
    await fireEvent.press(screen.getByTestId("application-open"));
    expect(navigate).toHaveBeenCalledWith("/application");
  });

  it("текущий шаг документов ведёт в Документы; ссылка на CSCA ведёт во вкладку", async () => {
    const { transport } = fakeTransport(handlers("CN"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("journey-now"));
    await fireEvent.press(await screen.findByTestId("journey-open-documents"));
    expect(navigate).toHaveBeenCalledWith("/documents");
    await waitFor(() => expect(screen.getByTestId("link-csca")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("link-csca"));
    expect(navigate).toHaveBeenCalledWith("/csca");
  });

  it("без дела на сопровождении (план не опубликован) путь без прогресса", async () => {
    const { transport } = fakeTransport(handlers("MY", { student_portal_overview_v2: [], student_portal_finance_v2: [] }));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("journey-fold");
    await waitFor(() => expect(screen.queryByTestId("journey-now")).toBeNull());
    expect(screen.getByTestId("journey-body")).toBeTruthy();
  });

  it("«Пока не решил»: общий путь без названия страны", async () => {
    const { transport } = fakeTransport(handlers("UNDECIDED"));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect((await screen.findAllByText("Путь поступления")).length).toBeGreaterThan(0);
  });

  it("смена страны: выбор открывается, пишет запрос и обновляет путь", async () => {
    let choice: unknown = saved("MY");
    const { transport, calls } = fakeTransport(
      handlers("MY", {
        student_country_choice_v1: () => choice,
        set_student_country_choice_v1: (args: Record<string, unknown> | undefined) => (choice = saved(args?.p_country as string)),
      }),
    );
    await renderPortal(<HomeScreen />, testApi(transport));
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
    await renderPortal(<HomeScreen />, testApi(transport));
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
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByText("Страна из вашей анкеты.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("change-country"));
    await fireEvent.press(await screen.findByTestId("country-MY"));
    await waitFor(() => expect(calls.map((c) => c.name)).toContain("set_student_country_choice_v1"));
  });

  it("страны нет: вместо пути выбор страны", async () => {
    const { transport } = fakeTransport(handlers("MY", { student_country_choice_v1: { country: null, source: "none", savedAt: null } }));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByText("Выберите страну")).toBeTruthy();
    expect(screen.queryByTestId("journey-fold")).toBeNull();
  });

  it("кыргызский язык: заголовок и подписи шагов", async () => {
    const { transport } = fakeTransport(handlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport), "ky");
    expect(await screen.findByText("Менин тизмем")).toBeTruthy();
    expect(await screen.findByText("Бардык кадамдар")).toBeTruthy();
  });
});

describe("Главная: «Мой список»", () => {
  it("Вузы по умолчанию; Программы показывают выбор и статус", async () => {
    const { transport } = fakeTransport(handlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByTestId(`fav-${uuidN(1)}`)).toBeTruthy();
    expect(screen.getByTestId("tab-universities").props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByTestId("tab-programs"));
    const row = await screen.findByTestId(`program-${uuidN(1, "bbbbbbbb")}`);
    expect(within(row).getByText("Информатика")).toBeTruthy();
    expect(within(row).getByText("Осень 2027")).toBeTruthy();
    expect(within(row).getByText("Сроки этого набора нужно подтвердить с куратором.")).toBeTruthy();
    expect(screen.getByText("Мои программы 1")).toBeTruthy();
  });

  it("«Мои вузы»: карточки с названием и «город · страна», фото только из бакета, без фото - подложка", async () => {
    const withPhoto = (args?: Record<string, unknown>) => ({
      items: ((args?.p_institution_ids as string[]) ?? []).map((id) => {
        const n = Number(id.slice(-12));
        const row = universityRow(n);
        return n === 1 ? { ...row, content: { ...row.content, photoKey: "sunway" } } : row;
      }),
      nextOffset: null,
    });
    const { transport } = fakeTransport(handlers("MY", { student_university_catalog_by_ids_v1: withPhoto }));
    await renderPortal(<HomeScreen />, testApi(transport));
    const first = await screen.findByTestId(`fav-${uuidN(1)}`);
    const second = screen.getByTestId(`fav-${uuidN(2)}`);
    expect(within(first).getByText("Университет 1")).toBeTruthy();
    expect(within(first).getByText("Куала-Лумпур · Малайзия")).toBeTruthy();
    // фото: адрес только из нашего бакета (render/image), у вуза без фото картинки нет и надписи нет
    // у карточки с фото кроме кнопки есть картинка (та же подпись), у карточки без фото - только кнопка
    // Фото в карточке скрыто от читалки (название читает сама карточка), поэтому ищем узел с source.
    expect(screen.getAllByLabelText("Университет 1")).toHaveLength(1);
    const photo = screen.getAllByTestId(/^fav-photo-/, { includeHiddenElements: true })[0];
    const source = (photo.props as { source: { uri: string } | { uri: string }[] }).source;
    const uri = [source].flat()[0].uri;
    expect(uri).toMatch(/^http:\/\/localhost:46421\/storage\/v1\/render\/image\/public\/portal-university-photos\/sunway\.jpg\?/);
    expect(screen.getAllByLabelText("Университет 2")).toHaveLength(1);
    expect(within(second).queryByText(/Фото/)).toBeNull();
    // две карточки - всё избранное уже видно, ссылки «Всё избранное» нет
    expect(screen.queryByTestId("favorites-all")).toBeNull();
  });

  it("больше четырёх вузов: четыре карточки и «Всё избранное» открывает полный список", async () => {
    const { transport } = fakeTransport(handlers("MY", { student_university_favorites_v1: favorites(6) }));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId(`fav-${uuidN(1)}`);
    expect(screen.queryByTestId(`fav-${uuidN(5)}`)).toBeNull();
    await fireEvent.press(screen.getByTestId("favorites-all"));
    expect(await screen.findByTestId(`fav-${uuidN(5)}`)).toBeTruthy();
    expect(screen.queryByTestId("favorites-all")).toBeNull();
  });

  it("пустые состояния: нет вузов, нет программ", async () => {
    const { transport } = fakeTransport(handlers("MY", { student_university_favorites_v1: [], student_catalog_preparations_v1: [] }));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByText("Пока ничего не сохранено")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("tab-programs"));
    expect(await screen.findByText("Вы пока не добавили программу. Откройте университет и добавьте подходящий набор в «Мои программы».")).toBeTruthy();
  });

  it("выбор программ закрыт для дела: подсказка про каталог", async () => {
    const { transport } = fakeTransport(handlers("MY", { student_catalog_preparations_v1: [] }));
    await renderPortal(<HomeScreen />, testApi(transport, { canSelectPrograms: false }));
    await fireEvent.press(screen.getByTestId("tab-programs"));
    expect(await screen.findByText(/Пока здесь пусто\. Программы появятся/)).toBeTruthy();
  });

  it("сбой чтения программ: плашка и повтор, без текста сервера", async () => {
    let attempt = 0;
    const { transport } = fakeTransport(handlers("MY", { student_catalog_preparations_v1: () => (++attempt === 1 ? failure("XX000", 500) : [preparationRow(1)]) }));
    await renderPortal(<HomeScreen />, testApi(transport));
    await fireEvent.press(screen.getByTestId("tab-programs"));
    const alert = await screen.findByTestId("programs-error");
    expect(within(alert).getByText("Сервис временно недоступен. Повторите позже.")).toBeTruthy();
    await fireEvent.press(within(alert).getByText("Повторить"));
    expect(await screen.findByTestId(`program-${uuidN(1, "bbbbbbbb")}`)).toBeTruthy();
  });

  it("чужая форма строки подготовки не показывается", async () => {
    const { transport } = fakeTransport(handlers("MY", { student_catalog_preparations_v1: [{ ...preparationRow(1), studentCaseId: uuidN(9) }] }));
    await renderPortal(<HomeScreen />, testApi(transport));
    await fireEvent.press(screen.getByTestId("tab-programs"));
    expect(await screen.findByTestId("programs-error")).toBeTruthy();
  });

  it("пустой обзор без плана и без задач не ломает экран", async () => {
    const { transport } = fakeTransport(handlers("MY", { student_portal_overview_v2: [OVERVIEW_ROW_EMPTY], student_portal_finance_v2: [] }));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByText("Вузы 2");
    expect(screen.queryByTestId("evo-title")).toBeNull();
  });
});

describe("Главная: переходы из старых ссылок и кнопок", () => {
  it("?list=programs открывает вкладку «Мои программы»", async () => {
    params.mockReturnValue({ list: "programs" });
    const { transport } = fakeTransport(handlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByTestId(`program-${uuidN(1, "bbbbbbbb")}`)).toBeTruthy();
    expect(screen.getByTestId("tab-programs").props.accessibilityState).toMatchObject({ checked: true });
  });

  it("строка избранного ведёт на карточку вуза", async () => {
    const { transport } = fakeTransport(handlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId(`fav-${uuidN(1)}`));
    expect(navigate).toHaveBeenCalledWith(`/universities/${uuidN(1)}`);
  });

  it("карточки «Есть вопрос?» на «Главной» нет: вход в чат живёт в плавающей кнопке оболочки", async () => {
    const { transport } = fakeTransport(handlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("journey-strip");
    expect(screen.queryByText("Есть вопрос?")).toBeNull();
    expect(screen.queryByTestId("write-evo")).toBeNull();
  });
});
