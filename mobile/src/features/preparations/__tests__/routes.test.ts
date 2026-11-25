// Ссылки на экран «Требования программы»: другие срезы ведут на него до того, как он построен, поэтому форма ссылки
// закреплена тестом.
import { PREPARATION_ROUTE, preparationHref, preparationPath } from "@/features/preparations/routes";

const ID = "3f2a9c1e-5b7d-4e86-9a10-0c4d8e6b7f21";

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
  });
});
