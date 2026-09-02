import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PlatformContractRepositoryError,
  buildPlatformContractRedirectTarget,
  normalizePlatformCaseContractWorkspace,
  parsePlatformContractManifestLines,
  parsePlatformCreateContractTemplateForm,
  parsePlatformGeneratePostContractReportForm,
  parsePlatformPostContractChecklistLines,
  parsePlatformReviewContractDraftForm,
  parsePlatformReviewPostContractReportForm,
  parsePlatformUpdatePostContractItemForm,
  validatePlatformContractTemplateText,
} from "../src/lib/platform-contract-workflow.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const STUDENT_CASE_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_ID = "33333333-3333-4333-8333-333333333333";
const TEMPLATE_ID = "44444444-4444-4444-8444-444444444444";
const SECOND_TEMPLATE_ID = "44444444-4444-4444-8444-444444444445";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";
const ITEM_ID = "66666666-6666-4666-8666-666666666666";
const SECOND_ITEM_ID = "66666666-6666-4666-8666-666666666667";
const REPORT_ID = "77777777-7777-4777-8777-777777777777";
const MEMBERSHIP_ID = "88888888-8888-4888-8888-888888888888";
const PROFILE_ID = "99999999-9999-4999-8999-999999999999";
const REQUIREMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HANDOFF_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQUEST_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AT = "2026-08-04T08:30:00+00:00";
const SHA256 = "d".repeat(64);

function source(overrides = {}) {
  return {
    id: SOURCE_ID,
    source_key: `src_${"a".repeat(40)}`,
    source_kind: "repository_contract",
    source_url: `https://github.com/izzhackt/evo_AI_CRM/commit/${"b".repeat(40)}`,
    source_revision: "revision:2026-08-04",
    review_status: "reviewed",
    reviewed_at: AT,
    ...overrides,
  };
}

function template(overrides = {}) {
  return {
    id: TEMPLATE_ID,
    organization_id: ORGANIZATION_ID,
    template_key: "contract_admissions_v1",
    title: "Synthetic admissions agreement",
    version: 1,
    status: "approved",
    source_registry_id: SOURCE_ID,
    source_revision: "revision:2026-08-04",
    field_manifest: [
      {
        field_key: "student_name",
        source_path: "student_case.student_display_name",
        value_type: "text",
        required: true,
      },
    ],
    template_text: "Student: {{student_name}}",
    template_sha256: SHA256,
    post_contract_checklist_blueprint: [
      {
        item_key: "welcome_pack",
        label: "Send welcome pack",
        owner_role: "admissions",
        next_action: "Send the approved welcome pack",
      },
    ],
    blueprint_sha256: "e".repeat(64),
    created_by_membership_id: MEMBERSHIP_ID,
    approved_by_membership_id: MEMBERSHIP_ID,
    approved_at: AT,
    retired_by_membership_id: null,
    retired_at: null,
    created_at: AT,
    ...overrides,
  };
}

function draft(overrides = {}) {
  return {
    id: DRAFT_ID,
    organization_id: ORGANIZATION_ID,
    student_case_id: STUDENT_CASE_ID,
    contract_template_version_id: TEMPLATE_ID,
    version: 1,
    status: "draft",
    input_snapshot: {
      manifest_version: 1,
      values: { student_name: "Synthetic Student" },
      sources: {
        student_case_id: STUDENT_CASE_ID,
        student_profile_id: PROFILE_ID,
        student_profile_revision: 2,
        country_requirement_version_id: REQUIREMENT_ID,
        country_requirement_version: 3,
        student_case_op_handoff_id: HANDOFF_ID,
      },
    },
    input_sha256: "f".repeat(64),
    rendered_text: "Student: Synthetic Student",
    rendered_sha256: "1".repeat(64),
    created_by_membership_id: MEMBERSHIP_ID,
    reviewed_by_membership_id: null,
    reviewed_at: null,
    created_at: AT,
    ...overrides,
  };
}

