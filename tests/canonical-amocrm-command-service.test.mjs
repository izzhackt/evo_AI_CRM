import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  executeCanonicalAmoCrmAdmissionsSync,
  executeCanonicalAmoCrmSalesSync,
  reconcileCanonicalAmoCrmSyncAttempt,
} from "../src/lib/server/canonical-amocrm-command-service.ts";
import {
  CanonicalAmoCrmMutationError,
} from "../src/lib/server/canonical-amocrm-provider.ts";

const SALES_LEAD_ID = "11111111-1111-4111-8111-111111111111";
const PERSON_ID = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const BASE_REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const STUDENT_CASE_ID = "77777777-7777-4777-8777-777777777777";

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function valueSha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function serviceHarness(options = {}) {
  const providerCalls = [];
  let discoveryCalls = 0;
  const attempts = new Map();
  let contactBinding = options.contactBinding ?? null;
  let leadBinding = options.leadBinding ?? null;
  let nextAttempt = 0;
  const contact = {
    id: 101,
    name: "Ada Lovelace",
    custom_fields_values: [],
  };
  const lead = {
    id: 202,
    name: "Ada Lovelace",
    pipeline_id: 11,
    status_id: 12,
    responsible_user_id: 13,
    _embedded: { tags: [] },
  };
  const links = [];
  const notes = new Map();
  const tagNames = new Map([
    ["31", "EVO V2 Sales"],
    ["32", "EVO V2 Admissions"],
  ]);
  let remainingLinkReadFailures = options.failLinkReads ?? 0;
  const settlementFailures = new Set(options.failSettlementOnceFor ?? []);

  const prepared = (operationName, input, apply) => {
    const request = {
      method: operationName.includes("create") || operationName === "contact_lead_link"
        ? "POST"
        : "PATCH",
      path: `/fake/${operationName}`,
      requestId: input.requestId,
    };
    const body = { operationName, input };
    return Object.freeze({
      request,
      body,
      bodyJson: JSON.stringify(body),
      bodySha256: sha256(body),
      requestSha256: sha256({ request, body }),
      dispatch: async () => {
        providerCalls.push(`dispatch:${operationName}`);
        if (options.rejectedOperation === operationName) {
          throw new CanonicalAmoCrmMutationError("provider_rejected", {
            outcome: "rejected",
            request,
            response: { status: 403, providerRequestId: "provider-denied" },
          });
        }
        if (options.unknownOperation === operationName) {
          throw new Error("provider connection ended after dispatch");
        }
        const entityId = apply();
        if (options.unknownAfterApplyOperation === operationName) {
          throw new Error("provider applied the effect but the response was lost");
        }
        return {
          entityId,
          request,
          response: { status: 200, providerRequestId: `provider-${input.requestId}` },
        };
      },
    });
  };

  const writeProvider = {
    prepareCreateContact: (input) =>
      prepared("contact_create", input, () => {
        contact.name = input.name;
        contact.custom_fields_values = (input.customFieldsValues ?? []).map((field) => ({
          field_id: Number(field.fieldId),
          values: field.values.map((value) => ({ value: value.value })),
        }));
        return "101";
      }),
    prepareUpdateContact: (input) =>
      prepared("contact_update", input, () => {
        contact.name = input.name;
        contact.custom_fields_values = (input.customFieldsValues ?? []).map((field) => ({
          field_id: Number(field.fieldId),
          values: field.values.map((value) => ({ value: value.value })),
        }));
        return "101";
      }),
    prepareCreateLead: (input) =>
      prepared("lead_create", input, () => {
        Object.assign(lead, {
          name: input.name,
          pipeline_id: Number(input.pipelineId),
          status_id: Number(input.statusId),
          responsible_user_id: Number(input.responsibleUserId),
        });
        return "202";
      }),
    prepareUpdateLead: (input) =>
      prepared("lead_update", input, () => {
        lead.name = input.name;
        return "202";
      }),
    prepareLinkContactToLead: (input) =>
      prepared("contact_lead_link", input, () => {
        links.splice(0, links.length, {
          to_entity_id: Number(input.contactId),
          to_entity_type: "contacts",
        });
        return "202";
      }),
    prepareUpdateLeadPipelineStatus: (input) =>
      prepared("lead_pipeline_status_update", input, () => {
        lead.pipeline_id = Number(input.pipelineId);
        lead.status_id = Number(input.statusId);
        return "202";
      }),
    prepareUpdateLeadResponsibleUser: (input) =>
      prepared("lead_responsible_update", input, () => {
        lead.responsible_user_id = Number(input.responsibleUserId);
        return "202";
      }),
    prepareCreateLeadNote: (input) =>
      prepared("lead_note_create", input, () => {
        notes.set("303", { id: 303, entity_id: Number(input.leadId), params: { text: input.text } });
        return "303";
      }),
    prepareUpdateLeadTags: (input) =>
      prepared("lead_tag_update", input, () => {
        lead._embedded.tags = (input.add ?? []).map((tag, index) => ({
          id: Number(tag.id ?? index + 1),
          name: tag.name ?? tagNames.get(String(tag.id)),
        }));
        return "202";
      }),
    getContactById: async () => {
      providerCalls.push("read:contact");
      return structuredClone(contact);
    },
    getLeadById: async () => {
      providerCalls.push("read:lead");
      return structuredClone(lead);
    },
    getLeadLinks: async () => {
      providerCalls.push("read:links");
      if (remainingLinkReadFailures > 0) {
        remainingLinkReadFailures -= 1;
        throw new Error("temporary link read failure");
      }
      return { _embedded: { links: structuredClone(links) } };
    },
    getLeadNoteById: async (_leadId, noteId) => {
      providerCalls.push("read:note");
      return structuredClone(notes.get(String(noteId)));
    },
  };

  const snapshot = (input, status = "prepared") => ({
    attemptId: input.attemptId ?? `55555555-5555-4555-8555-${String(++nextAttempt).padStart(12, "0")}`,
    accountId: input.accountId,
    operationName: input.operationName,
    personId: input.personId,
    leadId: input.leadId,
    actorRole: input.actorRole,
    workflowScope: input.authorization.workflowScope,
    workflowLeadId: input.authorization.workflowLeadId,
    studentCaseId: input.authorization.studentCaseId,
    status,
    providerRequestMetadata: input.providerRequestMetadata,
    providerRequestSha256: input.providerRequestSha256,
    targetContactId: input.targetContactId,
    targetLeadId: input.targetLeadId,
    resultContactId: null,
    resultLeadId: null,
    providerHttpStatus: null,
    providerRequestId: null,
    providerDispatchedAt: null,
    providerRespondedAt: null,
    providerReadback: null,
    providerReadbackAt: null,
    failureCode: null,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
  });

  const dependencies = {
    loadProviderConfig: () => options.providerConfig ?? ({
      status: "ready",
      accountDomain: "example.amocrm.ru",
      accountOrigin: "https://example.amocrm.ru",
      accountSubdomain: "example",
      clientId: "client-id",
      clientSecret: "not-a-real-client-secret",
      redirectUri: "https://example.test/oauth",
      tokenFilePath: "/ignored/token.json",
      timeoutMs: 10_000,
      maxResponseBytes: 262_144,
      requestIntervalMs: 150,
    }),
    loadCommandConfig: () => ({
      sales: { pipelineId: "11", statusId: "12", responsibleUserId: "13", tagName: "EVO V2 Sales" },
      admissions: { pipelineId: "21", statusId: "22", responsibleUserId: "23", tagName: "EVO V2 Admissions" },
    }),
    createReadProvider: () => ({}),
    createWriteProvider: () => writeProvider,
    discoverRouting: async () => {
      discoveryCalls += 1;
      if (options.discoveryError) throw new Error("discovery failed");
      return {
        canonicalAccountId: ACCOUNT_ID,
        discoverySnapshotId: "66666666-6666-4666-8666-666666666666",
        providerAccountId: "77",
        accountBaseUrl: "https://example.amocrm.ru",
        snapshotSha256: "a".repeat(64),
        discoveredAt: "2030-01-01T00:00:00.000Z",
        sales: { pipelineId: "11", statusId: "12", responsibleUserId: "13", tagId: "31", tagName: "EVO V2 Sales" },
        admissions: { pipelineId: "21", statusId: "22", responsibleUserId: "23", tagId: "32", tagName: "EVO V2 Admissions" },
        contactCustomFields: { phoneFieldId: "501", emailFieldId: "502" },
      };
    },
    getLeadSnapshot: async () => ({
      leadId: SALES_LEAD_ID,
      personId: PERSON_ID,
      displayName: "Ada Lovelace",
      email: "ada@example.test",
      phone: "+971501234567",
      source: "whatsapp",
      stage: options.leadStage ?? "qualification",
      ownerRole: options.leadOwnerRole ?? "sales",
      qualificationSummary: null,
      nextAction: null,
      nextActionAt: null,
      version: 1,
      createdAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2030-01-01T00:00:00.000Z",
    }),
    getStudentCaseHandoffSnapshot: async () => ({
      studentCase: {
        studentCaseId: STUDENT_CASE_ID,
        leadId: SALES_LEAD_ID,
        personId: PERSON_ID,
        displayName: "Ada Lovelace",
        status: options.caseStatus ?? "active",
        assignedRole: options.caseOwnerRole ?? "admissions",
        version: 1,
        createdAt: "2030-01-01T00:00:00.000Z",
        updatedAt: "2030-01-01T00:00:00.000Z",
      },
      handoff: {
        handoffId: "88888888-8888-4888-8888-888888888888",
        leadId: SALES_LEAD_ID,
        isOverride: false,
        overrideReason: null,
        executedByRole: "sales",
        executedAt: "2030-01-01T00:00:00.000Z",
        contractEvidenceId: null,
        firstPaymentEvidenceId: null,
      },
      starterTasks: [],
    }),
    readBlockingCommand: async ({ personId, leadId }) =>
      [...attempts.values()].find(
        (attempt) =>
          (attempt.status === "prepared" || attempt.status === "unknown") &&
          (attempt.personId === personId || attempt.leadId === leadId),
      ) ?? null,
    readBindings: async () => ({ contactId: contactBinding, leadId: leadBinding }),
    prepareCommand: async (input) => {
      const existing = attempts.get(input.idempotencyKey);
      if (existing) {
        if (existing.providerRequestSha256 !== input.providerRequestSha256) {
          const error = new Error("idempotency_conflict");
          error.name = "CanonicalAmoCrmCommandRepositoryError";
          error.code = "idempotency_conflict";
          throw error;
        }
        return { kind: "replay", attempt: existing };
      }
      if (input.operationName === "contact_create" && contactBinding !== null) {
        const error = new Error("binding_conflict");
        error.name = "CanonicalAmoCrmCommandRepositoryError";
        error.code = "binding_conflict";
        throw error;
      }
      if (input.operationName === "lead_create" && leadBinding !== null) {
        const error = new Error("binding_conflict");
        error.name = "CanonicalAmoCrmCommandRepositoryError";
        error.code = "binding_conflict";
        throw error;
      }
      const attempt = snapshot(input);
      attempts.set(input.idempotencyKey, attempt);
      return { kind: "prepared", attempt };
    },
    claimDispatch: async (attemptId) => {
      const attempt = [...attempts.values()].find((value) => value.attemptId === attemptId);
      if (attempt.providerDispatchedAt !== null) {
        return { kind: "blocked", reason: "dispatch_already_claimed", attempt };
      }
      attempt.providerDispatchedAt = "2030-01-01T00:00:01.000Z";
      return { kind: "claimed", attempt };
    },
    settleCommand: async (attemptId, _authorization, outcome) => {
      const attempt = [...attempts.values()].find((value) => value.attemptId === attemptId);
      if (settlementFailures.delete(attempt.operationName)) {
        throw new Error("simulated PostgreSQL settlement failure");
      }
      Object.assign(attempt, outcome);
      if (outcome.status === "accepted" && attempt.operationName === "contact_create") {
        contactBinding = outcome.resultContactId;
      }
      if (outcome.status === "accepted" && attempt.operationName === "lead_create") {
        leadBinding = outcome.resultLeadId;
      }
      return { kind: "settled", attempt };
    },
    readCommand: async (attemptId) => {
      const attempt = [...attempts.values()].find((value) => value.attemptId === attemptId);
      if (!attempt) throw new Error("not found");
      return attempt;
    },
    readCommandByIdempotencyKey: async (idempotencyKey) =>
      attempts.get(idempotencyKey) ?? null,
    reconcileUnknown: async (attemptId, _authorization, outcome) => {
      const attempt = [...attempts.values()].find((value) => value.attemptId === attemptId);
      if (outcome.status === "accepted") {
        Object.assign(attempt, outcome);
        return { kind: "reconciled", attempt };
      }
      attempt.status = "unknown";
      attempt.failureCode = outcome.failureCode;
      return { kind: "unchanged", attempt };
    },
    now: () => new Date("2030-01-01T00:00:02.000Z"),
  };

  return {
    dependencies,
    lead,
    providerCalls,
    attempts,
    getDiscoveryCalls: () => discoveryCalls,
  };
}

