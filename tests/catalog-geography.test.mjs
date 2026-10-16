import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  amountToMinor, catalogTextIssue, cityDraft, cityDraftChanged, cityDraftNotes, cityInput, cityMissing, costDraft, costDraftChanged, costDraftNotes, costInput,
  draftSync, exactCityInput, exactCostInput, formatCostAmount, fxInput, geographyMessage, geographyRefusal, minorToAmount, parseStaffGeography, rateIsStale, usdApprox,
} from "../src/lib/catalog-geography.ts";
import { catalogAgencyUrl, catalogText, catalogUrl } from "../src/lib/catalog-text.ts";
import { STUDENT_UNIVERSITY_INDEX_TAG } from "../src/lib/portal/university-index-tag.ts";

const today = "2026-10-16";
const vectors = JSON.parse(readFileSync(new URL("./fixtures/catalog-text-vectors.json", import.meta.url), "utf8"));
const institutionId = "0b9c2f8e-3f0a-4b8e-9d55-7a1d2c3e4f50";
const photo = { path: "geography/cities/cn-hangzhou-c6acd1b0f6fb.jpg", width: 2400, height: 1800, author: "miyou_ 77", authorUrl: "https://www.pexels.com/@miyou_-77-696995602/", sourceName: "Pexels", sourceUrl: "https://www.pexels.com/photo/view-of-the-west-lake-20700881/", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" };
const city = { key: "hangzhou", country: "CN", nameRu: "Ханчжоу", nameKy: "Ханчжоу", nameEn: "Hangzhou", lat: 30.27, lng: 120.15, photo, summaryRu: "Столица провинции Чжэцзян.", summaryKy: "Чжэцзян провинциясынын борбору.", factRu: "Озеро Сиху внесено в список ЮНЕСКО в 2011 году.", factKy: "Сиху көлү 2011-жылы ЮНЕСКОнун тизмесине киргизилген.", factSourceUrl: "https://whc.unesco.org/en/list/1334", factVerifiedOn: "2026-10-16", kyReview: "pending", status: "published", publishedAt: "2026-10-16T08:00:00+00:00", publishedVia: "migration", reviewedByName: null, complete: true, version: 2, updatedAt: "2026-10-16T08:00:00+00:00", institutionCount: 9 };
const cost = { id: "785b342e-0000-4000-8000-000000000001", institutionId, programId: null, studyLevel: "bachelor", teachingLanguage: "en", costKind: "tuition", period: "year", amountMinMinor: 2500000, amountMaxMinor: 3500000, currency: "CNY", exponent: 2, academicYear: "2026/27", noteRu: null, noteKy: null, sourceKind: "agency", sourceName: "EDUPRCHINA", sourceUrl: "https://www.eduprchina.com/fees", verifiedOn: "2026-10-16", confirmedAt: null, confirmedOn: null, confirmationReason: null, confirmedByName: null, status: "draft", publishedAt: null, version: 1, importKey: null, createdAt: "2026-10-16T08:00:00+00:00", updatedAt: "2026-10-16T08:00:00+00:00" };
const countries = [["CN", "Китай", "Кытай", "China"], ["MY", "Малайзия", "Малайзия", "Malaysia"], ["AE", "ОАЭ", "БАЭ", "United Arab Emirates"], ["TR", "Турция", "Түркия", "Turkey"], ["IT", "Италия", "Италия", "Italy"], ["CZ", "Чехия", "Чехия", "Czechia"]]
  .map(([code, nameRu, nameKy, nameEn]) => ({ code, nameRu, nameKy, nameEn, photo: null, summaryRu: null, summaryKy: null, kyReview: "pending" }));
const geography = { countries, cities: [city], institutions: [{ id: institutionId, name: "Zhejiang University", country: "CN", cityLabel: "Ханчжоу", published: true, cityKey: "hangzhou", assignedVia: "migration", assignedAt: "2026-10-16T08:00:00+00:00" }], costs: [cost], fxRates: [{ currency: "CNY", asOf: "2026-10-13", unitsPerUsd: 7.1234, sourceName: "ECB", sourceUrl: null, setAt: "2026-10-13T08:00:00+00:00", ageDays: 3, latest: true }] };

test("staff geography reader accepts the contract shape and rejects drift as unavailable", () => {
  const parsed = parseStaffGeography(geography);
  assert.ok(parsed);
  assert.equal(parsed.cities[0].key, "hangzhou");
  assert.equal(parsed.costs[0].sourceName, "EDUPRCHINA");
  // An additive field of a later 283 release is ignored, not a failure.
  assert.ok(parseStaffGeography({ ...geography, cities: [{ ...city, futureField: 1 }] }));
  for (const broken of [
    { ...geography, countries: [...countries].reverse() },
    { ...geography, costs: [{ ...cost, status: "live" }] },
    { ...geography, costs: [{ ...cost, amountMaxMinor: 2500000 }] },
    { ...geography, cities: [{ ...city, photo: { ...photo, sourceName: "EDUPRCHINA" } }] },
    { ...geography, fxRates: "[]" },
    null,
  ]) assert.equal(parseStaffGeography(broken), null);
});

test("money: minor units round-trip and USD reference follows SQL catalog_usd_approx", () => {
  assert.equal(amountToMinor("25 000", 2), 2500000);
  assert.equal(amountToMinor("25000,5", 2), 2500050);
  assert.equal(amountToMinor("25000.505", 2), null);
  assert.equal(amountToMinor("-1", 2), null);
  assert.equal(amountToMinor("1.5", 0), null);
  assert.equal(minorToAmount(2500050, 2), "25000.5");
  assert.equal(minorToAmount(5, 2), "0.05");
  assert.equal(minorToAmount(1200, 0), "1200");
  // Contract 2.2 example: 25 000 / 35 000 / 8 000 CNY at 7.1234 → 3510 / 4910 / 1120.
  assert.equal(usdApprox(2500000, "CNY", 2, 7.1234), 3510);
  assert.equal(usdApprox(3500000, "CNY", 2, 7.1234), 4910);
  assert.equal(usdApprox(800000, "CNY", 2, 7.1234), 1120);
  assert.equal(usdApprox(100, "CNY", 2, 7.1234), 10);
  assert.equal(usdApprox(0, "CZK", 2, 21.7), 0);
  assert.equal(usdApprox(500000, "USD", 2, 1), null);
  assert.equal(usdApprox(500000, "MYR", 2, null), null);
  assert.equal(formatCostAmount(cost).replace(/\s/g, " "), "от 25 000 до 35 000 CNY");
  assert.equal(rateIsStale({ ageDays: 45 }), false);
  assert.equal(rateIsStale({ ageDays: 46 }), true);
});

test("city card: complete only with photo, text, fact, source and date; photo sources limited", () => {
  const draft = cityDraft(parseStaffGeography(geography).cities[0], "CN");
  const { input, errors } = cityInput(draft, today);
  assert.equal(errors.size, 0);
  assert.deepEqual(cityMissing(input), []);
  assert.deepEqual(exactCityInput(input, today), input);
  assert.deepEqual(cityMissing({ ...input, photo: null, factRu: null, factSourceUrl: null }), ["фото", "интересный факт", "источник факта"]);
  const failures = [
    [{ photoSourceUrl: "https://www.eduprchina.com/photo/1" }, "photo"],
    [{ photoSourceName: "Unsplash" }, "photo"],
    [{ photoPath: "photos/hangzhou.jpg" }, "photo"],
    [{ summaryKy: "" }, "summary"],
    [{ factRu: "Озеро Сиху — объект ЮНЕСКО." }, "fact"],
    [{ factVerifiedOn: "2026-10-17" }, "factVerifiedOn"],
    [{ lat: "30.27", lng: "" }, "coordinates"],
    [{ key: "Hang Zhou" }, "key"],
  ];
  for (const [patch, field] of failures) assert.ok(cityInput({ ...draft, ...patch }, today).errors.has(field), JSON.stringify(patch));
  // The server re-check refuses anything the form itself would not send.
  assert.equal(exactCityInput({ ...input, nameRu: " Ханчжоу" }, today), null);
  assert.equal(exactCityInput({ ...input, extra: true }, today), null);
  assert.equal(exactCityInput({ ...input, factSourceUrl: "" }, today), null);
});

test("cost row: agency and official need an https source, program fixes its level, equal bounds are one amount", () => {
  const programs = [{ id: "program-1", level: "master" }];
  const base = costDraft(null, "CN", today);
  assert.equal(base.currency, "CNY");
  const filled = { ...base, amountMin: "25000", amountMax: "25000", sourceKind: "agency", sourceName: "EDUPRCHINA", sourceUrl: "https://www.eduprchina.com/fees", programId: "program-1" };
  const { input, errors } = costInput(filled, { id: null, institutionId }, programs, today);
  assert.equal(errors.size, 0);
  assert.equal(input.studyLevel, "master");
  assert.equal(input.amountMinMinor, 2500000);
  assert.equal(input.amountMaxMinor, null);
  assert.deepEqual(exactCostInput(input, null, today), input);
  assert.ok(costInput({ ...filled, sourceUrl: "" }, { id: null, institutionId }, programs, today).errors.has("sourceUrl"));
  assert.equal(costInput({ ...filled, sourceKind: "evo_document", sourceUrl: "" }, { id: null, institutionId }, programs, today).errors.size, 0);
  assert.ok(costInput({ ...filled, amountMax: "100" }, { id: null, institutionId }, programs, today).errors.has("amountMax"));
  assert.ok(costInput({ ...filled, academicYear: "2026-27" }, { id: null, institutionId }, programs, today).errors.has("academicYear"));
  assert.ok(costInput({ ...filled, noteRu: "Только RU" }, { id: null, institutionId }, programs, today).errors.has("note"));
  assert.ok(costInput({ ...filled, verifiedOn: "2026-10-17" }, { id: null, institutionId }, programs, today).errors.has("verifiedOn"));
  assert.equal(exactCostInput({ ...input, sourceName: "EDUPRCHINA " }, null, today), null);
  assert.equal(exactCostInput({ ...input, organizationId: institutionId }, null, today), null);
  const fx = fxInput({ currency: "aed", asOf: today, unitsPerUsd: "3,6725", sourceName: "Central Bank of the UAE", sourceUrl: "" }, today);
  assert.equal(fx.errors.size, 0);
  assert.deepEqual(fx.input, { currency: "AED", asOf: today, unitsPerUsd: 3.6725, sourceName: "Central Bank of the UAE", sourceUrl: null });
  assert.ok(fxInput({ ...fx.input, unitsPerUsd: "0", sourceUrl: "" }, today).errors.has("unitsPerUsd"));
  assert.ok(fxInput({ currency: "USD", asOf: today, unitsPerUsd: "1", sourceName: "x", sourceUrl: "" }, today).errors.has("currency"));
});

test("city editor is dirty by meaning, not by raw form strings (review CRM R2)", () => {
  const saved = parseStaffGeography({ ...geography, cities: [{ ...city, nameEn: "Suzhou", lat: 30.25, lng: 120.62 }] }).cities[0];
  const draft = cityDraft(saved, "CN");
  assert.equal(cityDraftChanged(draft, saved, today), false);
  // Trailing space, pasted newline-free padding and trailing zeros are what the database stores anyway.
  assert.equal(cityDraftChanged({ ...draft, nameEn: "Suzhou " }, saved, today), false);
  assert.equal(cityDraftChanged({ ...draft, lat: "30.250", lng: " 120.620" }, saved, today), false);
  assert.equal(cityDraftChanged({ ...draft, summaryRu: `${draft.summaryRu}  ` }, saved, today), false);
  // Photo fields without a path are not sent, so they do not make the card dirty.
  const bare = parseStaffGeography({ ...geography, cities: [{ ...city, photo: null }] }).cities[0];
  assert.equal(cityDraftChanged({ ...cityDraft(bare, "CN"), photoSourceName: "Unsplash", photoAuthor: "x" }, bare, today), false);
  // A real change, or an unreadable number instead of an empty coordinate, is dirty.
  assert.equal(cityDraftChanged({ ...draft, nameEn: "Suzhou City" }, saved, today), true);
  assert.equal(cityDraftChanged({ ...cityDraft(bare, "CN"), lat: "abc", lng: "def" }, { ...bare, lat: null, lng: null }, today), true);
  assert.equal(cityDraftChanged(draft, null, today), true);
});

test("a newer saved version never lets a save overwrite it silently (review CRM S1)", () => {
  // Own save (draft equals the new version) or no own edits: the draft follows the saved card.
  assert.equal(draftSync({ ownEdits: false, matchesSaved: false, reloadRequested: false }), "adopt");
  assert.equal(draftSync({ ownEdits: true, matchesSaved: true, reloadRequested: false }), "adopt");
  // Own edits on an older version stay until the editor asks for the saved card, then they are replaced.
  assert.equal(draftSync({ ownEdits: true, matchesSaved: false, reloadRequested: false }), "keep");
  assert.equal(draftSync({ ownEdits: true, matchesSaved: false, reloadRequested: true }), "replace");

  // What the editor can copy: only the fields changed from the version the draft started from.
  const v1 = parseStaffGeography({ ...geography, cities: [{ ...city, nameEn: "Stale One", version: 1 }] }).cities[0];
  const mine = { ...cityDraft(v1, "CN"), summaryRu: "Текст редактора A. ", kyReview: "done" };
  assert.equal(cityDraftNotes(mine, v1, "CN"), "Коротко о городе, RU: Текст редактора A.\nКыргызский текст проверен носителем языка: да");
  assert.equal(cityDraftNotes(cityDraft(v1, "CN"), v1, "CN"), "");
  assert.match(cityDraftNotes({ ...cityDraft(null, "CN"), key: "qa-city", nameRu: "Город" }, null, "CN"), /^Ключ в адресе: qa-city\nНазвание, RU: Город$/u);

  // Cost rows: dirty by meaning, notes in the words of the form.
  const programs = [{ id: "program-1", level: "master" }];
  const row = parseStaffGeography(geography).costs[0];
  const saved = costDraft(row, "CN", today);
  assert.equal(costDraftChanged(saved, row, "CN", programs, today), false);
  assert.equal(costDraftChanged({ ...saved, amountMin: "25000.00", sourceName: "EDUPRCHINA " }, row, "CN", programs, today), false);
  assert.equal(costDraftChanged({ ...saved, amountMin: "26000" }, row, "CN", programs, today), true);
  assert.equal(costDraftChanged(saved, null, "CN", programs, today), true);
  assert.equal(costDraftNotes({ ...saved, amountMin: "26000", period: "semester", costKind: "accommodation" }, row, "CN", today), "Что: Общежитие\nПериод: за семестр\nСумма или «от»: 26000");

  // Both editors send the version their draft started from, not the version of the latest props.
  const read = (file) => readFileSync(new URL(`../src/components/v3/universities/geography/${file}`, import.meta.url), "utf8");
  for (const file of ["CityEditor.tsx", "UniversityCosts.tsx"]) {
    const text = read(file);
    assert.match(text, /baseVersion: versioned\.baseVersion/u, file);
    assert.doesNotMatch(text, /baseVersion: (city|row)\?\.version/u, file);
    assert.match(text, /versioned\.reload\(/u, file);
  }
  // The photo preview checks a missing file again (review CRM N2).
  assert.match(read("CityEditor.tsx"), /Проверить снова/u);
  // A confirmed save marks the draft as stored, so a later version on top of it is not "your unsaved text" (review CRM V4).
  assert.match(read("CityEditor.tsx"), /\}, save\.state\);/u);
  // Buttons keep their size while a request is pending; no bare "Сохраняем…" label swaps (review CRM V2).
  for (const file of ["CityEditor.tsx", "UniversityCosts.tsx", "FxRateForm.tsx", "UniversityCityPicker.tsx"]) {
    const text = read(file);
    assert.match(text, /<BusyLabel busy=/u, file);
    assert.doesNotMatch(text, /\? "(Сохраняем|Подтверждаем)…"/u, file);
  }
  // The city of a university follows the saved link and refuses to save over one the editor has not seen (review CRM V3).
  const picker = read("UniversityCityPicker.tsx");
  assert.match(picker, /draftSync\(\{ ownEdits: choice !== base, matchesSaved: choice === saved, reloadRequested: false \}\)/u);
  assert.match(picker, /disabled=\{pending \|\| !changed \|\| behind\}/u);
});

