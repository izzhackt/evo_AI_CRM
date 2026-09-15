import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import ts from "typescript";
import * as wording from "../src/lib/v3/wording.ts";

if (typeof React.useState !== "function") {
  test("all Admissions support assertions run with actual client SSR exports", () => {
    // Like platform-university-catalog.test.mjs: ordinary React/ReactDOM exports
    // belong in a child, not in the enclosing suite's react-server runtime.
    const env = { ...process.env, NODE_OPTIONS: "" };
    delete env.NODE_TEST_CONTEXT;
    const execution = spawnSync(process.execPath, ["--experimental-strip-types", "--test", fileURLToPath(import.meta.url)], {
      cwd: fileURLToPath(new URL("../", import.meta.url)), env,
      encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 30_000,
    });
    assert.ifError(execution.error);
    assert.equal(execution.status, 0, execution.stderr || execution.stdout);
    for (const summary of ["tests 18", "pass 18", "fail 0", "cancelled 0", "skipped 0"]) {
      assert.ok(execution.stdout.includes(`# ${summary}\n`), execution.stdout);
    }
  });
} else {
const { createElement } = React;
const { renderToStaticMarkup } = await import("react-dom/server");

// Static regression boundaries; not a substitute for live role/file acceptance.
const source = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = source("supabase/migrations/146_platform_partner_packets_student_help.sql");
const deadlines = source("supabase/migrations/145_platform_admissions_deadlines.sql");
function rpc(name) {
  const start = sql.indexOf(`CREATE FUNCTION ${name}(`);
  assert.ok(start >= 0);
  return sql.slice(start, sql.indexOf("END $$;", start) + 7);
}

test("all recorded Admissions deadline types share one scoped cursor projection", () => {
  for (const kind of ["application", "partner_reply", "correction", "offer", "passport_expiry", "visa_expiry", "eval_expiry", "entry_visa_expiry"]) {
    assert.ok(deadlines.includes(`'${kind}'`));
  }
  assert.match(deadlines, /private\.platform_can_read_student_case\(c\.organization_id,c\.id\)/u);
  assert.match(deadlines, /d\.source_key COLLATE "C"/u);
  assert.doesNotMatch(deadlines.slice(0, deadlines.indexOf("-- Preserve")), /primary_application_id/u);
  const calendar = source("src/lib/v3/calendar-contract.ts");
  assert.match(calendar, /admissions_deadline_page_v1/u);
  assert.doesNotMatch(calendar, /staff_application_deadline_page|staff_nearest_application_deadline/u);
});

test("a packet fixes approved verified private versions and requires write authority", () => {
  const prepare = rpc("platform.prepare_partner_packet_v1");
  assert.match(prepare, /require_case_operator\(a\.organization_id,a\.student_case_id,'application\.manage'\)/u);
  assert.match(prepare, /document\.read\.full/u);
  assert.match(prepare, /p_application_id IS NULL/u);
  assert.match(prepare, /prior\.application_id IS DISTINCT FROM p_application_id/u);
  for (const boundary of ["s.status='approved'", "v.integrity_status='verified'", "v.malware_status='clean'", "document_storage_bindings", "s.current_version_id", "'sha256'", "'versionNo'"]) assert.ok(prepare.includes(boundary));
  assert.match(prepare, /RETURN prior\.manifest/u);
  assert.doesNotMatch(prepare, /UPDATE platform\.(university_applications|document_versions)|packageSentOn|universitySubmittedOn/u);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON platform_private\.partner_packets/u);
  assert.match(sql, /BEFORE TRUNCATE ON platform_private\.partner_packets/u);
  assert.match(source("src/components/v3/profile/CaseOperationsForms.tsx"), /\/api\/v2\/document-versions\/\$\{file\.versionId\}\/download/u);
});

test("Student help binds the exact accessible portal case and preserves private assessments", () => {
  const authority = rpc("platform_private.require_case_operations_actor");
  assert.match(authority, /count\(\*\) FROM platform\.student_portal_cases\(\)\)<>1/u);
  assert.match(authority, /JOIN platform\.student_portal_cases\(\) portal ON portal\.case_id=s\.id/u);
  assert.match(rpc("platform.create_case_help_request_v1"), /require_case_operations_actor\(NULL,TRUE\)/u);
  const answer = rpc("platform.answer_case_help_request_v1");
  assert.match(answer, /require_case_operator\(a\.organization_id,a\.student_case_id,'case\.update\.append'\)/u);
  assert.match(answer, /p_expected_version/u);
  assert.match(answer, /40001/u);
  assert.doesNotMatch(sql, /assessment_attempts|assessment_answers|career_result|english_result/u);
});