test("Sales sync proves every required amoCRM effect in product order", async () => {
  const harness = serviceHarness();
  const result = await executeCanonicalAmoCrmSalesSync(
    {
      actorRole: "sales",
      leadId: SALES_LEAD_ID,
      baseRequestId: BASE_REQUEST_ID,
      noteText: "Sales sync reviewed by staff",
    },
    harness.dependencies,
  );

  assert.equal(result.status, "accepted");
  assert.equal(result.reason, "all_effects_verified");
  assert.deepEqual(
    result.steps.map(({ operationName, status }) => [operationName, status]),
    [
      ["contact_create", "accepted"],
      ["lead_create", "accepted"],
      ["contact_lead_link", "accepted"],
      ["lead_pipeline_status_update", "accepted"],
      ["lead_responsible_update", "accepted"],
      ["lead_note_create", "accepted"],
      ["lead_tag_update", "accepted"],
    ],
  );
  assert.deepEqual(harness.providerCalls, [
    "dispatch:contact_create",
    "read:contact",
    "dispatch:lead_create",
    "read:lead",
    "read:links",
    "dispatch:contact_lead_link",
    "read:links",
    "dispatch:lead_pipeline_status_update",
    "read:lead",
    "dispatch:lead_responsible_update",
    "read:lead",
    "dispatch:lead_note_create",
    "read:note",
    "dispatch:lead_tag_update",
    "read:lead",
  ]);
  assert.deepEqual(harness.lead._embedded.tags, [
    { id: 31, name: "EVO V2 Sales" },
  ]);
  const tagAttempt = [...harness.attempts.values()].find(
    ({ operationName }) => operationName === "lead_tag_update",
  );
  assert.equal(tagAttempt?.providerRequestMetadata.expected.tagId, "31");
});

