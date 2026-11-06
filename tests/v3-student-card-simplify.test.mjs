// Карточка студента и «Воронка поступления» (решение владельца 06.11.2026): нужная вкладка при открытии, «Назад» туда, откуда пришли,
// понятные метки (короткое имя куратора, нет пустого чипа ИИ, «⋯» по наведению), короткая шапка и четыре-пять вкладок.
// Чистые функции проверяются как есть; разметка и CSS - по исходникам, а страницы целиком - в tests/ui-next-card.test.mjs и
// tests/v3-case-work.test.mjs (настоящая сборка на синтетических данных). Данные здесь выдуманы.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { aiConsentLine } from "../src/lib/ai-agents/consent.ts";
import {
  admissionsBoardCaseHref,
  admissionsBoardReturnHref,
  caseOpenTabForStage,
  parseAdmissionsBoardReturnTo,
} from "../src/lib/v3/admissions-board-return.ts";
import { caseSummaryParts } from "../src/components/staff/profile/case-summary-view.ts";
import { shortPersonName } from "../src/components/staff/queue/person-name.ts";
import { TABS, resolveTab, tabsFor } from "../src/components/staff/profile/types.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const CASE_ID = "cccccccc-2222-4222-8222-000000000001";
const CURATOR_ID = "aaaaaaaa-3333-4333-8333-000000000001";

test("#6: дело открывается на вкладке своего этапа: «Документы», «Вузы» (новые и подбор вузов), иначе «Обзор»", () => {
  assert.equal(caseOpenTabForStage("documents"), "documents");
  assert.equal(caseOpenTabForStage("new"), "route");
  assert.equal(caseOpenTabForStage("shortlist"), "route");
  for (const stage of ["ready_to_submit", "awaiting_decision", "confirmed", "visa", "predeparture", "arrived", "unknown", null, undefined]) {
    assert.equal(caseOpenTabForStage(stage), "overview", String(stage));
  }
  assert.equal(admissionsBoardCaseHref({ studentCaseId: CASE_ID, pipelineStage: "documents" }, "/admissions-pipeline"),
    `/profile?case=${CASE_ID}&tab=documents&returnTo=%2Fadmissions-pipeline`);
  // Явный `tab=` в адресе сильнее: страница читает его сама (resolveTab), ссылка с доски его лишь задаёт.
  assert.equal(resolveTab("route", true, { documents: true, finance: true, studentProfile: true, contract: true }, true), "route");
});

test("#6: «Назад» на доску: возврат хранит раздел, поиск, страну, куратора и этап; чужой путь, параметр и значение — отказ", () => {
  const href = admissionsBoardReturnHref({ tab: "visa", q: "Синтетический Студент", country: "CN", curator: CURATOR_ID, stage: "documents" });
  assert.equal(parseAdmissionsBoardReturnTo(href), href);
  assert.equal(parseAdmissionsBoardReturnTo("/admissions-pipeline"), "/admissions-pipeline");
  assert.equal(admissionsBoardReturnHref({ tab: null, q: "", country: null }), "/admissions-pipeline");
  const link = admissionsBoardCaseHref({ studentCaseId: CASE_ID, pipelineStage: "new" }, href);
  assert.equal(new URL(link, "https://x.invalid").searchParams.get("returnTo"), href, "возврат переживает кодирование");
  for (const bad of [
    "https://evil.invalid/admissions-pipeline", "//evil.invalid/admissions-pipeline", "/admissions-pipeline/../profile", "/admissions-pipelinex",
    "/profile?returnTo=/admissions-pipeline", "/admissions-pipeline?tab=other", "/admissions-pipeline?country=XX", "/admissions-pipeline?curator=not-a-uuid",
    "/admissions-pipeline?stage=nope", "/admissions-pipeline?q=a&q=b", "/admissions-pipeline?redirect=/x", "/admissions-pipeline?tab=visa#frag",
    "/admissions-pipeline?q=%00", `/admissions-pipeline?q=${"x".repeat(201)}`, "", null, undefined, 42,
  ]) assert.equal(parseAdmissionsBoardReturnTo(bad), null, String(bad));
  // Негодный возврат не попадает в ссылку вовсе.
  assert.doesNotMatch(admissionsBoardCaseHref({ studentCaseId: CASE_ID, pipelineStage: "new" }, "https://evil.invalid"), /returnTo/u);
  // Страница разбирает его тем же разбором и называет возврат словами; студенческий и заявочный возвраты остаются прежними.
  const page = read("src/app/(staff)/profile/page.tsx");
  assert.match(page, /parseAdmissionsBoardReturnTo\(singleSearchParam\(params\.returnTo\)\)/u);
  assert.match(page, /boardReturnTo \? "Воронка поступления"/u);
  assert.match(page, /requestsReturnTo \|\| studentsReturnTo \|\| pipelineReturnTo \? null/u);
});

