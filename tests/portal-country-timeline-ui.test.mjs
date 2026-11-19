import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { FORBIDDEN_PROMISES, TIMELINE_APP_MODULES, selectCountryTimeline } from "../src/lib/portal/country-timeline.ts";
import { PORTAL_DICTIONARIES } from "../src/lib/portal/i18n.ts";
import { TIMELINE_MODULE_ROUTES } from "../src/lib/portal/timeline-module-routes.ts";

// «Путь поступления», веб (S4, план §8.4; контракт docs/portal/country-timeline-contract.md §3, §5 и §7).
// С 08.11.2026 весь путь стоит на «Поступлении», на «Главной» — его карточка; с 09.11.2026 (#1355) «Главная» одна:
// карточка и весь путь на /portal.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("src/app/(portal)/portal/page.tsx");
const view = read("src/components/portal/home/HomeView.tsx");
const block = read("src/components/portal/home/CountryTimeline.tsx");
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
  // Выбранные программы «Моего списка» читаются в той же волне (#1355).
  assert.match(reads, /readStudentCatalogPreparations\(actor\.studentCaseId\)\.catch\(\(\) => null\)/u);
  // Карточка и весь путь берут путь и прогресс из одного места, поэтому они не расходятся.
  assert.match(page, /selectStudentJourney\(\{\n\s+country: choice\?\.country \?\? null,/u);
  assert.doesNotMatch(page, /selectCountryTimeline\(|timelineStepProgress\(|\.rpc\(|\.schema\(/u);
  assert.match(page, /readFailed=\{choice === null\}/u);
  assert.match(journey, /selectCountryTimeline\(country, \{[\s\S]*today: todayForTimeline\(now\),[\s\S]*modules: TIMELINE_MODULE_ROUTES,/u);
  assert.match(page, /options=\{timelineCountryOptions\(locale\)\}/u);
  assert.match(page, /getPortalStrings\("timeline", locale\)/u);
  // Сервер отдаёт клиенту только выбранный путь, не все файлы контента.
  assert.doesNotMatch(block, /COUNTRY_TIMELINES|content\/timelines|selectCountryTimeline\(|student-journey/u);
});

test("one home: the whole path stands right under the header, no separate path card (#1355, 18.11.2026)", () => {
  // Выбор страны (view={null}) — на странице; весь путь страницы передаёт свойствами, блок собирает HomeView.
  assert.equal(page.match(/<CountryTimeline/gu)?.length, 1);
  assert.match(page, /countryChoice=\{journey\.view \? null : \(\s+<CountryTimeline\s+view=\{null\}/u);
  assert.match(page, /path=\{journey\.view \? \{\n(?:\s+\/\/[^\n]*\n)?\s+view: journey\.view,/u);
  // 18.11.2026 (пользователь): со страной шапка «Главной» и путь — один блок на фото столицы, на месте шапки; без
  // страны — прежняя тёмная шапка и под ней выбор страны. Карточки «Путь: страна» справа нет.
  assert.match(view, /\{path \? <CountryTimeline \{\.\.\.path\} hero=\{<HomeHeroContent \{\.\.\.hero\} \/>\} \/> : <HomeHero \{\.\.\.hero\} \/>\}\n\s+\{countryChoice\}/u);
  assert.ok(view.indexOf("<CountryTimeline {...path}") < view.indexOf('<div className="pt-home-columns">'), "the path block opens the page");
  assert.match(block, /\{hero\}\n\s+\{\/\*[^*]*\*\/\}\n\s+<h2 id=\{headingId\} ref=\{headingRef\} tabIndex=\{-1\} className="pt-sr-only">\{title\}<\/h2>/u);
  assert.ok(view.indexOf("{list}") > view.indexOf('<div className="pt-home-columns">'), "columns, then the wide list");
  assert.doesNotMatch(page + view, /HomeJourneyCard|\{journey\}|data-slot="path"/u);
  assert.equal(existsSync(new URL("../src/components/portal/home/HomeJourneyCard.tsx", import.meta.url)), false);
  // Выбор страны первым блоком под шапкой, до колонок (карточки согласия на «Главной» больше нет, 09.11.2026).
  assert.ok(view.indexOf("{countryChoice}") > view.indexOf("<HomeHero") && view.indexOf("{countryChoice}") < view.indexOf("{info}"), "country choice first under the header");
  // Якорь блока: переход по #path (с других страниц) раскрывает путь.
  assert.match(anchor, /export const JOURNEY_ANCHOR = "path";/u);
  assert.match(block, /id=\{JOURNEY_ANCHOR\}/u);
  assert.match(block, /if \(window\.location\.hash === `#\$\{JOURNEY_ANCHOR\}`\) setFolded\(false\);/u);
  // Строки карточки остаются в словаре: ими пользуется приложение (mobile/src/features/home).
  const home = PORTAL_DICTIONARIES.home;
  assert.deepEqual([home.ru.pathAll, home.ru.pathTitle, home.ru.stripStep, home.ru.stripNext, home.ru.stripDone], ["Весь путь", "Путь: {country}", "Шаг {n} из {total}", "дальше — {title}", "Поступление завершено"]);
  for (const key of ["pathAll", "pathTitle", "stripStep", "stripNext", "stripDone"]) assert.ok(home.ky[key], `ky ${key}`);
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
  assert.match(journey, /const progress = view && stage !== undefined \? timelineStepProgress\(view\.steps, stage, boardStage\) : null;/u);
  assert.match(page, /stage: overviewResult\.ok \? overviewResult\.value\?\.operationalStage \?\? null : undefined,/u);
  // Колонка доски своего дела (357) уточняет шаг среди шагов одного этапа.
  assert.match(page, /boardStage: overviewResult\.ok \? overviewResult\.value\?\.boardStage \?\? null : null,/u);
  // Как на «Главной»: прогресс только у клиента с делом на сопровождении.
  assert.match(page, /const assisted = tier === "assisted";/u);
  assert.match(page, /progress: journey\.progress,/u);
  assert.doesNotMatch(block, /timelineStepProgress\(/u, "the client gets the result, not the content files");
  assert.match(block, /hidden=\{state === "done" && !showDone\}/u);
  assert.match(block, /aria-expanded=\{showDone\}/u);
  // Ничего не раскрывается само: длинный список шага — только по нажатию.
  assert.match(block, /const \{ open, toggle \} = useOpenSteps\(view\);/u);
  assert.match(block, /className="pt-journey-now" role="group" aria-label=\{strings\.whereNow\} data-state=\{nowRow\.kind\}/u);
  // Цвет всегда со словом: «Пройден» и «Сейчас» рядом с названием. «Сейчас:» строки шага остаётся в словаре для iPhone.
  // «Сейчас» один раз на экран: у текущего шага значка рядом с названием нет, слово осталось для читалки.
  assert.match(block, /state === "done" \? \(\s+<span className="pt-step-state" data-progress=\{state\}>\{strings\.progressDone\}<\/span>\s+\) : state === "current" \? \(\s+<span className="pt-sr-only"> \(\{strings\.progressCurrent\}\)<\/span>/u);
  const { ru, ky } = PORTAL_DICTIONARIES.timeline;
  assert.deepEqual([ru.progressDone, ru.progressCurrent, ru.showDone, ru.nowLabel], ["Пройден", "Сейчас", "Пройдено", "Сейчас:"]);
  assert.ok(ky.progressDone && ky.progressCurrent && ky.showDone && ky.nowLabel);
  // «по желанию» (09.11.2026): значок рядом с названием, в полосе шагов такого шага нет, KY на проверку носителю.
  assert.equal(ru.progressOptional, "по желанию");
  assert.equal(ky.progressOptional, "каалоо боюнча");
  assert.match(block, /state === "optional" \? \(\s+<span className="pt-step-state" data-progress=\{state\}>\{strings\.progressOptional\}<\/span>/u);
  assert.match(block, /view\.steps\.filter\(\(step\) => progressOf\(step\.id\) !== "optional"\)\.map/u);
  assert.match(css, /\.pt-step-state\[data-progress="optional"\] \{/u);
  // Свёрнутый шаг — название и срок; цель — у открытого и у текущего.
  assert.match(css, /\.pt-step\[data-open="false"\]:not\(\[data-progress="current"\]\) \.pt-step-goal \{\n {2}display: none;/u);
  // Строка не уезжает: карточка не обрезает прокрутку, строка закреплена под верхней полосой.
  assert.match(css, /\.pt-card\.pt-journey \{\n {2}overflow: clip;/u);
  assert.match(css, /\.pt-journey-now \{\n {2}position: sticky;\n {2}top: calc\(var\(--pt-topbar-height\) \+ 8px\);/u);
  assert.match(css, /\.pt-step\[data-progress="done"\] \.pt-step-node,/u);
  assert.doesNotMatch(css, /pt-node-wave|pt-journey-now-timing/u, "no pulse and no step timing in the line");
  // Весь путь сворачивается: шаги и «Важно знать» за «Все шаги»; 18.11.2026 — сначала свёрнут у всех (только шапка).
  assert.match(block, /useFolded\(true\)/u);
  assert.match(block, /<div id=\{stepsId\} className="pt-journey-body" hidden=\{folded\}>/u);
  assert.match(block, /aria-expanded=\{!folded\} aria-controls=\{stepsId\}/u);
  assert.match(block, /if \(folded\) setFolded\(false\);/u, "the step line opens the folded path");
  assert.deepEqual([ru.showSteps, ru.hideSteps], ["Все шаги", "Свернуть"]);
  assert.ok(ky.showSteps && ky.hideSteps);
  assert.match(css, /\.pt-journey-fold \{[\s\S]*?min-height: 44px;/u);
});

test("the step line says «Шаг N из M · дальше — …», the current step opens Documents, timing stays under the title (owner 10.11.2026, user 19.11.2026)", () => {
  // Число шагов прежде спорило с этапами дела в шапке «Главной»; этапов там нет с 10.11.2026, и строка под шапкой говорит
  // слова полосы пути «Главной» (`home.strip*`, как iPhone) по общей функции `journeyStrip`. Второго словаря нет.
  assert.match(block, /const strip = view \? journeyStrip\(view\.steps, progress, stage\) : null;/u);
  assert.match(block, /formatPortalString\(stripStrings\.step, \{ n: String\(nowRow\.n\), total: String\(nowRow\.total\) \}\)/u);
  assert.match(block, /formatPortalString\(stripStrings\.next, \{ title: nowRow\.nextTitle \}\)/u);
  assert.match(block, /<span className="pt-journey-now-title">\{stripStrings\?\.done\}<\/span>/u, "a finished case says so");
  assert.match(page, /stripStrings: \{ step: strings\.stripStep, next: strings\.stripNext, done: strings\.stripDone \},/u);
  assert.match(page, /stage: overviewResult\.ok \? overviewResult\.value\?\.operationalStage \?\? null : null,/u);
  assert.doesNotMatch(block, /strings\.nowStep|timeline\.nowStep/u);
  assert.equal(PORTAL_DICTIONARIES.timeline.ru.nowStep, undefined);
  // Без слов полосы — название, число шагов слышит читалка.
  assert.match(block, /strings\.stepOf, \{ n: String\(nowRow\.n\), total: String\(nowRow\.total\) \}/u);
  // Полоса самой карточки: без своей рамки и тени (19.11.2026, карточка в карточке); круг с номером, как у шага.
  const line = /\.pt-journey-now \{[^}]*\}/u.exec(css)[0];
  assert.doesNotMatch(line, /border|box-shadow/u);
  assert.match(block, /<span className="pt-journey-now-node" aria-hidden="true">\{nowRow\.n\}<\/span>/u);
  // «Открыть документы» — у текущего шага этапа документов и только тому, кому «Документы» открыты.
  assert.match(block, /state === "current" && documentsHref && step\.stageKeys\.includes\("documents"\)/u);
  assert.match(page, /documentsHref: assisted \? "\/portal\/documents" : null,/u);
  assert.equal(PORTAL_DICTIONARIES.timeline.ru.openDocuments, "Открыть документы");
  assert.ok(PORTAL_DICTIONARIES.timeline.ky.openDocuments);
  // Срок шага всегда строкой под названием: столбика сроков слева больше нет.
  assert.doesNotMatch(css, /"period node title chevron"|--pt-step-period: 184px/u);
  assert.match(css, /grid-template-areas:\n {4}"node title chevron"\n {4}"node period chevron"\n {4}"node goal chevron"\n {4}"node go chevron";/u);
});

test("the home step line renders the current step, a finished case and the bar on the stand (19.11.2026)", () => {
  // Стенд рендерит настоящие компоненты в отдельном процессе без react-server (как проверка доступности).
  const surfaces = JSON.parse(execFileSync(process.execPath, [new URL("./e2e/portal-static-render.cjs", import.meta.url).pathname], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }));
  const row = (name) => {
    const html = surfaces.find((surface) => surface.name === name)?.html ?? "";
    const start = html.lastIndexOf("<div", html.indexOf('class="pt-journey-now"'));
    assert.ok(start > 0, `${name}: the step line is there`);
    return { html, line: html.slice(start, html.lastIndexOf("<div", html.indexOf('class="pt-journey-body"', start))) };
  };
  const text = (html) => html.replace(/<span class="pt-sr-only">[^<]*<\/span>/gu, "").replace(/<[^>]+>/gu, "");

  // Клиент на шаге «Экзамены»: круг с номером, название, «Шаг 2 из 8 · дальше — Документы», полоса из восьми частей.
  const current = row("home-assisted");
  assert.match(current.line, /data-state="step"/u);
  assert.match(text(current.line), /^2Экзамены: CSCA и языкШаг 2 из 8 · дальше — ДокументыВсе шаги$/u);
  assert.match(current.line, /<span class="pt-sr-only">\. <\/span>Шаг 2 из 8<span aria-hidden="true"> · <\/span><span class="pt-sr-only">, <\/span>дальше — Документы/u);
  assert.deepEqual([...current.line.matchAll(/class="pt-journey-meter-seg" data-progress="(\w+)"/gu)].map((match) => match[1]),
    ["done", "current", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
  assert.match(current.line, /<div class="pt-journey-now-bar"><span class="pt-journey-meter"[^>]*>[\s\S]*<\/span><button type="button" class="pt-journey-fold"/u);
  assert.doesNotMatch(current.html, /class="pt-journey-change"><button type="button" class="pt-journey-fold"/u, "one fold button, in the line");

  // Дело завершено: «Поступление завершено», полосы нет — отметок по шагам у такого дела нет, список их не рисует.
  const finished = row("home-path-finished");
  assert.match(finished.line, /data-state="complete"/u);
  assert.match(text(finished.line), /^Поступление завершеноВсе шаги$/u);
  assert.doesNotMatch(finished.line, /pt-journey-meter/u);
  assert.doesNotMatch(finished.html, /class="pt-step"[^>]*data-progress=/u);
});

test("every cabinet page has the same content width as the user's sample (08.11.2026)", () => {
  assert.match(css, /--pt-content-max: calc\(1024px \+ 2 \* var\(--pt-gutter\)\);/u);
  assert.match(css, /\.pt-page \{[\s\S]*?max-width: var\(--pt-content-max\);/u);
  // «Профиль» больше не уже остальных страниц.
  assert.doesNotMatch(css, /\.pt-page\.pt-profile \{\n {2}max-width/u);
});

// Перенесено из #1423 (Айвар): без текущего шага «Все шаги» стоит в шапке рядом с «Сменить страну», а не одна строка внизу.
test("without a current step the fold button sits next to «Сменить страну» in the header", () => {
  assert.match(block, /<div className="pt-journey-change">\s*\{\/\*[^]*?\*\/\}\s*\{nowRow \? null : foldButton\}\s*<button\s+ref=\{changeRef\}/u);
  assert.doesNotMatch(block, /pt-journey-fold-row/u);
  assert.doesNotMatch(css, /pt-journey-fold-row/u);
  assert.match(css, /\.pt-journey-change \{\n {2}display: flex;\n {2}flex-wrap: wrap;/u);
});
