import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  executePlatformAmoCrmSalesSync,
  reconcilePlatformAmoCrmSyncAttempt,
} = await import("../src/lib/server/platform-amocrm-command-service.ts");
const {
  CanonicalAmoCrmMutationError,
} = await import("../src/lib/server/canonical-amocrm-provider.ts");
const {
  claimPlatformAmoCrmCommand,
  finishPlatformAmoCrmCommand,
  preparePlatformAmoCrmCommand,
  readPlatformAmoCrmBindings,
} = await import("../src/lib/server/platform-amocrm-command-rpc.ts");
const serviceSource = readFileSync(
  new URL("../src/lib/server/platform-amocrm-command-service.ts", import.meta.url),
  "utf8",
);

const IDS = Object.freeze({
  actorUser: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  actorProfile: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  actorMembership: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  organization: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  lead: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  person: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  studentCase: "12121212-1212-4212-8212-121212121212",
  request: "34343434-3434-4434-8434-343434343434",
});

function actor(overrides = {}) {
  return {
    authUserId: IDS.actorUser,
    profileId: IDS.actorProfile,
    membershipId: IDS.actorMembership,
    organizationId: IDS.organization,
    displayName: "Director",
    email: "director@evo.test",
    platformRole: "admin",
    authorityRole: "admin",
    platformAccessVersion: 1,
    platformBundleId: "bundle",
    platformBundleVersion: 1,
    presentationRole: "admin",
    ...overrides,
  };
}

function salesLead(overrides = {}) {
  return {
    organizationId: IDS.organization,
    leadId: IDS.lead,
    clientId: IDS.person,
    clientDisplayName: "Amina Test",
    clientEmail: "amina@example.com",
    clientPhone: "+996555000111",
    stageKey: "qualified",
    ...overrides,
  };
}

function runtime() {
  const dispatches = [];
  const reads = [];
  const providerLeadId = "900002";
  const providerContactId = "900001";
  const providerNoteId = "900003";
  const providerTaskId = "900004";
  const tagName = "Sales Ready";
  const oppositeTagName = "Admissions Ready";

  function prepared(operationName, body, entityId) {
    return {
      request: {
        method: operationName === "lead_update" || operationName === "contact_update"
          ? "PATCH"
          : "POST",
        path: `/api/v4/${operationName}`,
        requestId: body.requestId ?? null,
      },
      body,
      bodyJson: JSON.stringify(body),
      bodySha256: `${operationName}`.padEnd(64, "0").slice(0, 64),
      requestSha256: `${operationName}`.padEnd(64, "1").slice(0, 64),
      async dispatch() {
        dispatches.push(operationName);
        return {
          entityId,
          request: {
            method: "POST",
            path: `/api/v4/${operationName}`,
            requestId: body.requestId ?? null,
          },
          response: {
            status: 200,
            providerRequestId: `req-${operationName}`,
          },
        };
      },
    };
  }

  const provider = {
    prepareCreateContact(input) {
      return prepared("contact_create", input, providerContactId);
    },
    prepareUpdateContact(input) {
      return prepared("contact_update", input, providerContactId);
    },
    prepareCreateLead(input) {
      return prepared("lead_create", input, providerLeadId);
    },
    prepareUpdateLead(input) {
      return prepared("lead_update", input, providerLeadId);
    },
    prepareLinkContactToLead(input) {
      return prepared("contact_lead_link", input, providerLeadId);
    },
    prepareUpdateLeadPipelineStatus(input) {
      return prepared("lead_pipeline_status_update", input, providerLeadId);
    },
    prepareUpdateLeadResponsibleUser(input) {
      return prepared("lead_responsible_update", input, providerLeadId);
    },
    prepareCreateLeadNote(input) {
      return prepared("lead_note_create", input, providerNoteId);
    },
    prepareCreateLeadTask(input) {
      return prepared("lead_task_create", input, providerTaskId);
    },
    prepareUpdateLeadTags(input) {
      return prepared("lead_tag_update", input, providerLeadId);
    },
    async getContactById(contactId) {
      reads.push(["contact", contactId]);
      return {
        id: contactId,
        name: "Amina Test",
        custom_fields_values: [
          {
            field_id: "7001",
            values: [{ value: "+996555000111" }],
          },
          {
            field_id: "7002",
            values: [{ value: "amina@example.com" }],
          },
        ],
      };
    },
    async getLeadById(leadId) {
      reads.push(["lead", leadId]);
      return {
        id: leadId,
        name: "Amina Test",
        pipeline_id: "2001",
        status_id: "2002",
        responsible_user_id: "3001",
        _embedded: {
          links: [
            {
              to_entity_type: "contacts",
              to_entity_id: providerContactId,
              metadata: { main_contact: true },
            },
          ],
          tags: [{ name: tagName }],
        },
      };
    },
    async getLeadNoteById(leadId, noteId) {
      reads.push(["note", leadId, noteId]);
      return {
        id: noteId,
        note_type: "common",
        params: { text: "Reviewed note" },
      };
    },
    async getTaskById(leadId, taskId) {
      reads.push(["task", leadId, taskId]);
      return {
        id: taskId,
        entity_type: "leads",
        entity_id: providerLeadId,
        text: "Call the applicant tomorrow",
        complete_till: 1790000000,
      };
    },
  };

  return {
    provider,
    routing: {
      canonicalAccountId: "acc-1",
      discoverySnapshotId: "snap-1",
      providerAccountId: "amo-1",
      accountBaseUrl: "https://evoadmissions.amocrm.ru",
      snapshotSha256: "a".repeat(64),
      discoveredAt: "2026-09-02T10:00:00.000Z",
      sales: {
        pipelineId: "2001",
        statusId: "2002",
        responsibleUserId: "3001",
        tagId: null,
        tagName,
      },
      admissions: {
        pipelineId: "2003",
        statusId: "2004",
        responsibleUserId: "3002",
        tagId: null,
        tagName: oppositeTagName,
      },
      contactCustomFields: {
        phoneFieldId: "7001",
        emailFieldId: "7002",
      },
    },
    dispatches,
    reads,
  };
}

