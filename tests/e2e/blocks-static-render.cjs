"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require (тот же приём, что в
// tasks-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Статический рендер общих блоков нового облика (Э1.3–Э1.4 плана редизайна,
 * `src/components/v3/blocks/`): каждый блок в своих состояниях — со словом,
 * без слова, без чтения, с неизвестным этапом. Данные синтетические.
 *
 *   node tests/e2e/blocks-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] (для tests/v3-blocks.test.mjs).
 */

const { existsSync, readFileSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");

const compile = (source, fileName) =>
  ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;

for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => {
    module._compile(compile(readFileSync(filename, "utf8"), filename), filename);
  };
}

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (typeof request === "string" && request.startsWith("@/")) {
    const base = join(ROOT, "src", request.slice(2));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
      if (existsSync(candidate)) return originalResolve.call(this, candidate, ...rest);
    }
  }
  return originalResolve.call(this, request, ...rest);
};

const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const block = (name) => require(join(ROOT, "src/components/v3/blocks", name));
const { StatusChip, StageChip } = block("StatusChip.tsx");
const { DueWord } = block("DueWord.tsx");
const { Initials } = block("Initials.tsx");
const { ProgressBar } = block("ProgressBar.tsx");
const { StageTrack } = block("StageTrack.tsx");
const { UndoToast } = block("UndoToast.tsx");
const { dueWordOf } = require(join(ROOT, "src/components/v3/queue/due-bucket.ts"));

// «Сейчас» — полдень 26.09.2026 по Бишкеку (06:00 UTC).
const NOW = new Date("2026-09-26T06:00:00.000Z");
const due = (dueOn, dueAt = null, open = true) => dueWordOf({ dueOn, dueAt }, NOW, open);

const CASES = {
  "chip-danger": createElement(StatusChip, { label: "просрочено", tone: "danger" }),
  "chip-warn-sm": createElement(StatusChip, { label: "ждёт принятия", tone: "warn", size: "sm" }),
  "chip-neutral": createElement(StatusChip, { label: "Ждём партнёра" }),
  "chip-empty": createElement(StatusChip, { label: "   ", tone: "danger" }),
  "stage-admission": createElement(StageChip, { label: "Документы", phase: "admission" }),
  "stage-visa": createElement(StageChip, { label: "Оформление визы", phase: "visa" }),
  "stage-sales-truncate": createElement(StageChip, { label: "Потенциальный клиент", phase: "sales", truncate: true }),
  "stage-empty": createElement(StageChip, { label: null, phase: "admission" }),
  "due-overdue": createElement(DueWord, { view: due("2026-09-23") }),
  "due-overdue-today": createElement(DueWord, { view: due(null, "2026-09-26T03:00:00.000Z") }),
  "due-today": createElement(DueWord, { view: due("2026-09-26") }),
  "due-tomorrow": createElement(DueWord, { view: due("2026-09-27") }),
  "due-later": createElement(DueWord, { view: due("2026-09-28") }),
  "due-closed": createElement(DueWord, { view: due("2026-09-23", null, false) }),
  "due-none": createElement(DueWord, { view: due(null) }),
  "initials": createElement(Initials, { name: "Имя Фамилия" }),
  "initials-other": createElement(Initials, { name: "Другое Имя" }),
  "initials-decorative": createElement(Initials, { name: "Имя Фамилия", decorative: true }),
  "initials-sm": createElement(Initials, { name: "Имя Фамилия", size: "sm" }),
  "initials-empty": createElement(Initials, { name: "  " }),
  "progress": createElement(ProgressBar, { done: 3, total: 7, word: "принято" }),
  "progress-full": createElement(ProgressBar, { done: 7, total: 7, word: "принято" }),
  "progress-unread": createElement(ProgressBar, { done: null, total: null, word: "принято" }),
  "progress-empty-checklist": createElement(ProgressBar, { done: 0, total: 0, word: "принято" }),
  "progress-inconsistent": createElement(ProgressBar, { done: 8, total: 7, word: "принято" }),
  "progress-fraction": createElement(ProgressBar, { done: 2.5, total: 7, word: "принято" }),
  "track-admissions": createElement(StageTrack, { kind: "admissions", current: "documents" }),
  "track-admissions-visa": createElement(StageTrack, { kind: "admissions", current: "visa" }),
  "track-sales": createElement(StageTrack, { kind: "sales", current: "qualified" }),
  "track-sales-handed": createElement(StageTrack, { kind: "sales", current: "handed_off" }),
  "track-unknown": createElement(StageTrack, { kind: "admissions", current: "admissions_validation" }),
  "track-null": createElement(StageTrack, { kind: "sales", current: null }),
  "toast": createElement(UndoToast, {
    items: [{ key: "staff:synthetic-1", message: "Задача «Синтетическая задача» завершена.", pending: false, error: null, focus: true, onUndo() {} }],
  }),
  "toast-error": createElement(UndoToast, {
    items: [{ key: "staff:synthetic-2", message: "Задача «Вторая задача» завершена.", pending: false, error: "Не удалось отменить. Обновите страницу.", focus: false, onUndo() {} }],
  }),
  "toast-empty": createElement(UndoToast, { items: [] }),
};

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(Object.entries(CASES).map(([name, node]) => ({ name, html: renderToStaticMarkup(node) }))));
} else {
  console.error("usage: blocks-static-render.cjs --json");
  process.exit(2);
}
