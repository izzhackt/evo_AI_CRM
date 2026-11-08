import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadGeographySeed } from "../scripts/catalog/geography-seed-lib.mjs";
import { CITY_INSTITUTIONS, DEFAULT_SEED_DIR, buildCitiesSql } from "../scripts/catalog/malaysia-cities-sql.mjs";

// Малайзия 2026-11: карточки городов Пенанг и Кота-Кинабалу. Сид читается тем же
// loadGeographySeed, что сид 283 (правила текста, ссылок, фото и sha256 файлов),
// SQL печатается скриптом и ничего не выполняет: по умолчанию ROLLBACK.

const seed = loadGeographySeed({ seedDir: DEFAULT_SEED_DIR, allowMissing: true });
const reviewed = JSON.parse(
  readFileSync(new URL("../src/lib/server/university-catalog-reviewed-malaysia.json", import.meta.url), "utf8"),
);

test("seed has exactly the two published Malaysian cities with a photo and a Commons licence", () => {
  assert.deepEqual(seed.cities.map((city) => city.key), ["penang", "kota-kinabalu"]);
  assert.equal(seed.uploads.length, 2);
  for (const city of seed.cities) {
    assert.equal(city.country, "MY");
    assert.equal(city.status, "published");
    assert.equal(city.kyReview, "pending");
    assert.equal(city.photo.sourceName, "Wikimedia Commons");
    assert.match(city.photo.path, new RegExp(`^geography/cities/my-${city.key}-[0-9a-f]{12}\\.jpg$`, "u"));
    assert.ok(city.photo.license && city.photo.licenseUrl && city.photo.author);
    assert.ok(city.factSourceUrl.startsWith("https://") && city.factVerifiedOn);
  }
});

test("each city links to an existing reviewed card; INTI Sabah has no photoKey", () => {
  for (const [city, cardKey] of Object.entries(CITY_INSTITUTIONS)) {
    const card = reviewed.find((item) => item.key === cardKey);
    assert.ok(card, `${city}: reviewed card ${cardKey}`);
    assert.equal(card.content.country, "MY");
  }
  assert.equal(reviewed.find((item) => item.key === "inti-sabah").content.photoKey ?? null, null);
});

test("generated SQL is a dry run by default and writes only through the staff RPCs", () => {
  const dry = buildCitiesSql().sql;
  const commit = buildCitiesSql({ commit: true }).sql;
  assert.match(dry.trimEnd(), /ROLLBACK;$/u);
  assert.match(commit.trimEnd(), /COMMIT;$/u);
  assert.equal(dry.replace(/ROLLBACK;\s*$/u, ""), commit.replace(/COMMIT;\s*$/u, ""));
  for (const rpc of ["staff_catalog_city_upsert_v1", "staff_catalog_city_publish_v1", "staff_catalog_institution_city_set_v1"]) {
    assert.ok(dry.includes(rpc), rpc);
  }
  assert.ok(!/\b(DELETE|TRUNCATE|DROP)\b/u.test(dry));
  assert.ok(dry.includes("INTI International College Penang") && dry.includes("INTI College Sabah"));
  assert.throws(() => buildCitiesSql({ actorMembership: "not-a-uuid" }), /UUID/u);
});