test("exact Sales replay returns stored proof without another provider call", async () => {
  const harness = serviceHarness();
  const input = {
    actorRole: "sales",
    leadId: SALES_LEAD_ID,
    baseRequestId: BASE_REQUEST_ID,
    noteText: "Sales sync reviewed by staff",
  };
  assert.equal(
    (await executeCanonicalAmoCrmSalesSync(input, harness.dependencies)).status,
    "accepted",
  );
  const discoveryCalls = harness.getDiscoveryCalls();
  harness.providerCalls.splice(0);

  const replay = await executeCanonicalAmoCrmSalesSync(input, harness.dependencies);

  assert.equal(replay.status, "accepted");
  assert.deepEqual(harness.providerCalls, []);
  assert.equal(harness.getDiscoveryCalls(), discoveryCalls);
  assert.equal(
    replay.steps.filter(({ reason }) => reason === "exact_replay").length,
    7,
  );
});

test("changed content under the same browser request is a conflict and never dispatches again", async () => {
  const harness = serviceHarness();
  const baseInput = {
    actorRole: "sales",
    leadId: SALES_LEAD_ID,
    baseRequestId: BASE_REQUEST_ID,
    noteText: "Sales sync reviewed by staff",
  };
  assert.equal(
    (await executeCanonicalAmoCrmSalesSync(baseInput, harness.dependencies)).status,
    "accepted",
  );
  const discoveryCalls = harness.getDiscoveryCalls();
  harness.providerCalls.splice(0);

  const conflict = await executeCanonicalAmoCrmSalesSync(
    { ...baseInput, noteText: "Different reviewed note" },
    harness.dependencies,
  );

  assert.equal(conflict.status, "request_conflict");
  assert.equal(conflict.reason, "idempotency_conflict");
  assert.equal(
    harness.providerCalls.some((call) => call.startsWith("dispatch:")),
    false,
  );
  assert.equal(harness.getDiscoveryCalls(), discoveryCalls);
});

