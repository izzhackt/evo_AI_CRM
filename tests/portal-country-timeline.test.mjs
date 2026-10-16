import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  ABSOLUTE_DATE,
  COUNTRY_TIMELINES,
  COUNTRY_TIMELINE_FILE_KEYS,
  FORBIDDEN_PROMISES,
  INTERNAL_MARKERS,
  TIMELINE_UNDECIDED,
  isTimelineChoice,
  parseCountryTimelineFile,
  selectCountryTimeline,
  todayForTimeline,
} from "../src/lib/portal/country-timeline.ts";
import { COUNTRY_CHOICE_VALUES, parseStudentCountryChoice } from "../src/lib/portal/country-choice.ts";
import { STUDY_COUNTRY_CODES, studyCountryName } from "../src/lib/study-countries.ts";

// «Путь поступления» на «Главной» (S4, план §8; контракт
// docs/portal/country-timeline-contract.md; миграция 284).
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const raw = (key) => JSON.parse(read(`src/content/timelines/${key}.json`));
const CHOICES = [...STUDY_COUNTRY_CODES, TIMELINE_UNDECIDED];
const BEFORE = "2026-10-16";
const AFTER = "2027-11-01";
const views = () => CHOICES.flatMap((choice) => ["ru", "ky"].flatMap((locale) => [BEFORE, AFTER].map((today) => ({
  choice, locale, today, view: selectCountryTimeline(choice, { locale, today }),
}))));
/** Every string the student sees in a view. */
const viewStrings = (view) => [
  view.countryName ?? "", view.intake.label, view.intake.note ?? "", ...view.disclaimers,
  ...view.steps.flatMap((step) => [step.title, step.summary, step.timing ?? "", step.note ?? "", step.doneWhen,
    ...step.items.flatMap((item) => [item.whoLabel, item.text, item.note ?? "", item.appliesTo ?? ""]),
    ...step.links.map((link) => link.label)]),
].filter(Boolean);
/** Every {ru, ky} object of a file outside the source registry, with its path. */
function l10nObjects(value, path = "$") {
  if (Array.isArray(value)) return value.flatMap((v, i) => l10nObjects(v, `${path}[${i}]`));
  if (typeof value !== "object" || value === null) return [];
  if ("ru" in value || "ky" in value) return [[path, value], ...("undated" in value && value.undated ? [[`${path}.undated`, value.undated]] : [])];
  return Object.entries(value).filter(([key]) => !(path === "$" && key === "sources"))
    .flatMap(([key, v]) => l10nObjects(v, `${path}.${key}`));
}

test("the content folder holds exactly the seven files and every file passes the strict schema", () => {
  const files = readdirSync(new URL("../src/content/timelines", import.meta.url)).filter((name) => name.endsWith(".json")).sort();
  assert.deepEqual(files, [...COUNTRY_TIMELINE_FILE_KEYS].map((key) => `${key}.json`).sort());
  assert.deepEqual(COUNTRY_TIMELINE_FILE_KEYS, ["cn", "my", "ae", "tr", "it", "cz", "undecided"]);
  for (const key of COUNTRY_TIMELINE_FILE_KEYS) {
    const file = parseCountryTimelineFile(raw(key), key);
    assert.equal(file.schemaVersion, 1, key);
    assert.ok(file.steps.length >= 5 && file.steps.length <= 8, key);
    if (key !== "undecided") assert.equal(file.name.ru, studyCountryName(file.country, "ru"), key);
  }
  // The general route: the 7 operational stages of the product, in order, without dates.
  const general = COUNTRY_TIMELINES.undecided;
  assert.deepEqual(general.steps.map((step) => step.stageKeys), [["intake"], ["profile_and_route"], ["documents"],
    ["applications"], ["decisions"], ["visa_and_predeparture"], ["arrival_and_adaptation"]]);
  assert.ok(general.steps.every((step) => step.timing === null));
  assert.equal(general.intake.model, "none");
  // Titles of the general route are the stage names of the cabinet (admission.stage.*).
  const i18n = read("src/lib/portal/i18n.ts");
  for (const step of general.steps) {
    const stage = step.stageKeys[0];
    assert.match(i18n, new RegExp(`"stage\\.${stage}": "${step.title.ru.toLowerCase()}"`), stage);
    assert.match(i18n, new RegExp(`"stage\\.${stage}": "${step.title.ky.toLowerCase()}"`), stage);
  }
});

