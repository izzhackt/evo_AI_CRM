import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PlatformAdmissionsRepositoryError,
  getPlatformOpWorkflowContract,
  listPlatformApplications,
  listPlatformStudentCases,
  normalizePlatformApplicationQueueRow,
  normalizePlatformOpWorkflowContract,
  normalizePlatformStudentCaseSnapshot,
  parsePlatformAdmissionsUuid,
} from "../src/lib/platform-admissions.ts";
import { isConnectedPlatformPage } from "../src/lib/platform-route-contract.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const APPLICATION_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const CONTRACT_ID = "55555555-5555-4555-8555-555555555555";
const HANDOFF_ID = "66666666-6666-4666-8666-666666666666";
const AT = "2026-08-01T05:00:00+00:00";

function actor(platformRole) {
  return {
    authUserId: "77777777-7777-4777-8777-777777777777",
    profileId: "88888888-8888-4888-8888-888888888888",
    membershipId: "99999999-9999-4999-8999-999999999999",
    organizationId: ORGANIZATION_ID,
    displayName: "Focused test actor",
    platformRole,
    platformAccessVersion: 1,
    role: platformRole === "student" ? "client" : platformRole,
  };
}

function caseRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    student_case_id: CASE_ID,
    student_display_name: "Test Student",
    target_country: "Malaysia",
    target_degree: "Bachelor",
    program_direction: "Computer Science",
    intake: "2027",
    language_assumption: "en",
    funding_assumption: null,
    route_approval_status: "approved",
    operational_stage: "applications",
    state: "active",
    created_at: AT,
    updated_at: AT,
    handoff_at: AT,
    next_action: "Prepare application",
    responsible_sales_display_name: "Sales User",
    current_curator_display_name: "Curator User",
    applied_ozo_workflow_contract_version_id: VERSION_ID,
    overdue_task_count: 0,
    overdue_obligation_count: "1",
    rejected_document_count: 0,
    ...overrides,
  };
}

function applicationRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    university_application_id: APPLICATION_ID,
    student_case_id: CASE_ID,
    student_display_name: "Test Student",
    target_country: "Malaysia",
    target_degree: "Bachelor",
    program_direction: "Computer Science",
    intake: "2027",
    institution_name: "Example University",
    program_name: "Computer Science",
    status: "submitted",
    latest_evidence_reference: "evidence:submission-1",
    created_at: AT,
    updated_at: AT,
    responsible_sales_display_name: "Sales User",
    current_curator_display_name: "Curator User",
    document_count: 2,
    open_document_count: 1,
    task_count: 3,
    open_task_count: 1,
    payment_obligation_count: 1,
    outstanding_payment_obligation_count: 0,
    ...overrides,
  };
}

test("Platform route contract admits exact admissions pages and one UUID segment", () => {
  for (const path of ["/sales", "/clients", "/applications"]) {
    assert.equal(isConnectedPlatformPage(path), true, path);
  }
  assert.equal(isConnectedPlatformPage(`/clients/${CASE_ID}`), true);
  assert.equal(
    isConnectedPlatformPage(`/applications/${APPLICATION_ID}`),
    true,
  );

  for (const path of [
    "/sales/1",
    `/sales/${CASE_ID}`,
    "/clients/12",
    `/clients/${CASE_ID}/documents`,
    "/applications/not-a-uuid",
    `/applications/${APPLICATION_ID}/history`,
    `/whatsapp/${CASE_ID}/messages`,
  ]) {
    assert.equal(isConnectedPlatformPage(path), false, path);
  }
});

test("workflow, case and application DTOs accept the exact reviewed projection", () => {
  const workflow = normalizePlatformOpWorkflowContract(
    {
      organization_id: ORGANIZATION_ID,
      workflow_contract_id: CONTRACT_ID,
      workflow_contract_version_id: VERSION_ID,
      contract_key: "wf_op",
      workflow_kind: "op",
      version: 1,
      status: "approved",
      stage_keys: ["new", "contacting", "contract_signed"],
      follow_up_outcome_keys: ["no_answer"],
      closure_result_keys: ["won", "lost"],
      terminal_stage_keys: ["contract_signed"],
      approved_at: AT,
      created_at: AT,
    },
    ORGANIZATION_ID,
  );
  assert.equal(workflow.contractKey, "wf_op");
  assert.deepEqual(workflow.stageKeys, ["new", "contacting", "contract_signed"]);

  const snapshot = normalizePlatformStudentCaseSnapshot({
    ...caseRow(),
    student_case_op_handoff_id: HANDOFF_ID,
    op_workflow_contract_version_id: VERSION_ID,
    approved_commercial_fields: { currency: "USD", amount_minor: 250000 },
    unresolved_questions: ["Confirm intake"],
    promises: ["Send checklist"],
    handoff_next_step: "Open admissions route",
    handoff_due_at: AT,
    handoff_responsible_role: "curator",
    handoff_created_at: AT,
  });
  assert.equal(snapshot.overdueObligationCount, 1);
  assert.equal(snapshot.handoff?.responsibleRole, "curator");

  const application = normalizePlatformApplicationQueueRow(
    applicationRow(),
    ORGANIZATION_ID,
  );
  assert.equal(application.status, "submitted");
  assert.equal(application.universityApplicationId, APPLICATION_ID);
});

