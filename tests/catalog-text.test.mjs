import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CATALOG_AGENCY_DOMAINS,
  CATALOG_AGENCY_HOST_PATTERN,
  CATALOG_ASTRAL_SQL,
  CATALOG_EDGE_SPACE_SQL,
  CATALOG_TEXT_FORBIDDEN_SQL,
  catalogAgencyUrl,
  catalogText,
  catalogUrl,
} from "../src/lib/catalog-text.ts";
import { parseStudentUniversityIndexResponse } from "../src/lib/portal/university-index.ts";

/**
 * Одно правило текста и ссылок каталога 283 для базы и веба (review S3
 * веба, F2 и F12). Общие векторы tests/fixtures/catalog-text-vectors.json
 * проверяет и SQL-набор 283 (supabase/tests/platform_catalog_geography_costs.sql),
 * и этот тест; строки классов знаков в миграции те же, что в модуле.
 */

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const vectors = JSON.parse(read("tests/fixtures/catalog-text-vectors.json"));
const migration = read("supabase/migrations/283_platform_catalog_geography_costs.sql");

test("the shared vectors cover the risky classes", () => {
  assert.equal(vectors.schema, "evo-catalog-text-vectors/v1");
  const cases = vectors.text.map((entry) => entry.value);
  for (const sample of [" ", "­", "​", "‍", "﻿", "\n", " ", " "]) {
    assert.ok(cases.some((value) => value.includes(sample)), JSON.stringify(sample));
  }
  assert.ok(vectors.text.some((entry) => entry.ok) && vectors.text.some((entry) => !entry.ok));
  assert.ok(vectors.url.some((entry) => entry.ok) && vectors.url.some((entry) => !entry.ok));
  assert.ok(vectors.agency.some((entry) => entry.agency) && vectors.agency.some((entry) => !entry.agency));
});

test("catalogText accepts and rejects exactly the shared text vectors", () => {
  const wrong = vectors.text.filter((entry) => catalogText(entry.value, entry.max) !== entry.ok).map((entry) => entry.case);
  assert.deepEqual(wrong, []);
  // Только в JS: U+0000 и одиночные суррогаты (в тексте Postgres их нет).
  for (const value of ["Шан\u0000хай", "Шан\ud800хай", "\udfff"]) assert.equal(catalogText(value, 100), false, JSON.stringify(value));
  for (const value of [null, undefined, 5, ["a"]]) assert.equal(catalogText(value, 100), false);
});

test("catalogUrl and catalogAgencyUrl agree with the shared URL vectors", () => {
  assert.deepEqual(vectors.url.filter((entry) => catalogUrl(entry.value) !== entry.ok).map((entry) => entry.case), []);
  assert.deepEqual(vectors.agency.filter((entry) => catalogAgencyUrl(entry.value) !== entry.agency).map((entry) => entry.case), []);
  assert.equal(catalogUrl("https://example.org/\ud800"), false);
});