function item(overrides = {}) {
  return {
    id: ITEM_ID,
    organization_id: ORGANIZATION_ID,
    student_case_id: STUDENT_CASE_ID,
    contract_template_version_id: TEMPLATE_ID,
    item_key: "welcome_pack",
    label: "Send welcome pack",
    status: "open",
    owner_role: "admissions",
    owner_membership_id: MEMBERSHIP_ID,
    next_action: "Send the approved welcome pack",
    evidence_ref: null,
    revision: 1,
    created_by_membership_id: MEMBERSHIP_ID,
    updated_by_membership_id: MEMBERSHIP_ID,
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

function reportSnapshotItem(overrides = {}) {
  const current = item();
  return {
    id: current.id,
    item_key: current.item_key,
    label: current.label,
    status: current.status,
    owner_role: current.owner_role,
    owner_membership_id: current.owner_membership_id,
    next_action: current.next_action,
    evidence_ref: current.evidence_ref,
    revision: current.revision,
    updated_at: current.updated_at,
    ...overrides,
  };
}

function report(overrides = {}) {
  return {
    id: REPORT_ID,
    organization_id: ORGANIZATION_ID,
    student_case_id: STUDENT_CASE_ID,
    contract_template_version_id: TEMPLATE_ID,
    version: 1,
    status: "draft",
    total_item_count: 1,
    delivered_item_count: 0,
    open_item_count: 1,
    in_progress_item_count: 0,
    blocked_item_count: 0,
    item_snapshot: [reportSnapshotItem()],
    report_sha256: "2".repeat(64),
    created_by_membership_id: MEMBERSHIP_ID,
    reviewed_by_membership_id: null,
    reviewed_at: null,
    created_at: AT,
    ...overrides,
  };
}

function workspace(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    student_case_id: STUDENT_CASE_ID,
    actor_role: "admin",
    can_manage_templates: true,
    can_generate_contract: true,
    can_review_contract: true,
    can_manage_post_contract: true,
    can_review_report: true,
    reviewed_sources: [source()],
    templates: [template()],
    drafts: [draft()],
    items: [item()],
    reports: [report()],
    ...overrides,
  };
}

function clone(value) {
  return structuredClone(value);
}

function rejectsWorkspace(value) {
  assert.throws(
    () => normalizePlatformCaseContractWorkspace(value),
    (error) =>
      error instanceof PlatformContractRepositoryError &&
      error.message === "Platform contract workspace is unavailable.",
  );
}

test("normalizes the exact typed BW6 workspace without provider bodies", () => {
  const parsed = normalizePlatformCaseContractWorkspace(workspace(), {
    organizationId: ORGANIZATION_ID,
    studentCaseId: STUDENT_CASE_ID,
    actorRole: "admin",
  });

  assert.equal(parsed.organizationId, ORGANIZATION_ID);
  assert.equal(parsed.templates[0].fieldManifest[0].fieldKey, "student_name");
  assert.equal(parsed.drafts[0].renderedText, "Student: Synthetic Student");
  assert.deepEqual(parsed.drafts[0].inputSnapshot.values, {
    student_name: "Synthetic Student",
  });
  assert.equal(parsed.items[0].ownerMembershipId, MEMBERSHIP_ID);
  assert.equal(parsed.reports[0].openItemCount, 1);
  assert.equal(parsed.reports[0].contractTemplateVersionId, TEMPLATE_ID);
  assert.equal(parsed.reports[0].itemSnapshot[0].itemKey, "welcome_pack");
});

test("rejects a report snapshot that mixes checklist template versions", () => {
  const secondItem = item({
    id: SECOND_ITEM_ID,
    contract_template_version_id: SECOND_TEMPLATE_ID,
    item_key: "second_template_item",
  });
  rejectsWorkspace(
    workspace({
      templates: [
        template(),
        template({
          id: SECOND_TEMPLATE_ID,
          template_key: "contract_admissions_v2",
          version: 2,
        }),
      ],
      items: [item(), secondItem],
      reports: [
        report({
          item_snapshot: [reportSnapshotItem({
            id: SECOND_ITEM_ID,
            item_key: "second_template_item",
          })],
        }),
      ],
    }),
  );
});

test("maps the database curator role to the Admissions interface role", () => {
  const parsed = normalizePlatformCaseContractWorkspace(
    workspace({
      actor_role: "curator",
      can_manage_templates: false,
      can_manage_post_contract: false,
      can_review_report: false,
      reviewed_sources: [],
      items: [],
      reports: [],
    }),
  );
  assert.equal(parsed.actorRole, "admissions");
  assert.equal(parsed.templates[0].status, "approved");
});

test("rejects an interface role leaked through the database workspace payload", () => {
  rejectsWorkspace(workspace({ actor_role: "admissions" }));
});

test("parses strict manifest, template and checklist line grammars", () => {
  const manifest = parsePlatformContractManifestLines(
    "student_name|student_case.student_display_name|text|true\n" +
      "confirmed_at|student_case.contract_confirmed_at|timestamp|true",
  );
  assert.ok(manifest);
  assert.deepEqual(manifest.map((field) => field.fieldKey), [
    "student_name",
    "confirmed_at",
  ]);
  assert.equal(
    validatePlatformContractTemplateText(
      "Student {{student_name}}\nConfirmed {{confirmed_at}}",
      manifest,
    ),
    "Student {{student_name}}\nConfirmed {{confirmed_at}}",
  );

  const blueprint = parsePlatformPostContractChecklistLines(
    "welcome_pack|Send welcome pack|admissions|Send the approved welcome pack",
  );
  assert.ok(blueprint);
  assert.equal(blueprint[0].ownerRole, "admissions");
});

test("parses a strict Next Server Action form and reuses its request UUID", () => {
  const form = new FormData();
  form.set("student_case_id", STUDENT_CASE_ID);
  form.set("template_key", "contract_admissions_v1");
  form.set("title", "Synthetic admissions agreement");
  form.set("source_registry_id", SOURCE_ID);
  form.set(
    "manifest_lines",
    "student_name|student_case.student_display_name|text|true",
  );
  form.set(
    "template_text",
    "Synthetic agreement\r\nStudent: {{student_name}}",
  );
  form.set(
    "checklist_lines",
    "welcome_pack|Send welcome pack|admissions|Send the approved welcome pack",
  );
  form.set("reason", "Create reviewed synthetic template");
  form.set("request_id", REQUEST_ID);
  form.set("$ACTION_ID_synthetic", "");

  const parsed = parsePlatformCreateContractTemplateForm(form);
  assert.ok(parsed);
  assert.equal(parsed.requestId, REQUEST_ID);
  assert.equal(
    parsed.templateText,
    "Synthetic agreement\nStudent: {{student_name}}",
  );
  assert.equal(parsed.fieldManifest[0].sourcePath, "student_case.student_display_name");

  form.set("unexpected_business_field", "must still fail closed");
  assert.equal(parsePlatformCreateContractTemplateForm(form), null);
});

test("requires an explicit checklist template for report generation", () => {
  const form = new FormData();
  form.set("student_case_id", STUDENT_CASE_ID);
  form.set("contract_template_version_id", TEMPLATE_ID);
  form.set("reason", "Generate the selected checklist report");
  form.set("request_id", REQUEST_ID);
  form.set("$ACTION_ID_synthetic", "");

  assert.deepEqual(parsePlatformGeneratePostContractReportForm(form), {
    studentCaseId: STUDENT_CASE_ID,
    contractTemplateVersionId: TEMPLATE_ID,
    reason: "Generate the selected checklist report",
    requestId: REQUEST_ID,
  });

  form.set("unexpected_business_field", "must fail closed");
  assert.equal(parsePlatformGeneratePostContractReportForm(form), null);
  form.delete("unexpected_business_field");
  form.delete("contract_template_version_id");
  assert.equal(parsePlatformGeneratePostContractReportForm(form), null);
});

test("rejects unknown keys at the workspace and nested-row boundaries", () => {
  rejectsWorkspace({ ...workspace(), raw_provider_payload: {} });

  const nested = clone(workspace());
  nested.templates[0].document_body = "not allowed";
  rejectsWorkspace(nested);

  const snapshot = clone(workspace());
  snapshot.drafts[0].input_snapshot.sources.chat_message_id = DRAFT_ID;
  rejectsWorkspace(snapshot);
});

test("rejects invalid source URLs, hashes, timestamps, roles and statuses", () => {
  const invalidUrl = clone(workspace());
  invalidUrl.reviewed_sources[0].source_url = "https://example.test/raw";
  rejectsWorkspace(invalidUrl);

  const invalidHash = clone(workspace());
  invalidHash.templates[0].template_sha256 = "not-a-hash";
  rejectsWorkspace(invalidHash);

  const invalidTimestamp = clone(workspace());
  invalidTimestamp.templates[0].created_at = "2026-08-04";
  rejectsWorkspace(invalidTimestamp);

  const impossibleTimestamp = clone(workspace());
  impossibleTimestamp.templates[0].created_at = "2026-02-30T08:30:00+00:00";
  rejectsWorkspace(impossibleTimestamp);

  rejectsWorkspace(workspace({ actor_role: "finance" }));

  const invalidTemplateStatus = clone(workspace());
  invalidTemplateStatus.templates[0].status = "published";
  rejectsWorkspace(invalidTemplateStatus);

  const invalidItemStatus = clone(workspace());
  invalidItemStatus.items[0].status = "done";
  rejectsWorkspace(invalidItemStatus);

  const invalidReportStatus = clone(workspace());
  invalidReportStatus.reports[0].status = "final";
  rejectsWorkspace(invalidReportStatus);
});

test("rejects HTML, unsafe controls and unresolved rendered placeholders", () => {
  const htmlTemplate = clone(workspace());
  htmlTemplate.templates[0].template_text =
    "<script>alert(1)</script> {{student_name}}";
  rejectsWorkspace(htmlTemplate);

  const controlTemplate = clone(workspace());
  controlTemplate.templates[0].title = "Unsafe\u0000title";
  rejectsWorkspace(controlTemplate);

  const htmlOutput = clone(workspace());
  htmlOutput.drafts[0].rendered_text = "<b>Synthetic Student</b>";
  rejectsWorkspace(htmlOutput);

  const unresolvedOutput = clone(workspace());
  unresolvedOutput.drafts[0].rendered_text = "Student: {{student_name}}";
  rejectsWorkspace(unresolvedOutput);
});

test("rejects duplicate and unknown manifest or checklist definitions", () => {
  const oneField = parsePlatformContractManifestLines(
    "student_name|student_case.student_display_name|text|true",
  );
  assert.ok(oneField);
  assert.equal(
    validatePlatformContractTemplateText(
      "{{student_name}} and again {{student_name}}",
      oneField,
    ),
    null,
  );
  assert.equal(
    parsePlatformContractManifestLines(
      "student_name|student_case.student_display_name|text|true\n" +
        "student_name|student_case.target_country|text|true",
    ),
    null,
  );
  assert.equal(
    parsePlatformContractManifestLines(
      "student_name|student_case.student_display_name|text|true\n" +
        "display_name|student_case.student_display_name|text|true",
    ),
    null,
  );
  assert.equal(
    parsePlatformContractManifestLines(
      "student_name|chat.latest_message|text|true",
    ),
    null,
  );
  assert.equal(
    parsePlatformContractManifestLines(
      "student_name|student_case.student_display_name|html|true",
    ),
    null,
  );
  assert.equal(
    parsePlatformContractManifestLines(
      "student_name|student_case.student_display_name|integer|true",
    ),
    null,
  );
  assert.equal(
    parsePlatformPostContractChecklistLines(
      "welcome_pack|Send welcome pack|admissions|Send it\n" +
        "welcome_pack|Duplicate|admin|Repeat it",
    ),
    null,
  );
  assert.equal(
    parsePlatformPostContractChecklistLines(
      "welcome_pack|Send welcome pack|sales|Send it",
    ),
    null,
  );
});

test("rejects FormData multi-values, arbitrary JSON fields and unsafe decisions", () => {
  const createForm = new FormData();
  createForm.set("student_case_id", STUDENT_CASE_ID);
  createForm.set("template_key", "contract_admissions_v1");
  createForm.append("template_key", "contract_replayed_v1");
  createForm.set("title", "Synthetic admissions agreement");
  createForm.set("source_registry_id", SOURCE_ID);
  createForm.set(
    "manifest_lines",
    "student_name|student_case.student_display_name|text|true",
  );
  createForm.set("template_text", "Student: {{student_name}}");
  createForm.set(
    "checklist_lines",
    "welcome_pack|Send welcome pack|admissions|Send the approved welcome pack",
  );
  createForm.set("reason", "Create reviewed synthetic template");
  createForm.set("request_id", REQUEST_ID);
  assert.equal(parsePlatformCreateContractTemplateForm(createForm), null);

  const arbitraryJson = new FormData();
  for (const [key, value] of createForm.entries()) arbitraryJson.set(key, value);
  arbitraryJson.delete("template_key");
  arbitraryJson.set("template_key", "contract_admissions_v1");
  arbitraryJson.set("field_manifest", "{};");
  assert.equal(parsePlatformCreateContractTemplateForm(arbitraryJson), null);

  for (const parser of [
    parsePlatformReviewContractDraftForm,
    parsePlatformReviewPostContractReportForm,
  ]) {
    const form = new FormData();
    form.set("student_case_id", STUDENT_CASE_ID);
    form.set(
      parser === parsePlatformReviewContractDraftForm
        ? "student_case_contract_draft_id"
        : "post_contract_report_id",
      parser === parsePlatformReviewContractDraftForm ? DRAFT_ID : REPORT_ID,
    );
    form.set("decision", "approve");
    form.set("reason", "Unsafe decision spelling");
    form.set("request_id", REQUEST_ID);
    assert.equal(parser(form), null);
  }
});

test("validates item status shape and strict scalar FormData", () => {
  const form = new FormData();
  form.set("student_case_id", STUDENT_CASE_ID);
  form.set("post_contract_item_id", ITEM_ID);
  form.set("expected_revision", "1");
  form.set("status", "delivered");
  form.set("owner_membership_id", MEMBERSHIP_ID);
  form.set("next_action", "");
  form.set("evidence_ref", "platform-document:synthetic-evidence");
  form.set("reason", "Record reviewed synthetic delivery evidence");
  form.set("request_id", REQUEST_ID);
  assert.equal(parsePlatformUpdatePostContractItemForm(form)?.status, "delivered");

  form.append("request_id", "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  assert.equal(parsePlatformUpdatePostContractItemForm(form), null);
});

test("keeps redirects and retry metadata bounded and replay-safe", () => {
  const retry = buildPlatformContractRedirectTarget(
    STUDENT_CASE_ID,
    "unavailable",
    {
      requestId: REQUEST_ID,
      operation: "review_draft",
      subjectId: DRAFT_ID,
    },
  );
  assert.equal(
    retry,
    `/clients/${STUDENT_CASE_ID}?bw6_result=unavailable&bw6_retry_request_id=${REQUEST_ID}&bw6_retry_operation=review_draft&bw6_subject_id=${DRAFT_ID}#contract-workflow`,
  );

  const badRequest = buildPlatformContractRedirectTarget(
    STUDENT_CASE_ID,
    "unavailable",
    { requestId: "not-a-uuid", operation: "review_draft", subjectId: DRAFT_ID },
  );
  assert.doesNotMatch(badRequest, /bw6_retry_/);

  const badSubject = buildPlatformContractRedirectTarget(
    STUDENT_CASE_ID,
    "invalid",
    { requestId: REQUEST_ID, operation: "review_draft", subjectId: "javascript:1" },
  );
  assert.doesNotMatch(badSubject, /bw6_retry_/);

  const noReplayOnSuccess = buildPlatformContractRedirectTarget(
    STUDENT_CASE_ID,
    "draft_approved",
    { requestId: REQUEST_ID, operation: "review_draft", subjectId: DRAFT_ID },
  );
  assert.doesNotMatch(noReplayOnSuccess, /bw6_retry_/);
});

test("actions use live guards and RPC-only persistence without legacy/provider imports", () => {
  const workflow = readFileSync(
    new URL("../src/lib/platform-contract-workflow.ts", import.meta.url),
    "utf8",
  );
  const actions = readFileSync(
    new URL("../src/lib/platform-contract-actions.ts", import.meta.url),
    "utf8",
  );

  for (const actionName of [
    "createPlatformContractTemplateVersionAction",
    "approvePlatformContractTemplateVersionAction",
    "retirePlatformContractTemplateVersionAction",
    "generatePlatformStudentCaseContractDraftAction",
    "reviewPlatformStudentCaseContractDraftAction",
    "seedPlatformPostContractItemsAction",
    "updatePlatformPostContractItemAction",
    "generatePlatformPostContractReportAction",
    "reviewPlatformPostContractReportAction",
  ]) {
    assert.match(actions, new RegExp(`export async function ${actionName}`));
  }
  assert.match(actions, /requirePlatformClientsActor\(\)/);
  assert.match(actions, /getPlatformCaseContractWorkspace/);
  assert.match(actions, /revalidatePath\(`\/clients\/\$\{input\.studentCaseId\}`\)/);
  assert.doesNotMatch(actions, /\.from\s*\(/);
  assert.doesNotMatch(actions, /console\.(?:log|warn|error)/);

  for (const sourceText of [workflow, actions]) {
    assert.doesNotMatch(
      sourceText,
      /from\s+["'][^"']*(?:anthropic|waha|legacy|better-sqlite3|secret|provider)[^"']*["']/i,
    );
    assert.doesNotMatch(sourceText, /raw_(?:provider|chat|document)|document_body/i);
  }
});

test("migration forward-repairs Supabase uuid v5 schema drift", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/057_platform_contract_draft_report.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    migration,
    /to_regprocedure\('public\.uuid_generate_v5\(uuid,text\)'\) IS NULL/,
  );
  assert.match(migration, /extensions\.uuid_generate_v5\(\$1, \$2\)/);
  assert.match(
    migration,
    /REVOKE EXECUTE ON FUNCTION public\.uuid_generate_v5\(UUID, TEXT\)/,
  );
});
