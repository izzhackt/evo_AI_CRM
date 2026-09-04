import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createClient } from "@supabase/supabase-js";

import {
  compactPlatformAdmissionsGetRpcArguments,
  PlatformAdmissionsRepositoryError,
  getPlatformOpWorkflowContract,
  listPlatformApplications,
  listPlatformStudentCaseLeadLinks,
  listPlatformStudentCases,
  normalizePlatformApplicationQueueRow,
  normalizePlatformOpWorkflowContract,
  normalizePlatformStudentCaseSnapshot,
  normalizePlatformStudentCaseLeadLink,
  parsePlatformAdmissionsCursor,
  parsePlatformAdmissionsUuid,
  summarizePlatformStudentCaseApplicationPreview,
} from "../src/lib/platform-admissions.ts";
import {
  isPlatformApplicationCalendarDate,
  parsePlatformApplicationDetailsReceipt,
  parsePlatformApplicationDeadlineInput,
  parsePlatformApplicationPrimaryCheckbox,
  parsePlatformApplicationSwitchMetadata,
} from "../src/lib/platform-application-contract.ts";
import {
  PlatformCaseAssignmentRepositoryError,
  normalizePlatformCuratorOptions,
  normalizePlatformStudentCaseAssignmentState,
} from "../src/lib/platform-case-assignment.ts";
import { isConnectedPlatformPage } from "../src/lib/platform-route-contract.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const APPLICATION_ID = "33333333-3333-4333-8333-333333333333";
const DEMOTED_APPLICATION_ID = "33333333-3333-4333-8333-555555555555";
const LEAD_ID = "33333333-3333-4333-8333-444444444444";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const CONTRACT_ID = "55555555-5555-4555-8555-555555555555";
const HANDOFF_ID = "66666666-6666-4666-8666-666666666666";
const CURATOR_MEMBERSHIP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CURATOR_PROFILE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AT = "2026-08-01T05:00:00+00:00";

