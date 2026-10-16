import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";

import {
  countForm,
  countryCities,
  countryCodeFromSlug,
  countryHref,
  cityHref,
  countryUniversitiesWithoutCity,
  nearestIndexIntake,
  parseStudentUniversityDetail,
  parseStudentUniversityIndexResponse,
  resolveUniversitiesRoute,
  searchUniversities,
} from "../src/lib/portal/university-index.ts";
import {
  costsShowUsd,
  formatMinorAmount,
  formatUnitsPerUsd,
  fxSourceLabel,
  groupCostRows,
  splitCostNote,
  summarizeCosts,
} from "../src/lib/portal/university-costs.ts";
import { PORTAL_DICTIONARIES } from "../src/lib/portal/i18n.ts";
import { nearestUniversityIntake } from "../src/lib/portal/universities.ts";

/**
 * Контракт веба S3 с миграцией 283 (docs/catalog/geography-costs-contract.md,
 * раздел 2): строгие разборщики индекса и страницы вуза, помощники экранов
 * «страны → города → вузы» и блока «Стоимость».
 */

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const clone = (value) => structuredClone(value);

const photo = (scope, slug, overrides = {}) => ({
  path: `geography/${scope}/${slug}-459341790afb.jpg`,
  width: 2000,
  height: 1333,
  author: "Diana",
  authorUrl: "https://www.pexels.com/@diana",
  sourceName: "Pexels",
  sourceUrl: "https://www.pexels.com/photo/example-123/",
  license: "Pexels License",
  licenseUrl: "https://www.pexels.com/license/",
  ...overrides,
});
const name = (ru, ky = ru) => ({ ru, ky });
const fact = { ru: "Озеро Сиху внесено в список ЮНЕСКО в 2011 году.", ky: "Сиху көлү 2011-жылы ЮНЕСКОнун тизмесине киргизилген.", sourceUrl: "https://whc.unesco.org/en/list/1334", verifiedOn: "2026-10-16" };
const city = (key, country, universityCount, ru) => ({
  key, country, name: name(ru), photo: photo("cities", `${country.toLowerCase()}-${key}`),
  summary: name(`${ru}: короткий текст.`), fact: clone(fact), universityCount,
});
const university = (id, uniName, country, cityKey, overrides = {}) => ({
  id, name: uniName, country, cityKey, cityLabel: cityKey ? "Город" : null,
  levels: ["language", "bachelor"], photoKey: "apu",
  intakes: [{ deadline: "2027-03-31", start: "2027-09-01", startMonth: "2027-09" }],
  hasCosts: true, ...overrides,
});
const ids = Array.from({ length: 8 }, (_, index) => `0b9c2f8e-3f0a-4b8e-9d55-7a1d2c3e4f5${index}`);

function indexFixture() {
  const countries = [
    ["CN", "Китай", "Кытай", 4, 2], ["MY", "Малайзия", "Малайзия", 2, 1], ["AE", "ОАЭ", "БАЭ", 1, 0],
    ["TR", "Турция", "Түркия", 1, 1], ["IT", "Италия", "Италия", 0, 0], ["CZ", "Чехия", "Чехия", 0, 0],
  ].map(([code, ru, ky, universityCount, cityCount]) => ({
    code, name: name(ru, ky), photo: code === "CZ" ? null : photo("countries", code.toLowerCase()),
    summary: code === "CZ" ? null : name("Текст страны."), universityCount, cityCount,
  }));
  return {
    notModified: false,
    version: "g1.c259412d88f328f9f986867c747feed4",
    countries,
    cities: [
      city("shanghai", "CN", 2, "Шанхай"), city("hangzhou", "CN", 1, "Ханчжоу"),
      city("kuala-lumpur", "MY", 2, "Куала-Лумпур"), city("istanbul", "TR", 1, "Стамбул"),
    ],
    universities: [
      university(ids[0], "Boğaziçi University", "TR", "istanbul"),
      university(ids[1], "Fudan University", "CN", "shanghai"),
      university(ids[2], "GBS Dubai", "AE", null),
      university(ids[3], "Shanghai Jiao Tong University", "CN", "shanghai"),
      university(ids[4], "Sunway University", "MY", "kuala-lumpur"),
      university(ids[5], "Taylor's University", "MY", "kuala-lumpur"),
      university(ids[6], "Xi’an Jiaotong-Liverpool University", "CN", null, { cityLabel: "Сучжоу" }),
      university(ids[7], "Zhejiang University", "CN", "hangzhou"),
    ],
  };
}