test("migration 283 spells the same character classes and agency list", () => {
  assert.ok(migration.includes(`p_value !~ '[${CATALOG_TEXT_FORBIDDEN_SQL}]'`), "forbidden class");
  assert.ok(migration.includes(`p_value !~ '^[${CATALOG_EDGE_SPACE_SQL}]'`), "leading space class");
  assert.ok(migration.includes(`p_value !~ '[${CATALOG_EDGE_SPACE_SQL}]$'`), "trailing space class");
  assert.ok(migration.includes(`p_url !~ '[${CATALOG_TEXT_FORBIDDEN_SQL}${CATALOG_EDGE_SPACE_SQL}${CATALOG_ASTRAL_SQL}]'`), "URL class");
  assert.ok(migration.includes(`~ '${CATALOG_AGENCY_HOST_PATTERN}'`), "agency hosts");
  assert.equal(new Set(CATALOG_AGENCY_DOMAINS).size, CATALOG_AGENCY_DOMAINS.length);
  // Ни один текст каталога 283 не проверяется прежним правилом с локалью базы.
  const definition = migration.slice(migration.indexOf("CREATE FUNCTION platform_private.catalog_text_ok"), migration.indexOf("CREATE FUNCTION platform_private.catalog_photo_source_allowed"));
  assert.doesNotMatch(definition, /\[\[:cntrl:\]\]|\[\[:space:\]\]|btrim/u);
  const body = migration.slice(migration.indexOf("CREATE FUNCTION platform_private.catalog_photo_source_allowed"), migration.indexOf("-- >>> BEGIN GENERATED GEOGRAPHY SEED"));
  assert.doesNotMatch(body, /university_public_url\(/u, "283 checks its URLs with catalog_url_ok");
});

test("seed and import scripts use the same rule", () => {
  for (const file of ["scripts/catalog/geography-seed-lib.mjs", "scripts/catalog/import-catalog-costs.mjs"]) {
    const source = read(file);
    assert.match(source, /from "\.\.\/\.\.\/src\/lib\/catalog-text\.ts"/u, file);
    assert.doesNotMatch(source, /value === value\.trim\(\)/u, file);
  }
});

// Индекс с одним городом, чьё название взято из вектора: город остаётся, если
// вектор допустим, иначе пропадает только он, а его вуз уходит в «Другие
// вузы страны» (F12: прежде весь каталог становился «не удалось загрузить»).
const PHOTO = {
  path: "geography/cities/cn-shanghai-459341790afb.jpg", width: 2000, height: 1333, author: "Diana",
  authorUrl: "https://www.pexels.com/@diana", sourceName: "Pexels", sourceUrl: "https://www.pexels.com/photo/example-123/",
  license: "Pexels License", licenseUrl: "https://www.pexels.com/license/",
};
function indexWithCity(cityName) {
  return {
    notModified: false,
    version: "g1.c259412d88f328f9f986867c747feed4",
    countries: ["CN", "MY", "AE", "TR", "IT", "CZ"].map((code) => ({
      code, name: { ru: code, ky: code }, photo: null, summary: null, universityCount: code === "CN" ? 1 : 0, cityCount: code === "CN" ? 1 : 0,
    })),
    cities: [{
      key: "shanghai", country: "CN", name: { ru: cityName, ky: "Шанхай" }, photo: PHOTO,
      summary: { ru: "Текст.", ky: "Текст." },
      fact: { ru: "Факт.", ky: "Факт.", sourceUrl: "https://whc.unesco.org/en/list/1334", verifiedOn: "2026-10-16" },
      universityCount: 1,
    }],
    universities: [{
      id: "0b9c2f8e-3f0a-4b8e-9d55-7a1d2c3e4f50", name: "Fudan University", country: "CN", cityKey: "shanghai",
      cityLabel: "Шанхай", levels: ["bachelor"], photoKey: null, intakes: [], hasCosts: false,
    }],
  };
}

test("the index parser keeps or drops a city exactly as the shared text vectors say", () => {
  for (const entry of vectors.text.filter((vector) => vector.max === 100)) {
    const issues = [];
    const parsed = parseStudentUniversityIndexResponse(indexWithCity(entry.value), (issue) => issues.push(issue));
    assert.equal(parsed?.notModified, false, entry.case);
    const { index } = parsed;
    assert.equal(index.universities.length, 1, entry.case);
    assert.equal(index.countries[0].universityCount, 1, entry.case);
    if (entry.ok) {
      assert.deepEqual(index.cities.map((city) => city.key), ["shanghai"], entry.case);
      assert.equal(index.universities[0].cityKey, "shanghai", entry.case);
      assert.deepEqual(issues, [], entry.case);
    } else {
      assert.deepEqual(index.cities, [], entry.case);
      assert.equal(index.universities[0].cityKey, null, entry.case);
      assert.equal(index.countries[0].cityCount, 0, entry.case);
      assert.deepEqual(issues[0], { item: "city", key: "shanghai", reason: "name" }, entry.case);
    }
  }
});
