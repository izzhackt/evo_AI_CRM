import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHash } from "node:crypto";
import { planImport } from "../scripts/catalog/import-catalog-costs.mjs";
import { ORGANIZATION_ID } from "../scripts/catalog/malaysia-universities-sql.mjs";
import { EXISTING_CITY_KEYS } from "../scripts/catalog/china-2026-11-build.mjs";
import { CARD_NOTES, MERGE_NOTE, WORKSHEET_DATE, lettersOnly } from "../scripts/catalog/china-2026-11-lib.mjs";
import { buildSql } from "../scripts/catalog/china-universities-sql.mjs";
import { parseUniversityContent } from "../src/lib/platform-university-catalog.ts";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const cards = read("src/lib/server/university-catalog-reviewed-china.json");
const costs = read("scripts/catalog/data/china-2026-11/programme-costs.json");
const links = read("scripts/catalog/data/china-2026-11/city-links.json");
const trace = read("scripts/catalog/data/china-2026-11/programme-trace.json");

// The 47 cards that were published before this import (19.11.2026); they stay first, in this order, with their own fields.
const ORIGINAL_KEYS = ["xjtlu", "unnc", "scut", "zjut", "gdut", "upc-east-china", "ecust", "beijing-institute-of-technology-zhuhai-bit-zhuhai",
  "beijing-normal-university", "fudan-university", "hangzhou-normal-university-hznu", "harbin-institute-of-technology-hit",
  "huazhong-university-of-science-and-technology-hust", "nanjing-university", "ocean-university-of-china-ouc", "peking-university",
  "shanghai-jiao-tong-university", "tsinghua-university", "university-of-electronic-science-and-technology-of-china-uestc",
  "university-of-science-and-technology-of-china-ustc", "wuhan-university", "zhejiang-university", "beijing-language-and-culture-university",
  "guangdong-university-of-foreign-studies", "guangzhou-huashang-vocational-college", "east-china-normal-university", "shanghai-university",
  "shanghai-normal-university", "shanghai-international-studies-university", "university-of-shanghai-for-science-and-technology",
  "tongji-university", "communication-university-of-zhejiang", "zhejiang-international-studies-university", "zhejiang-gongshang-university",
  "hubei-university-of-arts-and-science", "yibin-university", "southwest-university", "china-jiliang-university", "hangzhou-city-university",
  "chang-an-university", "xi-an-international-studies-university", "xidian-university", "nanchang-university", "zhejiang-sci-tech-university",
  "southwestern-university-of-finance-and-economics", "northwestern-polytechnical-university", "shenyang-aerospace-university"];
const ORIGINAL_PROGRAMMES = 94;
const PROVENANCE = "рабочей таблицы EVO";
const isWorksheetProgramme = (program) => program.summary.includes(PROVENANCE);

test("China 2026-11: the 47 earlier cards stay first and in order; no name or key repeats", () => {
  assert.ok(cards.length > 47);
  assert.deepEqual(cards.slice(0, 47).map((card) => card.key), ORIGINAL_KEYS);
  assert.equal(new Set(cards.map((card) => card.key)).size, cards.length);
  assert.equal(new Set(cards.map((card) => card.content.name.toLowerCase().replace(/\s+/gu, " "))).size, cards.length, "names are unique identities");
  const oldProgrammes = cards.flatMap((card) => card.content.programs).filter((program) => !isWorksheetProgramme(program));
  assert.equal(oldProgrammes.length, ORIGINAL_PROGRAMMES, "no earlier programme was removed or rewritten into a table programme");
});

test("China 2026-11: card keys stay unique across all six reviewed files (the Admin batch screen throws on a repeat)", () => {
  const others = ["malaysia", "europe", "turkey", "international", "other"].flatMap((region) => read(`src/lib/server/university-catalog-reviewed-${region}.json`));
  const taken = new Set(others.map((card) => card.key));
  for (const card of cards) assert.ok(!taken.has(card.key), `${card.key}: also a key of another reviewed file`);
  const names = new Set(others.map((card) => `${card.content.country}:${card.content.name.toLowerCase().replace(/\s+/gu, " ")}`));
  for (const card of cards) assert.ok(!names.has(`CN:${card.content.name.toLowerCase().replace(/\s+/gu, " ")}`), `${card.key}: name repeats another file`);
});

