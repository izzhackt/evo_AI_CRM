import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/v3/settings/StaffDisclosure.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const componentModule = { exports: {} };
new Function("require", "module", "exports", code)(createRequire(import.meta.url), componentModule, componentModule.exports);

for (const label of ["Пригласить сотрудника", "Доступ", "Журнал приглашений · 2"]) {
  test(`staff disclosure ${label} starts closed and cannot mutate the DOM before hydration`, () => {
    const html = renderToStaticMarkup(createElement(componentModule.exports.StaffDisclosure, { label },
      createElement("form", null, createElement("input", { name: "reason", defaultValue: "Сохранённый черновик" })),
    ));
    assert.doesNotMatch(html, /<(?:details|summary)\b/);
    assert.match(html, /<button\b[^>]*type="button"[^>]*disabled=""/);
    assert.match(html, /aria-expanded="false"/);
    const target = html.match(/aria-controls="([^"]+)"/)?.[1];
    assert.ok(target);
    assert.ok(html.includes(`id="${target}" hidden=""`));
    assert.ok(html.includes(label));
    assert.match(html, /<form><input name="reason" value="Сохранённый черновик"\/><\/form>/);
  });
}
