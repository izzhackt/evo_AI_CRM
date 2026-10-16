import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { photoCreditRequired } from "../src/lib/portal/university-index.ts";
import { resolveGeographyPhotoSources } from "../src/lib/university-photo-url.ts";

/**
 * Манифест фото S3 (план 4.4, приёмка 7.6.5): у каждого фото стран, городов и
 * вузов шести стран есть автор (или вуз), источник и лицензия; фото с хостов
 * образовательных агентств (EDUPRCHINA и похожих) нет; строка лицензии под
 * карточкой не печатается. Источник фото стран и городов в репозитории — сид
 * миграции 283 (генерируется из photos-manifest.json контент-потока).
 */

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

const SIX = ["CN", "MY", "AE", "TR", "IT", "CZ"];
// Агентства, чьи данные стоимости есть в сиде 16.10.2026, и похожие порталы
// поступления: их фото не берём (решение Р3).
const AGENCY_HOSTS = /(?:^|\.)(?:eduprchina\.com|easyuni\.(?:my|com)|applyforchina\.com|directlyeducation\.com|cucas\.(?:cn|edu\.cn)|china-admissions\.com|studyinchina\.(?:io|net)|universitiesofchina\.com|chinaadmissions\.com)$/u;
const GEOGRAPHY_HOSTS = {
  Pexels: ["pexels.com", "www.pexels.com"],
  Unsplash: ["unsplash.com", "www.unsplash.com"],
  "Wikimedia Commons": ["commons.wikimedia.org", "upload.wikimedia.org"],
};
const host = (url) => new URL(url).hostname;

const migration = read("supabase/migrations/283_platform_catalog_geography_costs.sql");
const seed = migration.slice(migration.indexOf(">>> BEGIN GENERATED GEOGRAPHY SEED"), migration.indexOf("<<< END GENERATED GEOGRAPHY SEED"));
const geographyPhotos = [...seed.matchAll(/'(\{"path":"geography\/[^']+\})'::JSONB/gu)].map((match) => JSON.parse(match[1]));

test("every country and city photo carries author, source and licence from an allowed host", () => {
  const countries = geographyPhotos.filter((photo) => photo.path.startsWith("geography/countries/"));
  const cities = geographyPhotos.filter((photo) => photo.path.startsWith("geography/cities/"));
  assert.equal(countries.length, 6, "six country photos");
  assert.ok(cities.length >= 50, `city photos: ${cities.length}`);
  assert.deepEqual(countries.map((photo) => photo.path.slice(20, 22).toUpperCase()).sort(), [...SIX].sort());
  for (const photo of geographyPhotos) {
    assert.deepEqual(Object.keys(photo).sort(), ["author", "authorUrl", "height", "license", "licenseUrl", "path", "sourceName", "sourceUrl", "width"], photo.path);
    assert.ok(photo.author.trim(), `${photo.path}: author`);
    assert.ok(photo.license.trim(), `${photo.path}: licence`);
    assert.ok(GEOGRAPHY_HOSTS[photo.sourceName]?.includes(host(photo.sourceUrl)), `${photo.path}: ${photo.sourceName} ${photo.sourceUrl}`);
    for (const url of [photo.sourceUrl, photo.authorUrl, photo.licenseUrl].filter(Boolean)) {
      assert.ok(url.startsWith("https://"), `${photo.path}: ${url}`);
      assert.doesNotMatch(host(url), AGENCY_HOSTS, `${photo.path}: agency host ${url}`);
    }
    assert.doesNotMatch(JSON.stringify(photo).toLowerCase(), /eduprchina/u, photo.path);
    // Лицензии Wikimedia с указанием автора подписываются, Unsplash и Pexels нет.
    if (photo.sourceName !== "Wikimedia Commons") assert.equal(photoCreditRequired(photo), false, photo.path);
    assert.match(photo.path, /-[0-9a-f]{12}\.(?:jpg|png|webp|avif)$/u, `${photo.path}: content-addressed`);
  }
});

test("every university photo of the six countries has author, source and licence, none from an agency", () => {
  const library = JSON.parse(read("src/lib/university-photo-library.json"));
  const bundles = ["china", "malaysia", "europe", "turkey", "international", "other"];
  const keys = new Set();
  for (const bundle of bundles) {
    for (const entry of JSON.parse(read(`src/lib/server/university-catalog-reviewed-${bundle}.json`))) {
      if (SIX.includes(entry.content.country) && entry.content.photoKey) keys.add(entry.content.photoKey);
    }
  }
  assert.ok(keys.size >= 80, `six-country photo keys: ${keys.size}`);
  for (const key of keys) {
    const photo = library[key];
    assert.ok(photo, `${key}: library entry`);
    assert.ok(photo.author?.trim(), `${key}: author or university`);
    assert.ok(photo.license?.trim(), `${key}: licence`);
    assert.ok(photo.sourceUrl?.startsWith("https://"), `${key}: source`);
    for (const url of [photo.sourceUrl, photo.path, photo.licenseUrl].filter(Boolean)) {
      assert.doesNotMatch(host(url), AGENCY_HOSTS, `${key}: agency host ${url}`);
    }
  }
});

test("the student interface prints no licence line under cards", () => {
  const tile = read("src/components/portal/universities/UniversityTile.tsx");
  assert.doesNotMatch(tile, /license|licence|photoCredit|figcaption/iu, "university cards carry no attribution line");
  const places = read("src/components/portal/universities/Places.tsx");
  const cards = places.slice(places.indexOf("export function CountryCards"), places.indexOf("export function PlaceHero"));
  assert.doesNotMatch(cards, /license|credit/iu, "country and city cards carry no attribution line");
  // Шапка места и герой вуза подписывают автора только по требованию лицензии.
  assert.match(places, /\{photo\?\.credit \? \(/u);
  assert.match(read("src/lib/portal/university-tiles.ts"), /credit: creditRequired\(photo\)/u);
  assert.match(read("src/components/portal/universities/PhotoFigure.tsx"), /\{photoCreditRequired\(photo\) \? \(/u);
});

test("place photos come from the project's own bucket with reduced copies", () => {
  const sources = resolveGeographyPhotoSources("geography/cities/cn-shanghai-41b1eb070bbd.jpg", "https://project.supabase.co/", [480, 800]);
  assert.equal(sources.src, "https://project.supabase.co/storage/v1/object/public/portal-university-photos/geography/cities/cn-shanghai-41b1eb070bbd.jpg");
  assert.equal(
    sources.srcSet,
    "https://project.supabase.co/storage/v1/render/image/public/portal-university-photos/geography/cities/cn-shanghai-41b1eb070bbd.jpg?width=480&height=2500&resize=contain&quality=70 480w, "
      + "https://project.supabase.co/storage/v1/render/image/public/portal-university-photos/geography/cities/cn-shanghai-41b1eb070bbd.jpg?width=800&height=2500&resize=contain&quality=70 800w",
  );
  for (const path of ["https://www.eduprchina.com/a.jpg", "geography/cities/shanghai.jpg", "../geography/cities/cn-a-41b1eb070bbd.jpg", "universities/apu.jpg"]) {
    assert.equal(resolveGeographyPhotoSources(path, "https://project.supabase.co", [480]), null, path);
  }
});
