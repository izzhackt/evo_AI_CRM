import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  amountToMinor, cityDraft, cityInput, cityMissing, costDraft, costInput, exactCityInput, exactCostInput, formatCostAmount,
  fxInput, minorToAmount, parseStaffGeography, rateIsStale, usdApprox,
} from "../src/lib/catalog-geography.ts";
import { STUDENT_UNIVERSITY_INDEX_TAG } from "../src/lib/portal/university-index-tag.ts";

const today = "2026-10-16";
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

test("CRM editor never prints the curator phrase and shares the student index cache tag", () => {
  assert.equal(STUDENT_UNIVERSITY_INDEX_TAG, "portal-student-university-index");
  const files = ["src/lib/catalog-geography.ts", "src/lib/catalog-geography-actions.ts", "src/components/v3/universities/geography/UniversityCosts.tsx", "src/components/v3/universities/geography/FxRates.tsx", "src/components/v3/universities/geography/CityEditor.tsx"];
  for (const file of files) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /Стоимость уточняет куратор/u, file);
    // Human copy of these screens has no long or medium dash (EVO text rule).
    assert.doesNotMatch(text, /[–—]/u, file);
  }
  const action = readFileSync(new URL("../src/lib/catalog-geography-actions.ts", import.meta.url), "utf8");
  assert.match(action, /revalidateTag\(STUDENT_UNIVERSITY_INDEX_TAG, \{ expire: 0 \}\)/u);
});
