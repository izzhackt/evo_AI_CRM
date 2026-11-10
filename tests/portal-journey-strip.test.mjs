import assert from "node:assert/strict";
import test from "node:test";

import { selectCountryTimeline, timelineStepProgress, todayForTimeline } from "../src/lib/portal/country-timeline.ts";
import { PORTAL_DICTIONARIES } from "../src/lib/portal/i18n.ts";
import { journeyStrip } from "../src/lib/portal/journey-strip.ts";

// Полоса «Шаг N из M» на «Главной» (10.11.2026): счёт по шагам пути страны, один код для веба и iPhone.
const NOW = new Date("2026-11-10T08:00:00Z");
const STAGES = ["intake", "profile_and_route", "documents", "applications", "decisions", "visa_and_predeparture", "arrival_and_adaptation"];
const view = (country) => selectCountryTimeline(country, { locale: "ru", today: todayForTimeline(NOW) });
const strip = (country, stage, board) => {
  const v = view(country);
  return journeyStrip(v.steps, timelineStepProgress(v.steps, stage, board), stage);
};

test("the strip number and next step come from the same current step the «Путь» card marks (all countries)", () => {
  for (const country of ["CN", "MY", "AE", "TR", "IT", "CZ", "UNDECIDED"]) {
    const v = view(country);
    for (const stage of STAGES) {
      const progress = timelineStepProgress(v.steps, stage);
      const result = journeyStrip(v.steps, progress, stage);
      const current = v.steps.find((s) => progress[s.id] === "current");
      if (current) {
        assert.equal(result.kind, "step", `${country} ${stage}`);
        assert.equal(result.n, current.order);
        assert.equal(result.title, current.title);
        assert.equal(result.total, v.steps.length);
      } else {
        assert.equal(result.kind, "complete");
      }
    }
  }
});

test("real country: Malaysia documents is step 2 of 7, next is the application step", () => {
  assert.deepEqual(strip("MY", "documents"), { kind: "step", n: 2, total: 7, title: "Договор и документы", nextTitle: "Подача в вуз, Offer Letter и первые платежи" });
});

test("Turkey: the optional scholarship step is counted in the total but never current or next", () => {
  const v = view("TR");
  const optional = v.steps.filter((s) => s.optional).map((s) => s.title);
  assert.ok(optional.length >= 1);
  for (const stage of STAGES) {
    const result = strip("TR", stage);
    assert.equal(result.total, v.steps.length);
    if (result.kind === "step") {
      assert.ok(!optional.includes(result.title), `${stage}: optional is not current`);
      assert.ok(!optional.includes(result.nextTitle), `${stage}: optional is not next`);
    }
  }
});

test("a board column missing from the path falls back to the step of its stage, same as the card", () => {
  const v = view("CN");
  const progress = timelineStepProgress(v.steps, "visa_and_predeparture", "predeparture");
  assert.equal(strip("CN", "visa_and_predeparture", "predeparture").n, v.steps.find((s) => progress[s.id] === "current").order);
});

test("Kyrgyz strings exist for the strip and the chat button", () => {
  for (const key of ["stripStep", "stripNext", "stripDone", "writeAction"]) {
    assert.ok(PORTAL_DICTIONARIES.home.ru[key] && PORTAL_DICTIONARIES.home.ky[key], key);
  }
});

// Поведение чистой функции на синтетических шагах, независимо от файлов стран.
const step = (order, stageKeys, optional) => ({ id: `s${order}`, order, title: `T${order}`, stageKeys, ...(optional ? { optional: true } : {}) });
const STEPS = [step(1, ["intake"]), step(2, ["documents"]), step(3, ["applications"], true), step(4, ["decisions"])];
const run = (stage) => journeyStrip(STEPS, timelineStepProgress(STEPS, stage), stage);

test("journeyStrip: optional step is counted but never current or next (synthetic)", () => {
  // optional step 3 sits between 2 and 4: from step 2 the next regular step is 4
  assert.deepEqual(run("documents"), { kind: "step", n: 2, total: 4, title: "T2", nextTitle: "T4" });
  // the stage of the optional step itself lands on the next regular step, never on the optional one
  assert.deepEqual(run("applications"), { kind: "step", n: 4, total: 4, title: "T4", nextTitle: null });
});

test("journeyStrip: last step has no next", () => {
  assert.deepEqual(run("decisions"), { kind: "step", n: 4, total: 4, title: "T4", nextTitle: null });
});

test("journeyStrip: completed and closed are done, explicitly and with whitespace", () => {
  for (const stage of ["completed", "closed", " completed "]) assert.deepEqual(journeyStrip(STEPS, null, stage), { kind: "complete", total: 4 });
});

test("journeyStrip: unknown or missing stage and no progress give no strip", () => {
  for (const stage of ["something_custom", "contract_confirmed", "", null, undefined]) assert.equal(run(stage), null, String(stage));
  assert.equal(journeyStrip(STEPS, null, null), null);
  assert.equal(journeyStrip([], null, "completed"), null);
});

test("journeyStrip: a stage past the last step means done", () => {
  const short = [step(1, ["intake"]), step(2, ["documents"])];
  const stage = "arrival_and_adaptation";
  assert.deepEqual(journeyStrip(short, timelineStepProgress(short, stage), stage), { kind: "complete", total: 2 });
});