function sampleAttempt(operationName, overrides = {}) {
  return {
    attemptId: `${operationName}-attempt`,
    commandReceiptId: `${operationName}-receipt`,
    organizationId: IDS.organization,
    idempotencyKey: `${IDS.request}:${operationName}`,
    operationName,
    actorRole: "sales",
    workflowScope: "sales_pre_handoff",
    workflowLeadId: IDS.lead,
    studentCaseId: null,
    personId: IDS.person,
    leadId: IDS.lead,
    targetContactId:
      operationName === "contact_update" || operationName === "contact_lead_link"
        ? "900001"
        : null,
    targetLeadId:
      operationName === "lead_create" || operationName === "lead_update"
        ? "900002"
        : [
            "contact_lead_link",
            "lead_pipeline_status_update",
            "lead_responsible_update",
            "lead_note_create",
            "lead_task_create",
            "lead_tag_update",
          ].includes(operationName)
          ? "900002"
          : null,
    status: "prepared",
    providerDispatchedAt: null,
    resultContactId: null,
    resultLeadId: null,
    failureCode: null,
    ...overrides,
  };
}

function serviceDeps(runState) {
  const staffClient = { kind: "staff" };
  const serviceClient = { kind: "service" };
  return {
    now: () => new Date("2026-09-02T10:00:00.000Z"),
    workerRef: () => "test-worker",
    visibilityTimeoutSeconds: 90,
    createStaffRpcClient: () => staffClient,
    createServiceRpcClient: () => serviceClient,
    getSalesLead: async () => salesLead(),
    resolveRuntime: async () => {
      runState.runtime ??= runtime();
      return runState.runtime;
    },
    staffClient,
    serviceClient,
  };
}

test("service keeps Drizzle discovery out of the new active path", () => {
  assert.doesNotMatch(
    serviceSource,
    /canonical-amocrm-discovery-repository|discoverCanonicalAmoCrmCommandRouting|\bdrizzle\b/i,
  );
});