test("same request detects server routing drift before reporting an exact replay", async () => {
  const harness = serviceHarness();
  const input = {
    actorRole: "sales",
    leadId: SALES_LEAD_ID,
    baseRequestId: BASE_REQUEST_ID,
    noteText: "Sales sync reviewed by staff",
  };
  assert.equal(
    (await executeCanonicalAmoCrmSalesSync(input, harness.dependencies)).status,
    "accepted",
  );
  const discoveryCalls = harness.getDiscoveryCalls();
  harness.providerCalls.splice(0);

  const conflict = await executeCanonicalAmoCrmSalesSync(input, {
    ...harness.dependencies,
    loadCommandConfig: () => ({
      sales: {
        pipelineId: "11",
        statusId: "99",
        responsibleUserId: "13",
        tagName: "EVO V2 Sales",
      },
      admissions: {
        pipelineId: "21",
        statusId: "22",
        responsibleUserId: "23",
        tagName: "EVO V2 Admissions",
      },
    }),
  });

  assert.deepEqual(
    [conflict.status, conflict.reason],
    ["request_conflict", "idempotency_conflict"],
  );
  assert.deepEqual(harness.providerCalls, []);
  assert.equal(harness.getDiscoveryCalls(), discoveryCalls);
});

test("a safe partial resume replays accepted steps and continues from the first unread provider effect", async () => {
  const harness = serviceHarness({ failLinkReads: 1 });
  const input = {
    actorRole: "sales",
    leadId: SALES_LEAD_ID,
    baseRequestId: BASE_REQUEST_ID,
    noteText: "Sales sync reviewed by staff",
  };

  const interrupted = await executeCanonicalAmoCrmSalesSync(
    input,
    harness.dependencies,
  );
  assert.equal(interrupted.status, "error");
  assert.equal(interrupted.reason, "link_readback_failed");
  assert.deepEqual(
    interrupted.steps.slice(0, 2).map(({ status }) => status),
    ["accepted", "accepted"],
  );
  harness.providerCalls.splice(0);

  const resumed = await executeCanonicalAmoCrmSalesSync(input, harness.dependencies);

  assert.equal(resumed.status, "accepted");
  assert.equal(
    harness.providerCalls.some(
      (call) => call === "dispatch:contact_create" || call === "dispatch:lead_create",
    ),
    false,
  );
  assert.equal(harness.providerCalls[0], "read:links");
});

