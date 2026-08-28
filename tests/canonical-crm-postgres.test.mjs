import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import test from "node:test";

import postgres from "postgres";

import {
  CanonicalCrmRepositoryError,
  appendCanonicalInboundMessage,
  assertCanonicalFinanceStop,
  createCanonicalAdmissionsTask,
  createCanonicalUniversityApplication,
  createCanonicalPersonLead,
  getCanonicalAdmissionsOperationsSnapshot,
  getCanonicalLeadConversationThread,
  getCanonicalLeadGateSnapshot,
  getCanonicalStudentCaseHandoffSnapshot,
  handoffCanonicalLeadToAdmissions,
  listCanonicalAdmissionsTasks,
  listCanonicalFinanceStops,
  listCanonicalLeadConversations,
  listCanonicalSalesLeads,
  listCanonicalStudentCases,
  listCanonicalUniversityApplications,
  listCanonicalVisaMilestones,
  receiveCanonicalWhatsAppInbound,
  recordCanonicalSalesGateEvidence,
  releaseCanonicalFinanceStop,
  transitionCanonicalAdmissionsTask,
  transitionCanonicalUniversityApplication,
  transitionCanonicalVisaMilestone,
  updateCanonicalUniversityApplication,
  updateCanonicalSalesLeadWorkflow,
} from "../src/lib/server/canonical-crm-repository.ts";
import { closeDatabaseConnections } from "../src/lib/server/database.ts";

function requiredDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  assert.ok(value, "DATABASE_URL is required for canonical CRM PostgreSQL acceptance");

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    assert.fail("DATABASE_URL must be a valid PostgreSQL URL");
  }
  assert.ok(
    parsed.protocol === "postgres:" || parsed.protocol === "postgresql:",
    "DATABASE_URL must use PostgreSQL; no alternate database path is accepted",
  );
  return value;
}

function repositoryError(code) {
  return (error) =>
    error instanceof CanonicalCrmRepositoryError &&
    error.code === code &&
    error.message === "Canonical CRM operation failed.";
}

async function expectPostgresError(operation, code) {
  await assert.rejects(operation, (error) => error?.code === code);
}

function commandContext(runId, name, actorRole = "sales") {
  return {
    actorRole,
    correlationId: `acceptance:${runId}:${name}`,
    idempotencyKey: `acceptance:${runId}:${name}`,
  };
}

function technicalCommandContext(runId, name, actorRole = "sales") {
  return {
    actorRole,
    correlationId: `technical:${runId}:${name}`,
    idempotencyKey: `technical:${runId}:${name}`,
  };
}

