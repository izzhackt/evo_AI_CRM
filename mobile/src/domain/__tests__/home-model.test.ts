import { getPortalStrings } from "@web/lib/portal/i18n";
import type { PublishedUniversity } from "@web/lib/platform-university-catalog";

import { HOME_NEWS_LIMIT, collectHomeDates, homeSlots, latestNews, showCountryChoice } from "@/domain/home-model";
import { buildPortalOverview, normalizeStudentPortalNotification } from "@/domain/portal-source";

import { NOTIFICATION_ROW, OVERVIEW_ROW, PAYMENT_ROW } from "@/test-fixtures/rpc-rows";

describe("порядок блоков Главной", () => {
  it("assisted со страной и CSCA: дело, путь, вузы, даты, новости, CSCA", () => {
    expect(homeSlots({ tier: "assisted", hasJourney: true, hasCscaCard: true })).toEqual(["case", "path", "universities", "dates", "news", "csca"]);
  });
  it("без страны пути нет, выбор страны стоит выше блоков", () => {
    expect(homeSlots({ tier: "assisted", hasJourney: false, hasCscaCard: false })).toEqual(["case", "universities", "dates", "news"]);
    expect(showCountryChoice(false)).toBe(true);
    expect(showCountryChoice(true)).toBe(false);
  });
  it("approved: «Ваша анкета» вместо дела, новостей нет", () => {
    expect(homeSlots({ tier: "approved", hasJourney: true, hasCscaCard: false })).toEqual(["case", "path", "universities", "dates"]);
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