test("editor fields use the database text and URL rule on the shared vectors (contract 2.2a)", () => {
  // Same verdict as catalog_text_ok for every shared vector (staff fields without the student dash rule).
  assert.deepEqual(vectors.text.filter((entry) => (catalogTextIssue(entry.value, entry.max, false) === null) !== entry.ok).map((entry) => entry.case), []);
  const programs = [];
  const row = costInput({ ...costDraft(null, "CN", today), amountMin: "100", sourceName: "Zhejiang University", sourceUrl: "https://www.zju.edu.cn/english/" }, { id: null, institutionId }, programs, today).input;
  assert.deepEqual(exactCostInput(row, null, today), row);
  for (const entry of vectors.text) {
    // The server re-check accepts a source name exactly when the database would.
    assert.equal(exactCostInput({ ...row, sourceName: entry.value }, null, today) !== null, catalogText(entry.value, 200), entry.case);
  }
  const draft = cityDraft(parseStaffGeography(geography).cities[0], "CN");
  const cityRow = cityInput(draft, today).input;
  // An empty form field means "no address"; the form trims, the server re-check refuses untrimmed input.
  for (const entry of vectors.url) {
    assert.equal(exactCostInput({ ...row, sourceUrl: entry.value }, null, today) !== null, entry.ok && !catalogAgencyUrl(entry.value), entry.case);
    assert.equal(exactCityInput({ ...cityRow, factSourceUrl: entry.value }, today) !== null, entry.ok, entry.case);
    assert.equal(fxInput({ currency: "CNY", asOf: today, unitsPerUsd: "7.1", sourceName: "ECB", sourceUrl: entry.value }, today).errors.has("sourceUrl"), entry.value.trim() !== "" && !catalogUrl(entry.value.trim()), entry.case);
  }
  // Invisible characters get specific words, not a generic refusal.
  assert.match(cityInput({ ...draft, nameRu: "Хан\u00adчжоу" }, today).errors.get("nameRu"), /невидимые знаки/u);
  assert.match(cityInput({ ...draft, summaryKy: "x".repeat(301) }, today).errors.get("summary"), /^KY: Слишком длинно: 301 из 300/u);
  assert.match(cityInput({ ...draft, summaryKy: "" }, today).errors.get("summary"), /сейчас нет KY/u);
});

