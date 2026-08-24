import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { createClient } from "@supabase/supabase-js";

import {
  buildPlatformAdmissionsRedirectUrl,
  compactPlatformAdmissionsGetRpcArguments,
  PlatformAdmissionsRepositoryError,
  getPlatformOpWorkflowContract,
  listPlatformApplications,
  listPlatformStudentCases,
  normalizePlatformApplicationQueueRow,
  normalizePlatformOpWorkflowContract,
  normalizePlatformStudentCaseSnapshot,
  parsePlatformAdmissionsCursor,
  parsePlatformAdmissionsUuid,
  summarizePlatformStudentCaseApplicationPreview,
} from "../src/lib/platform-admissions.ts";
import {
  PlatformCaseAssignmentRepositoryError,
  normalizePlatformCuratorOptions,
  normalizePlatformStudentCaseAssignmentState,
} from "../src/lib/platform-case-assignment.ts";
import { isConnectedPlatformPage } from "../src/lib/platform-route-contract.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const APPLICATION_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const CONTRACT_ID = "55555555-5555-4555-8555-555555555555";
const HANDOFF_ID = "66666666-6666-4666-8666-666666666666";
const CURATOR_MEMBERSHIP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CURATOR_PROFILE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AT = "2026-08-01T05:00:00+00:00";

test("case lifecycle redirects preserve the originating Student 360 section", () => {
  assert.equal(
    buildPlatformAdmissionsRedirectUrl(
      `/clients/${CASE_ID}`,
      "saved",
      null,
      "case-lifecycle",
    ),
    `/clients/${CASE_ID}?result=saved#case-lifecycle`,
  );
  assert.equal(
    buildPlatformAdmissionsRedirectUrl(
      `/clients/${CASE_ID}`,
      "unavailable",
      APPLICATION_ID,
      "case-lifecycle",
    ),
    `/clients/${CASE_ID}?result=unavailable&retry_request_id=${APPLICATION_ID}#case-lifecycle`,
  );
});

test("Student 360 application summary preserves the partial-page signal and lower bound", () => {
  const summary = summarizePlatformStudentCaseApplicationPreview(
    [
      { status: "preparation" },
      { status: "offer" },
      { status: "rejected" },
      { status: "withdrawn" },
      { status: "closed" },
    ],
    true,
    CASE_ID,
  );

  assert.deepEqual(summary, {
    activeApplications: 2,
    preview: {
      visibleCount: 5,
      hasMore: true,
      fullListHref: `/applications?student_case_id=${CASE_ID}`,
    },
  });
  assert.throws(
    () =>
      summarizePlatformStudentCaseApplicationPreview(
        [{ status: "offer" }],
        false,
        "not-a-case-id",
      ),
    PlatformAdmissionsRepositoryError,
  );
});

test("accepts only complete deterministic admissions cursors", () => {
  assert.deepEqual(parsePlatformAdmissionsCursor(AT, CASE_ID), {
    sortAt: AT,
    id: CASE_ID,
  });
  assert.equal(parsePlatformAdmissionsCursor(undefined, CASE_ID), null);
  assert.equal(parsePlatformAdmissionsCursor(AT, "not-a-uuid"), null);
});