test("a prepared command whose dispatch was already claimed is unresolved and is never dispatched again", async () => {
  const harness = serviceHarness();
  const idempotencyKey = `${BASE_REQUEST_ID}:contact_create`;
  const prepared = harness.dependencies.createWriteProvider().prepareCreateContact({
    requestId: idempotencyKey,
    name: "Ada Lovelace",
    customFieldsValues: [
      { fieldId: "501", values: [{ value: "+971501234567", enumCode: "WORK" }] },
      { fieldId: "502", values: [{ value: "ada@example.test", enumCode: "WORK" }] },
    ],
  });
  const authorization = {
    actorRole: "sales",
    workflowScope: "sales_pre_handoff",
    workflowLeadId: SALES_LEAD_ID,
    studentCaseId: null,
  };
  const created = await harness.dependencies.prepareCommand({
    accountId: ACCOUNT_ID,
    operationName: "contact_create",
    personId: PERSON_ID,
    leadId: null,
    actorRole: "sales",
    authorization,
    targetContactId: null,
    targetLeadId: null,
    providerRequestMetadata: {
      version: 1,
      request: prepared.request,
      bodySha256: prepared.bodySha256,
      expected: {
        entity: "contact",
        nameSha256: valueSha256("Ada Lovelace"),
        phoneSha256: valueSha256("+971501234567"),
        emailSha256: valueSha256("ada@example.test"),
        phoneFieldId: "501",
        emailFieldId: "502",
      },
      discoverySnapshotId: ACCOUNT_ID,
    },
    providerRequestSha256: prepared.requestSha256,
    correlationId: BASE_REQUEST_ID,
    idempotencyKey,
  });
  await harness.dependencies.claimDispatch(created.attempt.attemptId, authorization);
  const discoveryCalls = harness.getDiscoveryCalls();
  harness.providerCalls.splice(0);

  const result = await executeCanonicalAmoCrmSalesSync(
    {
      actorRole: "sales",
      leadId: SALES_LEAD_ID,
      baseRequestId: BASE_REQUEST_ID,
      noteText: "Sales sync reviewed by staff",
    },
    harness.dependencies,
  );

  assert.equal(result.status, "unknown");
  assert.equal(result.reason, "dispatch_outcome_unresolved");
  assert.deepEqual(harness.providerCalls, []);
  assert.equal(harness.getDiscoveryCalls(), discoveryCalls);
});

