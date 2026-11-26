import { getPortalStrings } from "@web/lib/portal/i18n";
import type { PublishedUniversity } from "@web/lib/platform-university-catalog";

import {
  HOME_CASE_ROWS,
  HOME_NEWS_LIMIT,
  applicationSteps,
  caseRows,
  collectHomeDates,
  countdownWhen,
  heroSub,
  homeCountdown,
  homeDueStatus,
  homeParams,
  homeSlots,
  latestNews,
  overviewRedirectParams,
  showCountryChoice,
} from "@/domain/home-model";
import { buildPortalOverview, normalizeStudentPortalNotification } from "@/domain/portal-source";

import { NOTIFICATION_ROW, OVERVIEW_ROW, PAYMENT_ROW, SLOT_ID } from "@/test-fixtures/rpc-rows";
import { preparationRow, uuidN } from "@/test-fixtures/universities";

describe("порядок блоков Главной (под шапкой пути)", () => {
  it("assisted со страной: задача, дело, «Мой список» выше дат, новости, CSCA для Китая", () => {
    expect(homeSlots({ tier: "assisted", hasJourney: true, hasCsca: true, hasEvoTask: true })).toEqual(["evo", "case", "list", "dates", "news", "csca"]);
    expect(homeSlots({ tier: "assisted", hasJourney: true, hasCsca: false, hasEvoTask: false })).toEqual(["case", "list", "dates", "news"]);
  });
  it("без страны пути нет, выбор страны стоит выше блоков, список уходит под остальные (веб `listInColumn`)", () => {
    expect(homeSlots({ tier: "assisted", hasJourney: false, hasCsca: false, hasEvoTask: false })).toEqual(["case", "dates", "news", "list"]);
    expect(showCountryChoice(false)).toBe(true);
    expect(showCountryChoice(true)).toBe(false);
  });
  it("approved: одна «Ваша анкета»; без задачи EVO и новостей; список выше дат только у Китая", () => {
    expect(homeSlots({ tier: "approved", hasJourney: true, hasCsca: false, hasEvoTask: false })).toEqual(["case", "dates", "list"]);
    expect(homeSlots({ tier: "approved", hasJourney: true, hasCsca: true, hasEvoTask: true })).toEqual(["case", "list", "dates", "csca"]);
    expect(homeSlots({ tier: "approved", hasJourney: false, hasCsca: false, hasEvoTask: false })).toEqual(["case", "dates", "list"]);
  });
});

describe("параметры ссылок на Главную", () => {
  it("?list=programs|universities и ?path=open; остальное игнорируется", () => {
    expect(homeParams({ list: "programs" })).toEqual({ listTab: "programs", openPath: false, stamp: "" });
    expect(homeParams({ list: ["universities"], path: "open" })).toEqual({ listTab: "universities", openPath: true, stamp: "" });
    expect(homeParams({ list: "x", path: "closed" })).toEqual({ listTab: null, openPath: false, stamp: "" });
    expect(homeParams({ list: "programs", at: "1" }).stamp).toBe("1");
    expect(homeParams({})).toEqual({ listTab: null, openPath: false, stamp: "" });
  });
});

describe("новости", () => {
  const make = (index: number, readAt: string | null) =>
    normalizeStudentPortalNotification({
      ...NOTIFICATION_ROW,
      notification_id: `66666666-6666-4666-8666-66666666660${index}`,
      created_at: `2026-09-0${index}T08:00:00+00:00`,
      read_at: readAt,
    });
  it("три последних по времени, непрочитанные считаются по всем", () => {
    const all = [make(1, null), make(2, "2026-09-09T08:00:00+00:00"), make(3, null), make(4, null), make(5, null)];
    const view = latestNews(all);
    expect(view.items.map((n) => n.createdAt.slice(8, 10))).toEqual(["05", "04", "03"]);
    expect(view.items).toHaveLength(HOME_NEWS_LIMIT);
    expect(view.unread).toBe(4);
  });
  it("пусто", () => {
    expect(latestNews([])).toEqual({ items: [], unread: 0 });
  });
});

