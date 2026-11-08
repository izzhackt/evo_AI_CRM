import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const pages = {
  countries: read("src/app/(staff)/universities/country/page.tsx"),
  country: read("src/app/(staff)/universities/country/[code]/page.tsx"),
  city: read("src/app/(staff)/universities/country/[code]/[city]/page.tsx"),
};
const source = read("src/lib/v3/university-geo-source.ts");

test("все страницы стран идут через право раздела и отклоняют лишнее 404", () => {
  for (const [name, text] of Object.entries(pages)) {
    assert.match(text, /requireV3PageActor\("\/universities"\)/u, name);
    assert.match(text, /notFound\(\)/u, name);
    assert.match(text, /export const dynamic = "force-dynamic"/u, name);
  }
  assert.match(pages.countries, /hasNoQuery\(query\)\) notFound\(\)/u);
  assert.match(pages.country, /parseGeoCountryCode\(route\.code\) \?\? notFound\(\)/u);
  assert.match(pages.country, /parseCountryView\(query\) \?\? notFound\(\)/u);
  assert.match(pages.city, /parseGeoCityParam\(route\.city\) \?\? notFound\(\)/u);
  assert.match(pages.city, /geo\.groups\.find\(\(entry\) => entry\.key === city\.key\) \?\? notFound\(\)/u);
  assert.match(pages.city, /hasNoQuery\(query\)\) notFound\(\)/u);
});

test("данные только через сотрудническое чтение каталога, не через читателя студента", () => {
  const all = [...Object.values(pages), source].join("\n");
  assert.doesNotMatch(all, /readStudentUniversit|student_university|university-index-source|requireStudentPortalActor/u);
  assert.match(source, /readStaffUniversityCatalogue\(actor, \{ \.\.\.EMPTY_UNIVERSITY_FILTERS, country \}\)/u);
  assert.match(source, /catalogue\.kind !== "complete"\) throw/u);
  // Справочник городов читают все с `catalog.read` (354), его сбой не прячется группировкой по подписям.
  assert.match(source, /readStaffCatalogGeographyBrowse\(actor\)/u);
  assert.doesNotMatch(source, /readStaffCatalogGeography\(|\.catch\(/u, "прежний читатель редактора не нужен, сбой справочника не глотается");
  const reader = read("src/lib/v3/catalog-geography-source.ts");
  assert.match(reader, /staffHasPermission\(actor, "catalog\.read"\)[\s\S]*staff_catalog_geography_read_v1/u);
});

test("карта грузится только в браузере и не тянет portal.css и тёмную тему", () => {
  const map = read("src/components/staff/universities/geo/UniversityGeoMap.tsx");
  const canvas = read("src/components/staff/universities/geo/UniversityGeoMapCanvas.tsx");
  assert.match(map, /^"use client"/u);
  assert.match(map, /import\("\.\/UniversityGeoMapCanvas"\)/u);
  assert.doesNotMatch(pages.country, /UniversityGeoMapCanvas|maplibre-gl/u, "холст не входит в серверную страницу");
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//gu, "");
  for (const text of [map, canvas]) assert.doesNotMatch(code(text), /portal\.css|pt-map|data-theme|readDocumentTheme|styles\/dark/u);
  assert.match(canvas, /maplibreWorkerUrl/u);
  assert.match(canvas, /tiles\.openfreemap\.org\/styles\/positron/u);
});

test("таблица «Все вузы» остаётся и получает вкладки без изменения фильтров", () => {
  const list = read("src/components/staff/universities-next/UniversitiesListNext.tsx");
  assert.match(list, /tabs=\{<UniversityGeoTabs current="all" \/>\}/u);
  assert.match(list, /<ListSearch action="\/universities"/u);
  const tabs = read("src/components/staff/universities-next/UniversityGeoTabs.tsx");
  assert.match(tabs, /href: "\/universities"/u);
  assert.match(tabs, /href: "\/universities\/country"/u);
});