test("an unknown provider outcome stops the sequence and exact replay never retries it", async () => {
  const harness = serviceHarness({ unknownOperation: "lead_note_create" });
  const input = {
    actorRole: "sales",
    leadId: SALES_LEAD_ID,
    baseRequestId: BASE_REQUEST_ID,
    noteText: "Sales sync reviewed by staff",
  };

  const first = await executeCanonicalAmoCrmSalesSync(input, harness.dependencies);

  assert.equal(first.status, "unknown");
  assert.equal(first.reason, "provider_result_unknown");
  assert.equal(first.steps.at(-1).operationName, "lead_note_create");
  assert.equal(
    harness.providerCalls.includes("dispatch:lead_tag_update"),
    false,
  );
  const discoveryCalls = harness.getDiscoveryCalls();
  harness.providerCalls.splice(0);

  const replay = await executeCanonicalAmoCrmSalesSync(input, harness.dependencies);

  assert.equal(replay.status, "unknown");
  assert.equal(replay.reason, "provider_result_unknown");
  assert.deepEqual(harness.providerCalls, []);
  assert.equal(harness.getDiscoveryCalls(), discoveryCalls);
});

test("a new browser request is blocked before contact dispatch while any later lead effect is unresolved", async () => {
  const harness = serviceHarness({ unknownOperation: "lead_note_create" });
  const first = await executeCanonicalAmoCrmSalesSync(
    {
      actorRole: "sales",
      leadId: SALES_LEAD_ID,
      baseRequestId: BASE_REQUEST_ID,
      noteText: "Sales sync reviewed by staff",
    },
    harness.dependencies,
  );
  assert.equal(first.status, "unknown");
  assert.equal(first.steps.at(-1).operationName, "lead_note_create");
  const discoveryCalls = harness.getDiscoveryCalls();
  harness.providerCalls.splice(0);

  const blocked = await executeCanonicalAmoCrmSalesSync(
    {
      actorRole: "sales",
      leadId: SALES_LEAD_ID,
      baseRequestId: "99999999-9999-4999-8999-999999999999",
      noteText: "A new browser request must not write",
    },
    harness.dependencies,
  );

  assert.deepEqual(
    [blocked.status, blocked.reason, blocked.attemptId],
    ["unknown", "provider_result_unknown", first.attemptId],
  );
  assert.equal(
    harness.providerCalls.some((call) => call.startsWith("dispatch:")),
    false,
  );
  assert.equal(harness.getDiscoveryCalls(), discoveryCalls);
});

test("a post-dispatch settlement failure is unknown and exact replay cannot write again", async () => {
  const harness = serviceHarness({
    failSettlementOnceFor: ["lead_pipeline_status_update"],
  });
  const input = {
    actorRole: "sales",
    leadId: SALES_LEAD_ID,
    baseRequestId: BASE_REQUEST_ID,
    noteText: "Sales sync reviewed by staff",
  };

  const first = await executeCanonicalAmoCrmSalesSync(
    input,
    harness.dependencies,
  );

  assert.equal(first.status, "unknown");
  assert.equal(
    first.steps.at(-1).operationName,
    "lead_pipeline_status_update",
  );
  assert.notEqual(first.attemptId, null);
  assert.equal(
    harness.providerCalls.filter(
      (call) => call === "dispatch:lead_pipeline_status_update",
    ).length,
    1,
  );
  assert.equal(
    harness.providerCalls.includes("dispatch:lead_responsible_update"),
    false,
  );
  const discoveryCalls = harness.getDiscoveryCalls();
  harness.providerCalls.splice(0);

  const replay = await executeCanonicalAmoCrmSalesSync(
    input,
    harness.dependencies,
  );

  assert.equal(replay.status, "unknown");
  assert.equal(replay.reason, "dispatch_outcome_unresolved");
  assert.equal(replay.attemptId, first.attemptId);
  assert.deepEqual(harness.providerCalls, []);
  assert.equal(harness.getDiscoveryCalls(), discoveryCalls);

  const reconciled = await reconcileCanonicalAmoCrmSyncAttempt(
    {
      actorRole: "sales",
      workflowScope: "sales_pre_handoff",
      leadId: SALES_LEAD_ID,
      studentCaseId: null,
      attemptId: first.attemptId,
    },
    harness.dependencies,
  );

  assert.deepEqual(
    [reconciled.status, reconciled.reason, reconciled.attemptId],
    ["accepted", "reconciled_effect_verified", first.attemptId],
  );
  assert.deepEqual(harness.providerCalls, ["read:lead"]);
});

