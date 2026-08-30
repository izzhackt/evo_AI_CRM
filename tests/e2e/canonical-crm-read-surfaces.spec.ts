import { createHmac, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import postgres from "postgres";

const mode = process.env.EVO_EXPECT_CANONICAL_READ_MODE ?? "configured";
const unavailableProbeLeadId = "00000000-0000-4000-8000-000000000429";
const unavailableProbeConversationId =
  "00000000-0000-4000-8000-000000000430";
const inboundPhone = process.env.EVO_V2_INBOUND_TEST_PHONE ?? "+15550004300";
const inboundConversationId =
  process.env.EVO_V2_INBOUND_TEST_CONVERSATION_ID ??
  "15550004300@c.us";
const inboundMessageId =
  process.env.EVO_V2_INBOUND_TEST_MESSAGE_ID ?? "v2-browser-message-430";
const inboundText =
  process.env.EVO_V2_INBOUND_TEST_TEXT ?? "V2 inbound browser proof 430";
const expectedWahaSessionName =
  process.env.EVO_EXPECT_WAHA_SESSION_NAME ?? "evo-v2-technical";
const wahaAcceptanceResultFile =
  process.env.EVO_V2_WAHA_ACCEPTANCE_RESULT_FILE ?? "";
const expectedWahaSelfLid =
  process.env.EVO_EXPECT_WAHA_SELF_LID ?? "100000000000000@lid";
const outboundRecipient = inboundPhone.replace(/^\+/u, "") + "@c.us";
const outboundText = "V2 isolated browser send proof 465";
const recoveryInboundPhone = "+971500000000";
const recoveryInboundConversationId = "971500000000@c.us";
const recoveryRecipient = "971500000000@c.us";
const recoveryText = "V2 isolated unknown recovery proof 465";

function requireUuid(name: string): string {
  const value = process.env[name];
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error(`${name} must be a valid non-nil UUID`);
  }
  return value.toLowerCase();
}

type TestRole = "admin" | "sales" | "admissions";

function credentials(role: TestRole) {
  const prefix = `EVO_DEV_GATE_${role.toUpperCase()}`;
  const identifier = process.env[`${prefix}_IDENTIFIER`];
  const secret = process.env[`${prefix}_SECRET`];
  if (!identifier || !secret) {
    throw new Error(`missing browser credential for ${role}`);
  }
  return { identifier, secret };
}

async function submitGate(page: Page, role: TestRole) {
  const { identifier, secret } = credentials(role);
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("#gate-identifier").fill(identifier);
  await page.locator("#gate-secret").fill(secret);
  await page.getByRole("button", { name: "Открыть CRM" }).click();
  await expect(page.getByTestId("development-workspace")).toBeVisible();
  await page.getByTestId("open-role-workspace").click();
}

function requireInboundSecret(): string {
  const value = process.env.EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET;
  if (!value) throw new Error("missing V2 inbound test secret");
  return value;
}

