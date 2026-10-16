import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import * as source from "../src/lib/study-countries.ts";
import * as anketa from "../src/lib/student-application-contract.ts";
import { countryLabel, localizedCountryLabel } from "../src/lib/student-application-presentation.ts";
import { PLATFORM_APPLICATION_COUNTRIES, isPlatformApplicationCountryCode } from "../src/lib/platform-application-contract.ts";
import { WEBSITE_ENQUIRY_COUNTRIES, WEBSITE_ENQUIRY_LEGACY_COUNTRIES } from "../src/lib/website-enquiry-contract.ts";
import { isStudentUniversityCountryFilter, universityCountryFilterOptions, universityCountryLabel } from "../src/lib/portal/universities.ts";
import { countryCodeFromSlug, resolveUniversitiesRoute } from "../src/lib/portal/university-index.ts";
import { country as crmCountry } from "../src/lib/v3/wording.ts";

// Один список стран продукта (решение владельца 16.10.2026, миграция 282).
const PRODUCT = ["CN", "MY", "AE", "TR", "IT", "CZ"];
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const json = JSON.parse(read("src/lib/study-countries.json"));
const migration = read("supabase/migrations/282_platform_single_country_list.sql");
const sqlArray = (name) => {
  const body = migration.match(new RegExp(`FUNCTION platform_private\\.${name}\\(\\)[\\s\\S]*?SELECT ARRAY\\[([^\\]]+)\\]`))[1];
  return body.split(",").map((value) => value.trim().replace(/^'|'$/g, ""));
};

test("the source file is the product list in product order, with RU and KY names", () => {
  assert.deepEqual(json.countries.map((row) => row.code), PRODUCT);
  assert.deepEqual(source.STUDY_COUNTRY_CODES, PRODUCT);
  assert.equal(source.STUDY_COUNTRY_UNDECIDED, "undecided");
  assert.deepEqual(source.studyCountryOptions("ru").map((o) => o.label), ["Китай", "Малайзия", "ОАЭ", "Турция", "Италия", "Чехия"]);
  assert.deepEqual(source.studyCountryOptions("ky").map((o) => o.label), ["Кытай", "Малайзия", "БАЭ", "Түркия", "Италия", "Чехия"]);
  assert.deepEqual(source.studyCountryOptions("ru", { undecided: true }).at(-1), { code: "undecided", label: "Пока не решил" });
  assert.equal(source.studyCountryName("undecided", "ky"), "Азырынча чече элекмин");
  assert.equal(source.studyCountryName("PL", "ru"), null);
  assert.equal(source.isStudyCountryCode("CZ"), true);
  assert.equal(source.isStudyCountryCode("undecided"), false);
  assert.equal(source.isStudyCountryCode("PL"), false);
  // No em or en dash in user-facing names.
  for (const row of [...json.countries, json.undecided]) assert.doesNotMatch(row.ru + row.ky, /[–—]/u);
});

test("the database list of 282 is the same file: codes and website values", () => {
  assert.deepEqual(sqlArray("study_country_codes"), PRODUCT);
  assert.deepEqual(sqlArray("website_enquiry_country_values"), [...json.countries.map((row) => row.website), json.undecided.website]);
  assert.deepEqual(sqlArray("website_enquiry_legacy_country_values"), [...WEBSITE_ENQUIRY_LEGACY_COUNTRIES]);
  assert.deepEqual(source.WEBSITE_STUDY_COUNTRY_VALUES, ["China", "Malaysia", "United Arab Emirates", "Turkey", "Italy", "Czechia", "Undecided"]);
  assert.equal(source.studyCountryFromWebsiteValue("Czechia"), "CZ");
  assert.equal(source.studyCountryFromWebsiteValue("Undecided"), "undecided");
  assert.equal(source.studyCountryFromWebsiteValue("Poland"), null);
});

