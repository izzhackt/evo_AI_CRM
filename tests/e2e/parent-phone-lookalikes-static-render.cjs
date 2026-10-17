"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require (тот же приём, что в
// blocks-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Статический рендер подсказки «Похоже на» (#1198, пункт 2; миграция 302):
 * НАСТОЯЩИЙ компонент `ParentPhoneLookalikesView` с СИНТЕТИЧЕСКИМИ данными (имена выдуманы,
 * номеров в ответе нет). Чтение и права решает база: supabase/tests/platform_parent_phone_lookalikes.sql.
 *
 *   node tests/e2e/parent-phone-lookalikes-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] (для tests/v3-parent-phone-lookalikes.test.mjs).
 *   node tests/e2e/parent-phone-lookalikes-static-render.cjs --page <outFile>
 *     → один HTML-файл со всеми состояниями для снимков (стили CRM подключает вызывающий).
 */

const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");

const compile = (source, fileName) =>
  ts.transpileModule(source, {
    fileName,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => {
    module._compile(compile(readFileSync(filename, "utf8"), filename), filename);
  };
}

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (request === "server-only") return originalResolve.call(this, join(ROOT, "node_modules/server-only/empty.js"), ...rest);
  if (typeof request === "string" && request.startsWith("@/")) {
    const base = join(ROOT, "src", request.slice(2));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
      if (existsSync(candidate)) return originalResolve.call(this, candidate, ...rest);
    }
  }
  return originalResolve.call(this, request, ...rest);
};
// Чтение подсказки в этом рендере не нужно: подставляем пустой источник (View его не вызывает).
const sourcePath = join(ROOT, "src/lib/v3/parent-phone-lookalikes-source.ts");
require.cache[sourcePath] = { id: sourcePath, filename: sourcePath, loaded: true, exports: { readParentPhoneLookalikes: async () => ({ status: "available", matches: [] }) } };

const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { ParentPhoneLookalikesView } = require(join(ROOT, "src/components/v3/profile/ParentPhoneLookalikes.tsx"));

const ID = (n) => `30200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AIDAI = { studentCaseId: ID(1), studentName: "Айдай Условная", relation: "mother" };
const TILEK = { studentCaseId: ID(2), studentName: "Тилек Условный", relation: "father" };
const BOTH = { studentCaseId: ID(3), studentName: "Очень Длинное Условное Имя Студента Которое Должно Переноситься По Словам", relation: "both" };

const CASES = {
  one: { status: "available", matches: [AIDAI] },
  father: { status: "available", matches: [TILEK] },
  three: { status: "available", matches: [AIDAI, TILEK, BOTH] },
  both: { status: "available", matches: [BOTH] },
  empty: { status: "available", matches: [] },
  unavailable: { status: "unavailable" },
};

const view = (state) => createElement(ParentPhoneLookalikesView, { state });

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(Object.entries(CASES).map(([name, state]) => ({ name, html: renderToStaticMarkup(view(state)) }))));
} else if (process.argv.includes("--page")) {
  const out = process.argv[process.argv.indexOf("--page") + 1];
  const body = Object.entries(CASES).map(([name, state]) =>
    `<section data-case="${name}" style="margin:0 0 24px"><p style="font:12px monospace;color:#666;margin:0 0 6px">${name}</p>${renderToStaticMarkup(view(state))}</section>`).join("\n");
  writeFileSync(out, body);
} else {
  console.error("usage: parent-phone-lookalikes-static-render.cjs --json | --page <outFile>");
  process.exit(2);
}