test("the index parser accepts the contract shape and a notModified reply", () => {
  const parsed = parseStudentUniversityIndexResponse(indexFixture());
  assert.equal(parsed?.notModified, false);
  assert.equal(parsed.index.countries.length, 6);
  assert.equal(parsed.index.universities.length, 8);
  assert.equal(parsed.index.countries.find((entry) => entry.code === "CZ").photo, null);
  assert.deepEqual(
    parseStudentUniversityIndexResponse({ notModified: true, version: "g1.abc" }),
    { notModified: true, version: "g1.abc" },
  );
  assert.equal(parseStudentUniversityIndexResponse({ notModified: true, version: "g1.abc", countries: [] }), null);
  // Ключ фото вне библиотеки этой сборки: заглушка «нет фото», каталог цел.
  const unknownPhoto = indexFixture();
  unknownPhoto.universities[0].photoKey = "not-in-library";
  assert.equal(parseStudentUniversityIndexResponse(unknownPhoto).index.universities[0].photoKey, null);
});

test("the index parser rejects drift instead of drawing half a catalogue", () => {
  const broken = [
    (value) => { value.extra = 1; },
    (value) => { value.countries.reverse(); },
    (value) => { value.countries.pop(); },
    (value) => { value.countries[0].universityCount = 5; },
    (value) => { value.countries[1].cityCount = 2; },
    (value) => { value.cities[0].universityCount = 3; },
    (value) => { value.universities[0].cityKey = "shanghai"; },
    (value) => { value.universities[1].id = ids[0]; },
    (value) => { value.universities[1].country = "PL"; },
    (value) => { value.cities[0].photo.path = "photos/shanghai.jpg"; },
    (value) => { value.cities[0].photo.sourceUrl = "https://www.eduprchina.com/photo.jpg"; },
    (value) => { value.cities[0].photo.sourceName = "Agency"; },
    (value) => { value.cities[0].fact.sourceUrl = "http://example.org/fact"; },
    (value) => { value.cities[0].summary = null; },
    (value) => { value.universities[2].intakes = [{ deadline: "2027-02-30", start: null, startMonth: null }]; },
    (value) => { value.universities[2].levels = ["bachelor", "bachelor"]; },
  ];
  for (const [index, mutate] of broken.entries()) {
    const value = indexFixture();
    mutate(value);
    assert.equal(parseStudentUniversityIndexResponse(value), null, `mutation ${index}`);
  }
});

test("country and city helpers keep every university visible", () => {
  const { index } = parseStudentUniversityIndexResponse(indexFixture());
  assert.deepEqual(countryCities(index, "CN", "ru").map((entry) => entry.key), ["shanghai", "hangzhou"]);
  assert.deepEqual(countryUniversitiesWithoutCity(index, "CN").map((entry) => entry.name), ["Xi’an Jiaotong-Liverpool University"]);
  // Сумма вузов по странам равна числу вузов (приёмка 7.6.2).
  assert.equal(index.countries.reduce((sum, entry) => sum + entry.universityCount, 0), index.universities.length);
  for (const country of index.countries) {
    const inCities = index.universities.filter((entry) => entry.country === country.code && entry.cityKey !== null).length;
    assert.equal(inCities + countryUniversitiesWithoutCity(index, country.code).length, country.universityCount, country.code);
  }
  assert.equal(countryHref("CN"), "/portal/universities/country/cn");
  assert.equal(countryHref("CN", "map"), "/portal/universities/country/cn?view=map");
  assert.equal(cityHref("MY", "kuala-lumpur"), "/portal/universities/country/my/kuala-lumpur");
  assert.equal(countryCodeFromSlug("cn"), "CN");
  for (const slug of ["CN", "pl", "chn", ""]) assert.equal(countryCodeFromSlug(slug), null, slug);
});

test("search by name works over all six countries, without case or diacritics", () => {
  const { index } = parseStudentUniversityIndexResponse(indexFixture());
  const names = (query) => searchUniversities(index.universities, query).map((entry) => entry.name);
  assert.deepEqual(names("bogazici"), ["Boğaziçi University"]);
  assert.deepEqual(names("XI'AN"), ["Xi’an Jiaotong-Liverpool University"]);
  assert.deepEqual(names("taylor's"), ["Taylor's University"]);
  assert.deepEqual(names("shanghai university"), ["Shanghai Jiao Tong University"]);
  assert.deepEqual(names("  "), []);
  assert.deepEqual(names("unknown"), []);
});

