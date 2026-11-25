// Сверка «Главной» приложения с настоящим веб-кодом (HomeView.tsx и карточки в `components/portal/home`). Веб-компоненты нельзя
// импортировать (Next, `@/` веба), поэтому `test-fixtures/web-oracle.ts` берёт их файлы, переводит и выполняет здесь, а тест кладёт
// в веб и в приложение одни и те же данные и сравнивает ТЕКСТ, который прочтёт студент (строки по порядку), и порядок блоков.
// Если веб изменит текст или правило карточки, этот тест покраснеет: изменение нужно перенести в приложение (или объяснить расхождение).
import { fireEvent, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import { createElement, type ReactElement } from "react";
import type { PublishedUniversity } from "@web/lib/platform-university-catalog";
import type { CatalogPreparation } from "@web/lib/portal/catalog-preparations";
import { todayForTimeline } from "@web/lib/portal/country-timeline";
import type { HomeDateItem } from "@web/lib/portal/home-dates";
import { getPortalStrings } from "@web/lib/portal/i18n";

import { applicationSteps, collectHomeDates, homeCountdown, homeSlots, latestNews, type HomeApplication } from "@/domain/home-model";
import { normalizeStudentPortalNotification, type StudentPortalAction, type StudentPortalNotification, type StudentPortalOverview } from "@/domain/portal-source";
import {
  actionTitle,
  evoActionDueLabel,
  evoActionStatusLabel,
  evoActionTone,
  formatPortalDeadline,
  formatPortalMoney,
  formatPortalTimestamp,
  linkTarget,
  notificationRoute,
  notificationTargetLabel,
  portalNotificationKind,
  portalNotificationText,
  studentActionDueLabel,
} from "@/domain/presentation";
import { ApplicationCard, CaseCard, DatesCard, NewsCard } from "@/features/home/HomeCards";
import { HeroContent } from "@/features/home/HomeHero";
import type { AccessTier } from "@/session/access";
import { NOTIFICATION_ROW } from "@/test-fixtures/rpc-rows";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport, preparationRow, universityRow } from "@/test-fixtures/universities";
import { byClass, expand, findAll, firstByClass, nativeFragments, visibleFragments, webModule, webText, type WebNode } from "@/test-fixtures/web-oracle";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));

type Lang = "ru" | "ky";
type HomeViewProps = Record<string, unknown>;
const { HomeView } = webModule<{ HomeView: (props: HomeViewProps) => ReactElement }>("components/portal/home/HomeView.tsx");

// ---- Данные: придуманные, одни на веб и приложение --------------------------------------------------------------------

const NOW = new Date("2026-09-08T05:00:00Z"); // вторник, 11:00 в Бишкеке
const at = (iso: string) => `${iso}+00:00`;
const slot = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;
const doc = (n: number, label: string, dueAt: string | null, kind: "upload_document" | "replace_document" = "upload_document"): StudentPortalAction => ({ kind, label, dueAt: dueAt && at(dueAt), documentSlotId: slot(n) });
const pay = (label: string, dueAt: string | null, amountMinor = 10000, currency = "USD"): StudentPortalAction => ({ kind: "payment", label, dueAt: dueAt && at(dueAt), amountMinor, currency });
const overview = (actions: StudentPortalAction[], evo = false): StudentPortalOverview => ({
  operationalStage: "documents",
  studentAction: actions[0] ?? null,
  studentActions: actions,
  evoAction: evo ? { taskId: "88888888-8888-4888-8888-888888888888", title: "Проверить анкету", status: "in_progress", dueAt: null, dueOn: "2026-09-13" } : null,
  curatorDisplayName: null,
});

/** Вуз с одним набором: срок подачи, начало или месяц начала; `status` набора. */
function uni(n: number, intake: { applicationDeadline?: string | null; startDate?: string | null; startMonth?: string | null; status?: string }): PublishedUniversity {
  const row = universityRow(n);
  const content = JSON.parse(JSON.stringify(row.content)) as { programs: { intakes: Record<string, unknown>[] }[] };
  content.programs[0].intakes[0] = { ...content.programs[0].intakes[0], applicationDeadline: null, startDate: null, startMonth: null, ...intake };
  return { ...row, content } as never;
}