test("agency addresses only on agency rows and photo hosts per named source (review CRM R4)", () => {
  const draft = { ...costDraft(null, "CN", today), amountMin: "25000", sourceName: "EDUPRCHINA", sourceUrl: "https://www.eduprchina.com/fees" };
  for (const entry of vectors.agency) {
    const official = costInput({ ...draft, sourceKind: "official", sourceUrl: entry.value }, { id: null, institutionId }, [], today);
    assert.equal(official.errors.has("sourceKind"), entry.agency, entry.case);
    assert.equal(costInput({ ...draft, sourceKind: "agency", sourceUrl: entry.value }, { id: null, institutionId }, [], today).errors.has("sourceKind"), false, entry.case);
  }
  assert.match(costInput({ ...draft, sourceKind: "evo_document" }, { id: null, institutionId }, [], today).errors.get("sourceKind"), /www\.eduprchina\.com принадлежит образовательному агентству/u);
  const cityRow = cityDraft(parseStaffGeography(geography).cities[0], "CN");
  const wrongHost = cityInput({ ...cityRow, photoSourceUrl: "https://commons.wikimedia.org/wiki/File:West_Lake.jpg" }, today).errors;
  assert.ok(wrongHost.has("photo"));
  assert.match(wrongHost.get("photoSourceUrl"), /pexels\.com/u);
  assert.ok(cityInput({ ...cityRow, photoAuthorUrl: "https://www.eduprchina.com/u/1" }, today).errors.has("photoAuthorUrl"));
  assert.ok(cityInput({ ...cityRow, photoWidth: "0" }, today).errors.has("photoWidth"));
});

