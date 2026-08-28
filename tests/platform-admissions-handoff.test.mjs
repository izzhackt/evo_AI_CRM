import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  getPlatformAdmissionsHandoff,
  getPlatformStudentCaseAdmissionsHandoff,
  mutatePlatformAdmissionsHandoff,
  normalizePlatformAdmissionsHandoff,
  parsePlatformAdmissionsHandoffFormData,
  parsePlatformAdmissionsHandoffUuid,
  PlatformAdmissionsHandoffRepositoryError,
} from "../src/lib/platform-admissions-handoff.ts";

function dataModule(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

globalThis.__platformAdmissionsHandoffActionTest = {
  RepositoryError: PlatformAdmissionsHandoffRepositoryError,
  actor: null,
  mutation: null,
  revalidated: [],
  async requireActor() {
    return this.actor;
  },
  parse(form) {
    return parsePlatformAdmissionsHandoffFormData(form);
  },
  parseUuid(value) {
    return parsePlatformAdmissionsHandoffUuid(value);
  },
  async mutate(actorValue, input) {
    return this.mutation(actorValue, input);
  },
  revalidatePath(path) {
    this.revalidated.push(path);
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/platform-admissions-handoff-actions.ts")) {
      if (specifier === "next/cache") {
        return {
          shortCircuit: true,
          url: dataModule(
            "export const revalidatePath = (path) => globalThis.__platformAdmissionsHandoffActionTest.revalidatePath(path);",
          ),
        };
      }
      if (specifier === "./platform-guards") {
        return {
          shortCircuit: true,
          url: dataModule(
            "export const requirePlatformSalesActor = () => globalThis.__platformAdmissionsHandoffActionTest.requireActor();",
          ),
        };
      }
      if (specifier === "./platform-admissions-handoff") {
        return {
          shortCircuit: true,
          url: dataModule(`
            export const mutatePlatformAdmissionsHandoff = (actor, input) => globalThis.__platformAdmissionsHandoffActionTest.mutate(actor, input);
            export const parsePlatformAdmissionsHandoffFormData = (form) => globalThis.__platformAdmissionsHandoffActionTest.parse(form);
            export const parsePlatformAdmissionsHandoffUuid = (value) => globalThis.__platformAdmissionsHandoffActionTest.parseUuid(value);
            export const PlatformAdmissionsHandoffRepositoryError = globalThis.__platformAdmissionsHandoffActionTest.RepositoryError;
          `),
        };
      }
    }
    return nextResolve(specifier, context);
  },
});

const { updatePlatformAdmissionsHandoffAction } = await import(
  "../src/lib/platform-admissions-handoff-actions.ts?action-test"
);

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const LEAD_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "33333333-3333-4333-8333-333333333333";
const CASE_ID = "44444444-4444-4444-8444-444444444444";
const AT = "2026-08-26T08:00:00+06:00";

function actor(role = "admin") {
  return {
    authUserId: "55555555-5555-4555-8555-555555555555",
    profileId: "66666666-6666-4666-8666-666666666666",
    membershipId: "77777777-7777-4777-8777-777777777777",
    organizationId: ORGANIZATION_ID,
    displayName: "Operator",
    platformRole: role,
    platformAccessVersion: 1,
    platformBundleId: "88888888-8888-4888-8888-888888888888",
    platformBundleVersion: 1,
    role,
  };
}

function handoffRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    lead_id: LEAD_ID,
    gate_version: 3,
    gate_state: "satisfied",
    normal_handoff_allowed: true,
    exceptional_handoff_allowed: false,
    can_submit_normal: true,
    can_submit_exceptional: false,
    case_id: null,
    case_state: null,
    admissions_owner_membership_id: null,
    admissions_owner_display_name: null,
    handoff_mode: null,
    handoff_reason: null,
    handed_off_at: null,
    starter_task_count: 0,
    eligible_admissions_owners: [
      { membership_id: OWNER_ID, display_name: "Curator Owner" },
    ],
    ...overrides,
  };
}

function studentCaseHandoffContextRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    lead_id: LEAD_ID,
    student_case_id: CASE_ID,
    case_state: "active",
    handoff_mode: "normal",
    handoff_state: "completed",
    handoff_reason: "Ready for audited Admissions intake",
    handoff_source: "canonical_sales",
    handed_off_at: AT,
    actor_membership_id: "99999999-9999-4999-8999-999999999999",
    actor_display_name: "Sales Owner",
    admissions_owner_membership_id: OWNER_ID,
    admissions_owner_display_name: "Curator Owner",
    gate_version: 3,
    gate_state: "satisfied",
    workflow_version: 5,
    sales_context: {
      lead_id: LEAD_ID,
      stage_key: "qualified",
      source_key: "manual:test-u6",
      current_owner_membership_id: "99999999-9999-4999-8999-999999999999",
      next_action_text: "Transfer to Admissions",
      next_action_due_date: "2026-08-01",
      workflow_version: 5,
    },
    client_context: {
      client_id: "12121212-1212-4212-8212-121212121212",
      display_name: "Synthetic U6 Client",
    },
    provenance: [],
    conversation_links: [
      {
        conversation_id: "34343434-3434-4434-8434-343434343434",
        subject: "Synthetic U6 WhatsApp context",
        queue: "sales",
        status: "open",
        updated_at: AT,
      },
    ],
    starter_tasks: [
      {
        task_id: "12345678-1234-4234-8234-123456789012",
        source_key: "u6.sales-context-review",
        title: "Проверить унаследованный контекст Sales",
        assignee_membership_id: OWNER_ID,
        assignee_display_name: "Curator Owner",
        priority: "high",
        due_at: null,
        status: "open",
      },
      {
        task_id: "23456789-2345-4345-8345-234567890123",
        source_key: "u6.study-route-confirmation",
        title: "Подтвердить маршрут обучения и недостающие данные",
        assignee_membership_id: OWNER_ID,
        assignee_display_name: "Curator Owner",
        priority: "normal",
        due_at: null,
        status: "open",
      },
      {
        task_id: "34567890-3456-4456-8456-345678901234",
        source_key: "u6.document-request-plan",
        title: "Подготовить первичный план запроса документов",
        assignee_membership_id: OWNER_ID,
        assignee_display_name: "Curator Owner",
        priority: "normal",
        due_at: null,
        status: "open",
      },
    ],
    ...overrides,
  };
}

const read = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("U6 handoff normalization stays truthful for role and completion state", () => {
  const readyForSales = normalizePlatformAdmissionsHandoff(
    handoffRow(),
    ORGANIZATION_ID,
    "sales",
  );
  assert.equal(readyForSales.status, "ready");
  assert.equal(readyForSales.canSubmitNormal, true);
  assert.equal(readyForSales.canSubmitExceptional, false);

  const completed = normalizePlatformAdmissionsHandoff(
    handoffRow({
      case_id: CASE_ID,
      case_state: "active",
      admissions_owner_membership_id: OWNER_ID,
      admissions_owner_display_name: "Curator Owner",
      handoff_mode: "normal",
      handoff_reason: "Qualified lead is ready for Admissions intake",
      handed_off_at: AT,
      starter_task_count: 3,
      can_submit_normal: false,
    }),
    ORGANIZATION_ID,
    "admin",
  );
  assert.equal(completed.status, "completed");
  assert.equal(completed.caseId, CASE_ID);

  assert.throws(
    () =>
      normalizePlatformAdmissionsHandoff(
        handoffRow({
          gate_state: "overridden",
          normal_handoff_allowed: false,
          exceptional_handoff_allowed: true,
          can_submit_normal: false,
          can_submit_exceptional: true,
        }),
        ORGANIZATION_ID,
        "sales",
      ),
    PlatformAdmissionsHandoffRepositoryError,
  );
});

test("U6 handoff form parser accepts only bounded canonical payloads", () => {
  const valid = new FormData();
  valid.set("lead_id", LEAD_ID);
  valid.set("expected_gate_version", "3");
  valid.set("admissions_owner_membership_id", OWNER_ID);
  valid.set("handoff_mode", "normal");
  valid.set("reason", "Ready for audited Admissions intake");
  valid.set("request_id", "99999999-9999-4999-8999-999999999999");
  assert.deepEqual(parsePlatformAdmissionsHandoffFormData(valid), {
    leadId: LEAD_ID,
    expectedGateVersion: 3,
    admissionsOwnerMembershipId: OWNER_ID,
    handoffMode: "normal",
    reason: "Ready for audited Admissions intake",
    requestId: "99999999-9999-4999-8999-999999999999",
  });

  valid.set("reason", "x".repeat(1001));
  assert.equal(parsePlatformAdmissionsHandoffFormData(valid), null);
});

