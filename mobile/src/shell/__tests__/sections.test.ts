import { PHONE_TABS, SECTIONS, allowedFor, isAllowed, menuFor, tabsFor } from "@/shell/sections";

describe("разделы по уровню (Shell.tsx веба)", () => {
  it("assisted: четыре вкладки Главная, Поступление, Документы, Входящие", () => {
    expect(tabsFor("assisted").map((s) => s.id)).toEqual(["home", "overview", "documents", "messages"]);
    expect(PHONE_TABS).toEqual(["home", "overview", "documents", "messages"]);
  });
  it("approved: только Главная и Поступление; Документы, Оплата и Входящие закрыты", () => {
    expect(tabsFor("approved").map((s) => s.id)).toEqual(["home", "overview"]);
    for (const id of ["documents", "payments", "messages"] as const) expect(isAllowed(id, "approved")).toBe(false);
  });
  it("assisted видит всё, approved — всё кроме Документов, Оплаты и Входящих", () => {
    expect(allowedFor("assisted")).toHaveLength(SECTIONS.length);
    expect(allowedFor("approved").map((s) => s.id)).toEqual(["home", "overview", "universities", "professions", "english", "csca", "tests", "profile"]);
  });
  it("меню: группы «Выбор» и «Учёба», Профиль последним", () => {
    const blocks = menuFor("assisted");
    expect(blocks.map((b) => b.group)).toEqual([null, "choice", "prep", null]);
    expect(blocks[0]?.sections.map((s) => s.id)).toEqual(["home", "overview", "documents", "payments", "messages"]);
    expect(blocks[3]?.sections.map((s) => s.id)).toEqual(["profile"]);
    expect(menuFor("approved")[0]?.sections.map((s) => s.id)).toEqual(["home", "overview"]);
  });
});