test("the nearest intake from the index follows the full-card rule", () => {
  const content = JSON.parse(read("src/lib/server/university-catalog-reviewed-malaysia.json")).find((entry) => entry.key === "apu").content;
  const intakes = content.programs.flatMap((program) => program.intakes)
    .filter((intake) => intake.status === "open" || intake.status === "announced")
    .map((intake) => ({ deadline: intake.applicationDeadline, start: intake.startDate, startMonth: intake.startMonth }));
  for (const now of ["2026-01-01", "2026-09-25", "2026-11-25", "2030-01-01"]) {
    assert.deepEqual(nearestIndexIntake(intakes, new Date(`${now}T12:00:00Z`)), nearestUniversityIntake(content, new Date(`${now}T12:00:00Z`)), now);
  }
});

test("old list and map addresses lead to the new screens", () => {
  const cases = [
    [{}, { kind: "page", query: "" }],
    [{ q: "Tongji" }, { kind: "page", query: "Tongji" }],
    [{ view: "map", country: "CN" }, { kind: "redirect", href: "/portal/universities/country/cn?view=map" }],
    [{ country: "TR", level: "bachelor" }, { kind: "redirect", href: "/portal/universities/country/tr" }],
    [{ view: "list", country: "MY", offset: "30" }, { kind: "redirect", href: "/portal/universities/country/my" }],
    [{ q: " Tongji ", country: "CN", offset: "30" }, { kind: "redirect", href: "/portal/universities?q=Tongji" }],
    [{ view: "map" }, { kind: "redirect", href: "/portal/universities" }],
    [{ level: "master" }, { kind: "redirect", href: "/portal/universities" }],
    [{ country: "PL" }, { kind: "invalid" }],
    [{ view: "grid" }, { kind: "invalid" }],
    [{ level: "phd" }, { kind: "invalid" }],
    [{ offset: "-1" }, { kind: "invalid" }],
    [{ other: "1" }, { kind: "invalid" }],
    [{ q: ["a", "b"] }, { kind: "invalid" }],
    [{ q: "x".repeat(101) }, { kind: "invalid" }],
  ];
  for (const [params, expected] of cases) assert.deepEqual(resolveUniversitiesRoute(params), expected, JSON.stringify(params));
});

test("counters decline by the Russian rules", () => {
  assert.deepEqual([1, 2, 5, 11, 12, 21, 22, 25, 47, 111, 112].map(countForm),
    ["one", "few", "many", "many", "many", "one", "few", "many", "many", "many", "many"]);
});

const CONTENT = JSON.parse(read("src/lib/server/university-catalog-reviewed-malaysia.json")).find((entry) => entry.key === "apu").content;
const UNIVERSITY_ID = "c9a9ae33-e396-49ec-8c6c-1e42a80dc626";
const costRow = (overrides) => ({
  id: "785b342e-0000-4000-8000-000000000001", kind: "tuition", period: "year", studyLevel: "bachelor", programId: null,
  teachingLanguage: "en", currency: "MYR", exponent: 2, amountMinMinor: 3260000, amountMaxMinor: 3780000,
  usdApproxMin: 7990, usdApproxMax: 9260, academicYear: "2026", note: { ru: "Без налога SST 6 %; Сумма зависит от программы", ky: "SST 6 % салыгы жок" },
  source: { kind: "official", url: "https://www.apu.edu.my/fees" }, verifiedOn: "2026-10-14", ...overrides,
});

function detailFixture() {
  return {
    university: { id: UNIVERSITY_ID, version: 2, publishedAt: "2026-09-20T10:00:00+00:00", content: CONTENT },
    country: { code: "MY", name: name("Малайзия") },
    city: { key: "kuala-lumpur", country: "MY", name: name("Куала-Лумпур"), photo: photo("cities", "my-kuala-lumpur"), summary: name("Столица."), fact: clone(fact) },
    favored: true,
    openConsultation: null,
    preparations: null,
    costs: {
      rows: [
        costRow({}),
        costRow({ id: "785b342e-0000-4000-8000-000000000002", kind: "accommodation", period: "month", studyLevel: null, teachingLanguage: null,
          amountMinMinor: 58000, amountMaxMinor: 105000, usdApproxMin: 140, usdApproxMax: 260, academicYear: null,
          note: { ru: "Двухместная комната; Цена за одного человека", ky: "Эки орундуу бөлмө; Бир кишиге" },
          source: { kind: "agency", url: null }, verifiedOn: "2026-10-16" }),
        costRow({ id: "785b342e-0000-4000-8000-000000000003", kind: "application_fee", period: "once", studyLevel: null, teachingLanguage: null,
          currency: "USD", amountMinMinor: 15000, amountMaxMinor: null, usdApproxMin: null, usdApproxMax: null, academicYear: "2025/26", note: null }),
      ],
      fxRates: [
        { currency: "MYR", unitsPerUsd: 4.0825303355, asOf: "2026-10-15", sourceName: "European Central Bank, euro foreign exchange reference rates" },
      ],
    },
  };
}