/** Программа студента: срок подтверждён, набор с датами. */
function program(n: number, intake: { applicationDeadline?: string | null; startDate?: string | null; status?: string }, extra: Record<string, unknown> = {}): CatalogPreparation {
  const row = preparationRow(n, "preparation") as unknown as { content: { programs: { intakes: Record<string, unknown>[] }[] } } & Record<string, unknown>;
  const content = JSON.parse(JSON.stringify(row.content)) as typeof row.content;
  content.programs[0].intakes[0] = { ...content.programs[0].intakes[0], applicationDeadline: null, startDate: null, startMonth: null, ...intake };
  return { ...row, content, deadlineStateAtSelection: "confirmed", ...extra } as never;
}

const note = (n: number, createdAt: string, extra: Record<string, unknown> = {}): StudentPortalNotification =>
  normalizeStudentPortalNotification({ ...NOTIFICATION_ROW, notification_id: `66666666-6666-4666-8666-${String(n).padStart(12, "0")}`, created_at: at(createdAt), read_at: null, ...extra });

type World = Readonly<{
  tier: AccessTier;
  now?: Date;
  overview?: StudentPortalOverview | null;
  news?: readonly StudentPortalNotification[] | null;
  favorites?: readonly PublishedUniversity[] | null;
  preparations?: readonly CatalogPreparation[] | null;
  application?: HomeApplication | null;
  csca?: readonly HomeDateItem[];
  studyCountry?: string | null;
  intake?: string | null;
}>;