test("the strict parser refuses drifted content", () => {
  const cn = raw("cn");
  const broken = (mutate) => { const copy = structuredClone(cn); mutate(copy); return () => parseCountryTimelineFile(copy, "cn"); };
  const cases = [
    [(c) => { c.extra = 1; }, /unknown key extra/],
    [(c) => { delete c.steps[0].title.ky; }, /missing ky/],
    [(c) => { c.steps[0].summary.ru = "Сроки \u2014 ориентир"; }, /em or en dash/],
    [(c) => { c.steps[0].checklist[0].text.ru = "Мы гарантируем зачисление."; }, /forbidden promise/],
    [(c) => { c.steps[0].checklist[0].text.ru = "Вы точно получите визу."; }, /forbidden promise/],
    [(c) => { c.steps[0].checklist[0].text.ky = "Ийгилик 100 % болот."; }, /forbidden promise/],
    [(c) => { c.steps[0].checklist[0].text.ru = "Напишите в отдел продаж."; }, /internal detail/],
    [(c) => { c.steps[0].checklist[0].text.ru = "Позвоните +996 555 123 456."; }, /internal detail/],
    [(c) => { c.steps[0].checklist[0].text.ru = "Сдайте до 1 мая 2027 года."; }, /needs an undated variant/],
    [(c) => { delete c.steps[0].timing.label.undated; }, /needs an undated variant/],
    [(c) => { c.steps[0].title.undated = { ru: "x", ky: "y" }; }, /undated variant for a text without a date/],
    [(c) => { c.steps[0].timing.label.undated = { ru: "Октябрь 2026", ky: "Октябрь" }; }, /absolute date in an undated field/],
    [(c) => { c.steps[0].timing.label.undated = null; }, /cannot be hidden/],
    [(c) => { for (const item of c.steps[0].checklist) item.status = "verify"; }, /confirmed item/],
    [(c) => { c.steps[0].checklist[0].status = "draft"; }, /not one of confirmed, verify/],
    [(c) => { c.steps[0].timing.basis = "estimate"; }, /no estimated timing/],
    [(c) => { c.steps[0].stageKeys = ["visa"]; }, /not one of intake/],
    [(c) => { c.steps[1].order = 3; }, /not 2/],
    [(c) => { c.steps.splice(1, 4); }, /5 to 8 steps/],
    [(c) => { c.sources.push({ id: "UNUSED", kind: "official", title: "x", url: "https://example.org", checkedOn: "2026-10-16" }); }, /unused source UNUSED/],
    [(c) => { c.sources[0].location = "~/Downloads/guide.docx"; }, /unknown key location/],
    [(c) => { c.sources[0].title = "~/Downloads/guide.docx"; }, /internal path/],
    [(c) => { c.steps[0].checklist[0].review = ["D01"]; }, /unknown key review/],
    [(c) => { c.disclaimers.decisions.ru = "Решение о зачислении принимают вузы."; }, /required disclaimer/],
    [(c) => { delete c.disclaimers.documents; }, /missing documents/],
    [(c) => { c.steps[1].links[0].url = "http://csca.cn"; }, /https/],
    [(c) => { c.steps[0].checklist[0].text.ru = "Зарегистрируйтесь на СSCA."; }, /mixed script word/],
    [(c) => { c.name.ru = "Китай континентальный"; }, /study-countries/],
    [(c) => { c.country = "MY"; }, /not CN/],
  ];
  for (const [mutate, message] of cases) assert.throws(broken(mutate), message, String(message));
  assert.throws(() => parseCountryTimelineFile(raw("undecided"), "cn"), /not CN|unknown key|missing/);
  assert.throws(() => parseCountryTimelineFile(cn, "pl"), /unknown file key/);
});

