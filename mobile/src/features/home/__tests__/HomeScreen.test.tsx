import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";

import { HomeScreen } from "@/features/home/HomeScreen";
import { NOTIFICATION_ROW, OVERVIEW_ROW, OVERVIEW_ROW_EMPTY, PAYMENT_ROW } from "@/test-fixtures/rpc-rows";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport, universityRow, uuidN } from "@/test-fixtures/universities";
import cscaHome from "@/test-fixtures/csca-home-fresh.json";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));

const navigate = router.navigate as jest.Mock;
const saved = (country: string) => ({ country, source: "saved", savedAt: "2026-11-01T08:00:00+00:00" });
const favorites = (n: number) => Array.from({ length: n }, (_, i) => ({ institutionId: uuidN(i + 1), createdAt: "2026-10-01T00:00:00+00:00" }));
const byIds = (args?: Record<string, unknown>) => ({ items: ((args?.p_institution_ids as string[]) ?? []).map((id) => universityRow(Number(id.slice(-12)))), nextOffset: null });

function assistedHandlers(country = "MY", extra: Record<string, unknown> = {}) {
  return {
    student_portal_overview_v2: [OVERVIEW_ROW],
    student_portal_finance_v2: [PAYMENT_ROW],
    student_portal_notifications_v2: [NOTIFICATION_ROW],
    student_country_choice_v1: saved(country),
    student_university_favorites_v1: favorites(2),
    student_university_catalog_by_ids_v1: byIds,
    learning_track_home_v1: cscaHome,
    ...extra,
  };
}

beforeEach(() => navigate.mockClear());

describe("Главная: assisted", () => {
  it("порядок блоков: шапка, дело, путь, вузы, даты, новости; CSCA только для Китая", async () => {
    const { transport } = fakeTransport(assistedHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("slot-news");
    const order = screen.getAllByTestId(/^slot-/).map((node) => node.props.testID);
    expect(order).toEqual(["slot-case", "slot-path", "slot-universities", "slot-dates", "slot-news"]);
    expect(screen.queryByTestId("csca-open")).toBeNull();
    expect(screen.getByText("Здравствуйте, Тест Студентов")).toBeTruthy();
  });

  it("«Что сделать сейчас» первым: действие с документом и переход в Документы", async () => {
    const { transport } = fakeTransport(assistedHandlers());
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByText("Замените документ: Паспорт")).toBeTruthy();
    expect(screen.getByText("Что сделать сейчас")).toBeTruthy();
    expect(screen.getByText("Ещё действий: 1")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("case-open"));
    expect(navigate).toHaveBeenCalledWith("/documents");
  });

  it("шапка: этап дела из обзора, дорожка из десяти шагов с текущим", async () => {
    const { transport } = fakeTransport(assistedHandlers());
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByText("Замените документ: Паспорт");
    const track = await screen.findByTestId("stage-track");
    expect(track.props.accessibilityLabel).toContain("Этап дела 5 из 10");
    expect(screen.getAllByTestId("stage-done")).toHaveLength(4);
    expect(screen.getAllByTestId("stage-current")).toHaveLength(1);
    expect(screen.getAllByTestId("stage-upcoming")).toHaveLength(5);
    expect(screen.getByText("Малайзия")).toBeTruthy();
  });

  it("карточка пути: «Путь: Малайзия», «Сейчас на пути:» и «Весь путь» ведёт на Поступление с раскрытием", async () => {
    const { transport } = fakeTransport(assistedHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByText("Путь: Малайзия")).toBeTruthy();
    expect(await screen.findByTestId("journey-current")).toBeTruthy();
    expect(screen.getByText("Сейчас на пути:", { exact: false })).toBeTruthy();
    await fireEvent.press(screen.getByTestId("journey-all"));
    expect(navigate).toHaveBeenCalledWith({ pathname: "/overview", params: { path: "open" } });
  });

  it("Китай: карточка CSCA с ближайшей сессией по часам сервера", async () => {
    const { transport } = fakeTransport(assistedHandlers("CN"));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByTestId("csca-open")).toBeTruthy();
    const order = screen.getAllByTestId(/^slot-/).map((node) => node.props.testID);
    expect(order.at(-1)).toBe("slot-csca");
    expect(screen.getByTestId("csca-session")).toBeTruthy();
    expect(screen.getByText(/Ближайшая сессия: 14 и 15 ноября 2026/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("csca-open"));
    expect(navigate).toHaveBeenCalledWith("/csca");
  });

  it("«Мои вузы» и «Что нового»: строки и переходы", async () => {
    const { transport } = fakeTransport(assistedHandlers());
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByText("Университет 1")).toBeTruthy();
    expect(screen.getByText("Университет 2")).toBeTruthy();
    const news = await screen.findByTestId(`news-${NOTIFICATION_ROW.notification_id}`);
    expect(news.props.accessibilityLabel).toContain("Новое:"); // непрочитанное подписано словом
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
    expect(screen.queryByTestId("slot-path")).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(7); // шесть стран и «Пока не решил»
    await fireEvent.press(screen.getByTestId("country-MY"));
    await screen.findByTestId("slot-path");
    expect(screen.queryByText("Выберите страну")).toBeNull();
    const write = calls.find((c) => c.name === "set_student_country_choice_v1");
    expect(write?.args).toMatchObject({ p_country: "MY" });
    expect(typeof write?.args?.p_request_id).toBe("string");
    expect(screen.getByText("Путь: Малайзия")).toBeTruthy();
  });

  it("«Пока не решил» показывает общий путь с названием «Путь поступления»", async () => {
    const { transport } = fakeTransport(assistedHandlers("UNDECIDED"));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByText("Путь поступления")).toBeTruthy();
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
    await screen.findByTestId("slot-path");
    await screen.findByText("Университет 1");
    const order = screen.getAllByTestId(/^slot-/).map((node) => node.props.testID);
    expect(order).toEqual(["slot-case", "slot-path", "slot-universities", "slot-dates"]);
    expect(screen.getByText("Ваша анкета")).toBeTruthy();
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
    expect(screen.getByText("Путь: Малайзия")).toBeTruthy();
    // текст ошибки сервера не показывается
    expect(screen.queryByText(/503/)).toBeNull();
    await fireEvent.press(within(alert).getByText("Повторить"));
    expect(await screen.findByText("Замените документ: Паспорт")).toBeTruthy();
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
    expect(screen.getByText("Менин университеттерим")).toBeTruthy();
    expect(screen.getByText("Жакынкы даталар")).toBeTruthy();
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