test("China 2026-11: every card has the exact reviewed-content shape and valid programmes", () => {
  for (const card of cards) {
    assert.deepEqual(parseUniversityContent(card.content), card.content, card.key);
    assert.equal(card.content.country, "CN", card.key);
    const programs = card.content.programs;
    assert.ok(programs.length >= 1 && programs.length <= 300, card.key);
    assert.equal(new Set(programs.map((program) => program.id)).size, programs.length, `${card.key}: programme ids`);
    for (const program of programs) assert.match(program.id, /^[a-z0-9][a-z0-9-]{0,63}$/u, `${card.key}/${program.id}`);
  }
});

test("China 2026-11: new cards state the worksheet provenance, promise nothing and carry no photo yet", () => {
  const fresh = cards.slice(47).filter((card) => card.content.notes === CARD_NOTES);
  assert.ok(fresh.length >= 100, "a hundred and more new universities");
  assert.equal(fresh.length, cards.length - 47, "every new card carries the standard notes");
  for (const card of fresh) {
    assert.equal(card.content.photoKey, null, `${card.key}: no photo in this slice`);
    assert.ok(card.content.overview.length <= 1200 && card.content.overview.length > 60, card.key);
    assert.match(card.content.websiteUrl, /^https:\/\//u, card.key);
    assert.doesNotMatch(card.content.overview, /гарант|лучш|ведущ|престижн|топ-/iu, `${card.key}: no superlatives or guarantees`);
    assert.doesNotMatch(card.content.overview, /[–—]/u, `${card.key}: no long or medium dash in the card text`);
    for (const program of card.content.programs) {
      assert.equal(program.level, "bachelor", `${card.key}/${program.id}`);
      assert.ok(isWorksheetProgramme(program), `${card.key}/${program.id}: provenance in the summary`);
      assert.equal(program.sourceUrl, card.content.sourceUrl, `${card.key}/${program.id}`);
      assert.doesNotMatch(program.summary, /гарант|бесплатн|полная стипенд|full scholarship/iu, `${card.key}/${program.id}`);
      assert.equal(program.title, program.title.trim());
      assert.doesNotMatch(program.title, /[一-鿿]/u, `${card.key}/${program.id}: no Chinese characters in the title`);
    }
  }
});

test("China 2026-11: every table intake is a month label with unknown status, dated by the worksheet, never an invented date", () => {
  for (const card of cards) {
    for (const program of card.content.programs.filter(isWorksheetProgramme)) {
      for (const intake of program.intakes) {
        assert.equal(intake.status, "unknown", `${card.key}/${program.id}: ${intake.status}`);
        assert.equal(intake.verifiedOn, WORKSHEET_DATE, `${card.key}/${program.id}`);
        assert.ok(intake.startDate === null && intake.startMonth === null && intake.applicationDeadline === null && intake.deadlineTime === null && intake.timezone === null, `${card.key}/${program.id}`);
        assert.match(intake.label, /^(Март|Сентябрь|Октябрь|В течение года) \(по таблице EVO\)$/u, `${card.key}/${program.id}`);
        assert.equal(intake.sourceUrl, program.sourceUrl);
      }
    }
  }
});

test("China 2026-11: the public repository carries no partner codes, process notes or Chinese text from the worksheet", () => {
  const text = JSON.stringify([cards.slice(47), costs, links, trace]);
  assert.doesNotMatch(text, /\bSW[A-Z]{3,}\s*-\s*0?\d\b/u, "no partner ID");
  assert.doesNotMatch(text, /wechat|微信|JW202|预录取/iu);
  assert.doesNotMatch(JSON.stringify(cards.slice(47).map((card) => card.content.programs)), /[一-鿿]/u);
});

test("China 2026-11: cost rows are EVO-document rows the sanctioned importer accepts, one per key, for cards of this file", () => {
  assert.ok(costs.rows.length > 100);
  const names = new Set(cards.map((card) => card.content.name));
  const keys = new Set();
  for (const row of costs.rows) {
    assert.ok(!keys.has(row.importKey), row.importKey);
    keys.add(row.importKey);
    assert.match(row.importKey, /^cn26:[a-z0-9-]+:(tuition|accommodation|application_fee|insurance):(all|en|zh)$/u);
    assert.equal(row.country, "CN");
    assert.equal(row.currency, "CNY");
    assert.equal(row.sourceKind, "evo_document");
    assert.equal(row.verifiedOn, WORKSHEET_DATE);
    assert.equal(row.academicYear, "2026/27");
    assert.equal(row.publish, true);
    assert.ok(names.has(row.institutionName), row.institutionName);
    assert.ok(Number(row.amountMin) > 0 && Number(row.amountMin) < 500000, row.importKey);
    assert.ok(row.amountMax === undefined || Number(row.amountMax) > Number(row.amountMin), row.importKey);
    assert.ok(!("sourceUrl" in row) && !("noteRu" in row) && !("confirmation" in row), row.importKey);
  }
  const plan = planImport(costs, { fileSha256: "0".repeat(64), organizationId: ORGANIZATION_ID, today: "2026-11-19" });
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.summary.rows, costs.rows.length);
  assert.equal(plan.summary.agencyUnconfirmed, 0);
});

