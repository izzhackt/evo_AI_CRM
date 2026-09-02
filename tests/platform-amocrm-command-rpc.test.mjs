import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export default {};",
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  PlatformAmoCrmCommandRpcError,
  claimPlatformAmoCrmCommand,
  finishPlatformAmoCrmCommand,
  preparePlatformAmoCrmCommand,
  readPlatformAmoCrmBindings,
  readPlatformBlockingAmoCrmCommand,
  reconcileUnknownPlatformAmoCrmCommand,
} = await import("../src/lib/server/platform-amocrm-command-rpc.ts");

const IDS = Object.freeze({
  organization: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  lead: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  person: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  studentCase: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  attempt: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  receipt: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  request: "12121212-1212-4212-8212-121212121212",
});

function sampleAttempt(overrides = {}) {
  return {
    attempt_id: IDS.attempt,
    command_receipt_id: IDS.receipt,
    organization_id: IDS.organization,
    idempotency_key: "amocrm:lead-note:1",
    operation_name: "lead_note_create",
    actor_role: "sales",
    workflow_scope: "sales_pre_handoff",
    workflow_lead_id: IDS.lead,
    student_case_id: null,
    person_id: null,
    lead_id: IDS.lead,
    target_contact_id: null,
    target_lead_id: "900001",
    status: "prepared",
    result_contact_id: null,
    result_lead_id: null,
    failure_code: null,
    ...overrides,
  };
}

function expectedAttempt(overrides = {}) {
  const row = sampleAttempt(overrides);
  return {
    attemptId: row.attempt_id,
    commandReceiptId: row.command_receipt_id,
    organizationId: row.organization_id,
    idempotencyKey: row.idempotency_key,
    operationName: row.operation_name,
    actorRole: row.actor_role,
    workflowScope: row.workflow_scope,
    workflowLeadId: row.workflow_lead_id,
    studentCaseId: row.student_case_id,
    personId: row.person_id,
    leadId: row.lead_id,
    targetContactId: row.target_contact_id,
    targetLeadId: row.target_lead_id,
    status: row.status,
    resultContactId: row.result_contact_id,
    resultLeadId: row.result_lead_id,
    failureCode: row.failure_code,
  };
}

function stubClient(handler) {
  return {
    schema(schemaName) {
      assert.equal(schemaName, "platform");
      return {
        async rpc(functionName, args, options) {
          return handler(functionName, args, options);
        },
      };
    },
  };
}

test("prepare uses the Supabase RPC seam with the exact typed authorization payload", async () => {
  const calls = [];
  const client = stubClient(async (functionName, args) => {
    calls.push({ functionName, args });
    return {
      data: { kind: "prepared", attempt: sampleAttempt() },
      error: null,
    };
  });

  const result = await preparePlatformAmoCrmCommand(client, {
    organizationId: IDS.organization,
    authorization: {
      actorRole: "sales",
      workflowScope: "sales_pre_handoff",
      workflowLeadId: IDS.lead,
      studentCaseId: null,
    },
    personId: null,
    leadId: IDS.lead,
    operationName: "lead_note_create",
    idempotencyKey: "amocrm:lead-note:1",
    targetContactId: null,
    targetLeadId: "900001",
    payload: { note_text: "Reviewed note" },
  });

  assert.equal(calls[0].functionName, "prepare_amocrm_command");
  assert.deepEqual(calls[0].args.p_authorization, {
    actor_role: "sales",
    workflow_scope: "sales_pre_handoff",
    workflow_lead_id: IDS.lead,
    student_case_id: null,
  });
  assert.equal(calls[0].args.p_operation_name, "lead_note_create");
  assert.equal(calls[0].args.p_target_lead_id, "900001");
  assert.deepEqual(result, { kind: "prepared", attempt: expectedAttempt() });
});

test("staff reads stay on staff-safe RPCs and return only canonical bindings or one blocker", async () => {
  const calls = [];
  const client = stubClient(async (functionName, args) => {
    calls.push({ functionName, args });
    if (functionName === "read_staff_amocrm_bindings") {
      return {
        data: { contact_id: "700001", lead_id: "800001" },
        error: null,
      };
    }
    return {
      data: sampleAttempt({ status: "unknown", failure_code: "provider_timeout" }),
      error: null,
    };
  });

  assert.deepEqual(
    await readPlatformAmoCrmBindings(client, {
      organizationId: IDS.organization,
      authorization: {
        actorRole: "admissions",
        workflowScope: "admissions_post_handoff",
        workflowLeadId: IDS.lead,
        studentCaseId: IDS.studentCase,
      },
      personId: IDS.person,
      leadId: IDS.lead,
    }),
    { contactId: "700001", leadId: "800001" },
  );

  assert.deepEqual(
    await readPlatformBlockingAmoCrmCommand(client, {
      organizationId: IDS.organization,
      authorization: {
        actorRole: "admissions",
        workflowScope: "admissions_post_handoff",
        workflowLeadId: IDS.lead,
        studentCaseId: IDS.studentCase,
      },
      personId: IDS.person,
      leadId: IDS.lead,
    }),
    expectedAttempt({
      status: "unknown",
      failure_code: "provider_timeout",
    }),
  );

  assert.deepEqual(
    calls.map(({ functionName }) => functionName),
    ["read_staff_amocrm_bindings", "read_staff_blocking_amocrm_command"],
  );
});

