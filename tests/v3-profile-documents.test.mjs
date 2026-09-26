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
  const client = source("src/components/v3/profile/ProfileDocumentsClient.tsx");
  const types = source("src/components/v3/profile/document-types.ts");

  assert.match(wrapper, /<ProfileDocumentsClient/u);
  assert.match(wrapper, /groups=\{activeGroups\}/u);
  assert.match(wrapper, /historyGroups=\{historyGroups\}/u);
  assert.match(wrapper, /uploadAccess=\{uploadAccess\}/u);
  assert.match(wrapper, /studentCaseId=\{studentCaseId\}/u);
  assert.match(wrapper, /createRequestId=\{createRequestId\}/u);
  assert.match(wrapper, /item\.presence === "present"/u);
  assert.match(client, /\/api\/v2\/document-slots\/\$\{item\.id\}\/versions/u);
  assert.match(client, /\/api\/v2\/document-versions\/\$\{item\.currentVersionId\}\/download/u);
  assert.match(client, /name="request_id" value=\{item\.uploadRequestId\}/u);
  assert.match(client, /name="file"/u);
  assert.match(client, /response\.status !== 201/u);
  assert.match(client, /uploadWasConfirmed\(payload, item\)/u);
  assert.match(client, /router\.refresh\(\)/u);
  assert.doesNotMatch(client, /URL\.createObjectURL|localStorage|sessionStorage/u);

  assert.match(types, /presence: Extract<DocumentPresence, "absent">/u);
  assert.match(types, /currentVersionId: null/u);
  assert.match(types, /downloadReady: false/u);
  assert.match(types, /presence: Extract<DocumentPresence, "present">/u);
  assert.match(types, /currentVersionId: string/u);
  assert.match(types, /currentVersionNumber: number/u);
  assert.match(types, /currentFilename: string/u);
  assert.match(client, /item\.currentFilename/u);
  assert.match(client, /item\.currentVersionNumber/u);
});

test("V3 profile keeps document presence separate from the canonical review decision", () => {
  const client = source("src/components/v3/profile/ProfileDocumentsClient.tsx");
  const activeChecklist = client.slice(client.indexOf("export function ProfileDocumentsClient"));
  const wording = source("src/lib/v3/wording.ts");

  assert.match(wording, /export type DocumentPresence = "absent" \| "present"/u);
  assert.match(wording, /absent: "нет"/u);
  assert.match(wording, /present: "есть"/u);
  assert.match(client, /documentPresence\(item\.presence\)/u);
  assert.doesNotMatch(activeChecklist, /submittedBy|uploadedBy|createdAt|updatedAt/u);
  assert.match(activeChecklist, /documentSlotStatus\(item\.status\)/u);
  assert.match(activeChecklist, /documentReviewDecision\(item\.latestReview\.decision\)/u);
  assert.match(activeChecklist, /item\.latestReview\.reason/u);
  assert.match(activeChecklist, /historyDate\(item\.latestReview\.reviewedAt\)/u);
  assert.doesNotMatch(activeChecklist, />\s*\{item\.status\}|>\s*\{item\.latestReview\.decision\}/u);
});

test("V3 profile document upload fails closed and explains every failure class", () => {
  const client = source("src/components/v3/profile/ProfileDocumentsClient.tsx");

  assert.match(client, /status === 401 \|\| status === 403/u);
  assert.match(client, /"invalid" \| "forbidden" \| "unavailable"/u);
  assert.match(client, /!item\.uploadRequestId/u);
  assert.match(client, /сервер не выдал безопасный идентификатор команды/u);
  assert.match(client, /Файл не отмечен как сохранённый/u);
});