test("case-help notifications contain identifiers only and check current case access", () => {
  const create = rpc("platform.create_case_help_request_v1");
  const notification = create.slice(create.indexOf("INSERT INTO platform.staff_notifications"));
  assert.doesNotMatch(notification, /p_subject|p_body|h\.body|h\.subject/u);
  assert.match(sql, /private\.platform_can_read_student_case/u);
  assert.match(source("src/lib/platform-staff-notifications-contract.ts"), /#case-help/u);
});

test("uncertain command retries preserve the original payload and do not silently reset", () => {
  const form = source("src/components/v3/profile/CaseOperationsForms.tsx");
  assert.match(form, /const payload = frozen\.current \?\? input; frozen\.current = payload/u);
  assert.match(form, /response\.code !== "unavailable"/u);
  assert.match(form, /visible\.code === "unavailable"\) return/u);
  const actions = source("src/lib/platform-admissions-support-actions.ts");
  assert.match(actions, /await requirePlatformStaffActor\(\)/u);
  assert.match(actions, /await requireStudentPortalActor\(\)/u);
  assert.match(actions, /isStaffPreview\(actor\)/u);
});

test("case navigation remounts scoped drafts without resetting same-case retries", () => {
  const page = source("src/app/(v3)/v3/profile/page.tsx");
  const key = page.slice(page.indexOf("<Profile\n"), page.indexOf("profile={view.profile}"));
  for (const identity of ["actor.organizationId", "actor.authUserId", "actor.systemRole", "actor.presentationRole", "routeTarget.studentCaseId", "routeTarget.leadId"]) assert.ok(key.includes(identity));
  assert.doesNotMatch(key, /randomUUID|requestId/u);
  assert.match(source("src/components/v3/profile/CaseHelpWorkspace.tsx"), /<CaseHelpPanel key=/u);
});

test("Student next action reuses canonical finance without adding payment writes", () => {
  const portal = source("src/lib/v3/portal-source.ts");
  assert.match(portal, /readStudentPortalPayments/u);
  assert.match(portal, /outstandingMinor/u);
  assert.match(source("src/components/v3/portal/OverviewView.tsx"), /\/portal\/payments/u);
  assert.doesNotMatch(source("src/lib/platform-admissions-support-actions.ts"), /payment|refund|settle_finance/iu);
});

// Actual React server markup and the component's pure UI guards. Network/action
// boundaries throw if invoked; this is isolated UI evidence, not ZIP byte or business acceptance.
const require = createRequire(import.meta.url);
const noCommand = () => { throw new Error("UI render must not read or mutate backend state"); };
const boundaries = new Proxy({}, { get: () => noCommand });
function compile(path, resolve = require) {
  const code = ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", code)(resolve, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const disclosure = compile("src/components/v3/settings/StaffDisclosure.tsx");
const common = id => {
  if (id === "@/lib/v3/wording") return wording;
  if (id === "@/lib/document-export-client" || id === "@/lib/platform-admissions-support-actions") return boundaries;
  if (id === "next/navigation") return { useRouter: () => ({ refresh: noCommand }) };
  return require(id);
};
const universityPanel = compile("src/components/v3/profile/UniversityFormExportPanel.tsx", common);
const historyUI = compile("src/components/v3/profile/StudentProfileExportHistory.tsx", id => {
  if (id === "../settings/StaffDisclosure") return disclosure;
  if (id === "./UniversityFormExportPanel") return universityPanel;
  return common(id);
});
const ui = compile("src/components/v3/profile/CaseOperationsForms.tsx", id => id === "./StudentProfileExportHistory" ? historyUI : common(id));
const words = wording.partnerPacketExport;
const CASE = "64016900-0000-4000-8000-000000000001";
const APP = "64016900-0000-4000-8000-000000000002";
const HASH = "a".repeat(64);
const original = (overrides = {}) => ({ slotId: "slot", versionId: "original-1", name: "Isolated original", sha256: HASH,
  versionNo: "1", sizeBytes: 4096, mimeType: "application/pdf", ...overrides });
const generated = (overrides = {}) => ({ id: "export-1", kind: "university_form", mode: "final", mimeType: "application/pdf",
  sizeBytes: 8192, sha256: HASH, createdAt: "2026-09-15T10:00:00Z", applicationId: APP, ...overrides });
const packet = (overrides = {}) => ({ id: "packet-1", caseId: CASE, applicationId: APP, applicationName: "Isolated application",
  createdBy: "Isolated operator", createdAt: "2026-09-15T10:00:00Z", requestId: "request-1", files: [original()], generatedExports: [], revision: HASH, ...overrides });
const packetWorkspace = (overrides = {}) => ({ files: [original()], generatedExports: [generated()], packets: [packet()],
  workspaceRevision: HASH, maxArchiveBytes: 52428800, ...overrides });

test("packet UI preserves one existing surface, clear 50 MiB cap and legacy read-only composition", () => {
  const html = renderToStaticMarkup(createElement(ui.PartnerPacketWorkspace, { caseId: CASE, active: true,
    applications: [{ id: APP, name: "Isolated application" }], workspace: packetWorkspace({ packets: [packet({ revision: null })] }) }));
  for (const text of [words.cap, words.sizeHint, words.legacy, words.manifest, words.originalDownload, words.history, words.loading]) assert.ok(html.includes(text), text);
  assert.match(html, /href="\/api\/v2\/document-versions\/original-1\/download"/u);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Сохранить финальный ZIP/u);
  assert.doesNotMatch(html, /260|localStorage|profile_revision|expected_workspace_revision|Зафиксированный состав/u);
  assert.match(source("src/components/v3/profile/PartnerPacketsPanel.tsx"), /<PartnerPacketWorkspace key=\{caseId\}/u);
});