describe("ближайшие даты", () => {
  const home = getPortalStrings("home", "ru");
  const admission = getPortalStrings("admission", "ru");
  const university = (id: string, intake: { applicationDeadline: string | null; startDate: string | null; startMonth: string | null }): PublishedUniversity => ({
    id,
    version: 1,
    publishedAt: "2026-01-01T00:00:00+00:00",
    content: {
      name: `Вуз ${id}`,
      country: "MY",
      city: "Куала-Лумпур",
      programs: [{ id: "p", title: "Программа", level: "bachelor", intakes: [{ id: "i", label: "Осень", deadlineTime: null, timezone: null, status: "open", note: "", sourceUrl: "https://example.org", verifiedOn: "2026-01-01", ...intake }] }],
    } as never,
  });
  const base = { overview: null, favorites: null, preparations: null, csca: [], admission, home, now: new Date("2026-09-01T00:00:00Z") } as const;

  it("сроки действий и дедлайн вуза; месяц старта без дня пропускается; вуз ведёт на свою карточку", () => {
    const overview = buildPortalOverview([OVERVIEW_ROW], [PAYMENT_ROW]);
    const dates = collectHomeDates({
      ...base,
      overview,
      favorites: [university("A", { applicationDeadline: "2027-02-01", startDate: null, startMonth: null }), university("B", { applicationDeadline: null, startDate: null, startMonth: "2027-09" })],
    });
    expect(dates.map((d) => d.title)).toEqual(["Замените документ: Паспорт", "Оплата: Услуги EVO", "Вуз A: последний день подачи"]);
    expect(dates.map((d) => d.day)).toEqual(["2026-09-12", "2026-10-01", "2027-02-01"]);
    // документ ведёт на свою строку «Документов» (веб `/portal/documents#document-<slotId>`), оплата - на «Оплату»
    expect(dates.map((d) => d.href)).toEqual([`/documents?focus=${SLOT_ID}`, "/payments", "/universities/A"]);
  });

  it("сроки своих программ идут в даты, а общая строка того же вуза из избранного их не повторяет", () => {
    const confirmed = { ...preparationRow(1), deadlineStateAtSelection: "confirmed" } as never;
    const unconfirmed = preparationRow(2) as never; // срок «нужно уточнить» датой не считается
    const dates = collectHomeDates({
      ...base,
      preparations: [confirmed, unconfirmed],
      favorites: [university(uuidN(1), { applicationDeadline: "2027-02-01", startDate: null, startMonth: null }), university("Z", { applicationDeadline: "2027-03-01", startDate: null, startMonth: null })],
    });
    expect(dates.map((d) => d.title)).toEqual(["Информатика, Университет 1: последний день подачи", "Вуз Z: последний день подачи"]);
    // срок программы ведёт на экран этой программы (веб `/portal/preparations/<applicationId>`), а не на общий список
    expect(dates[0]).toMatchObject({ day: "2027-05-01", href: `/preparations/${uuidN(1, "bbbbbbbb")}` });
    expect(dates.some((d) => d.title.startsWith("Вуз " + uuidN(1)))).toBe(false);
  });

  it("официальные даты CSCA: адрес веба превращается в маршрут приложения", () => {
    const dates = collectHomeDates({ ...base, csca: [{ day: "2026-10-21", title: "CSCA: регистрация закрывается", href: "/portal/csca" }, { day: "2026-11-14", title: "CSCA: экзамен", href: "/portal/csca" }] });
    expect(dates).toEqual([
      { day: "2026-10-21", title: "CSCA: регистрация закрывается", href: "/csca" },
      { day: "2026-11-14", title: "CSCA: экзамен", href: "/csca" },
    ]);
  });

  it("без данных дат нет", () => {
    expect(collectHomeDates({ ...base, now: new Date() })).toEqual([]);
  });
});

