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

test("the index parser refuses only a broken envelope", () => {
  const broken = [
    (value) => { value.extra = 1; },
    (value) => { value.countries.reverse(); },
    (value) => { value.countries.pop(); },
    (value) => { value.countries[0].code = "PL"; },
    (value) => { value.countries[2] = null; },
    (value) => { value.version = "g1.\n"; },
    (value) => { value.cities = {}; },
    (value) => { value.universities = null; },
    (value) => { value.notModified = "false"; },
  ];
  for (const [index, mutate] of broken.entries()) {
    const value = indexFixture();
    mutate(value);
    assert.equal(parseStudentUniversityIndexResponse(value), null, `mutation ${index}`);
  }
});

// Review S3 веба, F12: одна неверная карточка больше не делает весь
// каталог «не удалось загрузить». Город пропускается (его вузы уходят в
// «Другие вузы страны»), вуз пропускается, поле деградирует; каждый случай
// пишет строку журнала, счётчики сходятся с тем, что осталось.
test("one broken city, university or country field degrades only itself", () => {
  const without = (index, code) => countryUniversitiesWithoutCity(index, code).map((entry) => entry.name);
  const cases = [
    ["server country count", (v) => { v.countries[0].universityCount = 5; },
      (index) => assert.equal(index.countries[0].universityCount, 4), [{ item: "country", key: "CN", reason: "count" }]],
    ["server city count of a country", (v) => { v.countries[1].cityCount = 2; },
      (index) => assert.equal(index.countries[1].cityCount, 1), [{ item: "country", key: "MY", reason: "count" }]],
    ["server university count of a city", (v) => { v.cities[0].universityCount = 3; },
      (index) => assert.equal(index.cities[0].universityCount, 2), [{ item: "city", key: "shanghai", reason: "count" }]],
    ["a university linked to a city of another country", (v) => { v.universities[0].cityKey = "shanghai"; },
      (index) => {
        assert.equal(index.universities.find((entry) => entry.id === ids[0]).cityKey, null);
        assert.deepEqual(without(index, "TR"), ["Boğaziçi University"]);
        assert.equal(index.cities.some((entry) => entry.key === "istanbul"), false);
        assert.equal(index.countries[3].cityCount, 0);
      },
      [{ item: "university", key: ids[0], reason: "city" }, { item: "city", key: "istanbul", reason: "empty" }, { item: "country", key: "TR", reason: "count" }]],
    ["a duplicate university id", (v) => { v.universities[1].id = ids[0]; },
      (index) => {
        assert.equal(index.universities.length, 7);
        assert.equal(index.countries[0].universityCount, 3);
        assert.equal(index.cities.find((entry) => entry.key === "shanghai").universityCount, 1);
      },
      [{ item: "university", key: ids[0], reason: "duplicate" }, { item: "city", key: "shanghai", reason: "count" }, { item: "country", key: "CN", reason: "count" }]],
    ["a university outside the six countries", (v) => { v.universities[1].country = "PL"; },
      (index) => assert.equal(index.universities.some((entry) => entry.id === ids[1]), false),
      [{ item: "university", key: ids[1], reason: "country" }, { item: "city", key: "shanghai", reason: "count" }, { item: "country", key: "CN", reason: "count" }]],
    ["a city photo outside the bucket path", (v) => { v.cities[0].photo.path = "photos/shanghai.jpg"; },
      (index) => {
        assert.deepEqual(index.cities.map((entry) => entry.key), ["hangzhou", "kuala-lumpur", "istanbul"]);
        assert.deepEqual(without(index, "CN"), ["Fudan University", "Shanghai Jiao Tong University", "Xi’an Jiaotong-Liverpool University"]);
        assert.equal(index.countries[0].cityCount, 1);
        assert.equal(index.countries[0].universityCount, 4);
      },
      [{ item: "city", key: "shanghai", reason: "photo" }, { item: "university", key: ids[1], reason: "city" },
        { item: "university", key: ids[3], reason: "city" }, { item: "country", key: "CN", reason: "count" }]],
    ["a city photo from an agency host", (v) => { v.cities[0].photo.sourceUrl = "https://www.eduprchina.com/photo.jpg"; }, null, "photo"],
    ["a city photo with an unknown source", (v) => { v.cities[0].photo.sourceName = "Agency"; }, null, "photo"],
    ["a city photo author with a trailing no-break space (F12)", (v) => { v.cities[0].photo.author = "Diana\u00a0"; }, null, "photo"],
    ["a city fact over http", (v) => { v.cities[0].fact.sourceUrl = "http://example.org/fact"; }, null, "fact"],
    ["a city without its summary", (v) => { v.cities[0].summary = null; }, null, "summary"],
    ["a city name with a soft hyphen", (v) => { v.cities[0].name.ru = "Шан\u00adхай"; }, null, "name"],
    ["an impossible intake date", (v) => { v.universities[2].intakes = [{ deadline: "2027-02-30", start: null, startMonth: null }]; },
      (index) => assert.deepEqual(index.universities.find((entry) => entry.id === ids[2]).intakes, []),
      [{ item: "university", key: ids[2], reason: "intakes" }]],
    ["repeated levels", (v) => { v.universities[2].levels = ["bachelor", "bachelor"]; },
      (index) => assert.deepEqual(index.universities.find((entry) => entry.id === ids[2]).levels, ["bachelor"]),
      [{ item: "university", key: ids[2], reason: "levels" }]],
    ["a broken country photo", (v) => { v.countries[0].photo.author = " Diana"; },
      (index) => assert.equal(index.countries[0].photo, null), [{ item: "country", key: "CN", reason: "photo" }]],
    ["a broken country name", (v) => { v.countries[0].name = { ru: "", ky: "" }; },
      (index) => assert.deepEqual(index.countries[0].name, { ru: "Китай", ky: "Кытай" }), [{ item: "country", key: "CN", reason: "name" }]],
  ];
  for (const [label, mutate, check, expected] of cases) {
    const value = indexFixture();
    mutate(value);
    const issues = [];
    const parsed = parseStudentUniversityIndexResponse(value, (issue) => issues.push(issue));
    assert.equal(parsed?.notModified, false, label);
    const { index } = parsed;
    // Каждый вуз виден ровно в одном месте, счётчики сходятся (приёмка 7.6.2).
    assert.equal(index.countries.reduce((sum, entry) => sum + entry.universityCount, 0), index.universities.length, label);
    for (const entry of index.cities) {
      assert.equal(index.universities.filter((item) => item.cityKey === entry.key).length, entry.universityCount, label);
    }
    if (typeof expected === "string") {
      // Неверный Шанхай: его два вуза в «Других вузах страны».
      assert.equal(index.cities.some((entry) => entry.key === "shanghai"), false, label);
      assert.deepEqual(issues[0], { item: "city", key: "shanghai", reason: expected }, label);
      assert.equal(without(index, "CN").length, 3, label);
    } else {
      check(index);
      assert.deepEqual(issues, expected, label);
    }
  }
  // Целый индекс журнала не пишет.
  const issues = [];
  parseStudentUniversityIndexResponse(indexFixture(), (issue) => issues.push(issue));
  assert.deepEqual(issues, []);
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

test("the detail parser refuses another university and broken personal state", () => {
  assert.equal(parseStudentUniversityDetail(detailFixture(), "c9a9ae33-e396-49ec-8c6c-1e42a80dc627"), null);
  const broken = [
    (value) => { value.country.code = "CN"; },
    (value) => { value.country = null; },
    (value) => { value.favored = "yes"; },
    (value) => { value.extra = true; },
    (value) => { value.university.content = null; },
    (value) => { value.openConsultation = { requestId: "x" }; },
    (value) => { value.preparations = { studentCaseId: "x", items: [] }; },
  ];
  for (const [index, mutate] of broken.entries()) {
    const value = detailFixture();
    mutate(value);
    assert.equal(parseStudentUniversityDetail(value, UNIVERSITY_ID), null, `mutation ${index}`);
  }
});

// Review S3 веба, F12, страница вуза: неверная строка стоимости или курс
// опускаются по одному, неверный город даёт страницу без города; агентский
// адрес студенту не доходит никогда.
test("a broken cost row, rate or city degrades only itself on the university page", () => {
  const rowIds = (detail) => detail.costs?.rows.map((row) => row.id.slice(-1)) ?? null;
  const cases = [
    ["an agency row with an address", (v) => { v.costs.rows[1].source = { kind: "agency", url: "https://www.eduprchina.com/x" }; },
      (d) => assert.deepEqual(rowIds(d), ["1", "3"]), [{ item: "cost", key: "785b342e-0000-4000-8000-000000000002", reason: "source" }]],
    ["an official row without an address", (v) => { v.costs.rows[0].source = { kind: "official", url: null }; },
      (d) => assert.deepEqual(rowIds(d), ["2", "3"]), [{ item: "cost", key: "785b342e-0000-4000-8000-000000000001", reason: "source" }]],
    ["an agency name on a row", (v) => { v.costs.rows[0].sourceName = "EDUPRCHINA"; },
      (d) => assert.deepEqual(rowIds(d), ["2", "3"]), [{ item: "cost", key: "785b342e-0000-4000-8000-000000000001", reason: "keys" }]],
    ["a maximum below the minimum", (v) => { v.costs.rows[0].amountMaxMinor = 100; }, (d) => assert.deepEqual(rowIds(d), ["2", "3"]),
      [{ item: "cost", key: "785b342e-0000-4000-8000-000000000001", reason: "amount" }]],
    ["a fractional amount", (v) => { v.costs.rows[0].amountMinMinor = 1.5; }, (d) => assert.deepEqual(rowIds(d), ["2", "3"]),
      [{ item: "cost", key: "785b342e-0000-4000-8000-000000000001", reason: "amount" }]],
    ["a lower-case currency", (v) => { v.costs.rows[0].currency = "myr"; }, (d) => assert.deepEqual(rowIds(d), ["2", "3"]),
      [{ item: "cost", key: "785b342e-0000-4000-8000-000000000001", reason: "currency" }]],
    ["an unknown period", (v) => { v.costs.rows[0].period = "decade"; }, (d) => assert.deepEqual(rowIds(d), ["2", "3"]),
      [{ item: "cost", key: "785b342e-0000-4000-8000-000000000001", reason: "period" }]],
    ["a malformed academic year", (v) => { v.costs.rows[0].academicYear = "2026-27"; }, (d) => assert.deepEqual(rowIds(d), ["2", "3"]),
      [{ item: "cost", key: "785b342e-0000-4000-8000-000000000001", reason: "academicYear" }]],
    ["a note with a trailing no-break space", (v) => { v.costs.rows[1].note.ru = "Двухместная комната\u00a0"; },
      (d) => assert.deepEqual(rowIds(d), ["1", "3"]), [{ item: "cost", key: "785b342e-0000-4000-8000-000000000002", reason: "note" }]],
    ["no rows", (v) => { v.costs.rows = []; }, (d) => assert.equal(d.costs, null), [{ item: "costs", key: null, reason: "empty" }]],
    ["every row broken", (v) => { for (const row of v.costs.rows) row.currency = "x"; }, (d) => assert.equal(d.costs, null),
      [...["1", "2", "3"].map((n) => ({ item: "cost", key: `785b342e-0000-4000-8000-00000000000${n}`, reason: "currency" })),
        { item: "costs", key: null, reason: "empty" }]],
    ["a broken cost block", (v) => { v.costs = "x"; }, (d) => assert.equal(d.costs, null), [{ item: "costs", key: null, reason: "shape" }]],
    ["a broken rate", (v) => { v.costs.fxRates[0].unitsPerUsd = 0; },
      (d) => {
        assert.deepEqual(d.costs.fxRates, []);
        // Без названного курса ориентира в USD нет.
        assert.deepEqual(d.costs.rows.map((row) => row.usdApproxMin), [null, null, null]);
      },
      [{ item: "fx_rate", key: "MYR", reason: "invalid" }, { item: "cost", key: "785b342e-0000-4000-8000-000000000001", reason: "rate" },
        { item: "cost", key: "785b342e-0000-4000-8000-000000000002", reason: "rate" }]],
    ["a repeated rate", (v) => { v.costs.fxRates.push(clone(v.costs.fxRates[0])); },
      (d) => assert.equal(d.costs.fxRates.length, 1), [{ item: "fx_rate", key: "MYR", reason: "duplicate" }]],
    ["a city of another country", (v) => { v.city.country = "CN"; },
      (d) => assert.equal(d.city, null), [{ item: "city", key: "kuala-lumpur", reason: "country" }]],
    ["a city photo with a zero-width space in the author", (v) => { v.city.photo.author = "Di\u200bana"; },
      (d) => assert.equal(d.city, null), [{ item: "city", key: "kuala-lumpur", reason: "photo" }]],
    ["a broken country name", (v) => { v.country.name = null; },
      (d) => assert.deepEqual(d.country, { code: "MY", name: { ru: "Малайзия", ky: "Малайзия" } }), [{ item: "country", key: "MY", reason: "name" }]],
  ];
  for (const [label, mutate, check, expected] of cases) {
    const value = detailFixture();
    mutate(value);
    const issues = [];
    const detail = parseStudentUniversityDetail(value, UNIVERSITY_ID, (issue) => issues.push(issue));
    assert.equal(detail?.university.id, UNIVERSITY_ID, label);
    check(detail);
    assert.deepEqual(issues, expected, label);
    assert.doesNotMatch(JSON.stringify(detail), /eduprchina|EDUPRCHINA/u, label);
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
