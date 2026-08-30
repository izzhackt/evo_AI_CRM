import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import postgres from "postgres";

import {
  CanonicalAmoCrmCommandRepositoryError,
  claimCanonicalAmoCrmCommandDispatch,
  prepareCanonicalAmoCrmCommand,
  readBlockingCanonicalAmoCrmCommand,
  readCanonicalAmoCrmBindings,
  readCanonicalAmoCrmCommand,
  readCanonicalAmoCrmCommandByIdempotencyKey,
  reconcileUnknownCanonicalAmoCrmCommand,
  settleCanonicalAmoCrmCommand,
} from "../src/lib/server/canonical-amocrm-command-repository.ts";
import {
  createCanonicalPersonLead,
  handoffCanonicalLeadToAdmissions,
  updateCanonicalSalesLeadWorkflow,
} from "../src/lib/server/canonical-crm-repository.ts";
import { closeDatabaseConnections } from "../src/lib/server/database.ts";

function requiredDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  assert.ok(value, "DATABASE_URL is required for amoCRM command tests");
  const parsed = new URL(value);
  assert.ok(
    parsed.protocol === "postgres:" || parsed.protocol === "postgresql:",
    "amoCRM command tests require PostgreSQL",
  );
  return value;
}

function repositoryError(code) {
  return (error) =>
    error instanceof CanonicalAmoCrmCommandRepositoryError &&
    error.code === code;
}

function commandContext(actorRole = "sales") {
  const requestId = randomUUID();
  return {
    actorRole,
    idempotencyKey: requestId,
    correlationId: requestId,
  };
}

function salesAuthorization(leadId, actorRole = "sales") {
  return {
    actorRole,
    workflowScope: "sales_pre_handoff",
    workflowLeadId: leadId,
    studentCaseId: null,
  };
}

function admissionsAuthorization(leadId, studentCaseId, actorRole = "admissions") {
  return {
    actorRole,
    workflowScope: "admissions_post_handoff",
    workflowLeadId: leadId,
    studentCaseId,
  };
}

async function createLead(runId, suffix = "lead") {
  return createCanonicalPersonLead({
    ...commandContext(),
    displayName: `amocrm-${suffix}-${runId}`,
    email: `${suffix}-${runId}@acceptance.invalid`,
    source: `amocrm-command-${runId}`,
  });
}

