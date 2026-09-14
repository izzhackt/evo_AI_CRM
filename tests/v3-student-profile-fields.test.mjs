import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import * as registry from "../src/lib/student-profile-fields.ts";
import * as wording from "../src/lib/v3/wording.ts";
import * as exportClient from "../src/lib/document-export-client.ts";
import { profileFieldSourceVersions } from "../src/components/v3/profile/types.ts";

const require = createRequire(import.meta.url);
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime.js");
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function compile(path, resolve = require) {
  const code = ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", code)(resolve, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

const disclosure = compile("src/components/v3/settings/StaffDisclosure.tsx");
const universityFormExport = compile("src/components/v3/profile/UniversityFormExportPanel.tsx", id => {
  if (id === "@/lib/document-export-client") return exportClient;
  if (id === "@/lib/v3/wording") return wording;
  return require(id);
});
const exportHistory = compile("src/components/v3/profile/StudentProfileExportHistory.tsx", id => {
  if (id === "@/lib/document-export-client") return exportClient;
  if (id === "@/lib/v3/wording") return wording;
  if (id === "../settings/StaffDisclosure") return disclosure;
  if (id === "./UniversityFormExportPanel") return universityFormExport;
  return require(id);
});
const unavailableCommand = async () => { throw new Error("Component-only check never executes a server command"); };
// Render the real component/React/disclosure. Network-bound action and preview
// references are inert and throw if invoked: these are not persistence tests.
const component = compile("src/components/v3/profile/StudentProfileFields.tsx", id => {
  if (id === "@/lib/student-profile-fields") return registry;
  if (id === "@/lib/v3/wording") return wording;
  if (id === "../settings/StaffDisclosure") return disclosure;
  if (id === "@/lib/platform-student-profile-field-actions") return {
    startPlatformStudentProfileAction: unavailableCommand,
    reviewPlatformStudentProfileFieldAction: unavailableCommand,
  };
  if (id === "./DocumentPreviewButton") return { DocumentPreviewButton: () => { throw new Error("No original bytes in component checks"); } };
  if (id === "./StudentProfileExportHistory") return exportHistory;
  return require(id);
});

const CASE = "10000000-0000-4000-8000-000000000001";
const PROFILE = "10000000-0000-4000-8000-000000000002";
const REQUEST = "10000000-0000-4000-8000-000000000003";
const VERSION = "10000000-0000-4000-8000-000000000004";
const TIME = "2026-09-13T10:00:00Z";
function snapshot(profile = { id: PROFILE, revision: 1 }) {
  return {
    studentCaseId: CASE, profile, canInitialize: profile === null,
    canReview: profile !== null, canExport: profile !== null,
    fields: registry.PROFILE_FIELD_KEYS.map(key => ({
      key, value: null, state: "needs_review", reviewedAt: null,
      sourceDocumentVersionId: null, sourcePage: null, proposals: [],
    })),
  };
}
function render(data, extra = {}) {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { refresh() { throw new Error("No navigation in SSR checks"); } } },
    createElement(component.StudentProfileFields, {
      snapshot: data, requestId: REQUEST, readOnly: false, sourceVersions: [], documentsHref: null, ...extra,
    }),
  ));
}

test("authorized absence exposes one explicit initialization, while read-only mode exposes none", () => {
  const missing = snapshot(null);
  const html = render(missing);
  assert.match(html, /Анкета ещё не создана/);
  assert.match(html, /Начать анкету/);
  assert.equal([...html.matchAll(/<form\b/g)].length, 1);
  assert.match(html, /name="expected_profile_revision" value="0"/);
  assert.doesNotMatch(render(missing, { readOnly: true }), /<form\b|Начать анкету/);
  missing.canInitialize = false;
  assert.doesNotMatch(render(missing), /<form\b/);
});

test("61 fields live in six initially collapsed groups; editors are mounted only on demand", () => {
  const html = render(snapshot());
  for (const label of Object.values(registry.PROFILE_GROUP_LABELS)) assert.ok(html.includes(label), label);
  assert.equal([...html.matchAll(/подтверждено<\/button>/g)].length, 6);
  assert.equal([...html.matchAll(/Проверить поле<\/button>/g)].length, 61);
  assert.ok([...html.matchAll(/aria-expanded="false"/g)].length >= 6);
  assert.doesNotMatch(html, /aria-expanded="true"|<details\b/);
  assert.doesNotMatch(html, /<textarea\b|<form\b/);
  assert.ok(html.length < 100000, "initial workspace does not render 61 hidden editor forms");
  assert.match(html, /Черновик/);
  assert.match(html, /Не заполнены обязательные поля: 9/);
});