test("canonical CRM commands and constraints hold on real PostgreSQL", async () => {
  const databaseUrl = requiredDatabaseUrl();
  const sql = postgres(databaseUrl, {
    idle_timeout: 5,
    max: 1,
    onnotice: () => undefined,
  });
  const runId = randomUUID();
  const occurredAt = "2026-08-28T12:00:00.000Z";

  try {
    const leadInput = {
      ...commandContext(runId, "lead"),
      displayName: `technical-subject-${runId}`,
      email: `${runId}@acceptance.invalid`,
      source: `technical-source-${runId}`,
    };
    const lead = await createCanonicalPersonLead(leadInput);
    const leadReplay = await createCanonicalPersonLead(leadInput);
    assert.equal(leadReplay.leadId, lead.leadId);
    assert.equal(leadReplay.personId, lead.personId);

    const inboundInput = {
      ...commandContext(runId, "inbound"),
      leadId: lead.leadId,
      channel: "whatsapp",
      externalConversationId: `technical-conversation-${runId}`,
      externalMessageId: `technical-message-${runId}`,
      body: `technical-inbound-${runId}`,
      occurredAt,
    };
    await assert.rejects(
      appendCanonicalInboundMessage({
        ...inboundInput,
        idempotencyKey: leadInput.idempotencyKey,
      }),
      repositoryError("idempotency_conflict"),
    );
    const inbound = await appendCanonicalInboundMessage(inboundInput);
    const inboundEventCountBeforeReplay = Number(
      (
        await sql`
          select count(*)::int as count
          from evo_business_events
          where idempotency_key = ${inboundInput.idempotencyKey}
        `
      )[0].count,
    );
    const inboundReplay = await appendCanonicalInboundMessage(inboundInput);
    const inboundEventCountAfterReplay = Number(
      (
        await sql`
          select count(*)::int as count
          from evo_business_events
          where idempotency_key = ${inboundInput.idempotencyKey}
        `
      )[0].count,
    );
    assert.equal(inboundReplay.conversationId, inbound.conversationId);
    assert.equal(inboundReplay.messageId, inbound.messageId);
    assert.ok(inboundEventCountBeforeReplay > 0);
    assert.equal(inboundEventCountAfterReplay, inboundEventCountBeforeReplay);

    const naturalDuplicate = await appendCanonicalInboundMessage({
      ...inboundInput,
      ...commandContext(runId, "inbound-natural-duplicate"),
    });
    assert.equal(naturalDuplicate.conversationId, inbound.conversationId);
    assert.equal(naturalDuplicate.messageId, inbound.messageId);

    await assert.rejects(
      appendCanonicalInboundMessage({
        ...inboundInput,
        body: `different-technical-payload-${runId}`,
      }),
      repositoryError("idempotency_conflict"),
    );

    const laterInbound = await appendCanonicalInboundMessage({
      ...commandContext(runId, "inbound-later"),
      leadId: lead.leadId,
      channel: "whatsapp",
      externalConversationId: inboundInput.externalConversationId,
      externalMessageId: `technical-message-later-${runId}`,
      body: `technical-inbound-later-${runId}`,
      occurredAt: "2026-08-28T12:01:00.000Z",
    });
    assert.equal(laterInbound.conversationId, inbound.conversationId);

    const conversations = await listCanonicalLeadConversations({
      actorRole: "sales",
      leadId: lead.leadId,
    });
    assert.deepEqual(
      conversations.map((conversation) => ({
        conversationId: conversation.conversationId,
        leadId: conversation.leadId,
        channel: conversation.channel,
        status: conversation.status,
      })),
      [
        {
          conversationId: inbound.conversationId,
          leadId: lead.leadId,
          channel: "whatsapp",
          status: "open",
        },
      ],
    );

    const firstMessagePage = await getCanonicalLeadConversationThread({
      actorRole: "admin",
      leadId: lead.leadId,
      conversationId: inbound.conversationId,
      pageSize: 1,
    });
    assert.equal(firstMessagePage.conversation.leadId, lead.leadId);
    assert.equal(firstMessagePage.messages.length, 1);
    assert.equal(
      firstMessagePage.messages[0].body,
      `technical-inbound-later-${runId}`,
    );
    assert.equal(firstMessagePage.hasNext, true);
    assert.deepEqual(firstMessagePage.nextCursor, {
      occurredAt: "2026-08-28T12:01:00.000Z",
      id: laterInbound.messageId,
    });

    const secondMessagePage = await getCanonicalLeadConversationThread({
      actorRole: "sales",
      leadId: lead.leadId,
      conversationId: inbound.conversationId,
      cursor: firstMessagePage.nextCursor,
      pageSize: 1,
    });
    assert.equal(secondMessagePage.messages.length, 1);
    assert.equal(secondMessagePage.messages[0].body, inboundInput.body);
    assert.equal(secondMessagePage.hasNext, false);
    assert.equal(secondMessagePage.nextCursor, null);

    const decimalRunId = runId.replace(/\D/g, "").padEnd(12, "0").slice(0, 12);
    const conflictSeedLead = await createCanonicalPersonLead({
      ...technicalCommandContext(runId, "atomic-conflict-seed"),
      displayName: `atomic-conflict-seed-${runId}`,
      email: `atomic-conflict-seed-${runId}@acceptance.invalid`,
      source: `technical-atomic-conflict-${runId}`,
    });
    const conflictingConversationExternalId =
      `technical-atomic-conflict-conversation-${runId}`;
    await sql`
      insert into evo_conversations (
        id,
        lead_id,
        channel,
        external_conversation_id,
        status,
        owning_role
      ) values (
        ${randomUUID()},
        ${conflictSeedLead.leadId},
        'whatsapp',
        ${conflictingConversationExternalId},
        'open',
        'sales'
      )
    `;
    const [countsBeforeAtomicConflict] = await sql`
      select
        (select count(*)::int from evo_people) as people,
        (select count(*)::int from evo_leads) as leads,
        (select count(*)::int from evo_business_events) as events,
        (select count(*)::int from evo_command_receipts) as receipts
    `;
    await assert.rejects(
      receiveCanonicalWhatsAppInbound({
        ...technicalCommandContext(runId, "atomic-conflict"),
        displayName: `atomic-conflicting-identity-${runId}`,
        phone: `+997${decimalRunId}`,
        externalConversationId: conflictingConversationExternalId,
        externalMessageId: `technical-atomic-conflict-message-${runId}`,
        body: `technical-atomic-conflict-body-${runId}`,
        occurredAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      repositoryError("conflict"),
    );
    const [countsAfterAtomicConflict] = await sql`
      select
        (select count(*)::int from evo_people) as people,
        (select count(*)::int from evo_leads) as leads,
        (select count(*)::int from evo_business_events) as events,
        (select count(*)::int from evo_command_receipts) as receipts
    `;
    assert.deepEqual(
      countsAfterAtomicConflict,
      countsBeforeAtomicConflict,
      "a conversation/identity conflict must roll back the person, lead, events and receipt",
    );

    const atomicPhone = `+998${decimalRunId}`;
    const atomicOccurredAt = new Date(Date.now() + 10 * 60_000);
    const intermediateAtomicOccurredAt = new Date(
      atomicOccurredAt.getTime() + 30_000,
    );
    const laterAtomicOccurredAt = new Date(atomicOccurredAt.getTime() + 60_000);
    const olderAtomicOccurredAt = new Date(atomicOccurredAt.getTime() - 60_000);
    const atomicInboundInput = {
      ...technicalCommandContext(runId, "atomic-inbound"),
      displayName: `atomic-order-${runId}-primary`,
      phone: atomicPhone,
      externalConversationId: `technical-atomic-conversation-${runId}`,
      externalMessageId: `technical-atomic-message-${runId}`,
      body: `technical-atomic-body-${runId}`,
      occurredAt: atomicOccurredAt.toISOString(),
    };
    const atomicInbound =
      await receiveCanonicalWhatsAppInbound(atomicInboundInput);

    const readAtomicRecency = async () => {
      const [snapshot] = await sql`
        select
          lead.version as lead_version,
          to_char(
            lead.updated_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ) as lead_updated_at,
          conversation.version as conversation_version,
          to_char(
            conversation.updated_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ) as conversation_updated_at
        from evo_leads lead
        join evo_conversations conversation on conversation.lead_id = lead.id
        where lead.id = ${atomicInbound.leadId}
          and conversation.id = ${atomicInbound.conversationId}
      `;
      assert.ok(snapshot, "atomic inbound lead/conversation recency must exist");
      return {
        leadVersion: Number(snapshot.lead_version),
        leadUpdatedAt: snapshot.lead_updated_at,
        conversationVersion: Number(snapshot.conversation_version),
        conversationUpdatedAt: snapshot.conversation_updated_at,
      };
    };

    assert.deepEqual(await readAtomicRecency(), {
      leadVersion: 1,
      leadUpdatedAt: atomicOccurredAt.toISOString(),
      conversationVersion: 1,
      conversationUpdatedAt: atomicOccurredAt.toISOString(),
    });

    const secondAtomicConversation = await receiveCanonicalWhatsAppInbound({
      ...atomicInboundInput,
      ...technicalCommandContext(runId, "atomic-inbound-second-conversation"),
      externalConversationId:
        `technical-atomic-conversation-second-${runId}`,
      externalMessageId: `technical-atomic-message-second-${runId}`,
      body: `technical-atomic-body-second-${runId}`,
      occurredAt: intermediateAtomicOccurredAt.toISOString(),
    });
    assert.equal(secondAtomicConversation.leadId, atomicInbound.leadId);
    assert.notEqual(
      secondAtomicConversation.conversationId,
      atomicInbound.conversationId,
    );

    const laterAtomicInbound = await receiveCanonicalWhatsAppInbound({
      ...atomicInboundInput,
      ...technicalCommandContext(runId, "atomic-inbound-later"),
      externalMessageId: `technical-atomic-message-later-${runId}`,
      body: `technical-atomic-body-later-${runId}`,
      occurredAt: laterAtomicOccurredAt.toISOString(),
    });
    assert.equal(laterAtomicInbound.leadId, atomicInbound.leadId);
    assert.equal(laterAtomicInbound.conversationId, atomicInbound.conversationId);
    const laterAtomicRecency = await readAtomicRecency();
    assert.deepEqual(laterAtomicRecency, {
      leadVersion: 1,
      leadUpdatedAt: laterAtomicOccurredAt.toISOString(),
      conversationVersion: 1,
      conversationUpdatedAt: laterAtomicOccurredAt.toISOString(),
    });

    const orderedAtomicConversations = await listCanonicalLeadConversations({
      actorRole: "sales",
      leadId: atomicInbound.leadId,
      pageSize: 10,
    });
    assert.deepEqual(
      orderedAtomicConversations
        .slice(0, 2)
        .map((conversation) => conversation.conversationId),
      [atomicInbound.conversationId, secondAtomicConversation.conversationId],
      "the conversation touched by the later provider message must sort first",
    );

    const comparisonAtomicLead = await receiveCanonicalWhatsAppInbound({
      ...technicalCommandContext(runId, "atomic-inbound-comparison-lead"),
      displayName: `atomic-order-${runId}-secondary`,
      phone: `+999${decimalRunId}`,
      externalConversationId:
        `technical-atomic-comparison-conversation-${runId}`,
      externalMessageId: `technical-atomic-comparison-message-${runId}`,
      body: `technical-atomic-comparison-body-${runId}`,
      occurredAt: intermediateAtomicOccurredAt.toISOString(),
    });
    const orderedAtomicLeads = await listCanonicalSalesLeads({
      actorRole: "sales",
      query: `atomic-order-${runId}`,
      pageSize: 10,
    });
    assert.deepEqual(
      orderedAtomicLeads.rows.slice(0, 2).map((row) => row.leadId),
      [atomicInbound.leadId, comparisonAtomicLead.leadId],
      "the lead touched by the later provider message must sort first",
    );

    const exactAtomicReplay =
      await receiveCanonicalWhatsAppInbound(atomicInboundInput);
    assert.deepEqual(exactAtomicReplay, atomicInbound);
    assert.deepEqual(await readAtomicRecency(), laterAtomicRecency);

    const naturalAtomicDuplicate = await receiveCanonicalWhatsAppInbound({
      ...atomicInboundInput,
      ...technicalCommandContext(runId, "atomic-inbound-natural-duplicate"),
    });
    assert.deepEqual(naturalAtomicDuplicate, atomicInbound);
    assert.deepEqual(await readAtomicRecency(), laterAtomicRecency);

    const olderAtomicInbound = await receiveCanonicalWhatsAppInbound({
      ...atomicInboundInput,
      ...technicalCommandContext(runId, "atomic-inbound-older"),
      externalMessageId: `technical-atomic-message-older-${runId}`,
      body: `technical-atomic-body-older-${runId}`,
      occurredAt: olderAtomicOccurredAt.toISOString(),
    });
    assert.equal(olderAtomicInbound.leadId, atomicInbound.leadId);
    assert.equal(olderAtomicInbound.conversationId, atomicInbound.conversationId);
    assert.deepEqual(await readAtomicRecency(), laterAtomicRecency);

    const [atomicIdentityCounts] = await sql`
      select
        count(distinct person.id)::int as people,
        count(distinct lead.id)::int as whatsapp_leads
      from evo_people person
      join evo_leads lead on lead.person_id = person.id
      where person.phone_e164 = ${atomicPhone}
        and lead.source = 'whatsapp'
    `;
    assert.deepEqual(atomicIdentityCounts, {
      people: 1,
      whatsapp_leads: 1,
    });

    const unrelatedLead = await createCanonicalPersonLead({
      ...technicalCommandContext(runId, "unrelated-lead"),
      displayName: `unrelated-technical-subject-${runId}`,
      email: `unrelated-${runId}@acceptance.invalid`,
      source: `technical-source-${runId}`,
    });
    await assert.rejects(
      getCanonicalLeadConversationThread({
        actorRole: "sales",
        leadId: unrelatedLead.leadId,
        conversationId: inbound.conversationId,
      }),
      repositoryError("not_found"),
    );

    await assert.rejects(
      handoffCanonicalLeadToAdmissions({
        ...commandContext(runId, "handoff-before-qualified"),
        leadId: lead.leadId,
        expectedVersion: lead.version,
      }),
      repositoryError("conflict"),
    );
    const preQualifiedCaseCount = Number(
      (
        await sql`
          select count(*)::int as count
          from evo_student_cases
          where lead_id = ${lead.leadId}
        `
      )[0].count,
    );
    assert.equal(preQualifiedCaseCount, 0);

    const qualifiedLead = await updateCanonicalSalesLeadWorkflow(
      technicalCommandContext(runId, "qualified-before-gate"),
      {
        leadId: lead.leadId,
        expectedVersion: lead.version,
        stage: "qualified",
        qualificationSummary: "Technical qualification before gate",
        nextAction: "Complete the technical handoff gate",
        nextActionAt: "2026-08-29",
      },
    );
    assert.equal(qualifiedLead.stage, "qualified");
    assert.equal(qualifiedLead.nextActionAt, "2026-08-29T03:00:00.000Z");

    await assert.rejects(
      handoffCanonicalLeadToAdmissions({
        ...commandContext(runId, "handoff-before-gate"),
        leadId: lead.leadId,
        expectedVersion: qualifiedLead.version,
      }),
      repositoryError("gate_unsatisfied"),
    );
    const preGateCaseCount = Number(
      (
        await sql`
          select count(*)::int as count
          from evo_student_cases
          where lead_id = ${lead.leadId}
        `
      )[0].count,
    );
    assert.equal(preGateCaseCount, 0);

    const contractInput = {
      ...commandContext(runId, "contract"),
      leadId: lead.leadId,
      evidenceType: "contract",
      decision: "confirmed",
      evidenceReference: `technical-contract-${runId}`,
      occurredAt,
    };
    const contract = await recordCanonicalSalesGateEvidence(contractInput);
    const contractReplay = await recordCanonicalSalesGateEvidence(contractInput);
    assert.equal(contractReplay.evidenceId, contract.evidenceId);

    const paymentInput = {
      ...commandContext(runId, "first-payment"),
      leadId: lead.leadId,
      evidenceType: "first_payment",
      decision: "confirmed",
      evidenceReference: `technical-payment-${runId}`,
      amountMinor: 1,
      currency: "USD",
      occurredAt,
    };
    const payment = await recordCanonicalSalesGateEvidence(paymentInput);
    const paymentReplay = await recordCanonicalSalesGateEvidence(paymentInput);
    assert.equal(paymentReplay.evidenceId, payment.evidenceId);

    const satisfiedGate = await getCanonicalLeadGateSnapshot({
      actorRole: "sales",
      leadId: lead.leadId,
    });
    assert.equal(satisfiedGate.state, "satisfied");
    assert.equal(satisfiedGate.normalHandoffAllowed, true);
    assert.equal(satisfiedGate.exceptionalHandoffAllowed, false);
    assert.equal(satisfiedGate.contractEvidence?.evidenceId, contract.evidenceId);
    assert.equal(
      satisfiedGate.firstPaymentEvidence?.evidenceId,
      payment.evidenceId,
    );

    await assert.rejects(
      handoffCanonicalLeadToAdmissions({
        ...commandContext(runId, "handoff-stale-version"),
        leadId: lead.leadId,
        expectedVersion: qualifiedLead.version - 1,
      }),
      repositoryError("conflict"),
    );

    const handoffInput = {
      ...commandContext(runId, "handoff"),
      leadId: lead.leadId,
      expectedVersion: qualifiedLead.version,
    };
    const handoff = await handoffCanonicalLeadToAdmissions(handoffInput);
    const handoffEventCountBeforeReplay = Number(
      (
        await sql`
          select count(*)::int as count
          from evo_business_events
          where idempotency_key = ${handoffInput.idempotencyKey}
        `
      )[0].count,
    );
    const handoffReplay = await handoffCanonicalLeadToAdmissions(handoffInput);
    const handoffEventCountAfterReplay = Number(
      (
        await sql`
          select count(*)::int as count
          from evo_business_events
          where idempotency_key = ${handoffInput.idempotencyKey}
        `
      )[0].count,
    );
    assert.equal(handoffReplay.handoffId, handoff.handoffId);
    assert.equal(handoffReplay.studentCaseId, handoff.studentCaseId);
    assert.ok(handoffEventCountBeforeReplay > 0);
    assert.equal(handoffEventCountAfterReplay, handoffEventCountBeforeReplay);
    const normalHandoffEvents = await sql`
      select
        transition,
        event_sequence as "eventSequence",
        business_object_type as "businessObjectType",
        business_object_id as "businessObjectId"
      from evo_business_events
      where idempotency_key = ${handoffInput.idempotencyKey}
      order by event_sequence
    `;
    assert.deepEqual(
      normalHandoffEvents.map((event) => ({
        transition: event.transition,
        eventSequence: event.eventSequence,
      })),
      [
        { transition: "student_case.created", eventSequence: 1 },
        { transition: "task.created", eventSequence: 2 },
        { transition: "task.created", eventSequence: 3 },
        { transition: "task.created", eventSequence: 4 },
        { transition: "visa_milestone.created", eventSequence: 5 },
        { transition: "visa_milestone.created", eventSequence: 6 },
        { transition: "visa_milestone.created", eventSequence: 7 },
        { transition: "visa_milestone.created", eventSequence: 8 },
        { transition: "visa_milestone.created", eventSequence: 9 },
        { transition: "visa_milestone.created", eventSequence: 10 },
        { transition: "sales_admissions.handed_off", eventSequence: 11 },
      ],
    );
    assert.equal(normalHandoffEvents[0].businessObjectType, "student_case");
    assert.equal(normalHandoffEvents[0].businessObjectId, handoff.studentCaseId);
    assert.ok(
      normalHandoffEvents.slice(1, 4).every(
        (event) => event.businessObjectType === "task",
      ),
    );
    assert.ok(
      normalHandoffEvents.slice(4, 10).every(
        (event) => event.businessObjectType === "visa_milestone",
      ),
    );
    assert.equal(normalHandoffEvents[10].businessObjectType, "handoff");
    assert.equal(normalHandoffEvents[10].businessObjectId, handoff.handoffId);

    const handedOffGate = await getCanonicalLeadGateSnapshot({
      actorRole: "admin",
      leadId: lead.leadId,
    });
    assert.equal(handedOffGate.state, "satisfied");
    assert.equal(handedOffGate.normalHandoffAllowed, false);
    assert.equal(handedOffGate.handoff?.handoffId, handoff.handoffId);

    const admissionsHandoff = await getCanonicalStudentCaseHandoffSnapshot({
      actorRole: "admissions",
      studentCaseId: handoff.studentCaseId,
    });
    assert.equal(admissionsHandoff.handoff.handoffId, handoff.handoffId);
    assert.equal(admissionsHandoff.handoff.isOverride, false);
    assert.equal(admissionsHandoff.starterTasks.length, 3);
    assert.deepEqual(
      new Set(admissionsHandoff.starterTasks.map((task) => task.title)),
      new Set([
        "Проверить унаследованный контекст Sales",
        "Подтвердить маршрут обучения и недостающие данные",
        "Подготовить первичный план запроса документов",
      ]),
    );
    assert.ok(
      admissionsHandoff.starterTasks.every((task) => task.status === "open"),
    );
    await assert.rejects(
      getCanonicalStudentCaseHandoffSnapshot({
        actorRole: "sales",
        studentCaseId: handoff.studentCaseId,
      }),
      repositoryError("forbidden"),
    );

    const initialAdmissionsTasks = await listCanonicalAdmissionsTasks({
      actorRole: "admissions",
      studentCaseId: handoff.studentCaseId,
      pageSize: 50,
    });
    assert.equal(initialAdmissionsTasks.rows.length, 3);
    assert.equal(initialAdmissionsTasks.hasNext, false);
    assert.ok(
      initialAdmissionsTasks.rows.every(
        (task) =>
          task.studentCaseId === handoff.studentCaseId &&
          task.studentCaseStatus === "active" &&
          task.displayName === leadInput.displayName &&
          task.email === leadInput.email &&
          task.phone === null &&
          task.assignedRole === "admissions" &&
          task.status === "open" &&
          task.version === 1 &&
          task.closedAt === null &&
          task.closedByRole === null &&
          task.closureReason === null,
      ),
    );
    const boundedAdmissionsTasks = await listCanonicalAdmissionsTasks({
      actorRole: "admin",
      studentCaseId: handoff.studentCaseId,
      pageSize: 2,
    });
    const boundedAdmissionsTasksReplay = await listCanonicalAdmissionsTasks({
      actorRole: "admin",
      studentCaseId: handoff.studentCaseId,
      pageSize: 2,
    });
    assert.equal(boundedAdmissionsTasks.rows.length, 2);
    assert.equal(boundedAdmissionsTasks.hasNext, true);
    assert.deepEqual(
      boundedAdmissionsTasksReplay.rows.map((task) => task.taskId),
      boundedAdmissionsTasks.rows.map((task) => task.taskId),
    );

    const createAdmissionsTaskInput = {
      ...commandContext(runId, "admissions-task-create", "admissions"),
      studentCaseId: handoff.studentCaseId,
      title: `Подготовить техническую задачу ${runId}`,
      details: "Проверить канонический PostgreSQL task workflow.",
      dueAt: "2026-09-15T09:30:00.000Z",
    };
    const createdAdmissionsTask = await createCanonicalAdmissionsTask(
      createAdmissionsTaskInput,
    );
    assert.deepEqual(createdAdmissionsTask, {
      taskId: createdAdmissionsTask.taskId,
      studentCaseId: handoff.studentCaseId,
      status: "open",
      version: 1,
    });
    const createdTaskEventCountBeforeReplay = Number(
      (
        await sql`
          select count(*)::int as count
          from evo_business_events
          where idempotency_key = ${createAdmissionsTaskInput.idempotencyKey}
        `
      )[0].count,
    );
    const createdAdmissionsTaskReplay = await createCanonicalAdmissionsTask(
      createAdmissionsTaskInput,
    );
    const createdTaskEventCountAfterReplay = Number(
      (
        await sql`
          select count(*)::int as count
          from evo_business_events
          where idempotency_key = ${createAdmissionsTaskInput.idempotencyKey}
        `
      )[0].count,
    );
    assert.deepEqual(createdAdmissionsTaskReplay, createdAdmissionsTask);
    assert.equal(createdTaskEventCountBeforeReplay, 1);
    assert.equal(createdTaskEventCountAfterReplay, 1);
    const [createdTaskEvent] = await sql`
      select
        actor_role as "actorRole",
        business_object_type as "businessObjectType",
        business_object_id as "businessObjectId",
        transition,
        from_state as "fromState",
        to_state as "toState",
        reason,
        event_sequence as "eventSequence"
      from evo_business_events
      where idempotency_key = ${createAdmissionsTaskInput.idempotencyKey}
    `;
    assert.deepEqual(createdTaskEvent, {
      actorRole: "admissions",
      businessObjectType: "task",
      businessObjectId: createdAdmissionsTask.taskId,
      transition: "task.created",
      fromState: null,
      toState: "open",
      reason: null,
      eventSequence: 1,
    });
    const [createdTaskDurable] = await sql`
      select
        student_case_id as "studentCaseId",
        title,
        details,
        status,
        assigned_role as "assignedRole",
        to_char(
          due_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) as "dueAt",
        version,
        closed_at as "closedAt",
        closed_by_role as "closedByRole",
        closure_reason as "closureReason"
      from evo_admissions_tasks
      where student_case_id = ${handoff.studentCaseId}
        and id = ${createdAdmissionsTask.taskId}
    `;
    assert.deepEqual(createdTaskDurable, {
      studentCaseId: handoff.studentCaseId,
      title: createAdmissionsTaskInput.title,
      details: createAdmissionsTaskInput.details,
      status: "open",
      assignedRole: "admissions",
      dueAt: createAdmissionsTaskInput.dueAt,
      version: 1,
      closedAt: null,
      closedByRole: null,
      closureReason: null,
    });

    const admissionsTasksAfterCreate = await listCanonicalAdmissionsTasks({
      actorRole: "admissions",
      studentCaseId: handoff.studentCaseId,
      pageSize: 50,
    });
    assert.equal(admissionsTasksAfterCreate.rows.length, 4);
    const completeTask = initialAdmissionsTasks.rows[0];
    const completeTaskInput = {
      ...commandContext(runId, "admissions-task-complete", "admissions"),
      taskId: completeTask.taskId,
      expectedVersion: completeTask.version,
      toStatus: "completed",
    };
    const completedTask = await transitionCanonicalAdmissionsTask(
      completeTaskInput,
    );
    assert.deepEqual(completedTask, {
      taskId: completeTask.taskId,
      studentCaseId: handoff.studentCaseId,
      status: "completed",
      version: 2,
    });
    const completedTaskReplay = await transitionCanonicalAdmissionsTask(
      completeTaskInput,
    );
    assert.deepEqual(completedTaskReplay, completedTask);
    const completedTaskEvents = await sql`
      select
        transition,
        from_state as "fromState",
        to_state as "toState",
        reason,
        business_object_id as "businessObjectId"
      from evo_business_events
      where idempotency_key = ${completeTaskInput.idempotencyKey}
    `;
    assert.deepEqual(Array.from(completedTaskEvents), [
      {
        transition: "task.completed",
        fromState: "open",
        toState: "completed",
        reason: null,
        businessObjectId: completeTask.taskId,
      },
    ]);

    const cancelTask = initialAdmissionsTasks.rows[1];
    const cancellationReason = "Задача больше не требуется после сверки кейса.";
    const cancelledTask = await transitionCanonicalAdmissionsTask({
      ...commandContext(runId, "admissions-task-cancel", "admin"),
      taskId: cancelTask.taskId,
      expectedVersion: cancelTask.version,
      toStatus: "cancelled",
      reason: cancellationReason,
    });
    assert.deepEqual(cancelledTask, {
      taskId: cancelTask.taskId,
      studentCaseId: handoff.studentCaseId,
      status: "cancelled",
      version: 2,
    });
    const [closedTaskRows] = await sql`
      select jsonb_agg(
        jsonb_build_object(
          'taskId', id,
          'status', status,
          'version', version,
          'closedAtPresent', closed_at is not null,
          'closedByRole', closed_by_role,
          'closureReason', closure_reason
        ) order by id
      ) as rows
      from evo_admissions_tasks
      where id in (${completeTask.taskId}, ${cancelTask.taskId})
    `;
    assert.deepEqual(
      closedTaskRows.rows,
      [
        {
          taskId: completeTask.taskId,
          status: "completed",
          version: 2,
          closedAtPresent: true,
          closedByRole: "admissions",
          closureReason: null,
        },
        {
          taskId: cancelTask.taskId,
          status: "cancelled",
          version: 2,
          closedAtPresent: true,
          closedByRole: "admin",
          closureReason: cancellationReason,
        },
      ].sort((left, right) => left.taskId.localeCompare(right.taskId)),
    );
    const [cancelledTaskEvent] = await sql`
      select
        transition,
        from_state as "fromState",
        to_state as "toState",
        reason,
        actor_role as "actorRole"
      from evo_business_events
      where idempotency_key = ${`acceptance:${runId}:admissions-task-cancel`}
    `;
    assert.deepEqual(cancelledTaskEvent, {
      transition: "task.cancelled",
      fromState: "open",
      toState: "cancelled",
      reason: cancellationReason,
      actorRole: "admin",
    });

    const staleTaskContext = commandContext(
      runId,
      "admissions-task-stale",
      "admissions",
    );
    await assert.rejects(
      transitionCanonicalAdmissionsTask({
        ...staleTaskContext,
        taskId: createdAdmissionsTask.taskId,
        expectedVersion: createdAdmissionsTask.version + 1,
        toStatus: "completed",
      }),
      repositoryError("conflict"),
    );
    const [staleTaskProof] = await sql`
      select
        task.status,
        task.version,
        (select count(*)::int from evo_business_events where idempotency_key = ${staleTaskContext.idempotencyKey}) as events,
        (select count(*)::int from evo_command_receipts where idempotency_key = ${staleTaskContext.idempotencyKey}) as receipts
      from evo_admissions_tasks task
      where task.id = ${createdAdmissionsTask.taskId}
    `;
    assert.deepEqual(staleTaskProof, {
      status: "open",
      version: 1,
      events: 0,
      receipts: 0,
    });

    const closedTaskContext = commandContext(
      runId,
      "admissions-task-already-closed",
      "admin",
    );
    await assert.rejects(
      transitionCanonicalAdmissionsTask({
        ...closedTaskContext,
        taskId: completedTask.taskId,
        expectedVersion: completedTask.version,
        toStatus: "cancelled",
        reason: "Нельзя повторно закрывать завершенную задачу.",
      }),
      repositoryError("conflict"),
    );
    const [closedTaskConflictProof] = await sql`
      select
        task.status,
        task.version,
        (select count(*)::int from evo_business_events where idempotency_key = ${closedTaskContext.idempotencyKey}) as events,
        (select count(*)::int from evo_command_receipts where idempotency_key = ${closedTaskContext.idempotencyKey}) as receipts
      from evo_admissions_tasks task
      where task.id = ${completedTask.taskId}
    `;
    assert.deepEqual(closedTaskConflictProof, {
      status: "completed",
      version: 2,
      events: 0,
      receipts: 0,
    });

    const inactiveTaskContext = commandContext(
      runId,
      "admissions-task-inactive-case",
      "admissions",
    );
    await sql`
      update evo_student_cases
      set status = 'paused'
      where id = ${handoff.studentCaseId}
    `;
    try {
      await assert.rejects(
        createCanonicalAdmissionsTask({
          ...inactiveTaskContext,
          studentCaseId: handoff.studentCaseId,
          title: "Эта задача не должна сохраниться на paused кейсе",
        }),
        repositoryError("conflict"),
      );
      const [inactiveTaskProof] = await sql`
        select
          (select count(*)::int from evo_admissions_tasks where student_case_id = ${handoff.studentCaseId}) as tasks,
          (select count(*)::int from evo_business_events where idempotency_key = ${inactiveTaskContext.idempotencyKey}) as events,
          (select count(*)::int from evo_command_receipts where idempotency_key = ${inactiveTaskContext.idempotencyKey}) as receipts
      `;
      assert.deepEqual(inactiveTaskProof, {
        tasks: 4,
        events: 0,
        receipts: 0,
      });
    } finally {
      await sql`
        update evo_student_cases
        set status = 'active'
        where id = ${handoff.studentCaseId}
      `;
    }

    const handedOffPage = await listCanonicalSalesLeads({
      actorRole: "sales",
      query: lead.leadId,
      stage: "handed_off",
    });
    assert.equal(handedOffPage.rows.length, 1);
    assert.equal(handedOffPage.rows[0].nextAction, null);
    assert.equal(handedOffPage.rows[0].nextActionAt, null);
    const handedOffScheduledPage = await listCanonicalSalesLeads({
      actorRole: "admin",
      query: lead.leadId,
      due: "scheduled",
    });
    assert.deepEqual(handedOffScheduledPage.rows, []);

    const evidenceCountBeforeTerminalProbe = Number(
      (
        await sql`
          select count(*)::int as count
          from evo_sales_gate_evidence
          where lead_id = ${lead.leadId}
        `
      )[0].count,
    );
    await assert.rejects(
      recordCanonicalSalesGateEvidence({
        ...commandContext(runId, "post-handoff-evidence"),
        leadId: lead.leadId,
        evidenceType: "contract",
        decision: "confirmed",
        evidenceReference: `technical-post-handoff-${runId}`,
        occurredAt,
      }),
      repositoryError("conflict"),
    );
    const evidenceCountAfterTerminalProbe = Number(
      (
        await sql`
          select count(*)::int as count
          from evo_sales_gate_evidence
          where lead_id = ${lead.leadId}
        `
      )[0].count,
    );
    assert.equal(
      evidenceCountAfterTerminalProbe,
      evidenceCountBeforeTerminalProbe,
    );

    for (const existingCaseStatus of ["paused", "closed"]) {
      const existingCaseMarker = randomUUID();
      const existingCaseLead = await createCanonicalPersonLead({
        ...commandContext(
          runId,
          `existing-${existingCaseStatus}-case-lead`,
          "admin",
        ),
        displayName: `technical-existing-${existingCaseStatus}-${existingCaseMarker}`,
        email: `existing-${existingCaseStatus}-${existingCaseMarker}@acceptance.invalid`,
        source: "technical-existing-case-acceptance",
      });
      const existingCaseQualifiedLead = await updateCanonicalSalesLeadWorkflow(
        commandContext(
          runId,
          `existing-${existingCaseStatus}-case-qualified`,
          "admin",
        ),
        {
          leadId: existingCaseLead.leadId,
          expectedVersion: existingCaseLead.version,
          stage: "qualified",
          qualificationSummary: `Technical ${existingCaseStatus} case reactivation acceptance`,
          nextAction: "Complete the existing-case handoff",
          nextActionAt: "2026-08-30",
        },
      );
      for (const evidenceType of ["contract", "first_payment"]) {
        await recordCanonicalSalesGateEvidence({
          ...commandContext(
            runId,
            `existing-${existingCaseStatus}-${evidenceType}`,
            "admin",
          ),
          leadId: existingCaseLead.leadId,
          evidenceType,
          decision: "confirmed",
          evidenceReference: `technical-${existingCaseStatus}-${evidenceType}-${existingCaseMarker}`,
          amountMinor: evidenceType === "first_payment" ? 1 : null,
          currency: evidenceType === "first_payment" ? "USD" : null,
          occurredAt,
        });
      }

      const existingStudentCaseId = randomUUID();
      const existingCaseVersion = 7;
      const existingCaseUpdatedAt = "2026-08-27T09:00:00.000Z";
      await sql`
        insert into evo_student_cases (
          id,
          person_id,
          lead_id,
          status,
          owner_role,
          version,
          created_at,
          updated_at
        )
        values (
          ${existingStudentCaseId},
          ${existingCaseLead.personId},
          ${existingCaseLead.leadId},
          ${existingCaseStatus},
          'admissions',
          ${existingCaseVersion},
          ${existingCaseUpdatedAt},
          ${existingCaseUpdatedAt}
        )
      `;

      const preExistingAdmissionsTaskId = randomUUID();
      await sql`
        insert into evo_admissions_tasks (
          id,
          student_case_id,
          title,
          status,
          closed_at,
          closed_by_role
        )
        values (
          ${preExistingAdmissionsTaskId},
          ${existingStudentCaseId},
          'Проверить унаследованный контекст Sales',
          'completed',
          now(),
          'admissions'
        )
      `;

      const existingCaseHandoffInput = {
        ...commandContext(
          runId,
          `existing-${existingCaseStatus}-case-handoff`,
          "admin",
        ),
        leadId: existingCaseLead.leadId,
        expectedVersion: existingCaseQualifiedLead.version,
      };
      const existingCaseHandoff = await handoffCanonicalLeadToAdmissions(
        existingCaseHandoffInput,
      );
      assert.equal(existingCaseHandoff.studentCaseId, existingStudentCaseId);
      assert.equal(existingCaseHandoff.isOverride, false);

      const existingCaseSnapshot =
        await getCanonicalStudentCaseHandoffSnapshot({
          actorRole: "admissions",
          studentCaseId: existingStudentCaseId,
        });
      assert.equal(existingCaseSnapshot.starterTasks.length, 3);
      assert.ok(
        existingCaseSnapshot.starterTasks.every(
          (task) => task.status === "open",
        ),
      );
      assert.equal(
        existingCaseSnapshot.starterTasks.some(
          (task) => task.taskId === preExistingAdmissionsTaskId,
        ),
        false,
      );

      const [reactivatedCase] = await sql`
        select
          status,
          version,
          updated_at as "updatedAt"
        from evo_student_cases
        where id = ${existingStudentCaseId}
      `;
      assert.equal(reactivatedCase.status, "active");
      assert.equal(reactivatedCase.version, existingCaseVersion + 1);
      assert.ok(
        reactivatedCase.updatedAt.getTime() >
          new Date(existingCaseUpdatedAt).getTime(),
      );

      const reactivationEvents = await sql`
        select
          transition,
          event_sequence as "eventSequence",
          business_object_type as "businessObjectType",
          business_object_id as "businessObjectId",
          from_state as "fromState",
          to_state as "toState"
        from evo_business_events
        where idempotency_key = ${existingCaseHandoffInput.idempotencyKey}
        order by event_sequence
      `;
      assert.deepEqual(
        reactivationEvents.map((event) => ({
          transition: event.transition,
          eventSequence: event.eventSequence,
        })),
        [
          { transition: "student_case.activated", eventSequence: 1 },
          { transition: "task.created", eventSequence: 2 },
          { transition: "task.created", eventSequence: 3 },
          { transition: "task.created", eventSequence: 4 },
          { transition: "visa_milestone.created", eventSequence: 5 },
          { transition: "visa_milestone.created", eventSequence: 6 },
          { transition: "visa_milestone.created", eventSequence: 7 },
          { transition: "visa_milestone.created", eventSequence: 8 },
          { transition: "visa_milestone.created", eventSequence: 9 },
          { transition: "visa_milestone.created", eventSequence: 10 },
          { transition: "sales_admissions.handed_off", eventSequence: 11 },
        ],
      );
      assert.deepEqual(
        {
          businessObjectType: reactivationEvents[0].businessObjectType,
          businessObjectId: reactivationEvents[0].businessObjectId,
          fromState: reactivationEvents[0].fromState,
          toState: reactivationEvents[0].toState,
        },
        {
          businessObjectType: "student_case",
          businessObjectId: existingStudentCaseId,
          fromState: existingCaseStatus,
          toState: "active",
        },
      );
      assert.ok(
        reactivationEvents
          .slice(1, 4)
          .every((event) => event.businessObjectType === "task"),
      );
      assert.ok(
        reactivationEvents.slice(4, 10).every(
          (event) => event.businessObjectType === "visa_milestone",
        ),
      );
      assert.equal(reactivationEvents[10].businessObjectType, "handoff");
      assert.equal(
        reactivationEvents[10].businessObjectId,
        existingCaseHandoff.handoffId,
      );

      const [countsBeforeReplay] = await sql`
        select
          (
            select count(*)::int
            from evo_admissions_tasks
            where student_case_id = ${existingStudentCaseId}
          ) as tasks,
          (
            select count(*)::int
            from evo_sales_admissions_handoffs
            where lead_id = ${existingCaseLead.leadId}
          ) as handoffs,
          (
            select count(*)::int
            from evo_visa_milestones
            where student_case_id = ${existingStudentCaseId}
          ) as "visaMilestones",
          (
            select count(*)::int
            from evo_business_events
            where idempotency_key = ${existingCaseHandoffInput.idempotencyKey}
          ) as events
      `;
      assert.deepEqual(countsBeforeReplay, {
        tasks: 4,
        handoffs: 1,
        visaMilestones: 6,
        events: 11,
      });
      const existingCaseReplay = await handoffCanonicalLeadToAdmissions(
        existingCaseHandoffInput,
      );
      assert.deepEqual(existingCaseReplay, existingCaseHandoff);
      const [countsAfterReplay] = await sql`
        select
          (
            select count(*)::int
            from evo_admissions_tasks
            where student_case_id = ${existingStudentCaseId}
          ) as tasks,
          (
            select count(*)::int
            from evo_sales_admissions_handoffs
            where lead_id = ${existingCaseLead.leadId}
          ) as handoffs,
          (
            select count(*)::int
            from evo_visa_milestones
            where student_case_id = ${existingStudentCaseId}
          ) as "visaMilestones",
          (
            select count(*)::int
            from evo_business_events
            where idempotency_key = ${existingCaseHandoffInput.idempotencyKey}
          ) as events
      `;
      assert.deepEqual(countsAfterReplay, countsBeforeReplay);
    }

    const overrideLead = await createCanonicalPersonLead({
      ...commandContext(runId, "override-lead", "admin"),
      displayName: `technical-Xliteral-${runId}`,
      email: `override-${runId}@acceptance.invalid`,
      source: `technical-source-${runId}`,
    });
    await sql`
      update evo_leads
      set stage = 'qualified', version = version + 1, updated_at = now()
      where id = ${overrideLead.leadId}
    `;
    await assert.rejects(
      handoffCanonicalLeadToAdmissions({
        ...commandContext(runId, "override-missing-reason", "admin"),
        leadId: overrideLead.leadId,
        expectedVersion: overrideLead.version + 1,
        adminOverride: { reason: " " },
      }),
      repositoryError("invalid_input"),
    );
    await assert.rejects(
      handoffCanonicalLeadToAdmissions({
        ...commandContext(runId, "override-wrong-role"),
        leadId: overrideLead.leadId,
        expectedVersion: overrideLead.version + 1,
        adminOverride: { reason: `technical-reason-${runId}` },
      }),
      repositoryError("forbidden"),
    );
    const overrideInput = {
      ...commandContext(runId, "override", "admin"),
      leadId: overrideLead.leadId,
      expectedVersion: overrideLead.version + 1,
      adminOverride: { reason: `technical-reason-${runId}` },
    };
    const override = await handoffCanonicalLeadToAdmissions(overrideInput);
    assert.equal(override.isOverride, true);
    assert.notEqual(override.studentCaseId, handoff.studentCaseId);
    const overrideHandoffEvents = await sql`
      select transition, event_sequence as "eventSequence"
      from evo_business_events
      where idempotency_key = ${overrideInput.idempotencyKey}
      order by event_sequence
    `;
    assert.deepEqual(
      overrideHandoffEvents.map((event) => ({
        transition: event.transition,
        eventSequence: event.eventSequence,
      })),
      [
        { transition: "student_case.created", eventSequence: 1 },
        { transition: "task.created", eventSequence: 2 },
        { transition: "task.created", eventSequence: 3 },
        { transition: "task.created", eventSequence: 4 },
        { transition: "visa_milestone.created", eventSequence: 5 },
        { transition: "visa_milestone.created", eventSequence: 6 },
        { transition: "visa_milestone.created", eventSequence: 7 },
        { transition: "visa_milestone.created", eventSequence: 8 },
        { transition: "visa_milestone.created", eventSequence: 9 },
        { transition: "visa_milestone.created", eventSequence: 10 },
        { transition: "sales_admissions.handoff_override", eventSequence: 11 },
      ],
    );

    const overriddenGate = await getCanonicalLeadGateSnapshot({
      actorRole: "admin",
      leadId: overrideLead.leadId,
    });
    assert.equal(overriddenGate.state, "overridden");
    assert.equal(overriddenGate.handoff?.handoffId, override.handoffId);
    const overrideCaseHandoff = await getCanonicalStudentCaseHandoffSnapshot({
      actorRole: "admissions",
      studentCaseId: override.studentCaseId,
    });
    assert.equal(overrideCaseHandoff.handoff.isOverride, true);
    assert.equal(overrideCaseHandoff.starterTasks.length, 3);

    const initialOperations = await getCanonicalAdmissionsOperationsSnapshot({
      actorRole: "admissions",
      studentCaseId: override.studentCaseId,
    });
    assert.equal(initialOperations.studentCase.studentCaseId, override.studentCaseId);
    assert.equal(initialOperations.applications.length, 0);
    assert.equal(initialOperations.visaMilestones.length, 6);
    assert.equal(initialOperations.financeStop, null);
    assert.deepEqual(
      new Set(initialOperations.visaMilestones.map((row) => row.milestoneKind)),
      new Set([
        "document_preparation",
        "appointment",
        "submission",
        "biometrics",
        "interview",
        "decision",
      ]),
    );
    assert.ok(
      initialOperations.visaMilestones.every(
        (row) =>
          row.studentCaseId === override.studentCaseId &&
          row.ownerRole === "admissions" &&
          row.status === "pending" &&
          row.version === 1,
      ),
    );
    await assert.rejects(
      getCanonicalAdmissionsOperationsSnapshot({
        actorRole: "sales",
        studentCaseId: override.studentCaseId,
      }),
      repositoryError("forbidden"),
    );

    const applicationInput = {
      ...commandContext(runId, "operations-application-create", "admissions"),
      studentCaseId: override.studentCaseId,
      institutionName: `technical-university-${runId}`,
      programName: `technical-program-${runId}`,
      targetIntake: "2027 Spring",
      nextAction: "Проверить технический комплект документов",
      nextActionAt: "2026-09-15T10:00:00.000Z",
    };
    const application = await createCanonicalUniversityApplication(
      applicationInput,
    );
    assert.deepEqual(application, {
      applicationId: application.applicationId,
      studentCaseId: override.studentCaseId,
      status: "draft",
      version: 1,
    });
    const applicationReplay = await createCanonicalUniversityApplication(
      applicationInput,
    );
    assert.deepEqual(applicationReplay, application);
    await assert.rejects(
      createCanonicalUniversityApplication({
        ...applicationInput,
        programName: `technical-conflicting-program-${runId}`,
      }),
      repositoryError("idempotency_conflict"),
    );
    await assert.rejects(
      createCanonicalUniversityApplication({
        ...applicationInput,
        ...commandContext(
          runId,
          "operations-application-duplicate",
          "admissions",
        ),
      }),
      repositoryError("conflict"),
    );
    await assert.rejects(
      createCanonicalUniversityApplication({
        ...applicationInput,
        ...commandContext(runId, "operations-sales-create", "sales"),
      }),
      repositoryError("forbidden"),
    );

    const updatedApplication = await updateCanonicalUniversityApplication({
      ...commandContext(runId, "operations-application-update", "admissions"),
      applicationId: application.applicationId,
      expectedVersion: application.version,
      nextAction: "Подготовить заверенный технический перевод",
      nextActionAt: "2026-09-16T11:30:00.000Z",
    });
    assert.deepEqual(updatedApplication, {
      applicationId: application.applicationId,
      studentCaseId: override.studentCaseId,
      status: "draft",
      version: 2,
    });

    const financeStopInput = {
      ...commandContext(runId, "operations-finance-assert", "admissions"),
      studentCaseId: override.studentCaseId,
      expectedVersion: 0,
      reason: "Ожидается обязательный внутренний технический платеж",
    };
    const financeStop = await assertCanonicalFinanceStop(financeStopInput);
    assert.deepEqual(financeStop, {
      financeStopId: financeStop.financeStopId,
      studentCaseId: override.studentCaseId,
      isStopped: true,
      version: 1,
    });
    assert.deepEqual(
      await assertCanonicalFinanceStop(financeStopInput),
      financeStop,
    );
    await assert.rejects(
      assertCanonicalFinanceStop({
        ...financeStopInput,
        ...commandContext(runId, "operations-finance-sales", "sales"),
      }),
      repositoryError("forbidden"),
    );

    const submissionMilestone = initialOperations.visaMilestones.find(
      (row) => row.milestoneKind === "submission",
    );
    const documentMilestone = initialOperations.visaMilestones.find(
      (row) => row.milestoneKind === "document_preparation",
    );
    const appointmentMilestone = initialOperations.visaMilestones.find(
      (row) => row.milestoneKind === "appointment",
    );
    assert.ok(submissionMilestone);
    assert.ok(documentMilestone);
    assert.ok(appointmentMilestone);

    const blockedApplicationInput = {
      ...commandContext(
        runId,
        "operations-application-blocked-submit",
        "admissions",
      ),
      applicationId: application.applicationId,
      expectedVersion: updatedApplication.version,
      toStatus: "submitted",
    };
    await assert.rejects(
      transitionCanonicalUniversityApplication(blockedApplicationInput),
      repositoryError("gate_unsatisfied"),
    );
    const blockedSubmissionInput = {
      ...commandContext(
        runId,
        "operations-visa-blocked-submission",
        "admissions",
      ),
      visaMilestoneId: submissionMilestone.visaMilestoneId,
      expectedVersion: submissionMilestone.version,
      toStatus: "in_progress",
      nextAction: "Подготовить подачу после снятия стопа",
      nextActionAt: "2026-09-20T09:00:00.000Z",
      dueAt: "2026-09-25T09:00:00.000Z",
    };
    await assert.rejects(
      transitionCanonicalVisaMilestone(blockedSubmissionInput),
      repositoryError("gate_unsatisfied"),
    );
    const [blockedWriteCounts] = await sql`
      select
        (
          select count(*)::int
          from evo_command_receipts
          where idempotency_key in (
            ${blockedApplicationInput.idempotencyKey},
            ${blockedSubmissionInput.idempotencyKey}
          )
        ) as receipts,
        (
          select count(*)::int
          from evo_business_events
          where idempotency_key in (
            ${blockedApplicationInput.idempotencyKey},
            ${blockedSubmissionInput.idempotencyKey}
          )
        ) as events
    `;
    assert.deepEqual(blockedWriteCounts, { receipts: 0, events: 0 });

    const documentInProgress = await transitionCanonicalVisaMilestone({
      ...commandContext(runId, "operations-visa-document-start", "admissions"),
      visaMilestoneId: documentMilestone.visaMilestoneId,
      expectedVersion: documentMilestone.version,
      toStatus: "in_progress",
      nextAction: "Сверить технический документ",
      nextActionAt: "2026-09-18T09:00:00.000Z",
      dueAt: "2026-09-19T09:00:00.000Z",
    });
    assert.equal(documentInProgress.status, "in_progress");
    assert.equal(documentInProgress.version, 2);
    const documentCompleted = await transitionCanonicalVisaMilestone({
      ...commandContext(
        runId,
        "operations-visa-document-complete",
        "admissions",
      ),
      visaMilestoneId: documentMilestone.visaMilestoneId,
      expectedVersion: documentInProgress.version,
      toStatus: "completed",
    });
    assert.equal(documentCompleted.status, "completed");
    assert.equal(documentCompleted.version, 3);

    const appointmentBlocked = await transitionCanonicalVisaMilestone({
      ...commandContext(
        runId,
        "operations-visa-appointment-block",
        "admissions",
      ),
      visaMilestoneId: appointmentMilestone.visaMilestoneId,
      expectedVersion: appointmentMilestone.version,
      toStatus: "blocked",
      reason: "Нужно уточнить техническое время",
      dueAt: "2026-09-22T09:00:00.000Z",
    });
    assert.equal(appointmentBlocked.status, "blocked");
    assert.equal(appointmentBlocked.version, 2);
    const appointmentResumed = await transitionCanonicalVisaMilestone({
      ...commandContext(
        runId,
        "operations-visa-appointment-resume",
        "admissions",
      ),
      visaMilestoneId: appointmentMilestone.visaMilestoneId,
      expectedVersion: appointmentBlocked.version,
      toStatus: "in_progress",
      nextAction: "Подтвердить техническое время",
      nextActionAt: "2026-09-21T09:00:00.000Z",
      dueAt: "2026-09-22T09:00:00.000Z",
    });
    assert.equal(appointmentResumed.status, "in_progress");
    assert.equal(appointmentResumed.version, 3);

    await assert.rejects(
      releaseCanonicalFinanceStop({
        ...commandContext(
          runId,
          "operations-finance-release-wrong-role",
          "admissions",
        ),
        financeStopId: financeStop.financeStopId,
        expectedVersion: financeStop.version,
        reason: "Admissions не может снять стоп",
      }),
      repositoryError("forbidden"),
    );
    const releaseInput = {
      ...commandContext(runId, "operations-finance-release", "admin"),
      financeStopId: financeStop.financeStopId,
      expectedVersion: financeStop.version,
      reason: "Admin подтвердил снятие технического ограничения",
    };
    const releasedFinanceStop = await releaseCanonicalFinanceStop(releaseInput);
    assert.deepEqual(releasedFinanceStop, {
      financeStopId: financeStop.financeStopId,
      studentCaseId: override.studentCaseId,
      isStopped: false,
      version: 2,
    });
    assert.deepEqual(
      await releaseCanonicalFinanceStop(releaseInput),
      releasedFinanceStop,
    );

    const submittedApplication =
      await transitionCanonicalUniversityApplication({
        ...commandContext(
          runId,
          "operations-application-submit",
          "admissions",
        ),
        applicationId: application.applicationId,
        expectedVersion: updatedApplication.version,
        toStatus: "submitted",
      });
    assert.equal(submittedApplication.status, "submitted");
    assert.equal(submittedApplication.version, 3);
    const acceptedApplication =
      await transitionCanonicalUniversityApplication({
        ...commandContext(runId, "operations-application-accept", "admin"),
        applicationId: application.applicationId,
        expectedVersion: submittedApplication.version,
        toStatus: "accepted",
      });
    assert.equal(acceptedApplication.status, "accepted");
    assert.equal(acceptedApplication.version, 4);
    await assert.rejects(
      transitionCanonicalUniversityApplication({
        ...commandContext(
          runId,
          "operations-application-terminal-reopen",
          "admin",
        ),
        applicationId: application.applicationId,
        expectedVersion: acceptedApplication.version,
        toStatus: "withdrawn",
        reason: "Терминальная заявка не должна измениться",
      }),
      repositoryError("conflict"),
    );

    const submissionInProgress = await transitionCanonicalVisaMilestone({
      ...commandContext(runId, "operations-visa-submission-start", "admin"),
      visaMilestoneId: submissionMilestone.visaMilestoneId,
      expectedVersion: submissionMilestone.version,
      toStatus: "in_progress",
      nextAction: "Выполнить техническую подачу",
      nextActionAt: "2026-09-20T09:00:00.000Z",
      dueAt: "2026-09-25T09:00:00.000Z",
    });
    assert.equal(submissionInProgress.status, "in_progress");
    assert.equal(submissionInProgress.version, 2);
    const submissionCompleted = await transitionCanonicalVisaMilestone({
      ...commandContext(
        runId,
        "operations-visa-submission-complete",
        "admin",
      ),
      visaMilestoneId: submissionMilestone.visaMilestoneId,
      expectedVersion: submissionInProgress.version,
      toStatus: "completed",
      dueAt: "2026-09-25T09:00:00.000Z",
    });
    assert.equal(submissionCompleted.status, "completed");
    assert.equal(submissionCompleted.version, 3);

    const finalOperations = await getCanonicalAdmissionsOperationsSnapshot({
      actorRole: "admin",
      studentCaseId: override.studentCaseId,
    });
    assert.equal(finalOperations.applications.length, 1);
    assert.deepEqual(
      {
        status: finalOperations.applications[0].status,
        version: finalOperations.applications[0].version,
        nextAction: finalOperations.applications[0].nextAction,
        nextActionAt: finalOperations.applications[0].nextActionAt,
      },
      {
        status: "accepted",
        version: 4,
        nextAction: null,
        nextActionAt: null,
      },
    );
    assert.deepEqual(
      {
        isStopped: finalOperations.financeStop?.isStopped,
        reason: finalOperations.financeStop?.reason,
        changedByRole: finalOperations.financeStop?.changedByRole,
        version: finalOperations.financeStop?.version,
      },
      {
        isStopped: false,
        reason: releaseInput.reason,
        changedByRole: "admin",
        version: 2,
      },
    );
    const finalVisaByKind = Object.fromEntries(
      finalOperations.visaMilestones.map((row) => [row.milestoneKind, row]),
    );
    assert.deepEqual(
      {
        document: [
          finalVisaByKind.document_preparation.status,
          finalVisaByKind.document_preparation.version,
        ],
        appointment: [
          finalVisaByKind.appointment.status,
          finalVisaByKind.appointment.version,
        ],
        submission: [
          finalVisaByKind.submission.status,
          finalVisaByKind.submission.version,
        ],
      },
      {
        document: ["completed", 3],
        appointment: ["in_progress", 3],
        submission: ["completed", 3],
      },
    );

    const [applicationQueue, visaQueue, financeQueue] = await Promise.all([
      listCanonicalUniversityApplications({ actorRole: "admissions" }),
      listCanonicalVisaMilestones({ actorRole: "admin" }),
      listCanonicalFinanceStops({ actorRole: "admissions" }),
    ]);
    assert.ok(
      applicationQueue.rows.some(
        (row) =>
          row.applicationId === application.applicationId &&
          row.status === "accepted",
      ),
    );
    assert.equal(
      visaQueue.rows.filter(
        (row) => row.studentCaseId === override.studentCaseId,
      ).length,
      6,
    );
    assert.ok(
      financeQueue.rows.some(
        (row) =>
          row.financeStopId === financeStop.financeStopId &&
          row.isStopped === false,
      ),
    );
    const firstVisaPage = await listCanonicalVisaMilestones({
      actorRole: "admissions",
      pageSize: 2,
    });
    assert.equal(firstVisaPage.rows.length, 2);
    assert.equal(firstVisaPage.hasNext, true);
    assert.ok(firstVisaPage.nextCursor);
    const secondVisaPage = await listCanonicalVisaMilestones({
      actorRole: "admissions",
      cursor: firstVisaPage.nextCursor ?? undefined,
      pageSize: 2,
    });
    assert.equal(secondVisaPage.rows.length, 2);
    assert.equal(
      secondVisaPage.rows.some((row) =>
        firstVisaPage.rows.some(
          (firstRow) => firstRow.visaMilestoneId === row.visaMilestoneId,
        ),
      ),
      false,
    );
    const [operationEvidence] = await sql`
      select
        (
          select count(*)::int
          from evo_command_receipts
          where idempotency_key like ${`acceptance:${runId}:operations-%`}
        ) as receipts,
        (
          select count(*)::int
          from evo_business_events
          where business_object_id = ${application.applicationId}
        ) as application_events,
        (
          select count(*)::int
          from evo_business_events
          where business_object_id = ${financeStop.financeStopId}
        ) as finance_events
    `;
    assert.deepEqual(operationEvidence, {
      receipts: 12,
      application_events: 4,
      finance_events: 2,
    });

    const phoneSuffix = (
      BigInt(`0x${runId.replaceAll("-", "").slice(0, 10)}`) % 1_000_000_000n
    )
      .toString()
      .padStart(9, "0");
    const literalPhone = `+971${phoneSuffix}`;
    const literalEmail = `literal-${runId}@acceptance.invalid`;
    const literalLead = await createCanonicalPersonLead({
      ...commandContext(runId, "literal-lead", "admin"),
      displayName: `technical 100%_literal ${runId}`,
      email: literalEmail,
      phone: literalPhone,
      source: `technical-source-${runId}`,
    });
    await sql`
      update evo_leads
      set stage = 'qualified', version = version + 1, updated_at = now()
      where id = ${literalLead.leadId}
    `;
    const literalHandoff = await handoffCanonicalLeadToAdmissions({
      ...commandContext(runId, "literal-handoff", "admin"),
      leadId: literalLead.leadId,
      expectedVersion: literalLead.version + 1,
      adminOverride: { reason: `technical-read-acceptance-${runId}` },
    });

    const newestAt = "2026-08-28T15:00:00.000Z";
    const tiedAt = "2026-08-28T14:00:00.000Z";
    await sql`
      update evo_student_cases
      set status = 'active', updated_at = ${newestAt}
      where id = ${handoff.studentCaseId}
    `;
    await sql`
      update evo_student_cases
      set status = 'paused', updated_at = ${tiedAt}
      where id = ${override.studentCaseId}
    `;
    await sql`
      update evo_student_cases
      set status = 'closed', updated_at = ${tiedAt}
      where id = ${literalHandoff.studentCaseId}
    `;

    await assert.rejects(
      listCanonicalStudentCases({ actorRole: "sales", query: runId }),
      repositoryError("forbidden"),
    );

    const tiedIds = [override.studentCaseId, literalHandoff.studentCaseId].sort(
      (left, right) => (left > right ? -1 : left < right ? 1 : 0),
    );
    const firstQueuePage = await listCanonicalStudentCases({
      actorRole: "admin",
      pageSize: 2,
      query: runId,
    });
    assert.deepEqual(
      firstQueuePage.rows.map((row) => row.studentCaseId),
      [handoff.studentCaseId, tiedIds[0]],
    );
    assert.equal(firstQueuePage.hasNext, true);
    assert.deepEqual(firstQueuePage.nextCursor, {
      updatedAt: tiedAt,
      id: tiedIds[0],
    });

    const secondQueuePage = await listCanonicalStudentCases({
      actorRole: "admissions",
      cursor: firstQueuePage.nextCursor,
      pageSize: 2,
      query: runId,
    });
    assert.deepEqual(
      secondQueuePage.rows.map((row) => row.studentCaseId),
      [tiedIds[1]],
    );
    assert.equal(secondQueuePage.hasNext, false);
    assert.equal(secondQueuePage.nextCursor, null);
    assert.equal(
      new Set(
        [...firstQueuePage.rows, ...secondQueuePage.rows].map(
          (row) => row.studentCaseId,
        ),
      ).size,
      3,
    );

    const pausedQueue = await listCanonicalStudentCases({
      actorRole: "admissions",
      status: "paused",
      query: runId,
    });
    assert.equal(pausedQueue.rows.length, 1);
    const [pausedRow] = pausedQueue.rows;
    assert.deepEqual(
      {
        ...pausedRow,
        createdAt: undefined,
      },
      {
        studentCaseId: override.studentCaseId,
        leadId: overrideLead.leadId,
        personId: overrideLead.personId,
        displayName: `technical-Xliteral-${runId}`,
        email: `override-${runId}@acceptance.invalid`,
        phone: null,
        status: "paused",
        assignedRole: "admissions",
        createdAt: undefined,
        updatedAt: tiedAt,
      },
    );
    assert.match(pausedRow.createdAt, /^\d{4}-\d{2}-\d{2}T/);

    for (const query of [
      "%_literal",
      literalEmail,
      literalPhone,
      literalLead.personId,
      literalLead.leadId,
      literalHandoff.studentCaseId,
    ]) {
      const searchPage = await listCanonicalStudentCases({
        actorRole: "admin",
        query,
      });
      assert.deepEqual(
        searchPage.rows.map((row) => row.studentCaseId),
        [literalHandoff.studentCaseId],
        `literal queue search failed for ${query}`,
      );
    }

    await sql.begin(async (transaction) => {
      await transaction`
        insert into evo_admissions_tasks (id, student_case_id, title)
        values (
          ${randomUUID()},
          ${handoff.studentCaseId},
          ${`technical-task-${runId}`}
        )
      `;
      await transaction`
        insert into evo_ai_proposals (
          id,
          conversation_id,
          student_case_id,
          model,
          proposal_text,
          source_context,
          provider_created_at,
          correlation_id,
          idempotency_key
        ) values (
          ${randomUUID()},
          ${inbound.conversationId},
          ${handoff.studentCaseId},
          ${`technical-model-${runId}`},
          ${`technical-proposal-${runId}`},
          ${transaction.json({ acceptanceRunId: runId })},
          ${occurredAt},
          ${`acceptance:${runId}:ai`},
          ${`acceptance:${runId}:ai`}
        )
      `;
    });

    const positiveGraph = await sql`
      select
        (select count(*)::int from evo_people) as people,
        (select count(*)::int from evo_leads) as leads,
        (select count(*)::int from evo_conversations) as conversations,
        (select count(*)::int from evo_messages) as messages,
        (select count(*)::int from evo_student_cases) as student_cases,
        (select count(*)::int from evo_sales_gate_evidence) as gate_evidence,
        (select count(*)::int from evo_sales_admissions_handoffs) as handoffs,
        (select count(*)::int from evo_admissions_tasks) as tasks,
        (select count(*)::int from evo_university_applications) as applications,
        (select count(*)::int from evo_visa_milestones) as visa_milestones,
        (select count(*)::int from evo_finance_stop_states) as finance_stops,
        (select count(*)::int from evo_ai_proposals) as ai_proposals,
        (select count(*)::int from evo_command_receipts) as receipts,
        (select count(*)::int from evo_business_events) as events
    `;
    for (const [name, count] of Object.entries(positiveGraph[0])) {
      assert.ok(Number(count) > 0, `canonical graph table ${name} is empty`);
    }

    await expectPostgresError(
      () => sql`
        insert into evo_leads (id, person_id, source)
        values (
          ${randomUUID()},
          ${randomUUID()},
          ${`technical-fk-probe-${runId}`}
        )
      `,
      "23503",
    );
    await expectPostgresError(
      () => sql`
        insert into evo_admissions_tasks (id, student_case_id, title)
        values (${randomUUID()}, ${handoff.studentCaseId}, ' ')
      `,
      "23514",
    );
    await expectPostgresError(
      () => sql`
        insert into evo_visa_milestones (
          id,
          student_case_id,
          milestone_kind
        ) values (
          ${randomUUID()},
          ${handoff.studentCaseId},
          'document_preparation'
        )
      `,
      "23505",
    );
    await expectPostgresError(
      () => sql`
        insert into evo_private_documents (id, case_id, created_by_role)
        values (${randomUUID()}, ${randomUUID()}, 'admissions')
      `,
      "23503",
    );

    const events = await sql`
      select
        id,
        actor_role as "actorRole",
        business_object_type as "businessObjectType",
        business_object_id as "businessObjectId",
        transition,
        reason,
        correlation_id as "correlationId",
        idempotency_key as "idempotencyKey",
        occurred_at as "occurredAt"
      from evo_business_events
      where correlation_id like ${`acceptance:${runId}:%`}
      order by occurred_at, id
    `;
    assert.ok(events.length > 0);
    for (const event of events) {
      assert.match(event.id, /^[0-9a-f-]{36}$/);
      assert.ok(["admin", "sales", "admissions"].includes(event.actorRole));
      assert.ok(event.businessObjectType);
      assert.match(event.businessObjectId, /^[0-9a-f-]{36}$/);
      assert.ok(event.transition);
      assert.ok(event.correlationId);
      assert.ok(event.idempotencyKey);
      assert.ok(event.occurredAt instanceof Date);
    }
    const overrideEvent = events.find(
      (event) =>
        event.idempotencyKey === overrideInput.idempotencyKey &&
        event.transition === "sales_admissions.handoff_override",
    );
    assert.ok(overrideEvent, "Admin override did not append a business event");
    assert.equal(overrideEvent.actorRole, "admin");
    assert.equal(overrideEvent.reason, overrideInput.adminOverride.reason);

    const immutableEvent = events[0];
    const eventCountBeforeMutation = Number(
      (await sql`select count(*)::int as count from evo_business_events`)[0]
        .count,
    );
    await expectPostgresError(
      () => sql`
        update evo_business_events
        set transition = 'technical-mutation-probe'
        where id = ${immutableEvent.id}
      `,
      "55000",
    );
    await expectPostgresError(
      () => sql`delete from evo_business_events where id = ${immutableEvent.id}`,
      "55000",
    );
    const eventCountAfterMutation = Number(
      (await sql`select count(*)::int as count from evo_business_events`)[0]
        .count,
    );
    assert.equal(eventCountAfterMutation, eventCountBeforeMutation);

    const [browserCalendar] = await sql`
      select to_char(
        (now() at time zone 'Asia/Bishkek')::date + 1,
        'YYYY-MM-DD'
      ) as tomorrow
    `;
    const browserLead = await createCanonicalPersonLead({
      ...technicalCommandContext(runId, "browser-active-lead", "admin"),
      displayName: `technical-browser-active-${runId}`,
      email: `browser-active-${runId}@technical.invalid`,
      source: `technical-browser-source-${runId}`,
    });
    const browserActiveLead = await updateCanonicalSalesLeadWorkflow(
      technicalCommandContext(runId, "browser-active-workflow", "admin"),
      {
        leadId: browserLead.leadId,
        expectedVersion: browserLead.version,
        stage: "qualifying",
        qualificationSummary: "Technical browser-ready lead",
        nextAction: "Exercise the technical Sales form",
        nextActionAt: browserCalendar.tomorrow,
      },
    );
    assert.equal(browserActiveLead.stage, "qualifying");

    const browserOverrideLead = await createCanonicalPersonLead({
      ...technicalCommandContext(runId, "browser-override-lead", "admin"),
      displayName: `technical-browser-override-${randomUUID()}`,
      email: `browser-override-${randomUUID()}@technical.invalid`,
      source: "technical-browser-override-source",
    });
    const browserOverrideReadyLead = await updateCanonicalSalesLeadWorkflow(
      technicalCommandContext(runId, "browser-override-workflow", "admin"),
      {
        leadId: browserOverrideLead.leadId,
        expectedVersion: browserOverrideLead.version,
        stage: "qualified",
        qualificationSummary: "Technical browser Admin override lead",
        nextAction: "Exercise the browser Admin handoff exception",
        nextActionAt: browserCalendar.tomorrow,
      },
    );
    assert.equal(browserOverrideReadyLead.stage, "qualified");

    const originalDatabaseUrl = process.env.DATABASE_URL;
    await closeDatabaseConnections();
    process.env.DATABASE_URL =
      "postgresql://technical:technical@127.0.0.1:1/technical";
    try {
      await assert.rejects(
        listCanonicalAdmissionsTasks({
          actorRole: "sales",
          studentCaseId: handoff.studentCaseId,
        }),
        repositoryError("forbidden"),
      );
      await assert.rejects(
        createCanonicalAdmissionsTask({
          ...commandContext(runId, "sales-task-create", "sales"),
          studentCaseId: handoff.studentCaseId,
          title: "Sales не может создать Admissions задачу",
        }),
        repositoryError("forbidden"),
      );
      await assert.rejects(
        transitionCanonicalAdmissionsTask({
          ...commandContext(runId, "sales-task-transition", "sales"),
          taskId: createdAdmissionsTask.taskId,
          expectedVersion: createdAdmissionsTask.version,
          toStatus: "completed",
        }),
        repositoryError("forbidden"),
      );
      await assert.rejects(
        getCanonicalAdmissionsOperationsSnapshot({
          actorRole: "sales",
          studentCaseId: handoff.studentCaseId,
        }),
        repositoryError("forbidden"),
      );
      await assert.rejects(
        createCanonicalUniversityApplication({
          ...commandContext(
            runId,
            "operations-unavailable-sales-create",
            "sales",
          ),
          studentCaseId: handoff.studentCaseId,
          institutionName: "Sales cannot create an application",
          programName: "Forbidden",
          targetIntake: "2027 Spring",
          nextAction: "This must fail before database access",
          nextActionAt: "2026-09-15T10:00:00.000Z",
        }),
        repositoryError("forbidden"),
      );
      await assert.rejects(
        listCanonicalAdmissionsTasks({
          actorRole: "admissions",
          pageSize: 51,
        }),
        repositoryError("invalid_input"),
      );
      await assert.rejects(
        createCanonicalAdmissionsTask({
          ...commandContext(
            runId,
            "task-due-at-submillisecond-precision",
            "admissions",
          ),
          studentCaseId: handoff.studentCaseId,
          title: "Due timestamp не должен молча терять точность",
          dueAt: "2026-09-15T09:30:00.123456Z",
        }),
        repositoryError("invalid_input"),
      );
      await assert.rejects(
        transitionCanonicalAdmissionsTask({
          ...commandContext(
            runId,
            "missing-task-cancellation-reason",
            "admissions",
          ),
          taskId: createdAdmissionsTask.taskId,
          expectedVersion: createdAdmissionsTask.version,
          toStatus: "cancelled",
        }),
        repositoryError("invalid_input"),
      );
      await assert.rejects(
        listCanonicalStudentCases({ actorRole: "admin", query: runId }),
        repositoryError("unavailable"),
      );
      await assert.rejects(
        getCanonicalAdmissionsOperationsSnapshot({
          actorRole: "admissions",
          studentCaseId: handoff.studentCaseId,
        }),
        repositoryError("unavailable"),
      );
      await assert.rejects(
        createCanonicalUniversityApplication({
          ...commandContext(
            runId,
            "operations-unavailable-create",
            "admissions",
          ),
          studentCaseId: handoff.studentCaseId,
          institutionName: "Unavailable PostgreSQL",
          programName: "No fallback",
          targetIntake: "2027 Spring",
          nextAction: "Fail clearly without a write",
          nextActionAt: "2026-09-15T10:00:00.000Z",
        }),
        repositoryError("unavailable"),
      );
    } finally {
      process.env.DATABASE_URL = originalDatabaseUrl;
      await closeDatabaseConnections();
    }

    const resultFile = process.env.EVO_CANONICAL_ACCEPTANCE_RESULT_FILE;
    if (resultFile) {
      await writeFile(
        resultFile,
        `${JSON.stringify({
          canonicalLeadId: browserActiveLead.leadId,
          canonicalOverrideLeadId: browserOverrideReadyLead.leadId,
          privateDocumentCaseId: handoff.studentCaseId,
        })}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
    }
  } finally {
    await closeDatabaseConnections();
    await sql.end({ timeout: 5 });
  }
});

test("canonical Sales repository runs the technical queue and workflow on real PostgreSQL", async () => {
  const databaseUrl = requiredDatabaseUrl();
  const sql = postgres(databaseUrl, {
    idle_timeout: 5,
    max: 1,
    onnotice: () => undefined,
  });
  const runId = randomUUID();

  try {
    const [calendar] = await sql`
      select
        to_char((now() at time zone 'Asia/Bishkek')::date, 'YYYY-MM-DD') as today,
        to_char((now() at time zone 'Asia/Bishkek')::date - 1, 'YYYY-MM-DD') as yesterday,
        to_char((now() at time zone 'Asia/Bishkek')::date + 1, 'YYYY-MM-DD') as tomorrow
    `;
    const phoneSuffix = (
      BigInt(`0x${runId.replaceAll("-", "").slice(0, 10)}`) % 1_000_000_000n
    )
      .toString()
      .padStart(9, "0");
    const literalPhone = `+971${phoneSuffix}`;
    const literalEmail = `sales-literal-${runId}@technical.invalid`;

    const literalLead = await createCanonicalPersonLead({
      ...technicalCommandContext(runId, "literal-lead", "admin"),
      displayName: `technical-sales-100%_literal-${runId}`,
      email: literalEmail,
      phone: literalPhone,
      source: `technical-sales-source-${runId}`,
    });
    const overdueLead = await createCanonicalPersonLead({
      ...technicalCommandContext(runId, "overdue-lead"),
      displayName: `technical-sales-overdue-${runId}`,
      email: `sales-overdue-${runId}@technical.invalid`,
      source: `technical-sales-source-${runId}`,
    });
    const futureLead = await createCanonicalPersonLead({
      ...technicalCommandContext(runId, "future-lead"),
      displayName: `technical-sales-future-${runId}`,
      email: `sales-future-${runId}@technical.invalid`,
      source: `technical-sales-source-${runId}`,
    });
    const unscheduledLead = await createCanonicalPersonLead({
      ...technicalCommandContext(runId, "unscheduled-lead"),
      displayName: `technical-sales-Xliteral-${runId}`,
      email: `sales-unscheduled-${runId}@technical.invalid`,
      source: `technical-sales-source-${runId}`,
    });
    const disqualifiedLead = await createCanonicalPersonLead({
      ...technicalCommandContext(runId, "disqualified-lead"),
      displayName: `technical-sales-disqualified-${runId}`,
      email: `sales-disqualified-${runId}@technical.invalid`,
      source: `technical-sales-source-${runId}`,
    });

    const literalWorkflowContext = technicalCommandContext(
      runId,
      "literal-workflow",
    );
    const literalWorkflowInput = {
      leadId: literalLead.leadId,
      expectedVersion: literalLead.version,
      stage: "qualifying",
      qualificationSummary: null,
      nextAction: "  Confirm   technical follow-up  ",
      nextActionAt: calendar.today,
      reason: null,
    };
    const literalWorkflow = await updateCanonicalSalesLeadWorkflow(
      literalWorkflowContext,
      literalWorkflowInput,
    );
    assert.deepEqual(
      {
        stage: literalWorkflow.stage,
        ownerRole: literalWorkflow.ownerRole,
        qualificationSummary: literalWorkflow.qualificationSummary,
        nextAction: literalWorkflow.nextAction,
        nextActionAt: literalWorkflow.nextActionAt,
        version: literalWorkflow.version,
      },
      {
        stage: "qualifying",
        ownerRole: "sales",
        qualificationSummary: null,
        nextAction: "Confirm technical follow-up",
        nextActionAt: `${calendar.today}T03:00:00.000Z`,
        version: 2,
      },
    );
    const literalEventsBeforeReplay = await sql`
      select
        business_object_type as "businessObjectType",
        business_object_id as "businessObjectId",
        transition,
        from_state as "fromState",
        to_state as "toState",
        reason,
        event_sequence as "eventSequence"
      from evo_business_events
      where idempotency_key = ${literalWorkflowContext.idempotencyKey}
      order by event_sequence
    `;
    assert.deepEqual(
      literalEventsBeforeReplay.map((event) => ({
        businessObjectType: event.businessObjectType,
        businessObjectId: event.businessObjectId,
        transition: event.transition,
        fromState: event.fromState,
        toState: event.toState,
        reason: event.reason,
        eventSequence: event.eventSequence,
      })),
      [
        {
          businessObjectType: "lead",
          businessObjectId: literalLead.leadId,
          transition: "sales_lead.workflow_updated",
          fromState: "new",
          toState: "qualifying",
          reason: null,
          eventSequence: 1,
        },
      ],
    );
    const [literalReceipt] = await sql`
      select
        status,
        business_object_type as "businessObjectType",
        business_object_id as "businessObjectId",
        result_payload ->> 'leadId' as "resultLeadId"
      from evo_command_receipts
      where idempotency_key = ${literalWorkflowContext.idempotencyKey}
    `;
    assert.deepEqual(literalReceipt, {
      status: "succeeded",
      businessObjectType: "lead",
      businessObjectId: literalLead.leadId,
      resultLeadId: literalLead.leadId,
    });

    const literalReplay = await updateCanonicalSalesLeadWorkflow(
      literalWorkflowContext,
      literalWorkflowInput,
    );
    assert.deepEqual(literalReplay, literalWorkflow);
    const [literalEventCountAfterReplay] = await sql`
      select count(*)::int as count
      from evo_business_events
      where idempotency_key = ${literalWorkflowContext.idempotencyKey}
    `;
    assert.equal(literalEventCountAfterReplay.count, 1);
    await assert.rejects(
      updateCanonicalSalesLeadWorkflow(literalWorkflowContext, {
        ...literalWorkflowInput,
        nextAction: "Different technical follow-up",
      }),
      repositoryError("idempotency_conflict"),
    );

    const literalNoChangeContext = technicalCommandContext(
      runId,
      "literal-workflow-no-change",
    );
    const literalNoChange = await updateCanonicalSalesLeadWorkflow(
      literalNoChangeContext,
      {
        ...literalWorkflowInput,
        expectedVersion: literalWorkflow.version,
      },
    );
    assert.deepEqual(
      literalNoChange,
      literalWorkflow,
      "a fresh request whose normalized snapshot is unchanged must not advance the lead",
    );
    const [literalNoChangeReceipt] = await sql`
      select
        status,
        business_object_type as "businessObjectType",
        business_object_id as "businessObjectId",
        result_payload ->> 'leadId' as "resultLeadId"
      from evo_command_receipts
      where idempotency_key = ${literalNoChangeContext.idempotencyKey}
    `;
    assert.deepEqual(literalNoChangeReceipt, {
      status: "succeeded",
      businessObjectType: "lead",
      businessObjectId: literalLead.leadId,
      resultLeadId: literalLead.leadId,
    });
    const [literalNoChangeEventCount] = await sql`
      select count(*)::int as count
      from evo_business_events
      where idempotency_key = ${literalNoChangeContext.idempotencyKey}
    `;
    assert.equal(
      literalNoChangeEventCount.count,
      0,
      "an unchanged snapshot must not manufacture a business event",
    );

    const staleContext = technicalCommandContext(runId, "stale-workflow");
    await assert.rejects(
      updateCanonicalSalesLeadWorkflow(staleContext, {
        leadId: literalLead.leadId,
        expectedVersion: 1,
        stage: "qualified",
        qualificationSummary: "Technical qualification",
        nextAction: "Confirm technical qualification",
        nextActionAt: calendar.tomorrow,
      }),
      repositoryError("conflict"),
    );
    const [staleReceiptCount] = await sql`
      select count(*)::int as count
      from evo_command_receipts
      where idempotency_key = ${staleContext.idempotencyKey}
    `;
    const [staleEventCount] = await sql`
      select count(*)::int as count
      from evo_business_events
      where idempotency_key = ${staleContext.idempotencyKey}
    `;
    assert.equal(staleReceiptCount.count, 0);
    assert.equal(staleEventCount.count, 0);
    await assert.rejects(
      updateCanonicalSalesLeadWorkflow(
        technicalCommandContext(runId, "admissions-workflow", "admissions"),
        {
          ...literalWorkflowInput,
          expectedVersion: literalWorkflow.version,
        },
      ),
      repositoryError("forbidden"),
    );

    const overdueWorkflow = await updateCanonicalSalesLeadWorkflow(
      technicalCommandContext(runId, "overdue-workflow"),
      {
        leadId: overdueLead.leadId,
        expectedVersion: overdueLead.version,
        stage: "qualifying",
        nextAction: "Review overdue technical item",
        nextActionAt: calendar.yesterday,
      },
    );
    assert.equal(overdueWorkflow.nextActionAt, `${calendar.yesterday}T03:00:00.000Z`);
    const futureWorkflow = await updateCanonicalSalesLeadWorkflow(
      technicalCommandContext(runId, "future-workflow", "admin"),
      {
        leadId: futureLead.leadId,
        expectedVersion: futureLead.version,
        stage: "qualified",
        qualificationSummary: "Technical qualification summary",
        nextAction: "Review future technical item",
        nextActionAt: calendar.tomorrow,
      },
    );
    assert.equal(futureWorkflow.stage, "qualified");

    const disqualifiedActive = await updateCanonicalSalesLeadWorkflow(
      technicalCommandContext(runId, "disqualified-active"),
      {
        leadId: disqualifiedLead.leadId,
        expectedVersion: disqualifiedLead.version,
        stage: "qualifying",
        nextAction: "Review before technical disqualification",
        nextActionAt: calendar.tomorrow,
      },
    );
    const disqualifiedContext = technicalCommandContext(
      runId,
      "disqualified-workflow",
    );
    const disqualifiedWorkflow = await updateCanonicalSalesLeadWorkflow(
      disqualifiedContext,
      {
        leadId: disqualifiedLead.leadId,
        expectedVersion: disqualifiedActive.version,
        stage: "disqualified",
        qualificationSummary: "Technical qualification stopped",
        nextAction: "This value must be cleared",
        nextActionAt: calendar.tomorrow,
        reason: "Technical disqualification reason",
      },
    );
    assert.deepEqual(
      {
        stage: disqualifiedWorkflow.stage,
        nextAction: disqualifiedWorkflow.nextAction,
        nextActionAt: disqualifiedWorkflow.nextActionAt,
        version: disqualifiedWorkflow.version,
      },
      {
        stage: "disqualified",
        nextAction: null,
        nextActionAt: null,
        version: 3,
      },
    );
    const [disqualifiedEvent] = await sql`
      select from_state as "fromState", to_state as "toState", reason
      from evo_business_events
      where idempotency_key = ${disqualifiedContext.idempotencyKey}
    `;
    assert.deepEqual(disqualifiedEvent, {
      fromState: "qualifying",
      toState: "disqualified",
      reason: "Technical disqualification reason",
    });

    const newestAt = "2026-08-28T15:00:00.000Z";
    const tiedAt = "2026-08-28T14:00:00.000Z";
    const unscheduledAt = "2026-08-28T13:00:00.000Z";
    const disqualifiedAt = "2026-08-28T12:00:00.000Z";
    await sql`
      update evo_leads
      set updated_at = case id
        when ${literalLead.leadId} then ${newestAt}::timestamptz
        when ${overdueLead.leadId} then ${tiedAt}::timestamptz
        when ${futureLead.leadId} then ${tiedAt}::timestamptz
        when ${unscheduledLead.leadId} then ${unscheduledAt}::timestamptz
        when ${disqualifiedLead.leadId} then ${disqualifiedAt}::timestamptz
      end
      where id in (
        ${literalLead.leadId},
        ${overdueLead.leadId},
        ${futureLead.leadId},
        ${unscheduledLead.leadId},
        ${disqualifiedLead.leadId}
      )
    `;

    await assert.rejects(
      listCanonicalSalesLeads({ actorRole: "admissions", query: runId }),
      repositoryError("forbidden"),
    );
    const tiedIds = [overdueLead.leadId, futureLead.leadId].sort((left, right) =>
      left > right ? -1 : left < right ? 1 : 0,
    );
    const firstPage = await listCanonicalSalesLeads({
      actorRole: "admin",
      query: runId,
      pageSize: 2,
    });
    assert.deepEqual(
      firstPage.rows.map((row) => row.leadId),
      [literalLead.leadId, tiedIds[0]],
    );
    assert.equal(firstPage.hasNext, true);
    assert.deepEqual(firstPage.nextCursor, {
      updatedAt: tiedAt,
      id: tiedIds[0],
    });
    const secondPage = await listCanonicalSalesLeads({
      actorRole: "sales",
      query: runId,
      pageSize: 2,
      cursor: firstPage.nextCursor,
    });
    assert.deepEqual(secondPage.rows.map((row) => row.leadId), [
      tiedIds[1],
      unscheduledLead.leadId,
    ]);
    assert.equal(secondPage.hasNext, true);
    const thirdPage = await listCanonicalSalesLeads({
      actorRole: "admin",
      query: runId,
      pageSize: 2,
      cursor: secondPage.nextCursor,
    });
    assert.deepEqual(thirdPage.rows.map((row) => row.leadId), [
      disqualifiedLead.leadId,
    ]);
    assert.equal(thirdPage.hasNext, false);
    assert.equal(thirdPage.nextCursor, null);
    assert.equal(
      new Set(
        [...firstPage.rows, ...secondPage.rows, ...thirdPage.rows].map(
          (row) => row.leadId,
        ),
      ).size,
      5,
    );

    const qualifiedPage = await listCanonicalSalesLeads({
      actorRole: "sales",
      query: runId,
      stage: "qualified",
    });
    assert.deepEqual(qualifiedPage.rows.map((row) => row.leadId), [
      futureLead.leadId,
    ]);
    assert.equal(qualifiedPage.rows[0].qualificationSummary, "Technical qualification summary");
    assert.equal(qualifiedPage.rows[0].ownerRole, "sales");

    const scheduledPage = await listCanonicalSalesLeads({
      actorRole: "admin",
      query: runId,
      due: "scheduled",
    });
    assert.deepEqual(
      new Set(scheduledPage.rows.map((row) => row.leadId)),
      new Set([literalLead.leadId, overdueLead.leadId, futureLead.leadId]),
    );
    const unscheduledPage = await listCanonicalSalesLeads({
      actorRole: "sales",
      query: runId,
      due: "unscheduled",
    });
    assert.deepEqual(
      new Set(unscheduledPage.rows.map((row) => row.leadId)),
      new Set([unscheduledLead.leadId, disqualifiedLead.leadId]),
    );
    const dueTodayPage = await listCanonicalSalesLeads({
      actorRole: "admin",
      query: runId,
      due: "due_today",
    });
    assert.deepEqual(dueTodayPage.rows.map((row) => row.leadId), [
      literalLead.leadId,
    ]);
    const overduePage = await listCanonicalSalesLeads({
      actorRole: "sales",
      query: runId,
      due: "overdue",
    });
    assert.deepEqual(overduePage.rows.map((row) => row.leadId), [
      overdueLead.leadId,
    ]);

    for (const query of [
      `100%_literal-${runId}`,
      literalEmail,
      literalPhone,
      literalLead.personId,
      literalLead.leadId,
    ]) {
      const searchPage = await listCanonicalSalesLeads({
        actorRole: "admin",
        query,
      });
      assert.deepEqual(
        searchPage.rows.map((row) => row.leadId),
        [literalLead.leadId],
        `literal Sales queue search failed for ${query}`,
      );
    }

    const originalDatabaseUrl = process.env.DATABASE_URL;
    await closeDatabaseConnections();
    process.env.DATABASE_URL =
      "postgresql://technical:technical@127.0.0.1:1/technical";
    try {
      await assert.rejects(
        listCanonicalSalesLeads({ actorRole: "admin", query: runId }),
        repositoryError("unavailable"),
      );
    } finally {
      process.env.DATABASE_URL = originalDatabaseUrl;
      await closeDatabaseConnections();
    }
  } finally {
    await closeDatabaseConnections();
    await sql.end({ timeout: 5 });
  }
});