test("refusals: only known 283 names become reasons, and words follow the operation (review CRM R7)", () => {
  assert.equal(geographyRefusal("catalog_city_photo_missing"), "photo_missing");
  assert.equal(geographyRefusal('new row for relation "catalog_cities" violates check constraint "catalog_cities_published_complete"'), "city_incomplete");
  assert.equal(geographyRefusal('duplicate key value violates unique constraint "catalog_cities_organization_id_country_code_name_ru_key"'), "duplicate_city_name");
  assert.equal(geographyRefusal("catalog_cost_invalid"), null);
  assert.equal(geographyRefusal("private detail"), null);
  assert.equal(geographyRefusal(undefined), null);
  assert.match(geographyMessage("city_publish", "invalid", "photo_missing"), /Город не опубликован/u);
  assert.match(geographyMessage("city_upsert", "invalid", "photo_missing"), /Ничего не сохранено/u);
  assert.match(geographyMessage("city_publish", "invalid", "city_incomplete"), /для публикации нужны фото/u);
  assert.match(geographyMessage("cost_upsert", "forbidden", "admin_required"), /Вид источника у строки агентства/u);
  assert.match(geographyMessage("cost_publish", "rejected", null), /после подтверждения системного Admin/u);
  assert.match(geographyMessage("city_upsert", "rejected", null), /карточка должна остаться полной/u);
  assert.doesNotMatch(geographyMessage("city_upsert", "rejected", null), /агентства/u);
  assert.match(geographyMessage("fx_rate_set", "invalid", null), /Курс не сохранён/u);
  assert.match(geographyMessage("city_upsert", "invalid", "city_exists"), /таким ключом уже есть/u);
});

