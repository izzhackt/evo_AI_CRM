import { parseStudentUniversityIndexResponse } from "@web/lib/portal/university-index";
import { getPortalStrings } from "@web/lib/portal/i18n";

import { countryCards, countryPageModel, countryPins, cityPageModel, placeCounts, searchCountry, searchIndex, tileModel, universityPlace } from "@/features/universities/model";
import { indexBody } from "@/test-fixtures/university-index";

const parsed = parseStudentUniversityIndexResponse(indexBody());
if (!parsed || parsed.notModified) throw new Error("fixture");
const index = parsed.index;
const ru = getPortalStrings("universities", "ru");
const ky = getPortalStrings("universities", "ky");

describe("страны и счётчики", () => {
  it("шесть стран в порядке продукта, счётчики пересчитаны по вузам", () => {
    const cards = countryCards(index, ru, "ru");
    expect(cards.map((c) => c.code)).toEqual(["CN", "MY", "AE", "TR", "IT", "CZ"]);
    // Число и слово не разрываются переносом (неразрывный пробел, как `placeCountsLabel` веба).
    expect(cards[1]?.counts).toBe("5\u00a0университетов · 3\u00a0города");
    expect(cards[2]).toMatchObject({ counts: "Пока нет университетов", empty: true });
  });

  it("склонение: RU по правилам, KY одна форма", () => {
    expect(placeCounts(ru, 1, null, "ru")).toBe("1\u00a0университет");
    expect(placeCounts(ru, 5, 11, "ru")).toBe("5\u00a0университетов · 11\u00a0городов");
    expect(placeCounts(ru, 22, 2, "ru")).toBe("22\u00a0университета · 2\u00a0города");
    expect(placeCounts(ky, 2, 3, "ky")).toBe(`${ky["count.university.many"].replace("{count}", "2").replace(" ", "\u00a0")} · ${ky["count.city.many"].replace("{count}", "3").replace(" ", "\u00a0")}`);
  });
});

describe("точки карты страны: стабильны, пока тот же индекс, страна и язык", () => {
  it("модель страницы при каждой отрисовке экрана отдаёт те же точки (массив и сами точки), а не новые", () => {
    const first = countryPageModel(index, "MY", ru, "ru")!;
    const again = countryPageModel(index, "MY", ru, "ru")!;
    expect(first.pins.length).toBeGreaterThan(0);
    expect(again.pins).toBe(first.pins);
    expect(again.pins[0]).toBe(first.pins[0]);
    expect(countryPins(index, "MY", "ru")).toBe(countryPins(index, "MY", "ru"));
    expect(again.missingPins).toBe(first.missingPins);
  });

  it("другой язык, другая страна, другой индекс - другие точки", () => {
    const ruPins = countryPins(index, "MY", "ru");
    const kyPins = countryPins(index, "MY", "ky");
    expect(kyPins).not.toBe(ruPins);
    expect(kyPins.pins.map((pin) => pin.id)).toEqual(ruPins.pins.map((pin) => pin.id));
    expect(countryPins(index, "CN", "ru")).not.toBe(ruPins);
    const reparsed = parseStudentUniversityIndexResponse(indexBody());
    if (!reparsed || reparsed.notModified) throw new Error("fixture");
    const fresh = countryPins(reparsed.index, "MY", "ru");
    expect(fresh).not.toBe(ruPins);
    expect(fresh.pins.map((pin) => pin.id)).toEqual(ruPins.pins.map((pin) => pin.id));
  });
});