test("the website receiver keeps accepting the new and the legacy site values (plan §6.4)", () => {
  // The 240 list, unchanged: the new form list is a subset, the rest is legacy.
  assert.deepEqual([...WEBSITE_ENQUIRY_COUNTRIES].sort(), ["Austria", "China", "Cyprus", "Czechia", "Europe", "France", "Germany",
    "Italy", "Malaysia", "Netherlands", "Poland", "Turkey", "Undecided", "United Arab Emirates", "United Kingdom"]);
  for (const value of source.WEBSITE_STUDY_COUNTRY_VALUES) assert.ok(WEBSITE_ENQUIRY_COUNTRIES.has(value), value);
  assert.equal(WEBSITE_ENQUIRY_LEGACY_COUNTRIES.some((value) => source.WEBSITE_STUDY_COUNTRY_VALUES.includes(value)), false);
  assert.match(migration, /p_country=ANY\(platform_private\.website_enquiry_country_values\(\)\)/);
  assert.match(migration, /p_country=ANY\(platform_private\.website_enquiry_legacy_country_values\(\)\)/);
});

test("staff forms and the program preparation read the same list", () => {
  assert.deepEqual(PLATFORM_APPLICATION_COUNTRIES, PRODUCT);
  assert.equal(isPlatformApplicationCountryCode("IT"), true);
  assert.equal(isPlatformApplicationCountryCode("PL"), false);
  assert.deepEqual(PRODUCT.map((code) => crmCountry(code)), ["Китай", "Малайзия", "ОАЭ", "Турция", "Италия", "Чехия"]);
  assert.equal(crmCountry("PL"), null);
  // The six-country literals of 118/190/214 match the source.
  for (const file of ["118_platform_university_application_geography.sql", "190_platform_application_author_and_optional_program.sql",
    "214_platform_catalog_preparation.sql"]) {
    const sql = read(`supabase/migrations/${file}`);
    for (const literal of sql.match(/\('CN', ?'MY'[^)]*\)/g) ?? []) {
      assert.deepEqual(literal.slice(1, -1).split(",").map((value) => value.trim().replace(/'/g, "")), PRODUCT, `${file}: ${literal}`);
    }
  }
});

test("the student catalogue filter is the six countries, not the 249-region menu", () => {
  assert.deepEqual(universityCountryFilterOptions("ru"), PRODUCT.map((code) => ({ code, label: source.studyCountryName(code, "ru") })));
  assert.deepEqual(universityCountryFilterOptions("ky").map((o) => o.label), ["Кытай", "Малайзия", "БАЭ", "Түркия", "Италия", "Чехия"]);
  assert.equal(isStudentUniversityCountryFilter(""), true);
  assert.equal(isStudentUniversityCountryFilter("CZ"), true);
  assert.equal(isStudentUniversityCountryFilter("PL"), false);
  // A favourite or history row of a country outside the list still has a name.
  assert.equal(universityCountryLabel("PL", "ru"), "Польша");
  assert.equal(universityCountryLabel("AE", "ru"), "ОАЭ");
  assert.doesNotMatch(read("src/lib/platform-university-catalog.ts"), /UNIVERSITY_COUNTRIES/);
  assert.doesNotMatch(read("src/components/portal/universities/Catalog.tsx"), /UNIVERSITY_COUNTRIES|localeCompare/);
  // S3: страна в адресе — только из шести (иначе 404), прежний ?country= другой страны — тоже 404.
  assert.equal(countryCodeFromSlug("cz"), "CZ");
  assert.equal(countryCodeFromSlug("pl"), null);
  assert.equal(resolveUniversitiesRoute({ country: "PL" }).kind, "invalid");
  assert.match(read("src/app/(portal)/portal/universities/page.tsx"), /if \(route\.kind === "invalid"\) notFound\(\);/);
  assert.match(read("src/app/(portal)/portal/universities/country/[code]/page.tsx"), /countryCodeFromSlug\(route\.code\) \?\? notFound\(\)/);
});

function draft(destinationCountries) {
  return { schemaVersion: 1, requestId: "10000000-0000-4000-8000-000000000282", firstName: "Тест", lastName: "Страны", phone: "+996555000282",
    destinationCountries, intakeSeason: "autumn", intakeYear: 2027, educationLevel: "high_school", averageGrade: 4.5, gradeScale: "5",
    studyFields: ["Инженерия"], studyLevels: ["bachelor"], nationality: "KG", english: { mode: "self", level: "beginner" },
    tuitionBudget: "under_5000", fundingSource: "family", consent: true, consentVersion: anketa.STUDENT_APPLICATION_CONSENT_VERSION };
}

test("the анкета offers the product countries and «Пока не решил»; the server keeps accepting the legacy codes", () => {
  assert.deepEqual(anketa.STUDENT_APPLICATION_COUNTRIES, [...PRODUCT, "undecided"]);
  assert.deepEqual(anketa.STUDENT_APPLICATION_LEGACY_COUNTRIES, ["DE", "FR", "ES", "NL", "PL", "HU", "AT", "GB", "CY"]);
  // What the wizard offers (web and iPhone 1.1): the product list only.
  assert.equal(anketa.isStudentApplicationCountry("undecided"), true);
  assert.equal(anketa.isStudentApplicationCountry("IT"), true);
  assert.equal(anketa.isStudentApplicationCountry("PL"), false);
  // What a submission may carry (plan §4.1, §6.6 item 2): old iPhone builds,
  // a tab opened before the release and a saved draft still send DE, PL, GB.
  for (const ok of [["CN"], ["IT", "CZ", "AE"], ["undecided"], ["DE"], ["PL", "CN"], ["GB", "CN"], ["DE", "CZ"]]) {
    assert.ok(anketa.validateStudentApplicationDraft(draft(ok)), ok.join(","));
  }
  for (const bad of [["CN", "undecided"], ["PL", "undecided"], ["undecided", "undecided"], ["US"], ["Poland"], []]) {
    assert.equal(anketa.validateStudentApplicationDraft(draft(bad)), null, bad.join(","));
  }
  assert.equal(anketa.studentApplicationCountryDirection("IT"), "EUROPE");
  assert.equal(anketa.studentApplicationCountryDirection("PL"), "EUROPE");
  assert.equal(anketa.studentApplicationCountryDirection("TR"), "TR");
  assert.equal(anketa.studentApplicationCountryDirection("undecided"), null);
  assert.equal(countryLabel("undecided"), "Пока не решил");
  assert.equal(localizedCountryLabel("CN", "ky"), "Кытай");
  assert.equal(countryLabel("PL"), "Польша");
  // The SQL CHECK widens (legacy codes + undecided alone); 282 does not touch
  // submit_student_application_v1, which validates by that CHECK.
  assert.match(migration, /'TR','AE','undecided'\)\n  OR \(item#>>'\{\}'='undecided' AND jsonb_array_length\(q->'destinationCountries'\)<>1\)/);
  assert.doesNotMatch(migration, /a282_replace\('platform\.submit_student_application_v1/);
  // The wizard drops a country that left the list from a restored draft.
  const wizard = read("src/components/student-application/ApplicationWizard.tsx");
  assert.match(wizard, /destinationCountries: currentDestinations\(draft\?\.destinationCountries \?\? \[\]\)/);
  assert.match(wizard, /values\.destinationCountries = currentDestinations\(values\.destinationCountries\);/);
});

test("the iPhone app bundles the same file and keeps no copy of the list", () => {
  const project = read("ios/project.yml");
  assert.equal(project.match(/- path: \.\.\/src\/lib\/study-countries\.json\n\s+buildPhase: resources/g)?.length, 2);
  assert.match(project, /- path: EVOAdmissions\/Services\/StudyCountries\.swift/);
  const swift = readdirSync(new URL("../ios/EVOAdmissions", import.meta.url), { recursive: true })
    .filter((name) => String(name).endsWith(".swift"))
    .map((name) => [String(name), read(`ios/EVOAdmissions/${name}`)]);
  for (const [name, text] of swift) {
    assert.doesNotMatch(text, /"CN", "MY", "AE"/, name);
    assert.doesNotMatch(text, /"AD AE AF AG/, name);
  }
});
