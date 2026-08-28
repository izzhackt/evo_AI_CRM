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
  listCanonicalSalesLeads,
  listCanonicalStudentCases,
  recordCanonicalSalesGateEvidence,
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
        `${JSON.stringify({ canonicalLeadId: browserActiveLead.leadId, privateDocumentCaseId: handoff.studentCaseId })}\n`,
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
