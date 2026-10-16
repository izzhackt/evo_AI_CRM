/**
 * Паритет «Пути поступления» веба и iPhone (S4, план §8.5 п. 4; контракт
 * docs/portal/country-timeline-contract.md §3).
 *
 * Считает выдачу `selectCountryTimeline` веба для каждого выбора (шесть
 * стран и UNDECIDED), обоих языков и двух дат (до и после validUntil), плюс
 * Китай с маршрутом модуля CSCA, и пишет отпечатки SHA-256 в
 * ios/EVOAdmissionsTests/Fixtures/country-timeline-parity.json.
 * `CountryTimelineTests` на iPhone считает те же отпечатки своим портом
 * выбора из тех же файлов bundle и сравнивает. Отпечаток строится из всех
 * полей выдачи, соединённых U+001F (null это U+0000), так что любое
 * расхождение текста, порядка, ссылки или флага видно.
 *
 * После правки src/content/timelines/*.json:
 *   node --experimental-strip-types scripts/portal/write-country-timeline-ios-parity.mjs
 * Проверка без записи (код выхода 1, если файл устарел):
 *   node --experimental-strip-types scripts/portal/write-country-timeline-ios-parity.mjs --check
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { COUNTRY_TIMELINES, TIMELINE_UNDECIDED, selectCountryTimeline } from "../../src/lib/portal/country-timeline.ts";
import { STUDY_COUNTRY_CODES } from "../../src/lib/study-countries.ts";

const OUTPUT = new URL("../../ios/EVOAdmissionsTests/Fixtures/country-timeline-parity.json", import.meta.url);
const NUL = "\u0000";
const SEP = "\u001f";
const DATES = ["2026-10-16", "2027-11-01"];
const CSCA_MODULE = { csca: "evo-app://csca" };

const n = (value) => (value === null ? NUL : value);
const flag = (value) => (value ? "1" : "0");

/** Все поля выдачи по порядку; тот же порядок в CountryTimelineTests.swift. */
export function canonicalTimelineView(view) {
  return [
    view.choice, view.kind, n(view.countryCode), n(view.countryName), view.file, String(view.contentVersion),
    flag(view.datesHidden), view.intake.label, n(view.intake.note), String(view.steps.length),
    ...view.steps.flatMap((step) => [
      step.id, String(step.order), step.stageKeys.join(","), step.title, step.summary, n(step.timing), n(step.note),
      step.doneWhen, String(step.items.length),
      ...step.items.flatMap((item) => [item.id, item.who, item.whoLabel, item.text, n(item.note), n(item.appliesTo)]),
      String(step.links.length),
      ...step.links.flatMap((link) => [link.id, link.label, link.href, flag(link.external)]),
    ]),
    ...view.disclaimers, flag(view.kyNeedsProofreading),
  ].join(SEP);
}

function parityFixture() {
  const cases = [];
  const add = (choice, locale, today, modules) => {
    const view = selectCountryTimeline(choice, { locale, today, ...(modules ? { modules } : {}) });
    cases.push({
      choice, locale, today, modules: modules ?? null,
      kind: view.kind, file: view.file,
      steps: view.steps.length,
      items: view.steps.reduce((sum, step) => sum + step.items.length, 0),
      sha256: createHash("sha256").update(canonicalTimelineView(view), "utf8").digest("hex"),
    });
  };
  for (const choice of [...STUDY_COUNTRY_CODES, TIMELINE_UNDECIDED]) {
    for (const locale of ["ru", "ky"]) for (const today of DATES) add(choice, locale, today);
  }
  for (const locale of ["ru", "ky"]) add("CN", locale, DATES[0], CSCA_MODULE);
  return {
    generatedBy: "scripts/portal/write-country-timeline-ios-parity.mjs",
    contentVersions: Object.fromEntries(Object.entries(COUNTRY_TIMELINES).map(([key, file]) => [key, file.contentVersion])),
    cases,
  };
}

const text = `${JSON.stringify(parityFixture(), null, 2)}\n`;
if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(OUTPUT, "utf8"); } catch { /* нет файла: устарел */ }
  if (current !== text) {
    console.error("country-timeline-parity.json is stale: run this script without --check");
    process.exit(1);
  }
  console.log("country-timeline-parity.json is current");
} else {
  writeFileSync(OUTPUT, text);
  console.log(`wrote ${OUTPUT.pathname}`);
}