describe("отсчёт в шапке", () => {
  const home = getPortalStrings("home", "ru");
  const admission = getPortalStrings("admission", "ru");
  const overview = buildPortalOverview([OVERVIEW_ROW], [PAYMENT_ROW]);
  const dated = [{ day: "2026-09-12", title: "Замените документ: Паспорт", href: "/documents" }, { day: "2026-10-01", title: "Оплата: Услуги EVO", href: "/payments" }];

  it("ближайшая дата окна и сколько до неё дней", () => {
    expect(homeCountdown({ overview, dated, now: new Date("2026-09-01T05:00:00Z"), admission })).toEqual({ ...dated[0], days: 11 });
    // у «Сегодня» дней 0, у «Завтра» 1: слово ставит countdownWhen
    expect(homeCountdown({ overview: null, dated, now: new Date("2026-09-11T05:00:00Z"), admission })?.days).toBe(1);
    expect(homeCountdown({ overview: null, dated, now: new Date("2026-09-12T05:00:00Z"), admission })?.days).toBe(0);
  });

  it("просроченное дело важнее будущей даты: слово «Просрочено» и ссылка на это дело", () => {
    // срок паспорта 12.09 03:00 UTC (09:00 Бишкека) прошёл; ближайшая дата окна - платёж 1.10
    const countdown = homeCountdown({ overview, dated: [dated[1]], now: new Date("2026-09-20T05:00:00Z"), admission });
    expect(countdown).toEqual({ day: "2026-09-12", title: "Замените документ: Паспорт", href: `/documents?focus=${SLOT_ID}`, days: 0, overdue: true });
    expect(countdownWhen(countdown!, "ru", home)).toEqual({ big: "Просрочено", word: null });
  });

  it("дат на 60 дней нет - отсчёта нет", () => {
    expect(homeCountdown({ overview: null, dated: [{ day: "2027-05-01", title: "Позже", href: "/universities" }], now: new Date("2026-09-01T05:00:00Z"), admission })).toBeNull();
    expect(homeCountdown({ overview: null, dated: [], now: new Date(), admission })).toBeNull();
  });

  it("число со словом по формам русского; «Сегодня» и «Завтра» вместо числа; кыргызский", () => {
    const when = (days: number) => countdownWhen({ days }, "ru", home);
    expect(when(0)).toEqual({ big: "Сегодня", word: null });
    expect(when(1)).toEqual({ big: "Завтра", word: null });
    expect(when(2)).toEqual({ big: "2", word: "дня до" });
    expect(when(5)).toEqual({ big: "5", word: "дней до" });
    expect(when(21)).toEqual({ big: "21", word: "день до" });
    const ky = getPortalStrings("home", "ky");
    expect(countdownWhen({ days: 5 }, "ky", ky)).toEqual({ big: "5", word: ky["heroDays.many"] });
    expect(countdownWhen({ days: 1 }, "ky", ky).big).toBe(ky.heroTomorrow);
  });
});

describe("строка под приветствием", () => {
  const home = getPortalStrings("home", "ru");
  it("«страна · набор» со строчной буквы набора; нет набора - одна страна; нет страны - строки нет", () => {
    expect(heroSub({ studyCountry: "Китай", intake: "Набор на сентябрь 2027 года", home })).toBe("Китай · набор на сентябрь 2027 года");
    expect(heroSub({ studyCountry: "Китай", intake: null, home })).toBe("Китай");
    expect(heroSub({ studyCountry: null, intake: "Набор на сентябрь 2027 года", home })).toBeNull();
  });
});

describe("срок дела словом", () => {
  const home = getPortalStrings("home", "ru");
  const now = new Date("2026-09-10T05:00:00Z"); // 11:00 в Бишкеке
  const status = (dueAt: string) => homeDueStatus(dueAt, now, "ru", home);
  it("дальше - нейтрально, завтра и сегодня - внимание, прошло - опасно", () => {
    expect(status("2026-09-12T03:00:00+00:00")).toEqual({ label: "через 2 дня", tone: "neutral" });
    expect(status("2026-09-11T03:00:00+00:00")).toEqual({ label: "завтра", tone: "warn" });
    expect(status("2026-09-10T08:00:00+00:00")).toEqual({ label: "сегодня", tone: "warn" });
    expect(status("2026-09-07T03:00:00+00:00")).toEqual({ label: "просрочено на 3 дня", tone: "danger" });
  });
  it("срок, прошедший сегодня по часам, уже «просрочено»", () => {
    expect(status("2026-09-10T03:00:00+00:00")).toEqual({ label: "просрочено", tone: "danger" });
  });
});

