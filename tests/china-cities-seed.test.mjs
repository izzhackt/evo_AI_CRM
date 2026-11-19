import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadGeographySeed } from "../scripts/catalog/geography-seed-lib.mjs";
import { EXISTING_CITY_KEYS } from "../scripts/catalog/china-2026-11-build.mjs";
import { DEFAULT_SEED_DIR, buildCitiesSql } from "../scripts/catalog/china-cities-sql.mjs";

// Китай 2026-11: карточки новых городов. Сид читается тем же loadGeographySeed, что сид 283 (правила текста,
// ссылок, фото и sha256 файлов); SQL печатается скриптом и ничего не выполняет: по умолчанию ROLLBACK.

const seed = loadGeographySeed({ seedDir: DEFAULT_SEED_DIR, allowMissing: true });
const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const cards = read("src/lib/server/university-catalog-reviewed-china.json");
const links = read("scripts/catalog/data/china-2026-11/city-links-new.json");

test("China 2026-11 cities: every new Chinese city is published with a free photo, RU and KY text and a sourced fact", () => {
  assert.ok(seed.cities.length >= 40, "dozens of new cities");
  assert.equal(seed.uploads.length, seed.cities.length);
  const keys = new Set();
  for (const city of seed.cities) {
    assert.ok(!keys.has(city.key), `${city.key}: unique`);
    keys.add(city.key);
    assert.ok(!EXISTING_CITY_KEYS.includes(city.key), `${city.key}: not one of the 19 published cities`);
    assert.equal(city.country, "CN");
    assert.equal(city.status, "published");
    assert.equal(city.kyReview, "pending");
    assert.ok(city.summaryRu && city.summaryKy && city.factRu && city.factKy, city.key);
    assert.ok(city.factSourceUrl.startsWith("https://") && city.factVerifiedOn, city.key);
    assert.ok(Number.isFinite(city.lat) && Number.isFinite(city.lng), city.key);
    assert.equal(city.photo.sourceName, "Wikimedia Commons", city.key);
    assert.match(city.photo.path, new RegExp(`^geography/cities/cn-${city.key}-[0-9a-f]{12}\\.jpg$`, "u"));
    assert.ok(city.photo.license && city.photo.licenseUrl && city.photo.author, city.key);
    assert.match(city.photo.license, /^(CC0|CC BY|CC BY-SA|Public domain|PD)/iu, `${city.key}: open licence`);
  }
  for (const upload of seed.uploads) assert.ok(upload.bytes <= 450 * 1024, `${upload.path}: photo stays small in the repository`);
});

test("China 2026-11 cities: every link points at a seed city and a card of this file, and every city has a university", () => {
  const cityKeys = new Set(seed.cities.map((city) => city.key));
  const cardKeys = new Set(cards.map((card) => card.key));
  const used = new Set();
  for (const [cardKey, cityKey] of Object.entries(links)) {
    assert.ok(cardKeys.has(cardKey), `${cardKey}: card`);
    assert.ok(cityKeys.has(cityKey), `${cardKey}: city ${cityKey} is in the seed`);
    used.add(cityKey);
  }
  for (const key of cityKeys) assert.ok(used.has(key), `${key}: has a university`);
});

test("China 2026-11 cities: generated SQL is a dry run by default and writes only through the staff RPCs", () => {
  const dry = buildCitiesSql().sql;
  const commit = buildCitiesSql({ commit: true }).sql;
  assert.match(dry.trimEnd(), /ROLLBACK;$/u);
  assert.match(commit.trimEnd(), /COMMIT;$/u);
  assert.equal(dry.replace(/ROLLBACK;\s*$/u, ""), commit.replace(/COMMIT;\s*$/u, ""));
  for (const rpc of ["staff_catalog_city_upsert_v1", "staff_catalog_city_publish_v1", "staff_catalog_institution_city_set_v1"]) {
    assert.ok(dry.includes(rpc), rpc);
  }
  assert.ok(!/\b(DELETE|TRUNCATE|DROP)\b/u.test(dry));
  assert.doesNotMatch(dry, /\b(INSERT INTO|UPDATE)\s+platform(_private)?\./u, "no direct writes to the catalogue tables");
  assert.throws(() => buildCitiesSql({ actorMembership: "not-a-uuid" }), /UUID/u);
});

test("China 2026-11 cities: a published city that differs from the seed (a staff or native-speaker edit) is kept unless overwriting is asked for", () => {
  const safe = buildCitiesSql().sql;
  const forced = buildCitiesSql({ overwriteExisting: true }).sql;
  assert.match(safe, /overwrite CONSTANT BOOLEAN := FALSE;/u);
  assert.match(forced, /overwrite CONSTANT BOOLEAN := TRUE;/u);
  assert.ok(safe.includes("WHEN ex.status = 'published' AND NOT overwrite THEN 'kept_edited'"));
  assert.ok(safe.includes("IF st NOT IN ('current', 'kept_edited') THEN"), "kept cities are not upserted");
  assert.equal(safe.replace("overwrite CONSTANT BOOLEAN := FALSE;", ""), forced.replace("overwrite CONSTANT BOOLEAN := TRUE;", ""), "the flag is the only difference");
});
