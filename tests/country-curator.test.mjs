import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseCountryCurators, parseCountryCuratorSaved } from "../src/lib/country-curator-contract.ts";
import { parseSalesRegisterIntakeOptions } from "../src/lib/platform-sales-register-contract.ts";
import { salesCountryCurator, salesCountryDirection } from "../src/lib/sales-country-curator.ts";

// «Кураторы стран» (миграция 335): разбор ответов базы, страна → направление, подстановка в форме продажи.
const ORG = "33500000-0000-4000-8000-000000000001";
const CURATOR_CN = "33500000-0000-4000-8000-000000000301";
const CURATOR_MY = "33500000-0000-4000-8000-000000000302";
const LEAD = "33500000-0000-4000-8000-000000003001";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const curatorsRead = (overrides = {}) => ({
  schemaVersion: 1, organizationId: ORG,
  countries: [
    { direction: "CN", curatorId: CURATOR_CN, curatorLabel: "Куратор Китая", eligible: true, version: 1 },
    { direction: "MY", curatorId: null, curatorLabel: null, eligible: false, version: 0 },
  ],
  curators: [{ id: CURATOR_CN, label: "Куратор Китая" }, { id: CURATOR_MY, label: "Куратор Малайзии" }],
  ...overrides,
});

test("the setting read is parsed exactly: two countries in order CN, MY and the curators that may be chosen", () => {
  const parsed = parseCountryCurators(curatorsRead(), ORG);
  assert.equal(parsed?.countries.length, 2);
  assert.deepEqual(parsed?.countries.map((row) => [row.direction, row.curatorId, row.version]), [["CN", CURATOR_CN, 1], ["MY", null, 0]]);
  assert.equal(parsed?.curators.length, 2);
  assert.equal(parseCountryCurators(curatorsRead({ organizationId: "33500000-0000-4000-8000-000000000999" }), ORG), null, "another organization");
  assert.equal(parseCountryCurators(curatorsRead({ countries: curatorsRead().countries.slice().reverse() }), ORG), null, "order is fixed");
  assert.equal(parseCountryCurators({ ...curatorsRead(), extra: 1 }, ORG), null, "no unknown keys");
  assert.equal(parseCountryCurators(curatorsRead({ curators: [{ id: "not-a-uuid", label: "X" }] }), ORG), null, "ids are UUIDs");
});

test("the save receipt names the same organization and country", () => {
  assert.equal(parseCountryCuratorSaved({ status: "saved", organizationId: ORG, direction: "CN", version: 2 }, ORG, "CN"), "saved");
  assert.equal(parseCountryCuratorSaved({ status: "unchanged", organizationId: ORG, direction: "MY", version: 0 }, ORG, "MY"), "unchanged");
  assert.equal(parseCountryCuratorSaved({ status: "saved", organizationId: ORG, direction: "MY", version: 2 }, ORG, "CN"), null);
});

test("country words map to the two directions only", () => {
  for (const word of ["CN", "cn", "Китай", " китай ", "China", "Кытай"]) assert.equal(salesCountryDirection(word), "CN", word);
  for (const word of ["MY", "Малайзия", "malaysia"]) assert.equal(salesCountryDirection(word), "MY", word);
  for (const word of ["", null, undefined, "Турция", "AE", "undecided", "Китай и Малайзия"]) assert.equal(salesCountryDirection(word), null, String(word));
  assert.equal(salesCountryCurator({ CN: CURATOR_CN }, "CN"), CURATOR_CN);
  assert.equal(salesCountryCurator({ CN: CURATOR_CN }, "MY"), null, "no curator of Malaysia is set");
  assert.equal(salesCountryCurator({ CN: CURATOR_CN }, null), null);
});

test("the sales form read accepts the 174 and the v2 shape; a country curator outside the list is refused", () => {
  const base = { organization_id: ORG, curators: [{ id: CURATOR_CN, label: "Куратор Китая" }], leads: [{ id: LEAD, label: "Лид", phone: "", owner_id: CURATOR_CN }] };
  const old = parseSalesRegisterIntakeOptions(base, ORG);
  assert.deepEqual(old.countryCurators, {});
  assert.equal(old.leads[0].applicationCountry, null);
  const v2 = parseSalesRegisterIntakeOptions({ ...base, country_curators: { CN: CURATOR_CN, MY: null },
    leads: [{ ...base.leads[0], application_country: "MY" }] }, ORG);
  assert.deepEqual(v2.countryCurators, { CN: CURATOR_CN });
  assert.equal(v2.leads[0].applicationCountry, "MY");
  assert.throws(() => parseSalesRegisterIntakeOptions({ ...base, country_curators: { CN: CURATOR_MY, MY: null } }, ORG), "not in the curator list");
  assert.throws(() => parseSalesRegisterIntakeOptions({ ...base, country_curators: { CN: null } }, ORG), "both countries are present");
  // 339: a lead without an owner is found; the seller who saves the sale becomes its owner.
  const ownerless = parseSalesRegisterIntakeOptions({ ...base, leads: [{ ...base.leads[0], owner_id: null }] }, ORG);
  assert.equal(ownerless.leads[0].ownerId, null);
  assert.equal(old.leads[0].ownerId, CURATOR_CN);
  assert.throws(() => parseSalesRegisterIntakeOptions({ ...base, leads: [{ ...base.leads[0], owner_id: "not-a-uuid" }] }, ORG), "a broken owner is refused");
});

test("the form prefills the country from the анкета and the curator from the setting, never over a manual choice", () => {
  const form = read("src/components/staff/SalesRegisterForms.tsx");
  assert.match(form, /if \(recordId \|\| \(curatorId && !curatorAuto\)\) return;/u, "a manual choice stays");
  assert.match(form, /salesCountryCurator\(intakeOptions\?\.countryCurators \?\? \{\}, salesCountryDirection\(country\)\)/u);
  assert.match(form, /isStudyCountryCode\(applicationCountry\) \? studyCountryName\(applicationCountry, "ru"\)/u);
  assert.match(form, /else if \(!draft\.country\.trim\(\) \|\| countryAuto\) setAutoCountry\(applicationCountryName\);/u,
    "another lead replaces a country the form filled, a typed one stays");
  assert.match(form, /if \(key === "country"\) \{ setCountryAuto\(false\); autoCurator\(value\); \}/u, "typing makes the country manual");
  assert.match(form, /onChange=\{e => \{ setCuratorId\(e\.target\.value\); setCuratorAuto\(false\); \}\}/u);
  const source = read("src/lib/v3/sales-register-source.ts");
  assert.match(source, /rpc\("sales_register_intake_options_v2", args\)/u);
  assert.match(source, /error\.code === "PGRST202" \|\| error\.code === "42883"/u, "a database without 335 falls back to 174");
});
