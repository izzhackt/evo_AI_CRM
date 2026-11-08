import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { planImport } from "../scripts/catalog/import-catalog-costs.mjs";
import { ORGANIZATION_ID, buildSql } from "../scripts/catalog/malaysia-universities-sql.mjs";
import { parseUniversityContent } from "../src/lib/platform-university-catalog.ts";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const cards = read("src/lib/server/university-catalog-reviewed-malaysia.json");
const costs = read("scripts/catalog/data/malaysia-2026-11/programme-costs.json");
const links = read("scripts/catalog/data/malaysia-2026-11/city-links.json");
const byKey = (key) => cards.find((card) => card.key === key)?.content;
// Cities that exist as published cards in production (migration 283 seed); new Malaysian cards may only link to these.
const MALAYSIAN_CITY_KEYS = ["kuala-lumpur", "bandar-sunway", "cyberjaya", "johor-bahru", "nilai", "petaling-jaya", "sepang", "serdang", "shah-alam", "subang-jaya"];

test("Malaysia 2026-11: the 13 earlier cards stay and the requested universities are present", () => {
  assert.equal(cards.length, 21);
  assert.equal(new Set(cards.map((card) => card.key)).size, 21);
  for (const key of ["mmu", "ucsi", "sunway", "taylors", "inti", "apu", "utm", "upm", "um", "monash-malaysia", "unikl", "alfa", "iium",
    "city-malaysia", "xiamen-malaysia", "msu"]) assert.ok(byKey(key), key);
  for (const card of cards) {
    assert.equal(card.content.country, "MY", card.key);
    assert.deepEqual(parseUniversityContent(card.content), card.content, card.key);
    assert.ok(card.content.programs.length >= 1 && card.content.programs.length <= 300, card.key);
  }
  assert.equal(new Set(cards.map((card) => card.content.name.toLowerCase())).size, 21, "names are unique identities");
});

test("Malaysia 2026-11: foundation programmes are in the catalog for the requested universities and the colleges that teach them", () => {
  const foundation = (key) => byKey(key).programs.filter((program) => program.level === "foundation").length;
  for (const key of ["apu", "ucsi", "mmu", "inti", "unikl", "um", "iium", "alfa", "taylors-college", "sunway-college", "monash-malaysia", "upm", "utm"]) {
    assert.ok(foundation(key) >= 1, `${key}: foundation`);
  }
  // Taylor’s University and Sunway University list no foundation themselves: their colleges are separate cards.
  assert.equal(foundation("taylors"), 0);
  assert.equal(foundation("sunway"), 0);
  assert.ok(foundation("taylors-college") >= 7);
});

test("Malaysia 2026-11: every campus keeps its real city (INTI has no Kuala Lumpur campus on the official site)", () => {
  assert.equal(byKey("inti").city, "Nilai");
  assert.equal(byKey("inti-subang").city, "Subang Jaya");
  assert.equal(byKey("inti-penang").city, "Bayan Lepas, Penang");
  assert.equal(byKey("inti-sabah").city, "Kota Kinabalu");
  assert.equal(cards.filter((card) => /^INTI/u.test(card.content.name) && card.content.city === "Kuala Lumpur").length, 0);
  for (const [key, city] of Object.entries(links)) {
    assert.ok(byKey(key), `${key}: card exists`);
    assert.ok(MALAYSIAN_CITY_KEYS.includes(city), `${key}: city ${city} is a published Malaysian city`);
  }
});

test("Malaysia 2026-11: the earlier reviewed programmes keep their ids, levels and intake records", () => {
  const apu = byKey("apu").programs;
  assert.deepEqual(apu.slice(0, 3).map((program) => program.id), ["computer-science", "foundation-computing", "artificial-intelligence-msc"]);
  assert.equal(apu[1].intakes.find((intake) => intake.status === "needs_reconfirmation").startMonth, "2026-11");
  assert.equal(apu[1].intakes.find((intake) => intake.status === "announced").startDate, "2026-09-24");
  const utm = byKey("utm").programs;
  assert.deepEqual(utm.slice(0, 3).map((program) => program.id), ["software-engineering", "computer-networks-security", "graphics-multimedia"]);
});

test("Malaysia 2026-11: tuition rows are official, name an existing programme of the card at its level, and never repeat a key", () => {
  assert.ok(costs.rows.length > 1000);
  const keys = new Set();
  for (const row of costs.rows) {
    assert.ok(!keys.has(row.importKey), row.importKey);
    keys.add(row.importKey);
    assert.equal(row.sourceKind, "official", row.importKey);
    assert.equal(row.costKind, "tuition", row.importKey);
    assert.equal(row.country, "MY", row.importKey);
    assert.match(row.sourceUrl, /^https:\/\//u, row.importKey);
    assert.ok(!/easyuni|studymalaysia|edarabia/iu.test(row.sourceUrl), `${row.importKey}: no aggregator source`);
    const card = cards.find((entry) => entry.content.name === row.institutionName);
    assert.ok(card, `${row.importKey}: institution ${row.institutionName}`);
    const program = card.content.programs.find((entry) => entry.id === row.programId);
    assert.ok(program, `${row.importKey}: programme ${row.programId}`);
    assert.equal(program.level, row.studyLevel, `${row.importKey}: level`);
  }
});

test("Malaysia 2026-11: the cost file passes the sanctioned importer's own validation", () => {
  const plan = planImport(costs, { fileSha256: "0".repeat(64), organizationId: ORGANIZATION_ID, today: "2026-11-08" });
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.summary.rows, costs.rows.length);
  assert.equal(plan.summary.agencyUnconfirmed, 0);
  assert.equal(plan.batches.length, 1);
});

test("Malaysia 2026-11: the SQL generator rolls back by default, publishes with the Admin RPCs and refuses commit with the 350 simulation", () => {
  const dry = buildSql({ simulate350: true });
  assert.equal(dry.cards, 21);
  assert.equal(dry.costRows, costs.rows.length);
  assert.match(dry.sql, /\nROLLBACK;\n$/u);
  assert.doesNotMatch(dry.sql, /\nCOMMIT;/u);
  for (const call of ["stage_university_catalog_publication", "review_university_catalog_publication", "staff_catalog_cost_import_v1", "staff_catalog_institution_city_set_v1"]) {
    assert.match(dry.sql, new RegExp(call, "u"));
  }
  // No direct writes to the catalogue tables: everything goes through the RPCs.
  assert.doesNotMatch(dry.sql, /\b(INSERT INTO|UPDATE|DELETE FROM)\s+platform(_private)?\./u);
  assert.match(buildSql({ commit: true }).sql, /\nCOMMIT;\n$/u);
  assert.throws(() => buildSql({ commit: true, simulate350: true }), /dry runs only/u);
  assert.throws(() => buildSql({ actorMembership: "not-a-uuid" }), /UUID/u);
});
