// Карточки «Главной» после веба #1489: «Ближайшие даты» (плитка, «через N дней», «Дальше», CSCA, сроки программ),
// «Что сделать сейчас» (число дел, срок словом, строки, «Ещё действий»), «Мои вузы» лентой со сроком подачи.
import { fireEvent, screen, within } from "@testing-library/react-native";
import { router } from "expo-router";

import { HomeScreen } from "@/features/home/HomeScreen";
import { stripCardWidth } from "@/features/home/HomeList";
import { OVERVIEW_ROW_EMPTY, PAYMENT_ROW, SLOT_ID } from "@/test-fixtures/rpc-rows";
import { favorites, homeHandlers, moveNow, restoreNow, setNow } from "@/test-fixtures/home";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport, preparationRow, universityRow, uuidN } from "@/test-fixtures/universities";

jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock("expo-file-system", () => jest.requireActual("@/test-fixtures/memory-file-system").memoryFileSystem());

const navigate = router.navigate as jest.Mock;
const payment = (label: string, dueAt: string) => ({ ...PAYMENT_ROW, obligation_label: label, due_at: dueAt });
const flat = (node: { props: { style?: unknown } }) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)) as Record<string, unknown>;

beforeEach(() => {
  jest.requireMock("expo-file-system").__files.clear();
  navigate.mockClear();
  setNow("2026-09-08T05:00:00Z"); // 11:00 в Бишкеке
});
afterEach(restoreNow);

