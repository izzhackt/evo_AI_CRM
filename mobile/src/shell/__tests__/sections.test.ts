import { PHONE_TABS, SECTIONS, allowedFor, hasTabBar, isAllowed, menuFor, tabsFor } from "@/shell/sections";

describe("разделы по уровню (Shell.tsx веба, #1355)", () => {
  it("assisted: три вкладки Главная, Документы, Входящие", () => {
    expect(tabsFor("assisted").map((s) => s.id)).toEqual(["home", "documents", "messages"]);
    expect(PHONE_TABS).toEqual(["home", "documents", "messages"]);
    expect(hasTabBar("assisted")).toBe(true);
  });
  it("«Поступления» как раздела нет", () => {
    expect(SECTIONS.map((s) => s.id as string)).not.toContain("overview");
  });
  it("approved: одна вкладка «Главная», панель не рисуется; Документы, Оплата и Входящие закрыты", () => {
    expect(tabsFor("approved").map((s) => s.id)).toEqual(["home"]);
    expect(hasTabBar("approved")).toBe(false);
    for (const id of ["documents", "payments", "messages"] as const) expect(isAllowed(id, "approved")).toBe(false);
  });
  it("assisted видит всё, approved — всё кроме Документов, Оплаты и Входящих", () => {
    expect(allowedFor("assisted")).toHaveLength(SECTIONS.length);
    expect(allowedFor("approved").map((s) => s.id)).toEqual(["home", "universities", "professions", "english", "csca", "tests", "profile"]);
  });
  it("меню: группы «Выбор» и «Учёба», Профиль последним; «Оплата» в меню", () => {
    const blocks = menuFor("assisted");
    expect(blocks.map((b) => b.group)).toEqual([null, "choice", "prep", null]);
    expect(blocks[0]?.sections.map((s) => s.id)).toEqual(["home", "documents", "payments", "messages"]);
    expect(blocks[3]?.sections.map((s) => s.id)).toEqual(["profile"]);
    expect(menuFor("approved")[0]?.sections.map((s) => s.id)).toEqual(["home"]);
  });
});
