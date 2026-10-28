"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Общая среда стендов потока «admin»: .ts/.tsx компилируются на лету (только через require, ESM-import здесь не применим),
 * `@/…` разворачивается в `src/…`, `server-only` пуст, картинки и CSS-модули — заглушки, часы страниц можно зафиксировать.
 * Файл подключают `admin-next-pages.cjs` (настоящие страницы на Node) и `admin-next-static-render.cjs` (Chromium).
 */
const { existsSync, readFileSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://iosckaqtovbbnssqcpde.supabase.co";

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
}).outputText;
for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => { module._compile(compile(readFileSync(filename, "utf8")), filename); };
}
Module._extensions[".png"] = (module, filename) => { module.exports = { src: pathToFileURL(filename).href, width: 1843, height: 842 }; };
Module._extensions[".css"] = (module) => {
  const classes = new Proxy({}, { get: (_target, key) => (key === "__esModule" ? true : key === "default" ? classes : typeof key === "string" ? key : undefined) });
  module.exports = classes;
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (request === "server-only") return originalResolve.call(this, join(ROOT, "node_modules/server-only/empty.js"), ...rest);
  if (typeof request === "string" && request.startsWith("@/")) {
    const base = join(ROOT, "src", request.slice(2));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) if (existsSync(candidate)) return originalResolve.call(this, candidate, ...rest);
    return originalResolve.call(this, base, ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

/** «Сейчас» стендов: вторник 27.10.2026, 15:00 по Бишкеку (09:00 UTC). Часы страниц — только на время рендера. */
const NOW_ISO = "2026-10-27T09:00:00.000Z";
function withFixedDate(run) {
  const RealDate = Date;
  const NOW = new RealDate(NOW_ISO).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(NOW); }
    static now() { return NOW; }
  };
  const restore = () => { globalThis.Date = RealDate; };
  return Promise.resolve().then(run).finally(restore);
}

module.exports = { ROOT, NOW_ISO, withFixedDate, join };
