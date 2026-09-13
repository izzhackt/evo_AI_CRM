import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compiledModules = new Map();
function compile(relativePath) {
  const url = relativePath instanceof URL ? relativePath : new URL(relativePath, import.meta.url);
  if (compiledModules.has(url.href)) return compiledModules.get(url.href);
  const source = readFileSync(url, "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } });
  const compiled = { exports: {} };
  const resolve = (specifier) => {
    if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return require(specifier);
    let target = specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}`, import.meta.url) : new URL(specifier, url);
    if (!/\.tsx?$/u.test(target.pathname)) target = new URL(`${target.href}${existsSync(new URL(`${target.href}.ts`)) ? ".ts" : ".tsx"}`);
    return compile(target);
  };
  new Function("require", "module", "exports", outputText)(resolve, compiled, compiled.exports);
  compiledModules.set(url.href, compiled.exports);
  return compiled.exports;
}
const wording = compile("../src/lib/v3/wording.ts");
const { UniversityFormCreate } = compile("../src/components/v3/universities/forms/UniversityFormCreate.tsx");
const { UniversityFormUpload } = compile("../src/components/v3/universities/forms/UniversityFormUpload.tsx");
const { UniversityFormUploadStatus } = compile("../src/components/v3/universities/forms/UniversityFormUploadStatus.tsx");

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

const catalogId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", templateId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const version = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", revision: 2, sha256: "a".repeat(64), byte_size: 128, mime_type: "application/pdf" };
test("actual upload control labels file/source/date and never invokes its action while rendering", () => {
  const html = renderToStaticMarkup(createElement(UniversityFormUpload, { catalogId, templateId, revision: 1,
    reserveRequestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", uploadRequestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    action: async () => { throw new Error("render must not reserve"); } }));
  for (const label of ["Файл университета", "Откуда получен бланк", "Дата получения"])
    assert.ok(html.includes(label));
  assert.match(html, /type="file"[^>]*accept="\.pdf,\.docx,/u);
  assert.match(html, /type="date"/u);
  assert.match(html, /type="submit" disabled=""/u);
  assert.equal((html.match(/<button\b/gu) ?? []).length, 1);
  assert.doesNotMatch(html, /Файл проверен|source_reference|expected_revision|receipt_id/u);
});
test("actual uncertain status offers explicit reconciliation and confirmed cancellation, not upload again", () => {
  const receipt = { schema_version: 1, ingress_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", template_id: templateId,
    template_version_id: version.id, request_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", revision: 3, state: "unknown",
    sha256: version.sha256, byte_size: 128, inspection_receipt_id: null, failure_code: null, replayed: false, can_reconcile: true, can_cancel: true };
  const html = renderToStaticMarkup(createElement(UniversityFormUploadStatus, { catalogId, templateId, version, initialInspection: null, initialReceipt: receipt }));
  assert.match(html, /Результат загрузки требует проверки/u);
  assert.match(html, /Проверить завершение загрузки/u);
  assert.match(html, /Подтверждаю отмену загрузки этой версии/u);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Отменить загрузку<\/button>/u);
  assert.doesNotMatch(html, /Открыть исходный файл|Файл проверен|type="file"|>unknown</u);
});
test("only verified status exposes authenticated original source, without upload or cancellation controls", () => {
  const receipt = { schema_version: 1, ingress_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", template_id: templateId,
    template_version_id: version.id, request_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", revision: 3, state: "verified",
    sha256: version.sha256, byte_size: 128, inspection_receipt_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", failure_code: null, replayed: false, can_reconcile: false, can_cancel: false };
  const html = renderToStaticMarkup(createElement(UniversityFormUploadStatus, { catalogId, templateId, version, initialInspection: null, initialReceipt: receipt }));
  assert.match(html, /Файл проверен/u);
  assert.ok(html.includes(`/api/v3/university-forms/${templateId}/versions/${version.id}/source`));
  assert.doesNotMatch(html, /Отменить загрузку|Проверить завершение загрузки|Проверить статус/u);
});

// Control-flow probes of the real component callback, not mounted React or
// persistence evidence. Deferred transport makes leaving during each await exact.
function uploadLifecycleProbe({ prepare, reserve }) {
  const cleanups = [];
  let submit;
  let reserveCalls = 0, uploads = 0;
  const hooks = {
    useRef: value => ({ current: value }), useState: value => [value, () => {}], useId: () => "probe",
    useEffect: setup => cleanups.push(setup()),
    useActionState: (callback, initial) => { submit = callback; return [initial, () => {}, false]; },
  };
  const source = readFileSync(new URL("../src/components/v3/universities/forms/UniversityFormUpload.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } });
  const compiled = { exports: {} };
  const resolve = specifier => {
    if (specifier === "react") return hooks;
    if (specifier === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
    if (specifier === "next/link") return { default: () => null };
    if (specifier === "next/navigation") return { unstable_rethrow: () => {} };
    if (specifier === "@/lib/university-template-upload-client") return {
      prepareUniversityTemplateFile: prepare,
      uploadUniversityTemplateFile: async () => { uploads++; return null; },
    };
    if (specifier === "@/lib/v3/wording") return wording;
    if (specifier === "./UniversityFormUploadStatus") return { UniversityFormUploadStatus: () => null };
    throw new Error(`unexpected dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", outputText)(resolve, compiled, compiled.exports);
  compiled.exports.UniversityFormUpload({ catalogId, templateId, revision: 1,
    reserveRequestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", uploadRequestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    action: async (...args) => { reserveCalls++; return reserve(...args); } });
  return { submit: form => submit({ error: null, version: null, receipt: null, sent: false }, form),
    unmount: () => cleanups.forEach(cleanup => cleanup?.()), counts: () => ({ reserveCalls, uploads }) };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const reserved = { status: "saved", requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  receipt: { schema_version: 1, template_id: templateId, target_id: version.id, revision: 2, outcome: "reserve_version", replayed: false } };
for (const pause of ["prepare", "reserve"]) test(`leaving while ${pause} awaits never dispatches source bytes`, async () => {
  const paused = deferred(), entered = deferred();
  const file = new File(["synthetic"], "synthetic.pdf", { type: "application/pdf" });
  const prepared = { file, sha256: "a".repeat(64), byteSize: file.size, mime: file.type };
  const probe = uploadLifecycleProbe({
    prepare: () => pause === "prepare" ? (entered.resolve(), paused.promise) : Promise.resolve(prepared),
    reserve: () => pause === "reserve" ? (entered.resolve(), paused.promise) : Promise.resolve(reserved),
  });
  const form = new FormData(); form.set("file", file);
  const result = probe.submit(form);
  await entered.promise;
  probe.unmount();
  paused.resolve(pause === "prepare" ? prepared : reserved);
  await result;
  assert.deepEqual(probe.counts(), { reserveCalls: pause === "reserve" ? 1 : 0, uploads: 0 });
});