async function createAccount(sql, runId) {
  const accountId = randomUUID();
  const providerAccountId = String(
    (BigInt(`0x${runId.replaceAll("-", "").slice(0, 15)}`) % 900000000000000000n) +
      100000000000000000n,
  );
  await sql`
    insert into evo_amocrm_accounts (
      id,
      provider_account_id,
      account_base_url,
      account_subdomain,
      account_name,
      timezone
    ) values (
      ${accountId},
      ${providerAccountId},
      ${`https://technical-${runId.slice(0, 12)}.amocrm.ru`},
      ${`technical-${runId.slice(0, 12)}`},
      ${`Technical ${runId}`},
      'Asia/Dubai'
    )
  `;
  return accountId;
}

async function createActiveHandoff(sql, lead, runId) {
  const studentCaseId = randomUUID();
  const handoffId = randomUUID();
  await sql.begin(async (transaction) => {
    await transaction`
      update evo_leads
      set stage = 'handed_off', version = version + 1, updated_at = now()
      where id = ${lead.leadId}
    `;
    await transaction`
      insert into evo_student_cases (
        id, person_id, lead_id, status, owner_role
      ) values (
        ${studentCaseId}, ${lead.personId}, ${lead.leadId}, 'active', 'admissions'
      )
    `;
    await transaction`
      insert into evo_sales_admissions_handoffs (
        id,
        lead_id,
        student_case_id,
        is_override,
        override_reason,
        executed_by_role,
        correlation_id,
        idempotency_key
      ) values (
        ${handoffId},
        ${lead.leadId},
        ${studentCaseId},
        true,
        'Technical PostgreSQL authorization setup',
        'admin',
        ${`handoff-correlation-${runId}`},
        ${`handoff-idempotency-${runId}`}
      )
    `;
  });
  return studentCaseId;
}

function leadCreateInput(accountId, lead, context, metadata = { name: "Technical lead" }) {
  const providerRequestSha256 = createHash("sha256")
    .update(JSON.stringify({ method: "POST", path: "/api/v4/leads", metadata }))
    .digest("hex");
  return {
    ...context,
    accountId,
    operationName: "lead_create",
    personId: null,
    leadId: lead.leadId,
    authorization: salesAuthorization(lead.leadId, context.actorRole),
    targetContactId: null,
    targetLeadId: null,
    providerRequestMetadata: metadata,
    providerRequestSha256,
  };
}

function contactCreateInput(
  accountId,
  lead,
  context,
  metadata = { name: "Technical contact" },
) {
  const providerRequestSha256 = createHash("sha256")
    .update(JSON.stringify({ method: "POST", path: "/api/v4/contacts", metadata }))
    .digest("hex");
  return {
    ...context,
    accountId,
    operationName: "contact_create",
    personId: lead.personId,
    leadId: null,
    authorization: salesAuthorization(lead.leadId, context.actorRole),
    targetContactId: null,
    targetLeadId: null,
    providerRequestMetadata: metadata,
    providerRequestSha256,
  };
}

function timestampAtOrAfter(notBefore) {
  const floor = Date.parse(notBefore ?? "");
  assert.ok(Number.isFinite(floor));
  return new Date(Math.max(Date.now(), floor + 1)).toISOString();
}

function acceptedLeadOutcome(providerLeadId = "700001", providerDispatchedAt) {
  const now = timestampAtOrAfter(providerDispatchedAt);
  return {
    status: "accepted",
    providerHttpStatus: 200,
    providerRequestId: "technical-request-id",
    providerRespondedAt: now,
    providerReadback: { id: Number(providerLeadId), name: "Technical lead" },
    providerReadbackAt: now,
    resultContactId: null,
    resultLeadId: providerLeadId,
    providerUpdatedAt: now,
  };
}

test("amoCRM command prepare, exact replay and one-time dispatch claim are durable on PostgreSQL", async () => {
  const sql = postgres(requiredDatabaseUrl(), {
    idle_timeout: 5,
    max: 4,
    onnotice: () => undefined,
  });
  const runId = randomUUID();
  try {
    const accountId = await createAccount(sql, runId);
    const lead = await createLead(runId, "prepare");
    const context = commandContext("sales");
    const input = leadCreateInput(accountId, lead, context);
    assert.equal(
      await readCanonicalAmoCrmCommandByIdempotencyKey(
        input.idempotencyKey,
        input.authorization,
      ),
      null,
    );

    const prepared = await prepareCanonicalAmoCrmCommand(input);
    assert.equal(prepared.kind, "prepared");
    assert.equal(prepared.attempt.status, "prepared");
    assert.equal(prepared.attempt.providerDispatchedAt, null);
    assert.equal(prepared.attempt.workflowScope, "sales_pre_handoff");
    assert.equal(prepared.attempt.workflowLeadId, lead.leadId);
    assert.deepEqual(
      await readCanonicalAmoCrmCommandByIdempotencyKey(
        input.idempotencyKey,
        input.authorization,
      ),
      prepared.attempt,
    );
    await assert.rejects(
      readCanonicalAmoCrmCommandByIdempotencyKey(
        input.idempotencyKey,
        salesAuthorization(lead.leadId, "admissions"),
      ),
      repositoryError("forbidden"),
    );
    await assert.rejects(
      readCanonicalAmoCrmCommandByIdempotencyKey(
        input.idempotencyKey,
        admissionsAuthorization(lead.leadId, randomUUID(), "admin"),
      ),
      repositoryError("forbidden"),
    );

    const replay = await prepareCanonicalAmoCrmCommand(input);
    assert.equal(replay.kind, "replay");
    assert.deepEqual(replay.attempt, prepared.attempt);

    await assert.rejects(
      prepareCanonicalAmoCrmCommand({
        ...input,
        providerRequestMetadata: { name: "Changed payload" },
      }),
      repositoryError("idempotency_conflict"),
    );
    await assert.rejects(
      prepareCanonicalAmoCrmCommand({
        ...input,
        providerRequestSha256: "f".repeat(64),
      }),
      repositoryError("idempotency_conflict"),
    );

    const [firstClaim, secondClaim] = await Promise.all([
      claimCanonicalAmoCrmCommandDispatch(
        prepared.attempt.attemptId,
        input.authorization,
      ),
      claimCanonicalAmoCrmCommandDispatch(
        prepared.attempt.attemptId,
        input.authorization,
      ),
    ]);
    const claims = [firstClaim, secondClaim];
    assert.equal(claims.filter((result) => result.kind === "claimed").length, 1);
    assert.equal(claims.filter((result) => result.kind === "blocked").length, 1);
    assert.equal(
      claims.find((result) => result.kind === "blocked")?.reason,
      "dispatch_already_claimed",
    );

    const durable = await readCanonicalAmoCrmCommand(
      prepared.attempt.attemptId,
      input.authorization,
    );
    assert.equal(durable.status, "prepared");
    assert.ok(durable.providerDispatchedAt);

    const replayAfterClaim = await prepareCanonicalAmoCrmCommand(input);
    assert.equal(replayAfterClaim.kind, "replay");
    assert.ok(replayAfterClaim.attempt.providerDispatchedAt);
  } finally {
    await closeDatabaseConnections();
    await sql.end({ timeout: 5 });
  }
});

test("settlement remains monotonic when the PostgreSQL clock leads the application clock", async () => {
  const sql = postgres(requiredDatabaseUrl(), {
    idle_timeout: 5,
    max: 4,
    onnotice: () => undefined,
  });
  const runId = randomUUID();
  try {
    const accountId = await createAccount(sql, runId);
    const lead = await createLead(runId, "database-clock-floor");
    const input = leadCreateInput(accountId, lead, commandContext("sales"));
    const prepared = await prepareCanonicalAmoCrmCommand(input);
    const claimed = await claimCanonicalAmoCrmCommandDispatch(
      prepared.attempt.attemptId,
      input.authorization,
    );
    assert.equal(claimed.kind, "claimed");

    const databaseFloor = new Date(Date.now() + 5_000).toISOString();
    await sql`
      update evo_amocrm_operation_attempts
      set
        prepared_at = ${databaseFloor},
        provider_dispatched_at = ${databaseFloor}
      where id = ${prepared.attempt.attemptId}
    `;

    const settled = await settleCanonicalAmoCrmCommand(
      prepared.attempt.attemptId,
      input.authorization,
      { status: "unknown", failureCode: "transport_timeout" },
    );
    assert.equal(settled.kind, "settled");
    assert.equal(settled.attempt.status, "unknown");
    assert.ok(
      Date.parse(settled.attempt.settledAt) >= Date.parse(databaseFloor),
    );
  } finally {
    await closeDatabaseConnections();
    await sql.end({ timeout: 5 });
  }
});

test("accepted create settles its receipt and binding atomically with exact settlement replay", async () => {
  const sql = postgres(requiredDatabaseUrl(), {
    idle_timeout: 5,
    max: 4,
    onnotice: () => undefined,
  });
  const runId = randomUUID();
  try {
    const accountId = await createAccount(sql, runId);
    const lead = await createLead(runId, "accepted");
    const context = commandContext("sales");
    const input = leadCreateInput(accountId, lead, context);
    const bindingsBefore = await readCanonicalAmoCrmBindings({
      accountId,
      authorization: input.authorization,
      personId: lead.personId,
      leadId: lead.leadId,
    });
    assert.deepEqual(bindingsBefore, { contactId: null, leadId: null });
    const prepared = await prepareCanonicalAmoCrmCommand(input);
    const claimed = await claimCanonicalAmoCrmCommandDispatch(
      prepared.attempt.attemptId,
      input.authorization,
    );
    assert.equal(claimed.kind, "claimed");

    const outcome = acceptedLeadOutcome(
      "700011",
      claimed.attempt.providerDispatchedAt,
    );
    const settled = await settleCanonicalAmoCrmCommand(
      prepared.attempt.attemptId,
      input.authorization,
      outcome,
    );
    assert.equal(settled.kind, "settled");
    assert.equal(settled.attempt.status, "accepted");
    assert.equal(settled.attempt.resultLeadId, "700011");
    assert.equal(settled.attempt.failureCode, null);
    assert.deepEqual(
      await readCanonicalAmoCrmBindings({
        accountId,
        authorization: input.authorization,
        personId: lead.personId,
        leadId: lead.leadId,
      }),
      { contactId: null, leadId: "700011" },
    );

    const replay = await settleCanonicalAmoCrmCommand(
      prepared.attempt.attemptId,
      input.authorization,
      outcome,
    );
    assert.equal(replay.kind, "replay");
    assert.deepEqual(replay.attempt, settled.attempt);
    await assert.rejects(
      settleCanonicalAmoCrmCommand(
        prepared.attempt.attemptId,
        input.authorization,
        { ...outcome, resultLeadId: "700012" },
      ),
      repositoryError("state_conflict"),
    );

    const contactInput = contactCreateInput(
      accountId,
      lead,
      commandContext("sales"),
    );
    const contactPrepared = await prepareCanonicalAmoCrmCommand(contactInput);
    const contactClaimed = await claimCanonicalAmoCrmCommandDispatch(
      contactPrepared.attempt.attemptId,
      contactInput.authorization,
    );
    const contactTime = timestampAtOrAfter(
      contactClaimed.attempt.providerDispatchedAt,
    );
    const contactSettled = await settleCanonicalAmoCrmCommand(
      contactPrepared.attempt.attemptId,
      contactInput.authorization,
      {
        status: "accepted",
        providerHttpStatus: 200,
        providerRequestId: "technical-contact-request-id",
        providerRespondedAt: contactTime,
        providerReadback: { id: 600011, name: "Technical contact" },
        providerReadbackAt: contactTime,
        resultContactId: "600011",
        resultLeadId: null,
        providerUpdatedAt: contactTime,
      },
    );
    assert.equal(contactSettled.attempt.status, "accepted");
    assert.equal(contactSettled.attempt.resultContactId, "600011");
    assert.deepEqual(
      await readCanonicalAmoCrmBindings({
        accountId,
        authorization: contactInput.authorization,
        personId: lead.personId,
        leadId: lead.leadId,
      }),
      { contactId: "600011", leadId: "700011" },
    );
    await assert.rejects(
      readCanonicalAmoCrmBindings({
        accountId,
        authorization: contactInput.authorization,
        personId: randomUUID(),
        leadId: lead.leadId,
      }),
      repositoryError("forbidden"),
    );
    await assert.rejects(
      readCanonicalAmoCrmBindings({
        accountId: randomUUID(),
        authorization: contactInput.authorization,
        personId: lead.personId,
        leadId: lead.leadId,
      }),
      repositoryError("not_found"),
    );

    const [state] = await sql`
      select
        (select count(*)::int
          from evo_amocrm_lead_bindings
          where account_id = ${accountId}
            and lead_id = ${lead.leadId}
            and provider_lead_id = '700011'
            and created_by_attempt_id = ${prepared.attempt.attemptId}
            and created_by_attempt_status = 'accepted') as binding_count,
        (select count(*)::int
          from evo_amocrm_contact_bindings
          where account_id = ${accountId}
            and person_id = ${lead.personId}
            and provider_contact_id = '600011'
            and created_by_attempt_id = ${contactPrepared.attempt.attemptId}
            and created_by_attempt_status = 'accepted') as contact_binding_count,
        (select status
          from evo_command_receipts
          where id = ${prepared.attempt.commandReceiptId}) as receipt_status,
        (select count(*)::int
          from evo_amocrm_lead_bindings
          where created_by_attempt_id = ${prepared.attempt.attemptId}) as attempt_binding_count
    `;
    assert.deepEqual(state, {
      binding_count: 1,
      contact_binding_count: 1,
      receipt_status: "succeeded",
      attempt_binding_count: 1,
    });
  } finally {
    await closeDatabaseConnections();
    await sql.end({ timeout: 5 });
  }
});

test("unknown and rejected outcomes never create bindings and unknown requires explicit reconciliation", async () => {
  const sql = postgres(requiredDatabaseUrl(), {
    idle_timeout: 5,
    max: 4,
    onnotice: () => undefined,
  });
  const runId = randomUUID();
  try {
    const accountId = await createAccount(sql, runId);
    const unknownLead = await createLead(runId, "unknown");
    const unknownContext = commandContext("sales");
    const unknownInput = leadCreateInput(accountId, unknownLead, unknownContext, {
      name: "Unknown technical lead",
    });
    const unknownPrepared = await prepareCanonicalAmoCrmCommand(unknownInput);
    await claimCanonicalAmoCrmCommandDispatch(
      unknownPrepared.attempt.attemptId,
      unknownInput.authorization,
    );
    const unknownSettled = await settleCanonicalAmoCrmCommand(
      unknownPrepared.attempt.attemptId,
      unknownInput.authorization,
      { status: "unknown", failureCode: "transport_timeout" },
    );
    assert.equal(unknownSettled.attempt.status, "unknown");
    assert.equal(unknownSettled.attempt.resultLeadId, null);
    const flowBlocker = await readBlockingCanonicalAmoCrmCommand({
      authorization: unknownInput.authorization,
      personId: unknownLead.personId,
      leadId: unknownLead.leadId,
    });
    assert.equal(flowBlocker?.attemptId, unknownPrepared.attempt.attemptId);
    assert.equal(flowBlocker?.operationName, "lead_create");

    await assert.rejects(
      prepareCanonicalAmoCrmCommand(
        leadCreateInput(accountId, unknownLead, commandContext("sales"), {
          name: "Blind duplicate must be blocked",
        }),
      ),
      repositoryError("state_conflict"),
    );

    const stillUnknown = await reconcileUnknownCanonicalAmoCrmCommand(
      unknownPrepared.attempt.attemptId,
      unknownInput.authorization,
      {
        status: "still_unknown",
        failureCode: "readback_not_found",
        providerReadback: { found: false, searchedBy: "exact-marker" },
        providerReadbackAt: new Date().toISOString(),
      },
    );
    assert.equal(stillUnknown.kind, "unchanged");
    assert.equal(stillUnknown.attempt.status, "unknown");
    assert.ok(stillUnknown.attempt.lastReconciledAt);

    const reconcileTime = timestampAtOrAfter(
      stillUnknown.attempt.providerDispatchedAt,
    );
    const reconciled = await reconcileUnknownCanonicalAmoCrmCommand(
      unknownPrepared.attempt.attemptId,
      unknownInput.authorization,
      {
        status: "accepted",
        providerHttpStatus: 200,
        providerRequestId: "readback-request-id",
        providerRespondedAt: reconcileTime,
        providerReadback: { id: 700021, marker: "exact-marker" },
        providerReadbackAt: reconcileTime,
        resultContactId: null,
        resultLeadId: "700021",
        providerUpdatedAt: reconcileTime,
      },
    );
    assert.equal(reconciled.kind, "reconciled");
    assert.equal(reconciled.attempt.status, "accepted");
    assert.ok(reconciled.attempt.lastReconciledAt);

    const rejectedLead = await createLead(runId, "rejected");
    const rejectedInput = leadCreateInput(
      accountId,
      rejectedLead,
      commandContext("sales"),
      { name: "Rejected technical lead" },
    );
    const rejectedPrepared = await prepareCanonicalAmoCrmCommand(rejectedInput);
    const rejectedClaimed = await claimCanonicalAmoCrmCommandDispatch(
      rejectedPrepared.attempt.attemptId,
      rejectedInput.authorization,
    );
    const rejectedAt = timestampAtOrAfter(
      rejectedClaimed.attempt.providerDispatchedAt,
    );
    const rejected = await settleCanonicalAmoCrmCommand(
      rejectedPrepared.attempt.attemptId,
      rejectedInput.authorization,
      {
        status: "rejected",
        providerHttpStatus: 422,
        providerRequestId: "rejected-request-id",
        providerRespondedAt: rejectedAt,
        failureCode: "provider_validation_rejected",
        providerReadback: { error: "validation" },
        providerReadbackAt: rejectedAt,
      },
    );
    assert.equal(rejected.attempt.status, "rejected");
    assert.equal(rejected.attempt.resultLeadId, null);

    const [counts] = await sql`
      select
        (select count(*)::int
          from evo_amocrm_lead_bindings
          where account_id = ${accountId}
            and lead_id = ${unknownLead.leadId}
            and provider_lead_id = '700021') as reconciled_binding_count,
        (select count(*)::int
          from evo_amocrm_lead_bindings
          where account_id = ${accountId}
            and lead_id = ${rejectedLead.leadId}) as rejected_binding_count,
        (select status
          from evo_command_receipts
          where id = ${rejectedPrepared.attempt.commandReceiptId}) as rejected_receipt_status
    `;
    assert.deepEqual(counts, {
      reconciled_binding_count: 1,
      rejected_binding_count: 0,
      rejected_receipt_status: "failed",
    });
  } finally {
    await closeDatabaseConnections();
    await sql.end({ timeout: 5 });
  }
});

test("a claimed prepared attempt enters durable unknown reconciliation without another dispatch", async () => {
  const sql = postgres(requiredDatabaseUrl(), {
    idle_timeout: 5,
    max: 4,
    onnotice: () => undefined,
  });
  const runId = randomUUID();
  try {
    const accountId = await createAccount(sql, runId);
    const lead = await createLead(runId, "claimed-prepared-reconcile");
    const context = commandContext("sales");
    const input = leadCreateInput(accountId, lead, context, {
      name: "Claimed prepared technical lead",
    });
    const prepared = await prepareCanonicalAmoCrmCommand(input);
    await claimCanonicalAmoCrmCommandDispatch(
      prepared.attempt.attemptId,
      input.authorization,
    );

    const reconciled = await reconcileUnknownCanonicalAmoCrmCommand(
      prepared.attempt.attemptId,
      input.authorization,
      {
        status: "still_unknown",
        failureCode: "reconciliation_target_unavailable",
      },
    );

    assert.equal(reconciled.kind, "unchanged");
    assert.equal(reconciled.attempt.status, "unknown");
    assert.equal(
      reconciled.attempt.failureCode,
      "reconciliation_target_unavailable",
    );
    assert.ok(reconciled.attempt.lastReconciledAt);

    const [state] = await sql`
      select
        (select count(*)::int from evo_amocrm_lead_bindings
          where account_id = ${accountId} and lead_id = ${lead.leadId}) as binding_count,
        (select status from evo_command_receipts
          where id = ${prepared.attempt.commandReceiptId}) as receipt_status
    `;
    assert.deepEqual(state, {
      binding_count: 0,
      receipt_status: "processing",
    });
  } finally {
    await closeDatabaseConnections();
    await sql.end({ timeout: 5 });
  }
});

test("Admissions can reconcile the exact unresolved Sales attempt after canonical handoff without cross-lead access", async () => {
  const sql = postgres(requiredDatabaseUrl(), {
    idle_timeout: 5,
    max: 4,
    onnotice: () => undefined,
  });
  const runId = randomUUID();
  try {
    const accountId = await createAccount(sql, runId);
    const lead = await createLead(runId, "cross-phase-recovery");
    const salesInput = leadCreateInput(
      accountId,
      lead,
      commandContext("sales"),
      { name: "Cross-phase recovery technical lead" },
    );
    const prepared = await prepareCanonicalAmoCrmCommand(salesInput);
    const activeSalesWorkflow = await updateCanonicalSalesLeadWorkflow(
      commandContext("sales"),
      {
        leadId: lead.leadId,
        expectedVersion: lead.version,
        stage: "qualifying",
        nextAction: "Resolve the technical amoCRM attempt before handoff",
        nextActionAt: "2099-01-01",
      },
    );
    await claimCanonicalAmoCrmCommandDispatch(
      prepared.attempt.attemptId,
      salesInput.authorization,
    );
    await settleCanonicalAmoCrmCommand(
      prepared.attempt.attemptId,
      salesInput.authorization,
      { status: "unknown", failureCode: "transport_timeout" },
    );

    const qualified = await updateCanonicalSalesLeadWorkflow(
      commandContext("admin"),
      {
        leadId: lead.leadId,
        expectedVersion: activeSalesWorkflow.version,
        stage: "qualified",
        qualificationSummary: "Technical qualification for cross-phase recovery",
        nextAction: "Execute the canonical Admin override handoff",
        nextActionAt: "2099-01-01",
      },
    );
    const handoff = await handoffCanonicalLeadToAdmissions({
      ...commandContext("admin"),
      leadId: lead.leadId,
      expectedVersion: qualified.version,
      adminOverride: {
        reason: "Technical Admin override for cross-phase amoCRM recovery",
      },
    });
    assert.equal(handoff.isOverride, true);
    const admissions = admissionsAuthorization(
      lead.leadId,
      handoff.studentCaseId,
    );

    const blocker = await readBlockingCanonicalAmoCrmCommand({
      authorization: admissions,
      personId: lead.personId,
      leadId: lead.leadId,
    });
    assert.equal(blocker?.attemptId, prepared.attempt.attemptId);
    assert.equal(blocker?.status, "unknown");

    const unrelatedLead = await createLead(runId, "unrelated-cross-phase");
    const unrelatedQualified = await updateCanonicalSalesLeadWorkflow(
      commandContext("admin"),
      {
        leadId: unrelatedLead.leadId,
        expectedVersion: unrelatedLead.version,
        stage: "qualified",
        qualificationSummary: "Technical unrelated qualification",
        nextAction: "Execute the unrelated canonical Admin override handoff",
        nextActionAt: "2099-01-01",
      },
    );
    const unrelatedHandoff = await handoffCanonicalLeadToAdmissions({
      ...commandContext("admin"),
      leadId: unrelatedLead.leadId,
      expectedVersion: unrelatedQualified.version,
      adminOverride: {
        reason: "Technical unrelated Admin override",
      },
    });
    await assert.rejects(
      readCanonicalAmoCrmCommand(
        prepared.attempt.attemptId,
        admissionsAuthorization(
          unrelatedLead.leadId,
          unrelatedHandoff.studentCaseId,
        ),
      ),
      repositoryError("forbidden"),
    );
    await assert.rejects(
      readCanonicalAmoCrmCommand(
        prepared.attempt.attemptId,
        admissionsAuthorization(lead.leadId, handoff.studentCaseId, "sales"),
      ),
      repositoryError("forbidden"),
    );
    await assert.rejects(
      readCanonicalAmoCrmCommand(
        prepared.attempt.attemptId,
        salesAuthorization(lead.leadId),
      ),
      repositoryError("forbidden"),
    );

    const reconciledAt = timestampAtOrAfter(blocker.providerDispatchedAt);
    const acceptedOutcome = {
      status: "accepted",
      providerHttpStatus: 200,
      providerRequestId: "cross-phase-readback-request-id",
      providerRespondedAt: reconciledAt,
      providerReadback: { id: 700041, marker: "cross-phase-exact-marker" },
      providerReadbackAt: reconciledAt,
      resultContactId: null,
      resultLeadId: "700041",
      providerUpdatedAt: reconciledAt,
    };
    const reconciled = await reconcileUnknownCanonicalAmoCrmCommand(
      prepared.attempt.attemptId,
      admissions,
      acceptedOutcome,
    );
    assert.equal(reconciled.kind, "reconciled");
    assert.equal(reconciled.attempt.attemptId, prepared.attempt.attemptId);
    assert.equal(reconciled.attempt.status, "accepted");
    const replayed = await reconcileUnknownCanonicalAmoCrmCommand(
      prepared.attempt.attemptId,
      admissions,
      acceptedOutcome,
    );
    assert.equal(replayed.kind, "replay");
    assert.equal(replayed.attempt.attemptId, prepared.attempt.attemptId);
    await assert.rejects(
      reconcileUnknownCanonicalAmoCrmCommand(
        prepared.attempt.attemptId,
        admissions,
        {
          ...acceptedOutcome,
          providerRequestId: "different-cross-phase-readback-request-id",
        },
      ),
      repositoryError("forbidden"),
    );
    assert.equal(
      await readBlockingCanonicalAmoCrmCommand({
        authorization: admissions,
        personId: lead.personId,
        leadId: lead.leadId,
      }),
      null,
    );
  } finally {
    await closeDatabaseConnections();
    await sql.end({ timeout: 5 });
  }
});

test("concurrent exact prepare creates one durable attempt and returns one replay", async () => {
  const sql = postgres(requiredDatabaseUrl(), {
    idle_timeout: 5,
    max: 4,
    onnotice: () => undefined,
  });
  const runId = randomUUID();
  try {
    const accountId = await createAccount(sql, runId);
    const lead = await createLead(runId, "parallel");
    const input = leadCreateInput(accountId, lead, commandContext("sales"), {
      name: "Parallel technical lead",
    });
    const results = await Promise.all([
      prepareCanonicalAmoCrmCommand(input),
      prepareCanonicalAmoCrmCommand(input),
    ]);
    assert.equal(results.filter((result) => result.kind === "prepared").length, 1);
    assert.equal(results.filter((result) => result.kind === "replay").length, 1);
    assert.equal(results[0].attempt.attemptId, results[1].attempt.attemptId);
    assert.equal(results[0].attempt.commandReceiptId, results[1].attempt.commandReceiptId);

    const [counts] = await sql`
      select
        (select count(*)::int from evo_amocrm_operation_attempts
          where idempotency_key = ${input.idempotencyKey}) as attempt_count,
        (select count(*)::int from evo_command_receipts
          where idempotency_key = ${input.idempotencyKey}) as receipt_count
    `;
    assert.deepEqual(counts, { attempt_count: 1, receipt_count: 1 });
  } finally {
    await closeDatabaseConnections();
    await sql.end({ timeout: 5 });
  }
});

test("concurrent different commands for one provider object fail closed behind an object lock", async () => {
  const sql = postgres(requiredDatabaseUrl(), {
    idle_timeout: 5,
    max: 4,
    onnotice: () => undefined,
  });
  const runId = randomUUID();
  try {
    const accountId = await createAccount(sql, runId);
    const lead = await createLead(runId, "object-lock");
    const firstInput = leadCreateInput(accountId, lead, commandContext("sales"), {
      name: "First object command",
    });
    const secondInput = leadCreateInput(accountId, lead, commandContext("sales"), {
      name: "Second object command",
    });
    const results = await Promise.allSettled([
      prepareCanonicalAmoCrmCommand(firstInput),
      prepareCanonicalAmoCrmCommand(secondInput),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(repositoryError("state_conflict")(rejected[0].reason));

    const [counts] = await sql`
      select
        (select count(*)::int from evo_amocrm_operation_attempts
          where account_id = ${accountId} and lead_id = ${lead.leadId}) as attempt_count,
        (select count(*)::int from evo_command_receipts
          where business_object_id = ${lead.leadId}
            and command_name = 'amocrm.lead_create') as receipt_count
    `;
    assert.deepEqual(counts, { attempt_count: 1, receipt_count: 1 });
  } finally {
    await closeDatabaseConnections();
    await sql.end({ timeout: 5 });
  }
});

test("role authorization is phase-bound and admin still needs the exact workflow phase", async () => {
  const sql = postgres(requiredDatabaseUrl(), {
    idle_timeout: 5,
    max: 4,
    onnotice: () => undefined,
  });
  const runId = randomUUID();
  try {
    const accountId = await createAccount(sql, runId);
    const lead = await createLead(runId, "authorization");

    await assert.rejects(
      prepareCanonicalAmoCrmCommand({
        ...leadCreateInput(accountId, lead, commandContext("admissions")),
        authorization: salesAuthorization(lead.leadId, "admissions"),
      }),
      repositoryError("forbidden"),
    );

    const adminContext = commandContext("admin");
    const preHandoffInput = {
      ...leadCreateInput(accountId, lead, adminContext, {
        name: "Admin pre-handoff technical lead",
      }),
      authorization: salesAuthorization(lead.leadId, "admin"),
    };
    const preHandoff = await prepareCanonicalAmoCrmCommand(preHandoffInput);
    assert.equal(preHandoff.attempt.workflowScope, "sales_pre_handoff");

    const secondLead = await createLead(runId, "post-handoff");
    const studentCaseId = await createActiveHandoff(sql, secondLead, runId);
    await assert.rejects(
      prepareCanonicalAmoCrmCommand(
        leadCreateInput(accountId, secondLead, commandContext("sales"), {
          name: "Sales after handoff must fail",
        }),
      ),
      repositoryError("forbidden"),
    );

    const admissionsContext = commandContext("admissions");
    const admissionsInput = {
      ...leadCreateInput(accountId, secondLead, admissionsContext, {
        name: "Admissions post-handoff technical lead",
      }),
      authorization: admissionsAuthorization(
        secondLead.leadId,
        studentCaseId,
        "admissions",
      ),
    };
    const postHandoff = await prepareCanonicalAmoCrmCommand(admissionsInput);
    assert.equal(postHandoff.attempt.workflowScope, "admissions_post_handoff");
    assert.equal(postHandoff.attempt.studentCaseId, studentCaseId);
    assert.deepEqual(
      await readCanonicalAmoCrmBindings({
        accountId,
        authorization: admissionsInput.authorization,
        personId: secondLead.personId,
        leadId: secondLead.leadId,
      }),
      { contactId: null, leadId: null },
    );

    await assert.rejects(
      readCanonicalAmoCrmCommand(
        postHandoff.attempt.attemptId,
        admissionsAuthorization(secondLead.leadId, randomUUID(), "admin"),
      ),
      repositoryError("forbidden"),
    );
    await assert.rejects(
      readCanonicalAmoCrmBindings({
        accountId,
        authorization: admissionsAuthorization(
          secondLead.leadId,
          randomUUID(),
          "admin",
        ),
        personId: secondLead.personId,
        leadId: secondLead.leadId,
      }),
      repositoryError("forbidden"),
    );

    await sql`
      update evo_student_cases
      set status = 'paused', version = version + 1, updated_at = now()
      where id = ${studentCaseId}
    `;
    await assert.rejects(
      readCanonicalAmoCrmCommand(
        postHandoff.attempt.attemptId,
        admissionsAuthorization(secondLead.leadId, studentCaseId, "admin"),
      ),
      repositoryError("forbidden"),
    );
    await assert.rejects(
      readCanonicalAmoCrmBindings({
        accountId,
        authorization: admissionsAuthorization(
          secondLead.leadId,
          studentCaseId,
          "admin",
        ),
        personId: secondLead.personId,
        leadId: secondLead.leadId,
      }),
      repositoryError("forbidden"),
    );
  } finally {
    await closeDatabaseConnections();
    await sql.end({ timeout: 5 });
  }
});

test("PostgreSQL failure is unavailable and never falls back to another authority", async () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  await closeDatabaseConnections();
  process.env.DATABASE_URL =
    "postgresql://evo:technical-password@127.0.0.1:1/evo_unreachable";
  try {
    await assert.rejects(
      readCanonicalAmoCrmCommand(
        randomUUID(),
        salesAuthorization(randomUUID(), "admin"),
      ),
      repositoryError("unavailable"),
    );
    await assert.rejects(
      readCanonicalAmoCrmCommandByIdempotencyKey(
        randomUUID(),
        salesAuthorization(randomUUID(), "admin"),
      ),
      repositoryError("unavailable"),
    );
  } finally {
    await closeDatabaseConnections();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});
