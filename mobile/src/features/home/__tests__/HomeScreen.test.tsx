import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";

import { HomeScreen } from "@/features/home/HomeScreen";
import { NOTIFICATION_ROW, OVERVIEW_ROW, OVERVIEW_ROW_EMPTY, SLOT_ID } from "@/test-fixtures/rpc-rows";
import { homeHandlers, restoreNow, saved, setNow } from "@/test-fixtures/home";
import { renderPortal, testApi } from "@/test-fixtures/render";
import cscaHome from "@/test-fixtures/csca-home-fresh.json";
import { failure, fakeTransport } from "@/test-fixtures/universities";

jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock("expo-file-system", () => jest.requireActual("@/test-fixtures/memory-file-system").memoryFileSystem());

const navigate = router.navigate as jest.Mock;
const assistedHandlers = homeHandlers;

// «Сегодня» теста: 8 сентября 2026, 11:00 в Бишкеке (паспорт до 12.09, платёж до 01.10).
beforeEach(() => {
  jest.requireMock("expo-file-system").__files.clear(); // копия индекса каталога с диска не переходит между тестами
  navigate.mockClear();
  setNow("2026-09-08T05:00:00Z");
});
afterEach(restoreNow);

describe("Главная: assisted", () => {
  it("порядок блоков под шапкой: задача EVO, дело, «Мой список», даты, новости; CSCA только для Китая", async () => {
    const { transport } = fakeTransport(assistedHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("slot-news");
    const order = screen.getAllByTestId(/^slot-/).map((node) => node.props.testID);
    expect(order).toEqual(["slot-evo", "slot-case", "slot-list", "slot-dates", "slot-news"]);
    // шапка и путь - один блок над ними
    expect(screen.getByTestId("journey")).toBeTruthy();
    expect(screen.queryByTestId("csca-open")).toBeNull();
    expect(screen.getByText("Здравствуйте, Тест Студентов")).toBeTruthy();
  });

  it("«Что сделать сейчас» первым: число дел, срок словом, действие с документом, второе дело строкой", async () => {
    const { transport } = fakeTransport(assistedHandlers());
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByTestId("case-open")).toBeTruthy();
    expect(within(screen.getByTestId("case-primary")).getByText("Замените документ: Паспорт")).toBeTruthy();
    expect(screen.getByText("Что сделать сейчас")).toBeTruthy();
    // число дел стоит у заголовка; срок первого дела - словом в пилюле
    expect(within(screen.getByTestId("slot-case")).getByText("2")).toBeTruthy();
    expect(screen.getByTestId("case-primary-due")).toHaveTextContent("через 4 дня");
    // второе дело - строкой со сроком; «Ещё действий» нет, пока дел не больше трёх
    expect(within(screen.getByTestId("case-next-0")).getByText("Оплата: Услуги EVO")).toBeTruthy();
    expect(within(screen.getByTestId("case-next-0")).getByText("через 23 дня")).toBeTruthy();
    expect(screen.queryByTestId("case-more")).toBeNull();
    // документ открывает «Документы» на своей строке (`focus` - слот документа, веб `#document-<slot>`), оплата - «Оплату»
    await fireEvent.press(screen.getByTestId("case-open"));
    expect(navigate).toHaveBeenCalledWith(`/documents?focus=${SLOT_ID}`);
    await fireEvent.press(screen.getByTestId("case-next-0"));
    expect(navigate).toHaveBeenCalledWith("/payments");
  });

  it("«откуда действия» спрятано за «?» и открывается по нажатию", async () => {
    const { transport } = fakeTransport(assistedHandlers());
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("case-open");
    expect(screen.queryByText("Действия добавляет команда EVO по вашему плану поступления.")).toBeNull();
    const hint = screen.getByTestId("case-hint");
    expect(hint.props.accessibilityLabel).toBe("Откуда эти действия");
    await fireEvent.press(hint);
    expect(screen.getByText("Действия добавляет команда EVO по вашему плану поступления.")).toBeTruthy();
    expect(screen.getByTestId("case-hint").props.accessibilityState).toMatchObject({ expanded: true });
  });

  it("шапка: приветствие, «страна · набор» и отсчёт; дорожки десяти этапов EVO на «Главной» больше нет", async () => {
    const { transport } = fakeTransport(assistedHandlers());
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("case-open");
    expect(screen.queryByTestId("stage-track")).toBeNull();
    expect(screen.queryByText(/Этап \d+ из 10/)).toBeNull();
    expect(screen.getByTestId("hero-sub")).toHaveTextContent("Малайзия · от даты интейка выбранного вуза");
  });

  it("строка текущего шага под шапкой: «Шаг 2 из 7 · дальше — …»; карточки «Путь: страна» нет; «Все шаги» раскрывают путь на этом же экране", async () => {
    const { transport } = fakeTransport(assistedHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByTestId("journey-title")).toHaveTextContent("Договор и документы");
    expect(screen.queryByText("Путь: Малайзия")).toBeNull();
    expect(screen.getByTestId("journey-sub")).toHaveTextContent("Шаг 2 из 7 · дальше — Подача в вуз, Offer Letter и первые платежи");
    expect(screen.getByTestId("journey-now").props.accessibilityLabel).toBe("Договор и документы. Шаг 2 из 7, дальше — Подача в вуз, Offer Letter и первые платежи");
    expect(screen.queryByTestId("journey-body")).toBeNull();
    await fireEvent.press(screen.getByTestId("journey-fold"));
    expect(await screen.findByTestId("journey-body")).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("Китай: карточка CSCA с ближайшей сессией, без второй строки про регистрацию; список выше дат", async () => {
    const { transport } = fakeTransport(assistedHandlers("CN"));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByTestId("csca-open")).toBeTruthy();
    const order = screen.getAllByTestId(/^slot-/).map((node) => node.props.testID);
    expect(order).toEqual(["slot-evo", "slot-case", "slot-list", "slot-dates", "slot-news", "slot-csca"]);
    expect(screen.getByTestId("csca-session")).toBeTruthy();
    expect(screen.getByText(/Ближайшая сессия: 14 и 15 ноября 2026/)).toBeTruthy();
    // срок регистрации стоит строкой в «Ближайших датах», в карточке его нет (веб, 19.11.2026)
    expect(within(screen.getByTestId("csca-session")).queryByText(/Регистрация/)).toBeNull();
    await fireEvent.press(screen.getByTestId("csca-open"));
    expect(navigate).toHaveBeenCalledWith("/csca");
  });

  it("Китай: пока карточка CSCA не прочиталась, пустого места под ней нет; прочиталась - блок встаёт на место", async () => {
    let release: (() => void) | undefined;
    const { transport } = fakeTransport(
      assistedHandlers("CN", { learning_track_home_v1: () => new Promise((resolve) => (release = () => resolve(cscaHome))) }),
    );
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("slot-news");
    // веб: `{csca ? <div className="pt-home-slot">…</div> : null}` - обёртки без карточки нет, а с нею и 16 pt отступа
    expect(screen.queryByTestId("slot-csca")).toBeNull();
    expect(screen.getAllByTestId(/^slot-/).map((node) => node.props.testID)).toEqual(["slot-evo", "slot-case", "slot-list", "slot-dates", "slot-news"]);
    await act(async () => release?.());
    expect(await screen.findByTestId("csca-open")).toBeTruthy();
    expect(screen.getAllByTestId(/^slot-/).map((node) => node.props.testID)).toEqual(["slot-evo", "slot-case", "slot-list", "slot-dates", "slot-news", "slot-csca"]);
  });

  it("Китай: чтение CSCA не удалось - пустого блока нет, остальное на месте", async () => {
    const { transport } = fakeTransport(assistedHandlers("CN", { learning_track_home_v1: failure(null, 503) }));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("slot-news");
    await waitFor(() => expect(screen.queryByTestId("slot-csca")).toBeNull());
    expect(screen.getByTestId("slot-dates")).toBeTruthy();
  });

  it("«Мой список» и «Что нового»: строки и переходы", async () => {
    const { transport } = fakeTransport(assistedHandlers());
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByText("Университет 1")).toBeTruthy();
    expect(screen.getByText("Университет 2")).toBeTruthy();
    const news = await screen.findByTestId(`news-${NOTIFICATION_ROW.notification_id}`);
    expect(news.props.accessibilityLabel).toContain("Новое:"); // непрочитанное подписано словом
    // время словом (событие 7.09 14:00, сегодня 8.09): «вчера, 14:00»; непрочитанное - с красной точкой
    expect(within(news).getByText("вчера, 14:00")).toBeTruthy();
    expect(screen.getByTestId(`news-unread-${NOTIFICATION_ROW.notification_id}`, { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(news);
    expect(navigate).toHaveBeenCalledWith("/documents");
    await fireEvent.press(screen.getByTestId("news-all"));
    expect(navigate).toHaveBeenCalledWith("/messages/updates");
  });

  it("нет дел: спокойное пустое состояние; нет вузов и новостей: пустые состояния", async () => {
    const { transport } = fakeTransport(
      assistedHandlers("MY", {
        student_portal_overview_v2: [OVERVIEW_ROW_EMPTY],
        student_portal_finance_v2: [],
        student_portal_notifications_v2: [],
        student_university_favorites_v1: [],
      }),
    );
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByText("Сейчас действий от вас не требуется")).toBeTruthy();
    expect(screen.getByText("Пока ничего не сохранено")).toBeTruthy();
    expect(screen.getByText("Вузы 0")).toBeTruthy();
    expect(screen.getByText("Новых уведомлений нет")).toBeTruthy();
    expect(screen.getByText("Дат пока нет")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("favorites-open-catalog"));
    expect(navigate).toHaveBeenCalledWith("/universities");
  });

  it("дело без плана: «План поступления пока не опубликован»", async () => {
    const { transport } = fakeTransport(assistedHandlers("MY", { student_portal_overview_v2: [], student_portal_finance_v2: [] }));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByText("План поступления пока не опубликован")).toBeTruthy();
  });
});

describe("Главная: выбор страны", () => {
  it("без страны первым блоком выбор, карточки пути нет; выбор пишет RPC и открывает путь", async () => {
    let choice: unknown = { country: null, source: "none", savedAt: null };
    const { transport, calls } = fakeTransport(
      assistedHandlers("MY", {
        student_country_choice_v1: () => choice,
        set_student_country_choice_v1: (args: Record<string, unknown> | undefined) => {
          choice = saved(args?.p_country as string);
          return choice;
        },
      }),
    );
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByText("Выберите страну")).toBeTruthy();
    // без страны - тёмная плашка с приветствием и выбор страны; шапки пути на фото ещё нет
    expect(screen.getByTestId("home-hero")).toBeTruthy();
    expect(screen.queryByTestId("journey")).toBeNull();
    expect(screen.queryByTestId("hero-sub")).toBeNull();
    expect(screen.getAllByTestId(/^country-[A-Z]+$/)).toHaveLength(7); // шесть стран и «Пока не решил»
    await fireEvent.press(screen.getByTestId("country-MY"));
    await screen.findByTestId("journey");
    expect(screen.queryByText("Выберите страну")).toBeNull();
    const write = calls.find((c) => c.name === "set_student_country_choice_v1");
    expect(write?.args).toMatchObject({ p_country: "MY" });
    expect(typeof write?.args?.p_request_id).toBe("string");
    // страна пишется в шапке: «Малайзия · набор …»
    expect(await screen.findByTestId("hero-sub")).toHaveTextContent(/^Малайзия · /);
  });

  it("«Пока не решил» показывает общий путь: строка шага есть, названия страны в шапке нет", async () => {
    const { transport } = fakeTransport(assistedHandlers("UNDECIDED"));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByTestId("journey")).toBeTruthy();
    expect(await screen.findByTestId("journey-sub")).toHaveTextContent(/^Шаг \d+ из \d+/);
    expect(screen.queryByTestId("hero-sub")).toBeNull();
  });

  it("сбой сохранения: честная плашка, повтор шлёт тот же запрос", async () => {
    const { transport, calls } = fakeTransport(
      assistedHandlers("MY", {
        student_country_choice_v1: { country: null, source: "none", savedAt: null },
        set_student_country_choice_v1: failure("22023", 400),
      }),
    );
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByText("Выберите страну");
    await fireEvent.press(screen.getByTestId("country-CN"));
    expect(await screen.findByTestId("country-save-error")).toBeTruthy();
    expect(screen.getByText("Не удалось сохранить выбор, попробуйте ещё раз.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("country-CN"));
    await waitFor(() => expect(calls.filter((c) => c.name === "set_student_country_choice_v1")).toHaveLength(2));
    const [first, second] = calls.filter((c) => c.name === "set_student_country_choice_v1");
    expect(second.args).toEqual(first.args);
  });

  it("чтение выбора не удалось: плашка из словаря приложения и выбор остаётся доступным", async () => {
    const { transport } = fakeTransport(assistedHandlers("MY", { student_country_choice_v1: failure(null, 500) }));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByTestId("country-read-error")).toBeTruthy();
    expect(screen.getByText("Сервис временно недоступен. Повторите позже.")).toBeTruthy();
    expect(screen.getByTestId("country-CN")).toBeTruthy();
  });
});