test("the detail parser takes the single-call page and hides nothing it was given", () => {
  const detail = parseStudentUniversityDetail(detailFixture(), UNIVERSITY_ID);
  assert.equal(detail?.university.id, UNIVERSITY_ID);
  assert.equal(detail.city.key, "kuala-lumpur");
  assert.equal(detail.costs.rows.length, 3);
  // Нет опубликованных строк: costs null, блока нет.
  const withoutCosts = detailFixture();
  withoutCosts.costs = null;
  assert.equal(parseStudentUniversityDetail(withoutCosts, UNIVERSITY_ID).costs, null);
  const withoutCity = detailFixture();
  withoutCity.city = null;
  assert.equal(parseStudentUniversityDetail(withoutCity, UNIVERSITY_ID).city, null);
});

test("the detail parser rejects another university, agency addresses and malformed money", () => {
  assert.equal(parseStudentUniversityDetail(detailFixture(), "c9a9ae33-e396-49ec-8c6c-1e42a80dc627"), null);
  const broken = [
    (value) => { value.costs.rows[1].source = { kind: "agency", url: "https://www.eduprchina.com/x" }; },
    (value) => { value.costs.rows[0].source = { kind: "official", url: null }; },
    (value) => { value.costs.rows[0].sourceName = "EDUPRCHINA"; },
    (value) => { value.costs.rows[0].amountMaxMinor = 100; },
    (value) => { value.costs.rows[0].amountMinMinor = 1.5; },
    (value) => { value.costs.rows[0].currency = "myr"; },
    (value) => { value.costs.rows[0].period = "decade"; },
    (value) => { value.costs.rows[0].academicYear = "2026-27"; },
    (value) => { value.costs.rows = []; },
    (value) => { value.costs.fxRates[0].unitsPerUsd = 0; },
    (value) => { value.costs.fxRates.push(clone(value.costs.fxRates[0])); },
    (value) => { value.country.code = "CN"; },
    (value) => { value.city.country = "CN"; },
    (value) => { value.favored = "yes"; },
    (value) => { value.extra = true; },
  ];
  for (const [index, mutate] of broken.entries()) {
    const value = detailFixture();
    mutate(value);
    assert.equal(parseStudentUniversityDetail(value, UNIVERSITY_ID), null, `mutation ${index}`);
  }
});

test("cost presentation: groups, sums, USD column, sources and the rate line", () => {
  const { costs } = parseStudentUniversityDetail(detailFixture(), UNIVERSITY_ID);
  assert.deepEqual(groupCostRows(costs.rows).map((group) => group.kind), ["tuition", "accommodation", "application_fee"]);
  assert.equal(formatMinorAmount(3260000, 2, "ru").replace(/\s/gu, " "), "32 600");
  assert.equal(formatMinorAmount(1250, 2, "ru"), "12,50");
  assert.equal(formatMinorAmount(0, 2, "ru"), "0");
  assert.equal(formatUnitsPerUsd(6.6910242684, "ru"), "6,691");
  assert.equal(formatUnitsPerUsd(3.6725, "ru"), "3,6725");
  assert.equal(costsShowUsd(costs.rows), true);
  assert.equal(costsShowUsd([costs.rows[2]]), false);
  const summary = summarizeCosts(costs);
  assert.deepEqual(summary.academicYears, ["2026", "2025/26"]);
  assert.deepEqual(summary.sourceKinds, ["official", "agency"]);
  assert.deepEqual(summary.officialUrls, ["https://www.apu.edu.my/fees"]);
  assert.equal(summary.verifiedOn, "2026-10-16");
  // USD строки курса не имеет: курс только для MYR.
  assert.deepEqual(summary.rates.map((rate) => rate.currency), ["MYR"]);
  assert.equal(fxSourceLabel("European Central Bank, euro foreign exchange reference rates", "ru"), "ЕЦБ");
  assert.equal(fxSourceLabel("Central Bank of the UAE: dirham fixed peg", "ru"), "ЦБ ОАЭ");
  assert.equal(fxSourceLabel("Национальный банк", "ru"), "Национальный банк");
  assert.deepEqual(splitCostNote("Двухместная комната; Цена за одного человека"), ["Двухместная комната", "Цена за одного человека"]);
});