test("confirmed empty and conflict remain visible decisions and previews cannot mutate", () => {
  const data = snapshot();
  data.fields[0] = { ...data.fields[0], state: "confirmed", reviewedAt: TIME };
  data.fields[1] = { ...data.fields[1], state: "conflict" };
  const html = render(data, { readOnly: true });
  assert.match(html, /Подтверждено: пусто/);
  assert.match(html, /Источники расходятся/);
  assert.match(html, /Только просмотр/);
  assert.doesNotMatch(html, /<form\b|<textarea\b|Подтвердить значение|Принять предложение/);
});

test("manual source selection is optional and a proposal uses its database-owned provenance", () => {
  const common = { studentCaseId: CASE, fieldKey: "student_first_name", revision: 2, requestId: REQUEST };
  const manual = component.profileFieldCommandValues({ ...common, decision: "confirm" });
  assert.deepEqual(Object.keys(manual).sort(), ["student_case_id", "field_key", "decision", "proposal_id", "expected_revision", "reason", "request_id"].sort());
  const expected = [...Object.keys(manual), "value", "source_version_id", "source_page"].sort();
  for (const decision of ["confirm", "reject_proposal"]) {
    const values = component.profileFieldCommandValues({ ...common, decision, proposalId: VERSION });
    assert.deepEqual(Object.keys(values).sort(), expected);
    assert.equal(values.proposal_id, VERSION);
    assert.equal(values.value, "");
    assert.equal(values.source_version_id, "");
    assert.equal(values.source_page, "");
  }
  const clear = component.profileFieldCommandValues({ ...common, decision: "clear" });
  assert.equal(clear.value, "");
  assert.equal(clear.proposal_id, "");
  const source = read("src/components/v3/profile/StudentProfileFields.tsx");
  assert.match(source, /selectedSourceVersionId: "", selectedSourcePage: ""/);
  assert.match(source, /name="source_version_id"/);
  assert.match(source, /name="source_page"/);
  assert.match(source, /source\?\.downloadReady\s*\? <DocumentPreviewButton/);
});

test("independent edits are retained and changed field evidence requires a fresh comparison", () => {
  const field = snapshot().fields[0];
  const draft = {
    value: "Manual draft", selectedSourceVersionId: "", selectedSourcePage: "",
    sourceValue: field.value, sourceState: field.state, sourceReviewedAt: field.reviewedAt,
    sourceVersionId: field.sourceDocumentVersionId,
  };
  assert.equal(component.profileFieldDraftIsStale(draft, field), false);
  assert.equal(component.profileFieldDraftIsStale(draft, { ...field, value: "New canonical value" }), true);
  assert.equal(component.profileFieldDraftIsStale(draft, { ...field, sourceDocumentVersionId: VERSION }), true);
  const latest = { ...field, value: "New canonical value", reviewedAt: TIME };
  const rebased = component.rebaseProfileFieldDraft(draft, latest);
  assert.equal(rebased.value, "Manual draft");
  assert.equal(component.profileFieldDraftIsStale(rebased, latest), false);
  const drafts = { student_first_name: draft, student_last_name: { ...draft, value: "Other draft" } };
  const remaining = component.withoutProfileFieldDraft(drafts, "student_first_name");
  assert.equal(remaining.student_last_name.value, "Other draft");
  assert.equal(drafts.student_first_name.value, "Manual draft");
  assert.equal(component.profileFieldSummary({ ...field, state: "confirmed", value: null }), "Подтверждено: пусто");
});

test("source metadata retains referenced previous versions and normal read-only download access", () => {
  const data = snapshot();
  data.fields[0].sourceDocumentVersionId = "previous";
  data.fields[1].sourceDocumentVersionId = "removed";
  const version = (id, number) => ({ documentVersionId: id, originalFilename: `Synthetic ${number}.pdf`, versionNumber: number, downloadReady: true });
  const documents = {
    slots: [{ currentVersionId: "current", versions: [version("unreferenced", 1), version("previous", 2), version("current", 3)] }],
    removedSlots: [{ currentVersionId: "removed", versions: [version("removed", 1), version("other-removed", 2)] }],
  };
  const selected = profileFieldSourceVersions(documents, data, false);
  assert.deepEqual(selected.map(item => item.id), ["previous", "current", "removed"]);
  assert.equal(selected.find(item => item.id === "previous").versionNumber, 2);
  assert.ok(selected.every(item => item.downloadReady));
  assert.ok(profileFieldSourceVersions(documents, data, true).every(item => !item.downloadReady));
  assert.deepEqual(profileFieldSourceVersions(documents, snapshot(null), false), []);
});