describe("«Ближайшие даты»", () => {
  it("строка даты: плитка «число и месяц», название и сколько осталось; ближайшие - весом", async () => {
    moveNow("2026-09-11T05:00:00Z");
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    const row = await screen.findByTestId("date-2026-09-12");
    expect(within(row).getByText("12", { includeHiddenElements: true })).toBeTruthy();
    expect(within(row).getByText("сент.", { includeHiddenElements: true })).toBeTruthy();
    expect(within(row).getByText("Замените документ: Паспорт")).toBeTruthy();
    // срок паспорта - завтра: слово «завтра» весом, платёж через три недели - обычным
    expect(within(row).getByTestId("date-left-2026-09-12")).toHaveTextContent("завтра");
    expect(flat(within(row).getByTestId("date-left-2026-09-12")).fontFamily).toBe("GolosText-SemiBold");
    const later = screen.getByTestId("date-2026-10-01");
    expect(within(later).getByTestId("date-left-2026-10-01")).toHaveTextContent("через 20 дней");
    expect(flat(within(later).getByTestId("date-left-2026-10-01")).fontFamily).toBe("GolosText-Regular");
    // неделя: сегодня - красный круг, день срока - точка
    expect(screen.getByTestId("week-today", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("week-marked-2026-09-12", { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(row);
    // строка документа открывает «Документы» на этом документе (веб: ссылка `/portal/documents#document-<slot>`)
    expect(navigate).toHaveBeenCalledWith(`/documents?focus=${SLOT_ID}`);
    // оплата - на «Оплату», без параметров
    await fireEvent.press(later);
    expect(navigate).toHaveBeenLastCalledWith("/payments");
  });

  it("в окне 60 дней дат нет, а позже есть: «Дальше» и первая такая дата с годом", async () => {
    const { transport } = fakeTransport(homeHandlers("MY", { student_portal_overview_v2: [OVERVIEW_ROW_EMPTY], student_portal_finance_v2: [] }));
    await renderPortal(<HomeScreen />, testApi(transport));
    const later = await screen.findByTestId("dates-later");
    expect(within(later).getByText("Дальше")).toBeTruthy();
    // срок подачи избранного вуза 1 мая 2027 - другой год, поэтому справа год
    const row = within(later).getByTestId("date-2027-05-01");
    expect(within(row).getByText("2027")).toBeTruthy();
    expect(within(row).getByText("Университет 1: последний день подачи")).toBeTruthy();
    // строка ведёт на карточку самого вуза, а не на каталог
    await fireEvent.press(row);
    expect(navigate).toHaveBeenCalledWith(`/universities/${uuidN(1)}`);
    expect(screen.queryByText("Дат пока нет")).toBeNull();
  });

  it("дат нет совсем: одна строка со значком под неделей", async () => {
    const { transport } = fakeTransport(homeHandlers("MY", { student_portal_overview_v2: [OVERVIEW_ROW_EMPTY], student_portal_finance_v2: [], student_university_favorites_v1: [] }));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByText("Дат пока нет")).toBeTruthy();
    expect(screen.getByText("Здесь появятся сроки ваших действий и даты избранных вузов.")).toBeTruthy();
    expect(screen.getByTestId("week-strip", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId("dates-later")).toBeNull();
  });

  it("сроки своих программ идут в даты, а общая строка того же вуза не повторяет программу", async () => {
    moveNow("2027-03-15T05:00:00Z"); // до срока подачи 1 мая 2027 меньше 60 дней
    const confirmed = { ...preparationRow(1), deadlineStateAtSelection: "confirmed" };
    const { transport } = fakeTransport(homeHandlers("MY", { student_portal_overview_v2: [OVERVIEW_ROW_EMPTY], student_portal_finance_v2: [], student_catalog_preparations_v1: [confirmed] }));
    await renderPortal(<HomeScreen />, testApi(transport));
    const rows = await screen.findAllByTestId("date-2027-05-01", {}, { timeout: 3000 });
    await screen.findByText(/^Информатика, Университет 1/);
    const titles = screen.getAllByTestId("date-2027-05-01").map((node) => within(node).getByText(/последний день подачи/).props.children);
    // две строки в один день: срок программы вуза 1 и срок вуза 2 (у вуза 1 общей строки нет)
    expect(rows).toHaveLength(2);
    expect(titles.sort()).toEqual(["Информатика, Университет 1: последний день подачи", "Университет 2: последний день подачи"]);
    // срок программы ведёт на экран этой программы (веб: `/portal/preparations/<applicationId>`)
    await fireEvent.press(screen.getAllByTestId("date-2027-05-01").find((node) => within(node).queryByText(/^Информатика/) !== null)!);
    expect(navigate).toHaveBeenCalledWith(`/preparations/${uuidN(1, "bbbbbbbb")}`);
  });

  it("Китай: официальные даты CSCA - последний день регистрации и экзамен; строка ведёт в раздел CSCA", async () => {
    moveNow("2026-10-16T05:00:00Z"); // «сегодня» главной CSCA из фикстуры
    const { transport } = fakeTransport(homeHandlers("CN", { student_portal_overview_v2: [OVERVIEW_ROW_EMPTY], student_portal_finance_v2: [] }));
    await renderPortal(<HomeScreen />, testApi(transport));
    const registration = await screen.findByTestId("date-2026-10-21");
    expect(within(registration).getByText("CSCA: регистрация закрывается")).toBeTruthy();
    expect(within(registration).getByTestId("date-left-2026-10-21")).toHaveTextContent("через 5 дней");
    const exam = screen.getByTestId("date-2026-11-14");
    expect(within(exam).getByText("CSCA: экзамен")).toBeTruthy();
    await fireEvent.press(exam);
    expect(navigate).toHaveBeenCalledWith("/csca");
  });

  it("не Китай: дат CSCA нет и главная CSCA не читается", async () => {
    moveNow("2026-10-16T05:00:00Z");
    const { transport, calls } = fakeTransport(homeHandlers("MY", { student_portal_overview_v2: [OVERVIEW_ROW_EMPTY], student_portal_finance_v2: [] }));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("slot-dates");
    expect(screen.queryByText(/CSCA/)).toBeNull();
    expect(calls.map((call) => call.name)).not.toContain("learning_track_home_v1");
  });
});

describe("«Что сделать сейчас»: дела строками", () => {
  const five = {
    student_portal_finance_v2: [
      payment("Взнос 1", "2026-09-06T08:00:00+00:00"), // два дня назад
      payment("Взнос 2", "2026-09-20T08:00:00+00:00"),
      payment("Взнос 3", "2026-10-01T08:00:00+00:00"),
      payment("Взнос 4", "2026-11-01T08:00:00+00:00"),
    ],
  };

  it("первое дело кнопкой, ещё два строками со сроком, остальные - «Ещё действий: N»", async () => {
    const { transport } = fakeTransport(homeHandlers("MY", five));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("case-open");
    // всего пять дел: число у заголовка, первое с суммой, красная кнопка только одна
    expect(within(screen.getByTestId("slot-case")).getByText("5")).toBeTruthy();
    expect(within(screen.getByTestId("case-primary")).getByText("Оплата: Взнос 1")).toBeTruthy();
    expect(screen.getByText("Сумма:")).toBeTruthy();
    expect(screen.getAllByTestId(/^case-open$/)).toHaveLength(1);
    expect(screen.getByTestId("case-next-0")).toBeTruthy();
    expect(screen.getByTestId("case-next-1")).toBeTruthy();
    expect(screen.queryByTestId("case-next-2")).toBeNull();
    expect(screen.getByTestId("case-more")).toHaveTextContent("Ещё действий: 2");
    await fireEvent.press(screen.getByTestId("case-more"));
    expect(navigate).toHaveBeenCalledWith("/documents");
  });

  it("просрочено - красным словами «просрочено на 2 дня»; у следующих дел срок тоже словом", async () => {
    const { transport } = fakeTransport(homeHandlers("MY", five));
    await renderPortal(<HomeScreen />, testApi(transport));
    const due = await screen.findByTestId("case-primary-due");
    expect(due).toHaveTextContent("просрочено на 2 дня");
    expect(within(screen.getByTestId("case-next-0")).getByText(/через \d+ д/)).toBeTruthy();
  });

  // Читалка слышит и дату, и слова пилюли («Срок: 20.09.2026, через 12 дней»): у веба оба читаются (`pt-sr-only` и пилюля).
  it("метка строки следующего дела несёт слова пилюли: «через N дней», «просрочено на N дня», «сегодня»", async () => {
    const world = {
      student_portal_overview_v2: [OVERVIEW_ROW_EMPTY],
      student_portal_finance_v2: [
        payment("Взнос 1", "2026-09-03T08:00:00+00:00"), // просрочено на 5 дней: первое дело, кнопкой
        payment("Взнос 2", "2026-09-06T08:00:00+00:00"), // просрочено на 2 дня
        payment("Взнос 3", "2026-09-08T10:00:00+00:00"), // сегодня, 16:00
        payment("Взнос 4", "2026-09-20T08:00:00+00:00"), // через 12 дней
        payment("Взнос 5", "2026-10-01T08:00:00+00:00"), // «Ещё действий»
      ],
    };
    const { transport } = fakeTransport(homeHandlers("MY", world));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("case-open");
    expect(screen.getByTestId("case-next-0").props.accessibilityLabel).toBe("Оплата: Взнос 2. Срок: 06.09.2026, просрочено на 2 дня");
    expect(screen.getByTestId("case-next-1").props.accessibilityLabel).toBe("Оплата: Взнос 3. Срок: 08.09.2026, сегодня");
    // те же слова рисует сама пилюля строки
    expect(within(screen.getByTestId("case-next-0")).getByText("просрочено на 2 дня")).toBeTruthy();
    expect(within(screen.getByTestId("case-next-1")).getByText("сегодня")).toBeTruthy();
  });

  it("метка следующего дела со сроком «через N дней» и дело без срока: у второго слов пилюли и даты в метке нет", async () => {
    const world = {
      student_portal_overview_v2: [OVERVIEW_ROW_EMPTY],
      student_portal_finance_v2: [payment("Взнос 1", "2026-09-20T08:00:00+00:00"), payment("Взнос 2", "2026-10-01T08:00:00+00:00"), { ...PAYMENT_ROW, obligation_label: "Взнос 3", due_at: null }],
    };
    const { transport } = fakeTransport(homeHandlers("MY", world));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("case-open");
    const labels = [0, 1].map((index) => screen.getByTestId(`case-next-${index}`).props.accessibilityLabel);
    expect(labels).toEqual(expect.arrayContaining(["Оплата: Взнос 2. Срок: 01.10.2026, через 23 дня"]));
    expect(labels.some((label) => label === "Оплата: Взнос 3")).toBe(true); // без срока - одно название, без «Срок» и слов
  });

  it.each([
    ["2026-09-08T03:00:00+00:00", /^просрочено$/], // 09:00 в Бишкеке, сейчас 11:00: срок прошёл сегодня по часам
    ["2026-09-08T10:00:00+00:00", /^сегодня$/], // 16:00: срок позже сегодня
  ])("срок сегодня %s - пилюля %s", async (dueAt, expected) => {
    const { transport } = fakeTransport(homeHandlers("MY", { student_portal_finance_v2: [payment("Взнос", dueAt)], student_portal_overview_v2: [OVERVIEW_ROW_EMPTY] }));
    await renderPortal(<HomeScreen />, testApi(transport));
    expect(await screen.findByTestId("case-primary-due")).toHaveTextContent(expected);
  });

  it("у дела без срока пилюли нет; «Срок: не указан» не рисуется", async () => {
    const { transport } = fakeTransport(homeHandlers("MY", { student_portal_overview_v2: [OVERVIEW_ROW_EMPTY], student_portal_finance_v2: [{ ...PAYMENT_ROW, due_at: null }] }));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("case-open");
    expect(screen.queryByTestId("case-primary-due")).toBeNull();
    expect(screen.queryByText(/не указан/)).toBeNull();
    expect(screen.getByText("Сумма:")).toBeTruthy();
  });

  it("сбой чтения дела: плашка с повтором вместо числа и «?»", async () => {
    const { transport } = fakeTransport(homeHandlers("MY", { student_portal_overview_v2: new Error("offline") }));
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("card-error");
    expect(screen.queryByTestId("case-hint")).toBeNull();
    expect(within(screen.getByTestId("slot-case")).queryByText("2")).toBeNull();
  });
});

describe("«Мои вузы» лентой", () => {
  it("ширина карточки ленты: 78% списка, на широком экране не больше предела", () => {
    expect(stripCardWidth(390)).toBe(279); // iPhone 17 Pro: список 358, край следующей карточки виден
    expect(stripCardWidth(320)).toBe(225);
    expect(stripCardWidth(1024)).toBe(320);
  });

  it("лента вбок: привязка к карточкам; под названием - «город · страна» и срок подачи", async () => {
    const { transport } = fakeTransport(homeHandlers("MY", { student_university_favorites_v1: favorites(3) }));
    await renderPortal(<HomeScreen />, testApi(transport));
    const strip = await screen.findByTestId("home-favorites");
    expect(strip.props.horizontal).toBe(true);
    const card = screen.getByTestId(`fav-${uuidN(1)}`);
    const width = flat(card).width as number;
    expect(strip.props.snapToInterval).toBe(width + 12); // шаг ленты - карточка и промежуток
    expect(within(card).getByText("Университет 1")).toBeTruthy();
    expect(within(card).getByText("Куала-Лумпур · Малайзия")).toBeTruthy();
    // срок подачи тем же текстом, что у карточек каталога, с заглавной буквы
    expect(within(card).getByTestId(`fav-intake-${uuidN(1)}`)).toHaveTextContent("Подача до 1 мая 2027 г.");
    expect(screen.getByTestId(`fav-${uuidN(3)}`)).toBeTruthy();
  });

  it("у вуза без открытого набора строки набора нет (веб HomeFavorites); нажатие ведёт на карточку вуза", async () => {
    // набор без срока подачи и без начала: ближайшей даты нет, и строки «даты уточняются» на карточке веб не пишет
    const noDates = (args?: Record<string, unknown>) => ({
      items: ((args?.p_institution_ids as string[]) ?? []).map((id) => {
        const row = universityRow(Number(id.slice(-12)), "Вуз без дат");
        const program = row.content.programs[0];
        return { ...row, content: { ...row.content, programs: [{ ...program, intakes: [{ ...program.intakes[0], applicationDeadline: null, startMonth: null }] }] } };
      }),
      nextOffset: null,
    });
    const { transport } = fakeTransport(homeHandlers("MY", { student_university_catalog_by_ids_v1: noDates }));
    await renderPortal(<HomeScreen />, testApi(transport));
    const card = await screen.findByTestId(`fav-${uuidN(1)}`);
    expect(within(card).queryByTestId(`fav-intake-${uuidN(1)}`)).toBeNull();
    expect(screen.queryByText(/Даты уточняются/)).toBeNull();
    // читалка слышит то же, что видно: название и место, без строки набора
    expect(card.props.accessibilityLabel).toBe("Вуз без дат. Куала-Лумпур · Малайзия");
    await fireEvent.press(card);
    expect(navigate).toHaveBeenCalledWith(`/universities/${uuidN(1)}`);
  });

  it("метка карточки несёт видимые строки: название, место и срок подачи", async () => {
    const { transport } = fakeTransport(homeHandlers("MY"));
    await renderPortal(<HomeScreen />, testApi(transport));
    const card = await screen.findByTestId(`fav-${uuidN(1)}`);
    expect(within(card).getByTestId(`fav-intake-${uuidN(1)}`)).toHaveTextContent("Подача до 1 мая 2027 г.");
    expect(card.props.accessibilityLabel).toBe("Университет 1. Куала-Лумпур · Малайзия. Подача до 1 мая 2027 г.");
  });
});

describe("«Что нового»", () => {
  it("время словом: «сегодня», «вчера», «N дня назад», старше недели - датой", async () => {
    const note = (n: number, createdAt: string) => ({ ...jest.requireActual("@/test-fixtures/rpc-rows").NOTIFICATION_ROW, notification_id: `66666666-6666-4666-8666-66666666666${n}`, created_at: createdAt, read_at: "2026-09-09T00:00:00+00:00" });
    const { transport } = fakeTransport(
      homeHandlers("MY", {
        student_portal_notifications_v2: [note(1, "2026-09-08T04:30:00+00:00"), note(2, "2026-09-05T08:00:00+00:00"), note(3, "2026-08-16T08:00:00+00:00")],
      }),
    );
    await renderPortal(<HomeScreen />, testApi(transport));
    const news = await screen.findByTestId("slot-news");
    expect(await within(news).findByText("сегодня, 10:30")).toBeTruthy();
    expect(within(news).getByText("3 дня назад")).toBeTruthy();
    expect(within(news).getByText("16 авг.")).toBeTruthy();
    // всё прочитано: точек нет, счёта у заголовка нет
    expect(within(news).queryByTestId(/^news-unread-/, { includeHiddenElements: true })).toBeNull();
  });
});

describe("approved: порядок блоков", () => {
  it.each([
    ["CN", ["slot-case", "slot-list", "slot-dates", "slot-csca"]], // Китай: раздел CSCA, список выше дат
    ["MY", ["slot-case", "slot-dates", "slot-list"]], // без раздела CSCA список после дат (веб `listInColumn`)
  ])("страна %s", async (country, expected) => {
    const { transport } = fakeTransport(homeHandlers(country));
    await renderPortal(<HomeScreen />, testApi(transport, { tier: "approved" }));
    await screen.findByTestId("slot-list");
    await screen.findByText("Университет 1");
    if (country === "CN") await screen.findByTestId("csca-open");
    expect(screen.getAllByTestId(/^slot-/).map((node) => node.props.testID)).toEqual(expected);
  });
});
