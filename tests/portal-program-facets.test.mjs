import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  PROGRAMS_FIRST, programDuration, programFacets, programField, programMatches, programMonths, programYears, visiblePrograms,
} from "../src/lib/portal/program-facets.ts";

const intake = (label, extra = {}) => ({ label, startDate: null, startMonth: null, ...extra });

test("direction comes from the English title; unknown stays «other» instead of a guess", () => {
  assert.equal(programField("Bachelor of Computer Science"), "it");
  assert.equal(programField("Bachelor of Business and Commerce"), "business");
  assert.equal(programField("Digital Marketing"), "business");
  assert.equal(programField("Biomedical Engineering"), "medicine");
  assert.equal(programField("Bachelor of Laws (Honours)"), "law");
  assert.equal(programField("Diploma in Hotel Management"), "hospitality");
  assert.equal(programField("Master of Counselling"), "social");
  assert.equal(programField("Diploma of Prevention Studies"), "social");
  assert.equal(programField("Cambridge A Level"), "other");
});

test("start months come from intake dates and Russian month names in the intake label", () => {
  assert.deepEqual(programMonths({ intakes: [intake("Февраль / июль / октябрь")] }), [2, 7, 10]);
  assert.deepEqual(programMonths({ intakes: [intake("Набор 2026", { startDate: "2026-09-01" }), intake("Весна", { startMonth: "2027-03" })] }), [3, 9]);
  assert.deepEqual(programMonths({ intakes: [intake("Январь / май / август — Nilai"), intake("Май")] }), [1, 5, 8]);
  assert.deepEqual(programMonths({ intakes: [intake("Следующий набор — уточнить")] }), []);
  assert.deepEqual(programMonths({ intakes: [] }), []);
});

test("duration buckets read years, months, weeks and semesters; unreadable text stays null", () => {
  assert.equal(programYears("3 года"), 3);
  assert.equal(programYears("1,5 года"), 1.5);
  assert.equal(programYears("18 месяцев"), 1.5);
  assert.equal(programYears("4 года — минимум 8 семестров"), 4);
  assert.equal(programDuration("1 год"), "short");
  assert.equal(programDuration("2,5 года"), "two");
  assert.equal(programDuration("3,5 года"), "three");
  assert.equal(programDuration("5 лет"), "four");
  assert.equal(programDuration("по программе"), null);
  assert.equal(programDuration(null), null);
});

test("every real catalogue programme gets facets, and almost all get a real direction", () => {
  const dir = new URL("../src/lib/server/", import.meta.url);
  const programs = readdirSync(dir)
    .filter((name) => /^university-catalog-reviewed-(?!content\.json$).+\.json$/.test(name))
    .flatMap((name) => JSON.parse(readFileSync(new URL(name, dir), "utf8")))
    .flatMap((entry) => entry.content.programs);
  assert.ok(programs.length > 1000);
  const facets = programs.map(programFacets);
  assert.ok(facets.every((item) => item.months.every((month) => month >= 1 && month <= 12)));
  assert.ok(facets.filter((item) => item.field === "other").length / programs.length < 0.02);
});

test("unknown start month or duration never hides a programme; known values still filter", () => {
  const none = { level: "", field: "", month: "", duration: "" };
  const known = { level: "bachelor", field: "engineering", months: [2, 7, 10], duration: "four" };
  const unknown = { level: "bachelor", field: "engineering", months: [], duration: null };
  assert.equal(programMatches(known, none), true);
  assert.equal(programMatches(known, { ...none, month: "7", duration: "four" }), true);
  assert.equal(programMatches(known, { ...none, month: "9" }), false);
  assert.equal(programMatches(known, { ...none, duration: "two" }), false);
  assert.equal(programMatches(unknown, { ...none, month: "9", duration: "two" }), true);
  assert.equal(programMatches(unknown, { ...none, level: "master" }), false);
  assert.equal(programMatches(unknown, { ...none, field: "it" }), false);
});

test("without a filter only the first four cards show; any filter or «show all» shows every match", () => {
  const items = Array.from({ length: 10 }, (_, index) => index);
  assert.equal(PROGRAMS_FIRST, 4);
  assert.deepEqual(visiblePrograms(items, false, false), [0, 1, 2, 3]);
  assert.equal(visiblePrograms(items, true, false).length, 10);
  assert.equal(visiblePrograms(items, false, true).length, 10);
  assert.deepEqual(visiblePrograms([0, 1], false, false), [0, 1]);
});