describe("страница страны", () => {
  it("города: Субанг-Джая закреплён первым, затем больше вузов выше; вуз без города и вуз города без фото в «Других вузах»", () => {
    const my = countryPageModel(index, "MY", ru, "ru");
    expect(my?.cityCards.map((c) => c.name)).toEqual(["Субанг-Джая", "Куала-Лумпур", "Пенанг"]);
    expect(my?.others.map((u) => u.name)).toEqual(["Институт без города"]);
    const cn = countryPageModel(index, "CN", ru, "ru");
    // город с негодным фото разбор отбрасывает (веб: приёмка 7.6.3), его вузы остаются в «Других»
    expect(cn?.cityCards).toEqual([]);
    expect(cn?.others.map((u) => u.name)).toHaveLength(2);
  });

  it("«Списком»: города А-Я, вузы А-Я, без города последней группой, ё рядом с е", () => {
    const my = countryPageModel(index, "MY", ru, "ru");
    expect(my?.groups.map((g) => g.title)).toEqual(["Субанг-Джая", "Куала-Лумпур", "Пенанг", ru.listNoCity]);
    expect(my?.groups[1]?.universities.map((u) => u.name)).toEqual(["Академия Альфа", "Университет Зета"]);
    const cn = countryPageModel(index, "CN", ru, "ru");
    expect(cn?.groups.map((g) => [g.title, g.cityKey])).toEqual([[ru.listNoCity, null]]);
    expect(cn?.groups[0]?.universities.map((u) => u.name)).toEqual(["Еда и право", "Ёлка-университет"]);
  });

  it("карточка города несёт «Интересный факт» на языке интерфейса (веб: Places.tsx, CityCards)", () => {
    const my = countryPageModel(index, "MY", ru, "ru");
    expect(my?.cityCards.find((card) => card.key === "penang")?.fact).toBe("Факт Пенанг");
    expect(countryPageModel(index, "MY", ky, "ky")?.cityCards.find((card) => card.key === "subang-jaya")?.fact).toBe("Факт Субанг-Жая");
  });

  it("KY: названия городов и стран на кыргызском, порядок по локали", () => {
    const cn = countryPageModel(index, "CN", ky, "ky");
    expect(cn?.name).toBe("Кытай");
    expect(cn?.groups[0]?.title).toBe(ky.listNoCity);
    expect(countryPageModel(index, "XX", ky, "ky")).toBeNull();
  });

  it("точки карты только у вузов с проверенной координатой; остальные считаются", () => {
    const my = countryPageModel(index, "MY", ru, "ru");
    expect(my?.pins.map((p) => p.name).sort()).toEqual(["Академия Альфа", "Университет Зета"]);
    expect(my?.missingPins).toBe(3);
    expect(my?.pins.find((p) => p.name === "Академия Альфа")).toMatchObject({ place: "Куала-Лумпур · Малайзия" });
    expect(typeof my?.pins[0]?.lat).toBe("number");
  });
});

describe("город", () => {
  it("город с фото: вузы и факт на языке интерфейса; без фото страницы нет", () => {
    expect(cityPageModel(index, "MY", "penang", ru, "ru")?.universities.map((u) => u.name)).toEqual(["Колледж Пенанг"]);
    expect(cityPageModel(index, "MY", "penang", ky, "ky")?.fact).toBe("Факт Пенанг");
    expect(cityPageModel(index, "CN", "no-photo-city", ru, "ru")).toBeNull();
    expect(cityPageModel(index, "MY", "paris", ru, "ru")).toBeNull();
  });
});

describe("карточка, место и поиск", () => {
  it("место: город из карточки города, иначе подпись вуза; срок и уровни", () => {
    const zeta = index.universities.find((u) => u.name === "Университет Зета")!;
    const lone = index.universities.find((u) => u.name === "Институт без города")!;
    expect(universityPlace(index, zeta, "ru")).toBe("Куала-Лумпур · Малайзия");
    expect(universityPlace(index, lone, "ru")).toBe("Путраджая · Малайзия");
    const tile = tileModel(index, zeta, { strings: ru, lang: "ru", now: new Date("2099-01-01"), showPlace: false });
    expect(tile).toMatchObject({ place: null, levels: ["Бакалавриат"], intake: "подача до 1 мая 2099 г." });
    expect(tileModel(index, lone, { strings: ru, lang: "ru", now: new Date("2026-11-09"), showPlace: true }).intake).toMatch(/^старт /);
  });

  it("поиск без регистра и диакритики, все слова запроса", () => {
    expect(searchIndex(index, "bogazici").map((u) => u.name)).toEqual(["Bogaziçi Test University"]);
    expect(searchIndex(index, "ЕЛКА")).toHaveLength(1); // ё = е, как в вебе
    expect(searchIndex(index, "ёлка").map((u) => u.name)).toEqual(["Ёлка-университет"]);
    expect(searchIndex(index, "университет зета")).toHaveLength(1);
    expect(searchIndex(index, "  ")).toEqual([]);
  });

  it("поиск находит вуз по городу (рус., лат. из ключа) и стране; в стране только её вузы и города", () => {
    expect(searchIndex(index, "субанг джая").map((u) => u.name)).toEqual(["Колледж Лейксайд"]);
    expect(searchIndex(index, "SUBANG").map((u) => u.name)).toEqual(["Колледж Лейксайд"]);
    expect(searchIndex(index, "куала-лумпур").map((u) => u.name)).toEqual(["Университет Зета", "Академия Альфа"]);
    expect(searchIndex(index, "малайзия")).toHaveLength(5);
    const my = countryPageModel(index, "MY", ru, "ru")!;
    expect(searchCountry(index, my, "kuala").cities.map((c) => c.key)).toEqual(["kuala-lumpur"]);
    expect(searchCountry(index, my, "пенанг").universities.map((u) => u.name)).toEqual(["Колледж Пенанг"]);
    expect(searchCountry(index, my, "bogazici")).toEqual({ cities: [], universities: [] });
  });
});