test("V3 profile mutates one canonical case checklist with versioned commands", () => {
  const client = source("src/components/v3/profile/ProfileDocumentsClient.tsx");
  const profileSource = source("src/lib/v3/profile-source.ts");
  const types = source("src/components/v3/profile/document-types.ts");

  assert.match(client, /createPlatformCustomDocumentSlotAction/u);
  assert.match(client, /changePlatformDocumentSlotMetadataAction/u);
  assert.match(client, /removePlatformDocumentSlotAction/u);
  assert.match(client, /setPlatformDocumentCaseLinkAction/u);
  assert.match(client, /name="student_case_id"/u);
  assert.match(client, /name="document_slot_id"/u);
  assert.match(client, /name="expected_version"/u);
  assert.match(client, /name="group_label"/u);
  assert.match(client, /name="reason"/u);
  assert.match(client, /name="request_id"/u);
  assert.match(client, /Файлы сохранятся в истории дела/u);
  assert.match(client, /router\.refresh\(\)/u);

  assert.match(profileSource, /new Map<string, ActiveGroup\["items"\]\[number\]\[\]>/u);
  assert.match(profileSource, /groups\.get\(slot\.groupLabel\)/u);
  assert.match(types, /intentKind: "baseline" \| "custom"/u);
  assert.match(types, /version: number/u);
});

test("V3 profile links documents to canonical applications or visa cases", () => {
  const client = source("src/components/v3/profile/ProfileDocumentsClient.tsx");
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

  const summaryCall = client.indexOf("<CaseLinkSummary item={item} />");
  const writeControls = client.lastIndexOf('uploadAccess === "allowed" && studentCaseId');
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
    client.indexOf("function checklistMessage"),
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
  const client = source("src/components/v3/profile/ProfileDocumentsClient.tsx");
  const types = source("src/components/v3/profile/document-types.ts");
  const privateDocuments = source("src/lib/platform-private-documents.ts");
  const actions = source("src/lib/platform-document-checklist-actions.ts");

  assert.match(wrapper, /listCaseBaselineChecklistOptions\(actor, studentCaseId\)/u);
  assert.match(wrapper, /baselineOptions=\{baselineOptions\}/u);
  assert.match(wrapper, /baselineChecklistRequestId=\{baselineChecklistRequestId\}/u);
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
    if (id === "@/components/v3/Pill") return { Pill: () => null };
    if (id === "@/components/ui") return { Card: ({ children }) => children };
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
    if (id === "./ProfileDocumentsClient") {
      return { ProfileDocumentsClient: DocumentsClientMarker };
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

function documentsClient(router) {
  return compile("src/components/v3/profile/ProfileDocumentsClient.tsx", (id) => {
    if (id === "react") {
      return {
        useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
        useActionState: (action, initial) => [initial, action, false],
        useEffect: () => {},
        useTransition: () => [false, (callback) => callback()],
      };
    }
    if (id === "next/link") return { default: () => null };
    if (id === "next/navigation") return { useRouter: () => router };
    if (id === "@/components/v3/Pill") return { Pill: () => null };
    if (id === "@/components/ui") {
      return { btnCls: "btn", btnGhostCls: "btn-ghost", inputCls: "input", labelCls: "label" };
    }
    if (id === "@/lib/platform-document-checklist-actions") {
      const action = async (state) => state;
      return {
        applyCaseBaselineChecklistAction: action,
        changePlatformDocumentSlotMetadataAction: action,
        createPlatformCustomDocumentSlotAction: action,
        removePlatformDocumentSlotAction: action,
        setPlatformDocumentCaseLinkAction: action,
      };
    }
    if (id === "@/lib/v3/wording") {
      return {
        documentPresence: String,
        documentReviewDecision: String,
        documentSlotStatus: String,
      };
    }
    if (id === "./DocumentReviewForm") return { DocumentReviewForm: () => null };
    if (id === "./DocumentPreviewButton") return { DocumentPreviewButton: () => null };
    if (id === "./DocumentRecognitionJobs") return { DocumentRecognitionJobs: () => null };
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
  };

  const failed = ProfileDocumentsClient({ ...base, baselineOptionsUnavailable: true });
  const failedSlot = baselineSlot(failed);
  assert.equal(failedSlot.unavailable.length, 1);
  assert.equal(failedSlot.apply.length, 0);
  // The "no requirements assigned" state for the checklist itself is unchanged.
  assert.match(textOf(failed), /требования к документам ещё не назначены/u);

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
