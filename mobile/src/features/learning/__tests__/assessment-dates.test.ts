// Дата в истории попыток (G62): как на сайте, `dateStyle: "medium"` и UTC; без кыргызской локали или `timeZone` не падаем.
import { assessmentDateLabel } from "@/features/learning/tests/dates";

describe("дата завершения в истории попыток", () => {
  const evening = "2026-11-09T22:05:00+00:00"; // в Бишкеке это уже 10 ноября: на сайте дата по UTC

  it("русская локаль: средний формат, день по UTC (не по Бишкеку)", () => {
    expect(assessmentDateLabel(evening, "ru")).toBe("9 нояб. 2026 г.");
  });

  it("кыргызская локаль берётся у системы (формат движка, день по UTC)", () => {
    const expected = new Intl.DateTimeFormat("ky", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(evening));
    expect(assessmentDateLabel(evening, "ky")).toBe(expected);
  });

  it("у движка нет кыргызской локали: подпись на русской, без ошибки", () => {
    const real = Intl.DateTimeFormat;
    const spy = jest.spyOn(Intl, "DateTimeFormat").mockImplementation(((locale: string, options?: Intl.DateTimeFormatOptions) => {
      if (locale === "ky") throw new RangeError("Incorrect locale information provided");
      return new real(locale, options);
    }) as never);
    expect(assessmentDateLabel(evening, "ky")).toBe("9 нояб. 2026 г.");
    spy.mockRestore();
  });

  it("у движка нет и русской локали: местный пояс, затем число ГГГГ-ММ-ДД", () => {
    const spy = jest.spyOn(Intl, "DateTimeFormat").mockImplementation((() => {
      throw new RangeError("no Intl");
    }) as never);
    expect(assessmentDateLabel(evening, "ru")).toBe("2026-11-09");
    spy.mockRestore();
  });

  it("негодная дата - пустая подпись", () => {
    expect(assessmentDateLabel("не дата", "ru")).toBe("");
  });
});
