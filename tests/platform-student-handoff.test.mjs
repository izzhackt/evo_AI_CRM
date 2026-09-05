import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getPlatformLeadAdmissionsGate,
  getPlatformLeadAdmissionsHandoff,
  getPlatformStudentCaseHandoffContext,
  handoffPlatformLeadToAdmissions,
  mutatePlatformLeadAdmissionsGate,
  normalizePlatformLeadAdmissionsGateSnapshot,
  normalizePlatformLeadAdmissionsHandoffSnapshot,
  normalizePlatformStudentCaseHandoffContext,
  PlatformStudentHandoffRepositoryError,
} from "../src/lib/platform-student-handoff.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const LEAD_ID = "22222222-2222-4222-8222-222222222222";
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const SALES_MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444";
const ADMISSIONS_MEMBERSHIP_ID = "55555555-5555-4555-8555-555555555555";
const PROFILE_ID = "66666666-6666-4666-8666-666666666666";
const AUTH_USER_ID = "77777777-7777-4777-8777-777777777777";
const REQUEST_ID = "88888888-8888-4888-8888-888888888888";
const TASK_ID = "99999999-9999-4999-8999-999999999999";
const TASK_ID_2 = "99999999-9999-4999-8999-999999999998";
const TASK_ID_3 = "99999999-9999-4999-8999-999999999997";
const PROVENANCE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONVERSATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AT = "2026-09-02T03:45:17.000Z";

function actor(authorityRole = "admin") {
  return Object.freeze({
    authUserId: AUTH_USER_ID,
    profileId: PROFILE_ID,
    membershipId: SALES_MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    displayName: "EVO Staff",
    email: "staff@example.test",
    platformRole: authorityRole,
    authorityRole,
    platformAccessVersion: 1,
    platformBundleId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    platformBundleVersion: 1,
  });
}

function gateRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    lead_id: LEAD_ID,
    contract_confirmed: false,
    contract_confirmed_by_membership_id: null,
    contract_confirmed_at: null,
    contract_evidence_reference: null,
    first_payment_amount: null,
    first_payment_currency: null,
    first_payment_due_date: null,
    first_payment_received_date: null,
    first_payment_confirmed_by_membership_id: null,
    first_payment_confirmed_at: null,
    first_payment_evidence_reference: null,
    override_reason: null,
    overridden_by_membership_id: null,
    overridden_at: null,
    gate_state: "blocked",
    normal_handoff_allowed: false,
    exceptional_handoff_allowed: false,
    can_confirm_contract: true,
    can_confirm_first_payment: false,
    can_override_gate: false,
    gate_version: 7,
    updated_at: AT,
    ...overrides,
  };
}

function confirmedContractGateRow(overrides = {}) {
  return gateRow({
    contract_confirmed: true,
    contract_confirmed_by_membership_id: SALES_MEMBERSHIP_ID,
    contract_confirmed_at: AT,
    contract_evidence_reference: "contract:EVO-42",
    first_payment_amount: 1500.5,
    first_payment_currency: "USD",
    first_payment_due_date: "2026-09-15",
    can_confirm_contract: false,
    can_confirm_first_payment: true,
    gate_version: "8",
    ...overrides,
  });
}

function ownerRow(overrides = {}) {
  return {
    membership_id: ADMISSIONS_MEMBERSHIP_ID,
    display_name: "Admissions Owner",
    ...overrides,
  };
}

function handoffRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    lead_id: LEAD_ID,
    gate_version: "9",
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
    eligible_admissions_owners: [ownerRow()],
    ...overrides,
  };
}

function completedHandoffRow(overrides = {}) {
  return handoffRow({
    can_submit_normal: false,
    case_id: CASE_ID,
    case_state: "active",
    admissions_owner_membership_id: ADMISSIONS_MEMBERSHIP_ID,
    admissions_owner_display_name: "Admissions Owner",
    handoff_mode: "normal",
    handoff_reason: "Contract and first payment verified",
    handed_off_at: AT,
    starter_task_count: "3",
    ...overrides,
  });
}

function studentContextRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    lead_id: LEAD_ID,
    student_case_id: CASE_ID,
    case_state: "active",
    handoff_mode: "normal",
    handoff_state: "completed",
    handoff_reason: "Contract and first payment verified",
    handoff_source: "canonical_sales",
    handed_off_at: AT,
    actor_membership_id: SALES_MEMBERSHIP_ID,
    actor_display_name: "Sales Owner",
    admissions_owner_membership_id: ADMISSIONS_MEMBERSHIP_ID,
    admissions_owner_display_name: "Admissions Owner",
    gate_version: "9",
    gate_state: "satisfied",
    workflow_version: 12,
    sales_context: {
      lead_id: LEAD_ID,
      stage_key: "qualified",
      source_key: "website",
      current_owner_membership_id: SALES_MEMBERSHIP_ID,
      next_action_text: "Review handoff",
      next_action_due_date: "2026-09-03",
      workflow_version: "12",
    },
    client_context: {
      client_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      display_name: "Validated Student",
    },
    provenance: [
      {
        provenance_id: PROVENANCE_ID,
        subject_type: "lead",
        source_system: "website",
        evidence_type: "form_submission",
        observed_at: AT,
        imported_at: AT,
        source_ref: "form:EVO-42",
      },
    ],
    conversation_links: [
      {
        conversation_id: CONVERSATION_ID,
        subject: "Admissions consultation",
        queue: "sales",
        status: "open",
        updated_at: AT,
      },
    ],
    starter_tasks: [
      [TASK_ID, "u6.sales-context-review", "Review inherited Sales context"],
      [TASK_ID_2, "u6.study-route-confirmation", "Confirm the study route"],
      [TASK_ID_3, "u6.document-request-plan", "Collect initial documents"],
    ].map(([taskId, sourceKey, title]) => ({
      task_id: taskId,
      source_key: sourceKey,
      title,
      assignee_membership_id: ADMISSIONS_MEMBERSHIP_ID,
      assignee_display_name: "Admissions Owner",
      priority: "high",
      due_at: AT,
      status: "open",
    })),
    ...overrides,
  };
}

function gateInput(overrides = {}) {
  return {
    leadId: LEAD_ID,
    expectedGateVersion: "7",
    requestId: REQUEST_ID,
    action: "confirm_contract",
    amount: 1500.5,
    currency: "USD",
    dueDate: "2026-09-15",
    receivedDate: null,
    evidenceReference: "contract:EVO-42",
    reason: "Reviewed by staff",
    ...overrides,
  };
}

function handoffInput(overrides = {}) {
  return {
    leadId: LEAD_ID,
    expectedGateVersion: "9",
    admissionsOwnerMembershipId: ADMISSIONS_MEMBERSHIP_ID,
    handoffMode: "normal",
    reason: "Contract and first payment verified",
    requestId: REQUEST_ID,
    ...overrides,
  };
}

test("gate, handoff and Student context normalizers preserve exact tenant-bound facts", () => {
  const gate = normalizePlatformLeadAdmissionsGateSnapshot(
    confirmedContractGateRow(),
    ORGANIZATION_ID,
    LEAD_ID,
  );
  assert.equal(gate.gateVersion, "8");
  assert.equal(gate.firstPaymentAmount, 1500.5);
  assert.equal(gate.firstPaymentCurrency, "USD");

  const handoff = normalizePlatformLeadAdmissionsHandoffSnapshot(
    completedHandoffRow(),
    ORGANIZATION_ID,
    LEAD_ID,
  );
  assert.equal(handoff.caseId, CASE_ID);
  assert.equal(handoff.starterTaskCount, 3);
  assert.deepEqual(handoff.eligibleAdmissionsOwners, [
    {
      membershipId: ADMISSIONS_MEMBERSHIP_ID,
      displayName: "Admissions Owner",
    },
  ]);

  const context = normalizePlatformStudentCaseHandoffContext(
    studentContextRow(),
    ORGANIZATION_ID,
    CASE_ID,
  );
  assert.equal(context.workflowVersion, "12");
  assert.equal(context.salesContext.workflowVersion, "12");
  assert.equal(context.starterTasks[0].sourceKey, "u6.sales-context-review");
  assert.equal(context.conversationLinks[0].conversationId, CONVERSATION_ID);
});