test("original-only and generated-only preparation render without a profile or a second editor", () => {
  for (const workspace of [packetWorkspace({ generatedExports: [] }), packetWorkspace({ files: [], generatedExports: [generated({ applicationId: null })] })]) {
    const html = renderToStaticMarkup(createElement(ui.PreparePartnerPacketForm, { caseId: CASE, workspace,
      applications: [{ id: APP, name: "Isolated application" }], active: true, disabled: false, action: noCommand }));
    assert.ok(html.includes(words.prepare));
    assert.ok(!html.includes(words.prerequisites));
    assert.match(html, /<label[^>]*>Заявление<select[^>]*required=""/u);
    assert.match(html, /type="checkbox"/u);
    assert.doesNotMatch(html, /profile_not_ready|profile_revision|student_profile_id|Настройка полей|textarea/u);
  }
});

test("inactive and missing prerequisites are visible with disabled new preparation", () => {
  const html = renderToStaticMarkup(createElement(ui.PreparePartnerPacketForm, { caseId: CASE,
    workspace: packetWorkspace({ files: [], generatedExports: [] }), applications: [], active: false, disabled: false, action: noCommand }));
  assert.ok(html.includes(words.inactive)); assert.ok(html.includes(words.prerequisites));
  assert.match(html, /<fieldset disabled=""/u);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Зафиксировать пакет/u);
});

test("selection counts originals and generated together and permits exactly fifty items", () => {
  const files = Array.from({ length: 25 }, (_, i) => original({ versionId: `original-${i}` }));
  const exports = Array.from({ length: 26 }, (_, i) => generated({ id: `export-${i}` }));
  const workspace = packetWorkspace({ files, generatedExports: exports });
  const ids = files.map(file => file.versionId); const exportIds = exports.slice(0, 25).map(file => file.id);
  const selected = ui.partnerPacketSelection(workspace, APP, ids, exportIds);
  assert.deepEqual(selected, { count: 50, bytes: 25 * (4096 + 8192), missing: false, error: null });
  assert.equal(ui.partnerPacketSelection(workspace, APP, ids, [...exportIds, exports[25].id]).error, words.tooMany);
  assert.deepEqual(exportIds, exports.slice(0, 25).map(file => file.id));
});

test("selection changes fail visibly without silently removing unavailable or other-application items", () => {
  const workspace = packetWorkspace(); const versions = ["original-1", "missing-original"]; const exports = ["export-1"];
  const missing = ui.partnerPacketSelection(workspace, APP, versions, exports);
  assert.equal(missing.count, 3); assert.equal(missing.missing, true); assert.equal(missing.error, words.missing);
  assert.deepEqual(versions, ["original-1", "missing-original"]); assert.deepEqual(exports, ["export-1"]);
  assert.equal(ui.partnerPacketSelection(workspace, "another-application", ["original-1"], exports).error, words.wrongApplication);
  assert.equal(ui.partnerPacketSelection(packetWorkspace({ generatedExports: [generated({ applicationId: null })] }), APP, [], exports).error, null);
  assert.equal(ui.partnerPacketSelection(workspace, APP, [], []).error, words.emptySelection);
});

test("50 MiB precheck is inclusive and never omits excess bytes; ZIP overhead remains server checked", () => {
  const workspace = packetWorkspace({ files: [original({ sizeBytes: 26214400 }), original({ versionId: "original-2", sizeBytes: 26214400 })], generatedExports: [] });
  assert.equal(ui.partnerPacketSelection(workspace, APP, ["original-1", "original-2"], []).error, null);
  const larger = packetWorkspace({ ...workspace, generatedExports: [generated({ sizeBytes: 1 })] });
  const result = ui.partnerPacketSelection(larger, APP, ["original-1", "original-2"], ["export-1"]);
  assert.equal(result.bytes, 52428801); assert.equal(result.count, 3); assert.equal(result.error, words.tooLarge);
});

