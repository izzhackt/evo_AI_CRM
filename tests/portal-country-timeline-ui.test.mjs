import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { FORBIDDEN_PROMISES, TIMELINE_APP_MODULES, selectCountryTimeline } from "../src/lib/portal/country-timeline.ts";
import { PORTAL_DICTIONARIES } from "../src/lib/portal/i18n.ts";
import { TIMELINE_MODULE_ROUTES } from "../src/lib/portal/timeline-module-routes.ts";

// «Путь поступления», веб (S4, план §8.4; контракт docs/portal/country-timeline-contract.md §3, §5 и §7).
// С 08.11.2026 весь путь стоит на «Поступлении», на «Главной» — его карточка.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("src/app/(portal)/portal/home/page.tsx");
const admissionPage = read("src/app/(portal)/portal/page.tsx");
const view = read("src/components/portal/home/HomeView.tsx");
const block = read("src/components/portal/home/CountryTimeline.tsx");
const card = read("src/components/portal/home/HomeJourneyCard.tsx");
const journey = read("src/lib/portal/student-journey.ts");
const anchor = read("src/lib/portal/journey-anchor.ts");
const action = read("src/lib/portal/country-choice-actions.ts");
const source = read("src/lib/portal/country-choice-source.ts");
const css = read("src/app/(portal)/portal.css");

