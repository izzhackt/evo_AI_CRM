// Дата в истории попыток (G62): как на сайте, `dateStyle: "medium"` и UTC; без кыргызской локали или `timeZone` не падаем.
// Движок без локали ошибку не бросает, а молча берёт локаль устройства (проверено на Node: `new Intl.DateTimeFormat("zz-ZZ")` даёт en-US),
// поэтому наличие локали проверяется заранее, а не ловится try/catch (ревью #1559).
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

  // Подмена `Intl.DateTimeFormat` теряет его статический `supportedLocalesOf`, а у настоящего движка он есть: возвращаем.
  const stubIntl = (make: (locale: string, options?: Intl.DateTimeFormatOptions) => Intl.DateTimeFormat, supportedLocalesOf: (locales: string | string[]) => string[]) => {
    const spy = jest.spyOn(Intl, "DateTimeFormat").mockImplementation(make as never);
    Object.assign(Intl.DateTimeFormat, { supportedLocalesOf });
    return spy;
  };

  it("у движка нет кыргызской локали и он, как настоящий, не бросает ошибку, а берёт локаль устройства: подпись всё равно на русской", () => {
    // Настоящее поведение: неизвестный (но верно записанный) язык даёт формат устройства, здесь английский.
    const real = Intl.DateTimeFormat;
    const spy = stubIntl((locale, options) => new real(locale === "ky" ? "en-US" : locale, options), (locales) => (String(locales) === "ky" ? [] : [String(locales)]));
    expect(assessmentDateLabel(evening, "ky")).toBe("9 нояб. 2026 г.");
    expect(spy).not.toHaveBeenCalledWith("ky", expect.anything());
    spy.mockRestore();
  });

  it("кыргызская локаль есть: спрашивается именно она", () => {
    const real = Intl.DateTimeFormat;
    const spy = stubIntl((locale, options) => new real(locale, options), (locales) => [String(locales)]);
    assessmentDateLabel(evening, "ky");
    expect(spy).toHaveBeenCalledWith("ky", expect.objectContaining({ dateStyle: "medium", timeZone: "UTC" }));
    spy.mockRestore();
  });

  it("локаль есть, а движок не знает `timeZone`: тот же язык по местному поясу, без ошибки", () => {
    const real = Intl.DateTimeFormat;
    const spy = stubIntl(
      (locale, options) => {
        if (options?.timeZone) throw new RangeError("Invalid time zone specified: UTC");
        return new real(locale, options);
      },
      (locales) => [String(locales)],
    );
    expect(assessmentDateLabel("2026-11-09T12:00:00+00:00", "ru")).toBe("9 нояб. 2026 г.");
    spy.mockRestore();
  });

  it("у движка нет и русской локали: число ГГГГ-ММ-ДД", () => {
    const spy = stubIntl(() => {
      throw new RangeError("no Intl");
    }, () => []);
    expect(assessmentDateLabel(evening, "ru")).toBe("2026-11-09");
    expect(assessmentDateLabel(evening, "ky")).toBe("2026-11-09");
    spy.mockRestore();
  });

  it("негодная дата - пустая подпись", () => {
    expect(assessmentDateLabel("не дата", "ru")).toBe("");
  });
});
