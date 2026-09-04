import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PlatformPortalRepositoryError,
  derivePortalClientStage,
  getPlatformStudentPortalSnapshot,
  mapPortalApplicationStatus,
  mapPortalDocumentStatus,
  mapPortalPaymentStatus,
  mapPortalTaskStatus,
  mapPortalVisaStatus,
  normalizePlatformStudentPortalSnapshot,
} from "../src/lib/platform-portal.ts";

const CASE_ID = "10000000-0000-4000-8000-000000000001";
const PROFILE_ID = "10000000-0000-4000-8000-000000000002";
const AUTH_USER_ID = "10000000-0000-4000-8000-000000000003";
const MEMBERSHIP_ID = "10000000-0000-4000-8000-000000000004";
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";
const ACTOR_PROFILE_ID = "10000000-0000-4000-8000-00000000000e";
const APPLICATION_ID = "10000000-0000-4000-8000-000000000006";
const VISA_ID = "10000000-0000-4000-8000-000000000007";
const TASK_ID = "10000000-0000-4000-8000-000000000008";
const UPDATE_ID = "10000000-0000-4000-8000-000000000009";
const DOCUMENT_ID = "10000000-0000-4000-8000-00000000000a";
const DOCUMENT_VERSION_ID = "10000000-0000-4000-8000-00000000000b";
const PAYMENT_ID = "10000000-0000-4000-8000-00000000000c";
const REQUIREMENT_VERSION_ID = "10000000-0000-4000-8000-00000000000d";
const AT = "2026-08-02T10:30:00.000Z";

function profileRow(overrides = {}) {
  return {
    case_id: CASE_ID,
    student_profile_id: PROFILE_ID,
    student_display_name: "Aida Student",
    profile_revision: 3,
    preferred_display_name: "Aida",
    legal_display_name: "Aida Student",
    communication_language: "ru",
    date_of_birth: "2007-04-12",
    citizenship_country: "Kyrgyzstan",
    residency_country: "Kyrgyzstan",
    current_education_summary: "Grade 12",
    academic_summary: "Strong mathematics record",
    language_summary: "English B2",
    budget_band: "USD 10,000-15,000",
    decision_participant_labels: ["Student", "Parent"],
    consent_status: "granted",
    consent_evidence_ref: "consent-ledger:42",
    profile_next_step: "Confirm the final university list",
    target_country: "Germany",
    target_degree: "Bachelor",
    program_direction: "Computer science",
    intake: "Fall 2027",
    route_approval_status: "approved",
    operational_stage: "documents",
    case_state: "active",
    case_next_action: "Review the route",
    portal_activated_at: AT,
    applied_country_requirement_version_id: REQUIREMENT_VERSION_ID,
    checklist_version: 2,
    required_profile_fields: ["language_summary"],
    ...overrides,
  };
}

function applicationRow(overrides = {}) {
  return {
    application_id: APPLICATION_ID,
    case_id: CASE_ID,
    institution_name: "Technical University",
    program_name: "Computer Science",
    application_status: "under_review",
    updated_at: AT,
    ...overrides,
  };
}

function visaRow(overrides = {}) {
  return {
    visa_case_id: VISA_ID,
    case_id: CASE_ID,
    visa_status: "docs",
    updated_at: AT,
    ...overrides,
  };
}

function taskRow(overrides = {}) {
  return {
    case_task_id: TASK_ID,
    case_id: CASE_ID,
    task_type: "student_action",
    title: "Confirm document details",
    priority: "normal",
    due_on: null,
    due_at: null,
    task_status: "open",
    updated_at: AT,
    ...overrides,
  };
}

function updateRow(overrides = {}) {
  return {
    case_update_id: UPDATE_ID,
    case_id: CASE_ID,
    source: "case",
    body: "The application is under review.",
    occurred_at: AT,
    ...overrides,
  };
}

function documentRow(overrides = {}) {
  return {
    case_id: CASE_ID,
    document_slot_id: DOCUMENT_ID,
    requirement_key: "passport",
    requirement_label: "Passport",
    instructions: "Use the approved secure channel.",
    slot_status: "required",
    deadline: null,
    next_action: "Ask the curator for the secure channel",
    document_version_id: DOCUMENT_VERSION_ID,
    version_no: 1,
    original_filename: "passport.pdf",
    declared_mime_type: "application/pdf",
    byte_size: 1024,
    submitted_at: AT,
    review_decision: null,
    rework_reason: null,
    reviewed_at: null,
    ...overrides,
  };
}

