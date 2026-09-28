import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as wording from "../src/lib/v3/wording.ts";
import * as client from "../src/lib/document-recognition-client.ts";
import * as deadline from "../src/lib/platform-task-deadline.ts";
import * as caseWorkView from "../src/components/v3/profile/case-work-view.ts";
import { DOCUMENT_RECOGNITION_STATES, DOCUMENT_RECOGNITION_CLEANUP_STATES } from "../src/lib/document-recognition.ts";

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const source = read("src/components/v3/profile/DocumentRecognitionJobs.tsx");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const compiled = { exports: {} };
new Function("require", "module", "exports", code)(id => id === "@/lib/v3/wording" ? wording
  : id === "@/lib/document-recognition-client" ? client
    : id === "@/lib/platform-task-deadline" ? deadline
      : id === "./case-work-view" ? caseWorkView
        : id === "@/components/icons" ? { Icon: () => null } : require(id), compiled, compiled.exports);
const { DocumentRecognitionJobs, DocumentRecognitionJobList } = compiled.exports;
const CASE = "10000000-0000-4000-8000-000000000001";
const SOURCE = "10000000-0000-4000-8000-000000000002";
const access = { studentCaseId: CASE, profileRevision: 7, canEnqueue: true, reviewHref: `/v3/profile?case=${CASE}&tab=anketa` };
const job = { job_id: CASE, source_version_id: SOURCE, state: "generation_unknown", cleanup_state: "unknown",
  proposal_count: 0, failure_code: "generation_unknown", updated_at: "2026-09-13T12:00:00Z" };
const renderList = (jobs, canRetry = false) => renderToStaticMarkup(createElement(DocumentRecognitionJobList,
  { jobs, reviewHref: access.reviewHref, canRetry, onRetry() { throw new Error("No command in SSR proof"); } }));

test("real component starts compact and loading; no persisted history or provider success is invented", () => {
  const html = renderToStaticMarkup(createElement(DocumentRecognitionJobs, { access, sourceVersionId: SOURCE, sourceReady: true }));
  assert.match(html, /aria-expanded="false"/); assert.match(html, /Загружаем историю/);
  assert.doesNotMatch(html, /Запрос сохранён|Предложения ждут проверки|Задание не выполнено/);
  assert.doesNotMatch(html, /<form/);
});

test("source and case history cannot accept a click before hydration", () => {
  for (const sourceVersionId of [SOURCE, null]) {
    const html = renderToStaticMarkup(createElement(DocumentRecognitionJobs,
      { access, sourceVersionId, sourceReady: sourceVersionId !== null }));
    const toggle = html.match(/<button\b[^>]*aria-controls="[^"]+"[^>]*>/)?.[0];
    assert.ok(toggle, "history has a disclosure button");
    assert.match(toggle, /\bdisabled=""/);
    assert.match(toggle, /aria-busy="true"/);
    assert.match(toggle, /aria-expanded="false"/);
    const contentId = toggle.match(/aria-controls="([^"]+)"/)?.[1];
    assert.ok(html.includes(`id="${contentId}" hidden=""`));
  }
});

test("unknown generation and cleanup remain distinct visible outcomes with an explicit retry choice", () => {
  const html = renderList([job], true);
  assert.match(html, /Исход распознавания неизвестен/);
  // The job moment is Bishkek time in mono («13.09 18:00»), not a UTC string.
  assert.match(html, /<time dateTime="2026-09-13T12:00:00Z" class="font-mono tabular-nums">13\.09(?:\.26)? 18:00<\/time>/);
  assert.doesNotMatch(html, /UTC/);
  assert.match(html, /Отсутствие не подтверждено/);
  assert.match(html, /Выбрать для нового запуска/);
  assert.doesNotMatch(renderList([job]), /Выбрать для нового запуска/);
  assert.doesNotMatch(renderList([{ ...job, state: "upload_unknown" }], true), /Выбрать для нового запуска/);
});

test("published proposals link existing human review and do not claim automatic confirmation", () => {
  const html = renderList([{ ...job, state: "review_ready", cleanup_state: "pending", failure_code: null, proposal_count: 3 }]);
  assert.match(html, /Предложений: 3/); assert.match(html, /Проверить предложения в анкете/);
  assert.match(html, /tab=anketa/); assert.match(html, /Удаление ещё не подтверждено/);
  assert.doesNotMatch(html, /автоматически подтвержден/);
});

test("case history and absent profile expose no paid command", () => {
  const history = renderToStaticMarkup(createElement(DocumentRecognitionJobs, { access, sourceVersionId: null, sourceReady: false }));
  assert.match(history, /История распознавания по делу/); assert.match(history, /включая заменённые файлы/);
  assert.doesNotMatch(history, /Распознать поля|Подтвердить запуск/);
  const absent = renderToStaticMarkup(createElement(DocumentRecognitionJobs, { access: { ...access, profileRevision: null }, sourceVersionId: SOURCE, sourceReady: true }));
  assert.match(absent, /Сначала начните анкету/); assert.doesNotMatch(absent, /Распознать поля/);
});

test("the staff-facing word is «Распознавание», never «Извлечение»", () => {
  const copy = JSON.stringify([wording.documentRecognitionCopy,
    ...["generating", "generation_unknown"].map(wording.documentRecognitionState),
    ...["document_not_eligible", "generation_unknown"].map(wording.documentRecognitionError)]);
  assert.doesNotMatch(copy, /[Ии]звлеч|[Ии]звлек/u);
  assert.equal(wording.documentRecognitionCopy.title, "Распознавание полей");
  assert.equal(wording.documentRecognitionCopy.extract, "Распознать поля");
  assert.equal(wording.documentRecognitionCopy.caseTitle, "История распознавания по делу");
});

test("all canonical states have shared human wording; internal keys have no fallback", () => {
  for (const value of DOCUMENT_RECOGNITION_STATES) assert.ok(wording.documentRecognitionState(value));
  for (const value of DOCUMENT_RECOGNITION_CLEANUP_STATES) assert.ok(wording.documentRecognitionCleanup(value));
  assert.equal(wording.documentRecognitionState("not-a-state"), null);
  assert.match(wording.documentRecognitionCopy.retryCharge, /текущими моделью, настройками и бюджетом/);
  assert.match(wording.documentRecognitionCopy.replayDetail, /тот же ID и исходные данные/);
});

test("existing document UI uses current authority hints, both histories and same-command recovery", () => {
  const profile = read("src/components/v3/profile/Profile.tsx");
  assert.match(profile, /!isStaffPreview\(actor\)/); assert.match(profile, /"document\.extract"/);
  assert.match(profile, /draft\.profileFields\?\.profile\?\.revision/);
  const documents = read("src/components/v3/profile/ProfileDocumentsClient.tsx");
  const row = read("src/components/v3/profile/DocumentRow.tsx");
  assert.match(documents, /sourceVersionId=\{null\}/); assert.match(row, /sourceVersionId=\{current\.currentVersionId\}/);
  // Э8.1: the row's «⋯» → «Распознавание» shows the version's recognition already open.
  assert.match(row, /<DocumentRecognitionJobs key=\{current\.currentVersionId\} access=\{recognition\} initiallyOpen/);
  assert.match(source, /dispatch\(unresolved\)/); assert.match(source, /setCursor\(page\.next_cursor\)/);
  assert.match(source, /setTimeout\(load, 8000\)/); assert.doesNotMatch(source, /localStorage|sessionStorage|node:crypto/);
  assert.equal([...source.matchAll(/crypto\.randomUUID\(\)/g)].length, 1);
});
