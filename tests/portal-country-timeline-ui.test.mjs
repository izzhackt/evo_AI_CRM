import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { FORBIDDEN_PROMISES, TIMELINE_APP_MODULES } from "../src/lib/portal/country-timeline.ts";
import { PORTAL_DICTIONARIES } from "../src/lib/portal/i18n.ts";
import { TIMELINE_MODULE_ROUTES } from "../src/lib/portal/timeline-module-routes.ts";

// «Путь поступления» на «Главной», веб (S4, план §8.4; контракт
// docs/portal/country-timeline-contract.md §3, §5 и §7).
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("src/app/(portal)/portal/home/page.tsx");
const view = read("src/components/portal/home/HomeView.tsx");
const block = read("src/components/portal/home/CountryTimeline.tsx");
const action = read("src/lib/portal/country-choice-actions.ts");
const source = read("src/lib/portal/country-choice-source.ts");
const css = read("src/app/(portal)/portal.css");

test("the choice is read in the same wave as the other home reads", () => {
  const wave = page.match(/await Promise\.all\(\[\n([\s\S]*?)\n {2}\]\);/u);
  assert.ok(wave, "home reads stay in one Promise.all");
  const reads = wave[1];
  for (const reader of ["readStudentPortalOverview", "readLearningModules", "readStudentAssessments", "readStudentUniversityFavorites", "readStudentRecentUniversities", "readStudentCountryChoice"]) {
    assert.match(reads, new RegExp(`\\b${reader}\\(`, "u"), reader);
  }
  assert.match(reads, /readStudentCountryChoice\(\)\.catch\(\(\): null => null\)/u);
  // Только один Promise.all страницы после проверки студента: лишней волны нет.
  assert.equal(page.match(/await Promise\.all\(/gu)?.length, 2);
  assert.match(page, /selectCountryTimeline\(choice\.country, \{[\s\S]*today: todayForTimeline\(now\),[\s\S]*modules: TIMELINE_MODULE_ROUTES,/u);
  assert.match(page, /readFailed=\{choice === null\}/u);
  assert.match(page, /getPortalStrings\("timeline", locale\)/u);
  assert.doesNotMatch(page, /\.rpc\(|\.schema\(/u);
  // Сервер отдаёт клиенту только выбранный путь, не все файлы контента.
  assert.doesNotMatch(block, /COUNTRY_TIMELINES|content\/timelines|selectCountryTimeline\(/u);
});

test("the block sits after case actions for a client and first for a self-serve student", () => {
  const first = view.indexOf('{tier === "assisted" ? null : journey}');
  const caseSection = view.indexOf('aria-labelledby="home-case"');
  const afterCase = view.indexOf('{tier === "assisted" ? journey : null}');
  const continueSection = view.indexOf('aria-labelledby="home-continue"');
  assert.ok(first > 0 && caseSection > first, "self-serve: journey before everything");
  assert.ok(afterCase > caseSection && continueSection > afterCase, "assisted: journey right after case actions");
});

test("module routes match the app routes, so the CSCA step never links to a missing page", () => {
  for (const appModule of TIMELINE_APP_MODULES) {
    const routeFile = `src/app/(portal)/portal/${appModule}/page.tsx`;
    const exists = existsSync(new URL(`../${routeFile}`, import.meta.url));
    assert.equal(appModule in TIMELINE_MODULE_ROUTES, exists, `${appModule}: route ${exists ? "exists" : "missing"}`);
    if (exists) assert.equal(TIMELINE_MODULE_ROUTES[appModule], `/portal/${appModule}`);
  }
});

test("steps are read-only disclosures with remembered state and accessible names", () => {
  assert.match(block, /^"use client";/u);
  assert.match(block, /aria-expanded=\{expanded\}/u);
  assert.match(block, /aria-controls=\{panelId\}/u);
  assert.match(block, /aria-describedby=\{step\.timing \? periodId : undefined\}/u);
  assert.match(block, /strings\.stepOf/u);
  assert.match(block, /strings\.doneWhen/u);
  assert.match(block, /view\.disclaimers\.map/u);
  // Только чтение: отметок, полей и форм в блоке нет.
  assert.doesNotMatch(block, /type="checkbox"|<input|<form|<select/u);
  // Раскрытые шаги: ключ с file и contentVersion, каждое обращение к хранилищу в try/catch.
  assert.match(block, /`\$\{STORAGE_PREFIX\}:\$\{view\.file\}:\$\{view\.contentVersion\}`/u);
  assert.match(block, /try \{\n\s+return window\.localStorage\.getItem\(key\) \?\? "";\n\s+\} catch/u);
  assert.match(block, /try \{\n\s+window\.localStorage\.setItem\(key, value\);\n\s+\} catch/u);
  assert.equal(block.match(/window\.localStorage\./gu)?.length, 2);
  // Внешняя ссылка открывается отдельно и говорит об этом читалке.
  assert.match(block, /target="_blank" rel="noopener noreferrer"/u);
  assert.match(block, /strings\.external/u);
});

test("country choice uses the 284 RPC with an idempotent request id", () => {
  assert.match(block, /retry\.current\?\.country === code \? retry\.current\.requestId : crypto\.randomUUID\(\)/u);
  assert.match(block, /setStudentCountryChoiceAction\(code, requestId\)/u);
  assert.match(block, /strings\.saveError/u);
  assert.match(block, /strings\.readError/u);
  assert.match(block, /event\.key === "Escape"/u);
  assert.match(action, /^"use server";/u);
  assert.ok(action.indexOf("await requireStudentPortalActor()") < action.indexOf("try {"), "guard runs before the RPC");
  assert.match(action, /COUNTRY_CHOICE_VALUES\.includes\(country\)/u);
  assert.match(action, /\.rpc\("set_student_country_choice_v1", \{ p_country: country, p_request_id: requestId \}\)/u);
  assert.match(action, /receipt\?\.source === "saved" && receipt\.country === country/u);
  assert.match(action, /refresh\(\);/u);
  assert.match(source, /^import "server-only";/u);
  assert.match(source, /\.rpc\("student_country_choice_v1"\)/u);
  assert.match(source, /parseStudentCountryChoice\(data\)/u);
});

test("timeline strings exist in RU and KY without dashes or promises", () => {
  const { ru, ky } = PORTAL_DICTIONARIES.timeline;
  assert.deepEqual(Object.keys(ky).sort(), Object.keys(ru).sort());
  assert.equal(ru.headingCountry, "Путь поступления: {country}");
  assert.equal(ru.changeCountry, "Сменить страну");
  assert.equal(ru.chooseTitle, "Выберите страну");
  assert.equal(ru.doneWhen, "Когда шаг пройден");
  assert.equal(ru.saveError, "Не удалось сохранить выбор, попробуйте ещё раз.");
  for (const [locale, strings] of Object.entries({ ru, ky })) {
    for (const [key, value] of Object.entries(strings)) {
      assert.ok(value.trim().length > 0, `${locale}.${key} empty`);
      assert.doesNotMatch(value, /[\u2013\u2014]/u, `${locale}.${key} has a dash`);
      for (const pattern of FORBIDDEN_PROMISES) assert.doesNotMatch(value, pattern, `${locale}.${key} promises`);
    }
    assert.match(strings.headingCountry, /\{country\}/u);
    assert.match(strings.stepOf, /\{n\}/u);
    assert.match(strings.stepOf, /\{total\}/u);
  }
  assert.notEqual(ky.heading, ru.heading);
  // Кыргызский помечен для вычитки носителем.
  const i18n = read("src/lib/portal/i18n.ts");
  assert.match(i18n, /\/\/ KY: носитель языка вычитывает в PR\.\nconst timelineKy/u);
});

test("styles add no red, keep 44 px targets and honour reduced motion", () => {
  const start = css.indexOf("/* ---------- «Путь поступления» на «Главной»");
  const end = css.indexOf("/* Live notifications share the Atlas header");
  assert.ok(start > 0 && end > start);
  const section = css.slice(start, end);
  assert.doesNotMatch(section, /#d70217|#ff4a57/u);
  // Красный только как обводка фокуса (тот же приём, что у всего кабинета).
  for (const line of section.split("\n").filter((row) => row.includes("--pt-accent"))) {
    assert.match(line, /outline: 2px solid var\(--pt-accent\)/u, line);
  }
  assert.match(section, /\.pt-journey-option \{[\s\S]*?min-height: 60px;/u);
  assert.match(section, /\.pt-step-link \{[\s\S]*?min-height: 44px;/u);
  assert.match(section, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.pt-step-panel:not\(\[hidden\]\)[\s\S]*animation: none;/u);
  assert.doesNotMatch(section, /transition:[^;]*\b(height|width|top|left|margin|padding)\b/u);
});
