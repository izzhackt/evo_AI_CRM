import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseInstitutionGeography } from "../src/lib/catalog-geography.ts";
import { UNIVERSITY_LEVELS, parseUniversityContent } from "../src/lib/platform-university-catalog.ts";
import { listItemProgramCount, parseUniversityListRead, universityListItem } from "../src/lib/university-list-item.ts";
import { staffUniversityDeadline } from "../src/lib/university-staff-deadline.ts";
import { catalogueProgramCount, sortCatalogueRows, universityDeadlineView } from "../src/lib/v3/university-view.ts";

/**
 * Лёгкая строка каталога (миграция 364): список, страны, страна и город сортируют и считают по ней то же, что прежде по
 * полной карточке. Здесь: проекция из полной карточки, строгий разбор ответа `staff_university_catalog_rows_v1` и
 * равенство «ближайшего срока», числа программ и порядка по лёгкой и по полной карточке. SQL-сторона (что база отдаёт
 * ту же проекцию) — `supabase/tests/platform_university_catalog_speed.sql`.
 */

const ORG = "2b527337-3dfe-4c00-b9f5-00000000a364";
const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const TEMPLATES = ["china", "malaysia", "europe", "turkey", "international", "other"]
  .flatMap((name) => read(`src/lib/server/university-catalog-reviewed-${name}.json`))
  .map((entry, index) => ({ id: `57ce9b97-43fb-4563-9c61-${String(index + 1).padStart(12, "0")}`, version: 1, publishedAt: "2026-11-10T08:00:00.123456+00:00", content: parseUniversityContent(entry.content) }));

let sequence = 0;
const intake = (fields = {}) => ({
  label: "Набор", startDate: null, startMonth: null, applicationDeadline: null, deadlineTime: null, timezone: "Asia/Shanghai",
  status: "open", note: "", sourceUrl: "https://example.org/intake", verifiedOn: "2026-11-01", ...fields,
});
function card(name, programs) {
  sequence += 1;
  return {
    id: `36400000-0000-4000-8000-${String(sequence).padStart(12, "0")}`, version: 2, publishedAt: "2026-11-10T08:00:00+00:00",
    content: {
      name, country: "CN", city: null, overview: "Описание.", websiteUrl: "https://example.org", sourceUrl: "https://example.org/source",
      verifiedOn: "2026-11-01", notes: "", photoKey: null,
      programs: programs.map(([id, level, intakes]) => ({ id, title: `Программа ${id}`, level, duration: null, language: null, summary: "Кратко.", sourceUrl: "https://example.org/p", intakes })),
    },
  };
}
// Сроки вокруг «сейчас» в разных поясах, все статусы, граница минуты, равные даты и программы без наборов.
const SYNTHETIC = [
  card("Альфа", [["a", "bachelor", [intake({ applicationDeadline: "2026-11-21", deadlineTime: "23:59" }), intake({ status: "closed", applicationDeadline: "2026-11-20" })]],
    ["b", "master", [intake({ status: "announced", applicationDeadline: "2026-12-01", timezone: "Europe/Istanbul" })]]]),
  card("Бета", [["x", "bachelor", [intake({ applicationDeadline: "2026-11-20", deadlineTime: "12:00", timezone: "Asia/Kuala_Lumpur" })]],
    ["y", "bachelor", [intake({ status: "unknown", applicationDeadline: "2026-11-25" }), intake({ applicationDeadline: "2026-11-25", timezone: "UTC" })]],
    ["z", "language", []]]),
  card("Гамма", [["p", "doctorate", [intake({ status: "needs_reconfirmation", applicationDeadline: "2026-11-22" }), intake({ applicationDeadline: null })]]]),
  card("Дельта", [["m", "master", [intake({ applicationDeadline: "2026-11-30" })]], ["n", "master", [intake({ applicationDeadline: "2026-11-30", timezone: "Asia/Tokyo" })]],
    ["o", "foundation", [intake({ applicationDeadline: "2026-11-24", verifiedOn: "2026-11-25" })]]]),
];
const INSTANTS = ["2026-11-20T03:00:00Z", "2026-11-20T04:00:00Z", "2026-11-20T15:58:00Z", "2026-11-21T15:59:00Z", "2026-11-26T00:00:00Z"].map((value) => new Date(value));
const LEVELS = ["", ...UNIVERSITY_LEVELS];