test("China 2026-11: city links name only cities that already exist as published cards, for cards of this file", () => {
  const keys = new Set(cards.map((card) => card.key));
  for (const [key, city] of Object.entries(links)) {
    assert.ok(keys.has(key) && !ORIGINAL_KEYS.includes(key), `${key}: a new card`);
    assert.ok(EXISTING_CITY_KEYS.includes(city), `${key}: ${city} is a published Chinese city`);
  }
  assert.ok(Object.keys(links).length >= 20);
});

test("China 2026-11: the trace points every table programme at Excel rows and lists no raw worksheet text", () => {
  const byCard = new Map();
  for (const entry of trace) {
    assert.deepEqual(Object.keys(entry).sort(), ["card", "programId", "rows"]);
    assert.ok(entry.rows.length >= 1 && entry.rows.every((row) => Number.isInteger(row) && row >= 2 && row <= 1583), JSON.stringify(entry));
    byCard.set(entry.card, [...(byCard.get(entry.card) ?? []), entry.programId]);
  }
  for (const card of cards) {
    const expected = card.content.programs.filter(isWorksheetProgramme).map((program) => program.id);
    assert.deepEqual((byCard.get(card.key) ?? []).sort(), expected.sort(), `${card.key}: trace covers every table programme`);
  }
  assert.ok(trace.reduce((sum, entry) => sum + entry.rows.length, 0) > 1400, "most of the 1 582 rows are accounted for");
});

test("China 2026-11: the SQL generator rolls back by default, writes only through the Admin RPCs and guards updates", () => {
  const dry = buildSql();
  assert.equal(dry.cards, cards.length);
  assert.equal(dry.costRows, costs.rows.length);
  assert.match(dry.sql, /\nROLLBACK;\n$/u);
  assert.doesNotMatch(dry.sql, /\nCOMMIT;/u);
  for (const call of ["stage_university_catalog_publication", "review_university_catalog_publication", "staff_catalog_cost_import_v1", "staff_catalog_institution_city_set_v1"]) {
    assert.match(dry.sql, new RegExp(call, "u"));
  }
  assert.doesNotMatch(dry.sql, /\b(INSERT INTO|UPDATE|DELETE FROM)\s+platform(_private)?\./u, "no direct writes to the catalogue tables");
  assert.match(dry.sql, /refusing a non-additive update/u);
  assert.match(dry.sql, /immutable_fields CONSTANT TEXT\[\] := ARRAY\['name','country','city','overview','websiteUrl','sourceUrl','verifiedOn','photoKey'\]/u, "the verification date is protected");
  assert.ok(dry.sql.includes(MERGE_NOTE), "the only note growth the guard accepts is the merge note");
  assert.match(buildSql({ commit: true }).sql, /\nCOMMIT;\n$/u);
  assert.throws(() => buildSql({ actorMembership: "not-a-uuid" }), /UUID/u);
  const pilot = buildSql({ only: [cards[47].key] });
  assert.equal(pilot.cards, 1);
  assert.ok(pilot.costRows <= costs.rows.length);
  assert.throws(() => buildSql({ only: ["no-such-card"] }), /unknown card/u);
  assert.equal(lettersOnly("A-b c"), "abc");
});

test("China 2026-11: the cost request id comes from the rows themselves, so an edited file never reuses an identifier", () => {
  const plan = planImport(costs, { fileSha256: "0".repeat(64), organizationId: ORGANIZATION_ID, today: "2026-11-19" });
  const rows = plan.batches.flatMap((batch) => batch.p_rows);
  const expected = createHash("sha256").update("evo-cn-2611:costs:").update(JSON.stringify(rows)).digest("hex");
  assert.ok(buildSql().sql.includes(`md5('${expected}')`));
  assert.ok(!buildSql({ only: [cards[47].key] }).sql.includes(`md5('${expected}')`), "a pilot run uses its own identifier");
});

test("China 2026-11: no overview carries a status label or a ranking word", () => {
  for (const card of cards.slice(47)) {
    assert.doesNotMatch(card.content.overview, /Double\s*First|(?<!\d)(?:211|985)(?!\d)/iu, card.key);
  }
});
