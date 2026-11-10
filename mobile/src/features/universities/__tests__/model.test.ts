import { parseStudentUniversityIndexResponse } from "@web/lib/portal/university-index";
import { getPortalStrings } from "@web/lib/portal/i18n";

import { countryCards, countryPageModel, cityPageModel, placeCounts, searchCountry, searchIndex, tileModel, universityPlace } from "@/features/universities/model";
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
    expect(cards[1]?.counts).toBe("5 университетов · 3 города");
    expect(cards[2]).toMatchObject({ counts: "Пока нет университетов", empty: true });
  });

  it("склонение: RU по правилам, KY одна форма", () => {
    expect(placeCounts(ru, 1, null, "ru")).toBe("1 университет");
    expect(placeCounts(ru, 5, 11, "ru")).toBe("5 университетов · 11 городов");
    expect(placeCounts(ru, 22, 2, "ru")).toBe("22 университета · 2 города");
    expect(placeCounts(ky, 2, 3, "ky")).toBe(`${ky["count.university.many"].replace("{count}", "2")} · ${ky["count.city.many"].replace("{count}", "3")}`);
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