test("projection: counts by level, only open and announced intakes in card order, no long texts", () => {
  const item = universityListItem(SYNTHETIC[0]);
  assert.deepEqual(item.levels, { bachelor: 1, master: 1 });
  assert.deepEqual(item.deadlinePrograms.map((program) => [program.id, program.intakes.map((entry) => entry.status)]), [["a", ["open"]], ["b", ["announced"]]]);
  assert.deepEqual(Object.keys(item.content).sort(), ["city", "country", "name", "photoKey", "verifiedOn"]);
  assert.doesNotMatch(JSON.stringify(item), /Описание|Кратко|example\.org\/p"/u, "no overview, summary or programme link");
  assert.deepEqual(universityListItem(SYNTHETIC[2]).deadlinePrograms.map((program) => program.intakes.length), [1], "needs_reconfirmation is not carried");
});

test("parse: what the projection produces is accepted unchanged, for every reviewed template and the synthetic cards", () => {
  const items = [...TEMPLATES, ...SYNTHETIC].map(universityListItem);
  // Through JSON, as PostgREST delivers it.
  const answer = JSON.parse(JSON.stringify({ organizationId: ORG, complete: true, items }));
  assert.deepEqual(parseUniversityListRead(answer, ORG), { complete: true, items });
  assert.deepEqual(parseUniversityListRead({ organizationId: ORG, complete: false, items: [] }, ORG), { complete: false });
});

test("parse: a wrong answer is a failed read, not a shorter catalogue", () => {
  const good = JSON.parse(JSON.stringify(universityListItem(SYNTHETIC[1])));
  const answer = (items, extra = {}) => ({ organizationId: ORG, complete: true, items, ...extra });
  const broken = (change) => { const copy = structuredClone(good); change(copy); return answer([copy]); };
  const cases = {
    "another organization": answer([good], { organizationId: "2b527337-3dfe-4c00-b9f5-00000000b364" }),
    "extra envelope key": answer([good], { nextOffset: null }),
    "incomplete with rows": { organizationId: ORG, complete: false, items: [good] },
    "over the limit": answer(Array.from({ length: 1201 }, () => good)),
    "duplicate id": answer([good, good]),
    "extra row key": broken((row) => { row.programs = []; }),
    "extra content key": broken((row) => { row.content.overview = "x"; }),
    "control character": broken((row) => { row.content.name = "Бета\u0007"; }),
    "lower-case country": broken((row) => { row.content.country = "cn"; }),
    "unknown photo key": broken((row) => { row.content.photoKey = "not-a-photo"; }),
    "unknown level": broken((row) => { row.levels.phd = 1; }),
    "zero count": broken((row) => { row.levels.language = 0; }),
    "no programmes": broken((row) => { row.levels = {}; row.deadlinePrograms = []; }),
    "deadline programme of an absent level": broken((row) => { row.levels = { language: 1 }; }),
    "closed intake": broken((row) => { row.deadlinePrograms[0].intakes[0].status = "closed"; }),
    "programme without intakes": broken((row) => { row.deadlinePrograms[0].intakes = []; }),
    "bad time zone": broken((row) => { row.deadlinePrograms[0].intakes[0].timezone = "Mars/Olympus"; }),
    "time without a zone": broken((row) => { row.deadlinePrograms[0].intakes[0].timezone = null; }),
    "private source link": broken((row) => { row.deadlinePrograms[0].intakes[0].sourceUrl = "http://intranet.local/x"; }),
    "duplicate programme": broken((row) => { row.deadlinePrograms.push(row.deadlinePrograms[0]); }),
  };
  for (const [name, value] of Object.entries(cases)) assert.equal(parseUniversityListRead(value, ORG), null, name);
});

test("the nearest deadline, the programme count and the order are the same from the light row and from the full card", () => {
  const cards = [...TEMPLATES, ...SYNTHETIC];
  let compared = 0;
  for (const now of INSTANTS) {
    for (const level of LEVELS) {
      for (const full of cards) {
        const light = universityListItem(full);
        const expected = staffUniversityDeadline(full.content.programs, level, now);
        const actual = staffUniversityDeadline(light.deadlinePrograms, level, now);
        assert.deepEqual(actual && [actual.program.id, actual.program.title, actual.intake.label, actual.applicationDeadline, actual.sameDateCount],
          expected && [expected.program.id, expected.program.title, expected.intake.label, expected.applicationDeadline, expected.sameDateCount],
          `${full.content.name} ${level || "all"} ${now.toISOString()}`);
        assert.equal(catalogueProgramCount(light, level), level ? full.content.programs.filter((program) => program.level === level).length : full.content.programs.length);
        if (expected) compared += 1;
      }
      const sorted = sortCatalogueRows(cards.map(universityListItem), level, now).map((row) => [row.university.id, row.deadline?.dateTime ?? null]);
      const reference = cards
        .map((full) => ({ id: full.id, name: full.content.name, deadline: staffUniversityDeadline(full.content.programs, level, now)?.applicationDeadline ?? null }))
        .sort((a, b) => (a.deadline && b.deadline && a.deadline !== b.deadline ? (a.deadline < b.deadline ? -1 : 1)
          : a.deadline && !b.deadline ? -1 : !a.deadline && b.deadline ? 1
            : new Intl.Collator("ru", { sensitivity: "base", numeric: true }).compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
        .map((row) => [row.id, row.deadline]);
      assert.deepEqual(sorted, reference, `order ${level || "all"} ${now.toISOString()}`);
    }
  }
  assert.ok(compared > 20, `the fixture reaches real deadlines (${compared})`);
  assert.equal(listItemProgramCount(universityListItem(SYNTHETIC[1]), ""), 3);
  const view = universityDeadlineView(universityListItem(SYNTHETIC[0]), "", INSTANTS[0]);
  assert.deepEqual(view && [view.dateTime, view.text, view.program, view.intake, view.timezone], ["2026-11-21", "21.11 23:59", "Программа a", "Набор", "Asia/Shanghai"]);
});

test("narrow card geography: one institution, its own costs and the cities of its country only", () => {
  const id = "36400000-0000-4000-8000-000000000701";
  const countries = [["CN", "Китай"], ["MY", "Малайзия"], ["AE", "ОАЭ"], ["TR", "Турция"], ["IT", "Италия"], ["CZ", "Чехия"]]
    .map(([code, nameRu]) => ({ code, nameRu, nameKy: nameRu, nameEn: code, photo: null, summaryRu: null, summaryKy: null, kyReview: "pending" }));
  const city = (key, country) => ({ key, country, nameRu: key, nameKy: key, nameEn: key, lat: null, lng: null, photo: null, summaryRu: null, summaryKy: null,
    factRu: null, factKy: null, factSourceUrl: null, factVerifiedOn: null, kyReview: "pending", status: "draft", publishedAt: null, publishedVia: null,
    reviewedByName: null, complete: false, version: 1, updatedAt: "2026-11-10T08:00:00+00:00", institutionCount: 1 });
  const cost = (institutionId) => ({ id: "36400000-0000-4000-8000-000000000801", institutionId, programId: null, studyLevel: null, teachingLanguage: null,
    costKind: "tuition", period: "year", amountMinMinor: 100, amountMaxMinor: null, currency: "CNY", exponent: 2, academicYear: null, noteRu: null, noteKy: null,
    sourceKind: "official", sourceName: "Сайт", sourceUrl: "https://example.org/fees", verifiedOn: "2026-11-01", confirmedAt: null, confirmedOn: null,
    confirmationReason: null, confirmedByName: null, status: "published", publishedAt: null, version: 1, importKey: null, createdAt: "x", updatedAt: "y" });
  const institution = { id, name: "Альфа", country: "CN", cityLabel: null, published: true, cityKey: "alpha-city", assignedVia: "migration", assignedAt: null };
  const answer = (extra) => ({ countries, cities: [city("alpha-city", "CN")], institutions: [institution], costs: [cost(id)], fxRates: [], ...extra });
  assert.ok(parseInstitutionGeography(answer({}), id));
  assert.ok(parseInstitutionGeography(answer({ institutions: [], cities: [], costs: [cost(id)] }), id), "an institution outside the six countries keeps its costs");
  assert.equal(parseInstitutionGeography(answer({ costs: [cost("36400000-0000-4000-8000-000000000702")] }), id), null, "another institution's cost");
  assert.equal(parseInstitutionGeography(answer({ institutions: [institution, { ...institution, id: "36400000-0000-4000-8000-000000000702" }] }), id), null, "two institutions");
  assert.equal(parseInstitutionGeography(answer({ institutions: [{ ...institution, id: "36400000-0000-4000-8000-000000000702" }] }), id), null, "another institution");
  assert.equal(parseInstitutionGeography(answer({ cities: [city("alpha-city", "CN"), city("kl", "MY")] }), id), null, "a city of another country");
  assert.equal(parseInstitutionGeography(answer({ institutions: [], cities: [city("alpha-city", "CN")] }), id), null, "cities without the institution");
});

test("«Порядок» в адресе сортирует весь прочитанный каталог: по названию А→Я и по числу программ уровня (25.11.2026)", async () => {
  const { parseUniversityFilters } = await import("../src/lib/platform-university-catalog.ts");
  const now = new Date("2026-11-25T08:00:00Z");
  const items = TEMPLATES.map(universityListItem);
  const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });
  const byName = sortCatalogueRows(items, "", now, "name").map((row) => row.university.content.name);
  assert.deepEqual(byName, [...byName].sort((a, b) => collator.compare(a, b)), "по названию — весь каталог, не страница");
  assert.equal(byName.length, items.length);
  for (const level of ["", "bachelor"]) {
    const counts = sortCatalogueRows(items, level, now, "programs").map((row) => catalogueProgramCount(row.university, level));
    assert.deepEqual(counts, [...counts].sort((a, b) => b - a), `больше программ выше (${level || "все уровни"})`);
  }
  assert.deepEqual(sortCatalogueRows(items, "", now).map((row) => row.university.id), sortCatalogueRows(items, "", now, undefined).map((row) => row.university.id), "без sort — прежний порядок по сроку");
  assert.equal(parseUniversityFilters({ sort: "name" })?.sort, "name");
  assert.equal(parseUniversityFilters({ sort: "programs", level: "master" })?.sort, "programs");
  assert.equal(parseUniversityFilters({ sort: "deadline" }), null, "порядок по умолчанию в адрес не пишется");
  assert.equal(parseUniversityFilters({ sort: "zzz" }), null);
  assert.equal("sort" in (parseUniversityFilters({}) ?? {}), false);
});