function financeRow(overrides = {}) {
  return {
    case_id: CASE_ID,
    payment_obligation_id: PAYMENT_ID,
    obligation_label: "EVO service fee",
    category: "evo_service_fee",
    amount_minor: 250000,
    currency: "USD",
    due_at: AT,
    derived_status: "pending",
    overdue: false,
    next_action: "Contact finance for payment instructions",
    ...overrides,
  };
}

function snapshotInput(overrides = {}) {
  return {
    profile: profileRow(),
    applications: [applicationRow()],
    visaCases: [visaRow()],
    tasks: [taskRow()],
    updates: [updateRow()],
    documents: [documentRow()],
    finance: [financeRow()],
    generatedAt: AT,
    ...overrides,
  };
}

function actor(role = "student") {
  return {
    authUserId: AUTH_USER_ID,
    profileId: ACTOR_PROFILE_ID,
    membershipId: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    displayName: "Aida Student",
    platformRole: role,
    platformAccessVersion: 1,
    role: role === "student" ? "client" : role,
  };
}

function rpcClient(responses) {
  return {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(functionName, args, options) {
          assert.equal(args, undefined);
          assert.deepEqual(options, { get: true });
          const response = responses[functionName];
          if (response instanceof Error) throw response;
          return response ?? { data: [], error: null };
        },
      };
    },
  };
}

test("portal status mappings cover every database enum without inventing states", () => {
  for (const [source, target] of Object.entries({
    preparation: "preparing",
    ready: "preparing",
    submitted: "submitted",
    under_review: "submitted",
    offer: "offer",
    enrolled: "enrolled",
    rejected: "rejected",
    withdrawn: "rejected",
    closed: "rejected",
  })) {
    assert.equal(mapPortalApplicationStatus(source), target);
  }

  for (const [source, target] of Object.entries({
    required: "required",
    submitted: "uploaded",
    approved: "approved",
    correction_required: "rejected",
    rejected: "rejected",
  })) {
    assert.equal(mapPortalDocumentStatus(source), target);
  }

  for (const status of [
    "not_started",
    "docs",
    "appointment",
    "submitted",
    "approved",
    "rejected",
  ]) {
    assert.equal(mapPortalVisaStatus(status), status);
  }
  assert.equal(mapPortalVisaStatus("not_required"), null);
  assert.equal(mapPortalVisaStatus("closed"), null);

  assert.equal(mapPortalPaymentStatus("pending"), "pending");
  assert.equal(mapPortalPaymentStatus("partially_paid"), "pending");
  assert.equal(mapPortalPaymentStatus("paid"), "paid");
  assert.equal(mapPortalPaymentStatus("overdue"), "overdue");

  assert.equal(mapPortalTaskStatus("open"), "todo");
  assert.equal(mapPortalTaskStatus("in_progress"), "in_progress");
  assert.equal(mapPortalTaskStatus("blocked"), "review");
  assert.equal(mapPortalTaskStatus("done"), null);
  assert.equal(mapPortalTaskStatus("cancelled"), null);
});

test("stage precedence is operational and never falls back to a sales stage", () => {
  const base = {
    caseState: "active",
    operationalStage: "unknown_workflow_key",
    applications: [],
    documents: [],
    visaStatus: null,
  };
  assert.equal(derivePortalClientStage(base), "contract");
  assert.equal(
    derivePortalClientStage({ ...base, documents: [{ status: "required" }] }),
    "documents",
  );
  assert.equal(
    derivePortalClientStage({
      ...base,
      documents: [{ status: "approved" }],
      applications: [{ status: "submitted" }],
    }),
    "applying",
  );
  assert.equal(
    derivePortalClientStage({
      ...base,
      applications: [{ status: "offer" }],
    }),
    "offer",
  );
  assert.equal(
    derivePortalClientStage({
      ...base,
      applications: [{ status: "offer" }],
      visaStatus: "docs",
    }),
    "visa",
  );
  assert.equal(
    derivePortalClientStage({
      ...base,
      applications: [{ status: "enrolled" }],
      visaStatus: "approved",
    }),
    "enrolled",
  );
  assert.equal(
    derivePortalClientStage({ ...base, caseState: "closed" }),
    "archived",
  );
});