test("existing unbound case keeps an explicit null handoff", () => {
  const snapshot = normalizePlatformStudentCaseSnapshot({
    ...caseRow({ applied_ozo_workflow_contract_version_id: null }),
    student_case_op_handoff_id: null,
    op_workflow_contract_version_id: null,
    approved_commercial_fields: null,
    unresolved_questions: null,
    promises: null,
    handoff_next_step: null,
    handoff_due_at: null,
    handoff_responsible_role: null,
    handoff_created_at: null,
  });
  assert.equal(snapshot.handoff, null);
});

test("malformed, cross-organization and partially-null projections fail closed", () => {
  assert.equal(parsePlatformAdmissionsUuid("00000000-0000-0000-0000-000000000000"), null);
  assert.throws(
    () =>
      normalizePlatformApplicationQueueRow(
        applicationRow({ organization_id: CASE_ID }),
        ORGANIZATION_ID,
      ),
    PlatformAdmissionsRepositoryError,
  );
  assert.throws(
    () =>
      normalizePlatformStudentCaseSnapshot({
        ...caseRow(),
        student_case_op_handoff_id: HANDOFF_ID,
        op_workflow_contract_version_id: null,
        approved_commercial_fields: null,
        unresolved_questions: null,
        promises: null,
        handoff_next_step: null,
        handoff_due_at: null,
        handoff_responsible_role: null,
        handoff_created_at: null,
      }),
    PlatformAdmissionsRepositoryError,
  );
  assert.throws(
    () => normalizePlatformApplicationQueueRow(applicationRow({ document_count: -1 })),
    PlatformAdmissionsRepositoryError,
  );
});

test("finance, student and curator are denied before restricted repository reads", async () => {
  await assert.rejects(
    () => listPlatformStudentCases(actor("finance")),
    PlatformAdmissionsRepositoryError,
  );
  await assert.rejects(
    () => listPlatformApplications(actor("student")),
    PlatformAdmissionsRepositoryError,
  );
  await assert.rejects(
    () => getPlatformOpWorkflowContract(actor("curator")),
    PlatformAdmissionsRepositoryError,
  );
});

test("connected Platform runtime modules do not statically import SQLite or legacy auth", () => {
  const files = [
    "src/lib/platform-admissions.ts",
    "src/lib/platform-admissions-actions.ts",
    "src/app/(staff)/PlatformStaffLayout.tsx",
    "src/app/(staff)/sales/PlatformSalesPage.tsx",
    "src/app/(staff)/clients/PlatformClientsPage.tsx",
    "src/app/(staff)/clients/[id]/PlatformClientPage.tsx",
    "src/app/(staff)/applications/PlatformApplicationsPage.tsx",
    "src/app/(staff)/applications/[id]/PlatformApplicationPage.tsx",
    "src/components/TopBar.tsx",
    "src/components/platform/PlatformLangSwitcher.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["']@\/lib\/(?:db|auth|queries|actions)["']/);
    assert.doesNotMatch(source, /from\s+["']\.\/(?:db|auth|queries|actions)["']/);
    assert.doesNotMatch(source, /better-sqlite3|edu_session/);
    assert.doesNotMatch(source, /@\/components\/LangSwitcher/);
  }
});

test("mutation forms preserve a validated render-time request id across uncertain results", () => {
  const actionSource = readFileSync(
    new URL("../src/lib/platform-admissions-actions.ts", import.meta.url),
    "utf8",
  );
  assert.match(actionSource, /retry_request_id/);
  for (const file of [
    "src/app/(staff)/clients/[id]/PlatformClientPage.tsx",
    "src/app/(staff)/applications/PlatformApplicationsPage.tsx",
    "src/app/(staff)/applications/[id]/PlatformApplicationPage.tsx",
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /parsePlatformAdmissionsUuid\(query\.retry_request_id\)/);
  }
});
