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
  executePlatformAmoCrmAdmissionsSync,
  executePlatformAmoCrmSalesSync,
  reconcilePlatformAmoCrmSyncAttempt,
  releasePlatformAmoCrmPreparedAttempt,
} = await import("../src/lib/server/platform-amocrm-command-service.ts");
const {
  CanonicalAmoCrmMutationError,
  CanonicalAmoCrmProviderError,
} = await import("../src/lib/server/canonical-amocrm-provider.ts");
const {
  claimPlatformAmoCrmCommand,
  finishPlatformAmoCrmCommand,
  preparePlatformAmoCrmCommand,
  readPlatformAmoCrmCommandByIdempotencyKey,
  readPlatformAmoCrmBindings,
} = await import("../src/lib/server/platform-amocrm-command-rpc.ts");
const serviceSource = readFileSync(
  new URL("../src/lib/server/platform-amocrm-command-service.ts", import.meta.url),
  "utf8",
);
const runtimeSource = readFileSync(
  new URL("../src/lib/server/platform-amocrm-runtime.ts", import.meta.url),
  "utf8",
);
const discoverySource = readFileSync(
  new URL("../src/lib/server/canonical-amocrm-discovery-service.ts", import.meta.url),
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
    async getLeadContactLinks(leadId, contactId) {
      reads.push(["lead-contact-links", leadId, contactId]);
      return {
        _embedded: {
          links: [
            {
              to_entity_type: "contacts",
              to_entity_id: providerContactId,
              metadata: { main_contact: true },
            },
          ],
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
  const contactScoped =
    operationName === "contact_create" ||
    operationName === "contact_update" ||
    operationName === "contact_lead_link";
  const leadScoped = operationName !== "contact_create" && operationName !== "contact_update";
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
    personId: contactScoped ? IDS.person : null,
    leadId: leadScoped ? IDS.lead : null,
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
    readbackRetryDelaysMs: [],
    createStaffRpcClient: () => staffClient,
    createServiceRpcClient: () => serviceClient,
    getSalesLead: async () => salesLead(),
    readCommandByIdempotencyKey: async () => null,
    resolveRuntime: async () => {
      runState.runtime ??= runtime();
      return runState.runtime;
    },
    staffClient,
    serviceClient,
  };
}

function inMemorySequenceDeps(providerRuntime, overrides = {}) {
  const runState = { runtime: providerRuntime };
  const store = new Map();
  const finishCalls = [];
  const sleepCalls = [];
  const deps = {
    ...serviceDeps(runState),
    readbackRetryDelaysMs: [1, 2, 3],
    sleep: async (milliseconds) => {
      sleepCalls.push(milliseconds);
    },
    readBindings: async () => ({ contactId: null, leadId: null }),
    readCommandByIdempotencyKey: async (_client, input) =>
      store.get(input.idempotencyKey) ?? null,
    prepareCommand: async (_client, input) => {
      const existing = store.get(input.idempotencyKey);
      if (existing) return { kind: "replay", attempt: existing };
      const attempt = sampleAttempt(input.operationName, {
        idempotencyKey: input.idempotencyKey,
        personId: input.personId,
        leadId: input.leadId,
        targetContactId: input.targetContactId,
        targetLeadId: input.targetLeadId,
      });
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
    ...overrides,
  };
  return { deps, finishCalls, sleepCalls, store };
}

test("service keeps Drizzle discovery out of the new active path", () => {
  assert.doesNotMatch(
    `${serviceSource}\n${runtimeSource}\n${discoverySource}`,
    /canonical-amocrm-discovery-repository|\bdrizzle\b/i,
  );
  assert.match(serviceSource, /resolvePlatformAmoCrmRuntime/u);
  assert.match(runtimeSource, /createPlatformAmoCrmDiscoveryRepository/u);
});

test("resolves provider discovery only after canonical workflow context supplies the organization", async () => {
  const events = [];
  const providerRuntime = runtime();
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
      ...serviceDeps({}),
      getSalesLead: async () => {
        events.push("workflow-context");
        return salesLead();
      },
      resolveRuntime: async (input) => {
        events.push("provider-runtime");
        assert.equal(input.organizationId, IDS.organization);
        assert.equal(input.correlationId, IDS.request);
        return providerRuntime;
      },
      readBindings: async () => {
        events.push("staff-binding-check");
        throw new Error("stop_after_runtime_order_proof");
      },
    },
  );

  assert.deepEqual(events, [
    "workflow-context",
    "provider-runtime",
    "staff-binding-check",
  ]);
  assert.equal(result.status, "error");
  assert.equal(result.reason, "stop_after_runtime_order_proof");
});

test("sales sync runs the Supabase command sequence including task create and replays without redispatch", async () => {
  const runState = {};
  const store = new Map();
  const preparePayloads = [];
  const baseDeps = serviceDeps(runState);
  const clientCalls = [];
  let bindingsReadCount = 0;
  const deps = {
    ...baseDeps,
    readBindings: async (client) => {
      clientCalls.push({ kind: client.kind, method: "readBindings" });
      bindingsReadCount += 1;
      return bindingsReadCount === 1
        ? { contactId: null, leadId: null }
        : { contactId: "900001", leadId: "900002" };
    },
    readCommandByIdempotencyKey: async (client, input) => {
      clientCalls.push({ kind: client.kind, method: "readCommandByIdempotencyKey" });
      return store.get(input.idempotencyKey) ?? null;
    },
    prepareCommand: async (client, input) => {
      clientCalls.push({ kind: client.kind, method: "prepareCommand" });
      preparePayloads.push({
        operationName: input.operationName,
        personId: input.personId,
        leadId: input.leadId,
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
  assert.deepEqual(
    runState.runtime.reads.filter(([kind]) => kind === "lead-contact-links"),
    [["lead-contact-links", "900002", "900001"]],
  );
  assert.deepEqual(
    preparePayloads.map(({ operationName, personId, leadId }) => ({
      operationName,
      personId,
      leadId,
    })),
    [
      { operationName: "contact_create", personId: IDS.person, leadId: null },
      { operationName: "lead_create", personId: null, leadId: IDS.lead },
      {
        operationName: "contact_lead_link",
        personId: IDS.person,
        leadId: IDS.lead,
      },
      {
        operationName: "lead_pipeline_status_update",
        personId: null,
        leadId: IDS.lead,
      },
      {
        operationName: "lead_responsible_update",
        personId: null,
        leadId: IDS.lead,
      },
      { operationName: "lead_note_create", personId: null, leadId: IDS.lead },
      { operationName: "lead_task_create", personId: null, leadId: IDS.lead },
      { operationName: "lead_tag_update", personId: null, leadId: IDS.lead },
    ],
  );
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
  assert.ok(
    preparePayloads.every(
      ({ payload }) =>
        payload.mapping_evidence.discovery_version_id === "snap-1" &&
        payload.mapping_evidence.provider_account_id === "amo-1" &&
        payload.mapping_evidence.snapshot_sha256 === "a".repeat(64),
    ),
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
  assert.ok(
    clientCalls
      .filter(({ method }) => method === "readCommandByIdempotencyKey")
      .every(({ kind }) => kind === "service"),
  );
});

test("exact replay fails closed when both create and update variants exist", async () => {
  const providerRuntime = runtime();
  const deps = {
    ...serviceDeps({ runtime: providerRuntime }),
    readBindings: async () => ({ contactId: "900001", leadId: "900002" }),
    readCommandByIdempotencyKey: async (_client, input) => {
      if (input.idempotencyKey.endsWith(":contact_create")) {
        return sampleAttempt("contact_create");
      }
      if (input.idempotencyKey.endsWith(":contact_update")) {
        return sampleAttempt("contact_update");
      }
      return null;
    },
    prepareCommand: async () => {
      assert.fail("conflicting variants must stop before command preparation");
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

  assert.equal(result.status, "error");
  assert.equal(result.reason, "amocrm_idempotency_variant_conflict");
  assert.deepEqual(result.steps, []);
  assert.deepEqual(providerRuntime.dispatches, []);
});

test("task readback retries safe GETs and continues through all eight accepted operations", async () => {
  const providerRuntime = runtime();
  const successfulTaskRead = providerRuntime.provider.getTaskById;
  let taskReadCount = 0;
  providerRuntime.provider.getTaskById = async (...args) => {
    taskReadCount += 1;
    if (taskReadCount === 1) {
      return { ...(await successfulTaskRead(...args)), text: "not visible yet" };
    }
    if (taskReadCount === 2) {
      throw new CanonicalAmoCrmProviderError("provider_unavailable", { status: 503 });
    }
    return successfulTaskRead(...args);
  };
  const { deps, sleepCalls } = inMemorySequenceDeps(providerRuntime);

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

  assert.equal(result.status, "accepted");
  assert.equal(result.steps.length, 8);
  assert.ok(result.steps.every((step) => step.status === "accepted"));
  assert.equal(
    providerRuntime.dispatches.filter((operation) => operation === "lead_task_create").length,
    1,
  );
  assert.equal(providerRuntime.dispatches.at(-1), "lead_tag_update");
  assert.equal(taskReadCount, 3);
  assert.deepEqual(sleepCalls, [1, 2]);
});

test("exhausted task readback stays unknown without repeating the mutation or attempting tag", async () => {
  const providerRuntime = runtime();
  let taskReadCount = 0;
  providerRuntime.provider.getTaskById = async () => {
    taskReadCount += 1;
    throw new CanonicalAmoCrmProviderError("request_timeout");
  };
  const { deps, finishCalls, sleepCalls } = inMemorySequenceDeps(providerRuntime);

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
  assert.equal(result.reason, "request_timeout");
  assert.equal(
    providerRuntime.dispatches.filter((operation) => operation === "lead_task_create").length,
    1,
  );
  assert.equal(providerRuntime.dispatches.includes("lead_tag_update"), false);
  assert.equal(taskReadCount, 4);
  assert.deepEqual(sleepCalls, [1, 2, 3]);
  assert.equal(finishCalls.at(-1).outcome, "unknown");
  assert.equal(finishCalls.at(-1).failureCode, "request_timeout");
});

test("permanent task readback rejection fails immediately without GET retry", async () => {
  const providerRuntime = runtime();
  let taskReadCount = 0;
  providerRuntime.provider.getTaskById = async () => {
    taskReadCount += 1;
    throw new CanonicalAmoCrmProviderError("provider_rejected", { status: 400 });
  };
  const { deps, sleepCalls } = inMemorySequenceDeps(providerRuntime);

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
  assert.equal(result.reason, "provider_rejected");
  assert.equal(taskReadCount, 1);
  assert.deepEqual(sleepCalls, []);
  assert.equal(
    providerRuntime.dispatches.filter((operation) => operation === "lead_task_create").length,
    1,
  );
  assert.equal(providerRuntime.dispatches.includes("lead_tag_update"), false);
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
          if (functionName === "read_amocrm_command_by_idempotency_key") {
            return { data: null, error: null };
          }
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
      readCommandByIdempotencyKey: readPlatformAmoCrmCommandByIdempotencyKey,
      prepareCommand: preparePlatformAmoCrmCommand,
      claimCommand: claimPlatformAmoCrmCommand,
      finishCommand: finishPlatformAmoCrmCommand,
    },
  );

  assert.equal(result.status, "accepted");
  assert.equal(calls[0].client, "staff");
  assert.equal(calls[0].functionName, "read_staff_amocrm_bindings");
  assert.ok(
    calls
      .slice(1, 5)
      .every(
        ({ client, functionName }) =>
          client === "service" &&
          functionName === "read_amocrm_command_by_idempotency_key",
      ),
  );
  assert.equal(calls[5].client, "staff");
  assert.equal(calls[5].functionName, "prepare_amocrm_command");
  assert.equal(calls[6].client, "service");
  assert.equal(calls[6].functionName, "claim_amocrm_command");
  assert.equal(calls[6].args.p_request_id, IDS.request);
  assert.equal(calls[7].client, "service");
  assert.equal(calls[7].functionName, "finish_amocrm_command");
  assert.equal(calls[7].args.p_request_id, IDS.request);
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

test("sales sync rejects a task deadline above the provider-safe range before runtime", async () => {
  let runtimeCalled = false;
  const result = await executePlatformAmoCrmSalesSync(
    {
      actor: actor(),
      actorRole: "sales",
      leadId: IDS.lead,
      baseRequestId: IDS.request,
      noteText: "Reviewed note",
      taskText: "Call the applicant tomorrow",
      taskCompleteTill: 2_147_483_648,
    },
    {
      now: () => new Date("2026-09-02T10:00:00.000Z"),
      createStaffRpcClient: () => ({ kind: "staff" }),
      getSalesLead: async () => salesLead(),
      resolveRuntime: async () => {
        runtimeCalled = true;
        throw new Error("runtime_must_not_be_called");
      },
    },
  );

  assert.equal(result.status, "error");
  assert.equal(result.reason, "invalid_task_complete_till");
  assert.equal(runtimeCalled, false);
});

test("admissions sync fails closed instead of creating missing provider identities", async () => {
  for (const scenario of [
    {
      bindings: { contactId: null, leadId: "900002" },
      reason: "provider_contact_mapping_missing",
    },
    {
      bindings: { contactId: "900001", leadId: null },
      reason: "provider_lead_mapping_missing",
    },
    {
      bindings: { contactId: null, leadId: null },
      reason: "provider_contact_mapping_missing",
    },
  ]) {
    const runState = {};
    let prepareCalls = 0;
    let claimCalls = 0;
    const result = await executePlatformAmoCrmAdmissionsSync(
      {
        actor: actor(),
        actorRole: "admissions",
        studentCaseId: IDS.studentCase,
        baseRequestId: IDS.request,
        noteText: "Admissions reviewed note",
        taskText: "Check the application tomorrow",
        taskCompleteTill: 1790000000,
      },
      {
        ...serviceDeps(runState),
        getStudentCaseHandoffContext: async () => ({
          organizationId: IDS.organization,
          leadId: IDS.lead,
          studentCaseId: IDS.studentCase,
          clientContext: {
            clientId: IDS.person,
            displayName: "Amina Test",
          },
        }),
        readBindings: async () => scenario.bindings,
        prepareCommand: async () => {
          prepareCalls += 1;
          throw new Error("prepare_must_not_run");
        },
        claimCommand: async () => {
          claimCalls += 1;
          throw new Error("claim_must_not_run");
        },
      },
    );

    assert.equal(result.status, "blocked");
    assert.equal(result.reason, scenario.reason);
    assert.deepEqual(result.steps, []);
    assert.equal(prepareCalls, 0);
    assert.equal(claimCalls, 0);
    assert.deepEqual(runState.runtime.dispatches, []);
  }
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

test("pre-http rejected mutation keeps provider metadata null and uses a safe failure code", async () => {
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
            throw new CanonicalAmoCrmMutationError("token_unavailable", {
              outcome: "rejected",
              request: prepared.request,
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
  assert.equal(finishCalls.at(-1).providerRequestId, null);
  assert.equal(finishCalls.at(-1).providerHttpStatus, null);
  assert.equal(finishCalls.at(-1).providerRespondedAt, null);
  assert.equal(finishCalls.at(-1).failureCode, "token_unavailable");
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

test("reconcile reads back only the targeted contact link before accepting an unknown link command", async () => {
  const reconciles = [];
  const providerRuntime = runtime();
  const attemptId = "67676767-6767-4676-8676-676767676767";
  const service = await reconcilePlatformAmoCrmSyncAttempt(
    {
      actor: actor({ authorityRole: "sales", platformRole: "sales", presentationRole: "sales" }),
      actorRole: "sales",
      workflowScope: "sales_pre_handoff",
      leadId: IDS.lead,
      studentCaseId: null,
      attemptId,
    },
    {
      now: () => new Date("2026-09-02T10:00:00.000Z"),
      workerRef: () => "test-worker",
      createStaffRpcClient: () => ({ kind: "staff" }),
      createServiceRpcClient: () => ({ kind: "service" }),
      getSalesLead: async () => salesLead(),
      resolveRuntime: async () => providerRuntime,
      readBindings: async () => ({ contactId: "900001", leadId: "900002" }),
      readAttemptForReconcile: async () => ({
        attempt: sampleAttempt("contact_lead_link", {
          attemptId,
          status: "unknown",
          targetContactId: "900001",
          targetLeadId: "900002",
          providerDispatchedAt: "2026-09-02T10:00:05.000Z",
          failureCode: "provider_timeout",
        }),
        payload: {
          expected_readback: {
            lead_id: "900002",
            contact_id: "900001",
            main_contact: true,
          },
        },
      }),
      reconcileUnknown: async (_client, input) => {
        reconciles.push(input);
        return {
          kind: "reconciled",
          attempt: sampleAttempt("contact_lead_link", {
            attemptId: input.attemptId,
            status: "accepted",
            targetContactId: "900001",
            targetLeadId: "900002",
            resultContactId: "900001",
            resultLeadId: "900002",
          }),
        };
      },
    },
  );

  assert.equal(service.status, "accepted");
  assert.deepEqual(providerRuntime.reads, [
    ["lead-contact-links", "900002", "900001"],
  ]);
  assert.equal(reconciles.length, 1);
  assert.equal(reconciles[0].outcome, "accepted");
  assert.deepEqual(reconciles[0].providerReadback, {
    entity: "lead_contact_link",
    lead_id: "900002",
    contact_id: "900001",
    main_contact: true,
  });
});

test("reconcile fails closed before provider access when the stored attempt is outside the authorized workflow context", async () => {
  const attemptId = "78787878-7878-4787-8787-787878787878";
  const mismatches = [
    { workflowLeadId: "89898989-8989-4898-8989-898989898989" },
    { studentCaseId: "90909090-9090-4909-8909-909090909090" },
    { personId: "91919191-9191-4919-8919-919191919191" },
  ];

  for (const mismatch of mismatches) {
    let runtimeCalls = 0;
    let bindingCalls = 0;
    let reconcileCalls = 0;
    const result = await reconcilePlatformAmoCrmSyncAttempt(
      {
        actor: actor({ authorityRole: "sales", platformRole: "sales", presentationRole: "sales" }),
        actorRole: "sales",
        workflowScope: "sales_pre_handoff",
        leadId: IDS.lead,
        studentCaseId: null,
        attemptId,
      },
      {
        createStaffRpcClient: () => ({ kind: "staff" }),
        createServiceRpcClient: () => ({ kind: "service" }),
        getSalesLead: async () => salesLead(),
        resolveRuntime: async () => {
          runtimeCalls += 1;
          return runtime();
        },
        readBindings: async () => {
          bindingCalls += 1;
          return { contactId: "900001", leadId: "900002" };
        },
        readAttemptForReconcile: async () => ({
          attempt: sampleAttempt("lead_pipeline_status_update", {
            attemptId,
            status: "unknown",
            targetLeadId: "900002",
            providerDispatchedAt: "2026-09-02T10:00:05.000Z",
            failureCode: "provider_timeout",
            ...mismatch,
          }),
          payload: {
            expected_readback: { pipeline_id: "2001", status_id: "2002" },
          },
        }),
        reconcileUnknown: async () => {
          reconcileCalls += 1;
          throw new Error("must_not_reconcile");
        },
      },
    );

    assert.equal(result.status, "error");
    assert.equal(result.reason, "amocrm_reconciliation_context_mismatch");
    assert.equal(runtimeCalls, 0);
    assert.equal(bindingCalls, 0);
    assert.equal(reconcileCalls, 0);
  }
});

test("reconcile replays the stored terminal result without new timestamps or provider reads", async () => {
  const attemptId = "92929292-9292-4929-8929-929292929292";
  const providerRuntime = runtime();
  const reconcileInputs = [];
  let runtimeCalls = 0;
  let nowCalls = 0;
  let storedAttempt = sampleAttempt("lead_pipeline_status_update", {
    attemptId,
    status: "unknown",
    targetLeadId: "900002",
    providerDispatchedAt: "2026-09-02T10:00:05.000Z",
    failureCode: "provider_timeout",
  });
  const dependencies = {
    now: () => {
      const value = new Date(Date.parse("2026-09-02T10:01:00.000Z") + nowCalls * 1_000);
      nowCalls += 1;
      return value;
    },
    createStaffRpcClient: () => ({ kind: "staff" }),
    createServiceRpcClient: () => ({ kind: "service" }),
    getSalesLead: async () => salesLead(),
    resolveRuntime: async () => {
      runtimeCalls += 1;
      return providerRuntime;
    },
    readBindings: async () => ({ contactId: "900001", leadId: "900002" }),
    readAttemptForReconcile: async () => ({
      attempt: storedAttempt,
      payload: {
        expected_readback: { pipeline_id: "2001", status_id: "2002" },
      },
    }),
    reconcileUnknown: async (_client, input) => {
      reconcileInputs.push(input);
      storedAttempt = sampleAttempt("lead_pipeline_status_update", {
        attemptId,
        status: "accepted",
        targetLeadId: "900002",
        providerDispatchedAt: "2026-09-02T10:00:05.000Z",
        resultLeadId: "900002",
        failureCode: null,
      });
      return { kind: "reconciled", attempt: storedAttempt };
    },
  };
  const input = {
    actor: actor({ authorityRole: "sales", platformRole: "sales", presentationRole: "sales" }),
    actorRole: "sales",
    workflowScope: "sales_pre_handoff",
    leadId: IDS.lead,
    studentCaseId: null,
    attemptId,
  };

  const first = await reconcilePlatformAmoCrmSyncAttempt(input, dependencies);
  const replay = await reconcilePlatformAmoCrmSyncAttempt(input, dependencies);

  assert.equal(first.status, "accepted");
  assert.equal(first.reason, "accepted");
  assert.equal(replay.status, "accepted");
  assert.equal(replay.reason, "exact_replay");
  assert.equal(reconcileInputs.length, 1);
  assert.equal(
    reconcileInputs[0].providerReadbackAt,
    reconcileInputs[0].providerRespondedAt,
  );
  assert.equal(runtimeCalls, 1);
  assert.deepEqual(providerRuntime.reads, [["lead", "900002"]]);
});

test("operator release terminalizes only the exact authorized prepared attempt without provider access", async () => {
  const attemptId = "93939393-9393-4939-8939-939393939393";
  const releaseCalls = [];
  const result = await releasePlatformAmoCrmPreparedAttempt(
    {
      actor: actor({ authorityRole: "sales", platformRole: "sales", presentationRole: "sales" }),
      actorRole: "sales",
      workflowScope: "sales_pre_handoff",
      leadId: IDS.lead,
      studentCaseId: null,
      attemptId,
    },
    {
      createStaffRpcClient: () => ({ kind: "staff" }),
      getSalesLead: async () => salesLead(),
      resolveRuntime: async () => {
        throw new Error("provider_must_not_be_resolved");
      },
      releasePrepared: async (_client, input) => {
        releaseCalls.push(input);
        return {
          kind: "released",
          attempt: sampleAttempt("lead_update", {
            attemptId,
            status: "rejected",
            targetLeadId: "900002",
            failureCode: "operator_released_before_dispatch",
          }),
        };
      },
    },
  );

  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "operator_released_before_dispatch");
  assert.equal(result.attemptId, attemptId);
  assert.deepEqual(releaseCalls, [
    {
      organizationId: IDS.organization,
      authorization: {
        actorRole: "sales",
        workflowScope: "sales_pre_handoff",
        workflowLeadId: IDS.lead,
        studentCaseId: null,
      },
      personId: IDS.person,
      leadId: IDS.lead,
      attemptId,
      requestId: attemptId,
    },
  ]);
});
