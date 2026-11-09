// Синтетический индекс каталога в форме student_university_index_v1 (названия придуманы,
// ссылки на example-домены запрещены правилом каталога, поэтому используются реальные
// публичные источники фото-сервисов: ссылки не открываются тестами).
import { uuidN } from "@/test-fixtures/universities";

export const CODES = ["CN", "MY", "AE", "TR", "IT", "CZ"] as const;
const NAMES: Record<string, { ru: string; ky: string }> = {
  CN: { ru: "Китай", ky: "Кытай" },
  MY: { ru: "Малайзия", ky: "Малайзия" },
  AE: { ru: "ОАЭ", ky: "БАЭ" },
  TR: { ru: "Турция", ky: "Түркия" },
  IT: { ru: "Италия", ky: "Италия" },
  CZ: { ru: "Чехия", ky: "Чехия" },
};

export function geoPhoto(scope: "countries" | "cities", slug: string) {
  return {
    path: `geography/${scope}/${slug}-0123456789ab.jpg`,
    width: 2000,
    height: 1200,
    author: "Автор Тестов",
    authorUrl: null,
    sourceName: "Wikimedia Commons",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Test.jpg",
    license: "CC BY 4.0",
    licenseUrl: null,
  };
}

export function cityRow(key: string, country: string, ru: string, ky: string, universityCount: number, withPhoto = true) {
  return {
    key,
    country,
    name: { ru, ky },
    photo: withPhoto ? geoPhoto("cities", key) : { path: "bad", width: 1, height: 1, author: "x", authorUrl: null, sourceName: "Wikimedia Commons", sourceUrl: "https://commons.wikimedia.org/wiki/File:T.jpg", license: "CC", licenseUrl: null },
    summary: { ru: `Город ${ru}`, ky: `Шаар ${ky}` },
    fact: { ru: `Факт ${ru}`, ky: `Факт ${ky}`, sourceUrl: "https://commons.wikimedia.org/wiki/Fact", verifiedOn: "2026-10-01" },
    universityCount,
  };
}

export function uniRow(n: number, name: string, country: string, opts: { cityKey?: string | null; cityLabel?: string | null; photoKey?: string | null; deadline?: string | null; levels?: string[] } = {}) {
  return {
    id: uuidN(n),
    name,
    country,
    cityKey: opts.cityKey ?? null,
    cityLabel: opts.cityLabel ?? null,
    levels: opts.levels ?? ["bachelor"],
    photoKey: opts.photoKey ?? null,
    intakes: [{ deadline: opts.deadline ?? null, start: null, startMonth: "2027-09" }],
    hasCosts: false,
  };
}

/**
 * MY: два города (Куала-Лумпур 2 вуза, Пенанг 1) и вуз без города; CN: город без фото
 * (вуз уходит в «Другие вузы»). Имена для сортировки: «Ёлка» должна стоять рядом с «Е».
 */
export function indexBody(version = "v1") {
  const universities = [
    uniRow(1, "Университет Зета", "MY", { cityKey: "kuala-lumpur", photoKey: "apu", deadline: "2099-05-01" }),
    uniRow(2, "Академия Альфа", "MY", { cityKey: "kuala-lumpur", photoKey: "sunway" }),
    uniRow(3, "Колледж Пенанг", "MY", { cityKey: "penang" }),
    uniRow(4, "Институт без города", "MY", { cityLabel: "Путраджая" }),
    uniRow(5, "Ёлка-университет", "CN", { cityKey: "no-photo-city" }),
    uniRow(6, "Еда и право", "CN", { cityKey: "no-photo-city" }),
    uniRow(7, "Bogaziçi Test University", "TR"),
  ];
  return {
    notModified: false,
    version,
    countries: CODES.map((code) => ({
      code,
      name: NAMES[code],
      photo: code === "MY" ? geoPhoto("countries", "malaysia") : null,
      summary: code === "MY" ? { ru: "Страна тестов", ky: "Сыноо өлкөсү" } : null,
      universityCount: universities.filter((u) => u.country === code).length,
      cityCount: code === "MY" ? 2 : code === "CN" ? 1 : 0,
    })),
    cities: [
      cityRow("kuala-lumpur", "MY", "Куала-Лумпур", "Куала-Лумпур", 2),
      cityRow("penang", "MY", "Пенанг", "Пенанг", 1),
      cityRow("no-photo-city", "CN", "Город без фото", "Фотосуз шаар", 2, false),
    ],
    universities,
  };
}