test("role, live phase, and provider configuration failures block before provider execution", async () => {
  const common = {
    leadId: SALES_LEAD_ID,
    baseRequestId: BASE_REQUEST_ID,
    noteText: "Sales sync reviewed by staff",
  };

  const forbiddenRole = serviceHarness();
  const forbidden = await executeCanonicalAmoCrmSalesSync(
    { ...common, actorRole: "admissions" },
    forbiddenRole.dependencies,
  );
  assert.deepEqual(
    [forbidden.status, forbidden.reason, forbiddenRole.getDiscoveryCalls()],
    ["blocked", "role_forbidden", 0],
  );

  const stalePhase = serviceHarness({ leadStage: "handed_off" });
  const stale = await executeCanonicalAmoCrmSalesSync(
    { ...common, actorRole: "admin" },
    stalePhase.dependencies,
  );
  assert.deepEqual(
    [stale.status, stale.reason, stalePhase.getDiscoveryCalls()],
    ["blocked", "sales_phase_not_active", 0],
  );

  const disabledProvider = serviceHarness({
    providerConfig: { status: "blocked", reason: "feature_disabled" },
  });
  const disabled = await executeCanonicalAmoCrmSalesSync(
    { ...common, actorRole: "sales" },
    disabledProvider.dependencies,
  );
  assert.deepEqual(
    [disabled.status, disabled.reason, disabledProvider.getDiscoveryCalls()],
    ["blocked", "feature_disabled", 0],
  );
  assert.deepEqual(disabledProvider.providerCalls, []);

  const failedDiscovery = serviceHarness({ discoveryError: true });
  const discoveryBlocked = await executeCanonicalAmoCrmSalesSync(
    { ...common, actorRole: "sales" },
    failedDiscovery.dependencies,
  );
  assert.deepEqual(
    [
      discoveryBlocked.status,
      discoveryBlocked.reason,
      failedDiscovery.getDiscoveryCalls(),
    ],
    ["blocked", "provider_discovery_failed", 1],
  );
  assert.deepEqual(failedDiscovery.providerCalls, []);
});

test("a provider 4xx rejection is terminal, visible, and never retried", async () => {
  const harness = serviceHarness({ rejectedOperation: "lead_responsible_update" });
  const input = {
    actorRole: "sales",
    leadId: SALES_LEAD_ID,
    baseRequestId: BASE_REQUEST_ID,
    noteText: "Sales sync reviewed by staff",
  };
  const first = await executeCanonicalAmoCrmSalesSync(input, harness.dependencies);
  assert.deepEqual(
    [first.status, first.reason, first.steps.at(-1).operationName],
    ["rejected", "provider_rejected", "lead_responsible_update"],
  );
  const discoveryCalls = harness.getDiscoveryCalls();
  harness.providerCalls.splice(0);

  const replay = await executeCanonicalAmoCrmSalesSync(input, harness.dependencies);

  assert.deepEqual(
    [replay.status, replay.reason],
    ["rejected", "provider_rejected"],
  );
  assert.deepEqual(harness.providerCalls, []);
  assert.equal(harness.getDiscoveryCalls(), discoveryCalls);
});