test("normalizers reject extra fields, cross-tenant rows and malformed nested projections", () => {
  assert.throws(
    () => normalizePlatformLeadAdmissionsGateSnapshot(
      gateRow({ unexpected: true }),
      ORGANIZATION_ID,
      LEAD_ID,
    ),
    PlatformStudentHandoffRepositoryError,
  );
  assert.throws(
    () => normalizePlatformLeadAdmissionsHandoffSnapshot(
      handoffRow({ organization_id: PROFILE_ID }),
      ORGANIZATION_ID,
      LEAD_ID,
    ),
    PlatformStudentHandoffRepositoryError,
  );
  assert.throws(
    () => normalizePlatformLeadAdmissionsGateSnapshot(
      confirmedContractGateRow({ first_payment_amount: "1.234" }),
      ORGANIZATION_ID,
      LEAD_ID,
    ),
    PlatformStudentHandoffRepositoryError,
  );
  assert.throws(
    () => normalizePlatformLeadAdmissionsHandoffSnapshot(
      handoffRow({ eligible_admissions_owners: [ownerRow(), ownerRow()] }),
      ORGANIZATION_ID,
      LEAD_ID,
    ),
    PlatformStudentHandoffRepositoryError,
  );
  assert.throws(
    () => normalizePlatformStudentCaseHandoffContext(
      studentContextRow({
        sales_context: {
          ...studentContextRow().sales_context,
          workflow_version: "13",
        },
      }),
      ORGANIZATION_ID,
      CASE_ID,
    ),
    PlatformStudentHandoffRepositoryError,
  );
});

test("all five repositories call the exact platform RPCs through one injected user client", async () => {
  const calls = [];
  const responses = {
    staff_lead_admissions_gate: [gateRow()],
    mutate_lead_admissions_gate: {
      request_id: REQUEST_ID,
      ...confirmedContractGateRow(),
      changed_at: AT,
    },
    staff_lead_admissions_handoff: [handoffRow()],
    handoff_lead_to_admissions: {
      ...completedHandoffRow(),
      request_id: REQUEST_ID,
      changed_at: AT,
    },
    staff_student_case_handoff_context: [studentContextRow()],
  };
  const client = {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name, args, options) {
          calls.push({ name, args, options });
          return { data: responses[name], error: null };
        },
      };
    },
  };
  const dependencies = { client };

  await getPlatformLeadAdmissionsGate(actor("admin"), LEAD_ID, dependencies);
  const gateReceipt = await mutatePlatformLeadAdmissionsGate(
    actor("admin"),
    gateInput(),
    dependencies,
  );
  await getPlatformLeadAdmissionsHandoff(actor("sales"), LEAD_ID, dependencies);
  const handoffReceipt = await handoffPlatformLeadToAdmissions(
    actor("admin"),
    handoffInput(),
    dependencies,
  );
  await getPlatformStudentCaseHandoffContext(
    actor("admissions"),
    CASE_ID,
    dependencies,
  );

  assert.equal(gateReceipt.gateVersion, "8");
  assert.equal(handoffReceipt.caseId, CASE_ID);
  assert.deepEqual(calls.map((call) => call.name), [
    "staff_lead_admissions_gate",
    "mutate_lead_admissions_gate",
    "staff_lead_admissions_handoff",
    "handoff_lead_to_admissions",
    "staff_student_case_handoff_context",
  ]);
  assert.deepEqual(calls[0], {
    name: "staff_lead_admissions_gate",
    args: { p_lead_id: LEAD_ID },
    options: { get: true },
  });
  assert.deepEqual(calls[1].args, {
    p_lead_id: LEAD_ID,
    p_expected_gate_version: "7",
    p_request_id: REQUEST_ID,
    p_action: "confirm_contract",
    p_amount: 1500.5,
    p_currency: "USD",
    p_due_date: "2026-09-15",
    p_received_date: null,
    p_evidence_reference: "contract:EVO-42",
    p_reason: "Reviewed by staff",
  });
  assert.deepEqual(calls[3].args, {
    p_lead_id: LEAD_ID,
    p_expected_gate_version: "9",
    p_admissions_owner_membership_id: ADMISSIONS_MEMBERSHIP_ID,
    p_handoff_mode: "normal",
    p_reason: "Contract and first payment verified",
    p_request_id: REQUEST_ID,
  });
  assert.deepEqual(calls[4], {
    name: "staff_student_case_handoff_context",
    args: { p_student_case_id: CASE_ID },
    options: { get: true },
  });
});