test("every text is in RU and KY and the Kyrgyz is not a copy of the Russian", () => {
  for (const key of COUNTRY_TIMELINE_FILE_KEYS) {
    const file = raw(key);
    assert.equal(file.kyStatus, "needs_native_proofreading", `${key}: KY is marked for native proofreading`);
    for (const [path, value] of l10nObjects(file)) {
      assert.deepEqual(Object.keys(value).filter((k) => k !== "undated").sort(), ["ky", "ru"], `${key} ${path}`);
      assert.ok(value.ru.trim() && value.ky.trim(), `${key} ${path}`);
      if (value.ru.length > 30) assert.notEqual(value.ru, value.ky, `${key} ${path}: KY equals RU`);
    }
  }
  // The same structure in both languages: a view has the same steps and items.
  for (const choice of CHOICES) {
    const ru = selectCountryTimeline(choice, { locale: "ru", today: BEFORE });
    const ky = selectCountryTimeline(choice, { locale: "ky", today: BEFORE });
    assert.deepEqual(ky.steps.map((s) => [s.id, s.items.map((i) => i.id)]), ru.steps.map((s) => [s.id, s.items.map((i) => i.id)]), choice);
  }
});

test("the three disclaimers are in every file and in every timeline shown", () => {
  for (const key of COUNTRY_TIMELINE_FILE_KEYS) {
    const { disclaimers } = COUNTRY_TIMELINES[key];
    assert.match(disclaimers.timing.ru, /^Сроки ориентировочные/, key);
    assert.match(disclaimers.documents.ru, /^Окончательный список документов зависит от (вуза|университета)/, key);
    assert.match(disclaimers.decisions.ru, /^Решение о зачислении.*EVO их не гарантирует\.$/, key);
    assert.match(disclaimers.timing.ky, /^Мөөнөттөр болжолдуу/, key);
    assert.match(disclaimers.documents.ky, /^Документтердин акыркы тизмеси/, key);
    assert.match(disclaimers.decisions.ky, /EVO буларга кепилдик бербейт\.$/, key);
  }
  for (const { choice, locale, today, view } of views()) {
    assert.equal(view.disclaimers.length, 3, `${choice} ${locale} ${today}`);
    assert.match(view.disclaimers[0], locale === "ru" ? /^Сроки ориентировочные/ : /^Мөөнөттөр болжолдуу/);
    assert.match(view.disclaimers[2], locale === "ru" ? /EVO их не гарантирует\.$/ : /EVO буларга кепилдик бербейт\.$/);
  }
});

test("no promise, internal detail, dash or CSCA session date reaches a student", () => {
  for (const { choice, locale, today, view } of views()) {
    const label = `${choice} ${locale} ${today}`;
    for (const text of viewStrings(view)) {
      const outsideNegation = text.replace(/EVO их не гарантирует\.$|EVO буларга кепилдик бербейт\.$/u, "");
      for (const pattern of FORBIDDEN_PROMISES) assert.doesNotMatch(outsideNegation, pattern, `${label}: ${text}`);
      for (const pattern of INTERNAL_MARKERS) assert.doesNotMatch(text, pattern, `${label}: ${text}`);
      assert.doesNotMatch(text, /[\u2012-\u2015\u2212]/u, `${label}: ${text}`);
      assert.doesNotMatch(text, /~\/|Downloads|EVO_Знания|\.docx/u, `${label}: ${text}`);
    }
  }
  // The CSCA step of China: no session dates (they live in the CSCA module).
  const exams = selectCountryTimeline("CN", { locale: "ru", today: BEFORE }).steps.find((step) => step.id === "cn-2-exams");
  for (const text of [exams.title, exams.summary, ...exams.items.flatMap((item) => [item.text, item.note ?? ""])]) {
    assert.doesNotMatch(text, /\d{1,2}(\s+и\s+\d{1,2})?\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/u, text);
  }
  // Nothing internal in the files either: they ship whole in the iPhone bundle.
  for (const key of COUNTRY_TIMELINE_FILE_KEYS) {
    const text = read(`src/content/timelines/${key}.json`);
    // Official addresses may end in .docx or .pdf; internal paths never appear.
    assert.doesNotMatch(text, /"location"|"review"|~\/|Downloads|EVO_Знания|ОЗО|отдел[а-я]* продаж/u, key);
    for (const source of COUNTRY_TIMELINES[key].sources) {
      if (source.kind === "owner_guide" || source.kind === "evo_internal") assert.equal(source.url, undefined, `${key} ${source.id}`);
    }
  }
});