describe("дела на карточке", () => {
  const action = (n: number) => ({ kind: "upload_document" as const, label: `Документ ${n}`, dueAt: null, documentSlotId: `slot-${n}` });
  const overviewWith = (n: number) => ({ operationalStage: "documents", studentAction: n ? action(1) : null, studentActions: Array.from({ length: n }, (_, i) => action(i + 1)), evoAction: null, curatorDisplayName: null }) as never;
  it("первое - кнопкой, ещё два строками, остальные - «Ещё действий: N» (N = всего - 3)", () => {
    expect(HOME_CASE_ROWS).toBe(3);
    expect(caseRows(overviewWith(1))).toMatchObject({ next: [], remaining: 0 });
    const two = caseRows(overviewWith(2));
    expect(two.next.map((a) => a.label)).toEqual(["Документ 2"]);
    expect(two.remaining).toBe(0);
    const five = caseRows(overviewWith(5));
    expect(five.next.map((a) => a.label)).toEqual(["Документ 2", "Документ 3"]);
    expect(five.remaining).toBe(2);
    expect(caseRows(null)).toEqual({ primary: null, next: [], remaining: 0 });
  });
});

describe("«Ваша анкета» до договора", () => {
  const home = getPortalStrings("home", "ru");
  const now = new Date("2026-11-20T05:00:00Z");
  it("отправлена и одобрена с датами, затем «Менеджер свяжется с вами» без срока", () => {
    const steps = applicationSteps({ status: "approved", submittedAt: "2026-11-10T04:00:00+00:00", decidedAt: "2026-11-18T09:00:00+00:00" }, now, "ru", home);
    expect(steps.map((step) => [step.kind, step.text, step.date])).toEqual([
      ["done", "Анкета отправлена", "10 нояб."],
      ["done", "Анкета одобрена", "18 нояб."],
      ["current", "Менеджер свяжется с вами", null],
    ]);
  });
  it("на рассмотрении - одна отметка «отправлена»; прошлый год - с годом", () => {
    const steps = applicationSteps({ status: "pending", submittedAt: "2025-12-31T04:00:00+00:00", decidedAt: null }, now, "ru", home);
    expect(steps.map((step) => [step.text, step.date])).toEqual([["Анкета отправлена", "31 дек. 2025"], ["Менеджер свяжется с вами", null]]);
  });
  it("анкета не прочиталась - только текущий шаг", () => {
    expect(applicationSteps(null, now, "ru", home)).toEqual([{ kind: "current", text: "Менеджер свяжется с вами", date: null }]);
  });
});

describe("старый /overview -> параметры «Главной»", () => {
  it("path=open раскрывает путь, view=programs открывает «Мои программы», метка всегда", () => {
    expect(overviewRedirectParams({ path: "open" }, "7")).toEqual({ path: "open", at: "7" });
    expect(overviewRedirectParams({ view: "programs" }, "7")).toEqual({ at: "7", list: "programs" });
    expect(overviewRedirectParams({ path: "open", view: "programs" }, "7")).toEqual({ path: "open", at: "7", list: "programs" });
    expect(overviewRedirectParams({ path: ["open"], view: ["programs"] }, "7")).toEqual({ path: "open", at: "7", list: "programs" });
  });
  it("прочие значения не попадают в параметры", () => {
    expect(overviewRedirectParams({ path: "closed", view: "universities" }, "7")).toEqual({ at: "7" });
    expect(overviewRedirectParams({}, "7")).toEqual({ at: "7" });
  });
});
