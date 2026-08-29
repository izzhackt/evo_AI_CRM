import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import postgres from "postgres";

import {
  CanonicalCrmRepositoryError,
  appendCanonicalInboundMessage,
  createCanonicalPersonLead,
  executeCanonicalWhatsAppSend,
  readLatestCanonicalWhatsAppSendAttempt,
  reconcileCanonicalWhatsAppSendAttempt,
} from "../src/lib/server/canonical-crm-repository.ts";
import { closeDatabaseConnections } from "../src/lib/server/database.ts";

function requiredDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  assert.ok(value, "DATABASE_URL is required for WhatsApp PostgreSQL acceptance");
  const parsed = new URL(value);
  assert.ok(
    parsed.protocol === "postgres:" || parsed.protocol === "postgresql:",
    "WhatsApp acceptance requires PostgreSQL",
  );
  return value;
}

function repositoryError(code) {
  return (error) =>
    error instanceof CanonicalCrmRepositoryError && error.code === code;
}

function requestContext(role = "sales") {
  const requestId = randomUUID();
  return {
    actorRole: role,
    idempotencyKey: requestId,
    correlationId: requestId,
  };
}

test("canonical WhatsApp send is durable, exactly-once and truthfully reconciled on PostgreSQL", async () => {
  const databaseUrl = requiredDatabaseUrl();
  const sql = postgres(databaseUrl, { idle_timeout: 5, max: 4, onnotice: () => undefined });
  const runId = randomUUID();
  const recipient = "15550004301@c.us";

  try {
    const lead = await createCanonicalPersonLead({
      ...requestContext(),
      displayName: `technical-whatsapp-${runId}`,
      email: `${runId}@acceptance.invalid`,
      source: `technical-whatsapp-${runId}`,
    });
    const inbound = await appendCanonicalInboundMessage({
      ...requestContext(),
      leadId: lead.leadId,
      channel: "whatsapp",
      externalConversationId: recipient,
      externalMessageId: `technical-inbound-${runId}`,
      body: `technical-inbound-${runId}`,
      occurredAt: "2026-08-29T08:00:00.000Z",
    });

    const acceptedContext = requestContext();
    let dispatchCalls = 0;
    const accepted = await executeCanonicalWhatsAppSend(
      acceptedContext,
      {
        conversationId: inbound.conversationId,
        sessionName: "technical-session",
        finalText: `technical-approved-reply-${runId}`,
        confirmedRecipient: recipient,
        replyToExternalMessageId: `technical-inbound-${runId}`,
      },
      async (request) => {
        dispatchCalls += 1;
        assert.equal(request.recipientChatId, recipient);
        assert.equal(request.text, `technical-approved-reply-${runId}`);
        assert.equal(request.replyToExternalMessageId, `technical-inbound-${runId}`);

        const [durableBoundary] = await sql`
          select
            a.status,
            r.status as receipt_status,
            (select count(*)::int from evo_messages m
              where m.conversation_id = ${inbound.conversationId}
                and m.direction = 'outbound') as outbound_count
          from evo_whatsapp_send_attempts a
          inner join evo_command_receipts r
            on r.idempotency_key = ${acceptedContext.idempotencyKey}
          where a.id = ${request.attemptId}
        `;
        assert.deepEqual(durableBoundary, {
          status: "prepared",
          receipt_status: "processing",
          outbound_count: 0,
        });

        return {
          status: "accepted",
          message: {
            providerMessageId: `provider-message-${runId}`,
            providerOccurredAt: "2026-08-29T08:01:00.000Z",
            recipientChatId: recipient,
            fromMe: true,
            body: `technical-approved-reply-${runId}`,
            ack: 1,
            ackName: "SERVER",
            source: "api",
          },
        };
      },
    );
    assert.equal(dispatchCalls, 1);
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.messageId !== null, true);
    assert.equal(accepted.providerMessageId, `provider-message-${runId}`);
    assert.equal(accepted.ack, 1);
    assert.equal(accepted.ackName, "SERVER");

    const replay = await executeCanonicalWhatsAppSend(
      acceptedContext,
      {
        conversationId: inbound.conversationId,
        sessionName: "technical-session",
        finalText: `technical-approved-reply-${runId}`,
        confirmedRecipient: recipient,
        replyToExternalMessageId: `technical-inbound-${runId}`,
      },
      async () => {
        dispatchCalls += 1;
        throw new Error("replay must not dispatch");
      },
    );
    assert.deepEqual(replay, accepted);
    assert.equal(dispatchCalls, 1);

    const replayAfterSessionRotation = await executeCanonicalWhatsAppSend(
      acceptedContext,
      {
        conversationId: inbound.conversationId,
        sessionName: "rotated-technical-session",
        finalText: `technical-approved-reply-${runId}`,
        confirmedRecipient: recipient,
        replyToExternalMessageId: `technical-inbound-${runId}`,
      },
      async () => {
        dispatchCalls += 1;
        throw new Error("server configuration rotation must not redispatch");
      },
    );
    assert.deepEqual(replayAfterSessionRotation, accepted);
    assert.equal(dispatchCalls, 1);

    await assert.rejects(
      executeCanonicalWhatsAppSend(
        acceptedContext,
        {
          conversationId: inbound.conversationId,
          sessionName: "technical-session",
          finalText: "changed text",
          confirmedRecipient: recipient,
        },
        async () => {
          throw new Error("changed replay must not dispatch");
        },
      ),
      repositoryError("idempotency_conflict"),
    );

    const [acceptedRows] = await sql`
      select
        (select count(*)::int from evo_messages
          where conversation_id = ${inbound.conversationId}
            and direction = 'outbound') as outbound_count,
        (select count(*)::int from evo_whatsapp_send_attempts
          where id = ${accepted.attemptId} and status = 'accepted') as attempt_count,
        (select count(*)::int from evo_business_events
          where idempotency_key = ${acceptedContext.idempotencyKey}) as event_count
    `;
    assert.deepEqual(acceptedRows, {
      outbound_count: 1,
      attempt_count: 1,
      event_count: 2,
    });

    let unauthorizedDispatchCalls = 0;
    await assert.rejects(
      executeCanonicalWhatsAppSend(
        requestContext("admissions"),
        {
          conversationId: inbound.conversationId,
          sessionName: "technical-session",
          finalText: `technical-unauthorized-${runId}`,
          confirmedRecipient: recipient,
        },
        async () => {
          unauthorizedDispatchCalls += 1;
          throw new Error("wrong-role send must fail before dispatch");
        },
      ),
      repositoryError("not_found"),
    );
    assert.equal(unauthorizedDispatchCalls, 0);

    let staleRecipientDispatchCalls = 0;
    await assert.rejects(
      executeCanonicalWhatsAppSend(
        requestContext(),
        {
          conversationId: inbound.conversationId,
          sessionName: "technical-session",
          finalText: `technical-stale-recipient-${runId}`,
          confirmedRecipient: "15550004302@c.us",
        },
        async () => {
          staleRecipientDispatchCalls += 1;
          throw new Error("stale recipient must fail before dispatch");
        },
      ),
      repositoryError("conflict"),
    );
    assert.equal(staleRecipientDispatchCalls, 0);

    const rejected = await executeCanonicalWhatsAppSend(
      requestContext(),
      {
        conversationId: inbound.conversationId,
        sessionName: "technical-session",
        finalText: `technical-rejected-${runId}`,
        confirmedRecipient: recipient,
      },
      async () => ({ status: "rejected", failureCode: "provider_forbidden" }),
    );
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.messageId, null);

    const errorAck = await executeCanonicalWhatsAppSend(
      requestContext(),
      {
        conversationId: inbound.conversationId,
        sessionName: "technical-session",
        finalText: `technical-error-ack-${runId}`,
        confirmedRecipient: recipient,
      },
      async () => ({
        status: "accepted",
        message: {
          providerMessageId: `provider-error-ack-${runId}`,
          providerOccurredAt: "2026-08-29T08:02:00.000Z",
          recipientChatId: recipient,
          fromMe: true,
          body: `technical-error-ack-${runId}`,
          ack: -1,
          ackName: "ERROR",
          source: "api",
        },
      }),
    );
    assert.equal(errorAck.status, "rejected");
    assert.equal(errorAck.failureCode, "message_rejected");
    assert.equal(errorAck.messageId, null);

    const unknownContext = requestContext();
    let unknownCalls = 0;
    const unknown = await executeCanonicalWhatsAppSend(
      unknownContext,
      {
        conversationId: inbound.conversationId,
        sessionName: "technical-session",
        finalText: `technical-unknown-${runId}`,
        confirmedRecipient: recipient,
      },
      async () => {
        unknownCalls += 1;
        return { status: "unknown", failureCode: "provider_timeout" };
      },
    );
    assert.equal(unknown.status, "unknown");
    assert.equal(unknown.messageId, null);
    assert.equal(unknown.failureCode, "provider_timeout");
    const unknownReplay = await executeCanonicalWhatsAppSend(
      unknownContext,
      {
        conversationId: inbound.conversationId,
        sessionName: "technical-session",
        finalText: `technical-unknown-${runId}`,
        confirmedRecipient: recipient,
      },
      async () => {
        unknownCalls += 1;
        throw new Error("unknown replay must not dispatch");
      },
    );
    assert.deepEqual(unknownReplay, unknown);
    assert.equal(unknownCalls, 1);

    let blindResendCalls = 0;
    await assert.rejects(
      executeCanonicalWhatsAppSend(
        requestContext(),
        {
          conversationId: inbound.conversationId,
          sessionName: "technical-session",
          finalText: `technical-blind-resend-${runId}`,
          confirmedRecipient: recipient,
        },
        async () => {
          blindResendCalls += 1;
          throw new Error("unknown attempt must block a fresh send");
        },
      ),
      repositoryError("conflict"),
    );
    assert.equal(blindResendCalls, 0);

    const [nonAcceptedMessages] = await sql`
      select count(*)::int as count
      from evo_messages
      where conversation_id = ${inbound.conversationId}
        and direction = 'outbound'
        and body in (
          ${`technical-unknown-${runId}`},
          ${`technical-rejected-${runId}`},
          ${`technical-error-ack-${runId}`}
        )
    `;
    assert.equal(nonAcceptedMessages.count, 0);

    let readCalls = 0;
    const reconciled = await reconcileCanonicalWhatsAppSendAttempt(
      requestContext(),
      { conversationId: inbound.conversationId, attemptId: accepted.attemptId },
      async (request) => {
        readCalls += 1;
        assert.equal(request.providerMessageId, `provider-message-${runId}`);
        return {
          providerMessageId: `provider-message-${runId}`,
          providerOccurredAt: "2026-08-29T08:01:00.000Z",
          recipientChatId: recipient,
          fromMe: true,
          body: `technical-approved-reply-${runId}`,
          ack: 3,
          ackName: "READ",
          source: "api",
        };
      },
    );
    assert.equal(readCalls, 1);
    assert.equal(reconciled.ack, 3);
    assert.equal(reconciled.ackName, "READ");

    const monotonic = await reconcileCanonicalWhatsAppSendAttempt(
      requestContext(),
      { conversationId: inbound.conversationId, attemptId: accepted.attemptId },
      async () => ({
        providerMessageId: `provider-message-${runId}`,
        providerOccurredAt: "2026-08-29T08:01:00.000Z",
        recipientChatId: recipient,
        fromMe: true,
        body: `technical-approved-reply-${runId}`,
        ack: 2,
        ackName: "DEVICE",
        source: "api",
      }),
    );
    assert.equal(monotonic.ack, 3);
    assert.equal(monotonic.ackName, "READ");

    assert.deepEqual(
      await readLatestCanonicalWhatsAppSendAttempt({
        actorRole: "admin",
        conversationId: inbound.conversationId,
      }),
      unknown,
    );
    await assert.rejects(
      readLatestCanonicalWhatsAppSendAttempt({
        actorRole: "admissions",
        conversationId: inbound.conversationId,
      }),
      repositoryError("not_found"),
    );
  } finally {
    await closeDatabaseConnections();
    await sql.end({ timeout: 5 });
  }
});