test("GET pagination RPCs do not serialize absent filters as literal null", async () => {
  const requests = [];
  const client = createClient(
    "https://example.supabase.co",
    "test-publishable-key",
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: {
        fetch: async (input) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url;
          requests.push(new URL(url));
          return new Response("[]", {
            headers: { "content-type": "application/json" },
            status: 200,
          });
        },
      },
    },
  );

  await client.schema("platform").rpc(
    "staff_student_case_page",
    compactPlatformAdmissionsGetRpcArguments({
      p_limit: 51,
      p_before_sort_at: null,
      p_before_student_case_id: null,
      p_state: null,
      p_query: null,
      p_student_case_id: null,
    }),
    { get: true },
  );

  await client.schema("platform").rpc(
    "staff_application_page",
    compactPlatformAdmissionsGetRpcArguments({
      p_limit: 51,
      p_before_updated_at: null,
      p_before_application_id: null,
      p_status: null,
      p_student_case_id: null,
      p_application_id: null,
    }),
    { get: true },
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.get("p_limit"), "51");
  assert.equal(requests[1].searchParams.get("p_limit"), "51");
  for (const request of requests) {
    assert.deepEqual([...request.searchParams.entries()], [["p_limit", "51"]]);
  }
});

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
  assert.equal(isConnectedPlatformPage(`/sales/${CASE_ID}`), true);
  assert.equal(isConnectedPlatformPage(`/clients/${CASE_ID}`), true);
  assert.equal(
    isConnectedPlatformPage(`/applications/${APPLICATION_ID}`),
    true,
  );

  for (const path of [
    "/sales/1",
    `/sales/${CASE_ID}/history`,
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

test("assignment projections normalize only same-org active Curator authority", () => {
  assert.deepEqual(
    normalizePlatformStudentCaseAssignmentState(
      {
        id: CASE_ID,
        organization_id: ORGANIZATION_ID,
        current_curator_membership_id: CURATOR_MEMBERSHIP_ID,
        portal_activated_at: AT,
      },
      ORGANIZATION_ID,
      CASE_ID,
    ),
    {
      organizationId: ORGANIZATION_ID,
      studentCaseId: CASE_ID,
      currentCuratorMembershipId: CURATOR_MEMBERSHIP_ID,
      portalActivatedAt: AT,
    },
  );
  assert.deepEqual(
    normalizePlatformCuratorOptions(
      [{
        id: CURATOR_MEMBERSHIP_ID,
        organization_id: ORGANIZATION_ID,
        profile_id: CURATOR_PROFILE_ID,
        status: "active",
        current_role: "curator",
      }],
      [{
        id: CURATOR_PROFILE_ID,
        display_name: "  Assigned Curator  ",
        status: "active",
      }],
      ORGANIZATION_ID,
    ),
    [{
      membershipId: CURATOR_MEMBERSHIP_ID,
      displayName: "Assigned Curator",
    }],
  );

  assert.throws(
    () => normalizePlatformCuratorOptions(
      [{
        id: CURATOR_MEMBERSHIP_ID,
        organization_id: ORGANIZATION_ID,
        profile_id: CURATOR_PROFILE_ID,
        status: "active",
        current_role: "sales",
      }],
      [{
        id: CURATOR_PROFILE_ID,
        display_name: "Wrong role",
        status: "active",
      }],
      ORGANIZATION_ID,
    ),
    PlatformCaseAssignmentRepositoryError,
  );
  assert.throws(
    () => normalizePlatformStudentCaseAssignmentState(
      {
        id: CASE_ID,
        organization_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        current_curator_membership_id: null,
        portal_activated_at: null,
      },
      ORGANIZATION_ID,
      CASE_ID,
    ),
    PlatformCaseAssignmentRepositoryError,
  );
});

test("connected Platform runtime modules do not statically import SQLite or legacy auth", () => {
  const files = [
    "src/lib/platform-admissions.ts",
    "src/lib/platform-admissions-actions.ts",
    "src/lib/platform-case-assignment.ts",
    "src/app/(staff)/layout.tsx",
    "src/app/(staff)/sales/page.tsx",
    "src/app/(staff)/sales/SalesPageContent.tsx",
    "src/components/platform/core/SalesQuickAdd.tsx",
    "src/app/(staff)/clients/page.tsx",
    "src/app/(staff)/clients/ClientsPageContent.tsx",
    "src/app/(staff)/clients/ConnectedCanonicalClients.tsx",
    "src/app/(staff)/clients/[id]/page.tsx",
    "src/app/(staff)/clients/[id]/ClientPageContent.tsx",
    "src/app/(staff)/clients/[id]/ConnectedCanonicalClientDetail.tsx",
    "src/app/(staff)/applications/page.tsx",
    "src/app/(staff)/applications/ApplicationsPresenter.tsx",
    "src/app/(staff)/applications/PlatformApplicationsPage.tsx",
    "src/app/(staff)/applications/[id]/page.tsx",
    "src/app/(staff)/applications/[id]/PlatformApplicationPage.tsx",
    "src/components/TopBar.tsx",
    "src/components/platform/PlatformLangSwitcher.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["']@\/lib\/(?:db|auth|queries|actions)["']/);
    assert.doesNotMatch(source, /from\s+["']\.\/(?:db|auth|queries|actions)["']/);
    assert.doesNotMatch(source, /better-sqlite3|edu_session/);
    assert.doesNotMatch(
      source,
      /from\s+["']@\/components\/LangSwitcher["']/,
    );
  }
});

test("normal staff routes keep one accepted renderer instead of parallel Platform and Legacy UIs", () => {
  for (const removedUi of [
    "src/app/(staff)/LegacyStaffLayout.tsx",
    "src/app/(staff)/PlatformStaffLayout.tsx",
    "src/app/(staff)/sales/LegacySalesPage.tsx",
    "src/app/(staff)/sales/PlatformSalesPage.tsx",
    "src/app/(staff)/clients/LegacyClientsPage.tsx",
    "src/app/(staff)/clients/[id]/LegacyClientPage.tsx",
  ]) {
    assert.equal(
      existsSync(new URL(`../${removedUi}`, import.meta.url)),
      false,
      `${removedUi} must not remain as a parallel UI entry point`,
    );
  }

  const layout = readFileSync(
    new URL("../src/app/(staff)/layout.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(layout, /import\(["']\.\/(?:Legacy|Platform)StaffLayout["']\)/);

  const salesRoute = readFileSync(
    new URL("../src/app/(staff)/sales/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(salesRoute, /SalesPageContent/);
  assert.doesNotMatch(salesRoute, /(?:Legacy|Platform)SalesPage/);

  const clientsRoute = readFileSync(
    new URL("../src/app/(staff)/clients/page.tsx", import.meta.url),
    "utf8",
  );
  const clientRoute = readFileSync(
    new URL("../src/app/(staff)/clients\/\[id\]\/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(clientsRoute, /ClientsPageContent/);
  assert.match(clientRoute, /ClientPageContent/);
  assert.doesNotMatch(clientsRoute, /(?:Legacy|Platform)ClientsPage/);
  assert.doesNotMatch(clientRoute, /(?:Legacy|Platform)ClientPage/);

  const applicationsRoute = readFileSync(
    new URL("../src/app/(staff)/applications/page.tsx", import.meta.url),
    "utf8",
  );
  const applicationRoute = readFileSync(
    new URL("../src/app/(staff)/applications\/\[id\]\/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(applicationsRoute, /ApplicationsQueuePresenter/);
  assert.match(applicationRoute, /ApplicationDetailPresenter/);
  assert.doesNotMatch(applicationsRoute, /<(?:Legacy|Platform)ApplicationsPage/);
  assert.doesNotMatch(applicationRoute, /<(?:Legacy|Platform)ApplicationPage/);
});

test("sales handoff summary keeps sales stage labels distinct from case state labels", () => {
  const leadDetailSource = readFileSync(
    new URL(
      "../src/components/platform/core/CanonicalLeadDetail.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    leadDetailSource,
    /stage:\s*"Текущий этап EVO"/,
  );
  assert.doesNotMatch(
    leadDetailSource,
    /caseState\./,
  );
});

test("mutation forms preserve a validated render-time request id across uncertain results", () => {
  const actionSource = readFileSync(
    new URL("../src/lib/platform-admissions-actions.ts", import.meta.url),
    "utf8",
  );
  const redirectSource = readFileSync(
    new URL("../src/lib/platform-admissions.ts", import.meta.url),
    "utf8",
  );
  assert.match(actionSource, /buildPlatformAdmissionsRedirectUrl/);
  assert.match(redirectSource, /retry_request_id/);
  for (const file of [
    "src/app/(staff)/applications/PlatformApplicationsPage.tsx",
    "src/app/(staff)/applications/[id]/PlatformApplicationPage.tsx",
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /parsePlatformAdmissionsUuid\(query\.retry_request_id\)/);
  }
  const canonicalClientSource = readFileSync(
    new URL(
      "../src/app/(staff)/clients/[id]/ConnectedCanonicalClientDetail.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(canonicalClientSource, /retry_request_id/);
});

test("connected canonical clients use the bounded canonical detail adapter instead of Student 360 authority", () => {
  const adapterSource = readFileSync(
    new URL(
      "../src/app/(staff)/clients/[id]/ConnectedCanonicalClientDetail.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const rendererSource = readFileSync(
    new URL(
      "../src/app/(staff)/clients/[id]/ClientPageContent.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const detailSource = readFileSync(
    new URL(
      "../src/components/platform/core/CanonicalClientDetail.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(adapterSource, /getPlatformCanonicalClient\(actor,\s*id\)/);
  assert.match(adapterSource, /CanonicalClientDetail client=\{client\}/);
  assert.match(rendererSource, /ConnectedCanonicalClientDetail/);
  assert.match(detailSource, /data-testid="canonical-client-detail"/);
  assert.match(detailSource, /linkedCases/);
  assert.match(detailSource, /linkedConversations/);
});

test("connected canonical client detail keeps Student 360 context secondary and removes legacy mutation forms", () => {
  const rendererSource = readFileSync(
    new URL(
      "../src/app/(staff)/clients/[id]/ClientPageContent.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const detailSource = readFileSync(
    new URL(
      "../src/components/platform/core/CanonicalClientDetail.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const admissionsActionSource = readFileSync(
    new URL("../src/lib/platform-admissions-actions.ts", import.meta.url),
    "utf8",
  );

  assert.match(admissionsActionSource, /assignPlatformStudentCaseCuratorAction/);
  assert.match(admissionsActionSource, /updatePlatformStudentCaseRouteAction/);
  assert.doesNotMatch(rendererSource, /curator-assignment-form/);
  assert.doesNotMatch(rendererSource, /platform-student-route-gate/);
  assert.doesNotMatch(detailSource, /name="program_direction"/);
  assert.doesNotMatch(detailSource, /name="reason"/);
  assert.match(detailSource, /CanonicalLinkedContext/);
});