const WORLDS: Readonly<Record<string, World>> = {
  "дела нет: план не опубликован": { tier: "assisted", overview: null },
  "дел нет": { tier: "assisted", overview: overview([]) },
  "одно дело с документом через 4 дня": { tier: "assisted", overview: overview([doc(1, "Паспорт", "2026-09-12T03:00:00", "replace_document")]) },
  "оплата с суммой и сроком, просрочена на 2 дня": { tier: "assisted", overview: overview([pay("Взнос 1", "2026-09-06T08:00:00", 12550, "KGS"), doc(2, "Аттестат", "2026-09-09T03:00:00")]) },
  // Два просроченных дела: в шапке то, что просрочено дольше всех (веб и приложение сортируют по сроку по возрастанию). Новое
  // просроченное стоит в списке первым, чтобы «первое в списке» и «самое давнее» были разными делами.
  "два просроченных дела: в шапке самое давнее, а не первое в списке": {
    tier: "assisted",
    overview: overview([pay("Взнос 1", "2026-09-06T08:00:00", 12550, "KGS"), doc(2, "Паспорт", "2026-09-03T03:00:00"), doc(3, "Аттестат", "2026-09-09T03:00:00")]),
  },
  "срок прошёл сегодня по часам": { tier: "assisted", overview: overview([doc(1, "Паспорт", "2026-09-08T03:00:00")]) },
  "срок сегодня, позже по часам": { tier: "assisted", overview: overview([pay("Взнос", "2026-09-08T10:00:00", 5000)]) },
  "пять дел: три строки и «Ещё действий»": {
    tier: "assisted",
    overview: overview([pay("Взнос 1", "2026-09-06T08:00:00"), doc(2, "Паспорт", "2026-09-09T03:00:00"), doc(3, "Аттестат", "2026-09-20T03:00:00"), pay("Взнос 2", "2026-10-01T08:00:00", 7000, "EUR"), doc(4, "Справка", null)]),
  },
  "дела без срока": { tier: "assisted", overview: overview([doc(1, "Паспорт", null), pay("Взнос", null, 2500)]) },
  "задача EVO и вузы с разными наборами": {
    tier: "assisted",
    overview: overview([doc(1, "Паспорт", "2026-09-30T03:00:00")], true),
    favorites: [
      uni(1, { applicationDeadline: "2026-10-15" }),
      uni(2, { startDate: "2026-11-01" }),
      uni(3, { startMonth: "2026-12" }), // месяц без дня в даты не идёт
      uni(4, { applicationDeadline: "2027-05-01" }), // дальше 60 дней
    ],
  },
  "свои программы: срок подтверждён, закрытый набор и чужой статус не идут; вуз с программой не повторяется": {
    tier: "assisted",
    overview: overview([]),
    favorites: [uni(1, { applicationDeadline: "2026-10-20" }), uni(2, { applicationDeadline: "2026-10-21" })],
    preparations: [
      program(1, { applicationDeadline: "2026-10-05", status: "open" }),
      program(2, { startDate: "2026-12-01", status: "announced" }), // нет срока подачи - берётся старт, но дальше окна
      program(3, { applicationDeadline: "2026-09-30", status: "closed" }),
      program(4, { applicationDeadline: "2026-09-25", status: "open" }, { applicationStatus: "submitted" }),
      program(5, { applicationDeadline: "2026-09-26", status: "open" }, { deadlineStateAtSelection: "needs_confirmation" }),
      program(6, { applicationDeadline: "2026-09-08", status: "open" }), // срок сегодня
    ],
  },
  "даты официальные CSCA": {
    tier: "assisted",
    overview: overview([]),
    csca: [
      { day: "2026-10-21", title: "CSCA: регистрация закрывается", href: "/portal/csca" },
      { day: "2026-11-14", title: "CSCA: экзамен", href: "/portal/csca" },
    ],
    studyCountry: "Китай",
    intake: "Набор на сентябрь 2027 года",
  },
  "в окне дат нет, позже есть: «Дальше» с годом": { tier: "assisted", overview: overview([]), favorites: [uni(1, { applicationDeadline: "2027-05-01" })] },
  "дат нет совсем": { tier: "assisted", overview: overview([]) },
  "шесть дат: показываются пять": {
    tier: "assisted",
    overview: overview([doc(1, "А", "2026-09-10T03:00:00"), doc(2, "Б", "2026-09-11T03:00:00"), doc(3, "В", "2026-09-12T03:00:00"), pay("Г", "2026-09-13T03:00:00"), doc(4, "Д", "2026-09-14T03:00:00"), doc(5, "Е", "2026-09-15T03:00:00")]),
  },
  "новости: время словом, прочитанное и нет": {
    tier: "assisted",
    overview: overview([]),
    news: [
      note(1, "2026-09-08T04:30:00"),
      note(2, "2026-09-07T11:00:00", { category: "payment.receipt", event_code: "payment_receipt_accepted", subject_label: "100 USD" }),
      note(3, "2026-09-05T08:00:00", { read_at: at("2026-09-06T00:00:00"), category: "message", event_code: "case_chat_message" }),
      note(4, "2026-08-20T08:00:00"),
      note(5, "2025-12-31T08:00:00", { category: "task", subject_label: "Старое" }),
    ],
  },
  "новостей нет": { tier: "assisted", overview: overview([]), news: [] },
  "лента новостей не прочиталась": { tier: "assisted", overview: overview([]), news: null },
  "до договора: анкета отправлена и одобрена": {
    tier: "approved",
    application: { status: "approved", submittedAt: at("2026-09-02T04:00:00"), decidedAt: at("2026-09-06T09:00:00") },
    favorites: [uni(1, { applicationDeadline: "2026-10-15" })],
  },
  "до договора: анкета на рассмотрении, прошлый год": { tier: "approved", application: { status: "pending", submittedAt: at("2025-12-31T04:00:00"), decidedAt: null } },
  "до договора: анкета не прочиталась": { tier: "approved", application: null },
  "полночь в Бишкеке: 23:59 и 00:01": { tier: "assisted", now: new Date("2026-09-08T17:59:00Z"), overview: overview([doc(1, "Паспорт", "2026-09-08T18:30:00"), pay("Взнос", "2026-09-09T17:58:00")]) },
};

// ---- Веб: развёрнутые блоки HomeView ----------------------------------------------------------------------------------