test("every cost kind, period and the rate line exist in RU and KY", () => {
  for (const locale of ["ru", "ky"]) {
    const strings = PORTAL_DICTIONARIES.universities[locale];
    for (const kind of ["tuition", "accommodation", "application_fee", "insurance", "other"]) assert.ok(strings[`costKind.${kind}`], `${locale} ${kind}`);
    for (const period of ["year", "semester", "month", "week", "day", "once", "program"]) assert.ok(strings[`costPeriod.${period}`], `${locale} ${period}`);
    assert.match(strings.costRate, /^1 USD = \{value\} \{currency\} \(\{source\}, \{date\}\)$/u);
    assert.ok(strings.costSourceAgency.length > 0 && !/eduprchina/iu.test(strings.costSourceAgency));
    for (const value of Object.values(strings)) assert.doesNotMatch(value, /[—–]/u, `${locale}: ${value}`);
  }
  assert.equal(PORTAL_DICTIONARIES.universities.ru.costSourceAgency, "открытые данные образовательных агентств");
  assert.equal(PORTAL_DICTIONARIES.universities.ru.costFinal, "Окончательную сумму указывает университет.");
});

function textFiles(directory) {
  return readdirSync(new URL(directory, ROOT)).flatMap((name) => {
    const path = `${directory}${name}`;
    if (statSync(new URL(path, ROOT)).isDirectory()) return textFiles(`${path}/`);
    return /\.(?:tsx?|mjs|js|json|css|swift|strings|xcstrings|md)$/u.test(name) ? [path] : [];
  });
}

// Решение владельца 16.10.2026 (Р4): «нет данных, нет блока». Этой фразы нет
// ни в коде, ни в словарях кабинета и приложения.
test("the phrase «Стоимость уточняет куратор» exists nowhere in src and the dictionaries", () => {
  const phrase = ["Стоимость", "уточняет", "куратор"].join(" ");
  const files = [...textFiles("src/"), ...textFiles("ios/EVOAdmissions/")];
  assert.ok(files.length > 100);
  for (const path of files) assert.equal(read(path).includes(phrase), false, path);
  for (const namespace of Object.values(PORTAL_DICTIONARIES)) {
    for (const dictionary of [namespace.ru, namespace.ky]) {
      for (const value of Object.values(dictionary)) assert.equal(value.includes(phrase), false, value);
    }
  }
  // Блок «Стоимость» рисуется только при опубликованных строках.
  assert.match(read("src/components/portal/universities/Detail.tsx"), /\{costs !== null \? \(\s*<CostTable/u);
});

test("catalog screens read one cached index and the university page one RPC", () => {
  const source = read("src/lib/portal/university-index-source.ts");
  assert.match(source, /rpc\("student_university_index_v1", \{ p_known_version: knownVersion \}\)/u);
  assert.match(source, /unstable_cache\(/u);
  assert.match(source, /tags: \[STUDENT_UNIVERSITY_INDEX_TAG\]/u);
  // Кэш отдаётся только после успешного RPC этого показа (проверка доступа в базе).
  assert.match(source, /const first = await callIndex\(known\);\s*if \(!first\.notModified\) return remember/u);
  const detailPage = read("src/app/(portal)/portal/universities/[id]/page.tsx");
  assert.match(detailPage, /readStudentUniversityDetail\(id\)/u);
  assert.doesNotMatch(detailPage, /readStudentUniversities\(|readStudentCatalogPreparations|readOwnConsultationRequests|readStudentUniversityFavorites/u);
  for (const page of ["page.tsx", "country/[code]/page.tsx", "country/[code]/[city]/page.tsx"]) {
    const screen = read(`src/app/(portal)/portal/universities/${page}`);
    assert.match(screen, /readStudentUniversityIndex\(actor\)/u, page);
    assert.doesNotMatch(screen, /readStudentUniversities\(|readStudentUniversitiesComplete/u, page);
  }
  for (const action of ["src/lib/platform-university-catalog-actions.ts", "src/lib/platform-university-batch-actions.ts"]) {
    assert.match(read(action), /revalidateTag\(STUDENT_UNIVERSITY_INDEX_TAG, \{ expire: 0 \}\)/u, action);
  }
});
