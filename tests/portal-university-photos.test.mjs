import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  managedUniversityPhotoUrl,
  resolveGeographyPhotoSources,
  universityPhotoPublicBaseUrl,
} from "../src/lib/university-photo-url.ts";

// The managed address follows NEXT_PUBLIC_SUPABASE_URL (docs/runbooks/selfhosted-cutover.md).
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://iosckaqtovbbnssqcpde.supabase.co";
const UNIVERSITY_PHOTO_PUBLIC_BASE_URL = universityPhotoPublicBaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);

/**
 * Манифест фото S3 (план 4.4, приёмка 7.6.5): у каждого фото стран, городов и
 * вузов шести стран есть автор (или вуз), источник и лицензия; фото с хостов
 * образовательных агентств (EDUPRCHINA и похожих) нет; строка лицензии под
 * карточкой не печатается. Источник фото стран и городов в репозитории — сид
 * миграции 283 (генерируется из photos-manifest.json контент-потока).
 * Фото вуза студент видит только из нашего бакета (hotlink с сайтов вузов
 * нет); автор и лицензия открываются кнопкой «©».
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
    assert.match(photo.path, /-[0-9a-f]{12}\.(?:jpg|png|webp|avif)$/u, `${photo.path}: content-addressed`);
  }
});

const library = JSON.parse(read("src/lib/university-photo-library.json"));
const manifest = JSON.parse(read("scripts/portal/university-photos-manifest.json"));
const sixCountryKeys = new Set();
for (const bundle of ["china", "malaysia", "europe", "turkey", "international", "other"]) {
  for (const entry of JSON.parse(read(`src/lib/server/university-catalog-reviewed-${bundle}.json`))) {
    if (SIX.includes(entry.content.country) && entry.content.photoKey) sixCountryKeys.add(entry.content.photoKey);
  }
}

test("every university photo of the six countries has author, source and licence, none from an agency", () => {
  const keys = sixCountryKeys;
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

test("no university photo of the six countries reaches the student as a hotlink (приёмка 7.6.5)", () => {
  let managed = 0;
  for (const key of sixCountryKeys) {
    const url = managedUniversityPhotoUrl(key);
    const entry = manifest.entries[key];
    if (url === null) {
      // Без копии в бакете честная заглушка; запись объясняет, почему копии
      // нет: ждёт --apply координатора, не скачалась или нет основания.
      assert.ok(entry.migrated !== true, key);
      assert.ok(entry.status === "ineligible" ? entry.rights === null : typeof entry.rights === "string", key);
      continue;
    }
    managed += 1;
    assert.ok(url.startsWith(`${UNIVERSITY_PHOTO_PUBLIC_BASE_URL}/${key}.`), `${key}: ${url}`);
  }
  assert.ok(managed >= 70, `managed six-country photos: ${managed}`);
  // Экраны берут только managed-адрес: без запасного пути на сайт вуза.
  for (const file of ["src/lib/portal/university-tiles.ts", "src/components/portal/universities/PhotoFigure.tsx"]) {
    const source = read(file);
    assert.match(source, /managedUniversityPhotoUrl\(/u, file);
    assert.doesNotMatch(source, /universityPhotoUrl\(|entry\?\.path|photo\?\.path/u, file);
  }
});

test("the student interface prints no licence line under cards; author and licence sit behind ©", () => {
  const tile = read("src/components/portal/universities/UniversityTile.tsx");
  assert.doesNotMatch(tile, /figcaption|strings\.photoCredit|license|licence/u, "university cards carry no attribution line");
  assert.match(tile, /<PhotoRights credit=\{model\.photo\.credit\} universityName=\{model\.name\}/u);
  const places = read("src/components/portal/universities/Places.tsx");
  assert.doesNotMatch(places, /figcaption|pt-place-credit|photoCredit\.split/u, "places print no attribution line");
  for (const [from, to] of [["export function CountryCards", "export function CityCards"],
    ["export function CityCards", "export function PlaceHero"], ["export function PlaceHero", "export type Crumb"]]) {
    assert.match(places.slice(places.indexOf(from), places.indexOf(to)), /<PhotoRights credit=\{[a-z.]*photo\.credit\}/u, from);
  }
  assert.match(read("src/components/portal/universities/PhotoFigure.tsx"), /<PhotoRights credit=\{credit\} universityName=\{content\.name\}/u);
  // Официальные медиа вуза: «Фото: <вуз>, официальный сайт».
  const tiles = read("src/lib/portal/university-tiles.ts");
  assert.match(tiles, /isOfficialMediaLicense\(entry\.license\)\s*\? \{ kind: "official", sourceUrl: entry\.sourceUrl \}/u);
  const i18n = read("src/lib/portal/i18n.ts");
  assert.match(i18n, /photoCreditOfficial: "Фото: \{university\}, официальный сайт"/u);
  assert.match(i18n, /photoCreditOfficial: "Сүрөт: \{university\}, расмий сайт"/u);
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