test("U6 repository rejects forged mutation input before RPC", async () => {
  let called = false;
  const client = {
    schema() {
      return {
        async rpc() {
          called = true;
          return { data: null, error: null };
        },
      };
    },
  };
  await assert.rejects(
    () =>
      mutatePlatformAdmissionsHandoff(
        actor("admin"),
        {
          leadId: LEAD_ID,
          expectedGateVersion: 0,
          admissionsOwnerMembershipId: OWNER_ID,
          handoffMode: "normal",
          reason: "  forged  ",
          requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
        { client },
      ),
    PlatformAdmissionsHandoffRepositoryError,
  );
  assert.equal(called, false);
});

test("U6 repository sends exact RPC payload and verifies the committed response", async () => {
  let call = null;
  const client = {
    schema() {
      return {
        async rpc(functionName, args) {
          call = { functionName, args };
          return {
            data: {
              ...handoffRow({
                gate_version: 3,
                can_submit_normal: false,
                case_id: CASE_ID,
                case_state: "active",
                admissions_owner_membership_id: OWNER_ID,
                admissions_owner_display_name: "Curator Owner",
                handoff_mode: "normal",
                handoff_reason: "Ready for audited Admissions intake",
                handed_off_at: AT,
                starter_task_count: 3,
              }),
              request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              changed_at: AT,
            },
            error: null,
          };
        },
      };
    },
  };
  const receipt = await mutatePlatformAdmissionsHandoff(
    actor("admin"),
    {
      leadId: LEAD_ID,
      expectedGateVersion: 3,
      admissionsOwnerMembershipId: OWNER_ID,
      handoffMode: "normal",
      reason: "Ready for audited Admissions intake",
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    { client },
  );
  assert.deepEqual(call, {
    functionName: "handoff_lead_to_admissions",
    args: {
      p_lead_id: LEAD_ID,
      p_expected_gate_version: 3,
      p_admissions_owner_membership_id: OWNER_ID,
      p_handoff_mode: "normal",
      p_reason: "Ready for audited Admissions intake",
      p_request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
  });
  assert.equal(receipt.caseId, CASE_ID);
  assert.equal(receipt.gateVersion, 3);
});

test("U6 mutation maps plain PostgREST conflicts and rejects a forged receipt version", async () => {
  const conflictClient = {
    schema() {
      return {
        async rpc() {
          return {
            data: null,
            error: {
              code: "PT409",
              message: "admissions_handoff_version_conflict",
            },
          };
        },
      };
    },
  };
  await assert.rejects(
    () => mutatePlatformAdmissionsHandoff(
      actor("admin"),
      {
        leadId: LEAD_ID,
        expectedGateVersion: 3,
        admissionsOwnerMembershipId: OWNER_ID,
        handoffMode: "normal",
        reason: "Ready for audited Admissions intake",
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      { client: conflictClient },
    ),
    (error) =>
      error instanceof PlatformAdmissionsHandoffRepositoryError &&
      error.kind === "stale",
  );

  const forgedReceiptClient = {
    schema() {
      return {
        async rpc() {
          return {
            data: {
              ...handoffRow({
                gate_version: 4,
                can_submit_normal: false,
                case_id: CASE_ID,
                case_state: "active",
                admissions_owner_membership_id: OWNER_ID,
                admissions_owner_display_name: "Curator Owner",
                handoff_mode: "normal",
                handoff_reason: "Ready for audited Admissions intake",
                handed_off_at: AT,
                starter_task_count: 3,
              }),
              request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              changed_at: AT,
            },
            error: null,
          };
        },
      };
    },
  };
  await assert.rejects(
    () => mutatePlatformAdmissionsHandoff(
      actor("admin"),
      {
        leadId: LEAD_ID,
        expectedGateVersion: 3,
        admissionsOwnerMembershipId: OWNER_ID,
        handoffMode: "normal",
        reason: "Ready for audited Admissions intake",
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      { client: forgedReceiptClient },
    ),
    PlatformAdmissionsHandoffRepositoryError,
  );
});

test("U6 read repository rejects malformed or cross-tenant rows", async () => {
  const client = {
    schema() {
      return {
        async rpc() {
          return {
            data: [handoffRow({ organization_id: CASE_ID })],
            error: null,
          };
        },
      };
    },
  };
  await assert.rejects(
    () => getPlatformAdmissionsHandoff(actor("admin"), LEAD_ID, { client }),
    PlatformAdmissionsHandoffRepositoryError,
  );
});

test("U6 Admissions case read uses the student-case scoped handoff RPC", async () => {
  const calls = [];
  const client = {
    schema(schemaName) {
      assert.equal(schemaName, "platform");
      return {
        async rpc(name, args) {
          calls.push([name, args]);
          return {
            data: [
              studentCaseHandoffContextRow(),
            ],
            error: null,
          };
        },
      };
    },
  };

  const result = await getPlatformStudentCaseAdmissionsHandoff(
    actor("admissions"),
    CASE_ID,
    { client },
  );

  assert.deepEqual(calls, [[
    "staff_student_case_handoff_context",
    { p_student_case_id: CASE_ID },
  ]]);
  assert.equal(result.caseId, CASE_ID);
  assert.equal(result.status, "completed");
  assert.equal(result.admissionsOwnerDisplayName, "Curator Owner");
  assert.equal(result.starterTaskCount, 3);
  assert.equal(result.starterTasks[0]?.sourceKey, "u6.sales-context-review");
  assert.equal(
    result.inheritedContext?.conversations[0]?.subject,
    "Synthetic U6 WhatsApp context",
  );
});

test("U6 server action revalidates Sales and Admissions paths after success", async () => {
  globalThis.__platformAdmissionsHandoffActionTest.actor = actor("admin");
  globalThis.__platformAdmissionsHandoffActionTest.revalidated = [];
  globalThis.__platformAdmissionsHandoffActionTest.mutation = async () => ({
    ...normalizePlatformAdmissionsHandoff(
      handoffRow({
        case_id: CASE_ID,
        case_state: "active",
        admissions_owner_membership_id: OWNER_ID,
        admissions_owner_display_name: "Curator Owner",
        handoff_mode: "normal",
        handoff_reason: "Ready for audited Admissions intake",
        handed_off_at: AT,
        starter_task_count: 3,
        can_submit_normal: false,
      }),
      ORGANIZATION_ID,
      "admin",
    ),
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    changedAt: AT,
  });
  const form = new FormData();
  form.set("lead_id", LEAD_ID);
  form.set("expected_gate_version", "3");
  form.set("admissions_owner_membership_id", OWNER_ID);
  form.set("handoff_mode", "normal");
  form.set("reason", "Ready for audited Admissions intake");
  form.set("request_id", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

  const result = await updatePlatformAdmissionsHandoffAction(
    {
      status: "idle",
      requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      gateVersion: null,
      caseId: null,
      handoffMode: null,
      changedAt: null,
    },
    form,
  );
  assert.equal(result.status, "saved");
  assert.deepEqual(
    globalThis.__platformAdmissionsHandoffActionTest.revalidated,
    ["/sales", `/sales/${LEAD_ID}`, "/clients", `/clients/${CASE_ID}`, "/applications"],
  );
});

test("U6 card stays off Sales until #431 while the connected case path remains", () => {
  const componentSource = read("src/components/platform/sales/SalesAdmissionsHandoffCard.tsx");
  assert.match(componentSource, /admissions-handoff-case-link/);
  assert.match(componentSource, /eligibleAdmissionsOwners/);
  assert.match(componentSource, /role=\{state\.status === "saved" \? "status" : "alert"\}/);
  assert.match(componentSource, /window\.location\.reload\(\)/);
  assert.match(componentSource, /admissions-handoff-refresh/);

  const salesSource = read("src/app/(staff)/sales/[id]/SalesLeadWorkspace.tsx");
  assert.doesNotMatch(salesSource, /SalesAdmissionsHandoffCard|admissions-handoff-/);

  const clientSource = read("src/app/(staff)/clients/[id]/StudentWorkspace.tsx");
  assert.match(clientSource, /getPlatformStudentCaseAdmissionsHandoff/);
  assert.match(
    clientSource,
    /canReadAdmissionsHandoffContext[\s\S]*actor\.platformRole === "admin"[\s\S]*actor\.platformRole === "admissions"/,
  );
  assert.match(
    clientSource,
    /canReadAdmissionsHandoffContext[\s\S]*getPlatformStudentCaseAdmissionsHandoff[\s\S]*Promise\.resolve\(null\)/,
  );
  assert.match(clientSource, /starterTasks/);
  assert.doesNotMatch(clientSource, /listPlatformStaffMembers/);
  assert.doesNotMatch(clientSource, /listPlatformStudentCaseTasks/);
});