async function canonicalProposalCount(conversationId: string): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("missing canonical PostgreSQL test URL");
  const sql = postgres(databaseUrl, {
    idle_timeout: 5,
    max: 1,
    onnotice: () => undefined,
  });
  try {
    const [row] = await sql`
      select count(*)::int as count
      from evo_ai_proposals
      where conversation_id = ${conversationId}
    `;
    return Number(row.count);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function canonicalWhatsAppOutboundProof(conversationId: string) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("missing canonical PostgreSQL test URL");
  const sql = postgres(databaseUrl, {
    idle_timeout: 5,
    max: 1,
    onnotice: () => undefined,
  });
  try {
    const [row] = await sql`
      select
        attempt.status,
        attempt.session_name,
        attempt.recipient_chat_id,
        attempt.final_text,
        attempt.actor_role,
        attempt.provider_message_id,
        attempt.failure_code,
        attempt.ack,
        attempt.ack_name,
        message.direction,
        message.body,
        message.external_message_id,
        (
          select count(*)::int
          from evo_whatsapp_send_attempts as counted_attempt
          where counted_attempt.conversation_id = ${conversationId}
        ) as attempt_count,
        (
          select count(*)::int
          from evo_messages as counted_message
          where counted_message.conversation_id = ${conversationId}
            and counted_message.direction = 'outbound'
        ) as outbound_count
      from evo_whatsapp_send_attempts as attempt
      left join evo_messages as message on message.id = attempt.message_id
      where attempt.conversation_id = ${conversationId}
      order by attempt.created_at desc, attempt.id desc
      limit 1
    `;
    return row;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function seedCanonicalProposal(
  conversationId: string,
  messageId: string,
  options: Readonly<{
    proposalText?: string;
    providerCreatedAt?: string;
  }> = {},
): Promise<Readonly<{ proposalId: string; proposalText: string; outboundCount: number }>> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("missing canonical PostgreSQL test URL");
  const sql = postgres(databaseUrl, {
    idle_timeout: 5,
    max: 1,
    onnotice: () => undefined,
  });
  try {
    const [source] = await sql`
      select
        message.id as message_id,
        message.body,
        message.direction,
        message.occurred_at,
        (
          select student_case.id
          from evo_student_cases as student_case
          where student_case.lead_id = conversation.lead_id
          order by student_case.created_at desc, student_case.id desc
          limit 1
        ) as student_case_id,
        (
          select count(*)::int
          from evo_messages as outbound
          where outbound.conversation_id = conversation.id
            and outbound.direction = 'outbound'
        ) as outbound_count
      from evo_conversations as conversation
      inner join evo_messages as message
        on message.conversation_id = conversation.id
      where conversation.id = ${conversationId}
        and message.id = ${messageId}
        and message.direction = 'inbound'
    `;
    assert.ok(source, "canonical inbound source must exist before technical proposal seeding");
    const occurredAt = new Date(source.occurred_at).toISOString();
    const providerCreatedAt = options.providerCreatedAt ?? new Date().toISOString();
    const proposalId = randomUUID();
    const proposalText =
      options.proposalText ?? "Technical browser-review proposal; not provider output.";
    const sourceMessage = {
      id: String(source.message_id),
      direction: "inbound",
      occurredAt,
      body: String(source.body),
    } as const;
    const sourceContext = {
      schemaVersion: 1,
      promptPolicyVersion: "evo-v2-9c-browser-technical-v1",
      conversationId,
      studentCaseId:
        source.student_case_id === null ? null : String(source.student_case_id),
      sourceMessage,
      messages: [sourceMessage],
    };
    await sql`
      insert into evo_ai_proposals (
        id,
        conversation_id,
        student_case_id,
        provider,
        model,
        proposal_text,
        source_context,
        provider_created_at,
        correlation_id,
        idempotency_key
      ) values (
        ${proposalId},
        ${conversationId},
        ${sourceContext.studentCaseId},
        'gemini',
        'technical-browser-no-provider',
        ${proposalText},
        ${sql.json(sourceContext)},
        ${providerCreatedAt},
        ${`browser-review:${proposalId}`},
        ${`browser-review:${proposalId}`}
      )
    `;
    return {
      proposalId,
      proposalText,
      outboundCount: Number(source.outbound_count),
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function canonicalProposalReviewProof(proposalId: string) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("missing canonical PostgreSQL test URL");
  const sql = postgres(databaseUrl, {
    idle_timeout: 5,
    max: 1,
    onnotice: () => undefined,
  });
  try {
    const [row] = await sql`
      select
        proposal.review_decision,
        proposal.reviewed_text,
        proposal.reviewed_by_role,
        proposal.reviewed_at,
        proposal.review_reason,
        (
          select count(*)::int
          from evo_business_events as event
          where event.business_object_type = 'ai_proposal'
            and event.business_object_id = proposal.id
            and event.transition = 'ai_proposal.accepted'
        ) as accepted_event_count,
        (
          select count(*)::int
          from evo_business_events as event
          where event.business_object_type = 'ai_proposal'
            and event.business_object_id = proposal.id
            and event.transition = 'ai_proposal.edited'
        ) as edited_event_count,
        (
          select count(*)::int
          from evo_business_events as event
          where event.business_object_type = 'ai_proposal'
            and event.business_object_id = proposal.id
            and event.transition = 'ai_proposal.rejected'
        ) as rejected_event_count,
        (
          select count(*)::int
          from evo_command_receipts as receipt
          where receipt.business_object_type = 'ai_proposal'
            and receipt.business_object_id = proposal.id
            and receipt.command_name = 'canonical_gemini_proposal.review'
            and receipt.status = 'succeeded'
        ) as succeeded_receipt_count,
        (
          select count(*)::int
          from evo_messages as outbound
          where outbound.conversation_id = proposal.conversation_id
            and outbound.direction = 'outbound'
        ) as outbound_count
      from evo_ai_proposals as proposal
      where proposal.id = ${proposalId}
    `;
    assert.ok(row, "reviewed canonical proposal must remain persisted");
    return row;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function signedInboundHeaders(rawBody: string, timestamp: string) {
  const signature = createHmac("sha256", requireInboundSecret())
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-evo-v2-timestamp": timestamp,
    "x-evo-v2-signature": signature,
  };
}

async function postSignedInbound(
  request: APIRequestContext,
  rawBody: string,
  timestamp = Math.floor(Date.now() / 1_000).toString(),
) {
  return request.post("/api/v2/whatsapp/inbound", {
    data: rawBody,
    headers: signedInboundHeaders(rawBody, timestamp),
  });
}

async function reviewTechnicalProposalViaUi(
  page: Page,
  conversationId: string,
  messageId: string,
  input: Readonly<{
    decision: "accepted" | "edited" | "rejected";
    proposalText: string;
    providerCreatedAt: string;
    reviewedText?: string;
    reviewReason?: string;
  }>,
) {
  const technicalProposal = await seedCanonicalProposal(conversationId, messageId, {
    proposalText: input.proposalText,
    providerCreatedAt: input.providerCreatedAt,
  });
  if (input.decision === "edited") {
    const reviewedText = input.reviewedText;
    if (!reviewedText) throw new Error("edited review requires reviewedText");
    await page.addInitScript(
      (proposalText) => {
        const capturePreHydrationState = () => {
          const editor = document.querySelector<HTMLTextAreaElement>(
            '[data-testid="canonical-gemini-review-edited-text"]',
          );
          if (!editor || editor.value !== proposalText) return;
          editor.dataset.preHydrationDisabled = String(editor.disabled);
          observer.disconnect();
        };
        const observer = new MutationObserver(capturePreHydrationState);
        observer.observe(document, { childList: true, subtree: true });
        capturePreHydrationState();
      },
      input.proposalText,
    );
  }
  await page.reload();
  const storedProposal = page.getByTestId("canonical-gemini-proposal-latest");
  await expect(storedProposal).toHaveAttribute(
    "data-proposal-id",
    technicalProposal.proposalId,
  );
  await expect(storedProposal).toHaveAttribute("data-review-decision", "pending");
  await expect(storedProposal).toContainText(technicalProposal.proposalText);
  await expect(page.getByTestId("canonical-gemini-review-controls")).toBeVisible();

  if (input.decision === "accepted") {
    await page.getByTestId("canonical-gemini-review-accept").click();
  } else if (input.decision === "edited") {
    const reviewedText = input.reviewedText;
    if (!reviewedText) throw new Error("edited review requires reviewedText");
    const editor = page.getByTestId("canonical-gemini-review-edited-text");
    await expect(editor).toHaveAttribute("data-pre-hydration-disabled", "true");
    await expect(editor).toBeEnabled();
    await editor.fill(reviewedText);
    await expect(editor).toHaveValue(reviewedText);
    await page.getByTestId("canonical-gemini-review-edit").click();
  } else {
    const reviewReason = input.reviewReason;
    if (!reviewReason) throw new Error("rejected review requires reviewReason");
    await page.getByTestId("canonical-gemini-review-reason").fill(reviewReason);
    await page.getByTestId("canonical-gemini-review-reject").click();
  }

  await expect(page.getByTestId("canonical-gemini-review-final")).toHaveAttribute(
    "data-review-decision",
    input.decision,
  );
  await expect(page.getByTestId("canonical-gemini-review-controls")).toHaveCount(0);

  const reviewProof = await canonicalProposalReviewProof(technicalProposal.proposalId);
  assert.equal(reviewProof.review_decision, input.decision);
  assert.equal(reviewProof.reviewed_by_role, "sales");
  assert.ok(reviewProof.reviewed_at, `${input.decision} review must store its timestamp`);
  assert.equal(Number(reviewProof.succeeded_receipt_count), 1);

  if (input.decision === "accepted") {
    assert.equal(reviewProof.reviewed_text, technicalProposal.proposalText);
    assert.equal(reviewProof.review_reason, null);
    assert.equal(Number(reviewProof.accepted_event_count), 1);
    assert.equal(Number(reviewProof.edited_event_count), 0);
    assert.equal(Number(reviewProof.rejected_event_count), 0);
  } else if (input.decision === "edited") {
    assert.equal(reviewProof.reviewed_text, input.reviewedText);
    assert.equal(reviewProof.review_reason, null);
    assert.equal(Number(reviewProof.accepted_event_count), 0);
    assert.equal(Number(reviewProof.edited_event_count), 1);
    assert.equal(Number(reviewProof.rejected_event_count), 0);
    await expect(page.getByTestId("canonical-gemini-review-final-text")).toContainText(
      input.reviewedText ?? "",
    );
  } else {
    assert.equal(reviewProof.reviewed_text, null);
    assert.equal(reviewProof.review_reason, input.reviewReason);
    assert.equal(Number(reviewProof.accepted_event_count), 0);
    assert.equal(Number(reviewProof.edited_event_count), 0);
    assert.equal(Number(reviewProof.rejected_event_count), 1);
    await expect(page.getByTestId("canonical-gemini-review-final-reason")).toContainText(
      input.reviewReason ?? "",
    );
    await expect(page.getByTestId("canonical-gemini-review-final-text")).toHaveCount(0);
  }

  assert.equal(
    Number(reviewProof.outbound_count),
    technicalProposal.outboundCount,
    `${input.decision} review must not create an outbound WhatsApp message`,
  );

  return technicalProposal;
}

async function postAcceptedInbound(
  request: APIRequestContext,
  payload: Readonly<{
    event: "message.received";
    senderPhone: string;
    externalConversationId: string;
    externalMessageId: string;
    text: string;
    occurredAt: string;
  }>,
) {
  const response = await postSignedInbound(request, JSON.stringify(payload));
  expect(response.status()).toBe(202);
  const body = (await response.json()) as Record<string, unknown>;
  const conversationId = String(body.conversationId);
  const messageId = String(body.messageId);
  expect(conversationId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect(messageId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  return { conversationId, messageId };
}

test("missing PostgreSQL authority fails closed without a read fallback", async ({
  page,
}) => {
  test.skip(mode !== "unavailable", "only exercised in unavailable mode");

  await submitGate(page, "admissions");
  await expect(page).toHaveURL(/\/clients(?:\?|$)/);
  await expect(page.getByTestId("canonical-records-unavailable")).toBeVisible();
  await expect(page.getByTestId("canonical-student-cases-page")).toHaveCount(0);

  await submitGate(page, "sales");
  await expect(page).toHaveURL(/\/sales(?:\?|$)/);
  await expect(page.getByTestId("canonical-records-unavailable")).toBeVisible();
  await expect(page.getByTestId("canonical-sales-page")).toBeVisible();
  await page.goto(`/sales/${unavailableProbeLeadId}`);
  await expect(page.getByTestId("canonical-records-unavailable")).toBeVisible();
  await expect(page.getByTestId("canonical-lead-detail")).toHaveCount(0);

  await page.goto(
    `/sales/${unavailableProbeLeadId}/conversations/${unavailableProbeConversationId}`,
  );
  await expect(page.getByTestId("canonical-records-unavailable")).toBeVisible();
  await expect(page.getByTestId("canonical-sales-transcript")).toHaveCount(0);

  await page.goto("/whatsapp");
  await expect(page.getByTestId("whatsapp-error")).toBeVisible();
  await expect(page.getByTestId("canonical-staff-whatsapp-page")).toHaveCount(0);

  await page.goto(`/whatsapp/${unavailableProbeConversationId}`);
  await expect(page.getByTestId("whatsapp-error")).toBeVisible();
  await expect(page.getByTestId("canonical-staff-whatsapp-thread")).toHaveCount(0);
});

test("missing inbound secret fails closed at the real HTTP boundary", async ({
  request,
}) => {
  test.skip(
    mode !== "inbound-unavailable",
    "only exercised without inbound secret",
  );
  const rawBody = JSON.stringify({
    event: "message.received",
    senderPhone: inboundPhone,
    externalConversationId: inboundConversationId,
    externalMessageId: inboundMessageId,
    text: inboundText,
    occurredAt: "2026-08-28T12:00:00.000Z",
  });

  const response = await postSignedInbound(request, rawBody);
  expect(response.status()).toBe(503);
  expect(await response.json()).toEqual({
    ok: false,
    error: "inbound_unavailable",
  });
});

test("signed inbound HTTP persists once and is visible in the Sales transcript", async ({
  page,
  request,
}) => {
  test.skip(mode !== "configured", "only exercised in configured mode");
  test.setTimeout(90_000);
  const occurredAt = "2026-08-28T12:00:00.000Z";
  const payload = {
    event: "message.received",
    senderPhone: inboundPhone,
    externalConversationId: inboundConversationId,
    externalMessageId: inboundMessageId,
    text: inboundText,
    occurredAt,
  } as const;
  const rawBody = JSON.stringify(payload);
  const now = Math.floor(Date.now() / 1_000).toString();

  const invalidSignature = await request.post("/api/v2/whatsapp/inbound", {
    data: rawBody,
    headers: {
      "content-type": "application/json",
      "x-evo-v2-timestamp": now,
      "x-evo-v2-signature": "0".repeat(64),
    },
  });
  expect(invalidSignature.status()).toBe(403);

  const stale = (Math.floor(Date.now() / 1_000) - 301).toString();
  expect((await postSignedInbound(request, rawBody, stale)).status()).toBe(403);

  const wrongMediaType = await request.post("/api/v2/whatsapp/inbound", {
    data: rawBody,
    headers: {
      ...signedInboundHeaders(rawBody, now),
      "content-type": "text/plain",
    },
  });
  expect(wrongMediaType.status()).toBe(415);

  const invalidRawBody = JSON.stringify({ ...payload, unexpected: true });
  expect((await postSignedInbound(request, invalidRawBody)).status()).toBe(400);

  const oversizedRawBody = JSON.stringify({
    ...payload,
    text: "x".repeat(65_536),
  });
  expect((await postSignedInbound(request, oversizedRawBody)).status()).toBe(413);

  const accepted = await postSignedInbound(request, rawBody);
  expect(accepted.status()).toBe(202);
  const acceptedBody = (await accepted.json()) as Record<string, unknown>;
  expect(acceptedBody.ok).toBe(true);
  const leadId = String(acceptedBody.leadId);
  const conversationId = String(acceptedBody.conversationId);
  const messageId = String(acceptedBody.messageId);
  for (const value of [leadId, conversationId, messageId]) {
    expect(value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  }

  const replay = await postSignedInbound(request, rawBody);
  expect(replay.status()).toBe(202);
  expect(await replay.json()).toEqual(acceptedBody);

  const changedRawBody = JSON.stringify({
    ...payload,
    text: `${inboundText} changed`,
  });
  expect((await postSignedInbound(request, changedRawBody)).status()).toBe(409);

  await submitGate(page, "sales");
  await page.goto(`/sales?q=${encodeURIComponent(inboundPhone)}`);
  await expect(
    page.locator(
      `[data-testid="canonical-lead-row"][data-lead-id="${leadId}"]`,
    ),
  ).toBeVisible();

  await page.goto(`/sales/${leadId}`);
  const conversationLink = page.locator(
    `[data-testid="canonical-sales-conversation-link"][data-conversation-id="${conversationId}"]`,
  );
  await expect(conversationLink).toBeVisible();
  await conversationLink.click();
  await expect(page).toHaveURL(
    new RegExp(`/sales/${leadId}/conversations/${conversationId}$`),
  );
  await expect(page.getByTestId("canonical-sales-transcript")).toContainText(
    inboundText,
  );
  await expect(
    page.locator(
      `[data-testid="canonical-sales-message"][data-message-id="${messageId}"]`,
    ),
  ).toBeVisible();
  await expect(
    page.getByTestId("canonical-whatsapp-provider-blocked"),
  ).toBeVisible();

  await page.goto("/whatsapp");
  await expect(page.getByTestId("canonical-staff-whatsapp-page")).toBeVisible();
  const staffQueueRow = page.locator(
    `[data-testid="canonical-staff-whatsapp-row"][data-conversation-id="${conversationId}"]`,
  );
  await expect(staffQueueRow).toBeVisible();
  await staffQueueRow.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/whatsapp/${conversationId}$`));
  await expect(page.getByTestId("canonical-staff-whatsapp-thread")).toContainText(
    inboundText,
  );
  await expect(
    page.locator(
      `[data-testid="canonical-staff-whatsapp-message"][data-message-id="${messageId}"]`,
    ),
  ).toBeVisible();
  const composer = page.getByTestId("canonical-whatsapp-outbound-composer");
  await expect(composer).toBeVisible();
  await expect(
    page.getByTestId("canonical-whatsapp-provider-availability"),
  ).toHaveAttribute("data-status", "configured");
  const proposalCountBefore = await canonicalProposalCount(conversationId);
  await expect(
    page.getByTestId("canonical-gemini-proposal-panel"),
  ).toBeVisible();
  await expect(
    page.getByTestId("canonical-gemini-proposal-availability"),
  ).toHaveAttribute("data-reason", "provider_not_authorized");
  await page.getByTestId("canonical-gemini-proposal-request").click();
  await expect(
    page.getByTestId("canonical-gemini-proposal-action-state"),
  ).toHaveAttribute("data-status", "blocked");
  await expect(
    page.getByTestId("canonical-gemini-proposal-action-state"),
  ).toHaveAttribute("data-reason", "provider_not_authorized");
  assert.equal(
    await canonicalProposalCount(conversationId),
    proposalCountBefore,
    "a blocked provider request must not persist a proposal",
  );
  const technicalReviewBaseMs = Date.now() + 5_000;
  await reviewTechnicalProposalViaUi(page, conversationId, messageId, {
    decision: "accepted",
    proposalText: "Technical browser-review accept proposal; not provider output.",
    providerCreatedAt: new Date(technicalReviewBaseMs).toISOString(),
  });
  await reviewTechnicalProposalViaUi(page, conversationId, messageId, {
    decision: "edited",
    proposalText: "Technical browser-review edit proposal; not provider output.",
    providerCreatedAt: new Date(technicalReviewBaseMs + 1_000).toISOString(),
    reviewedText: "Edited technical final answer for browser proof.",
  });
  await reviewTechnicalProposalViaUi(page, conversationId, messageId, {
    decision: "rejected",
    proposalText: "Technical browser-review reject proposal; not provider output.",
    providerCreatedAt: new Date(technicalReviewBaseMs + 2_000).toISOString(),
    reviewReason: "Technical rejection reason for browser proof.",
  });
  const recipient = page.getByTestId("canonical-whatsapp-outbound-recipient");
  const finalText = page.getByTestId("canonical-whatsapp-outbound-text");
  const confirmation = page.getByTestId("canonical-whatsapp-outbound-confirm");
  const send = page.getByTestId("canonical-whatsapp-outbound-send");
  await expect(recipient).toContainText(outboundRecipient);
  await finalText.fill(outboundText);
  await expect(send).toBeDisabled();
  await confirmation.check();
  await expect(send).toBeEnabled();
  await send.click();

  const sendState = page.getByTestId("canonical-whatsapp-outbound-state");
  await expect(sendState).toHaveAttribute("data-status", "accepted");
  await expect(sendState).toContainText(/сообщение сохранено в EVO/i);
  await expect(page.getByTestId("canonical-whatsapp-latest-attempt")).toContainText(
    /accepted/i,
  );
  await expect(page.getByTestId("canonical-staff-whatsapp-thread")).toContainText(
    outboundText,
  );

  const databaseProof = await canonicalWhatsAppOutboundProof(conversationId);
  assert.ok(databaseProof, "the canonical send must persist an accepted attempt");
  assert.equal(databaseProof.status, "accepted");
  assert.equal(databaseProof.session_name, expectedWahaSessionName);
  assert.equal(databaseProof.recipient_chat_id, outboundRecipient);
  assert.equal(databaseProof.final_text, outboundText);
  assert.equal(databaseProof.actor_role, "sales");
  assert.equal(databaseProof.provider_message_id, "technical-provider-message-465");
  assert.equal(Number(databaseProof.ack), 1);
  assert.equal(databaseProof.ack_name, "SERVER");
  assert.equal(databaseProof.direction, "outbound");
  assert.equal(databaseProof.body, outboundText);
  assert.equal(
    databaseProof.external_message_id,
    "technical-provider-message-465",
  );
  assert.equal(Number(databaseProof.attempt_count), 1);
  assert.equal(Number(databaseProof.outbound_count), 1);

  if (!wahaAcceptanceResultFile) {
    throw new Error("missing isolated WAHA acceptance result file");
  }
  const providerProof = JSON.parse(
    await readFile(wahaAcceptanceResultFile, "utf8"),
  ) as {
    sendCount: number;
    listReadCount: number;
    exactReadCount: number;
    requests: Record<string, unknown>[];
  };
  assert.equal(providerProof.sendCount, 1, "the UI must POST to WAHA exactly once");
  assert.equal(providerProof.listReadCount, 0);
  assert.equal(providerProof.exactReadCount, 1);
  assert.deepEqual(providerProof.requests, [{
    session: expectedWahaSessionName,
    chatId: outboundRecipient,
    text: outboundText,
  }]);

  const recoverySeed = await postAcceptedInbound(request, {
    event: "message.received",
    senderPhone: recoveryInboundPhone,
    externalConversationId: recoveryInboundConversationId,
    externalMessageId: "v2-browser-recovery-message-465",
    text: "V2 inbound seed for unknown-send recovery proof 465",
    occurredAt: new Date().toISOString(),
  });
  await page.goto(`/whatsapp/${recoverySeed.conversationId}`);
  await expect(page.getByTestId("canonical-whatsapp-outbound-recipient")).toContainText(
    recoveryRecipient,
  );
  await page.getByTestId("canonical-whatsapp-outbound-text").fill(recoveryText);
  await page.getByTestId("canonical-whatsapp-outbound-confirm").check();
  await page.getByTestId("canonical-whatsapp-outbound-send").click();

  const unknownState = page.getByTestId("canonical-whatsapp-outbound-state");
  await expect(unknownState).toHaveAttribute("data-status", "unknown");
  await expect(unknownState).toHaveAttribute(
    "data-reason",
    "provider_malformed_response",
  );
  await expect(page.getByTestId("canonical-whatsapp-latest-attempt")).toContainText(
    /unknown/i,
  );
  await expect(page.getByTestId("canonical-whatsapp-outbound-send")).toBeDisabled();
  const recoveryButton = page.getByTestId(
    "canonical-whatsapp-outbound-reconcile",
  );
  await expect(recoveryButton).toContainText(/найти уже отправленное/i);

  const unknownProof = await canonicalWhatsAppOutboundProof(
    recoverySeed.conversationId,
  );
  assert.ok(unknownProof, "the ambiguous POST outcome must persist one attempt");
  assert.equal(unknownProof.status, "unknown");
  assert.equal(unknownProof.failure_code, "provider_malformed_response");
  assert.equal(unknownProof.provider_message_id, null);
  assert.equal(unknownProof.direction, null);
  assert.equal(Number(unknownProof.attempt_count), 1);
  assert.equal(Number(unknownProof.outbound_count), 0);

  await recoveryButton.click();
  await expect(page.getByTestId("canonical-whatsapp-reconcile-state")).toHaveAttribute(
    "data-status",
    "reconciled",
  );
  await expect(page.getByTestId("canonical-whatsapp-latest-attempt")).toContainText(
    /accepted/i,
  );
  await expect(page.getByTestId("canonical-staff-whatsapp-thread")).toContainText(
    recoveryText,
  );

  const recoveredProof = await canonicalWhatsAppOutboundProof(
    recoverySeed.conversationId,
  );
  assert.ok(recoveredProof, "GET-only recovery must settle the existing attempt");
  assert.equal(recoveredProof.status, "accepted");
  assert.equal(recoveredProof.failure_code, null);
  assert.equal(
    recoveredProof.provider_message_id,
    "technical-provider-recovered-message-465",
  );
  assert.equal(recoveredProof.direction, "outbound");
  assert.equal(recoveredProof.body, recoveryText);
  assert.equal(Number(recoveredProof.attempt_count), 1);
  assert.equal(Number(recoveredProof.outbound_count), 1);

  const recoveredProviderProof = JSON.parse(
    await readFile(wahaAcceptanceResultFile, "utf8"),
  ) as {
    sendCount: number;
    listReadCount: number;
    exactReadCount: number;
    requests: Record<string, unknown>[];
    listReadRecipients: string[];
  };
  assert.equal(
    recoveredProviderProof.sendCount,
    2,
    "recovery must not POST a third provider operation",
  );
  assert.equal(recoveredProviderProof.listReadCount, 2);
  assert.equal(recoveredProviderProof.exactReadCount, 1);
  assert.deepEqual(recoveredProviderProof.requests[1], {
    session: expectedWahaSessionName,
    chatId: recoveryRecipient,
    text: recoveryText,
  });
  assert.deepEqual(recoveredProviderProof.listReadRecipients, [
    recoveryRecipient,
    expectedWahaSelfLid,
  ]);

  const queueConversationIds = new Set<string>();
  for (let index = 0; index < 50; index += 1) {
    const suffix = index.toString().padStart(2, "0");
    const result = await postAcceptedInbound(request, {
      event: "message.received",
      senderPhone: inboundPhone,
      externalConversationId: `v2-queue-page-conversation-430-${suffix}`,
      externalMessageId: `v2-queue-page-message-430-${suffix}`,
      text: `V2 queue pagination proof ${suffix}`,
      occurredAt: new Date(Date.UTC(2026, 7, 28, 12, 30, index)).toISOString(),
    });
    queueConversationIds.add(result.conversationId);
  }
  expect(queueConversationIds.size).toBe(50);

  await page.goto("/whatsapp");
  await expect(staffQueueRow).toHaveCount(0);
  const queueRows = page.getByTestId("canonical-staff-whatsapp-row");
  await expect(queueRows).toHaveCount(50);
  const firstQueuePageIds = await queueRows.evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-conversation-id")),
  );
  expect(firstQueuePageIds.every(Boolean)).toBe(true);
  const queueNextLink = page.getByTestId("canonical-staff-whatsapp-queue-next");
  await expect(queueNextLink).toBeVisible();
  const queueNextHref = await queueNextLink.getAttribute("href");
  if (!queueNextHref) throw new Error("queue pagination link is missing its href");
  const queueNextUrl = new URL(queueNextHref, page.url());
  const queueBeforeAt = queueNextUrl.searchParams.get("before_at");
  const queueBeforeId = queueNextUrl.searchParams.get("before_id");
  if (!queueBeforeAt || !queueBeforeId) {
    throw new Error("queue pagination link is missing its canonical cursor pair");
  }
  await queueNextLink.click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/whatsapp" &&
      url.searchParams.get("before_at") === queueBeforeAt &&
      url.searchParams.get("before_id") === queueBeforeId,
  );
  await expect(queueRows.first()).toBeVisible();
  const secondQueuePageIds = await queueRows.evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-conversation-id")),
  );
  expect(secondQueuePageIds.length).toBeGreaterThan(0);
  expect(
    secondQueuePageIds.some((id) => firstQueuePageIds.includes(id)),
  ).toBe(false);
  const queueResetLink = page.getByTestId(
    "canonical-staff-whatsapp-queue-reset",
  );
  await expect(queueResetLink).toHaveAttribute("href", "/whatsapp");
  await queueResetLink.click();
  await expect(page).toHaveURL(/\/whatsapp$/);
  await expect(queueRows).toHaveCount(50);
  expect(
    await queueRows.evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-conversation-id")),
    ),
  ).toEqual(firstQueuePageIds);
  await expect(staffQueueRow).toHaveCount(0);

  const threadMessageIds: string[] = [];
  let latestThreadPageText = "";
  const threadPaginationBaseMs = Date.now() + 1_000;
  for (let index = 0; index < 50; index += 1) {
    const suffix = index.toString().padStart(2, "0");
    latestThreadPageText = `V2 thread pagination proof ${suffix}`;
    const result = await postAcceptedInbound(request, {
      event: "message.received",
      senderPhone: inboundPhone,
      externalConversationId: inboundConversationId,
      externalMessageId: `v2-thread-page-message-430-${suffix}`,
      text: latestThreadPageText,
      occurredAt: new Date(threadPaginationBaseMs + index).toISOString(),
    });
    expect(result.conversationId).toBe(conversationId);
    threadMessageIds.push(result.messageId);
  }
  expect(new Set(threadMessageIds).size).toBe(50);

  await page.goto(`/whatsapp/${conversationId}`);
  await expect(
    page.locator(
      `[data-testid="canonical-staff-whatsapp-message"][data-message-id="${messageId}"]`,
    ),
  ).toHaveCount(0);
  await expect(page.getByTestId("canonical-staff-whatsapp-thread")).toContainText(
    latestThreadPageText,
  );
  const messagesNextLink = page.getByTestId(
    "canonical-staff-whatsapp-messages-next",
  );
  await expect(messagesNextLink).toBeVisible();
  const messagesNextHref = await messagesNextLink.getAttribute("href");
  if (!messagesNextHref) {
    throw new Error("message pagination link is missing its href");
  }
  const messagesNextUrl = new URL(messagesNextHref, page.url());
  const messagesBeforeAt = messagesNextUrl.searchParams.get(
    "messages_before_at",
  );
  const messagesBeforeId = messagesNextUrl.searchParams.get(
    "messages_before_id",
  );
  if (!messagesBeforeAt || !messagesBeforeId) {
    throw new Error("message pagination link is missing its canonical cursor pair");
  }
  await messagesNextLink.click();
  await expect(
    page.locator(
      `[data-testid="canonical-staff-whatsapp-message"][data-message-id="${messageId}"]`,
    ),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("messages_before_at")).toBe(
    messagesBeforeAt,
  );
  expect(new URL(page.url()).searchParams.get("messages_before_id")).toBe(
    messagesBeforeId,
  );
  const messagesResetLink = page.getByTestId(
    "canonical-staff-whatsapp-messages-reset",
  );
  await expect(messagesResetLink).toHaveAttribute(
    "href",
    `/whatsapp/${conversationId}`,
  );
  await messagesResetLink.click();
  await expect(page).toHaveURL(new RegExp(`/whatsapp/${conversationId}$`));
  await expect(
    page.locator(
      `[data-testid="canonical-staff-whatsapp-message"][data-message-id="${messageId}"]`,
    ),
  ).toHaveCount(0);

  for (const malformedPath of [
    `/whatsapp?before_at=not-a-timestamp&before_id=${queueBeforeId}`,
    `/whatsapp?before_at=${encodeURIComponent(queueBeforeAt)}`,
    `/whatsapp?before_id=${queueBeforeId}`,
    `/whatsapp?before_at=${encodeURIComponent(queueBeforeAt)}&before_at=${encodeURIComponent(queueBeforeAt)}&before_id=${queueBeforeId}`,
    "/whatsapp?unexpected=true",
    `/whatsapp/${conversationId}?messages_before_at=not-a-timestamp&messages_before_id=${messagesBeforeId}`,
    `/whatsapp/${conversationId}?messages_before_at=${encodeURIComponent(messagesBeforeAt)}`,
    `/whatsapp/${conversationId}?messages_before_id=${messagesBeforeId}`,
    `/whatsapp/${conversationId}?messages_before_at=${encodeURIComponent(messagesBeforeAt)}&messages_before_at=${encodeURIComponent(messagesBeforeAt)}&messages_before_id=${messagesBeforeId}`,
    `/whatsapp/${conversationId}?unexpected=true`,
  ]) {
    await page.goto(malformedPath);
    await expect(
      page.getByRole("heading", { name: "404", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTestId("canonical-staff-whatsapp-thread"),
    ).toHaveCount(0);
  }

  await submitGate(page, "admissions");
  await page.goto("/whatsapp");
  await expect(page.getByTestId("canonical-staff-whatsapp-page")).toBeVisible();
  await expect(
    page.locator(
      `[data-testid="canonical-staff-whatsapp-row"][data-conversation-id="${conversationId}"]`,
    ),
  ).toHaveCount(0);
  await page.goto(`/whatsapp/${conversationId}`);
  await expect(
    page.getByRole("heading", { name: "404", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("canonical-staff-whatsapp-thread")).toHaveCount(0);

  await submitGate(page, "admin");
  await page.goto(`/whatsapp/${conversationId}`);
  await expect(page.getByTestId("canonical-staff-whatsapp-thread")).toContainText(
    latestThreadPageText,
  );

  await page.goto("/");
  await page.getByTestId("preview-role-admissions").click();
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-role",
    "admissions",
  );
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-authority-role",
    "admin",
  );
  await page.goto("/whatsapp");
  await expect(page.getByTestId("staff-role-preview")).toHaveAttribute(
    "data-effective-role",
    "admissions",
  );
  await expect(
    page.locator(
      `[data-testid="canonical-staff-whatsapp-row"][data-conversation-id="${conversationId}"]`,
    ),
  ).toHaveCount(0);
  await page.goto(`/whatsapp/${conversationId}`);
  await expect(
    page.getByRole("heading", { name: "404", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("canonical-staff-whatsapp-thread")).toHaveCount(0);

  await page.goto("/");
  await page.getByTestId("preview-role-sales").click();
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-role",
    "sales",
  );
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-authority-role",
    "admin",
  );
  await page.goto("/whatsapp");
  await expect(page.getByTestId("staff-role-preview")).toHaveAttribute(
    "data-effective-role",
    "sales",
  );
  await expect(
    page.locator(
      `[data-testid="canonical-staff-whatsapp-row"][data-conversation-id="${conversationId}"]`,
    ),
  ).toBeVisible();

  await submitGate(page, "admissions");
  await page.goto(`/sales/${leadId}/conversations/${conversationId}`);
  await expect(page).toHaveURL(/\/access-denied\?from=%2Fsales/);
  await expect(page.getByTestId("canonical-sales-transcript")).toHaveCount(0);
});

test("Admissions reads the real canonical Student Case queue", async ({ page }) => {
  test.skip(mode !== "configured", "only exercised in configured mode");
  const studentCaseId = requireUuid("EVO_CANONICAL_STUDENT_CASE_ID");

  await submitGate(page, "admissions");
  await expect(page).toHaveURL(/\/clients(?:\?|$)/);
  await expect(page.getByTestId("canonical-student-cases-page")).toBeVisible();
  await expect(
    page.locator(
      `[data-testid="canonical-student-case-row"][data-student-case-id="${studentCaseId}"]`,
    ),
  ).toBeVisible();

  await page.goto(`/clients?q=${encodeURIComponent(studentCaseId)}`);
  await expect(
    page.locator(
      `[data-testid="canonical-student-case-row"][data-student-case-id="${studentCaseId}"]`,
    ),
  ).toBeVisible();
});

test("Sales reads and updates the real canonical PostgreSQL workflow", async ({
  page,
}) => {
  test.skip(mode !== "configured", "only exercised in configured mode");
  const leadId = requireUuid("EVO_CANONICAL_LEAD_ID");

  await submitGate(page, "sales");
  await expect(page).toHaveURL(/\/sales(?:\?|$)/);
  await expect(page.getByTestId("canonical-sales-page")).toBeVisible();
  const row = page.locator(
    `[data-testid="canonical-lead-row"][data-lead-id="${leadId}"]`,
  );
  await expect(row).toBeVisible();

  await page.goto(`/sales?q=${encodeURIComponent(leadId)}`);
  await expect(
    page.locator(
      `[data-testid="canonical-lead-row"][data-lead-id="${leadId}"]`,
    ),
  ).toBeVisible();

  await page.goto(`/sales/${leadId}`);
  const detail = page.getByTestId("canonical-lead-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText(leadId);

  const form = page.getByTestId("canonical-sales-workflow-form");
  await expect(form).toBeVisible();
  const reason = form.locator('textarea[name="reason"]');
  await form.locator('select[name="stage"]').selectOption("disqualified");
  await expect(reason).toBeEnabled();
  await reason.fill("Browser reconsidered disqualification");
  await form.locator('select[name="stage"]').selectOption("qualified");
  await expect(reason).toBeDisabled();
  await expect(reason).toHaveValue("");
  await form
    .locator('textarea[name="qualification_summary"]')
    .fill("Browser-proven qualification summary");
  await form
    .locator('input[name="next_action"]')
    .fill("Browser-proven follow-up call");
  await form.locator('input[name="next_action_at"]').fill("2026-09-15");
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(
    page.getByTestId("canonical-sales-workflow-saved"),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("canonical-lead-detail")).toContainText(
    "Browser-proven qualification summary",
  );
  await expect(
    page.locator('input[name="next_action"]'),
  ).toHaveValue("Browser-proven follow-up call");
});

test("Admin sees the Sales union while Admissions stays server-denied", async ({
  page,
}) => {
  test.skip(mode !== "configured", "only exercised in configured mode");
  const leadId = requireUuid("EVO_CANONICAL_OVERRIDE_LEAD_ID");

  await submitGate(page, "admin");
  await page.goto(`/sales/${leadId}`);
  await expect(page.getByTestId("canonical-lead-detail")).toBeVisible();
  await expect(page.getByTestId("canonical-sales-workflow-form")).toBeVisible();

  await submitGate(page, "admissions");
  await page.goto("/sales");
  await expect(page).toHaveURL(/\/access-denied\?from=%2Fsales/);
  await expect(page.getByTestId("canonical-sales-page")).toHaveCount(0);
});

test("Sales hands off a case and Admissions operates canonical Student 360", async ({
  page,
}) => {
  test.skip(mode !== "configured", "only exercised in configured mode");
  const leadId = requireUuid("EVO_CANONICAL_LEAD_ID");

  await submitGate(page, "sales");
  await page.goto(`/sales/${leadId}`);
  await expect(page.getByTestId("canonical-lead-detail")).toBeVisible();

  const contractForm = page.getByTestId("canonical-contract-evidence-form");
  await contractForm
    .locator('input[name="evidence_reference"]')
    .fill("browser-contract-431");
  await contractForm.locator('button[type="submit"]').click();
  await expect(page.getByTestId("canonical-contract-evidence")).toContainText(
    "browser-contract-431",
  );

  const paymentForm = page.getByTestId("canonical-first_payment-evidence-form");
  await paymentForm
    .locator('input[name="evidence_reference"]')
    .fill("browser-first-payment-431");
  await paymentForm.locator('input[name="amount_minor"]').fill("125000");
  await paymentForm.locator('input[name="currency"]').fill("KGS");
  await paymentForm.locator('button[type="submit"]').click();
  await expect(
    page.getByTestId("canonical-first-payment-evidence"),
  ).toContainText("browser-first-payment-431");

  const handoffForm = page.getByTestId("canonical-sales-handoff-form");
  await expect(handoffForm).toBeVisible();
  await expect(handoffForm.locator('input[name="is_override"]')).toHaveValue(
    "false",
  );
  await handoffForm.locator('button[type="submit"]').click();

  const caseLink = page.getByTestId("canonical-admissions-case-link");
  await expect(caseLink).toBeVisible();
  const caseHref = await caseLink.getAttribute("href");
  expect(caseHref).toMatch(
    /^\/clients\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

  await submitGate(page, "admissions");
  await page.goto(caseHref!);
  await expect(
    page.getByTestId("canonical-student-case-workspace"),
  ).toBeVisible();
  await expect(
    page.getByTestId("canonical-student-case-handoff"),
  ).toContainText(/Обычная передача|Кадимки өткөрүү|Normal handoff/);
  const starterTasks = page.getByTestId("canonical-admissions-starter-task");
  await expect(starterTasks).toHaveCount(3);
  for (const title of [
    "Проверить унаследованный контекст Sales",
    "Подтвердить маршрут обучения и недостающие данные",
    "Подготовить первичный план запроса документов",
  ]) {
    await expect(starterTasks.filter({ hasText: title })).toHaveCount(1);
  }

  const taskItems = page.getByTestId("canonical-admissions-task");
  await expect(taskItems).toHaveCount(3);

  const createdTaskTitle = "Browser V2-8A: проверить перевод аттестата";
  const createTaskForm = page.getByTestId(
    "canonical-admissions-task-create-form",
  );
  await createTaskForm.locator('input[name="title"]').fill(createdTaskTitle);
  await createTaskForm
    .locator('textarea[name="details"]')
    .fill("Создано реальным браузером для проверки canonical PostgreSQL path");
  await createTaskForm.locator('button[type="submit"]').click();

  const createdTask = taskItems.filter({ hasText: createdTaskTitle });
  await expect(createdTask).toHaveCount(1);
  await expect(taskItems).toHaveCount(4);

  await createdTask
    .getByTestId("canonical-admissions-task-complete-form")
    .locator('button[type="submit"]')
    .click();
  await expect(createdTask).toContainText(/Завершена|Аяктады|Completed/);

  const cancelledTaskTitle = "Проверить унаследованный контекст Sales";
  const cancelledTask = taskItems.filter({ hasText: cancelledTaskTitle });
  const cancellationReason =
    "Контекст Sales уже проверен во время browser acceptance";
  const cancelTaskForm = cancelledTask.getByTestId(
    "canonical-admissions-task-cancel-form",
  );
  await cancelTaskForm.locator('input[name="reason"]').fill(cancellationReason);
  await cancelTaskForm.locator('button[type="submit"]').click();
  await expect(cancelledTask).toContainText(/Отменена|Жокко чыгарылды|Cancelled/);
  await expect(cancelledTask).toContainText(cancellationReason);

  const operations = page.getByTestId("canonical-admissions-operations");
  await expect(operations).toBeVisible();
  await expect(page.getByTestId("canonical-visa-milestone")).toHaveCount(6);

  const applicationCreateForm = page.getByTestId(
    "canonical-university-application-create-form",
  );
  await applicationCreateForm
    .locator('input[name="institution_name"]')
    .fill("Browser Technical University");
  await applicationCreateForm
    .locator('input[name="program_name"]')
    .fill("Canonical CRM validation");
  await applicationCreateForm
    .locator('input[name="target_intake"]')
    .fill("2027 Spring");
  await applicationCreateForm
    .locator('input[name="next_action"]')
    .fill("Проверить комплект документов");
  await applicationCreateForm
    .locator('input[type="datetime-local"]')
    .fill("2026-09-15T10:00");
  await applicationCreateForm.locator('button[type="submit"]').click();

  const application = page
    .getByTestId("canonical-university-application")
    .filter({ hasText: "Browser Technical University" });
  await expect(application).toHaveCount(1);
  await expect(application).toHaveAttribute("data-status", "draft");

  const applicationUpdateForm = application.getByTestId(
    "canonical-university-application-update-form",
  );
  await applicationUpdateForm
    .locator('input[name="next_action"]')
    .fill("Подготовить заверенный перевод");
  await applicationUpdateForm
    .locator('input[type="datetime-local"]')
    .fill("2026-09-16T11:30");
  await applicationUpdateForm.locator('button[type="submit"]').click();
  await expect(
    application
      .getByTestId("canonical-university-application-update-form")
      .locator('input[name="next_action"]'),
  ).toHaveValue("Подготовить заверенный перевод");

  const financeStopReason = "Ожидается обязательный внутренний платеж";
  const assertStopForm = page.getByTestId("canonical-finance-stop-assert-form");
  await assertStopForm.locator('textarea[name="reason"]').fill(financeStopReason);
  await assertStopForm.locator('button[type="submit"]').click();
  await expect(page.getByTestId("canonical-finance-stop")).toHaveAttribute(
    "data-is-stopped",
    "true",
  );
  await expect(page.getByTestId("canonical-finance-stop")).toContainText(
    financeStopReason,
  );

  await application
    .getByTestId("canonical-university-application-transition-form")
    .filter({ has: page.locator('input[name="to_status"][value="submitted"]') })
    .locator('button[type="submit"]')
    .click();
  await expect(application).toHaveAttribute("data-status", "draft");
  await expect(application).toContainText(
    /финансов|каржыл|finance/i,
  );

  const visaSubmission = page.locator(
    '[data-testid="canonical-visa-milestone"][data-kind="submission"]',
  );
  await expect(visaSubmission).toHaveAttribute("data-status", "pending");
  await visaSubmission
    .getByTestId("canonical-visa-milestone-transition-form")
    .filter({ has: page.locator('input[name="to_status"][value="in_progress"]') })
    .locator('button[type="submit"]')
    .click();
  await expect(visaSubmission).toHaveAttribute("data-status", "pending");

  const documentPreparation = page.locator(
    '[data-testid="canonical-visa-milestone"][data-kind="document_preparation"]',
  );
  await documentPreparation
    .getByTestId("canonical-visa-milestone-transition-form")
    .filter({ has: page.locator('input[name="to_status"][value="in_progress"]') })
    .locator('button[type="submit"]')
    .click();
  await expect(documentPreparation).toHaveAttribute("data-status", "in_progress");
  await documentPreparation
    .getByTestId("canonical-visa-milestone-transition-form")
    .filter({ has: page.locator('input[name="to_status"][value="completed"]') })
    .locator('button[type="submit"]')
    .click();
  await expect(documentPreparation).toHaveAttribute("data-status", "completed");

  const appointment = page.locator(
    '[data-testid="canonical-visa-milestone"][data-kind="appointment"]',
  );
  const blockAppointmentForm = appointment
    .getByTestId("canonical-visa-milestone-transition-form")
    .filter({ has: page.locator('input[name="to_status"][value="blocked"]') });
  await blockAppointmentForm
    .locator('input[name="reason"]')
    .fill("Нужно уточнить доступное время");
  await blockAppointmentForm.locator('button[type="submit"]').click();
  await expect(appointment).toHaveAttribute("data-status", "blocked");
  await appointment
    .getByTestId("canonical-visa-milestone-transition-form")
    .filter({ has: page.locator('input[name="to_status"][value="in_progress"]') })
    .locator('button[type="submit"]')
    .click();
  await expect(appointment).toHaveAttribute("data-status", "in_progress");

  await page.goto("/tasks");
  await expect(
    page.getByTestId("canonical-admissions-task-queue"),
  ).toBeVisible();
  const caseQueueTasks = page
    .getByTestId("canonical-admissions-task")
    .filter({ has: page.locator(`a[href="${caseHref}"]`) });
  await expect(caseQueueTasks).toHaveCount(4);
  await expect(
    caseQueueTasks.filter({ hasText: createdTaskTitle }),
  ).toContainText(/Завершена|Аяктады|Completed/);
  await expect(
    caseQueueTasks.filter({ hasText: cancelledTaskTitle }),
  ).toContainText(/Отменена|Жокко чыгарылды|Cancelled/);
  await expect(
    caseQueueTasks.filter({ hasText: cancelledTaskTitle }),
  ).toContainText(cancellationReason);

  await submitGate(page, "sales");
  for (const deniedRoute of ["/tasks", "/applications", "/visa", "/finance"]) {
    await page.goto(deniedRoute);
    await expect(page).toHaveURL(/\/access-denied\?from=/);
  }

  await submitGate(page, "admin");
  await page.goto(caseHref!);
  const releaseReason = "Admin подтвердил снятие внутреннего ограничения";
  const releaseStopForm = page.getByTestId("canonical-finance-stop-release-form");
  await releaseStopForm.locator('textarea[name="reason"]').fill(releaseReason);
  await releaseStopForm.locator('button[type="submit"]').click();
  await expect(page.getByTestId("canonical-finance-stop")).toHaveAttribute(
    "data-is-stopped",
    "false",
  );

  const adminApplication = page
    .getByTestId("canonical-university-application")
    .filter({ hasText: "Browser Technical University" });
  await adminApplication
    .getByTestId("canonical-university-application-transition-form")
    .filter({ has: page.locator('input[name="to_status"][value="submitted"]') })
    .locator('button[type="submit"]')
    .click();
  await expect(adminApplication).toHaveAttribute("data-status", "submitted");
  await adminApplication
    .getByTestId("canonical-university-application-transition-form")
    .filter({ has: page.locator('input[name="to_status"][value="accepted"]') })
    .locator('button[type="submit"]')
    .click();
  await expect(adminApplication).toHaveAttribute("data-status", "accepted");

  const adminVisaSubmission = page.locator(
    '[data-testid="canonical-visa-milestone"][data-kind="submission"]',
  );
  await adminVisaSubmission
    .getByTestId("canonical-visa-milestone-transition-form")
    .filter({ has: page.locator('input[name="to_status"][value="in_progress"]') })
    .locator('button[type="submit"]')
    .click();
  await expect(adminVisaSubmission).toHaveAttribute(
    "data-status",
    "in_progress",
  );
  await adminVisaSubmission
    .getByTestId("canonical-visa-milestone-transition-form")
    .filter({ has: page.locator('input[name="to_status"][value="completed"]') })
    .locator('button[type="submit"]')
    .click();
  await expect(adminVisaSubmission).toHaveAttribute("data-status", "completed");

  await page.goto("/applications");
  await expect(page.getByTestId("canonical-application-queue")).toContainText(
    "Browser Technical University",
  );
  await page.goto("/visa");
  await expect(page.getByTestId("canonical-visa-queue")).toBeVisible();
  await page.goto("/finance");
  await expect(page.getByTestId("canonical-finance-stop-queue")).toContainText(
    releaseReason,
  );

  await page.goto("/");
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-role",
    "admin",
  );
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-authority-role",
    "admin",
  );
  await page.getByTestId("preview-role-admissions").click();
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-role",
    "admissions",
  );
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-authority-role",
    "admin",
  );
  await page.goto("/tasks");
  await expect(
    page.getByTestId("canonical-admissions-task-queue"),
  ).toBeVisible();
  await expect(page.getByTestId("staff-role-preview")).toHaveAttribute(
    "data-effective-role",
    "admissions",
  );
  await page.goto(caseHref!);
  await expect(page.getByTestId("canonical-admissions-operations")).toBeVisible();
  await expect(
    page.getByTestId("canonical-finance-stop-release-form"),
  ).toHaveCount(0);
});

test("Admin records a reasoned exception and opens the resulting case", async ({
  page,
}) => {
  test.skip(mode !== "configured", "only exercised in configured mode");
  const leadId = requireUuid("EVO_CANONICAL_OVERRIDE_LEAD_ID");

  await submitGate(page, "admin");
  await page.goto(`/sales/${leadId}`);
  const overrideReason = "Browser-verified Admin exception for CRM validation";
  const handoffForm = page.getByTestId("canonical-sales-handoff-form");
  await expect(handoffForm).toBeVisible();
  await expect(handoffForm.locator('input[name="is_override"]')).toHaveValue(
    "true",
  );
  await handoffForm
    .locator('textarea[name="override_reason"]')
    .fill(overrideReason);
  await handoffForm.locator('button[type="submit"]').click();

  const caseLink = page.getByTestId("canonical-admissions-case-link");
  await expect(caseLink).toBeVisible();
  await caseLink.click();
  await expect(page).toHaveURL(
    /\/clients\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await expect(
    page.getByTestId("canonical-student-case-workspace"),
  ).toBeVisible();
  await expect(
    page.getByTestId("canonical-student-case-handoff"),
  ).toContainText(/Исключение Admin|Admin өзгөчө чечими|Admin exception/);
  await expect(
    page.getByTestId("canonical-handoff-override-reason"),
  ).toHaveText(overrideReason);
  await expect(
    page.getByTestId("canonical-admissions-starter-task"),
  ).toHaveCount(3);
});