test("an unknown WhatsApp attempt is recovered exactly once from one bounded provider read", async () => {
  const databaseUrl = requiredDatabaseUrl();
  const sql = postgres(databaseUrl, {
    idle_timeout: 5,
    max: 4,
    onnotice: () => undefined,
  });
  const runId = randomUUID();
  let scenarioSequence = 0;

  async function createAttempt(status = "unknown") {
    scenarioSequence += 1;
    const scenario = scenarioSequence;
    const recipient = `155501${String(scenario).padStart(5, "0")}@c.us`;
    const finalText = `technical-recovery-${scenario}-${runId}`;
    const lead = await createCanonicalPersonLead({
      ...requestContext(),
      displayName: `technical-recovery-${scenario}-${runId}`,
      email: `${scenario}-${runId}@acceptance.invalid`,
      source: `technical-recovery-${runId}`,
    });
    const inbound = await appendCanonicalInboundMessage({
      ...requestContext(),
      leadId: lead.leadId,
      channel: "whatsapp",
      externalConversationId: recipient,
      externalMessageId: `technical-recovery-inbound-${scenario}-${runId}`,
      body: `technical-recovery-inbound-${scenario}-${runId}`,
      occurredAt: "2026-08-29T08:20:00.000Z",
    });
    const attempt = await executeCanonicalWhatsAppSend(
      requestContext(),
      {
        conversationId: inbound.conversationId,
        sessionName: "technical-recovery-session",
        finalText,
        confirmedRecipient: recipient,
      },
      async () =>
        status === "unknown"
          ? { status: "unknown", failureCode: "provider_timeout" }
          : { status: "rejected", failureCode: "provider_forbidden" },
    );
    return {
      attempt,
      conversationId: inbound.conversationId,
      finalText,
      recipient,
    };
  }

  function occurredInside(attempt) {
    assert.ok(attempt.settledAt);
    return new Date(
      Math.floor(
        (Date.parse(attempt.createdAt) + Date.parse(attempt.settledAt)) / 2,
      ),
    ).toISOString();
  }

  async function assertStillUnknown(scenario) {
    assert.deepEqual(
      await readLatestCanonicalWhatsAppSendAttempt({
        actorRole: "admin",
        conversationId: scenario.conversationId,
      }),
      scenario.attempt,
    );
  }

  try {
    const scenario = await createAttempt();
    assert.equal(scenario.attempt.status, "unknown");
    assert.equal(scenario.attempt.providerMessageId, null);
    assert.ok(scenario.attempt.settledAt);

    let wrongRoleReads = 0;
    await assert.rejects(
      reconcileCanonicalWhatsAppSendAttempt(
        requestContext("admissions"),
        {
          conversationId: scenario.conversationId,
          attemptId: scenario.attempt.attemptId,
        },
        async () => {
          wrongRoleReads += 1;
          throw new Error(
            "wrong-role reconcile must fail before provider read",
          );
        },
      ),
      repositoryError("not_found"),
    );
    assert.equal(wrongRoleReads, 0);
    await assertStillUnknown(scenario);

    for (const [label, providerMessage] of [
      [
        "body",
        {
          providerMessageId: `provider-wrong-body-${runId}`,
          providerOccurredAt: occurredInside(scenario.attempt),
          recipientChatId: scenario.recipient,
          fromMe: true,
          body: `${scenario.finalText}-changed`,
          ack: 1,
          ackName: "SERVER",
          source: "api",
        },
      ],
      [
        "recipient",
        {
          providerMessageId: `provider-wrong-recipient-${runId}`,
          providerOccurredAt: occurredInside(scenario.attempt),
          recipientChatId: "15550999999@c.us",
          fromMe: true,
          body: scenario.finalText,
          ack: 1,
          ackName: "SERVER",
          source: "api",
        },
      ],
      [
        "time-window",
        {
          providerMessageId: `provider-outside-window-${runId}`,
          providerOccurredAt: new Date(
            (Math.ceil(Date.parse(scenario.attempt.settledAt) / 1_000) + 1) *
              1_000,
          ).toISOString(),
          recipientChatId: scenario.recipient,
          fromMe: true,
          body: scenario.finalText,
          ack: 1,
          ackName: "SERVER",
          source: "api",
        },
      ],
    ]) {
      await assert.rejects(
        reconcileCanonicalWhatsAppSendAttempt(
          requestContext(),
          {
            conversationId: scenario.conversationId,
            attemptId: scenario.attempt.attemptId,
          },
          async () => providerMessage,
        ),
        repositoryError("unavailable"),
        `${label} mismatch must fail closed`,
      );
      await assertStillUnknown(scenario);
    }

    const rejected = await createAttempt("rejected");
    let rejectedReads = 0;
    await assert.rejects(
      reconcileCanonicalWhatsAppSendAttempt(
        requestContext(),
        {
          conversationId: rejected.conversationId,
          attemptId: rejected.attempt.attemptId,
        },
        async () => {
          rejectedReads += 1;
          throw new Error("rejected attempt must fail before provider read");
        },
      ),
      repositoryError("conflict"),
    );
    assert.equal(rejectedReads, 0);
    assert.deepEqual(
      await readLatestCanonicalWhatsAppSendAttempt({
        actorRole: "admin",
        conversationId: rejected.conversationId,
      }),
      rejected.attempt,
    );

    const recoveryContext = requestContext();
    const providerMessageId = `provider-recovered-${runId}`;
    let recoveryReads = 0;
    const recovered = await reconcileCanonicalWhatsAppSendAttempt(
      recoveryContext,
      {
        conversationId: scenario.conversationId,
        attemptId: scenario.attempt.attemptId,
      },
      async (request) => {
        recoveryReads += 1;
        assert.deepEqual(request, {
          attemptId: scenario.attempt.attemptId,
          sessionName: "technical-recovery-session",
          recipientChatId: scenario.recipient,
          providerMessageId: null,
          expectedText: scenario.finalText,
          windowStartedAt: scenario.attempt.createdAt,
          windowEndedAt: scenario.attempt.settledAt,
        });
        return {
          providerMessageId,
          providerOccurredAt: new Date(
            Math.floor(Date.parse(scenario.attempt.createdAt) / 1_000) * 1_000,
          ).toISOString(),
          recipientChatId: scenario.recipient,
          fromMe: true,
          body: scenario.finalText,
          ack: 3,
          ackName: "READ",
          source: "api",
        };
      },
    );
    assert.equal(recoveryReads, 1);
    assert.equal(recovered.attemptId, scenario.attempt.attemptId);
    assert.equal(recovered.status, "accepted");
    assert.ok(recovered.messageId);
    assert.equal(recovered.providerMessageId, providerMessageId);
    assert.equal(recovered.ack, 3);
    assert.equal(recovered.ackName, "READ");
    assert.equal(recovered.failureCode, null);
    assert.equal(recovered.settledAt, scenario.attempt.settledAt);
    assert.ok(recovered.lastReconciledAt);

    const replay = await reconcileCanonicalWhatsAppSendAttempt(
      recoveryContext,
      {
        conversationId: scenario.conversationId,
        attemptId: scenario.attempt.attemptId,
      },
      async () => {
        recoveryReads += 1;
        throw new Error("exact recovery replay must not read the provider");
      },
    );
    assert.deepEqual(replay, recovered);
    assert.equal(recoveryReads, 1);

    const [durable] = await sql`
      select
        attempt.status,
        attempt.failure_code,
        message.external_message_id,
        message.body,
        event.transition,
        receipt.status as receipt_status
      from evo_whatsapp_send_attempts as attempt
      inner join evo_messages as message on message.id = attempt.message_id
      inner join evo_business_events as event
        on event.business_object_type = 'whatsapp_send_attempt'
        and event.business_object_id = attempt.id
        and event.transition = 'whatsapp_send.recovered'
      inner join evo_command_receipts as receipt
        on receipt.business_object_type = 'whatsapp_send_attempt'
        and receipt.business_object_id = attempt.id
        and receipt.command_name = 'canonical_whatsapp.reconcile'
      where attempt.id = ${scenario.attempt.attemptId}
    `;
    assert.deepEqual(durable, {
      status: "accepted",
      failure_code: null,
      external_message_id: providerMessageId,
      body: scenario.finalText,
      transition: "whatsapp_send.recovered",
      receipt_status: "succeeded",
    });
    const [{ message_count: messageCount }] = await sql`
      select count(*)::int as message_count
      from evo_messages
      where conversation_id = ${scenario.conversationId}
        and direction = 'outbound'
        and external_message_id = ${providerMessageId}
    `;
    assert.equal(messageCount, 1);

    const endBoundary = await createAttempt();
    const endBoundaryResult = await reconcileCanonicalWhatsAppSendAttempt(
      requestContext(),
      {
        conversationId: endBoundary.conversationId,
        attemptId: endBoundary.attempt.attemptId,
      },
      async (request) => {
        assert.equal(request.windowStartedAt, endBoundary.attempt.createdAt);
        assert.equal(request.windowEndedAt, endBoundary.attempt.settledAt);
        return {
          providerMessageId: `provider-window-end-${runId}`,
          providerOccurredAt: new Date(
            Math.ceil(Date.parse(endBoundary.attempt.settledAt) / 1_000) *
              1_000,
          ).toISOString(),
          recipientChatId: endBoundary.recipient,
          fromMe: true,
          body: endBoundary.finalText,
          ack: 1,
          ackName: "SERVER",
          source: "api",
        };
      },
    );
    assert.equal(endBoundaryResult.status, "accepted");

    const reused = await createAttempt();
    let reusedReads = 0;
    await assert.rejects(
      reconcileCanonicalWhatsAppSendAttempt(
        recoveryContext,
        {
          conversationId: reused.conversationId,
          attemptId: reused.attempt.attemptId,
        },
        async () => {
          reusedReads += 1;
          throw new Error("changed recovery reuse must not read the provider");
        },
      ),
      repositoryError("idempotency_conflict"),
    );
    assert.equal(reusedReads, 0);
    await assertStillUnknown(reused);

    const duplicate = await createAttempt();
    await assert.rejects(
      reconcileCanonicalWhatsAppSendAttempt(
        requestContext(),
        {
          conversationId: duplicate.conversationId,
          attemptId: duplicate.attempt.attemptId,
        },
        async () => ({
          providerMessageId,
          providerOccurredAt: occurredInside(duplicate.attempt),
          recipientChatId: duplicate.recipient,
          fromMe: true,
          body: duplicate.finalText,
          ack: 3,
          ackName: "READ",
          source: "api",
        }),
      ),
      repositoryError("unavailable"),
    );
    await assertStillUnknown(duplicate);
    const [{ duplicate_count: duplicateCount }] = await sql`
      select count(*)::int as duplicate_count
      from evo_messages
      where conversation_id = ${duplicate.conversationId}
        and direction = 'outbound'
    `;
    assert.equal(duplicateCount, 0);
  } finally {
    await closeDatabaseConnections();
    await sql.end({ timeout: 5 });
  }
});