test("verify items are never shown", () => {
  const verify = COUNTRY_TIMELINE_FILE_KEYS.flatMap((key) => COUNTRY_TIMELINES[key].steps
    .flatMap((step) => step.checklist.filter((item) => item.status === "verify").map((item) => item.id)));
  assert.ok(verify.includes("my-6-01"), "the Malaysia airport rule waits for a check (discrepancies D11)");
  for (const { view } of views()) {
    for (const step of view.steps) for (const item of step.items) assert.ok(!verify.includes(item.id), item.id);
  }
  const my = selectCountryTimeline("MY", { locale: "ru", today: BEFORE });
  assert.deepEqual(my.steps.find((step) => step.id === "my-6-arrival").items.map((item) => item.id), ["my-6-02", "my-6-03"]);
});

test("only an approved country is shown as its own timeline; the others show the general route with their name", () => {
  assert.deepEqual(COUNTRY_TIMELINE_FILE_KEYS.filter((key) => COUNTRY_TIMELINES[key].status === "approved"), ["cn", "my", "undecided"]);
  for (const code of STUDY_COUNTRY_CODES) {
    for (const locale of ["ru", "ky"]) {
      const view = selectCountryTimeline(code, { locale, today: BEFORE });
      const approved = COUNTRY_TIMELINES[code.toLowerCase()].status === "approved";
      assert.equal(view.kind, approved ? "country" : "general", code);
      assert.equal(view.file, approved ? code.toLowerCase() : "undecided", code);
      assert.equal(view.countryCode, code);
      assert.equal(view.countryName, studyCountryName(code, locale));
      if (!approved) {
        assert.deepEqual(view, { ...selectCountryTimeline(TIMELINE_UNDECIDED, { locale, today: BEFORE }),
          choice: code, countryCode: code, countryName: studyCountryName(code, locale) }, code);
      }
    }
  }
  const undecided = selectCountryTimeline(TIMELINE_UNDECIDED, { locale: "ru", today: BEFORE });
  assert.equal(undecided.kind, "general");
  assert.equal(undecided.countryName, null);
  assert.equal(undecided.steps.length, 7);
  assert.ok(undecided.steps.every((step) => step.timing === null));
  // Unknown and form-only values are not a choice.
  for (const value of ["PL", "undecided", "cn", "", null, undefined, 1]) {
    assert.equal(isTimelineChoice(value), false, String(value));
    assert.equal(selectCountryTimeline(value, { today: BEFORE }), null, String(value));
  }
  assert.throws(() => selectCountryTimeline("CN", { today: "16.10.2026" }), /YYYY-MM-DD/);
});

test("after validUntil no absolute date is shown and the relative wording stays", () => {
  for (const key of COUNTRY_TIMELINE_FILE_KEYS) assert.equal(COUNTRY_TIMELINES[key].validUntil, "2027-10-31", key);
  const before = selectCountryTimeline("CN", { locale: "ru", today: "2027-10-31" });
  assert.equal(before.datesHidden, false);
  assert.equal(before.intake.label, "Набор на сентябрь 2027 года");
  assert.equal(before.steps[0].timing, "Октябрь и ноябрь 2026");
  const after = selectCountryTimeline("CN", { locale: "ru", today: "2027-11-01" });
  assert.equal(after.datesHidden, true);
  assert.equal(after.intake.label, "Набор на сентябрь");
  assert.equal(after.steps[0].timing, "Октябрь и ноябрь, примерно за 11 месяцев до начала учёбы");
  assert.deepEqual(after.steps.map((s) => s.items.map((i) => i.id)), before.steps.map((s) => s.items.map((i) => i.id)));
  for (const { choice, locale, today, view } of views()) {
    if (today !== AFTER) continue;
    for (const text of viewStrings(view)) assert.doesNotMatch(text, ABSOLUTE_DATE, `${choice} ${locale}: ${text}`);
  }
  assert.equal(todayForTimeline(new Date("2026-10-15T19:30:00Z")), "2026-10-16", "the student's day is Bishkek time");
});