test("normalization keeps UUIDs as strings and exposes only truthful portal data", () => {
  const snapshot = normalizePlatformStudentPortalSnapshot(snapshotInput());
  assert.equal(typeof snapshot.student.id, "string");
  assert.equal(typeof snapshot.client.id, "string");
  assert.equal(typeof snapshot.applications[0].id, "string");
  assert.equal(typeof snapshot.documents[0].id, "string");
  assert.equal(typeof snapshot.visa.id, "string");
  assert.equal(typeof snapshot.payments[0].id, "string");
  assert.equal(typeof snapshot.tasks[0].id, "string");
  assert.equal(typeof snapshot.updates[0].id, "string");
  assert.equal(snapshot.student.email, null);
  assert.equal(snapshot.student.phone, null);
  assert.equal(snapshot.manager, null);
  assert.equal(snapshot.curator, null);
  assert.equal(snapshot.applications[0].deadline, null);
  assert.equal(snapshot.visa.appointmentAt, null);
  assert.equal(snapshot.payments[0].paidAt, null);
  assert.equal(snapshot.updates[0].authorName, null);
  assert.equal(snapshot.updates[0].isRead, true);
});

test("portal tasks use the Bishkek workday and keep unscheduled work undated", () => {
  const allDay = normalizePlatformStudentPortalSnapshot(snapshotInput({
    tasks: [taskRow({ due_on: "2026-09-04" })],
  }));
  assert.equal(allDay.tasks[0].dueDate, "2026-09-04");

  const timedAfterLocalMidnight = normalizePlatformStudentPortalSnapshot(snapshotInput({
    tasks: [taskRow({ due_at: "2026-09-04T19:15:00Z" })],
  }));
  assert.equal(timedAfterLocalMidnight.tasks[0].dueDate, "2026-09-05");

  const unscheduled = normalizePlatformStudentPortalSnapshot(snapshotInput());
  assert.equal(unscheduled.tasks[0].dueDate, null);

  assert.throws(
    () => normalizePlatformStudentPortalSnapshot(snapshotInput({
      tasks: [taskRow({ due_on: "2026-09-04", due_at: AT })],
    })),
    PlatformPortalRepositoryError,
  );
});

test("portal profile rejects unsupported language and oversized participant lists", () => {
  assert.throws(
    () => normalizePlatformStudentPortalSnapshot(snapshotInput({
      profile: profileRow({ communication_language: "ky" }),
    })),
    PlatformPortalRepositoryError,
  );
  assert.throws(
    () => normalizePlatformStudentPortalSnapshot(snapshotInput({
      profile: profileRow({
        decision_participant_labels: Array.from(
          { length: 13 },
          (_, index) => `participant-${index + 1}`,
        ),
      }),
    })),
    PlatformPortalRepositoryError,
  );
});

test("explicit profile next action never receives a fabricated deadline", () => {
  const snapshot = normalizePlatformStudentPortalSnapshot(
    snapshotInput({
      applications: [],
      visaCases: [],
      tasks: [],
      updates: [],
      documents: [],
      finance: [],
    }),
  );
  assert.equal(snapshot.nextAction.detail, "Confirm the final university list");
  assert.equal(snapshot.nextAction.dueDate, null);
});

test("done and cancelled tasks are filtered from the portal snapshot", () => {
  const snapshot = normalizePlatformStudentPortalSnapshot(
    snapshotInput({
      tasks: [
        taskRow({ task_status: "done" }),
        taskRow({
          case_task_id: "20000000-0000-4000-8000-000000000008",
          task_status: "cancelled",
        }),
      ],
    }),
  );
  assert.deepEqual(snapshot.tasks, []);
});

test("provider failure and duplicate profile rows fail closed", async () => {
  await assert.rejects(
    () =>
      getPlatformStudentPortalSnapshot(actor(), {
        client: rpcClient({
          student_portal_profile: { data: null, error: { message: "down" } },
        }),
        generatedAt: AT,
        notificationsEnabled: false,
        notificationsVersion: "v1",
      }),
    PlatformPortalRepositoryError,
  );

  await assert.rejects(
    () =>
      getPlatformStudentPortalSnapshot(actor(), {
        client: rpcClient({
          student_portal_profile: {
            data: [profileRow(), profileRow()],
            error: null,
          },
        }),
        generatedAt: AT,
        notificationsEnabled: false,
        notificationsVersion: "v1",
      }),
    PlatformPortalRepositoryError,
  );

  await assert.rejects(
    () =>
      getPlatformStudentPortalSnapshot(actor(), {
        client: rpcClient({
          student_portal_profile: { data: [profileRow()], error: null },
          student_portal_applications: new Error("provider unavailable"),
        }),
        generatedAt: AT,
        notificationsEnabled: false,
        notificationsVersion: "v1",
      }),
    PlatformPortalRepositoryError,
  );

  assert.equal(
    await getPlatformStudentPortalSnapshot(actor(), {
      client: rpcClient({
        student_portal_profile: { data: [], error: null },
      }),
      generatedAt: AT,
      notificationsEnabled: false,
      notificationsVersion: "v1",
    }),
    null,
  );
});