describe("Главная: approved", () => {
  it("«Ваша анкета» вместо дела, без новостей, чтения дела не вызываются", async () => {
    const { transport, calls } = fakeTransport(assistedHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport, { tier: "approved" }));
    await screen.findByTestId("journey");
    await screen.findByText("Университет 1");
    const order = screen.getAllByTestId(/^slot-/).map((node) => node.props.testID);
    // Малайзия без раздела CSCA: список стоит после дат (веб `listInColumn`)
    expect(order).toEqual(["slot-case", "slot-dates", "slot-list"]);
    expect(screen.getAllByText("Ваша анкета")).toHaveLength(1);
    expect(screen.queryByText("Что сделать сейчас")).toBeNull();
    expect(screen.queryByText("Что нового")).toBeNull();
    const names = calls.map((c) => c.name);
    for (const forbidden of ["student_portal_overview_v2", "student_portal_finance_v2", "student_portal_notifications_v2"]) expect(names).not.toContain(forbidden);
  });
});

describe("Главная: загрузка и ошибки", () => {
  it("пока данных нет, скелетоны с подписью «Загрузка»", async () => {
    const never = new Promise(() => undefined);
    const transport = (() => never) as never;
    await renderPortal(<HomeScreen />, testApi(transport));
    const bars = screen.getAllByRole("progressbar");
    expect(bars.length).toBeGreaterThanOrEqual(3);
    expect(bars.some((bar) => String(bar.props.accessibilityLabel).includes("Что сделать сейчас. Загрузка"))).toBe(true);
  });

  it("сбой одного источника не роняет остальные; повтор перечитывает", async () => {
    let overviewCalls = 0;
    const { transport } = fakeTransport(
      assistedHandlers("MY", {
        student_portal_overview_v2: () => (++overviewCalls === 1 ? failure(null, 503) : [OVERVIEW_ROW]),
      }),
    );
    await renderPortal(<HomeScreen />, testApi(transport));
    const alert = await screen.findByTestId("card-error");
    expect(within(alert).getByText("Сервис временно недоступен. Повторите позже.")).toBeTruthy();
    // остальные карточки на месте
    expect(await screen.findByText("Университет 1")).toBeTruthy();
    expect(screen.getByTestId("journey")).toBeTruthy();
    // текст ошибки сервера не показывается
    expect(screen.queryByText(/503/)).toBeNull();
    await fireEvent.press(within(alert).getByText("Повторить"));
    expect(await screen.findByTestId("case-open")).toBeTruthy();
  });

  it("обрыв связи: строка про связь; нераспознанный ответ: общая строка загрузки", async () => {
    const offline = fakeTransport(assistedHandlers("MY", { student_university_favorites_v1: new Error("network") }));
    await renderPortal(<HomeScreen />, testApi(offline.transport));
    expect(await screen.findByText("Нет связи. Проверьте интернет и повторите.")).toBeTruthy();
  });

  it("чужая форма ответа не показывается: общая строка, данные сервера не видны", async () => {
    const { transport } = fakeTransport(assistedHandlers("MY", { student_portal_notifications_v2: [{ ...NOTIFICATION_ROW, secret: "внутреннее" }] }));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByText("Не удалось загрузить. Потяните вниз, чтобы обновить.")).toBeTruthy();
    expect(screen.queryByText(/внутреннее/)).toBeNull();
  });

  it("потянуть вниз перечитывает активные источники", async () => {
    const { transport, calls } = fakeTransport(assistedHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByText("Университет 1");
    const before = calls.filter((c) => c.name === "student_portal_overview_v2").length;
    const scroll = screen.getByTestId("screen-scroll");
    await act(async () => {
      scroll.props.refreshControl.props.onRefresh();
    });
    await waitFor(() => expect(calls.filter((c) => c.name === "student_portal_overview_v2").length).toBe(before + 1));
  });
});

