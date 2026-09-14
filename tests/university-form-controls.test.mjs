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
const { UniversityFormDecision } = compile("../src/components/v3/universities/forms/UniversityFormDecision.tsx");
const { UniversityFormMappingEditor, UniversityFormSavedFragment } = compile("../src/components/v3/universities/forms/UniversityFormMappingEditor.tsx");
const { UniversityPdfMappingEditor } = compile("../src/components/v3/universities/forms/UniversityPdfMappingEditor.tsx");
const { UniversityFormMappingHistory } = compile("../src/components/v3/universities/forms/UniversityFormMappingHistory.tsx");
const { universityFormWorkspaceMatches } = compile("../src/lib/university-form-ui.ts");

test("PDF editor renders labelled keyboard alternatives and waits for the actual private page before save", () => {
  const props = { catalogId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", templateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    revision: 2, version: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", sha256: "a".repeat(64), byte_size: 123, mime_type: "application/pdf" },
    manifest: { format: "pdf", slots: [], pageSizes: [{ width: 300, height: 400 }] }, manifestDigest: "b".repeat(64),
    mappingId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    initialMappings: [{ slotId: "pdf-1", manual: false, sourceKey: "student_first_name", format: "text", required: true,
      position: { page: 1, x: 10, y: 10, width: 100, height: 20 } }], action: () => assert.fail("SSR cannot mutate") };
  const html = renderToStaticMarkup(createElement(UniversityPdfMappingEditor, props));
  assert.match(html, /Добавить поле без мыши/u); assert.match(html, /Точное положение и размер/u);
  assert.match(html, /Отменить последнее изменение/u);
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled=""[^>]*>Сохранить настройку/u);
  assert.doesNotMatch(html, /<img|<iframe|<table/u);
  const review = renderToStaticMarkup(createElement(UniversityPdfMappingEditor, { ...props, readOnly: true }));
  assert.match(review, /Сохранённые поля и исходный бланк/u);
  assert.doesNotMatch(review, /Сохранить настройку|name="operation"|Разрешить заполнение/u);
});

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

const mapping = { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", template_version_id: version.id, template_sha256: version.sha256,
  sha256: "b".repeat(64), revision: 3, mappings: [], created_at: "2026-09-14T00:00:00Z", review: null };