test("repository calls only the seven read-only portal RPCs", async () => {
  const snapshot = await getPlatformStudentPortalSnapshot(actor(), {
    client: rpcClient({
      student_portal_profile: { data: [profileRow()], error: null },
      student_portal_applications: { data: [], error: null },
      student_portal_visa_cases: { data: [], error: null },
      student_portal_tasks: { data: [], error: null },
      student_portal_updates: { data: [], error: null },
      student_portal_documents: { data: [], error: null },
      student_portal_finance: { data: [], error: null },
    }),
    generatedAt: AT,
    notificationsEnabled: false,
    notificationsVersion: "v1",
  });
  assert.equal(snapshot.client.id, CASE_ID);

  await assert.rejects(
    () =>
      getPlatformStudentPortalSnapshot(actor("sales"), {
        client: rpcClient({}),
        generatedAt: AT,
        notificationsEnabled: false,
        notificationsVersion: "v1",
      }),
    PlatformPortalRepositoryError,
  );
});

test("repository adds the durable P6B notification RPC only when explicitly enabled", async () => {
  const snapshot = await getPlatformStudentPortalSnapshot(actor(), {
    client: rpcClient({
      student_portal_profile: { data: [profileRow()], error: null },
      student_portal_applications: { data: [], error: null },
      student_portal_visa_cases: { data: [], error: null },
      student_portal_tasks: { data: [], error: null },
      student_portal_updates: { data: [], error: null },
      student_portal_documents: { data: [], error: null },
      student_portal_finance: { data: [], error: null },
      student_portal_notifications_v1: {
        data: [{
          notification_id: UPDATE_ID,
          category: "document.review",
          review_decision: "rejected",
          requirement_key: "passport_copy",
          requirement_label: "Passport copy",
          reason: "Wrong document.",
          created_at: AT,
          read_at: null,
        }],
        error: null,
      },
    }),
    generatedAt: AT,
    notificationsEnabled: true,
    notificationsVersion: "v1",
  });

  assert.equal(snapshot.notifications?.length, 1);
  assert.equal(snapshot.notifications?.[0]?.id, UPDATE_ID);
});

test("frozen V1 portal modules remain isolated from active legacy auth and SQLite", () => {
  for (const file of [
    "src/lib/portal.ts",
    "src/lib/platform-portal.ts",
    "src/components/platform/portal/PortalShell.tsx",
    "src/app/portal/profile/page.tsx",
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["']@\/lib\/(?:auth|queries|db|actions)["']/);
    assert.doesNotMatch(source, /from\s+["']\.\/(?:auth|queries|db|actions)["']/);
    assert.doesNotMatch(source, /better-sqlite3|edu_session|SessionUser/);
  }

  const portalFacade = readFileSync(
    new URL("../src/lib/portal.ts", import.meta.url),
    "utf8",
  );
  assert.match(portalFacade, /isUiContractFixtureMode\(\)/);
  assert.match(portalFacade, /await import\("\.\/portal-fixture"\)/);

  const fixtureFacade = readFileSync(
    new URL("../src/lib/portal-fixture.ts", import.meta.url),
    "utf8",
  );
  assert.match(fixtureFacade, /if \(!isUiContractFixtureMode\(\)\)/);
  assert.match(fixtureFacade, /legacy portal fixture runtime was removed/);
  assert.doesNotMatch(fixtureFacade, /studentPortalSnapshotForUser|from\s+["']\.\/queries["']/);
});

test("accepted documents page preserves the honest upload-unavailable boundary", () => {
  const source = readFileSync(
    new URL("../src/app/portal/documents/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /copy\.uploadUnavailableTitle/);
  assert.match(source, /copy\.uploadUnavailableBody/);
  assert.doesNotMatch(source, /<input[^>]+type=["']file["']/i);
  assert.doesNotMatch(source, /\sdownload(?:=|\s|>)/i);
});