test("mutation repositories map safe PostgreSQL errors and distinguish blocked gates from stale versions", async () => {
  const cases = [
    [{ code: "22023", message: "invalid" }, "invalid"],
    [{ code: "42501", message: "forbidden" }, "forbidden"],
    [{ code: "23505", message: "request conflict" }, "request_conflict"],
    [{ code: "PT409", message: "admissions_handoff_gate_incomplete" }, "gate_blocked"],
    [{ code: "PT409", message: "admissions_handoff_version_conflict" }, "stale"],
    [{ code: "XX000", message: "private detail" }, "unavailable"],
  ];
  for (const [error, expectedReason] of cases) {
    const dependencies = {
      client: {
        schema() {
          return { async rpc() { return { data: null, error }; } };
        },
      },
    };
    await assert.rejects(
      () => handoffPlatformLeadToAdmissions(
        actor("admin"),
        handoffInput(),
        dependencies,
      ),
      (failure) => {
        assert.ok(failure instanceof PlatformStudentHandoffRepositoryError);
        assert.equal(failure.reason, expectedReason);
        assert.equal(
          failure.message,
          "Platform Student handoff data is unavailable.",
        );
        return true;
      },
    );
  }
});

test("repositories fail before RPC for wrong roles and invalid exact mutation shapes", async () => {
  let called = false;
  const dependencies = {
    client: {
      schema() {
        called = true;
        return { async rpc() { return { data: null, error: null }; } };
      },
    },
  };
  await assert.rejects(
    () => getPlatformLeadAdmissionsGate(
      actor("admissions"),
      LEAD_ID,
      dependencies,
    ),
    (failure) => failure instanceof PlatformStudentHandoffRepositoryError &&
      failure.reason === "forbidden",
  );
  await assert.rejects(
    () => mutatePlatformLeadAdmissionsGate(
      actor("admin"),
      gateInput({ amount: null }),
      dependencies,
    ),
    (failure) => failure instanceof PlatformStudentHandoffRepositoryError &&
      failure.reason === "invalid",
  );
  assert.equal(called, false);
});