describe("Главная: кыргызский и доступность", () => {
  it("тексты на кыргызском", async () => {
    const { transport } = fakeTransport(assistedHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport), "ky");
    expect(await screen.findByText("Азыр эмне кылуу керек")).toBeTruthy();
    // Блоки приходят из разных запросов: после первого блока остальные могут ещё не нарисоваться
    // (в полном прогоне под нагрузкой тест иногда падал на синхронном getByText), поэтому ждём каждый.
    expect(await screen.findByText("Менин тизмем", {}, { timeout: 5000 })).toBeTruthy();
    expect(await screen.findByText("7 кадамдын 2-кадамы", { exact: false }, { timeout: 5000 })).toBeTruthy();
    expect(await screen.findByText("Жакынкы даталар", {}, { timeout: 5000 })).toBeTruthy();
  });

  it("кнопки и ссылки не меньше 44 pt, у интерактивных есть роль и имя", async () => {
    const { transport } = fakeTransport(assistedHandlers("CN"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("csca-open");
    await screen.findByText("Университет 1");
    const controls = [...screen.getAllByRole("button"), ...screen.getAllByRole("link")];
    expect(controls.length).toBeGreaterThan(5);
    for (const control of controls) {
      const style = Object.assign({}, ...[control.props.style].flat(Infinity).filter(Boolean)) as { minHeight?: number; height?: number };
      expect(Math.max(style.minHeight ?? 0, style.height ?? 0)).toBeGreaterThanOrEqual(44);
    }
  });
});
