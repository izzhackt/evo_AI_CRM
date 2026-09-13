import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/v3/settings/StaffRoleControls.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const componentModule = { exports: {} };
new Function("require", "module", "exports", code)(createRequire(import.meta.url), componentModule, componentModule.exports);

test("server-rendered role controls are natively disabled until hydration without hiding content", () => {
  const html = renderToStaticMarkup(createElement(componentModule.exports.StaffRoleControls, null,
    createElement("button", { type: "button" }, "Создать роль"),
    createElement("input", { type: "search", "aria-label": "Найти роль" }),
    createElement("a", { href: "/v3/settings?section=staff&view=roles" }, "К списку ролей"),
  ));
  assert.match(html, /^<fieldset\b[^>]*\bdisabled=""/);
  assert.match(html, /^<fieldset\b[^>]*\baria-busy="true"/);
  assert.match(html, /<legend class="sr-only">Управление ролями<\/legend>/);
  assert.match(html, /<button type="button">Создать роль<\/button>/);
  assert.match(html, /<input type="search" aria-label="Найти роль"\/>/);
  assert.match(html, /<a href="[^\"]+">К списку ролей<\/a>/);
  assert.match(html, /role="status">Подготавливаем управление ролями…/);
});