test("CRM editor never prints the curator phrase and shares the student index cache tag", () => {
  assert.equal(STUDENT_UNIVERSITY_INDEX_TAG, "portal-student-university-index");
  const files = ["src/lib/catalog-geography.ts", "src/lib/catalog-geography-actions.ts", "src/components/v3/universities/geography/UniversityCosts.tsx", "src/components/v3/universities/geography/FxRates.tsx", "src/components/v3/universities/geography/CityEditor.tsx", "src/components/v3/universities/geography/UniversityCityPicker.tsx", "src/components/v3/universities/geography/CityList.tsx", "src/components/v3/universities/geography/FxRateForm.tsx", "src/components/v3/universities/geography/command.tsx"];
  for (const file of files) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /Стоимость уточняет куратор/u, file);
    // Human copy of these screens has no long or medium dash (EVO text rule).
    assert.doesNotMatch(text, /[–—]/u, file);
  }
  const action = readFileSync(new URL("../src/lib/catalog-geography-actions.ts", import.meta.url), "utf8");
  assert.match(action, /revalidateTag\(STUDENT_UNIVERSITY_INDEX_TAG, \{ expire: 0 \}\)/u);
  // No internal jargon on the staff screens (review CRM R7).
  const picker = readFileSync(new URL("../src/components/v3/universities/geography/UniversityCityPicker.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(picker, /из сида|сид 283/u);
  // The city select gets only key, country, name and status; full city texts stay on the server (review CRM R3).
  const panel = readFileSync(new URL("../src/components/v3/universities/geography/UniversityGeographyPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /map\(\(\{ key, country, nameRu, status \}\) => \(\{ key, country, nameRu, status \}\)\)/u);
  assert.doesNotMatch(panel, /cities=\{geography\.cities\}/u);
});
