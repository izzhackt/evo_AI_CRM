import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function compile(relativePath, resolve = require) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } });
  const compiled = { exports: {} };
  new Function("require", "module", "exports", outputText)(resolve, compiled, compiled.exports);
  return compiled.exports;
}
const wording = compile("../src/lib/v3/wording.ts");
const { UniversityFormCreate } = compile("../src/components/v3/universities/forms/UniversityFormCreate.tsx", (specifier) =>
  specifier === "@/lib/v3/wording" ? wording : require(specifier));

test("actual React SSR renders one labelled create control and a recovery URL without running a command", () => {
  let called = false;
  const html = renderToStaticMarkup(createElement(UniversityFormCreate, {
    catalogId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    templateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    action: async () => { called = true; throw new Error("render cannot mutate"); },
  }));
  assert.equal(called, false);
  assert.match(html, /<h2[^>]*>Новый бланк<\/h2>/u);
  const label = html.match(/<label for="([^"]+)"[^>]*>Название бланка<\/label>/u);
  assert.ok(label);
  const field = html.match(/<input\b[^>]*name="title"[^>]*>/u)?.[0];
  assert.ok(field?.includes(`id="${label[1]}"`));
  assert.match(field, /required=""/u);
  assert.match(html, /type="submit" disabled=""[^>]*>Создать бланк<\/button>/u);
  assert.match(html, /href="\/v3\/universities\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/forms"/u);
  assert.equal((html.match(/<button\b/gu) ?? []).length, 1);
  assert.doesNotMatch(html, /role="(?:tab|tablist)"|source_object_name|inspector_image|<table/u);
});

test("unknown status keys never appear as raw text or inherited object members", () => {
  assert.equal(wording.universityFormActionMessage("toString"), null);
  assert.equal(wording.universityFormActionMessage("constructor"), null);
  assert.equal(wording.universityFormActionMessage("unrecognized_database_key"), null);
  assert.match(wording.universityFormActionMessage("unavailable"), /мог сохраниться/u);
  assert.match(wording.universityFormActionMessage("not_inspected"), /ещё не завершена/u);
});
