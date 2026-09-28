import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

// Production component source with its import boundaries replaced; the element
// tree is inspected directly (no DOM/browser substitute, no live backend).
function compile(path, boundary) {
  const code = ts.transpileModule(source(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", code)(
    (id) => boundary(id) ?? require(id),
    compiled,
    compiled.exports,
  );
  return compiled.exports;
}

function findElements(node, predicate, found = []) {
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, predicate, found);
    return found;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return found;
  if (predicate(node)) found.push(node);
  findElements(node.props.children, predicate, found);
  return found;
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}

test("V3 profile documents use the canonical private Storage routes", () => {
  const wrapper = source("src/components/v3/profile/Documents.tsx");
  const view = source("src/components/v3/profile/DocumentsView.tsx");
  const client = source("src/components/v3/profile/ProfileDocumentsClient.tsx");
  const row = source("src/components/v3/profile/DocumentRow.tsx");
  const types = source("src/components/v3/profile/document-types.ts");

  // The async wrapper only reads baseline options; the tab is the synchronous view (Э8.1).
  assert.match(wrapper, /return documentsView\(\{/u);
  assert.match(view, /<ProfileDocumentsClient/u);
  assert.match(view, /groups=\{visibleGroups\}/u);
  assert.match(view, /historyGroups=\{historyGroups\}/u);
  assert.match(view, /uploadAccess=\{input\.uploadAccess\}/u);
  assert.match(view, /studentCaseId=\{input\.studentCaseId\}/u);
  assert.match(view, /createRequestId=\{input\.createRequestId\}/u);
  assert.match(client, /\/api\/v2\/document-slots\/\$\{item\.id\}\/versions/u);
  assert.match(row, /\/api\/v2\/document-versions\/\$\{current\.currentVersionId\}\/download/u);
  assert.match(row, /name="request_id" value=\{uploadRequestId\}/u);
  assert.match(row, /name="file"/u);
  // Exactly the two fields the server accepts: the file and this slot's command id.
  assert.match(client, /body\.set\("file", file\);\s*body\.set\("request_id", item\.uploadRequestId\);/u);
  assert.match(client, /response\.status !== 201/u);
  assert.match(client, /documentUploadConfirmed\(payload, item\.id\)/u);
  assert.match(client, /router\.refresh\(\)/u);
  for (const file of [client, row]) assert.doesNotMatch(file, /URL\.createObjectURL|localStorage|sessionStorage/u);

  assert.match(types, /presence: Extract<DocumentPresence, "absent">/u);
  assert.match(types, /currentVersionId: null/u);
  assert.match(types, /downloadReady: false/u);
  assert.match(types, /presence: Extract<DocumentPresence, "present">/u);
  assert.match(types, /currentVersionId: string/u);
  assert.match(types, /currentVersionNumber: number/u);
  assert.match(types, /currentFilename: string/u);
  assert.match(types, /currentVersionCreatedAt: string/u);
  assert.match(row, /current\.currentFilename/u);
  assert.match(row, /current\.currentVersionNumber > 1/u);
});

test("V3 profile document row shows one state word, the version date and the reason the student sees", () => {
  const row = source("src/components/v3/profile/DocumentRow.tsx");
  const wording = source("src/lib/v3/wording.ts");
  const profileSource = source("src/lib/v3/profile-source.ts");

  // Presence stays a data attribute; the row carries one state word (the shared slot-status dictionary).
  assert.match(wording, /export type DocumentPresence = "absent" \| "present"/u);
  assert.match(row, /data-document-presence=\{item\.presence\}/u);
  assert.doesNotMatch(row, /documentPresence\(/u);
  // The old «есть/нет» word is gone from the dictionary, not only unused.
  assert.doesNotMatch(wording, /DOCUMENT_PRESENCE|documentPresence/u);
  assert.match(row, /const chip = documentStatusChip\(item\.status\);/u);
  assert.equal(row.match(/<StatusChip /gu)?.length, 1, "one state chip per row");
  assert.doesNotMatch(row, />\s*\{item\.status\}|>\s*\{[a-z.]*latestReview\.decision\}/u);
  // The date is the current version's upload moment, in Bishkek time, mono.
  assert.match(profileSource, /currentVersionCreatedAt: currentVersion\.createdAt,/u);
  assert.match(row, /<time dateTime=\{current\.currentVersionCreatedAt\} className="font-mono tabular-nums">\s*\{caseMomentLabel\(current\.currentVersionCreatedAt, today\)\}/u);
  assert.doesNotMatch(row, /submittedBy|uploadedBy|toLocale|Intl\.DateTimeFormat/u);
  assert.match(row, /Причина для студента: <span className="text-fg">\{current\.latestReview\.reason\}<\/span>/u);
  // The dropped sentence and the old two-pill presence line are gone.
  assert.doesNotMatch(row, /Принятый файл доступен для скачивания/u);
});

test("V3 profile document decision follows the live item and names the refusal of «Принять»", () => {
  const row = source("src/components/v3/profile/DocumentRow.tsx");
  const client = source("src/components/v3/profile/ProfileDocumentsClient.tsx");
  // The frozen key keeps a lost-response retry idempotent; the live key decides whether the buttons are shown.
  assert.match(row, /const \[reviewRequestId\] = useState\(item\.presence === "present" \? item\.reviewRequestId : null\);/u);
  assert.match(row, /current !== null\s*&& current\.reviewRequestId !== null && reviewRequestId !== null;/u);
  // «Решение сохранено» ends once the re-read item has its new state (the chip names it).
  assert.match(row, /review\.outcome === "saved" && item\.status !== "submitted" \? null : review\.outcome/u);
  // «Принять» carries no reason: its «invalid» is a stale page, not a missing reason.
  assert.match(row, /const APPROVE_INVALID = "Решение не принято сервером\. Обновите страницу\.";/u);
  assert.match(row, /review\.outcome === "invalid" && review\.decision === "approved"/u);
  assert.match(row, /invalid: "Укажите причину для студента — до 2000 символов\.",/u);
  // A saved decision or upload tells the list; under a filter it names where the row went.
  assert.match(row, /onReviewSaved\(item, attempt\.decision\);/u);
  assert.match(client, /onReviewSaved=\{noteMoved\}/u);
  assert.match(client, /noteMoved\(item, "submitted"\);/u);
  assert.match(client, /data-testid="v3-document-moved">\{movedText\}/u);
  // The checklist's last rule already separates the case recognition history.
  assert.match(client, /sourceVersionId=\{null\} sourceReady=\{false\} ruled=\{groups\.length === 0\}/u);
});

test("V3 profile document upload fails closed and explains every failure class", async () => {
  const client = source("src/components/v3/profile/ProfileDocumentsClient.tsx");
  const row = source("src/components/v3/profile/DocumentRow.tsx");
  const upload = await import("../src/components/v3/profile/document-upload.ts");

  assert.match(client, /!item\.uploadRequestId/u);
  assert.match(row, /сервер не выдал безопасный идентификатор команды/u);
  // Every server status class has its own words; unknown codes never reach the screen.
  const words = new Map([
    ["401", upload.documentUploadFailure(401, "authentication_required")],
    ["403", upload.documentUploadFailure(403, "forbidden")],
    ["403-item", upload.documentUploadFailure(403, "upload_not_authorized")],
    ["413", upload.documentUploadFailure(413, "file_too_large")],
    ["400-signature", upload.documentUploadFailure(400, "file_signature_mismatch")],
    ["400", upload.documentUploadFailure(400, "invalid_upload")],
    ["409-progress", upload.documentUploadFailure(409, "upload_in_progress")],
    ["409-request", upload.documentUploadFailure(409, "request_conflict")],
    ["409-scan", upload.documentUploadFailure(409, "scan_claim_expired")],
    ["422", upload.documentUploadFailure(422, "malware_detected")],
    ["429", upload.documentUploadFailure(429, "upload_rate_limited")],
    ["503", upload.documentUploadFailure(503, "malware_scanner_unavailable")],
    ["network", upload.documentUploadFailure(null, null)],
  ]);
  assert.equal(new Set([...words.values()].map((entry) => entry.message)).size, words.size - 1, "only 5xx and network share «Не удалось загрузить»");
  assert.equal(words.get("503").message, words.get("network").message);
  assert.match(words.get("network").message, /^Не удалось загрузить файл\. Повторите попытку\.$/u);
  assert.equal(words.get("network").next, "retry");
  assert.equal(words.get("429").next, "retry");
  assert.equal(words.get("409-request").next, "refresh");
  // 403 from the database for this item (accepted, removed or no right) is not the role's 403.
  assert.equal(words.get("403-item").message, "Загрузка в этот пункт недоступна: он уже принят, убран или у роли нет права. Обновите страницу.");
  assert.equal(words.get("403-item").next, "refresh");
  assert.equal(words.get("403").message, "У вашей роли нет права загружать этот документ.");
  assert.equal(upload.documentUploadFailure(403, null).message, words.get("403").message, "a refusal before sending names the role");
  assert.equal(words.get("413").next, null);
  assert.match(words.get("413").message, /25 МБ/u);
  assert.match(words.get("422").message, /вирус/u);
  assert.match(words.get("429").message, /Слишком много загрузок/u);
  for (const entry of words.values()) assert.doesNotMatch(entry.message, /[a-z]+_[a-z]+/u, "no raw server code on screen");
  assert.equal(upload.documentUploadFailure(418, "teapot").outcome, "invalid");

  // Client checks before sending mirror the server and the database.
  const file = (name, type = "application/pdf", size = 10) => ({ name, type, size });
  assert.equal(upload.documentUploadFileProblem(file("scan.pdf")), null);
  assert.match(upload.documentUploadFileProblem(file("IMG_1.HEIC", "image/heic")).message, /HEIC/u);
  assert.match(upload.documentUploadFileProblem(file("scan.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).message, /PDF, JPEG или PNG/u);
  assert.match(upload.documentUploadFileProblem(file("big.pdf", "application/pdf", 25 * 1024 * 1024 + 1)).message, /25 МБ/u);
  assert.equal(upload.documentUploadFileProblem(file("edge.pdf", "application/pdf", 25 * 1024 * 1024)), null);
  assert.match(upload.documentUploadFileProblem(file("empty.pdf", "application/pdf", 0)).message, /пустой/u);
  // 255 characters (code points, as `char_length`): an emoji counts once.
  assert.equal(upload.documentUploadFileProblem(file(`${"а".repeat(251)}.pdf`)), null);
  assert.equal(upload.documentUploadFileProblem(file(`${"😀".repeat(251)}.pdf`)), null);
  assert.match(upload.documentUploadFileProblem(file(`${"а".repeat(252)}.pdf`)).message, /255 знаков/u);
  assert.match(upload.documentUploadFileProblem(file(" scan.pdf")).message, /пробелы/u);
  assert.equal(upload.DOCUMENT_UPLOAD_HINT, "PDF, JPEG, PNG · до 25 МБ");

  assert.equal(upload.documentUploadConfirmed({ document: { documentSlotId: CASE_ID, documentVersionId: VERSION_ID, versionNumber: 1 } }, CASE_ID), true);
  assert.equal(upload.documentUploadConfirmed({ document: { documentSlotId: VERSION_ID, documentVersionId: VERSION_ID, versionNumber: 1 } }, CASE_ID), false);
  assert.equal(upload.documentUploadErrorCode({ error: "file_too_large" }), "file_too_large");
  assert.equal(upload.documentUploadErrorCode("<html>"), null);
});

test("V3 profile document upload starts on file choice; the hint and the busy state are visible", () => {
  const row = source("src/components/v3/profile/DocumentRow.tsx");
  // A hidden file field under a visible label; no separate «Сохранить» sends it.
  assert.match(row, /<label className=\{UPLOAD_LABEL\}>\s*<input\s+ref=\{fileRef\}\s+name="file"\s+type="file"[\s\S]*?className="sr-only"[\s\S]*?onChange=\{choose\}/u);
  assert.match(row, /\{sending \? "Загружаем…" : "Загрузить файл"\}/u);
  assert.match(row, /<span className="t-meta text-fg-2">\{DOCUMENT_UPLOAD_HINT\}<\/span>/u);
  assert.doesNotMatch(row, /type="submit"[^>]*>\s*\{?[^<]*Сохранить[^<]*\}?\s*<\/button>\s*<\/form>\s*\) : null\}\s*<\/div>\s*<div className="flex justify-end/u);
  assert.match(row, /if \(file\) onUpload\(item, file\);/u);
  // Before hydration the handler does not exist yet: the field is unavailable, not silently dead.
  assert.match(row, /disabled=\{!hydrated \|\| sending\}/u);
});

test("V3 profile mutates one canonical case checklist with versioned commands", () => {
  const client = source("src/components/v3/profile/ProfileDocumentsClient.tsx");
  const row = source("src/components/v3/profile/DocumentRow.tsx");
  const both = `${client}\n${row}`;
  const profileSource = source("src/lib/v3/profile-source.ts");
  const types = source("src/components/v3/profile/document-types.ts");

  assert.match(client, /createPlatformCustomDocumentSlotAction/u);
  assert.match(row, /changePlatformDocumentSlotMetadataAction/u);
  assert.match(row, /removePlatformDocumentSlotAction/u);
  assert.match(row, /setPlatformDocumentCaseLinkAction/u);
  for (const field of ["student_case_id", "document_slot_id", "expected_version", "group_label", "reason", "request_id"]) {
    assert.match(both, new RegExp(`name="${field}"`, "u"));
  }
  assert.match(row, /Файлы сохранятся в истории дела/u);
  assert.match(source("src/components/v3/profile/DocumentChecklistFeedback.tsx"), /router\.refresh\(\)/u);

  assert.match(profileSource, /new Map<string, ActiveGroup\["items"\]\[number\]\[\]>/u);
  assert.match(profileSource, /groups\.get\(slot\.groupLabel\)/u);
  assert.match(types, /intentKind: "baseline" \| "custom"/u);
  assert.match(types, /version: number/u);
});

test("V3 profile links documents to canonical applications or visa cases", () => {
  const client = source("src/components/v3/profile/DocumentRow.tsx");
  const profileSource = source("src/lib/v3/profile-source.ts");
  const types = source("src/components/v3/profile/document-types.ts");

  assert.match(types, /export type DocumentCaseLinkTarget/u);
  assert.match(types, /kind: DocumentCaseLinkTargetKind/u);
  assert.match(types, /linked: boolean/u);
  assert.match(types, /requestId: string \| null/u);

  assert.match(profileSource, /function profileDocumentCaseLinkTargets/u);
  assert.match(profileSource, /caseLinkTargetKey\(target\.kind, target\.id\)/u);
  assert.match(profileSource, /slot\.caseLinks\.entries\(\)/u);
  assert.match(
    profileSource,
    /throw new Error\("V3 profile document link projection is inconsistent\."\)/u,
  );
  assert.match(
    profileSource,
    /profileDocuments\(\s*data\.documents,\s*canUpload,\s*data\.applications,\s*data\.visa,\s*canUpload && !isStaffPreview\(actor\),\s*\)/u,
  );

  assert.match(client, /data-testid="v3-document-case-links"/u);
  assert.match(client, /data-testid="v3-document-case-link-form"/u);
  assert.match(client, /name="target_kind"/u);
  assert.match(client, /name="target_id"/u);
  assert.match(client, /name="enabled"/u);
  assert.match(client, /name="expected_version" value=\{item\.version\}/u);
  assert.match(client, /name="reason"/u);
  assert.match(client, /checked=\{target\.linked\}/u);
  assert.match(client, /state\.version !== String\(item\.version\)/u);
  assert.doesNotMatch(client, /state\.status === "saved" \|\| requestId/u);

  // The linked targets are read in the row; the link forms open under it from «⋯» → «Связи».
  const summaryCall = client.indexOf("<CaseLinkSummary item={item} />");
  const writeControls = client.indexOf('panel === "links" && canEditItem && studentCaseId');
  assert.ok(summaryCall > 0 && summaryCall < writeControls);
  assert.match(client, /data-testid="v3-document-linked-targets"/u);
  assert.match(client, /item\.caseLinkTargets\.filter\(\(target\) => target\.linked\)/u);

  for (const discriminator of [
    "application.intake",
    "application.status",
    "application.isPrimary",
    "application.universityDeadlineOn",
    "application.universityApplicationId.slice(0, 8)",
  ]) {
    assert.ok(profileSource.includes(discriminator), `missing application label discriminator: ${discriminator}`);
  }
});

test("V3 profile renders removed checklist history as a separate read-only projection", () => {
  const client = source("src/components/v3/profile/ProfileDocumentsClient.tsx");
  const profileSource = source("src/lib/v3/profile-source.ts");
  const types = source("src/components/v3/profile/document-types.ts");
  const historyComponent = client.slice(
    client.indexOf("function RemovedDocumentHistory"),
    client.indexOf("function ApplyBaselineChecklist"),
  );
  const historyItemType = types.slice(
    types.indexOf("export type RemovedDocumentItem"),
    types.indexOf("export type RemovedDocumentGroup"),
  );

  assert.match(profileSource, /workspace\.removedSlots/u);
  assert.match(profileSource, /kind: "removed"/u);
  assert.match(profileSource, /versions: Object\.freeze\(slot\.versions\.map/u);
  assert.match(types, /export type RemovedDocumentItem/u);
  assert.match(types, /export type RemovedDocumentVersion/u);
  assert.doesNotMatch(historyItemType, /uploadRequestId|metadataRequestId|removalRequestId/u);

  assert.match(historyComponent, /История удалённых пунктов/u);
  assert.match(historyComponent, /item\.removedAt/u);
  assert.match(historyComponent, /item\.removalReason/u);
  assert.match(historyComponent, /item\.versions\.map/u);
  assert.match(historyComponent, /version\.downloadReady \? \(/u);
  assert.match(historyComponent, /document-versions\/\$\{version\.id\}\/download/u);
  assert.doesNotMatch(
    historyComponent,
    /createPlatformCustomDocumentSlotAction|changePlatformDocumentSlotMetadataAction|removePlatformDocumentSlotAction|request_id|<form/u,
  );
});

test("V3 profile offers staff a one-time baseline checklist seed above the custom-item form", () => {
  const wrapper = source("src/components/v3/profile/Documents.tsx");
  const view = source("src/components/v3/profile/DocumentsView.tsx");
  const client = source("src/components/v3/profile/ProfileDocumentsClient.tsx");
  const types = source("src/components/v3/profile/document-types.ts");
  const privateDocuments = source("src/lib/platform-private-documents.ts");
  const actions = source("src/lib/platform-document-checklist-actions.ts");

  assert.match(wrapper, /listCaseBaselineChecklistOptions\(actor, studentCaseId\)/u);
  assert.match(view, /baselineOptions=\{input\.baselineOptions\}/u);
  assert.match(view, /baselineChecklistRequestId=\{input\.baselineChecklistRequestId\}/u);
  assert.match(wrapper, /uploadAccess === "allowed" && studentCaseId/u);

  assert.match(types, /export type BaselineChecklistOption = Readonly<\{/u);
  assert.match(
    privateDocuments,
    /export function normalizePlatformCaseBaselineChecklistOption/u,
  );
  assert.match(
    privateDocuments,
    /export async function listCaseBaselineChecklistOptions/u,
  );

  assert.match(actions, /export async function applyCaseBaselineChecklistAction/u);
  assert.match(client, /applyCaseBaselineChecklistAction/u);
  assert.match(client, /function ApplyBaselineChecklist/u);
  assert.match(client, /data-testid="v3-document-baseline-checklist"/u);
  assert.match(client, /name="country_requirement_version_id"/u);
  assert.match(client, /Применить базовый чек-лист/u);
  assert.match(
    client,
    /Привязка версии требований выполняется один раз; страна и степень дела будут зафиксированы\./u,
  );

  const applyComponent = client.slice(
    client.indexOf("function ApplyBaselineChecklist"),
    client.indexOf("function CreateChecklistItem"),
  );
  assert.match(applyComponent, /name="student_case_id"/u);
  assert.match(applyComponent, /name="request_id"/u);
  assert.match(applyComponent, /options\.map/u);

  const baselineRenderCall = client.indexOf("<ApplyBaselineChecklist");
  const createCallSite = client.indexOf("<CreateChecklistItem");
  assert.ok(baselineRenderCall > 0 && baselineRenderCall < createCallSite);
});

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";

function DocumentsClientMarker() { return null; }

function documentsWrapper(read) {
  const calls = [];
  const { Documents } = compile("src/components/v3/profile/Documents.tsx", (id) => {
    if (id === "@/lib/platform-task-deadline") return { dayInOrganizationTimezone: () => "2026-09-28" };
    // The synchronous tab view receives exactly what the wrapper read and issued.
    if (id === "./DocumentsView") return { documentsView: (input) => ({ type: DocumentsClientMarker, props: input }) };
    if (id === "@/lib/platform-access") {
      return {
        staffHasPermission: (actor, key) =>
          actor.systemRole === "admin" || actor.permissionKeys.includes(key),
      };
    }
    if (id === "@/lib/platform-private-documents") {
      return {
        listCaseBaselineChecklistOptions: async (...args) => {
          calls.push(args);
          return read();
        },
      };
    }
    return undefined;
  });
  return { Documents, calls };
}

const MANAGER = Object.freeze({
  systemRole: "staff",
  permissionKeys: ["document.upload", "document.manage"],
});

async function wrapperClientProps(read, actor = MANAGER, groups = []) {
  const { Documents, calls } = documentsWrapper(read);
  const tree = await Documents({
    groups,
    uploadAccess: "allowed",
    studentCaseId: CASE_ID,
    actor,
    tabHref: `/v3/profile?case=${CASE_ID}&tab=documents`,
  });
  const [client] = findElements(tree, (node) => node.type === DocumentsClientMarker);
  assert.ok(client, "Documents must render the documents client");
  return { props: client.props, calls };
}

test("V3 documents wrapper tells a failed baseline-options read apart from an empty one", async () => {
  const failed = await wrapperClientProps(() => {
    throw new Error("read failed");
  });
  assert.equal(failed.calls.length, 1);
  assert.equal(failed.props.baselineOptionsUnavailable, true);
  assert.deepEqual(failed.props.baselineOptions, []);
  assert.equal(failed.props.baselineChecklistRequestId, null);
  // A failed read never claims that templates are absent.
  assert.equal(failed.props.baselineTemplatesAbsent, false);

  const empty = await wrapperClientProps(() => []);
  assert.equal(empty.calls.length, 1);
  assert.equal(empty.props.baselineOptionsUnavailable, false);
  assert.deepEqual(empty.props.baselineOptions, []);
  assert.equal(empty.props.baselineChecklistRequestId, null);
  // Production 26.09: 0 country_requirement_versions — a quiet fact, not an error.
  assert.equal(empty.props.baselineTemplatesAbsent, true);

  // A case whose baseline was already applied reads an empty list by design
  // (the binding is one-time): that is not «no templates».
  const bound = await wrapperClientProps(() => [], MANAGER, [{
    kind: "active",
    title: "Документы",
    items: [{ id: CASE_ID, name: "Паспорт", intentKind: "baseline", presence: "absent" }],
  }]);
  assert.equal(bound.props.baselineOptionsUnavailable, false);
  assert.equal(bound.props.baselineTemplatesAbsent, false);

  const loaded = await wrapperClientProps(() => [{
    countryRequirementVersionId: VERSION_ID,
    targetCountry: "CN",
    targetDegree: "bachelor",
    programDirection: null,
    checklistVersion: 3,
    requirementCount: 7,
  }]);
  assert.equal(loaded.props.baselineOptionsUnavailable, false);
  assert.equal(loaded.props.baselineTemplatesAbsent, false);
  assert.equal(loaded.props.baselineOptions.length, 1);
  assert.equal(loaded.props.baselineOptions[0].countryRequirementVersionId, VERSION_ID);
  assert.match(loaded.props.baselineOptions[0].label, /CN · bachelor · версия 3 — 7 документов/u);
  assert.equal(typeof loaded.props.baselineChecklistRequestId, "string");

  // Without document.manage the server always refuses the read: it is not
  // attempted and no failure is claimed (unchanged hidden form).
  const uploadOnly = await wrapperClientProps(
    () => {
      throw new Error("must not be called");
    },
    { systemRole: "staff", permissionKeys: ["document.upload"] },
  );
  assert.equal(uploadOnly.calls.length, 0);
  assert.equal(uploadOnly.props.baselineOptionsUnavailable, false);
  assert.equal(uploadOnly.props.baselineTemplatesAbsent, false);
  assert.equal(uploadOnly.props.baselineChecklistRequestId, null);
});

const documentUpload = await import("../src/components/v3/profile/document-upload.ts");
const documentsViewModule = await import("../src/components/v3/profile/documents-view.ts");

function documentsClient(router) {
  return compile("src/components/v3/profile/ProfileDocumentsClient.tsx", (id) => {
    if (id === "react") {
      return {
        useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
        useActionState: (action, initial) => [initial, action, false],
        useEffect: () => {},
        useRef: (current) => ({ current }),
        useTransition: () => [false, (callback) => callback()],
      };
    }
    if (id === "next/link") return { default: () => null };
    if (id === "next/navigation") return { useRouter: () => router };
    if (id === "@/components/icons") return { Icon: () => null };
    if (id === "@/components/ui") {
      return { btnGhostCls: "btn-ghost", inputCls: "input", fieldLabelCls: "label" };
    }
    if (id === "@/components/v3/queue/queue-buttons") return { QUEUE_CONFIRM: "confirm", QUEUE_SECONDARY: "secondary" };
    if (id === "@/lib/platform-document-checklist-actions") {
      const action = async (state) => state;
      return {
        applyCaseBaselineChecklistAction: action,
        createPlatformCustomDocumentSlotAction: action,
      };
    }
    if (id === "./case-work-view") return { caseMomentLabel: () => "28.09 10:00" };
    if (id === "./DocumentChecklistFeedback") return { ChecklistFeedback: () => null, useRefreshAfterSave: () => {} };
    if (id === "./DocumentPreviewButton") return { DocumentPreviewButton: () => null };
    if (id === "./DocumentRecognitionJobs") return { DocumentRecognitionJobs: () => null };
    if (id === "./DocumentRow") return { DocumentRow: () => null, useHydrated: () => true };
    if (id === "./document-upload") return documentUpload;
    if (id === "./documents-view") return documentsViewModule;
    return undefined;
  });
}

function baselineSlot(tree) {
  const byName = (name) => findElements(tree, (node) => node.type?.name === name);
  return {
    unavailable: byName("BaselineChecklistUnavailable"),
    apply: byName("ApplyBaselineChecklist"),
    absent: findElements(tree, (node) => node.props?.["data-testid"] === "v3-document-baseline-checklist-empty"),
  };
}

test("V3 documents client shows an honest retry for a failed read and a quiet line when no template exists", () => {
  const refreshes = [];
  const router = { refresh: () => refreshes.push("refresh") };
  const { ProfileDocumentsClient } = documentsClient(router);
  const base = {
    groups: [],
    historyGroups: [],
    uploadAccess: "allowed",
    studentCaseId: CASE_ID,
    createRequestId: "33333333-3333-4333-8333-333333333333",
    today: "2026-09-28",
    checklistEmpty: true,
  };

  const failed = ProfileDocumentsClient({ ...base, baselineOptionsUnavailable: true });
  const failedSlot = baselineSlot(failed);
  assert.equal(failedSlot.unavailable.length, 1);
  assert.equal(failedSlot.apply.length, 0);
  // One empty state for the checklist itself (Э8.1), whatever the baseline read did.
  assert.match(textOf(failed), /В чек-листе пока нет документов\./u);

  const notice = failedSlot.unavailable[0].type();
  const [alert] = findElements(notice, (node) => node.props.role === "alert");
  assert.ok(alert, "the failure must be announced");
  assert.match(textOf(alert), /Не удалось загрузить базовые чек-листы\. Это не значит, что их нет/u);
  assert.doesNotMatch(textOf(notice), /rpc|error|RepositoryError|Supabase/iu);
  const [retry] = findElements(notice, (node) => node.type === "button");
  assert.equal(retry.props.type, "button");
  assert.equal(textOf(retry), "Повторить");
  retry.props.onClick();
  assert.deepEqual(refreshes, ["refresh"], "retry re-requests the server read once");

  const empty = baselineSlot(ProfileDocumentsClient({ ...base }));
  assert.equal(empty.unavailable.length, 0);
  assert.equal(empty.apply.length, 0);
  assert.equal(empty.absent.length, 0);

  // Read succeeded, nothing to apply and nothing applied: one quiet line
  // above the manual form, no alert, no danger colour.
  const absentTree = ProfileDocumentsClient({ ...base, baselineTemplatesAbsent: true });
  const absent = baselineSlot(absentTree);
  assert.equal(absent.unavailable.length, 0);
  assert.equal(absent.apply.length, 0);
  assert.equal(absent.absent.length, 1);
  assert.equal(textOf(absent.absent[0]).trim(), "Шаблонов чек-листа пока нет — документы добавляются вручную.");
  assert.doesNotMatch(absent.absent[0].props.className, /danger|accent/u);
  assert.equal(absent.absent[0].props.role, undefined);
  // Without the manual form (no command id) the line would point nowhere.
  assert.equal(baselineSlot(ProfileDocumentsClient({ ...base, createRequestId: null, baselineTemplatesAbsent: true })).absent.length, 0);
  // A failed read wins over «absent»: never both.
  const both = baselineSlot(ProfileDocumentsClient({ ...base, baselineOptionsUnavailable: true, baselineTemplatesAbsent: true }));
  assert.equal(both.unavailable.length, 1);
  assert.equal(both.absent.length, 0);

  const loaded = baselineSlot(ProfileDocumentsClient({
    ...base,
    baselineOptions: [{ countryRequirementVersionId: VERSION_ID, label: "CN" }],
    baselineChecklistRequestId: "44444444-4444-4444-8444-444444444444",
  }));
  assert.equal(loaded.unavailable.length, 0);
  assert.equal(loaded.apply.length, 1);

  const readOnly = baselineSlot(ProfileDocumentsClient({
    ...base,
    uploadAccess: "forbidden",
    baselineOptionsUnavailable: true,
  }));
  assert.equal(readOnly.unavailable.length, 0);
  assert.equal(readOnly.apply.length, 0);
});