test("the CSCA step links to the in-app module when it exists, otherwise to csca.cn", () => {
  const link = (modules) => selectCountryTimeline("CN", { locale: "ru", today: BEFORE, modules })
    .steps.find((step) => step.id === "cn-2-exams").links;
  assert.deepEqual(link(undefined), [{ id: "csca", label: "CSCA: даты сессий и регистрация", href: "https://csca.cn", external: true }]);
  assert.deepEqual(link({ csca: "/portal/csca" }), [{ id: "csca", label: "CSCA: даты сессий и регистрация", href: "/portal/csca", external: false }]);
});

test("the iPhone bundles the same seven files in the app and the unit-test target", () => {
  const project = read("ios/project.yml");
  for (const key of COUNTRY_TIMELINE_FILE_KEYS) {
    const entries = project.match(new RegExp(`- path: \\.\\./src/content/timelines/${key}\\.json\\n\\s+buildPhase: resources`, "g"));
    assert.equal(entries?.length, 2, `${key}.json must be a resource of both targets`);
  }
  // No other resource with a timeline file name, and the generated project points at the same files.
  const paths = [...project.matchAll(/- path: (\S+\.json)/g)].map((m) => m[1]);
  const names = paths.map((path) => path.split("/").at(-1));
  for (const key of COUNTRY_TIMELINE_FILE_KEYS) {
    assert.equal(names.filter((name) => name === `${key}.json`).length, 2, key);
    assert.ok(paths.filter((path) => path.endsWith(`/${key}.json`)).every((path) => path === `../src/content/timelines/${key}.json`), key);
  }
  const pbxproj = read("ios/EVOAdmissions.xcodeproj/project.pbxproj");
  for (const key of COUNTRY_TIMELINE_FILE_KEYS) {
    assert.equal(pbxproj.match(new RegExp(`/\\* ${key}\\.json in Resources \\*/ = \\{isa = PBXBuildFile`, "g"))?.length, 2, key);
  }
  assert.match(pbxproj, /path = timelines;/);
});

test("the country choice answer parses strictly; the SQL list is the same product list", () => {
  assert.deepEqual(COUNTRY_CHOICE_VALUES, ["CN", "MY", "AE", "TR", "IT", "CZ", "UNDECIDED"]);
  const saved = { country: "UNDECIDED", source: "saved", savedAt: "2026-10-16T10:00:00.123456+00:00" };
  assert.deepEqual(parseStudentCountryChoice(saved), saved);
  assert.deepEqual(parseStudentCountryChoice({ country: "CN", source: "application", savedAt: null }), { country: "CN", source: "application", savedAt: null });
  assert.deepEqual(parseStudentCountryChoice({ country: "MY", source: "case", savedAt: null }), { country: "MY", source: "case", savedAt: null });
  assert.deepEqual(parseStudentCountryChoice({ country: null, source: "none", savedAt: null }), { country: null, source: "none", savedAt: null });
  for (const bad of [null, [], {}, { ...saved, extra: 1 }, { ...saved, country: "PL" }, { ...saved, country: "undecided" },
    { ...saved, savedAt: null }, { ...saved, savedAt: "yesterday" }, { country: "UNDECIDED", source: "application", savedAt: null },
    { country: "CN", source: "case", savedAt: saved.savedAt }, { country: "CN", source: "none", savedAt: null },
    { country: null, source: "saved", savedAt: saved.savedAt }, { country: "CN", source: "staff", savedAt: null }]) {
    assert.equal(parseStudentCountryChoice(bad), null, JSON.stringify(bad));
  }
  const sql = read("supabase/migrations/284_platform_student_country_choice.sql");
  assert.match(sql, /country = 'UNDECIDED' OR country = ANY \(platform_private\.study_country_codes\(\)\)/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.student_country_choice_v1\(\), platform\.set_student_country_choice_v1\(TEXT, UUID\)\nTO authenticated;/);
  // Free text of a case: every name of study-countries.json (RU, KY, site value) is recognised.
  const countries = JSON.parse(read("src/lib/study-countries.json")).countries;
  const mapping = sql.match(/FUNCTION platform_private\.study_country_from_text[\s\S]*?\$\$;/)[0];
  for (const row of countries) {
    for (const name of [row.ru, row.ky, row.website]) {
      assert.match(mapping, new RegExp(`WHEN '${name.toLowerCase().replace("ё", "е")}' THEN '${row.code}'`), `${row.code} ${name}`);
    }
  }
});