test("service claim, finish and reconcile use exact non-fallback RPC names", async () => {
  const calls = [];
  const client = stubClient(async (functionName, args) => {
    calls.push({ functionName, args });
    if (functionName === "claim_amocrm_command") {
      return {
        data: { kind: "claimed", reason: null, attempt: sampleAttempt() },
        error: null,
      };
    }
    if (functionName === "finish_amocrm_command") {
      return {
        data: {
          kind: "settled",
          attempt: sampleAttempt({
            status: "accepted",
            result_lead_id: "900001",
          }),
        },
        error: null,
      };
    }
    return {
      data: {
        kind: "reconciled",
        attempt: sampleAttempt({
          status: "accepted",
          result_lead_id: "900001",
        }),
      },
      error: null,
    };
  });

  const claimResult = await claimPlatformAmoCrmCommand(client, {
    organizationId: IDS.organization,
    attemptId: IDS.attempt,
    requestId: IDS.request,
    workerRef: "next-app-amocrm",
    visibilityTimeoutSeconds: 120,
  });
  const finishResult = await finishPlatformAmoCrmCommand(client, {
    organizationId: IDS.organization,
    attemptId: IDS.attempt,
    requestId: IDS.request,
    outcome: "accepted",
    providerRequestId: "request-1",
    providerHttpStatus: 200,
    providerReadback: { id: 900001 },
    providerReadbackSha256: "a".repeat(64),
    providerRespondedAt: "2026-09-02T12:00:00Z",
    resultContactId: null,
    resultLeadId: "900001",
    failureCode: null,
  });
  const reconcileResult = await reconcileUnknownPlatformAmoCrmCommand(client, {
    organizationId: IDS.organization,
    attemptId: IDS.attempt,
    requestId: IDS.request,
    outcome: "reconciled" === "reconciled" ? "accepted" : "unchanged",
    providerReadback: { id: 900001 },
    providerReadbackSha256: "b".repeat(64),
    providerReadbackAt: "2026-09-02T12:05:00Z",
    providerRespondedAt: "2026-09-02T12:00:00Z",
    resultContactId: null,
    resultLeadId: "900001",
    failureCode: null,
  });

  assert.equal(claimResult.kind, "claimed");
  assert.equal(finishResult.kind, "settled");
  assert.equal(reconcileResult.kind, "reconciled");
  assert.deepEqual(
    calls.map(({ functionName }) => functionName),
    [
      "claim_amocrm_command",
      "finish_amocrm_command",
      "reconcile_unknown_amocrm_command",
    ],
  );
});

test("RPC transport or shape drift fails closed", async () => {
  const transportFailure = stubClient(async () => {
    throw new Error("network drift");
  });
  await assert.rejects(
    preparePlatformAmoCrmCommand(transportFailure, {
      organizationId: IDS.organization,
      authorization: {
        actorRole: "sales",
        workflowScope: "sales_pre_handoff",
        workflowLeadId: IDS.lead,
        studentCaseId: null,
      },
      personId: null,
      leadId: IDS.lead,
      operationName: "lead_note_create",
      idempotencyKey: "amocrm:lead-note:2",
      targetContactId: null,
      targetLeadId: "900001",
      payload: { note_text: "Reviewed note" },
    }),
    PlatformAmoCrmCommandRpcError,
  );

  const shapeFailure = stubClient(async () => ({
    data: { kind: "prepared", attempt: { ...sampleAttempt(), operation_name: "legacy" } },
    error: null,
  }));
  await assert.rejects(
    preparePlatformAmoCrmCommand(shapeFailure, {
      organizationId: IDS.organization,
      authorization: {
        actorRole: "sales",
        workflowScope: "sales_pre_handoff",
        workflowLeadId: IDS.lead,
        studentCaseId: null,
      },
      personId: null,
      leadId: IDS.lead,
      operationName: "lead_note_create",
      idempotencyKey: "amocrm:lead-note:3",
      targetContactId: null,
      targetLeadId: "900001",
      payload: { note_text: "Reviewed note" },
    }),
    PlatformAmoCrmCommandRpcError,
  );
});
