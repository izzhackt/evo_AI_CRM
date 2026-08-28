import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import test from "node:test";

import postgres from "postgres";

import {
  CanonicalCrmRepositoryError,
  appendCanonicalInboundMessage,
  createCanonicalPersonLead,
  handoffCanonicalLeadToAdmissions,
  listCanonicalStudentCases,
  recordCanonicalSalesGateEvidence,
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

    await assert.rejects(
      handoffCanonicalLeadToAdmissions({
        ...commandContext(runId, "handoff-before-qualified"),
        leadId: lead.leadId,
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

    await sql`
      update evo_leads
      set stage = 'qualified', version = version + 1, updated_at = now()
      where id = ${lead.leadId}
    `;

    await assert.rejects(
      handoffCanonicalLeadToAdmissions({
        ...commandContext(runId, "handoff-before-gate"),
        leadId: lead.leadId,
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

    const handoffInput = {
      ...commandContext(runId, "handoff"),
      leadId: lead.leadId,
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
        { transition: "sales_admissions.handed_off", eventSequence: 2 },
      ],
    );
    assert.equal(normalHandoffEvents[0].businessObjectType, "student_case");
    assert.equal(normalHandoffEvents[0].businessObjectId, handoff.studentCaseId);
    assert.equal(normalHandoffEvents[1].businessObjectType, "handoff");
    assert.equal(normalHandoffEvents[1].businessObjectId, handoff.handoffId);

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
        adminOverride: { reason: " " },
      }),
      repositoryError("invalid_input"),
    );
    await assert.rejects(
      handoffCanonicalLeadToAdmissions({
        ...commandContext(runId, "override-wrong-role"),
        leadId: overrideLead.leadId,
        adminOverride: { reason: `technical-reason-${runId}` },
      }),
      repositoryError("forbidden"),
    );
    const overrideInput = {
      ...commandContext(runId, "override", "admin"),
      leadId: overrideLead.leadId,
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
        { transition: "sales_admissions.handoff_override", eventSequence: 2 },
      ],
    );

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
        insert into evo_university_applications (
          id,
          student_case_id,
          institution_name,
          program_name,
          target_intake
        ) values (
          ${randomUUID()},
          ${handoff.studentCaseId},
          ${`technical-institution-${runId}`},
          ${`technical-program-${runId}`},
          ${`technical-intake-${runId}`}
        )
      `;
      await transaction`
        insert into evo_visa_milestones (
          id,
          student_case_id,
          milestone_kind
        ) values (
          ${randomUUID()},
          ${handoff.studentCaseId},
          'document_preparation'
        )
      `;
      await transaction`
        insert into evo_finance_stop_states (
          id,
          student_case_id,
          is_stopped,
          reason,
          changed_by_role
        ) values (
          ${randomUUID()},
          ${handoff.studentCaseId},
          false,
          ${`technical-initial-state-${runId}`},
          'admissions'
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

    const originalDatabaseUrl = process.env.DATABASE_URL;
    await closeDatabaseConnections();
    process.env.DATABASE_URL =
      "postgresql://technical:technical@127.0.0.1:1/technical";
    try {
      await assert.rejects(
        listCanonicalStudentCases({ actorRole: "admin", query: runId }),
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
        `${JSON.stringify({ canonicalLeadId: lead.leadId, privateDocumentCaseId: handoff.studentCaseId })}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
    }
  } finally {
    await closeDatabaseConnections();
    await sql.end({ timeout: 5 });
  }
});