function decisionMarkup(decision) {
  return renderToStaticMarkup(createElement(UniversityFormDecision, { catalogId, templateId, versionId: version.id,
    revision: 3, requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", decision,
    action: async () => { throw new Error("render must not mutate"); } }));
}
test("review control binds a saved mapping, requires confirmation and does not publish automatically", () => {
  const html = decisionMarkup({ operation: "review_mapping", mapping });
  assert.match(html, /name="mapping_id" value="ffffffff-ffff-4fff-8fff-ffffffffffff"/u);
  assert.match(html, /name="decision"/u);
  assert.match(html, /Я сверил поля с исходным бланком/u);
  assert.match(html, /type="submit" disabled=""/u);
  assert.doesNotMatch(html, /name="review_id"|Бланк доступен для заполнения/u);
});
test("publication only offers the exact approved review and remains unconfirmed initially", () => {
  assert.equal(decisionMarkup({ operation: "publish", mapping }), "");
  const approved = { ...mapping, review: { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", decision: "approved" } };
  const html = decisionMarkup({ operation: "publish", mapping: approved });
  assert.match(html, /name="review_id" value="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"/u);
  assert.match(html, /type="submit" disabled=""/u);
  assert.doesNotMatch(html, /checked=""|name="decision"/u);
});
test("archive is explicit and truthful about preserving files and history", () => {
  const html = decisionMarkup({ operation: "archive" });
  assert.match(html, /Файлы и история сохранятся/u);
  assert.match(html, /type="checkbox"[^>]*name="confirmed"/u);
  assert.match(html, /type="submit" disabled=""/u);
  assert.doesNotMatch(html, /name="mapping_id"|name="review_id"/u);
  assert.equal(wording.universityFormSourceLabel("student_first_name"), "Имя");
  assert.equal(wording.universityFormSourceLabel("assessment_result"), null);
  assert.equal(wording.universityFormSourceLabel("toString"), null);
});

test("mapping editor preserves supplied selections but waits for an authorized source preview before saving", () => {
  const mappings = [{ slotId: "p-1", sourceKey: "student_first_name", manual: false, required: true, format: "text" }];
  const html = renderToStaticMarkup(createElement(UniversityFormMappingEditor, { catalogId, templateId, revision: 3,
    version: { ...version, mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    manifest: { format: "docx", slots: [{ id: "p-1", editable: true }], pageSizes: [] }, manifestDigest: "b".repeat(64),
    mappingId: mapping.id, requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", initialMappings: mappings,
    action: async () => { throw new Error("render must not save a mapping"); } }));
  assert.ok(html.includes(wording.universityFormManagement.previewLoading));
  assert.match(html, /name="operation" value="save_mapping"/u);
  assert.match(html, /name="mappings" value="[^"]*&quot;student_first_name&quot;/u);
  assert.match(html, /type="submit" disabled=""/u);
  assert.equal((html.match(/type="submit"/gu) ?? []).length, 1);
  assert.doesNotMatch(html, /<iframe|<table|<select|Бланк доступен для заполнения/u);
});

test("every mapping in a 20-row history page has an exact link without skipping intermediate rows", () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({ ...mapping,
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`, revision: 80 - index }));
  const html = renderToStaticMarkup(createElement(UniversityFormMappingHistory, { base: `/v3/universities/${catalogId}/forms`,
    templateId, versionId: version.id, mappings: rows, selectedId: rows[8].id, before: 90, next: 61 }));
  for (const item of rows) assert.ok(html.includes(`before_mapping=90&amp;mapping=${item.id}`), item.id);
  assert.equal((html.match(/&amp;mapping=/gu) ?? []).length, 20);
  assert.match(html, /before_mapping=61/u);
  assert.equal((html.match(/aria-current="page"/gu) ?? []).length, 1);
  const short = renderToStaticMarkup(createElement(UniversityFormMappingHistory, { base: `/v3/universities/${catalogId}/forms`,
    templateId, versionId: version.id, mappings: rows.slice(0, 3), before: null, next: null }));
  assert.equal((short.match(/&amp;mapping=/gu) ?? []).length, 3);
  assert.doesNotMatch(short, /before_mapping=/u);
});

test("saved mapping review renders exact target context, date format and manual reasons without editable controls", () => {
  const slot = { id: "p-47", text: "Date of birth: ____", context: "Student section, not parent section",
    kind: "label", editable: true, manualReason: null, truncated: true };
  const html = renderToStaticMarkup(createElement(UniversityFormSavedFragment, { slot, position: 47,
    field: { slotId: "p-47", sourceKey: "date_of_birth", required: true, manual: false, format: "DD.MM.YYYY" } }));
  for (const value of ["Фрагмент 47", slot.text, slot.context, "Дата рождения", "31.12.2026", "Обязательное поле", "Фрагмент сокращён"])
    assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, /<select|<input|<button|date_of_birth|p-47/u);
  const manual = renderToStaticMarkup(createElement(UniversityFormSavedFragment, { position: 48,
    slot: { ...slot, id: "p-48", text: "Signature: ____", editable: false, manualReason: "Подпись заполняется вручную <script>" },
    field: { slotId: "p-48", sourceKey: null, required: false, manual: true, format: "text" } }));
  assert.match(manual, /Подпись заполняется вручную &lt;script&gt;/u);
  assert.match(manual, /Вручную/u); assert.doesNotMatch(manual, /<script>|<select|<input/u);
});

test("session-authorized archived history remains readable without inventing write authority", () => {
  const organizationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const workspace = { can_manage: false, template: { archived: true, organization_id: organizationId, catalog_institution_id: catalogId } };
  assert.equal(universityFormWorkspaceMatches(workspace, organizationId, catalogId), true);
  assert.equal(workspace.can_manage, false);
  assert.equal(universityFormWorkspaceMatches({ ...workspace, template: { ...workspace.template, archived: false } }, organizationId, catalogId), false);
  assert.equal(universityFormWorkspaceMatches(workspace, templateId, catalogId), false);
  assert.equal(universityFormWorkspaceMatches(workspace, organizationId, templateId), false);
});
