import { getPortalStrings } from "@web/lib/portal/i18n";
import type { PublishedUniversity } from "@web/lib/platform-university-catalog";

import { HOME_NEWS_LIMIT, collectHomeDates, homeParams, homeSlots, latestNews, overviewRedirectParams, showCountryChoice } from "@/domain/home-model";
import { buildPortalOverview, normalizeStudentPortalNotification } from "@/domain/portal-source";

import { NOTIFICATION_ROW, OVERVIEW_ROW, PAYMENT_ROW } from "@/test-fixtures/rpc-rows";

describe("порядок блоков Главной", () => {
  it("assisted со страной, CSCA и задачей EVO: задача, дело, путь, написать EVO, даты, новости, CSCA, список, весь путь", () => {
    expect(homeSlots({ tier: "assisted", hasJourney: true, hasCscaCard: true, hasEvoTask: true })).toEqual(["evo", "case", "path", "dates", "news", "csca", "list", "fullPath"]);
  });
  it("без страны пути нет (ни карточки, ни полного), выбор страны стоит выше блоков; список остаётся", () => {
    expect(homeSlots({ tier: "assisted", hasJourney: false, hasCscaCard: false, hasEvoTask: false })).toEqual(["case", "dates", "news", "list"]);
    expect(showCountryChoice(false)).toBe(true);
    expect(showCountryChoice(true)).toBe(false);
  });
  it("approved: одна «Ваша анкета» вместо дела; без «Написать EVO», новостей и задачи EVO", () => {
    expect(homeSlots({ tier: "approved", hasJourney: true, hasCscaCard: false, hasEvoTask: false })).toEqual(["case", "path", "dates", "list", "fullPath"]);
    expect(homeSlots({ tier: "approved", hasJourney: true, hasCscaCard: true, hasEvoTask: true })).toEqual(["case", "path", "dates", "csca", "list", "fullPath"]);
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

  it("сроки действий и дедлайн вуза; месяц старта без дня пропускается", () => {
    const overview = buildPortalOverview([OVERVIEW_ROW], [PAYMENT_ROW]);
    const dates = collectHomeDates({
      overview,
      favorites: [university("A", { applicationDeadline: "2027-02-01", startDate: null, startMonth: null }), university("B", { applicationDeadline: null, startDate: null, startMonth: "2027-09" })],
      admission,
      home,
      now: new Date("2026-09-01T00:00:00Z"),
    });
    expect(dates.map((d) => d.title)).toEqual(["Замените документ: Паспорт", "Оплата: Услуги EVO", "Вуз A: последний день подачи"]);
    expect(dates.map((d) => d.day)).toEqual(["2026-09-12", "2026-10-01", "2027-02-01"]);
    expect(dates.map((d) => d.href)).toEqual(["/documents", "/payments", "/universities"]);
  });
  it("без данных дат нет", () => {
    expect(collectHomeDates({ overview: null, favorites: null, admission, home, now: new Date() })).toEqual([]);
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