function webView(world: World, lang: Lang): WebNode {
  const now = world.now ?? NOW;
  return expand(
    HomeView({
      tier: world.tier,
      displayName: "Айжан",
      studyCountry: world.studyCountry ?? null,
      intake: world.intake ?? null,
      overview: world.overview ?? null,
      overviewFailed: false,
      news: world.news === undefined ? null : world.news,
      favorites: world.favorites ?? null,
      dates: world.csca ?? [],
      preparations: world.preparations ?? null,
      application: world.application ?? null,
      info: null,
      list: null,
      wideList: null,
      path: null,
      countryChoice: null,
      csca: null,
      locale: lang,
      now,
    }),
  );
}

const section = (view: WebNode, className: string) => firstByClass(view, className);
/** Строки блока веба; блока нет или он пуст - сразу ошибка теста: сравнение «ничего с ничем» ничего не доказывает. */
function fragmentsOf(node: WebNode | null): string[] {
  if (node === null) throw new Error("web-parity: блок не найден в разметке веба (веб изменился: нужно поправить сверку или перенести изменение)");
  const lines = visibleFragments(node);
  if (lines.length === 0) throw new Error("web-parity: блок веба пуст");
  return lines;
}

// ---- Приложение: те же блоки -------------------------------------------------------------------------------------------

async function appFragments(element: ReactElement, lang: Lang): Promise<string[]> {
  await renderPortal(element, testApi(fakeTransport({}).transport), lang);
  return nativeFragments(screen.toJSON());
}

function appInputs(world: World, lang: Lang) {
  const now = world.now ?? NOW;
  const home = getPortalStrings("home", lang);
  const admission = getPortalStrings("admission", lang);
  const dated = collectHomeDates({
    overview: world.overview ?? null,
    favorites: world.favorites ?? null,
    preparations: world.preparations ?? null,
    csca: world.csca ?? [],
    admission,
    home,
    now,
  });
  return { now, dated, countdown: homeCountdown({ overview: world.overview ?? null, dated, now, admission }) };
}

const CASES = Object.entries(WORLDS).flatMap(([name, world]) => (["ru", "ky"] as const).map((lang) => [`${name} [${lang}]`, world, lang] as const));

describe("«Главная» приложения читается так же, как веб (одни и те же данные в обоих)", () => {
  describe("шапка: приветствие, «страна · набор» и отсчёт", () => {
    it.each(CASES)("%s", async (_name, world, lang) => {
      const web = fragmentsOf(section(webView(world, lang), "pt-home-hero"));
      const { countdown } = appInputs(world, lang);
      const app = await appFragments(<HeroContent displayName="Айжан" studyCountry={world.studyCountry ?? null} intake={world.intake ?? null} countdown={countdown} />, lang);
      expect(app).toEqual(web);
      // Читалка слышит одну фразу плашки; просроченное дело - красная плашка (`data-overdue`).
      const view = webView(world, lang);
      const link = firstByClass(view, "pt-home-hero-count");
      expect(screen.queryByTestId("hero-countdown")?.props.accessibilityLabel).toBe(link?.props["aria-label"]);
      expect(countdown?.overdue === true).toBe(firstByClass(view, "pt-home-hero-count-big")?.props["data-overdue"] !== undefined);
    });
  });

  describe("«Что сделать сейчас»", () => {
    it.each(CASES.filter(([, world]) => world.tier === "assisted"))("%s", async (_name, world, lang) => {
      const web = fragmentsOf(section(webView(world, lang), "pt-home-case"));
      const { now } = appInputs(world, lang);
      const app = await appFragments(<CaseCard overview={world.overview ?? null} load={null} now={now} />, lang);
      expect(app).toEqual(web);
    });
  });

  describe("«Ближайшие даты»", () => {
    it.each(CASES)("%s", async (_name, world, lang) => {
      const web = fragmentsOf(section(webView(world, lang), "pt-home-dates"));
      const { now, dated } = appInputs(world, lang);
      const app = await appFragments(<DatesCard items={dated} today={todayForTimeline(now)} />, lang);
      expect(app).toEqual(web);
    });
  });

  describe("«Что нового»", () => {
    it.each(CASES.filter(([, world]) => world.tier === "assisted" && world.news !== undefined))("%s", async (_name, world, lang) => {
      const web = fragmentsOf(section(webView(world, lang), "pt-home-news"));
      const { now } = appInputs(world, lang);
      const loaded = world.news ? latestNews(world.news) : null;
      // Веб: `null` - чтение не удалось (плашка), приложение показывает свою плашку с повтором: сравниваются только прочитанные ленты.
      if (loaded === null) return;
      const app = await appFragments(<NewsCard news={loaded} load={null} now={now} />, lang);
      expect(app).toEqual(web);
    });
  });

  describe("«Ваша анкета» до договора", () => {
    it.each(CASES.filter(([, world]) => world.tier === "approved"))("%s", async (_name, world, lang) => {
      const view = webView(world, lang);
      const card = byClass(view, "pt-home-card").find((node) => node.props["data-slot"] === "case") ?? null;
      const web = fragmentsOf(card);
      const { now } = appInputs(world, lang);
      const app = await appFragments(<ApplicationCard application={world.application ?? null} now={now} />, lang);
      // Веб: заголовок карточки «Анкета» над названием и кнопка-ссылка внизу; приложение рисует те же четыре слоя.
      expect(app).toEqual(web);
      expect(applicationSteps(world.application ?? null, now, lang, getPortalStrings("home", lang)).length).toBeGreaterThan(0);
    });
  });
});