test("source boundary uses the server cookie client and contains no service, Drizzle or fallback path", () => {
  const source = readFileSync(
    new URL("../src/lib/platform-student-handoff.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /await import\("\.\/supabase\/server"\)/);
  assert.match(source, /createSupabaseServerClient/);
  for (const rpc of [
    "staff_lead_admissions_gate",
    "mutate_lead_admissions_gate",
    "staff_lead_admissions_handoff",
    "handoff_lead_to_admissions",
    "staff_student_case_handoff_context",
  ]) {
    assert.match(source, new RegExp(`"${rpc}"`));
  }
  assert.doesNotMatch(
    source,
    /DATABASE_URL|SUPABASE_SERVICE|service[_-]?role|Drizzle|canonical-crm-repository|fallback/i,
  );
});

test("server actions enforce exact fields, staff guard and success-only revalidation", () => {
  const source = readFileSync(
    new URL("../src/lib/platform-student-handoff-actions.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /exactActionStringFields\(form, GATE_FORM_FIELDS\)/);
  assert.match(source, /exactActionStringFields\(form, HANDOFF_FORM_FIELDS\)/);
  assert.equal(
    source.match(/const actor = await requirePlatformSalesActor\(\);/g)?.length,
    2,
  );
  assert.match(
    source,
    /const receipt = await mutatePlatformLeadAdmissionsGate\(actor, input\);[\s\S]*revalidatePath\("\/v3\/pipeline"\);[\s\S]*revalidatePath\(`\/v3\/profile\?id=\$\{receipt\.leadId\}`\)/,
  );
  assert.match(
    source,
    /const receipt = await handoffPlatformLeadToAdmissions\(actor, input\);[\s\S]*revalidatePath\("\/v3\/pipeline"\);[\s\S]*revalidatePath\(`\/v3\/profile\?id=\$\{receipt\.leadId\}`\);[\s\S]*if \(receipt\.caseId\) \{[\s\S]*revalidatePath\(`\/v3\/profile\?case=\$\{receipt\.caseId\}`\)/,
  );
  assert.doesNotMatch(source, /revalidatePath\("\/(?:sales|clients)"\)/);
  assert.doesNotMatch(
    source,
    /revalidatePath\(`\/sales\/\$\{receipt\.leadId\}`\)/,
  );
  assert.doesNotMatch(source, /revalidatePath\("\/v3\/profile"\)/);
  assert.match(
    source,
    /return status === "request_conflict"[\s\S]*\? randomUUID\(\)[\s\S]*: verifiedRequestId \?\? randomUUID\(\);/,
  );
  assert.match(
    source,
    /error instanceof PlatformStudentHandoffRepositoryError[\s\S]*return gateFailureState\(form, error\.reason, input\);/,
  );
  assert.match(
    source,
    /error instanceof PlatformStudentHandoffRepositoryError[\s\S]*return handoffFailureState\(form, error\.reason, input\);/,
  );
  for (const status of [
    "idle",
    "saved",
    "invalid",
    "forbidden",
    "gate_blocked",
    "stale",
    "request_conflict",
    "unavailable",
  ]) {
    assert.match(source, new RegExp(`"${status}"`));
  }
  assert.doesNotMatch(
    source,
    /DATABASE_URL|SUPABASE_SERVICE|service[_-]?role|Drizzle|canonical-crm-repository|fallback/i,
  );
});

test("V3 profile exposes gate and handoff through the reviewed server-action contract", () => {
  const source = readFileSync(
    new URL(
      "../src/components/v3/profile/ProfileSalesTransition.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.equal(source.match(/useActionState\(/g)?.length, 2);
  assert.match(
    source,
    /useActionState\(\s*mutatePlatformLeadAdmissionsGateAction/,
  );
  assert.match(
    source,
    /useActionState\(\s*handoffPlatformLeadToAdmissionsAction/,
  );
  assert.equal(source.match(/name="expected_gate_version"/g)?.length, 2);
  assert.equal(source.match(/<Version value=\{gateVersion\} \/>/g)?.length, 2);

  for (const status of [
    "saved",
    "invalid",
    "forbidden",
    "gate_blocked",
    "stale",
    "request_conflict",
    "unavailable",
  ]) {
    assert.match(source, new RegExp(`${status}:`));
  }

  for (const field of [
    "lead_id",
    "request_id",
    "action",
    "amount",
    "currency",
    "due_date",
    "received_date",
    "reason",
    "evidence_reference",
    "admissions_owner_membership_id",
    "handoff_mode",
  ]) {
    assert.match(source, new RegExp(`name="${field}"`));
  }

  assert.match(source, /normalAvailable = handoff\.canSubmitNormal/);
  assert.match(
    source,
    /actorRole === "admin" && handoff\.canSubmitExceptional/,
  );
  assert.match(source, /"normal"/);
  assert.match(source, /"exceptional_override"/);
  assert.match(source, /data-testid="v3-sales-handoff-completed"/);
  assert.match(
    source,
    /href=\{`\/v3\/profile\?case=\$\{caseId\}&tab=overview`\}/,
  );
  assert.doesNotMatch(source, /href=\{`\/clients\/\$\{caseId\}`\}/);
  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|fetch\(|XMLHttpRequest|fallback/i,
  );
});