test("Admissions sync updates exact existing bindings and proves every post-handoff effect", async () => {
  const harness = serviceHarness({ contactBinding: "101", leadBinding: "202" });

  const result = await executeCanonicalAmoCrmAdmissionsSync(
    {
      actorRole: "admissions",
      studentCaseId: STUDENT_CASE_ID,
      baseRequestId: BASE_REQUEST_ID,
      noteText: "Admissions sync reviewed by staff",
    },
    harness.dependencies,
  );

  assert.equal(result.status, "accepted");
  assert.deepEqual(
    result.steps.map(({ operationName, status }) => [operationName, status]),
    [
      ["contact_update", "accepted"],
      ["lead_update", "accepted"],
      ["contact_lead_link", "accepted"],
      ["lead_pipeline_status_update", "accepted"],
      ["lead_responsible_update", "accepted"],
      ["lead_note_create", "accepted"],
      ["lead_tag_update", "accepted"],
    ],
  );
  assert.deepEqual(harness.providerCalls, [
    "dispatch:contact_update",
    "read:contact",
    "dispatch:lead_update",
    "read:lead",
    "read:links",
    "dispatch:contact_lead_link",
    "read:links",
    "dispatch:lead_pipeline_status_update",
    "read:lead",
    "dispatch:lead_responsible_update",
    "read:lead",
    "dispatch:lead_note_create",
    "read:note",
    "dispatch:lead_tag_update",
    "read:lead",
  ]);
});

test("Admissions sync fails closed when either exact PostgreSQL binding is missing", async () => {
  for (const bindings of [
    { contactBinding: null, leadBinding: "202" },
    { contactBinding: "101", leadBinding: null },
  ]) {
    const harness = serviceHarness(bindings);
    const result = await executeCanonicalAmoCrmAdmissionsSync(
      {
        actorRole: "admin",
        studentCaseId: STUDENT_CASE_ID,
        baseRequestId: BASE_REQUEST_ID,
        noteText: "Admissions sync reviewed by staff",
      },
      harness.dependencies,
    );

    assert.deepEqual(
      [result.status, result.reason],
      ["blocked", "admissions_bindings_missing"],
    );
    assert.deepEqual(harness.providerCalls, []);
    assert.equal(harness.attempts.size, 0);
  }
});

test("explicit reconciliation proves an ambiguous exact update by readback without another mutation", async () => {
  const harness = serviceHarness({
    unknownAfterApplyOperation: "lead_pipeline_status_update",
  });
  const initial = await executeCanonicalAmoCrmSalesSync(
    {
      actorRole: "sales",
      leadId: SALES_LEAD_ID,
      baseRequestId: BASE_REQUEST_ID,
      noteText: "Sales sync reviewed by staff",
    },
    harness.dependencies,
  );
  assert.equal(initial.status, "unknown");
  assert.equal(initial.steps.at(-1).operationName, "lead_pipeline_status_update");
  const attemptId = initial.attemptId;
  harness.providerCalls.splice(0);

  const reconciled = await reconcileCanonicalAmoCrmSyncAttempt(
    {
      actorRole: "sales",
      workflowScope: "sales_pre_handoff",
      leadId: SALES_LEAD_ID,
      studentCaseId: null,
      attemptId,
    },
    harness.dependencies,
  );

  assert.deepEqual(
    [reconciled.status, reconciled.reason, reconciled.attemptId],
    ["accepted", "reconciled_effect_verified", attemptId],
  );
  assert.deepEqual(harness.providerCalls, ["read:lead"]);
});

test("explicit reconciliation leaves an ambiguous note unknown when no exact note ID is recoverable", async () => {
  const harness = serviceHarness({ unknownOperation: "lead_note_create" });
  const initial = await executeCanonicalAmoCrmSalesSync(
    {
      actorRole: "admin",
      leadId: SALES_LEAD_ID,
      baseRequestId: BASE_REQUEST_ID,
      noteText: "Sales sync reviewed by staff",
    },
    harness.dependencies,
  );
  assert.equal(initial.status, "unknown");
  const attemptId = initial.attemptId;
  harness.providerCalls.splice(0);

  const unresolved = await reconcileCanonicalAmoCrmSyncAttempt(
    {
      actorRole: "admin",
      workflowScope: "sales_pre_handoff",
      leadId: SALES_LEAD_ID,
      studentCaseId: null,
      attemptId,
    },
    harness.dependencies,
  );

  assert.deepEqual(
    [unresolved.status, unresolved.reason, unresolved.attemptId],
    ["unknown", "reconciliation_target_unavailable", attemptId],
  );
  assert.deepEqual(harness.providerCalls, []);
});