test("source wiring keeps canonical absence separate from an unrequested section", () => {
  const adapter = read("src/lib/v3/profile-source.ts");
  assert.match(adapter, /access\.studentProfile && staffHasPermission\(actor, "profile\.read\.full"\)\s*\? getPlatformStudentProfileFields\(actor, studentCaseId\)\s*: null/);
  assert.match(adapter, /profileFields: isStaffPreview\(actor\) && data\.profileFields\s*\? \{ \.\.\.data\.profileFields, canInitialize: false, canReview: false, canExport: false \}/);
  assert.match(adapter, /profileFields: null/);
  const loader = adapter.slice(adapter.indexOf("async function loadFullCase("), adapter.indexOf("function financeStopText("));
  assert.doesNotMatch(loader, /\.catch\(/);
  const profile = read("src/components/v3/profile/Profile.tsx");
  assert.match(profile, /current === "anketa"/);
  assert.match(profile, /fieldsReadOnly=\{isStaffPreview\(actor\) \|\| !staffHasPermission\(actor, "profile\.manage"\)\}/);
  assert.match(read("src/components/v3/profile/tabs.tsx"), /if \(!draft\.profileFields\) return caseFacts/);
});

test("safe outcome wording offers explicit recovery and never returns unknown domain keys", () => {
  assert.match(wording.studentProfileFieldActionMessage("unavailable"), /Повторите без изменений/);
  assert.match(wording.studentProfileFieldActionMessage("stale"), /Ваши правки сохранены на экране/);
  assert.equal(wording.studentProfileFieldState("unrecognized"), null);
  assert.equal(wording.studentProfileProposalState("unrecognized"), null);
  const source = read("src/components/v3/profile/StudentProfileFields.tsx");
  assert.match(source, /result\.status === "saved" && decision !== "reject_proposal"/);
  assert.match(source, /addEventListener\("reset", preserveDraft, true\)/);
  assert.match(source, /removeEventListener\("reset", preserveDraft, true\)/);
});

function readySnapshot() {
  const data = snapshot();
  const values = {
    student_first_name: "Synthetic", student_last_name: "Student", date_of_birth: "2005-04-12",
    nationality: "Kyrgyzstan", passport_number: "SYNTH123", permanent_address: "Synthetic address",
    mobile_phone: "+996555000001", student_email: "synthetic@example.test", field_major: "Computing",
  };
  data.fields = data.fields.map(field => ({ ...field, state: "confirmed", value: values[field.key] ?? null, reviewedAt: TIME }));
  return data;
}

test("real export controls distinguish final readiness, draft and separate download permission", t => {
  const transport = t.mock.method(globalThis, "fetch", async () => { throw new Error("No transport in SSR checks"); });
  const ready = readySnapshot();
  assert.equal(registry.getProfileReadiness(ready).ready, true);
  const html = render(ready);
  assert.match(html, /Файлы анкеты/);
  assert.match(html, /Сформировать финальную анкету/);
  assert.match(html, /Сформировать черновик/);
  assert.match(html, /aria-label="Бланк университета"/);
  assert.ok(html.includes(wording.universityFormExport.noApplications));
  const incomplete = render(snapshot());
  assert.match(incomplete, /<button[^>]*disabled=""[^>]*>Сформировать финальную анкету<\/button>/);
  assert.match(incomplete, /Что проверить перед формированием/);
  assert.match(incomplete, /Имя.*заполните обязательное поле/);
  const preview = render({ ...ready, canExport: false }, { readOnly: true });
  assert.match(preview, /<button[^>]*disabled=""[^>]*>Сформировать черновик<\/button>/);
  assert.match(preview, /Скачивание анкеты в этом режиме недоступно/);
  // SSR cannot know the workspace digest: even read-only editors must load it.
  assert.match(render(ready, { readOnly: true }), /Загружаем историю файлов/);
  assert.equal(component.profileExportBlocker({ snapshot: ready, mode: "draft", hasDrafts: false,
    pending: false, savedRevision: null, saveStatus: "idle" }), null);
  assert.equal(transport.mock.callCount(), 0);
});

test("export gates keep unsaved edits, shared pending work and unconfirmed saves out of the request", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Unexpected transport"); });
  const base = { snapshot: readySnapshot(), mode: "final", hasDrafts: false, pending: false, savedRevision: null, saveStatus: "idle" };
  const cases = [
    [{ snapshot: { ...base.snapshot, canExport: false } }, "unavailable_access"],
    [{ hasDrafts: true }, "unsaved"],
    [{ pending: true }, "saving"],
    [{ savedRevision: 2 }, "awaiting_snapshot"],
    [{ saveStatus: "unavailable" }, "save_unconfirmed"],
    [{ snapshot: snapshot() }, "profile_not_ready"],
  ];
  for (const [change, status] of cases) {
    assert.equal(component.profileExportBlocker({ ...base, ...change }), status);
  }
  const invalid = readySnapshot();
  invalid.fields.find(field => field.key === "nationality").value = "𠀀".repeat(61);
  assert.equal(component.profileExportBlocker({ ...base, snapshot: invalid, mode: "draft" }), "profile_not_ready");
  assert.equal(calls, 0);
});