test("sales sync runs the Supabase command sequence including task create and replays without redispatch", async () => {
  const runState = {};
  const store = new Map();
  const preparePayloads = [];
  const baseDeps = serviceDeps(runState);
  const clientCalls = [];
  const deps = {
    ...baseDeps,
    readBindings: async (client) => {
      clientCalls.push({ kind: client.kind, method: "readBindings" });
      return { contactId: null, leadId: null };
    },
    prepareCommand: async (client, input) => {
      clientCalls.push({ kind: client.kind, method: "prepareCommand" });
      preparePayloads.push({
        operationName: input.operationName,
        payload: input.payload,
      });
      const existing = store.get(input.idempotencyKey);
      if (existing) {
        return { kind: "replay", attempt: existing };
      }
      const attempt = sampleAttempt(input.operationName);
      store.set(input.idempotencyKey, attempt);
      store.set(attempt.attemptId, attempt);
      return { kind: "prepared", attempt };
    },
    claimCommand: async (client, input) => {
      clientCalls.push({ kind: client.kind, method: "claimCommand" });
      return {
      kind: "claimed",
      reason: null,
      attempt: store.get(input.attemptId),
    };
    },
    finishCommand: async (client, input) => {
      clientCalls.push({ kind: client.kind, method: "finishCommand" });
      const attempt = {
        ...store.get(input.attemptId),
        status: input.outcome,
        providerDispatchedAt: "2026-09-02T10:00:05.000Z",
        resultContactId: input.resultContactId,
        resultLeadId: input.resultLeadId,
        failureCode: input.failureCode,
      };
      store.set(input.attemptId, attempt);
      store.set(attempt.idempotencyKey, attempt);
      return { kind: "settled", attempt };
    },
  };

  const first = await executePlatformAmoCrmSalesSync(
    {
      actor: actor(),
      actorRole: "sales",
      leadId: IDS.lead,
      baseRequestId: IDS.request,
      noteText: "Reviewed note",
      taskText: "Call the applicant tomorrow",
      taskCompleteTill: 1790000000,
    },
    deps,
  );

  assert.equal(first.status, "accepted");
  assert.deepEqual(
    first.steps.map((step) => step.operationName),
    [
      "contact_create",
      "lead_create",
      "contact_lead_link",
      "lead_pipeline_status_update",
      "lead_responsible_update",
      "lead_note_create",
      "lead_task_create",
      "lead_tag_update",
    ],
  );
  assert.equal(runState.runtime.dispatches.length, 8);
  assert.notEqual(baseDeps.staffClient, baseDeps.serviceClient);
  assert.ok(
    clientCalls
      .filter(({ method }) => method === "readBindings" || method === "prepareCommand")
      .every(({ kind }) => kind === "staff"),
  );
  assert.ok(
    clientCalls
      .filter(({ method }) => method === "claimCommand" || method === "finishCommand")
      .every(({ kind }) => kind === "service"),
  );
  assert.equal(
    preparePayloads.find(({ operationName }) => operationName === "lead_task_create").payload
      .expected_readback.complete_till,
    1790000000,
  );

  const second = await executePlatformAmoCrmSalesSync(
    {
      actor: actor(),
      actorRole: "sales",
      leadId: IDS.lead,
      baseRequestId: IDS.request,
      noteText: "Reviewed note",
      taskText: "Call the applicant tomorrow",
      taskCompleteTill: 1790000000,
    },
    deps,
  );

  assert.equal(second.status, "accepted");
  assert.equal(runState.runtime.dispatches.length, 8);
  assert.ok(second.steps.every((step) => step.reason === "exact_replay"));
});