test("the choice is read in the same wave as the other reads on both pages", () => {
  const wave = page.match(/await Promise\.all\(\[\n([\s\S]*?)\n {2}\]\);/u);
  assert.ok(wave, "home reads stay in one Promise.all");
  const reads = wave[1];
  // 03.11.2026: уроки, тесты и новое в каталоге с «Главной» сняты, добавлена лента «Что нового».
  for (const reader of ["readStudentPortalOverview", "readStudentPortalNotifications", "readStudentUniversityFavorites", "readStudentCountryChoice"]) {
    assert.match(reads, new RegExp(`\\b${reader}\\(`, "u"), reader);
  }
  assert.match(reads, /readStudentCountryChoice\(\)\.catch\(\(\): null => null\)/u);
  // Только один Promise.all страницы после проверки студента: лишней волны нет.
  assert.equal(page.match(/await Promise\.all\(/gu)?.length, 2);
  // «Поступление»: выбор читается вместе с обзором дела и подготовками, тоже без лишней волны.
  const admissionWave = admissionPage.match(/const \[overview, preparations, choice\] = await Promise\.all\(\[\n([\s\S]*?)\n {2}\]\);/u);
  assert.ok(admissionWave, "admission reads stay in one Promise.all");
  assert.match(admissionWave[1], /readStudentCountryChoice\(\)\.catch\(\(\): null => null\),/u);
  // Обе страницы берут путь и прогресс из одного места, поэтому карточка и путь не расходятся.
  for (const file of [page, admissionPage]) {
    assert.match(file, /selectStudentJourney\(\{\n\s+country: choice\?\.country \?\? null,/u);
    assert.doesNotMatch(file, /selectCountryTimeline\(|timelineStepProgress\(|\.rpc\(|\.schema\(/u);
    assert.match(file, /readFailed=\{choice === null\}/u);
  }
  assert.match(journey, /selectCountryTimeline\(country, \{[\s\S]*today: todayForTimeline\(now\),[\s\S]*modules: TIMELINE_MODULE_ROUTES,/u);
  assert.match(admissionPage, /options=\{timelineCountryOptions\(locale\)\}/u);
  assert.match(admissionPage, /getPortalStrings\("timeline", locale\)/u);
  // Сервер отдаёт клиенту только выбранный путь, не все файлы контента.
  assert.doesNotMatch(block, /COUNTRY_TIMELINES|content\/timelines|selectCountryTimeline\(|student-journey/u);
});

test("the whole path sits on «Поступление» between the tiles and the tabs, the home keeps its card (user, 08.11.2026)", () => {
  const overviewAt = admissionPage.indexOf("<OverviewView");
  const pathAt = admissionPage.indexOf("<CountryTimeline");
  const tabsAt = admissionPage.indexOf('<nav className="pt-pill-tabs"');
  assert.ok(overviewAt > 0 && pathAt > overviewAt && tabsAt > pathAt, "tiles, then the path, then the tabs");
  assert.doesNotMatch(page, /CountryTimeline/u, "no full path on the home");
  assert.match(page, /<HomeJourneyCard\n\s+view=\{journey\.view\}\n\s+progress=\{journey\.progress\}/u);
  // Карточка открывает правую колонку «Главной», перед датами.
  const side = view.indexOf('<div className="pt-home-side">');
  const cardAt = view.indexOf("{journey}");
  const dates = view.indexOf("<HomeDates");
  assert.ok(side > 0 && cardAt > side && dates > cardAt, "the card opens the right column");
  // Карточка ведёт к якорю блока, переход по ней раскрывает путь.
  assert.match(anchor, /export const JOURNEY_ANCHOR = "path";/u);
  assert.match(anchor, /export const JOURNEY_HREF = `\/portal#\$\{JOURNEY_ANCHOR\}`;/u);
  assert.match(block, /id=\{JOURNEY_ANCHOR\}/u);
  assert.match(block, /if \(window\.location\.hash === `#\$\{JOURNEY_ANCHOR\}`\) setFolded\(false\);/u);
  assert.match(card, /href=\{JOURNEY_HREF\}/u);
  // Карточка — серверная разметка: шаг словами, полоса шагов скрыта от читалки, сбой выбора — честная плашка.
  assert.doesNotMatch(card, /^"use client";/u);
  assert.match(card, /timeline\.nowStep, \{ n: String\(current\.order\), total: String\(view\.steps\.length\) \}/u);
  assert.match(card, /<span className="pt-journey-meter" aria-hidden="true">/u);
  assert.match(card, /<p role="alert" className="pt-alert">\{timeline\.readError\}<\/p>/u);
  const home = PORTAL_DICTIONARIES.home;
  assert.deepEqual([home.ru.pathAll, home.ru.pathChoose], ["Весь путь", "Выбрать страну"]);
  for (const key of ["pathAll", "pathChoose", "pathChooseLead"]) assert.ok(home.ky[key], `ky ${key}`);
  assert.match(css, /\.pt-page > \.pt-journey \{\n {2}margin-bottom: 24px;\n {2}scroll-margin-top: calc\(var\(--pt-topbar-height\) \+ 16px\);/u);
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

test("a module link stays in the app: same tab, no external icon, named by its label", () => {
  // Внутренняя ветка: next/link без target, значка и подписи «внешняя ссылка».
  assert.match(block, /<IntentPrefetchLink className="pt-link pt-step-link" href=\{link\.href\}>\s*\{link\.label\}\s*<\/IntentPrefetchLink>/u);
  // Шаг экзаменов Китая ведёт в раздел CSCA, csca.cn остаётся запасным адресом без модуля.
  const link = (modules) => selectCountryTimeline("CN", { locale: "ru", today: "2026-10-16", modules })
    .steps.find((step) => step.id === "cn-2-exams").links;
  assert.deepEqual(link(TIMELINE_MODULE_ROUTES).map(({ id, href, external }) => ({ id, href, external })), [
    { id: "csca", href: "/portal/csca", external: false },
  ]);
  assert.deepEqual(link(undefined).map(({ href, external }) => ({ href, external })), [{ href: "https://csca.cn", external: true }]);
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
  const start = css.indexOf("/* ---------- «Путь поступления» (S4");
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

test("progress on the path: done steps fold into one line, the step line stays on screen, nothing extra (owner, 08.11.2026)", () => {
  // Этап — только из своего дела; студент без дела или с непрочитанным обзором видит путь без прогресса.
  assert.match(journey, /const progress = view && stage !== undefined \? timelineStepProgress\(view\.steps, stage\) : null;/u);
  assert.match(page, /stage: overviewResult\.ok \? overviewResult\.value\?\.operationalStage \?\? null : undefined,/u);
  assert.match(admissionPage, /stage: overview === undefined \? undefined : overview\?\.operationalStage \?\? null,/u);
  assert.match(admissionPage, /progress=\{journey\.progress\}/u);
  assert.doesNotMatch(block, /timelineStepProgress\(/u, "the client gets the result, not the content files");
  assert.match(block, /hidden=\{state === "done" && !showDone\}/u);
  assert.match(block, /aria-expanded=\{showDone\}/u);
  // Ничего не раскрывается само: длинный список шага — только по нажатию.
  assert.match(block, /const \{ open, toggle \} = useOpenSteps\(view\);/u);
  assert.match(block, /className="pt-journey-now"/u);
  assert.match(block, /strings\.nowStep, \{ n: String\(currentStep\.order\), total: String\(total\) \}/u);
  // Цвет всегда со словом: «Пройден» и «Сейчас» рядом с названием.
  assert.match(block, /state === "done" \? strings\.progressDone : strings\.progressCurrent/u);
  const { ru, ky } = PORTAL_DICTIONARIES.timeline;
  assert.deepEqual([ru.progressDone, ru.progressCurrent, ru.showDone, ru.nowStep], ["Пройден", "Сейчас", "Пройдено", "Шаг {n} из {total}"]);
  assert.ok(ky.progressDone && ky.progressCurrent && ky.showDone && ky.nowStep.includes("{n}") && ky.nowStep.includes("{total}"));
  // Свёрнутый шаг — название и срок; цель — у открытого и у текущего.
  assert.match(css, /\.pt-step\[data-open="false"\]:not\(\[data-progress="current"\]\) \.pt-step-goal \{\n {2}display: none;/u);
  // Строка не уезжает: карточка не обрезает прокрутку, строка закреплена под верхней полосой.
  assert.match(css, /\.pt-card\.pt-journey \{\n {2}overflow: clip;/u);
  assert.match(css, /\.pt-journey-now \{\n {2}position: sticky;\n {2}top: calc\(var\(--pt-topbar-height\) \+ 8px\);/u);
  assert.match(css, /\.pt-step\[data-progress="done"\] \.pt-step-node,/u);
  assert.doesNotMatch(css, /pt-node-wave|pt-journey-now-count|pt-journey-now-timing/u, "no pulse and no repeated count or timing");
  // Весь путь сворачивается: шаги и «Важно знать» за «Все шаги»; с текущим шагом путь сначала свёрнут, без дела — раскрыт.
  assert.match(block, /useFolded\(currentStep !== null\)/u);
  assert.match(block, /<div id=\{stepsId\} className="pt-journey-body" hidden=\{folded\}>/u);
  assert.match(block, /aria-expanded=\{!folded\} aria-controls=\{stepsId\}/u);
  assert.match(block, /if \(folded\) setFolded\(false\);/u, "the step line opens the folded path");
  assert.deepEqual([ru.showSteps, ru.hideSteps], ["Все шаги", "Свернуть"]);
  assert.ok(ky.showSteps && ky.hideSteps);
  assert.match(css, /\.pt-journey-fold \{[\s\S]*?min-height: 44px;/u);
});

