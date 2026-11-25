// Ссылки на экран «Требования программы»: другие срезы ведут на него до того, как он построен, поэтому форма ссылки
// закреплена тестом.
import { PREPARATION_ROUTE, preparationHref, preparationPath } from "@/features/preparations/routes";

const ID = "3f2a9c1e-5b7d-4e86-9a10-0c4d8e6b7f21";
const LIST_PATH = "/home?list=programs";
const LIST_HREF = { pathname: "/home", params: { list: "programs" } };

describe("маршрут «Требования программы»", () => {
  it("шаблон совпадает с веб-маршрутом /portal/preparations/[applicationId]", () => {
    expect(PREPARATION_ROUTE).toBe("/preparations/[applicationId]");
  });

  it("preparationHref: объектная форма expo-router с параметром applicationId", () => {
    expect(preparationHref(ID)).toEqual({ pathname: "/preparations/[applicationId]", params: { applicationId: ID } });
  });

  it("preparationPath: строка /preparations/<id>", () => {
    expect(preparationPath(ID)).toBe(`/preparations/${ID}`);
  });

  it("идентификатор кодируется: служебные знаки внутри него не меняют путь", () => {
    expect(preparationPath("a/b")).toBe("/preparations/a%2Fb");
    expect(preparationPath("a?b#c")).toBe("/preparations/a%3Fb%23c");
    expect(preparationPath("../universities")).toBe("/preparations/..%2Funiversities");
    expect(preparationPath("%2e%2e")).toBe("/preparations/%252e%252e");
  });
});

describe("негодный идентификатор: безопасная ссылка на список программ, без исключения", () => {
  // `unknown`: в рабочих данных сюда может прийти что угодно, а не только строка.
  const bad: [string, unknown][] = [
    ["пустая строка", ""],
    ["одни пробелы", "   "],
    ["перевод строки и табуляция", "\n\t"],
    ["точка", "."],
    ["две точки: путь вверх", ".."],
    ["две точки с пробелами", " .. "],
    ["undefined", undefined],
    ["null", null],
    ["число", 42],
  ];

  it.each(bad)("%s: preparationPath ведёт на список", (_name, value) => {
    expect(() => preparationPath(value as string)).not.toThrow();
    expect(preparationPath(value as string)).toBe(LIST_PATH);
  });

  it.each(bad)("%s: preparationHref ведёт на список", (_name, value) => {
    expect(() => preparationHref(value as string)).not.toThrow();
    expect(preparationHref(value as string)).toEqual(LIST_HREF);
  });

  it("три точки и другие необычные, но годные идентификаторы остаются обычной ссылкой", () => {
    expect(preparationPath("...")).toBe("/preparations/...");
    expect(preparationPath("a.b")).toBe("/preparations/a.b");
    expect(preparationHref("...")).toEqual({ pathname: "/preparations/[applicationId]", params: { applicationId: "..." } });
  });
});