test("#7: куратор на карточке доски — коротким именем, круг с буквами только украшает", () => {
  assert.equal(shortPersonName("Умут Синтетический"), "Умут С.");
  assert.equal(shortPersonName("Администратор"), "Администратор");
  const card = read("src/components/staff/admissions-pipeline-next/AdmissionsCardNext.tsx");
  assert.match(card, /<Initials name=\{curator\} size="sm" decorative \/>/u);
  assert.match(card, /\{shortPersonName\(curator\)\}/u);
  assert.match(card, /title=\{curator\}/u, "полное имя — в подсказке");
  assert.doesNotMatch(card, /<Initials name=\{curator\} size="sm" \/>/u, "голых инициалов нет");
  // Доска передаёт возврат всем карточкам и «поднятой» карточке перетаскивания.
  const boardSource = read("src/components/staff/admissions-pipeline-next/AdmissionsBoardNext.tsx");
  assert.match(boardSource, /admissionsBoardReturnHref\(\{/u);
  assert.equal([...boardSource.matchAll(/returnTo=\{returnTo\}/gu)].length, 2);
  assert.doesNotMatch(read("src/components/staff/admissions-board/board-model.ts"), /tab=route/u, "вкладка «Вузы» больше не зашита в ссылку доски");
});

test("#7: «⋯» на карточке — по наведению и фокусу на мыши, всегда на экране касания; кнопка остаётся в порядке Tab", () => {
  const card = read("src/components/staff/admissions-pipeline-next/AdmissionsCardNext.tsx");
  assert.match(card, /className="v3-card-menu absolute end-0\.5 top-0\.5"/u);
  const css = read("src/app/(staff)/staff.css");
  const block = css.slice(css.indexOf("@media (hover: hover) and (pointer: fine) {\n  .v3-world[data-surface=\"staff\"] .v3-card-menu"));
  assert.match(block, /\.v3-card-menu \{\n {4}opacity: 0;/u, "на мыши скрыто");
  assert.match(block, /\.group:hover \.v3-card-menu,/u);
  assert.match(block, /\.group:focus-within \.v3-card-menu,/u, "клавиатура: фокус внутри карточки показывает кнопку");
  assert.match(block, /\.v3-card-menu:focus-within,/u);
  assert.match(block, /\.v3-card-menu:has\(\[aria-expanded="true"\]\)/u, "открытое меню не гаснет");
  // Ни `display: none`, ни `visibility: hidden`, ни `pointer-events`: скрытая кнопка остаётся в порядке Tab.
  const rule = block.slice(0, block.indexOf("@media (prefers-reduced-motion"));
  assert.match(block, /@media \(prefers-reduced-motion: no-preference\) \{\n {2}@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?transition: opacity 120ms/u, "движение — до 200 мс и только если система разрешает");
  assert.doesNotMatch(rule, /display:\s*none|visibility:\s*hidden|pointer-events/u);
  // Без наведения (телефон, планшет) правила нет: оно целиком внутри медиазапроса, кнопка там всегда видна.
  const media = css.indexOf('@media (hover: hover) and (pointer: fine) {\n  .v3-world[data-surface="staff"] .v3-card-menu');
  assert.ok(media >= 0 && css.indexOf(".v3-card-menu {") > media, "правило `.v3-card-menu` только внутри медиазапроса наведения");
});

test("#7: согласие на ИИ — слова, а не чип «не спрашивали»; в шапке остаётся только предупреждение", () => {
  const words = (status, aiAllowed) => aiConsentLine({ status, decidedAt: status ? "2026-10-25T05:00:00Z" : null, aiAllowed }).words;
  assert.equal(words("granted", true), "Студент разрешил");
  assert.equal(words("declined", false), "Студент не разрешил");
  assert.equal(words(null, false), "Студент ещё не решил");
  assert.equal(words(null, true), "У студента нет кабинета");
  for (const [status, allowed] of [["granted", true], ["declined", false], [null, false], [null, true]]) {
    const line = aiConsentLine({ status, decidedAt: status ? "2026-10-25T05:00:00Z" : null, aiAllowed: allowed });
    assert.doesNotMatch(line.words, /не спрашивали|ИИ:/u);
    assert.match(line.hint, /помощники/u, "следствие названо");
  }
  const header = read("src/components/staff/profile/CaseHeader.tsx");
  assert.match(header, /const consent = chip && chip\.tone === "warn" \? chip : null;/u);
});

test("#9: строка сводки — «Документы 0/21 · Оплата 50%»; нет права читать — нет части", () => {
  const counts = (approved, total) => ({ total, submitted: 0, correctionRequired: 0, rejected: 0, approved, missing: total - approved });
  const line = (input) => caseSummaryParts(input).map((part) => `${part.label} ${part.value}`).join(" · ");
  assert.equal(line({ documents: counts(0, 21), documentsAwaitCurator: false, payment: { percent: 50 } }), "Документы 0/21 · Оплата 50%");
  assert.equal(line({ documents: counts(21, 21), documentsAwaitCurator: false, payment: { percent: 100 } }), "Документы 21/21 · Оплата 100%");
  assert.equal(line({ documents: null, documentsAwaitCurator: false, payment: { percent: 10 } }), "Оплата 10%", "нет чтения документов — части нет, а не «0»");
  assert.equal(line({ documents: counts(1, 2), documentsAwaitCurator: false, payment: null }), "Документы 1/2", "оплаты не видно — части нет");
  assert.equal(line({ documents: counts(0, 0), documentsAwaitCurator: false, payment: { percent: null } }), "Документы чек-лист не собран · Оплата плана платежей нет");
  assert.equal(line({ documents: counts(0, 5), documentsAwaitCurator: true, payment: null }), "Документы ждут куратора");
  assert.equal(line({ documents: null, documentsAwaitCurator: false, payment: null }), "");
});

test("#9: куратор и направление с их действиями — в «Сведениях»; шапка — этап, «Что дальше», строка", () => {
  const next = read("src/components/staff/profile/next/CaseNext.tsx");
  assert.doesNotMatch(next, /label: "Куратор"|label: "Направление"/u, "в шапке их нет");
  assert.match(next, /summary=\{parts\.length > 0/u);
  const overview = read("src/components/staff/profile/next/CaseNextOverview.tsx");
  for (const label of ["Куратор", "Направление", "Документы", "Оплата", "ИИ-помощники"]) assert.match(overview, new RegExp(`label: "${label}"`, "u"), label);
  // Значения — те же, что были в шапке: «Сменить куратора» и «Задать направление / Сменить» не потеряны.
  const values = read("src/components/staff/profile/CaseOverview.tsx");
  assert.match(values, /Сменить куратора/u);
  assert.match(values, /<CaseDirection studentCaseId=\{input\.studentCaseId\}/u);
});

test("#9: вкладки — «Обзор», «Документы», «Вузы», «Деньги», «История»; «Анкета» — раздел «Обзора» у дела; те же права", () => {
  assert.deepEqual(TABS.map((tab) => tab.title), ["Обзор", "Документы", "Вузы", "Анкета", "Деньги", "История"]);
  assert.deepEqual(TABS.map((tab) => tab.key), ["overview", "documents", "route", "anketa", "money", "history"], "адреса вкладок не менялись");
  const access = { documents: true, finance: true, studentProfile: true, contract: true };
  const full = tabsFor(true, access, true).map((tab) => tab.key);
  assert.deepEqual(full, ["overview", "documents", "route", "anketa", "money", "history"]);
  // Права вкладок не изменились: без документов — нет «Документов», без `studentProfile` — нет «Анкеты».
  assert.ok(!tabsFor(true, { ...access, documents: false }, true).some((tab) => tab.key === "documents"));
  assert.ok(!tabsFor(true, { ...access, studentProfile: false }, true).some((tab) => tab.key === "anketa"));
  const profile = read("src/components/staff/profile/Profile.tsx");
  assert.match(profile, /const anketaInOverview = nextUi && profile\.student && caseOverview !== undefined && allTabs\.some\(\(entry\) => entry\.key === "anketa"\);/u,
    "раздел виден тому же, кому была вкладка");
  assert.match(profile, /<details id="case-anketa" open=\{anketaOpen\}/u);
  assert.match(profile, /fieldsReadOnly=\{isStaffPreview\(actor\) \|\| !staffHasPermission\(actor, "profile\.manage"\)\}/u, "право правки анкеты то же");
  // Старый адрес `?tab=anketa` открывает «Обзор» с раскрытой «Анкетой»; страница передаёт сырой адрес вкладки в `Profile`.
  const page = read("src/app/(staff)/profile/page.tsx");
  assert.match(page, /requestedTab === "anketa" && Boolean\(view\?\.details\.routeTarget\.studentCaseId && view\.details\.admissions\)\s*\? "overview" : requestedTab/u);
  assert.match(page, /tab=\{requestedTab\}/u);
  assert.match(page, /next === "anketa" && anketaSection \? "#case-anketa" : ""/u);
});