test("V3 Admissions forms own versioned retry state without legacy query envelopes", () => {
  const actionsSource = readFileSync(
    new URL("../src/lib/platform-admissions-actions.ts", import.meta.url),
    "utf8",
  );
  const v3ApplicationActions = actionsSource.slice(
    actionsSource.indexOf("export async function createPlatformUniversityApplicationAction"),
  );
  assert.match(v3ApplicationActions, /exactApplicationFields\(form, CREATE_APPLICATION_FIELDS\)/);
  assert.match(
    v3ApplicationActions,
    /exactApplicationFields\(form, UPDATE_APPLICATION_DETAILS_FIELDS\)/,
  );
  assert.match(v3ApplicationActions, /exactActionStringFields\(form, CHANGE_APPLICATION_FIELDS\)/);
  assert.match(v3ApplicationActions, /update_university_application_details/);
  assert.match(
    v3ApplicationActions,
    /"update_university_application_details",[\s\S]*?p_university_application_id: applicationId/,
  );
  assert.match(v3ApplicationActions, /p_is_primary: isPrimary/);
  assert.match(v3ApplicationActions, /p_university_deadline_on: universityDeadlineOn/);
  assert.equal(v3ApplicationActions.match(/p_is_primary: isPrimary/g)?.length, 3);
  assert.equal(
    v3ApplicationActions.match(/p_university_deadline_on: universityDeadlineOn/g)?.length,
    3,
  );
  assert.match(v3ApplicationActions, /data\.is_primary !== isPrimary/);
  assert.match(v3ApplicationActions, /data\.university_deadline_on !== universityDeadlineOn/);
  assert.match(
    v3ApplicationActions,
    /parsePlatformApplicationPrimaryCheckbox\(\s*rawApplicationField\(fields, "is_primary"\)/,
  );
  assert.match(
    v3ApplicationActions,
    /parsePlatformApplicationDeadlineInput\(\s*rawApplicationField\(fields, "university_deadline_on"\)/,
  );
  assert.match(v3ApplicationActions, /validApplicationSwitchMetadata/);
  assert.match(v3ApplicationActions, /validApplicationChangedAt/);
  assert.match(actionsSource, /normalized\.append\(checkboxKey, ""\)/);
  assert.doesNotMatch(v3ApplicationActions, /demoted_applications/);
  const detailsAction = v3ApplicationActions.slice(
    v3ApplicationActions.indexOf(
      "export async function updatePlatformUniversityApplicationDetailsAction",
    ),
    v3ApplicationActions.indexOf(
      "export async function changePlatformUniversityApplicationAction",
    ),
  );
  const detailsFields = actionsSource.slice(
    actionsSource.indexOf("const UPDATE_APPLICATION_DETAILS_FIELDS"),
    actionsSource.indexOf("const CHANGE_APPLICATION_FIELDS"),
  );
  assert.doesNotMatch(detailsFields, /"student_case_id"/);
  assert.match(detailsAction, /p_university_application_id: applicationId/);
  assert.doesNotMatch(detailsAction, /p_application_id: applicationId/);
  assert.doesNotMatch(detailsAction, /applicationField\(fields, "student_case_id"\)/);
  assert.match(detailsAction, /revalidateApplication\(receipt\.studentCaseId\)/);
  const statusOnlyAction = v3ApplicationActions.slice(
    v3ApplicationActions.indexOf("export async function changePlatformUniversityApplicationAction"),
  );
  assert.doesNotMatch(statusOnlyAction, /p_is_primary|p_university_deadline_on/);
  assert.match(v3ApplicationActions, /applicationFailureState\(/);
  assert.match(actionsSource, /status === "stale" \|\| status === "request_conflict"/);
  assert.doesNotMatch(v3ApplicationActions, /redirect\(|retry_request_id|URLSearchParams/);

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
      fullListHref: `/v3/profile?case=${CASE_ID}`,
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
    version: "1",
    student_case_id: CASE_ID,
    student_display_name: "Test Student",
    target_country: "Malaysia",
    target_degree: "Bachelor",
    program_direction: "Computer Science",
    intake: "2027",
    institution_name: "Example University",
    program_name: "Computer Science",
    is_primary: true,
    university_deadline_on: "2027-02-15",
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

test("Platform route contract admits only the retained V3 product pages", () => {
  for (const path of [
    "/v3/main",
    "/v3/pipeline",
    "/v3/inbox",
    "/v3/profile",
    "/v3/calendar",
    "/v3/knowledge",
    "/v3/settings",
  ]) {
    assert.equal(isConnectedPlatformPage(path), true, path);
  }

  for (const path of [
    "/sales",
    "/sales/1",
    `/sales/${CASE_ID}/history`,
    "/clients",
    "/clients/12",
    `/clients/${CASE_ID}/documents`,
    "/applications",
    `/applications/${APPLICATION_ID}`,
    "/applications/not-a-uuid",
    `/applications/${APPLICATION_ID}/history`,
    "/visa",
    `/visa/${APPLICATION_ID}`,
    "/finance",
    `/finance/${APPLICATION_ID}`,
    "/whatsapp",
    `/whatsapp/${CASE_ID}`,
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
    handoff_responsible_role: "admissions",
    handoff_created_at: AT,
  });
  assert.equal(snapshot.overdueObligationCount, 1);
  assert.equal(snapshot.handoff?.responsibleRole, "admissions");

  const application = normalizePlatformApplicationQueueRow(
    applicationRow(),
    ORGANIZATION_ID,
  );
  assert.equal(application.status, "submitted");
  assert.equal(application.universityApplicationId, APPLICATION_ID);
  assert.equal(application.isPrimary, true);
  assert.equal(application.universityDeadlineOn, "2027-02-15");
});

test("application calendar facts accept real leap dates and nullable deadlines", () => {
  const nonPrimary = normalizePlatformApplicationQueueRow(
    applicationRow({ is_primary: false, university_deadline_on: null }),
    ORGANIZATION_ID,
  );
  assert.equal(nonPrimary.isPrimary, false);
  assert.equal(nonPrimary.universityDeadlineOn, null);
  assert.equal(
    normalizePlatformApplicationQueueRow(
      applicationRow({ university_deadline_on: "2028-02-29" }),
      ORGANIZATION_ID,
    ).universityDeadlineOn,
    "2028-02-29",
  );
  assert.equal(
    normalizePlatformApplicationQueueRow(
      applicationRow({ university_deadline_on: null }),
      ORGANIZATION_ID,
    ).universityDeadlineOn,
    null,
  );
  for (const universityDeadlineOn of [
    "2027-02-29",
    "2028-04-31",
    "2028-13-01",
    "2028-00-01",
    "0000-01-01",
    "2028-2-01",
    "2028-02-01T00:00:00Z",
    undefined,
  ]) {
    assert.throws(
      () => normalizePlatformApplicationQueueRow(
        applicationRow({ university_deadline_on: universityDeadlineOn }),
        ORGANIZATION_ID,
      ),
      PlatformAdmissionsRepositoryError,
    );
  }
});

test("application detail form values use one strict checkbox and calendar-date contract", () => {
  assert.equal(parsePlatformApplicationPrimaryCheckbox("on"), true);
  assert.equal(parsePlatformApplicationPrimaryCheckbox(""), false);
  for (const value of [
    " ",
    " on ",
    "true",
    "false",
    "1",
    "yes",
    "off",
    null,
    undefined,
  ]) {
    assert.equal(parsePlatformApplicationPrimaryCheckbox(value), null);
  }

  assert.equal(parsePlatformApplicationDeadlineInput(""), null);
  assert.equal(
    parsePlatformApplicationDeadlineInput("2028-02-29"),
    "2028-02-29",
  );
  assert.equal(isPlatformApplicationCalendarDate("2028-02-29"), true);
  for (const value of [
    "2027-02-29",
    "2028-04-31",
    "2028-13-01",
    "2028-2-01",
    "2028-02-01T00:00:00Z",
    " 2028-02-29 ",
    "  ",
    "0000-01-01",
    null,
    undefined,
  ]) {
    assert.equal(isPlatformApplicationCalendarDate(value), false);
    assert.equal(parsePlatformApplicationDeadlineInput(value), undefined);
  }
});

test("application primary-switch receipt metadata is paired and target-safe", () => {
  assert.deepEqual(
    parsePlatformApplicationSwitchMetadata(
      {
        demoted_primary_application_id: null,
        demoted_primary_application_version: null,
      },
      APPLICATION_ID,
    ),
    {
      demotedPrimaryApplicationId: null,
      demotedPrimaryApplicationVersion: null,
    },
  );
  assert.deepEqual(
    parsePlatformApplicationSwitchMetadata(
      {
        demoted_primary_application_id: DEMOTED_APPLICATION_ID.toUpperCase(),
        demoted_primary_application_version: "0007",
      },
      APPLICATION_ID,
    ),
    {
      demotedPrimaryApplicationId: DEMOTED_APPLICATION_ID,
      demotedPrimaryApplicationVersion: "7",
    },
  );
  for (const receipt of [
    {},
    {
      demoted_primary_application_id: DEMOTED_APPLICATION_ID,
      demoted_primary_application_version: null,
    },
    {
      demoted_primary_application_id: null,
      demoted_primary_application_version: "2",
    },
    {
      demoted_primary_application_id: APPLICATION_ID,
      demoted_primary_application_version: "2",
    },
    {
      demoted_primary_application_id: DEMOTED_APPLICATION_ID,
      demoted_primary_application_version: 2,
    },
    {
      demoted_primary_application_id: DEMOTED_APPLICATION_ID,
      demoted_primary_application_version: "0",
    },
  ]) {
    assert.equal(
      parsePlatformApplicationSwitchMetadata(receipt, APPLICATION_ID),
      undefined,
    );
  }
  for (const targetApplicationId of ["", "not-a-uuid", "00000000-0000-0000-0000-000000000000"]) {
    assert.equal(
      parsePlatformApplicationSwitchMetadata(
        {
          demoted_primary_application_id: null,
          demoted_primary_application_version: null,
        },
        targetApplicationId,
      ),
      undefined,
    );
  }
});

test("application details receipt returns the authoritative case and rejects inconsistent echoes", () => {
  const expectation = {
    organizationId: ORGANIZATION_ID,
    universityApplicationId: APPLICATION_ID,
    isPrimary: true,
    universityDeadlineOn: "2028-02-29",
    requestId: HANDOFF_ID,
    expectedVersion: "4",
  };
  const response = {
    organization_id: ORGANIZATION_ID,
    university_application_id: APPLICATION_ID,
    student_case_id: CASE_ID,
    is_primary: true,
    university_deadline_on: "2028-02-29",
    request_id: HANDOFF_ID,
    expected_version: "4",
    version: "5",
    changed_at: AT,
    demoted_primary_application_id: null,
    demoted_primary_application_version: null,
  };
  assert.deepEqual(
    parsePlatformApplicationDetailsReceipt(response, expectation),
    { studentCaseId: CASE_ID, version: "5" },
  );
  for (const malformed of [
    { ...response, organization_id: CASE_ID },
    { ...response, student_case_id: "not-a-case" },
    { ...response, is_primary: false },
    { ...response, university_deadline_on: null },
    { ...response, request_id: APPLICATION_ID },
    { ...response, expected_version: "3" },
    { ...response, version: "6" },
    { ...response, changed_at: "not-a-timestamp" },
  ]) {
    assert.equal(
      parsePlatformApplicationDetailsReceipt(malformed, expectation),
      undefined,
    );
  }
});

test("Student Case sales links accept only exact canonical UUID pairs", () => {
  assert.deepEqual(
    normalizePlatformStudentCaseLeadLink({
      student_case_id: CASE_ID,
      lead_id: LEAD_ID,
    }),
    { studentCaseId: CASE_ID, leadId: LEAD_ID },
  );
  assert.throws(
    () =>
      normalizePlatformStudentCaseLeadLink({
        student_case_id: CASE_ID,
        lead_id: null,
      }),
    PlatformAdmissionsRepositoryError,
  );

  const admissionsSource = readFileSync(
    new URL("../src/lib/platform-admissions.ts", import.meta.url),
    "utf8",
  );
  assert.match(admissionsSource, /staff_student_case_sales_links/);
  assert.match(admissionsSource, /studentCaseIds\.length > 100/);
  assert.equal(typeof listPlatformStudentCaseLeadLinks, "function");
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

test("U6 case projections allow null intake facts without inventing defaults", () => {
  const snapshot = normalizePlatformStudentCaseSnapshot({
    ...caseRow({
      target_country: null,
      target_degree: null,
    }),
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
  assert.equal(snapshot.targetCountry, null);
  assert.equal(snapshot.targetDegree, null);

  const application = normalizePlatformApplicationQueueRow(
    applicationRow({ target_country: null, target_degree: null }),
    ORGANIZATION_ID,
  );
  assert.equal(application.targetCountry, null);
  assert.equal(application.targetDegree, null);
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
  assert.throws(
    () => normalizePlatformApplicationQueueRow(applicationRow({ is_primary: "true" })),
    PlatformAdmissionsRepositoryError,
  );
  assert.throws(
    () => normalizePlatformApplicationQueueRow(applicationRow({ is_primary: null })),
    PlatformAdmissionsRepositoryError,
  );
  assert.throws(
    () => normalizePlatformApplicationQueueRow(
      applicationRow({ university_deadline_on: "2027-02-29" }),
    ),
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
    "src/app/(v3)/v3/calendar/page.tsx",
    "src/app/(v3)/v3/profile/page.tsx",
    "src/components/v3/calendar/TaskControls.tsx",
    "src/components/v3/profile/ProfileAdmissionsWorkspace.tsx",
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

test("V3 profile keeps sales stage and Admissions case state as distinct fields", () => {
  const profileSource = readFileSync(
    new URL("../src/lib/v3/profile-source.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    profileSource,
    /stage:\s*lead\.stageKey/,
  );
  assert.match(
    profileSource,
    /caseStatus:\s*studentCase\?\.state\s*\?\?\s*salesCase\?\.state\s*\?\?\s*handoff\.caseState/,
  );
});