test("packet sizes stay human-readable without exposing byte counts in the main UI", () => {
  assert.equal(ui.formatPacketFileSize(52428800), "50 МБ");
  assert.equal(ui.formatPacketFileSize(1536), "1,5 КБ");
  assert.equal(ui.formatPacketFileSize(128), "меньше 1 КБ");
  assert.equal(ui.formatPacketFileSize(0), "0 КБ");
  assert.equal(words.cap, "ZIP до 50 МБ · до 50 файлов");
});

test("definite pre-write ZIP failures have human messages, not uncertain-save wording", () => {
  for (const code of ["package_not_ready", "package_too_large", "package_storage_not_ready"]) {
    assert.equal(typeof words.errors[code], "string");
    assert.ok(words.errors[code].length > 20);
    assert.doesNotMatch(words.errors[code], /Ответ не подтверждён|исходную попытку|package_/u);
  }
});

test("final ZIP disallows draft forms; draft/original-only/final generated remain eligible", () => {
  const mixed = packet({ generatedExports: [generated({ mode: "draft" })] });
  assert.equal(ui.partnerPacketZipBlocker(mixed, "final", 52428800), words.draftInFinal);
  assert.equal(ui.partnerPacketZipBlocker(mixed, "draft", 52428800), null);
  assert.equal(ui.partnerPacketZipBlocker(packet(), "final", 52428800), null);
  assert.equal(ui.partnerPacketZipBlocker(packet({ files: [], generatedExports: [generated()] }), "final", 52428800), null);
  assert.equal(ui.partnerPacketZipBlocker(packet({ revision: null }), "draft", 52428800), words.legacy);
  assert.equal(ui.partnerPacketZipBlocker(packet({ files: [original({ sizeBytes: 52428801 })] }), "final", 52428800), words.tooLarge);
});

test("actual common history renders original-only ZIP receipt with null profile and shared download/reconcile", () => {
  const receipt = { id: "zip-1", kind: "package", student_case_id: CASE, student_profile_id: null, profile_revision: null,
    template_sha256: null, field_reviews_sha256: null, mime_type: "application/zip", mode: "final", created_at: "2026-09-15T10:00:00Z",
    historical: true, state: "ready", can_download: true, failure_code: null, package: { id: "packet-1", application_id: APP, item_count: 2 } };
  const html = renderToStaticMarkup(createElement(historyUI.StudentProfileExportList, { artifacts: [receipt,
    { ...receipt, id: "zip-2", historical: false, state: "stored_unverified", can_download: false, mode: "draft" }],
    busy: false, uncertainReconciles: ["zip-2"], onDownload: noCommand, onReconcile: noCommand }));
  for (const text of ["Пакет документов · ZIP · Финальный", "Пакет документов · ZIP · Черновик", "Исторический состав · Файлов: 2", "Скачать файл", "Повторить проверку"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /версия анкеты|student_profile_id|profile_revision|stored_unverified/u);
  const failed = renderToStaticMarkup(createElement(historyUI.StudentProfileExportList, { artifacts: [{ ...receipt, state: "failed", can_download: false, failure_code: "source_changed" }], busy: false, uncertainReconciles: [], onDownload: noCommand, onReconcile: noCommand }));
  assert.ok(failed.includes(words.errors.source_changed)); assert.ok(!failed.includes(wording.studentProfileFileMessage("source_changed")));
});

test("package commands retain exact intent, serialize busy work and ignore superseded reads", () => {
  const form = source("src/components/v3/profile/CaseOperationsForms.tsx");
  for (const boundary of ["versionIds, exportIds, expectedRevision: workspace.workspaceRevision", "expected_workspace_revision: packet.revision",
    "setUnresolved({ caseId, command })", "execute(unresolved.command)", "unresolved.caseId === caseId", "if (!result.uncertain) setUnresolved(null)",
    "controller.signal.aborted || epoch !== readEpoch.current || !mounted.current", "result.workspace?.student_case_id === caseId",
    "if (inFlight.current) return false", "reconcileRequests.current.get(artifact.id) ?? crypto.randomUUID()"])
    assert.ok(form.includes(boundary), boundary);
  assert.doesNotMatch(form, /documentExportWorkspaceMatches|history\?\.can_export|history\.profile|setInterval|sessionStorage|localStorage/u);
  assert.match(form, /begin\("idle", false\)/u, "preparing a composition must not strand the first pending history read");
  assert.match(form, /!uncertain && \(invalid \|\| command.blocked\)/u, "uncertain prepare replays retained input despite refreshed selection");
});
}