// ---- Куда ведут строки ------------------------------------------------------------------------------------------------

const navigate = router.navigate as jest.Mock;

/** Страница без параметров и якоря: `/portal/documents#document-x` и `/documents?focus=x` - одна страница. Параметр `focus` и экран программы держат тесты `HomeCards`. */
const pagePath = (route: string) => route.split(/[?#]/)[0];
/** Страница приложения по ссылке веба: у вкладок и вуза это тот же путь без `/portal` (`/portal/universities/<id>` -> `/universities/<id>`). */
const appPageOfWebHref = (href: string) => pagePath(href).replace(/^\/portal/, "") || "/home";
const hrefsIn = (node: WebNode | null) => findAll(node as WebNode, (item) => item.tag === "a").map((item) => String(item.props.href));

describe("строки ведут на те же страницы, что на вебе", () => {
  const assistedWorlds = Object.entries(WORLDS).filter(([, world]) => world.tier === "assisted");

  it.each(assistedWorlds)("«Что сделать сейчас»: %s", async (_name, world) => {
    const web = hrefsIn(section(webView(world, "ru"), "pt-home-case")).map(appPageOfWebHref);
    const { now } = appInputs(world, "ru");
    await renderPortal(<CaseCard overview={world.overview ?? null} load={null} now={now} />, testApi(fakeTransport({}).transport));
    const pressed: (string | null)[] = [];
    for (const id of ["case-open", "case-next-0", "case-next-1", "case-more"]) {
      const node = screen.queryByTestId(id);
      if (!node) continue;
      navigate.mockClear();
      await fireEvent.press(node);
      pressed.push(pagePath(String(navigate.mock.calls[0][0])));
    }
    expect(pressed).toEqual(web);
  });

  it.each(assistedWorlds)("«Ближайшие даты»: %s", async (_name, world) => {
    const rows = byClass(webView(world, "ru"), "pt-home-date-row").filter((row) => !String(row.props.href).startsWith("/portal/preparations/"));
    const { now, dated } = appInputs(world, "ru");
    await renderPortal(<DatesCard items={dated} today={todayForTimeline(now)} />, testApi(fakeTransport({}).transport));
    const webRows = byClass(webView(world, "ru"), "pt-home-date-row");
    const appRows = screen.queryAllByTestId(/^date-\d{4}-\d{2}-\d{2}$/);
    expect(appRows).toHaveLength(webRows.length);
    for (const [index, row] of appRows.entries()) {
      if (String(webRows[index].props.href).startsWith("/portal/preparations/")) continue;
      navigate.mockClear();
      await fireEvent.press(row);
      expect(pagePath(String(navigate.mock.calls[0][0]))).toBe(appPageOfWebHref(String(webRows[index].props.href)));
    }
    expect(rows.length).toBeLessThanOrEqual(webRows.length);
  });

  it.each(assistedWorlds)("отсчёт в шапке: %s", async (_name, world) => {
    const web = firstByClass(webView(world, "ru"), "pt-home-hero-count");
    const { countdown } = appInputs(world, "ru");
    await renderPortal(<HeroContent displayName="Айжан" studyCountry={null} intake={null} countdown={countdown} />, testApi(fakeTransport({}).transport));
    const link = screen.queryByTestId("hero-countdown");
    expect(link === null).toBe(web === null);
    if (!web || !link || String(web.props.href).startsWith("/portal/preparations/")) return;
    navigate.mockClear();
    await fireEvent.press(link);
    expect(pagePath(String(navigate.mock.calls[0][0]))).toBe(appPageOfWebHref(String(web.props.href)));
  });
});

// ---- Что нового: вид события и непрочитанное ---------------------------------------------------------------------------

describe("«Что нового»: значок вида события и точка непрочитанного как на вебе", () => {
  // Значки веба (HomeNews.KIND_ICON): планшет с отметкой - пакет, файл - документ, пузыри - ответ и сообщение, кошелёк - оплата, колокол - остальное.
  const KIND_OF_ICON: Record<string, string> = { ClipboardCheck: "package", FileText: "document", MessagesSquare: "message", Wallet: "payment", Bell: "other" };
  const NOTES = [
    note(1, "2026-09-08T04:30:00", { category: "document", event_code: "correction_required" }),
    note(2, "2026-09-08T03:30:00", { category: "payment.receipt", event_code: "payment_receipt_accepted", subject_label: "100 USD" }),
    note(3, "2026-09-08T02:30:00", { category: "message", event_code: "case_chat_message", read_at: at("2026-09-08T04:00:00") }),
    note(4, "2026-09-08T01:30:00", { category: "task", event_code: "case_help_answer" }),
    note(5, "2026-09-07T01:30:00", { category: "document", event_code: "application_package_review" }),
    note(6, "2026-09-06T01:30:00", { category: "document", event_code: "application_document_review" }),
    note(7, "2026-09-05T01:30:00", { category: "other", event_code: "something_new" }),
  ];

  it("тот же вид у каждой из трёх последних записей и то же слово «Новое»", async () => {
    const view = webView({ tier: "assisted", overview: overview([]), news: NOTES }, "ru");
    const rows = byClass(view, "pt-home-news-row");
    const shown = latestNews(NOTES).items;
    expect(rows).toHaveLength(shown.length);
    for (const [index, row] of rows.entries()) {
      const icon = findAll(row, (node) => node.tag === "svg")[0]?.props["data-icon"];
      expect(KIND_OF_ICON[String(icon)]).toBe(portalNotificationKind(shown[index]));
      expect(row.props["data-unread"] !== undefined).toBe(shown[index].readAt === null);
    }
    const { now } = appInputs({ tier: "assisted" }, "ru");
    await renderPortal(<NewsCard news={latestNews(NOTES)} load={null} now={now} />, testApi(fakeTransport({}).transport));
    for (const item of shown) expect(screen.queryByTestId(`news-unread-${item.notificationId}`, { includeHiddenElements: true }) !== null).toBe(item.readAt === null);
  });

  it.each(NOTES.map((item) => [`${item.category} / ${item.eventCode}`, item] as const))("вид записи %s: все слова веба", (_name, item) => {
    const { portalNotificationKind: webKind } = webModule<{ portalNotificationKind: (n: unknown) => string }>("components/portal/admission/presentation.ts");
    expect(portalNotificationKind(item)).toBe(webKind(item));
  });
});

// ---- «Ваша анкета»: отметки --------------------------------------------------------------------------------------------

describe("«Ваша анкета»: отметки сделано и текущая как на вебе", () => {
  it.each(Object.entries(WORLDS).filter(([, world]) => world.tier === "approved"))("%s", (_name, world) => {
    const card = byClass(webView(world, "ru"), "pt-home-card").find((node) => node.props["data-slot"] === "case") as WebNode;
    const marks = findAll(card, (node) => node.tag === "li").map((node) => (node.props["data-done"] !== undefined ? "done" : node.props["data-current"] !== undefined ? "current" : "?"));
    const steps = applicationSteps(world.application ?? null, NOW, "ru", getPortalStrings("home", "ru"));
    expect(steps.map((step) => step.kind)).toEqual(marks);
  });
});

// ---- Порядок блоков -----------------------------------------------------------------------------------------------------

/** Порядок блоков в одну колонку по CSS веба: `order` у `.pt-home-slot[data-slot]`, блоки вне колонок идут в порядке разметки. */
function cssSlotOrder(): Record<string, number> {
  const css = webText("app/(portal)/portal.css");
  const order: Record<string, number> = {};
  for (const match of css.matchAll(/\.pt-home-slot\[data-slot="(\w+)"\]\s*\{\s*order:\s*(\d+);\s*\}/g)) order[match[1]] = Number(match[2]);
  return order;
}

function webSlotOrder(input: { tier: AccessTier; hasJourney: boolean; hasCsca: boolean; hasEvoTask: boolean }): string[] {
  const order = cssSlotOrder();
  const probe = (name: string) => createElement("i", { "data-probe": name });
  const view = expand(
    HomeView({
      tier: input.tier,
      displayName: "Айжан",
      overview: null,
      news: null,
      favorites: null,
      info: input.hasEvoTask ? probe("evo") : null,
      list: probe("list"),
      csca: input.hasCsca ? probe("csca") : null,
      path: input.hasJourney ? { view: {} } : null,
      locale: "ru",
      now: NOW,
    }),
  );
  const result: string[] = [];
  const columns = byClass(view, "pt-home-columns")[0];
  for (const child of view.children) {
    if (typeof child === "string") continue;
    if (child.props["data-probe"] === "evo") result.push("evo");
    if (child === columns) {
      const slots = findAll(columns, (node) => node.props["data-slot"] !== undefined).map((node) => String(node.props["data-slot"]));
      // `Array.sort` устойчив: слоты с одним `order` остаются в порядке разметки, как у `display: contents` с `order`.
      result.push(...[...slots].sort((a, b) => (order[a] ?? 0) - (order[b] ?? 0)));
    }
    if (child.props["data-probe"] === "list") result.push("list");
  }
  return result;
}

describe("порядок блоков под шапкой: тот же, что у веба в одну колонку", () => {
  const tiers: AccessTier[] = ["assisted", "approved"];
  const combos = tiers.flatMap((tier) =>
    [false, true].flatMap((hasJourney) => [false, true].flatMap((hasCsca) => (tier === "assisted" ? [false, true] : [false]).map((hasEvoTask) => ({ tier, hasJourney, hasCsca, hasEvoTask })))),
  );

  it("правила порядка в CSS веба на месте (case 1, list 3, dates 4, news 5, csca 6)", () => {
    expect(cssSlotOrder()).toEqual({ case: 1, list: 3, dates: 4, news: 5, csca: 6 });
  });

  it.each(combos.map((combo) => [JSON.stringify(combo), combo] as const))("%s", (_name, combo) => {
    expect(homeSlots(combo)).toEqual(webSlotOrder(combo));
  });
});

// ---- Подписи и форматы (веб admission/presentation.ts и HomeCase.tsx) ------------------------------------------------------

type WebPresentation = {
  formatPortalDeadline: (value: string | null) => string | null;
  formatPortalTimestamp: (value: string | null) => string | null;
  formatPortalMoney: (amountMinor: number, currency: string) => string;
  studentActionDueLabel: (action: { dueAt: string | null }) => string | null;
  evoActionDueLabel: (action: unknown) => string | null;
  evoActionStatus: (action: unknown, strings: unknown) => { label: string; tone: string };
  portalNotificationText: (notification: unknown, strings: unknown) => { title: string; detail: string | null };
  portalNotificationTarget: (notification: unknown, strings: unknown) => { href: string; label: string };
};
const webPresentation = webModule<WebPresentation>("components/portal/admission/presentation.ts");
const webCase = webModule<{ actionTitle: (action: unknown, strings: unknown) => string }>("components/portal/home/HomeCase.tsx");

describe("форматы и подписи совпадают с вебом", () => {
  const instants = [null, "2026-09-12T03:00:00+00:00", "2026-09-30T19:30:00Z", "2026-12-31T18:00:00Z", "2027-01-01T00:00:00+06:00", "не дата", ""];

  it.each(instants)("срок и время по Бишкеку: %j", (value) => {
    expect(formatPortalDeadline(value)).toBe(webPresentation.formatPortalDeadline(value));
    expect(formatPortalTimestamp(value)).toBe(webPresentation.formatPortalTimestamp(value));
    expect(studentActionDueLabel({ dueAt: value })).toBe(webPresentation.studentActionDueLabel({ dueAt: value }));
  });

  it.each([
    [10000, "USD"],
    [12550, "KGS"],
    [100, "KGS"],
    [0, "EUR"],
    [1, "USD"],
    [-500, "USD"],
    [123456789, "KGS"],
    [99, "EUR"],
  ] as const)("сумма %s %s", (amount, currency) => {
    expect(formatPortalMoney(amount, currency)).toBe(webPresentation.formatPortalMoney(amount, currency));
  });

  it.each(["ru", "ky"] as const)("название дела на %s", (lang) => {
    const strings = getPortalStrings("admission", lang);
    for (const action of [doc(1, "Паспорт", null), doc(2, "Аттестат", null, "replace_document"), pay("Взнос", null)]) {
      expect(actionTitle(action, strings)).toBe(webCase.actionTitle(action, strings));
    }
  });

  it.each(["ru", "ky"] as const)("текст уведомления на %s", (lang) => {
    const strings = getPortalStrings("admission", lang);
    const events = ["case_chat_message", "payment_receipt_accepted", "payment_receipt_rejected", "case_help_answer", "correction_required"];
    for (const eventCode of events) {
      const item = note(1, "2026-09-08T04:30:00", { event_code: eventCode, subject_label: "Не видно сумму", detail: "Подробности" });
      expect(portalNotificationText(item, strings)).toEqual(webPresentation.portalNotificationText(item, strings));
    }
  });

  it.each(["ru", "ky"] as const)("куда ведёт и как называется ссылка уведомления на %s", (lang) => {
    const strings = getPortalStrings("admission", lang);
    const cases: [string, string][] = [
      ["document", "correction_required"],
      ["payment.receipt", "payment_receipt_accepted"],
      ["task", "something_new"],
      ["message", "case_chat_message"],
    ];
    for (const [category, eventCode] of cases) {
      const item = note(1, "2026-09-08T04:30:00", { category, event_code: eventCode });
      const web = webPresentation.portalNotificationTarget(item, strings);
      const route = notificationRoute(item);
      // Сообщение команды: веб ведёт на `/portal/messages` (чат по умолчанию), приложение сразу в беседу «Входящих» (#1356).
      if (eventCode === "case_chat_message") expect(route).toBe("/messages/chat");
      else expect(route).toBe(linkTarget(web.href)?.kind === "route" ? (linkTarget(web.href) as { route: string }).route : null);
      expect(notificationTargetLabel(item, strings)).toBe(web.label);
    }
  });

  it.each(["ru", "ky"] as const)("задача EVO на %s: срок, слово статуса и тон", (lang) => {
    const strings = getPortalStrings("admission", lang);
    const actions = [
      { taskId: "t", title: "Проверить", status: "open", dueAt: null, dueOn: null },
      { taskId: "t", title: "Проверить", status: "in_progress", dueAt: null, dueOn: "2026-09-13" },
      { taskId: "t", title: "Проверить", status: "blocked", dueAt: "2026-11-20T20:00:00+00:00", dueOn: null },
    ] as const;
    for (const action of actions) {
      expect(evoActionDueLabel(action)).toBe(webPresentation.evoActionDueLabel(action));
      const web = webPresentation.evoActionStatus(action, strings);
      expect(evoActionStatusLabel(action, strings)).toBe(web.label);
      expect(evoActionTone(action)).toBe(web.tone);
    }
  });
});