test("parallel exact replay serializes to one WhatsApp dispatch on PostgreSQL", async () => {
  const databaseUrl = requiredDatabaseUrl();
  const sql = postgres(databaseUrl, { idle_timeout: 5, max: 4, onnotice: () => undefined });
  const runId = randomUUID();
  const recipient = "15550004303@lid";
  const context = requestContext();
  let dispatchCalls = 0;
  let enterDispatch;
  let releaseDispatch;
  const dispatchEntered = new Promise((resolve) => {
    enterDispatch = resolve;
  });
  const dispatchGate = new Promise((resolve) => {
    releaseDispatch = resolve;
  });

  try {
    const lead = await createCanonicalPersonLead({
      ...requestContext(),
      displayName: `technical-whatsapp-concurrency-${runId}`,
      email: `${runId}-concurrency@acceptance.invalid`,
      source: `technical-whatsapp-concurrency-${runId}`,
    });
    const inbound = await appendCanonicalInboundMessage({
      ...requestContext(),
      leadId: lead.leadId,
      channel: "whatsapp",
      externalConversationId: recipient,
      externalMessageId: `technical-concurrent-inbound-${runId}`,
      body: `technical-concurrent-inbound-${runId}`,
      occurredAt: "2026-08-29T08:10:00.000Z",
    });
    const input = {
      conversationId: inbound.conversationId,
      sessionName: "technical-session",
      finalText: `technical-concurrent-reply-${runId}`,
      confirmedRecipient: recipient,
    };
    const providerMessage = {
      providerMessageId: `provider-concurrent-${runId}`,
      providerOccurredAt: "2026-08-29T08:11:00.000Z",
      recipientChatId: recipient,
      fromMe: true,
      body: input.finalText,
      ack: 1,
      ackName: "SERVER",
      source: "api",
    };

    const first = executeCanonicalWhatsAppSend(context, input, async () => {
      dispatchCalls += 1;
      enterDispatch();
      await dispatchGate;
      return { status: "accepted", message: providerMessage };
    });
    await dispatchEntered;
    const second = executeCanonicalWhatsAppSend(context, input, async () => {
      dispatchCalls += 1;
      throw new Error("parallel replay must not dispatch");
    });
    await new Promise((resolve) => setImmediate(resolve));
    releaseDispatch();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.deepEqual(secondResult, firstResult);
    assert.equal(dispatchCalls, 1);

    const [counts] = await sql`
      select
        (select count(*)::int from evo_whatsapp_send_attempts
          where idempotency_key = ${context.idempotencyKey}) as attempt_count,
        (select count(*)::int from evo_messages
          where conversation_id = ${inbound.conversationId}
            and direction = 'outbound'
            and body = ${input.finalText}) as message_count,
        (select count(*)::int from evo_command_receipts
          where idempotency_key = ${context.idempotencyKey}
            and status = 'succeeded') as receipt_count
    `;
    assert.deepEqual(counts, {
      attempt_count: 1,
      message_count: 1,
      receipt_count: 1,
    });
  } finally {
    releaseDispatch?.();
    await closeDatabaseConnections();
    await sql.end({ timeout: 5 });
  }
});
