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