test("service sends staff reads and prepare through the staff client, but claim and finish through the service client with UUID request ids", async () => {
  const calls = [];
  const providerRuntime = runtime();
  const staffClient = {
    kind: "staff",
    schema(schemaName) {
      assert.equal(schemaName, "platform");
      return {
        async rpc(functionName, args) {
          calls.push({ client: "staff", functionName, args });
          if (functionName === "read_staff_amocrm_bindings") {
            return { data: { contact_id: null, lead_id: null }, error: null };
          }
          if (functionName === "prepare_amocrm_command") {
            return {
              data: {
                kind: "prepared",
                attempt: {
                  attempt_id: `10101010-1010-4010-8010-${String(calls.length).padStart(12, "0")}`,
                  command_receipt_id: `20202020-2020-4020-8020-${String(calls.length).padStart(12, "0")}`,
                  organization_id: IDS.organization,
                  idempotency_key: args.p_idempotency_key,
                  operation_name: args.p_operation_name,
                  actor_role: "sales",
                  workflow_scope: "sales_pre_handoff",
                  workflow_lead_id: IDS.lead,
                  student_case_id: null,
                  person_id: IDS.person,
                  lead_id: IDS.lead,
                  target_contact_id: args.p_target_contact_id,
                  target_lead_id: args.p_target_lead_id,
                  status: "prepared",
                  provider_dispatched_at: null,
                  result_contact_id: null,
                  result_lead_id: null,
                  failure_code: null,
                },
              },
              error: null,
            };
          }
          throw new Error(`unexpected staff rpc ${functionName}`);
        },
      };
    },
  };
  const serviceClient = {
    kind: "service",
    schema(schemaName) {
      assert.equal(schemaName, "platform");
      return {
        async rpc(functionName, args) {
          calls.push({ client: "service", functionName, args });
          if (functionName === "claim_amocrm_command") {
            return {
              data: {
                kind: "claimed",
                reason: null,
                attempt: {
                  attempt_id: args.p_attempt_id,
                  command_receipt_id: "30303030-3030-4030-8030-303030303030",
                  organization_id: IDS.organization,
                  idempotency_key: "replayed-key",
                  operation_name: "contact_create",
                  actor_role: "sales",
                  workflow_scope: "sales_pre_handoff",
                  workflow_lead_id: IDS.lead,
                  student_case_id: null,
                  person_id: IDS.person,
                  lead_id: IDS.lead,
                  target_contact_id: null,
                  target_lead_id: null,
                  status: "prepared",
                  provider_dispatched_at: null,
                  result_contact_id: null,
                  result_lead_id: null,
                  failure_code: null,
                },
              },
              error: null,
            };
          }
          if (functionName === "finish_amocrm_command") {
            return {
              data: {
                kind: "settled",
                attempt: {
                  attempt_id: args.p_attempt_id,
                  command_receipt_id: "30303030-3030-4030-8030-303030303030",
                  organization_id: IDS.organization,
                  idempotency_key: "replayed-key",
                  operation_name: "contact_create",
                  actor_role: "sales",
                  workflow_scope: "sales_pre_handoff",
                  workflow_lead_id: IDS.lead,
                  student_case_id: null,
                  person_id: IDS.person,
                  lead_id: IDS.lead,
                  target_contact_id: null,
                  target_lead_id: null,
                  status: "accepted",
                  provider_dispatched_at: "2026-09-02T10:00:05.000Z",
                  result_contact_id: "900001",
                  result_lead_id: null,
                  failure_code: null,
                },
              },
              error: null,
            };
          }
          throw new Error(`unexpected service rpc ${functionName}`);
        },
      };
    },
  };

  const result = await executePlatformAmoCrmSalesSync(
    {
      actor: actor(),
      actorRole: "sales",
      leadId: IDS.lead,
      baseRequestId: IDS.request,
      noteText: "Reviewed note",
      taskText: "Call the applicant tomorrow",
      taskCompleteTill: 1790000000,
    },
    {
      now: () => new Date("2026-09-02T10:00:00.000Z"),
      createStaffRpcClient: () => staffClient,
      createServiceRpcClient: () => serviceClient,
      getSalesLead: async () => salesLead(),
      resolveRuntime: async () => providerRuntime,
      readBindings: readPlatformAmoCrmBindings,
      prepareCommand: preparePlatformAmoCrmCommand,
      claimCommand: claimPlatformAmoCrmCommand,
      finishCommand: finishPlatformAmoCrmCommand,
    },
  );

  assert.equal(result.status, "accepted");
  assert.equal(calls[0].client, "staff");
  assert.equal(calls[0].functionName, "read_staff_amocrm_bindings");
  assert.equal(calls[1].client, "staff");
  assert.equal(calls[1].functionName, "prepare_amocrm_command");
  assert.equal(calls[2].client, "service");
  assert.equal(calls[2].functionName, "claim_amocrm_command");
  assert.equal(calls[2].args.p_request_id, IDS.request);
  assert.equal(calls[3].client, "service");
  assert.equal(calls[3].functionName, "finish_amocrm_command");
  assert.equal(calls[3].args.p_request_id, IDS.request);
});

test("sales sync rejects a non-future task deadline before any runtime call", async () => {
  let readCalled = false;
  const result = await executePlatformAmoCrmSalesSync(
    {
      actor: actor(),
      actorRole: "sales",
      leadId: IDS.lead,
      baseRequestId: IDS.request,
      noteText: "Reviewed note",
      taskText: "Call the applicant tomorrow",
      taskCompleteTill: 1,
    },
    {
      now: () => new Date("2026-09-02T10:00:00.000Z"),
      createStaffRpcClient: () => ({ kind: "staff" }),
      getSalesLead: async () => {
        readCalled = true;
        return salesLead();
      },
    },
  );

  assert.equal(result.status, "error");
  assert.equal(result.reason, "invalid_task_complete_till");
  assert.equal(readCalled, true);
});

test("transport ambiguity settles the step as unknown and stops further provider mutation", async () => {
  const runState = {};
  const store = new Map();
  const finishCalls = [];
  const deps = {
    ...serviceDeps(runState),
    readBindings: async () => ({ contactId: null, leadId: null }),
    prepareCommand: async (_client, input) => {
      const attempt = sampleAttempt(input.operationName);
      store.set(input.idempotencyKey, attempt);
      store.set(attempt.attemptId, attempt);
      return { kind: "prepared", attempt };
    },
    claimCommand: async (_client, input) => ({
      kind: "claimed",
      reason: null,
      attempt: store.get(input.attemptId),
    }),
    finishCommand: async (_client, input) => {
      finishCalls.push(input);
      return {
        kind: "settled",
        attempt: {
          ...store.get(input.attemptId),
          status: input.outcome,
          providerDispatchedAt: "2026-09-02T10:00:05.000Z",
          failureCode: input.failureCode,
          resultContactId: input.resultContactId,
          resultLeadId: input.resultLeadId,
        },
      };
    },
    resolveRuntime: async () => {
      const value = runtime();
      const original = value.provider.prepareCreateLeadNote;
      value.provider.prepareCreateLeadNote = (input) => {
        const prepared = original(input);
        return {
          ...prepared,
          async dispatch() {
            throw new CanonicalAmoCrmMutationError("provider_unavailable", {
              outcome: "unknown",
              request: prepared.request,
            });
          },
        };
      };
      runState.runtime = value;
      return value;
    },
  };

  const result = await executePlatformAmoCrmSalesSync(
    {
      actor: actor(),
      actorRole: "sales",
      leadId: IDS.lead,
      baseRequestId: IDS.request,
      noteText: "Reviewed note",
      taskText: "Call the applicant tomorrow",
      taskCompleteTill: 1790000000,
    },
    deps,
  );

  assert.equal(result.status, "unknown");
  assert.equal(result.reason, "provider_unavailable");
  assert.equal(
    result.steps.at(-1).operationName,
    "lead_note_create",
  );
  assert.equal(runState.runtime.dispatches.includes("lead_task_create"), false);
  assert.equal(finishCalls.at(-1).providerRequestId, null);
  assert.equal(finishCalls.at(-1).providerHttpStatus, null);
  assert.equal(finishCalls.at(-1).providerRespondedAt, null);
});

test("HTTP rejection preserves provider response metadata and rejects the step", async () => {
  const store = new Map();
  const finishCalls = [];
  const deps = {
    ...serviceDeps({}),
    readBindings: async () => ({ contactId: null, leadId: null }),
    prepareCommand: async (_client, input) => {
      const attempt = sampleAttempt(input.operationName);
      store.set(input.idempotencyKey, attempt);
      store.set(attempt.attemptId, attempt);
      return { kind: "prepared", attempt };
    },
    claimCommand: async (_client, input) => ({
      kind: "claimed",
      reason: null,
      attempt: store.get(input.attemptId),
    }),
    finishCommand: async (_client, input) => {
      finishCalls.push(input);
      return {
        kind: "settled",
        attempt: {
          ...store.get(input.attemptId),
          status: input.outcome,
          providerDispatchedAt: "2026-09-02T10:00:05.000Z",
          failureCode: input.failureCode,
        },
      };
    },
    resolveRuntime: async () => {
      const value = runtime();
      const original = value.provider.prepareCreateLeadNote;
      value.provider.prepareCreateLeadNote = (input) => {
        const prepared = original(input);
        return {
          ...prepared,
          async dispatch() {
            throw new CanonicalAmoCrmMutationError("provider_rejected", {
              outcome: "rejected",
              request: prepared.request,
              response: {
                status: 422,
                providerRequestId: "req-rejected",
              },
            });
          },
        };
      };
      return value;
    },
  };

  const result = await executePlatformAmoCrmSalesSync(
    {
      actor: actor(),
      actorRole: "sales",
      leadId: IDS.lead,
      baseRequestId: IDS.request,
      noteText: "Reviewed note",
      taskText: "Call the applicant tomorrow",
      taskCompleteTill: 1790000000,
    },
    deps,
  );

  assert.equal(result.status, "rejected");
  assert.equal(finishCalls.at(-1).providerRequestId, "req-rejected");
  assert.equal(finishCalls.at(-1).providerHttpStatus, 422);
  assert.match(finishCalls.at(-1).providerRespondedAt, /^2026-09-02T10:00:00/);
});

test("readback mismatch after a 2xx mutation settles unknown with preserved response metadata", async () => {
  const store = new Map();
  const finishCalls = [];
  const deps = {
    ...serviceDeps({}),
    readBindings: async () => ({ contactId: null, leadId: null }),
    prepareCommand: async (_client, input) => {
      const attempt = sampleAttempt(input.operationName);
      store.set(input.idempotencyKey, attempt);
      store.set(attempt.attemptId, attempt);
      return { kind: "prepared", attempt };
    },
    claimCommand: async (_client, input) => ({
      kind: "claimed",
      reason: null,
      attempt: store.get(input.attemptId),
    }),
    finishCommand: async (_client, input) => {
      finishCalls.push(input);
      return {
        kind: "settled",
        attempt: {
          ...store.get(input.attemptId),
          status: input.outcome,
          providerDispatchedAt: "2026-09-02T10:00:05.000Z",
          failureCode: input.failureCode,
        },
      };
    },
    resolveRuntime: async () => {
      const value = runtime();
      value.provider.getLeadNoteById = async (leadId, noteId) => ({
        id: noteId,
        note_type: "common",
        params: { text: `wrong:${leadId}` },
      });
      return value;
    },
  };

  const result = await executePlatformAmoCrmSalesSync(
    {
      actor: actor(),
      actorRole: "sales",
      leadId: IDS.lead,
      baseRequestId: IDS.request,
      noteText: "Reviewed note",
      taskText: "Call the applicant tomorrow",
      taskCompleteTill: 1790000000,
    },
    deps,
  );

  assert.equal(result.status, "unknown");
  assert.equal(finishCalls.at(-1).providerHttpStatus, 200);
  assert.equal(
    finishCalls.at(-1).providerRequestId,
    "req-lead_note_create",
  );
  assert.match(finishCalls.at(-1).providerRespondedAt, /^2026-09-02T10:00:00/);
  assert.equal(finishCalls.at(-1).failureCode, "provider_readback_mismatch");
});

test("reconcile accepts an unknown lead pipeline update only after exact provider readback", async () => {
  const reconciles = [];
  const service = await reconcilePlatformAmoCrmSyncAttempt(
    {
      actor: actor({ authorityRole: "sales", platformRole: "sales", presentationRole: "sales" }),
      actorRole: "sales",
      workflowScope: "sales_pre_handoff",
      leadId: IDS.lead,
      studentCaseId: null,
      attemptId: "56565656-5656-4565-8565-565656565656",
    },
    {
      now: () => new Date("2026-09-02T10:00:00.000Z"),
      workerRef: () => "test-worker",
      createStaffRpcClient: () => ({ kind: "staff" }),
      createServiceRpcClient: () => ({ kind: "service" }),
      getSalesLead: async () => salesLead(),
      resolveRuntime: async () => runtime(),
      readBindings: async () => ({ contactId: "900001", leadId: "900002" }),
      readAttemptForReconcile: async () =>
        ({
          attempt: sampleAttempt("lead_pipeline_status_update", {
            attemptId: "56565656-5656-4565-8565-565656565656",
            status: "unknown",
            targetLeadId: "900002",
            providerDispatchedAt: "2026-09-02T10:00:05.000Z",
            failureCode: "provider_timeout",
          }),
          payload: {
            expected_readback: {
              pipeline_id: "2001",
              status_id: "2002",
            },
          },
        }),
      reconcileUnknown: async (_client, input) => {
        reconciles.push(input);
        return {
          kind: "reconciled",
          attempt: sampleAttempt("lead_pipeline_status_update", {
            attemptId: input.attemptId,
            status: "accepted",
            targetLeadId: "900002",
            resultLeadId: "900002",
          }),
        };
      },
    },
  );

  assert.equal(service.status, "accepted");
  assert.equal(reconciles.length, 1);
  assert.equal(reconciles[0].outcome, "accepted");
  assert.equal(reconciles[0].providerReadback.pipeline_id, "2001");
  assert.equal(reconciles[0].providerReadback.status_id, "2002");
});
