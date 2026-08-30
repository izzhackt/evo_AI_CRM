import { createHash, createHmac } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import postgres from "postgres";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROVIDER_ID = /^[1-9][0-9]{0,9}$/u;
const DIRECT_RECIPIENT = /^[1-9][0-9]{4,31}@(c[.]us|lid)$/u;
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const VALIDATION_INBOUND_TEXT =
  "EVO V2 self-validation: prepare one human-reviewed provider acceptance reply.";
const AMOCRM_NOTE_TEXT =
  "EVO V2 end-to-end validation: reviewed WhatsApp result.";
const OPERATIONS = Object.freeze([
  "contact_create",
  "lead_create",
  "contact_lead_link",
  "lead_pipeline_status_update",
  "lead_responsible_update",
  "lead_note_create",
  "lead_tag_update",
]);
const ACK_NAMES = Object.freeze({
  0: "PENDING",
  1: "SERVER",
  2: "DEVICE",
  3: "READ",
  4: "PLAYED",
} as const);

test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe.configure({ mode: "serial" });
test.skip(
  process.env.EVO_V2_REAL_END_TO_END_ACCEPTANCE !== "1",
  "requires the explicit V2-10D real-provider acceptance harness",
);
test.beforeEach(async ({}, testInfo) => {
  if (
    process.env.EVO_V2_REAL_END_TO_END_PROJECT !== "desktop-chromium" ||
    testInfo.project.name !== "desktop-chromium"
  ) {
    throw new Error(
      "V2-10D real-provider acceptance requires the exact desktop-chromium project",
    );
  }
});

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required V2-10D input: ${name}`);
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown, message: string): Record<string, unknown> {
  ensure(
    value !== null && typeof value === "object" && !Array.isArray(value),
    message,
  );
  return value as Record<string, unknown>;
}

function array(value: unknown, message: string): unknown[] {
  ensure(Array.isArray(value) && value.length <= 10_000, message);
  return value;
}

function providerId(value: unknown, message: string): string {
  const parsed =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value
        : "";
  ensure(PROVIDER_ID.test(parsed), message);
  return parsed;
}

function requiredMode(): "blocked" | "operator" | "recovery" | "post-waha" {
  const mode = process.env.EVO_V2_REAL_END_TO_END_MODE;
  if (
    mode !== "blocked" &&
    mode !== "operator" &&
    mode !== "recovery" &&
    mode !== "post-waha"
  ) {
    throw new Error("EVO_V2_REAL_END_TO_END_MODE is invalid");
  }
  return mode;
}

function acceptanceInputs() {
  const mode = requiredMode();
  const recoveryMode = mode === "recovery" || mode === "post-waha";
  const recoverySha = requireEnv("EVO_V2_ACCEPTANCE_MAIN_SHA");
  ensure(
    SHA40.test(recoverySha),
    "V2-10D acceptance requires an exact main SHA",
  );
  const gitSha = recoveryMode
    ? requireEnv("EVO_V2_10D_ORIGINAL_ATTEMPT_SHA")
    : recoverySha;
  ensure(
    SHA40.test(gitSha),
    "V2-10D recovery requires the exact original attempt SHA",
  );
  ensure(
    !recoveryMode || recoverySha !== gitSha,
    "V2-10D recovery code and original attempt SHAs must be distinct",
  );
  const evidenceDir = path.resolve(requireEnv("EVO_V2_10D_EVIDENCE_DIR"));
  const expectedEvidenceDir = path.resolve(
    process.cwd(),
    "output",
    "provider-acceptance",
    "v2-10d",
    gitSha,
  );
  ensure(
    evidenceDir === expectedEvidenceDir,
    "V2-10D evidence path escaped the exact-SHA root",
  );
  return Object.freeze({
    gitSha,
    recoverySha,
    evidenceDir,
    runtimeFile: path.resolve(requireEnv("EVO_V2_AMOCRM_PRIVATE_RUNTIME_FILE")),
    contextFile: path.resolve(requireEnv("EVO_V2_AMOCRM_PRIVATE_CONTEXT_FILE")),
  });
}

function connectedSelfIdentities() {
  const primary = requireEnv("EVO_V2_CONNECTED_WAHA_SELF_ID");
  const optional = process.env.EVO_V2_CONNECTED_WAHA_SELF_LID ?? "";
  ensure(
    DIRECT_RECIPIENT.test(primary),
    "Connected WAHA self identity is invalid",
  );
  ensure(
    optional === "" ||
      (DIRECT_RECIPIENT.test(optional) && optional !== primary),
    "Optional connected WAHA self identity is invalid",
  );
  const identities = optional === "" ? [primary] : [primary, optional];
  const phoneIdentities = identities.filter((identity) =>
    identity.endsWith("@c.us"),
  );
  ensure(
    phoneIdentities.length === 1,
    "Connected WAHA session did not expose one exact phone identity",
  );
  const lidIdentities = identities.filter((identity) =>
    identity.endsWith("@lid"),
  );
  ensure(
    lidIdentities.length <= 1,
    "Connected WAHA session exposed more than one LID identity",
  );
  return Object.freeze({
    selfId: phoneIdentities[0],
    selfLid: lidIdentities[0] ?? "",
    selfRecipientIds: new Set(identities),
  });
}

async function privateJson(filePath: string, label: string) {
  const resolved = path.resolve(filePath);
  ensure(resolved === filePath, `${label} path is not absolute and normalized`);
  const status = await lstat(resolved);
  ensure(
    status.isFile() && !status.isSymbolicLink(),
    `${label} is not a regular file`,
  );
  ensure((status.mode & 0o077) === 0, `${label} permissions are not private`);
  ensure(
    status.size > 0 && status.size <= 256 * 1024,
    `${label} size is invalid`,
  );
  let value: unknown;
  try {
    value = JSON.parse(await readFile(resolved, "utf8"));
  } catch {
    throw new Error(`${label} is not valid private JSON`);
  }
  return record(value, `${label} shape is invalid`);
}

async function durableCreateJson(
  filePath: string,
  value: Readonly<Record<string, unknown>>,
): Promise<void> {
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(filePath, 0o600);
  const directory = await open(path.dirname(filePath), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function durableCreateOrValidateWahaCheckpoint(
  filePath: string,
  expected: Readonly<Record<string, unknown>>,
): Promise<void> {
  try {
    await durableCreateJson(filePath, expected);
    return;
  } catch (error) {
    const code =
      error !== null && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    if (code !== "EEXIST") throw error;
  }

  const existing = await privateJson(
    filePath,
    "V2-10D post-WAHA recovery marker",
  );
  const existingRecovery = record(
    existing.recovery,
    "V2-10D post-WAHA recovery metadata is invalid",
  );
  const existingHashes = record(
    existing.hashes,
    "V2-10D post-WAHA hashes are invalid",
  );
  const existingReview = record(
    existing.review,
    "V2-10D post-WAHA review counts are invalid",
  );
  const existingWaha = record(
    existing.waha,
    "V2-10D post-WAHA WAHA counts are invalid",
  );
  const existingAmo = record(
    existing.amocrm,
    "V2-10D post-WAHA amoCRM counts are invalid",
  );
  const existingBoundaries = record(
    existing.boundaries,
    "V2-10D post-WAHA boundaries are invalid",
  );
  const expectedRecovery = record(expected.recovery, "Expected recovery");
  const expectedHashes = record(expected.hashes, "Expected hashes");
  const expectedReview = record(expected.review, "Expected review");
  const expectedWaha = record(expected.waha, "Expected WAHA proof");
  const expectedAmo = record(expected.amocrm, "Expected amoCRM proof");
  const expectedBoundaries = record(expected.boundaries, "Expected boundaries");

  ensure(
    existing.schemaVersion === expected.schemaVersion &&
      existing.kind === expected.kind &&
      existing.status === expected.status &&
      existing.gitSha === expected.gitSha &&
      existing.nextAuthorizedStep === expected.nextAuthorizedStep &&
      existingRecovery.occurred === expectedRecovery.occurred &&
      existingRecovery.stage === expectedRecovery.stage &&
      existingRecovery.codeSha === expectedRecovery.codeSha &&
      existingHashes.proposalSha256 === expectedHashes.proposalSha256 &&
      existingHashes.reviewedTextSha256 === expectedHashes.reviewedTextSha256 &&
      existingHashes.providerMessageIdSha256 ===
        expectedHashes.providerMessageIdSha256 &&
      existingReview.decision === expectedReview.decision &&
      existingReview.proposalCount === expectedReview.proposalCount &&
      existingWaha.status === expectedWaha.status &&
      existingWaha.attemptCount === expectedWaha.attemptCount &&
      existingWaha.outboundMessageCount === expectedWaha.outboundMessageCount &&
      existingWaha.databaseAck === expectedWaha.databaseAck &&
      existingWaha.readbackAck === expectedWaha.readbackAck &&
      existingWaha.exactReadback === expectedWaha.exactReadback &&
      existingAmo.attemptCount === expectedAmo.attemptCount &&
      existingAmo.receiptCount === expectedAmo.receiptCount &&
      existingAmo.bindingCount === expectedAmo.bindingCount &&
      JSON.stringify(existingBoundaries) === JSON.stringify(expectedBoundaries),
    "Existing post-WAHA checkpoint differs from the exact preserved result",
  );
}

function signedInboundHeaders(
  rawBody: string,
  secret: string,
  timestamp: string,
) {
  return {
    "content-type": "application/json",
    "x-evo-v2-timestamp": timestamp,
    "x-evo-v2-signature": createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex"),
  };
}

async function seedCanonicalSelfConversation(
  request: APIRequestContext,
  input: Readonly<{
    gitSha: string;
    selfId: string;
    expectedLeadId: string;
    expectedPhoneSha256: string;
  }>,
) {
  ensure(
    DIRECT_RECIPIENT.test(input.selfId),
    "Connected WAHA self identity is invalid",
  );
  const phoneE164 = `+${input.selfId.slice(0, input.selfId.indexOf("@"))}`;
  ensure(
    sha256(phoneE164) === input.expectedPhoneSha256,
    "Connected WAHA self identity does not match the validation lead",
  );
  const rawBody = JSON.stringify({
    event: "message.received",
    senderPhone: phoneE164,
    externalConversationId: input.selfId,
    externalMessageId: `v2-10d-self-${input.gitSha}`,
    text: VALIDATION_INBOUND_TEXT,
    occurredAt: "2026-08-29T00:00:00.000Z",
  });
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const response = await request.post("/api/v2/whatsapp/inbound", {
    data: rawBody,
    headers: signedInboundHeaders(
      rawBody,
      requireEnv("EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET"),
      timestamp,
    ),
  });
  ensure(
    response.status() === 202,
    "The canonical signed self-validation seed was rejected",
  );
  const body = record(
    await response.json(),
    "The canonical inbound response is invalid",
  );
  ensure(
    body.ok === true,
    "The canonical signed self-validation seed did not succeed",
  );
  const leadId = body.leadId;
  const conversationId = body.conversationId;
  const messageId = body.messageId;
  ensure(
    typeof leadId === "string" && leadId === input.expectedLeadId,
    "The signed self-validation seed resolved a different lead",
  );
  ensure(
    typeof conversationId === "string" && UUID.test(conversationId),
    "The signed self-validation seed returned an invalid conversation",
  );
  ensure(
    typeof messageId === "string" && UUID.test(messageId),
    "The signed self-validation seed returned an invalid message",
  );
  return Object.freeze({ leadId, conversationId, messageId });
}

async function readExistingSelfConversation(
  databaseUrl: string,
  input: Readonly<{ leadId: string; selfId: string }>,
) {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const rows = await sql<
      Array<{ conversation_id: string; lead_id: string; message_id: string }>
    >`
      select
        conversation.id as conversation_id,
        conversation.lead_id,
        message.id as message_id
      from evo_conversations as conversation
      join evo_messages as message
        on message.conversation_id = conversation.id
      where conversation.channel = 'whatsapp'
        and conversation.external_conversation_id = ${input.selfId}
        and conversation.lead_id = ${input.leadId}
        and message.direction = 'inbound'
        and message.body = ${VALIDATION_INBOUND_TEXT}
      order by message.created_at asc, message.id asc
    `;
    ensure(
      rows.length === 1,
      "Recovery did not find exactly one preserved self-validation conversation",
    );
    const row = rows[0];
    ensure(
      UUID.test(row.conversation_id) &&
        row.lead_id === input.leadId &&
        UUID.test(row.message_id),
      "The preserved self-validation conversation is invalid",
    );
    return Object.freeze({
      leadId: row.lead_id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function submitAdminGate(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page
    .locator("#gate-identifier")
    .fill(requireEnv("EVO_DEV_GATE_ADMIN_IDENTIFIER"));
  await page
    .locator("#gate-secret")
    .fill(requireEnv("EVO_DEV_GATE_ADMIN_SECRET"));
  await page.getByRole("button", { name: "Открыть CRM" }).click();
  await expect(page.getByTestId("development-workspace")).toBeVisible();
  await page.getByTestId("open-role-workspace").click();
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-authority-role",
    "admin",
  );
}

type MutationCounts = Readonly<{
  proposalCount: number;
  wahaAttemptCount: number;
  outboundMessageCount: number;
  messageCount: number;
  amocrmAttemptCount: number;
  commandReceiptCount: number;
  contactBindingCount: number;
  leadBindingCount: number;
  businessEventCount: number;
}>;

async function readMutationCounts(
  connectionString: string,
  leadId: string,
  conversationId: string,
): Promise<MutationCounts> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => undefined });
  try {
    const [row] = await sql`
      select
        (select count(*)::integer
          from evo_ai_proposals
          where conversation_id = ${conversationId}) as proposal_count,
        (select count(*)::integer
          from evo_whatsapp_send_attempts
          where conversation_id = ${conversationId}) as waha_attempt_count,
        (select count(*)::integer
          from evo_messages
          where conversation_id = ${conversationId}
            and direction = 'outbound') as outbound_message_count,
        (select count(*)::integer
          from evo_messages
          where conversation_id = ${conversationId}) as message_count,
        (select count(*)::integer
          from evo_amocrm_operation_attempts) as amocrm_attempt_count,
        (select count(*)::integer
          from evo_command_receipts) as command_receipt_count,
        (select count(*)::integer
          from evo_amocrm_contact_bindings
          where person_id = (select person_id from evo_leads where id = ${leadId}))
          as contact_binding_count,
        (select count(*)::integer
          from evo_amocrm_lead_bindings
          where lead_id = ${leadId}) as lead_binding_count,
        (select count(*)::integer
          from evo_business_events) as business_event_count
    `;
    ensure(row, "PostgreSQL mutation-count proof was unavailable");
    return Object.freeze({
      proposalCount: Number(row.proposal_count),
      wahaAttemptCount: Number(row.waha_attempt_count),
      outboundMessageCount: Number(row.outbound_message_count),
      messageCount: Number(row.message_count),
      amocrmAttemptCount: Number(row.amocrm_attempt_count),
      commandReceiptCount: Number(row.command_receipt_count),
      contactBindingCount: Number(row.contact_binding_count),
      leadBindingCount: Number(row.lead_binding_count),
      businessEventCount: Number(row.business_event_count),
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function sameMutationCounts(
  before: MutationCounts,
  after: MutationCounts,
): boolean {
  return (
    before.proposalCount === after.proposalCount &&
    before.wahaAttemptCount === after.wahaAttemptCount &&
    before.outboundMessageCount === after.outboundMessageCount &&
    before.messageCount === after.messageCount &&
    before.amocrmAttemptCount === after.amocrmAttemptCount &&
    before.commandReceiptCount === after.commandReceiptCount &&
    before.contactBindingCount === after.contactBindingCount &&
    before.leadBindingCount === after.leadBindingCount &&
    before.businessEventCount === after.businessEventCount
  );
}

type ProposalProof = Readonly<{
  proposalId: string;
  provider: string;
  model: string;
  proposalText: string;
  reviewDecision: string;
  reviewedText: string | null;
  reviewedByRole: string | null;
  reviewedAt: Date | null;
  reviewReason: string | null;
  proposalCount: number;
}>;

async function readProposalProof(
  connectionString: string,
  conversationId: string,
): Promise<ProposalProof> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => undefined });
  try {
    const [row] = await sql`
      select
        proposal.id,
        proposal.provider,
        proposal.model,
        proposal.proposal_text,
        proposal.review_decision,
        proposal.reviewed_text,
        proposal.reviewed_by_role,
        proposal.reviewed_at,
        proposal.review_reason,
        (select count(*)::integer
          from evo_ai_proposals as counted
          where counted.conversation_id = ${conversationId}) as proposal_count
      from evo_ai_proposals as proposal
      where proposal.conversation_id = ${conversationId}
      order by proposal.created_at desc, proposal.id desc
      limit 1
    `;
    ensure(row, "The real Gemini proposal is missing from PostgreSQL");
    return Object.freeze({
      proposalId: String(row.id),
      provider: String(row.provider),
      model: String(row.model),
      proposalText: String(row.proposal_text),
      reviewDecision: String(row.review_decision),
      reviewedText:
        row.reviewed_text === null ? null : String(row.reviewed_text),
      reviewedByRole:
        row.reviewed_by_role === null ? null : String(row.reviewed_by_role),
      reviewedAt: row.reviewed_at instanceof Date ? row.reviewed_at : null,
      reviewReason:
        row.review_reason === null ? null : String(row.review_reason),
      proposalCount: Number(row.proposal_count),
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

type WahaDatabaseProof = Readonly<{
  status: string;
  sessionName: string;
  recipientChatId: string;
  finalText: string;
  actorRole: string;
  sourceProposalId: string | null;
  providerMessageId: string;
  ack: number;
  ackName: string;
  messageExternalId: string;
  messageBody: string;
  attemptCount: number;
  outboundCount: number;
}>;

async function readWahaDatabaseProof(
  connectionString: string,
  conversationId: string,
): Promise<WahaDatabaseProof> {
  const sql = postgres(connectionString, {
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
        attempt.source_proposal_id,
        attempt.provider_message_id,
        attempt.ack,
        attempt.ack_name,
        message.external_message_id as message_external_id,
        message.body as message_body,
        (select count(*)::integer
          from evo_whatsapp_send_attempts as counted_attempt
          where counted_attempt.conversation_id = ${conversationId}) as attempt_count,
        (select count(*)::integer
          from evo_messages as counted_message
          where counted_message.conversation_id = ${conversationId}
            and counted_message.direction = 'outbound') as outbound_count
      from evo_whatsapp_send_attempts as attempt
      inner join evo_messages as message on message.id = attempt.message_id
      where attempt.conversation_id = ${conversationId}
      order by attempt.created_at desc, attempt.id desc
      limit 1
    `;
    ensure(row, "The accepted WAHA attempt is missing from PostgreSQL");
    return Object.freeze({
      status: String(row.status),
      sessionName: String(row.session_name),
      recipientChatId: String(row.recipient_chat_id),
      finalText: String(row.final_text),
      actorRole: String(row.actor_role),
      sourceProposalId:
        row.source_proposal_id === null ? null : String(row.source_proposal_id),
      providerMessageId: String(row.provider_message_id),
      ack: Number(row.ack),
      ackName: String(row.ack_name),
      messageExternalId: String(row.message_external_id),
      messageBody: String(row.message_body),
      attemptCount: Number(row.attempt_count),
      outboundCount: Number(row.outbound_count),
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

type WahaProviderReadback = Readonly<{
  id: string;
  ack: 0 | 1 | 2 | 3 | 4;
  ackName: (typeof ACK_NAMES)[keyof typeof ACK_NAMES];
}>;

async function readWahaProviderMessage(
  providerMessageId: string,
  expectedText: string,
  selfId: string,
  selfRecipientIds: ReadonlySet<string>,
): Promise<WahaProviderReadback> {
  const baseUrl = requireEnv("EVO_V2_CONNECTED_WAHA_BASE_URL");
  const apiKey = requireEnv("EVO_V2_CONNECTED_WAHA_API_KEY");
  const sessionName = requireEnv("EVO_V2_CONNECTED_WAHA_SESSION_NAME");
  const parsedBase = new URL(baseUrl);
  ensure(
    parsedBase.protocol === "http:" &&
      (parsedBase.hostname === "127.0.0.1" ||
        parsedBase.hostname === "localhost"),
    "WAHA readback did not use the private loopback contour",
  );
  const pathName =
    `/api/${encodeURIComponent(sessionName)}` +
    `/chats/${encodeURIComponent(selfId)}` +
    `/messages/${encodeURIComponent(providerMessageId)}?downloadMedia=false`;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(new URL(pathName, parsedBase), {
        method: "GET",
        headers: { Accept: "application/json", "X-Api-Key": apiKey },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error("The exact WAHA provider readback request failed");
    }
    if (response.status === 404 && attempt < 10) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    ensure(response.ok, "The exact WAHA provider readback was rejected");
    const raw = await response.text();
    ensure(
      Buffer.byteLength(raw, "utf8") <= 64 * 1024,
      "WAHA provider readback exceeded the safe bound",
    );
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("The exact WAHA provider readback was not valid JSON");
    }
    const provider = record(
      value,
      "The exact WAHA provider readback shape is invalid",
    );
    ensure(
      provider.id === providerMessageId,
      "WAHA provider message identity changed",
    );
    ensure(
      typeof provider.to === "string" && selfRecipientIds.has(provider.to),
      "WAHA provider recipient was not the connected-session self",
    );
    ensure(
      provider.fromMe === true,
      "WAHA provider readback was not an outbound self-send",
    );
    ensure(
      typeof provider.from === "string" && DIRECT_RECIPIENT.test(provider.from),
      "WAHA provider sender was not a direct identity",
    );
    ensure(
      provider.body === expectedText,
      "WAHA provider text differs from reviewed text",
    );
    ensure(
      provider.ack === 0 ||
        provider.ack === 1 ||
        provider.ack === 2 ||
        provider.ack === 3 ||
        provider.ack === 4,
      "WAHA provider readback did not contain a non-error ACK",
    );
    const ack = provider.ack;
    ensure(
      provider.ackName === ACK_NAMES[ack],
      "WAHA ACK name differs from its exact value",
    );
    ensure(
      selfRecipientIds.has(selfId),
      "Connected-session self set lost its primary identity",
    );
    return Object.freeze({
      id: providerMessageId,
      ack,
      ackName: ACK_NAMES[ack],
    });
  }
  throw new Error(
    "WAHA readback did not settle within the bounded retry window",
  );
}

type AcceptedAmoCrmAttempt = Readonly<{
  operation_name: string;
  status: string;
  correlation_id: string;
  provider_http_status: number | null;
  provider_dispatched_at: Date | null;
  provider_responded_at: Date | null;
  provider_readback: Record<string, unknown> | null;
  provider_readback_sha256: string | null;
  receipt_status: string;
  receipt_correlation_id: string;
  receipt_id: string;
}>;

async function acceptedAmoCrmDatabaseProof(
  connectionString: string,
  input: Readonly<{
    leadId: string;
    requestId: string;
    seedCorrelationId: string;
    discoverySnapshotSha256: string;
  }>,
) {
  const sql = postgres(connectionString, { max: 1, onnotice: () => undefined });
  try {
    const attempts = await sql<AcceptedAmoCrmAttempt[]>`
      select
        attempt.operation_name,
        attempt.status,
        attempt.correlation_id,
        attempt.provider_http_status,
        attempt.provider_dispatched_at,
        attempt.provider_responded_at,
        attempt.provider_readback,
        attempt.provider_readback_sha256,
        receipt.status as receipt_status,
        receipt.correlation_id as receipt_correlation_id,
        receipt.id as receipt_id
      from evo_amocrm_operation_attempts attempt
      inner join evo_command_receipts receipt
        on receipt.id = attempt.command_receipt_id
      where attempt.correlation_id = ${input.requestId}
      order by attempt.created_at, attempt.id
    `;
    ensure(
      attempts.length === OPERATIONS.length,
      "The Admin sync did not persist exactly seven amoCRM attempts",
    );
    ensure(
      new Set(attempts.map((attempt) => attempt.operation_name)).size ===
        OPERATIONS.length &&
        OPERATIONS.every((operation) =>
          attempts.some((attempt) => attempt.operation_name === operation),
        ),
      "The Admin sync did not persist the canonical amoCRM operation set",
    );
    ensure(
      attempts.every(
        (attempt) =>
          attempt.status === "accepted" &&
          attempt.receipt_status === "succeeded" &&
          attempt.correlation_id === input.requestId &&
          attempt.receipt_correlation_id === input.requestId &&
          attempt.provider_http_status !== null &&
          attempt.provider_http_status >= 200 &&
          attempt.provider_http_status < 300 &&
          attempt.provider_dispatched_at instanceof Date &&
          attempt.provider_responded_at instanceof Date &&
          attempt.provider_readback !== null &&
          typeof attempt.provider_readback_sha256 === "string" &&
          SHA256.test(attempt.provider_readback_sha256),
      ),
      "At least one amoCRM attempt lacks accepted readback evidence",
    );
    ensure(
      new Set(attempts.map((attempt) => attempt.receipt_id)).size ===
        OPERATIONS.length,
      "The amoCRM attempts did not retain seven distinct receipts",
    );

    const bindingRows = await sql<
      Array<{ provider_contact_id: string; provider_lead_id: string }>
    >`
      select contact.provider_contact_id, lead.provider_lead_id
      from evo_leads canonical_lead
      inner join evo_amocrm_contact_bindings contact
        on contact.person_id = canonical_lead.person_id
      inner join evo_amocrm_lead_bindings lead
        on lead.lead_id = canonical_lead.id
        and lead.account_id = contact.account_id
      where canonical_lead.id = ${input.leadId}
    `;
    ensure(
      bindingRows.length === 1,
      "PostgreSQL did not retain one exact amoCRM binding pair",
    );
    const providerContactId = providerId(
      bindingRows[0].provider_contact_id,
      "The amoCRM contact binding identity is invalid",
    );
    const providerLeadId = providerId(
      bindingRows[0].provider_lead_id,
      "The amoCRM lead binding identity is invalid",
    );
    const noteAttempt = attempts.find(
      (attempt) => attempt.operation_name === "lead_note_create",
    );
    ensure(
      noteAttempt?.provider_readback,
      "The amoCRM note attempt lacks readback evidence",
    );
    const providerNoteId = providerId(
      noteAttempt.provider_readback.entityId,
      "The amoCRM note identity is invalid",
    );
    const tagAttempt = attempts.find(
      (attempt) => attempt.operation_name === "lead_tag_update",
    );
    ensure(
      tagAttempt?.provider_readback,
      "The amoCRM tag attempt lacks readback evidence",
    );
    const providerManagedTagId = providerId(
      tagAttempt.provider_readback.tagId,
      "The amoCRM managed tag identity is invalid",
    );

    const eventRows = await sql<Array<{ correlation_id: string }>>`
      select correlation_id
      from evo_business_events
      where business_object_id = ${input.leadId}
        and transition = 'lead.created'
    `;
    ensure(
      eventRows.length === 1 &&
        eventRows[0].correlation_id === input.seedCorrelationId,
      "The validation lead event lost its exact seed correlation",
    );
    const discoveryRows = await sql<Array<{ count: number }>>`
      select count(*)::integer as count
      from evo_amocrm_discovery_snapshots
      where snapshot_sha256 = ${input.discoverySnapshotSha256}
    `;
    ensure(
      discoveryRows.length === 1 && discoveryRows[0].count === 1,
      "The amoCRM discovery snapshot was not persisted exactly once",
    );

    return Object.freeze({
      attemptCount: attempts.length,
      receiptCount: new Set(attempts.map((attempt) => attempt.receipt_id)).size,
      contactBindingCount: 1,
      leadBindingCount: 1,
      providerContactId,
      providerLeadId,
      providerNoteId,
      providerManagedTagId,
      readbackSetSha256: sha256(
        attempts
          .map((attempt) => attempt.provider_readback_sha256)
          .sort()
          .join(":"),
      ),
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function providerGet(
  origin: string,
  pathName: string,
  accessToken: string,
) {
  let response: Response;
  try {
    response = await fetch(`${origin}${pathName}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("The exact amoCRM provider readback was unavailable");
  }
  ensure(response.ok, "The exact amoCRM provider readback was rejected");
  const raw = await response.text();
  ensure(
    Buffer.byteLength(raw, "utf8") <= 256 * 1024,
    "amoCRM provider readback exceeded the safe bound",
  );
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("The exact amoCRM provider readback was not valid JSON");
  }
  return record(value, "The exact amoCRM provider readback shape was invalid");
}

async function exactAmoCrmProviderReadback(
  runtime: Record<string, unknown>,
  context: Record<string, unknown>,
  database: Awaited<ReturnType<typeof acceptedAmoCrmDatabaseProof>>,
) {
  const providerEnvironment = record(
    runtime.providerEnvironment,
    "The private amoCRM provider environment is invalid",
  );
  const baseUrl = providerEnvironment.EVO_V2_AMOCRM_BASE_URL;
  const tokenPath = providerEnvironment.EVO_V2_AMOCRM_TOKEN_FILE;
  ensure(typeof baseUrl === "string", "The private amoCRM base URL is invalid");
  ensure(
    typeof tokenPath === "string",
    "The private amoCRM token path is invalid",
  );
  const parsedBase = new URL(baseUrl);
  ensure(
    parsedBase.protocol === "https:" &&
      parsedBase.origin === baseUrl.replace(/\/$/u, "") &&
      /[.](amocrm[.]ru|kommo[.]com)$/u.test(parsedBase.hostname),
    "The private amoCRM provider origin is invalid",
  );
  const token = await privateJson(
    path.resolve(tokenPath),
    "Private amoCRM OAuth token",
  );
  const accessToken = token.access_token;
  ensure(
    typeof accessToken === "string" && accessToken.length >= 1,
    "The private amoCRM OAuth access token is invalid",
  );
  const routing = record(
    context.routing,
    "The private amoCRM routing is invalid",
  );
  const sales = record(routing.sales, "The private Sales routing is invalid");
  const admissions = record(
    routing.admissions,
    "The private Admissions routing is invalid",
  );
  const fields = record(
    routing.contactCustomFields,
    "The private contact-field routing is invalid",
  );
  const displayName = context.displayName;
  const expectedPhoneSha256 = context.selfPhoneSha256;
  ensure(
    typeof displayName === "string",
    "The private validation name is invalid",
  );
  ensure(
    typeof expectedPhoneSha256 === "string" && SHA256.test(expectedPhoneSha256),
    "The private validation phone digest is invalid",
  );

  const contact = await providerGet(
    parsedBase.origin,
    `/api/v4/contacts/${database.providerContactId}?with=leads`,
    accessToken,
  );
  ensure(
    providerId(contact.id, "amoCRM contact readback identity changed") ===
      database.providerContactId && contact.name === displayName,
    "amoCRM contact readback did not match the validation entity",
  );
  const phoneFields = array(
    contact.custom_fields_values,
    "amoCRM contact custom fields were invalid",
  ).filter((fieldValue) => {
    const field = record(fieldValue, "amoCRM contact custom field was invalid");
    return (
      providerId(
        field.field_id,
        "amoCRM contact field identity was invalid",
      ) === String(fields.phoneFieldId)
    );
  });
  ensure(phoneFields.length === 1, "amoCRM contact phone field was not exact");
  const phoneValues = array(
    record(phoneFields[0], "amoCRM contact phone field was invalid").values,
    "amoCRM contact phone values were invalid",
  );
  ensure(phoneValues.length === 1, "amoCRM contact phone value was not exact");
  const phoneValue = record(
    phoneValues[0],
    "amoCRM contact phone value was invalid",
  ).value;
  ensure(
    typeof phoneValue === "string" &&
      sha256(phoneValue) === expectedPhoneSha256,
    "amoCRM contact phone did not match the connected WAHA self identity",
  );

  const lead = await providerGet(
    parsedBase.origin,
    `/api/v4/leads/${database.providerLeadId}?with=contacts`,
    accessToken,
  );
  ensure(
    providerId(lead.id, "amoCRM lead readback identity changed") ===
      database.providerLeadId &&
      lead.name === displayName &&
      providerId(lead.pipeline_id, "amoCRM lead pipeline was invalid") ===
        String(sales.pipelineId) &&
      providerId(lead.status_id, "amoCRM lead status was invalid") ===
        String(sales.statusId) &&
      providerId(
        lead.responsible_user_id,
        "amoCRM responsible user was invalid",
      ) === String(sales.responsibleUserId),
    "amoCRM lead readback did not match the exact Sales route",
  );
  const leadTags = array(
    record(lead._embedded, "amoCRM embedded lead data was invalid").tags,
    "amoCRM lead tags were invalid",
  ).map((tagValue) => {
    const tag = record(tagValue, "amoCRM lead tag was invalid");
    return Object.freeze({
      id: providerId(tag.id, "amoCRM lead tag identity was invalid"),
      name: tag.name,
    });
  });
  const exactSalesTags = leadTags.filter((tag) => tag.name === "EVO V2 Sales");
  ensure(
    exactSalesTags.length === 1 &&
      exactSalesTags[0].id === database.providerManagedTagId &&
      (sales.tagId === null || exactSalesTags[0].id === String(sales.tagId)) &&
      !leadTags.some((tag) => tag.name === "EVO V2 Admissions") &&
      (admissions.tagId === null ||
        !leadTags.some((tag) => tag.id === String(admissions.tagId))),
    "amoCRM lead tags did not preserve the exact fixed-role state",
  );

  const links = await providerGet(
    parsedBase.origin,
    `/api/v4/leads/${database.providerLeadId}/links`,
    accessToken,
  );
  const mainContacts = array(
    record(links._embedded, "amoCRM link readback was invalid").links,
    "amoCRM link collection was invalid",
  ).filter((linkValue) => {
    const link = record(linkValue, "amoCRM link was invalid");
    const metadata = record(link.metadata, "amoCRM link metadata was invalid");
    return link.to_entity_type === "contacts" && metadata.main_contact === true;
  });
  ensure(
    mainContacts.length === 1,
    "amoCRM lead did not retain one main contact",
  );
  ensure(
    providerId(
      record(mainContacts[0], "amoCRM main contact link was invalid")
        .to_entity_id,
      "amoCRM main contact identity was invalid",
    ) === database.providerContactId,
    "amoCRM main contact link changed identity",
  );

  const note = await providerGet(
    parsedBase.origin,
    `/api/v4/leads/notes/${database.providerNoteId}`,
    accessToken,
  );
  const noteParams = record(note.params, "amoCRM note parameters were invalid");
  ensure(
    providerId(note.id, "amoCRM note identity changed") ===
      database.providerNoteId &&
      providerId(note.entity_id, "amoCRM note lead identity changed") ===
        database.providerLeadId &&
      noteParams.text === AMOCRM_NOTE_TEXT,
    "amoCRM note readback did not match the exact validation note",
  );

  const contactSearch = await providerGet(
    parsedBase.origin,
    `/api/v4/contacts?limit=250&filter%5Bname%5D%5B%5D=${encodeURIComponent(displayName)}`,
    accessToken,
  );
  const validationContacts = array(
    record(
      contactSearch._embedded,
      "amoCRM contact search envelope was invalid",
    ).contacts,
    "amoCRM contact search collection was invalid",
  ).filter((candidate) => {
    const scoped = record(candidate, "amoCRM contact search item was invalid");
    return scoped.name === displayName;
  });
  ensure(
    validationContacts.length === 1,
    "amoCRM validation scope contains a duplicate contact",
  );
  const validationContactId = providerId(
    record(validationContacts[0], "amoCRM validation contact was invalid").id,
    "amoCRM validation contact identity was invalid",
  );
  ensure(
    validationContactId === database.providerContactId,
    "amoCRM validation contact changed identity",
  );

  const leadSearch = await providerGet(
    parsedBase.origin,
    `/api/v4/leads?limit=250&filter%5Bname%5D%5B%5D=${encodeURIComponent(displayName)}`,
    accessToken,
  );
  const validationLeads = array(
    record(leadSearch._embedded, "amoCRM lead search envelope was invalid")
      .leads,
    "amoCRM lead search collection was invalid",
  ).filter((candidate) => {
    const scoped = record(candidate, "amoCRM lead search item was invalid");
    return scoped.name === displayName;
  });
  ensure(
    validationLeads.length === 1,
    "amoCRM validation scope contains a duplicate lead",
  );
  const validationLeadId = providerId(
    record(validationLeads[0], "amoCRM validation lead was invalid").id,
    "amoCRM validation lead identity was invalid",
  );
  ensure(
    validationLeadId === database.providerLeadId,
    "amoCRM validation lead changed identity",
  );

  const noteSearch = await providerGet(
    parsedBase.origin,
    `/api/v4/leads/${database.providerLeadId}/notes?limit=250&filter%5Bnote_type%5D%5B%5D=common`,
    accessToken,
  );
  const validationNotes = array(
    record(noteSearch._embedded, "amoCRM note search envelope was invalid")
      .notes,
    "amoCRM note search collection was invalid",
  ).filter((candidate) => {
    const scopedNote = record(candidate, "amoCRM note search item was invalid");
    const params = record(
      scopedNote.params,
      "amoCRM note search params were invalid",
    );
    return (
      scopedNote.note_type === "common" && params.text === AMOCRM_NOTE_TEXT
    );
  });
  ensure(
    validationNotes.length === 1,
    "amoCRM validation scope contains a duplicate note",
  );
  const validationNoteId = providerId(
    record(validationNotes[0], "amoCRM validation note was invalid").id,
    "amoCRM validation note identity was invalid",
  );
  ensure(
    validationNoteId === database.providerNoteId,
    "amoCRM validation note changed identity",
  );

  return Object.freeze({
    exactReadback: true,
    entitySetSha256: sha256(
      [
        `contact:${validationContactId}`,
        `lead:${validationLeadId}`,
        `note:${validationNoteId}`,
      ].join(":"),
    ),
    validationContactCount: validationContacts.length,
    validationLeadCount: validationLeads.length,
    validationNoteCount: validationNotes.length,
    managedRoleTagCount: 1,
    mainContactCount: mainContacts.length,
  });
}

async function runAmoCrmSyncReplayAndReload(
  page: Page,
  input: Readonly<{
    databaseUrl: string;
    leadId: string;
    conversationId: string;
    seedCorrelationId: string;
    discoverySnapshotSha256: string;
    expectedWahaProviderMessageId: string;
    runtime: Record<string, unknown>;
    context: Record<string, unknown>;
  }>,
) {
  await page.goto(`/sales/${input.leadId}`);
  const amoPanel = page.getByTestId("canonical-amocrm-command-panel");
  await expect(amoPanel).toBeVisible();
  await expect(
    amoPanel.getByTestId("canonical-amocrm-provider-availability"),
  ).toHaveAttribute("data-status", "ready");
  const amoRequestId = await amoPanel
    .getByTestId("canonical-amocrm-sync-form")
    .locator('input[name="request_id"]')
    .inputValue();
  ensure(
    UUID.test(amoRequestId),
    "The exact amoCRM command identity is invalid",
  );
  await amoPanel
    .getByTestId("canonical-amocrm-note-text")
    .fill(AMOCRM_NOTE_TEXT);
  await amoPanel.getByTestId("canonical-amocrm-sync").click();
  await expect(
    amoPanel.getByTestId("canonical-amocrm-command-state"),
  ).toHaveAttribute("data-status", "accepted", { timeout: 150_000 });
  const amoSteps = amoPanel.getByTestId("canonical-amocrm-command-step");
  await expect(amoSteps).toHaveCount(OPERATIONS.length);
  for (const operation of OPERATIONS) {
    await expect(
      amoPanel.locator(
        `[data-testid="canonical-amocrm-command-step"][data-operation="${operation}"]`,
      ),
    ).toHaveCount(1);
  }
  const amoDatabase = await acceptedAmoCrmDatabaseProof(input.databaseUrl, {
    leadId: input.leadId,
    requestId: amoRequestId,
    seedCorrelationId: input.seedCorrelationId,
    discoverySnapshotSha256: input.discoverySnapshotSha256,
  });
  const amoProvider = await exactAmoCrmProviderReadback(
    input.runtime,
    input.context,
    amoDatabase,
  );
  const beforeReplay = await readMutationCounts(
    input.databaseUrl,
    input.leadId,
    input.conversationId,
  );

  const replayRequestInput = amoPanel
    .getByTestId("canonical-amocrm-sync-form")
    .locator('input[name="request_id"]');
  await replayRequestInput.evaluate((element, exactRequestId) => {
    (element as HTMLInputElement).value = exactRequestId;
  }, amoRequestId);
  await amoPanel
    .getByTestId("canonical-amocrm-note-text")
    .fill(AMOCRM_NOTE_TEXT);
  const replayResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "POST" &&
      url.pathname === `/sales/${input.leadId}`
    );
  });
  await amoPanel.getByTestId("canonical-amocrm-sync").click();
  const replayResponse = await replayResponsePromise;
  ensure(replayResponse.ok(), "The exact amoCRM UI replay was rejected");
  await expect(
    amoPanel.getByTestId("canonical-amocrm-command-state"),
  ).toHaveAttribute("data-status", "accepted");
  const replayDatabase = await acceptedAmoCrmDatabaseProof(input.databaseUrl, {
    leadId: input.leadId,
    requestId: amoRequestId,
    seedCorrelationId: input.seedCorrelationId,
    discoverySnapshotSha256: input.discoverySnapshotSha256,
  });
  ensure(
    replayDatabase.attemptCount === amoDatabase.attemptCount &&
      replayDatabase.receiptCount === amoDatabase.receiptCount &&
      replayDatabase.contactBindingCount === amoDatabase.contactBindingCount &&
      replayDatabase.leadBindingCount === amoDatabase.leadBindingCount &&
      replayDatabase.providerContactId === amoDatabase.providerContactId &&
      replayDatabase.providerLeadId === amoDatabase.providerLeadId &&
      replayDatabase.providerNoteId === amoDatabase.providerNoteId &&
      replayDatabase.providerManagedTagId ===
        amoDatabase.providerManagedTagId &&
      replayDatabase.readbackSetSha256 === amoDatabase.readbackSetSha256,
    "Exact amoCRM replay created another attempt, receipt, binding, or entity",
  );
  const replayProvider = await exactAmoCrmProviderReadback(
    input.runtime,
    input.context,
    replayDatabase,
  );
  ensure(
    replayProvider.exactReadback === true &&
      replayProvider.entitySetSha256 === amoProvider.entitySetSha256 &&
      replayProvider.validationContactCount ===
        amoProvider.validationContactCount &&
      replayProvider.validationLeadCount === amoProvider.validationLeadCount &&
      replayProvider.validationNoteCount === amoProvider.validationNoteCount &&
      replayProvider.managedRoleTagCount === amoProvider.managedRoleTagCount &&
      replayProvider.mainContactCount === amoProvider.mainContactCount,
    "Exact amoCRM replay changed the provider entity set",
  );
  const afterReplay = await readMutationCounts(
    input.databaseUrl,
    input.leadId,
    input.conversationId,
  );
  ensure(
    afterReplay.proposalCount === beforeReplay.proposalCount &&
      afterReplay.wahaAttemptCount === beforeReplay.wahaAttemptCount &&
      afterReplay.outboundMessageCount === beforeReplay.outboundMessageCount &&
      afterReplay.messageCount === beforeReplay.messageCount &&
      afterReplay.amocrmAttemptCount === beforeReplay.amocrmAttemptCount &&
      afterReplay.commandReceiptCount === beforeReplay.commandReceiptCount &&
      afterReplay.contactBindingCount === beforeReplay.contactBindingCount &&
      afterReplay.leadBindingCount === beforeReplay.leadBindingCount &&
      afterReplay.businessEventCount === beforeReplay.businessEventCount,
    "Exact replay added a message, attempt, receipt, binding, or business event",
  );

  await page.reload();
  await expect(
    page.getByTestId("canonical-sales-lead-workspace"),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("canonical-amocrm-command-panel")
      .getByTestId("canonical-amocrm-provider-availability"),
  ).toHaveAttribute("data-status", "ready");
  const persistedWaha = await readWahaDatabaseProof(
    input.databaseUrl,
    input.conversationId,
  );
  const persistedAmo = await acceptedAmoCrmDatabaseProof(input.databaseUrl, {
    leadId: input.leadId,
    requestId: amoRequestId,
    seedCorrelationId: input.seedCorrelationId,
    discoverySnapshotSha256: input.discoverySnapshotSha256,
  });
  ensure(
    persistedWaha.providerMessageId === input.expectedWahaProviderMessageId &&
      persistedWaha.attemptCount === 1 &&
      persistedWaha.outboundCount === 1 &&
      persistedAmo.readbackSetSha256 === amoDatabase.readbackSetSha256,
    "Reload changed the persisted canonical provider results",
  );

  return Object.freeze({ amoDatabase, amoProvider, beforeReplay, afterReplay });
}

test("all three provider authorities fail closed before any dispatch", async ({
  page,
  request,
}) => {
  test.skip(
    requiredMode() !== "blocked",
    "operator pass runs this spec separately",
  );
  test.setTimeout(120_000);
  const { gitSha, evidenceDir, contextFile } = acceptanceInputs();
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await chmod(evidenceDir, 0o700);
  const context = await privateJson(
    contextFile,
    "Private V2-10D validation context",
  );
  const leadId = context.leadId;
  const expectedPhoneSha256 = context.selfPhoneSha256;
  ensure(
    typeof leadId === "string" && UUID.test(leadId),
    "Validation lead is invalid",
  );
  ensure(
    typeof expectedPhoneSha256 === "string" && SHA256.test(expectedPhoneSha256),
    "Validation phone digest is invalid",
  );
  const { selfId } = connectedSelfIdentities();
  const seed = await seedCanonicalSelfConversation(request, {
    gitSha,
    selfId,
    expectedLeadId: leadId,
    expectedPhoneSha256,
  });
  const databaseUrl = requireEnv("DATABASE_URL");
  const before = await readMutationCounts(
    databaseUrl,
    leadId,
    seed.conversationId,
  );
  ensure(
    before.proposalCount === 0 &&
      before.wahaAttemptCount === 0 &&
      before.outboundMessageCount === 0 &&
      before.amocrmAttemptCount === 0 &&
      before.contactBindingCount === 0 &&
      before.leadBindingCount === 0,
    "Blocked-authority pass did not start from a clean provider-mutation state",
  );

  await submitAdminGate(page);
  await page.goto(`/whatsapp/${seed.conversationId}`);
  await expect(
    page.getByTestId("canonical-staff-whatsapp-thread"),
  ).toBeVisible();
  const geminiAvailability = page.getByTestId(
    "canonical-gemini-proposal-availability",
  );
  await expect(geminiAvailability).toHaveAttribute("data-status", "blocked");
  await expect(geminiAvailability).toHaveAttribute(
    "data-reason",
    "provider_not_authorized",
  );
  await page.getByTestId("canonical-gemini-proposal-request").click();
  await expect(
    page.getByTestId("canonical-gemini-proposal-action-state"),
  ).toHaveAttribute("data-status", "blocked");
  await expect(
    page.getByTestId("canonical-gemini-proposal-action-state"),
  ).toHaveAttribute("data-reason", "provider_not_authorized");

  const wahaAvailability = page.getByTestId(
    "canonical-whatsapp-provider-availability",
  );
  await expect(wahaAvailability).toHaveAttribute("data-status", "blocked");
  await expect(wahaAvailability).toHaveAttribute(
    "data-reason",
    "provider_not_authorized",
  );
  await expect(
    page.getByTestId("canonical-whatsapp-outbound-send"),
  ).toBeDisabled();

  await page.goto(`/sales/${leadId}`);
  const amoPanel = page.getByTestId("canonical-amocrm-command-panel");
  await expect(amoPanel).toBeVisible();
  await expect(
    amoPanel.getByTestId("canonical-amocrm-provider-availability"),
  ).toHaveAttribute("data-status", "blocked");
  await expect(
    amoPanel.getByTestId("canonical-amocrm-provider-availability"),
  ).toContainText(
    /Серверное разрешение провайдера не включено[.]|Server-side provider authorization is disabled[.]|Сервердик провайдер уруксаты өчүрүлгөн[.]/u,
  );
  await expect(
    amoPanel.getByTestId("canonical-amocrm-note-text"),
  ).toBeDisabled();
  await expect(amoPanel.getByTestId("canonical-amocrm-sync")).toBeDisabled();

  const after = await readMutationCounts(
    databaseUrl,
    leadId,
    seed.conversationId,
  );
  ensure(
    after.proposalCount === before.proposalCount &&
      after.wahaAttemptCount === before.wahaAttemptCount &&
      after.outboundMessageCount === before.outboundMessageCount &&
      after.messageCount === before.messageCount &&
      after.amocrmAttemptCount === before.amocrmAttemptCount &&
      after.commandReceiptCount === before.commandReceiptCount &&
      after.contactBindingCount === before.contactBindingCount &&
      after.leadBindingCount === before.leadBindingCount &&
      after.businessEventCount === before.businessEventCount,
    "A disabled provider authority dispatched, persisted success, or fell back",
  );

  await durableCreateJson(path.join(evidenceDir, "authority-blocked.json"), {
    schemaVersion: 1,
    kind: "evo-v2-10d-authority-blocked",
    status: "passed",
    proofMode: "all-provider-authority-disabled",
    gitSha,
    completedAt: new Date().toISOString(),
    checks: {
      geminiAvailability: "blocked",
      geminiProposalCount: after.proposalCount,
      wahaAvailability: "blocked",
      wahaSendAttemptCount: after.wahaAttemptCount,
      wahaOutboundMessageCount: after.outboundMessageCount,
      amocrmAvailability: "blocked",
      amocrmProviderAttemptCount: after.amocrmAttemptCount,
      amocrmBindingCount: after.contactBindingCount + after.leadBindingCount,
      fallbackObserved: false,
    },
    boundaries: {
      database: "disposable_local_postgresql",
      target: "connected_waha_session_self_validation_entity",
      v1ApplicationPathExecuted: false,
      providerMutation: false,
      deploymentMutated: false,
    },
  });
});

test("one human-reviewed Gemini proposal drives one WAHA self-send and one amoCRM sync", async ({
  page,
  request,
}) => {
  const mode = requiredMode();
  const postWahaRecovery = mode === "post-waha";
  test.skip(mode === "blocked" || postWahaRecovery, "separate pass");
  const recoveryMode = mode === "recovery";
  test.setTimeout(recoveryMode ? 0 : 45 * 60 * 1_000);
  const { gitSha, recoverySha, evidenceDir, runtimeFile, contextFile } =
    acceptanceInputs();
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await chmod(evidenceDir, 0o700);
  const blockedMarker = await privateJson(
    path.join(evidenceDir, "authority-blocked.json"),
    "V2-10D disabled-authority marker",
  );
  ensure(
    blockedMarker.status === "passed" &&
      blockedMarker.gitSha === gitSha &&
      blockedMarker.proofMode === "all-provider-authority-disabled",
    "The exact-SHA disabled-authority proof is missing",
  );

  const runtime = await privateJson(
    runtimeFile,
    "Private V2-10D provider runtime",
  );
  const context = await privateJson(
    contextFile,
    "Private V2-10D validation context",
  );
  const leadId = context.leadId;
  const seedCorrelationId = context.seedCorrelationId;
  const expectedPhoneSha256 = context.selfPhoneSha256;
  const discovery = record(
    context.discovery,
    "Private amoCRM discovery context is missing",
  );
  ensure(
    typeof leadId === "string" && UUID.test(leadId),
    "Validation lead is invalid",
  );
  ensure(
    typeof seedCorrelationId === "string" && UUID.test(seedCorrelationId),
    "Validation seed correlation is invalid",
  );
  ensure(
    typeof expectedPhoneSha256 === "string" && SHA256.test(expectedPhoneSha256),
    "Validation phone digest is invalid",
  );
  ensure(
    typeof discovery.snapshotSha256 === "string" &&
      SHA256.test(discovery.snapshotSha256),
    "amoCRM discovery snapshot digest is invalid",
  );

  const { selfId, selfRecipientIds } = connectedSelfIdentities();
  const sessionName = requireEnv("EVO_V2_CONNECTED_WAHA_SESSION_NAME");
  const databaseUrl = requireEnv("DATABASE_URL");
  const seed = recoveryMode
    ? await readExistingSelfConversation(databaseUrl, { leadId, selfId })
    : await seedCanonicalSelfConversation(request, {
        gitSha,
        selfId,
        expectedLeadId: leadId,
        expectedPhoneSha256,
      });
  const beforeProposal = await readMutationCounts(
    databaseUrl,
    leadId,
    seed.conversationId,
  );
  ensure(
    beforeProposal.proposalCount === (recoveryMode ? 1 : 0) &&
      beforeProposal.wahaAttemptCount === 0 &&
      beforeProposal.outboundMessageCount === 0 &&
      beforeProposal.amocrmAttemptCount === 0 &&
      beforeProposal.contactBindingCount === 0 &&
      beforeProposal.leadBindingCount === 0,
    "Operator or recovery pass did not begin from the exact preserved provider-mutation state",
  );

  await submitAdminGate(page);
  await page.goto(`/whatsapp/${seed.conversationId}`);
  await expect(
    page.getByTestId("canonical-staff-whatsapp-thread"),
  ).toBeVisible();
  await expect(
    page.getByTestId("canonical-gemini-proposal-availability"),
  ).toHaveAttribute("data-status", recoveryMode ? "blocked" : "ready");
  await expect(
    page.getByTestId("canonical-whatsapp-provider-availability"),
  ).toHaveAttribute("data-status", "configured");
  await expect(
    page.getByTestId("canonical-whatsapp-outbound-recipient"),
  ).toHaveText(selfId);

  if (!recoveryMode) {
    await page.getByTestId("canonical-gemini-proposal-request").click();
    const proposalActionState = page.getByTestId(
      "canonical-gemini-proposal-action-state",
    );
    await expect
      .poll(
        async () =>
          (await proposalActionState.getAttribute("data-status")) ?? "",
        { timeout: 90_000 },
      )
      .toMatch(/^(?:blocked|created|error|invalid)$/u);
    const proposalStatus =
      await proposalActionState.getAttribute("data-status");
    if (proposalStatus !== "created") {
      const proposalReason =
        await proposalActionState.getAttribute("data-reason");
      ensure(
        typeof proposalReason === "string" &&
          /^[a-z][a-z0-9_]{0,63}$/u.test(proposalReason),
        "The proposal-stage failure reason was not a bounded code",
      );
      const afterProposalFailure = await readMutationCounts(
        databaseUrl,
        leadId,
        seed.conversationId,
      );
      ensure(
        sameMutationCounts(beforeProposal, afterProposalFailure),
        "The failed Gemini proposal stage changed canonical or provider mutation state",
      );
      await durableCreateJson(path.join(evidenceDir, "proposal-error.json"), {
        schemaVersion: 1,
        kind: "evo-v2-10d-proposal-error",
        status: "stopped_before_review",
        gitSha,
        createdAt: new Date().toISOString(),
        actionStatus: proposalStatus,
        reasonCode: proposalReason,
        providerMutationCounts: afterProposalFailure,
        boundaries: {
          humanReviewReached: false,
          outboundDispatchReached: false,
          amocrmSyncReached: false,
          retryAuthorized: false,
        },
      });
      throw new Error("The real Gemini proposal stopped before human review");
    }
  }
  const latestProposal = page.getByTestId("canonical-gemini-proposal-latest");
  await expect(latestProposal).toBeVisible();
  await expect(latestProposal).toHaveAttribute(
    "data-review-decision",
    "pending",
  );
  await expect(
    page.getByTestId("canonical-gemini-review-controls"),
  ).toBeVisible();
  const uiProposalId = await latestProposal.getAttribute("data-proposal-id");
  const uiProposalText = (await latestProposal.textContent())?.trim() ?? "";
  ensure(
    typeof uiProposalId === "string" && UUID.test(uiProposalId),
    "The real Gemini proposal UI identity is invalid",
  );
  ensure(
    uiProposalText.length > 0,
    "The real Gemini proposal UI text is empty",
  );

  const pendingProposal = await readProposalProof(
    databaseUrl,
    seed.conversationId,
  );
  ensure(
    pendingProposal.proposalId === uiProposalId &&
      pendingProposal.provider === "gemini" &&
      pendingProposal.model.length > 0 &&
      pendingProposal.proposalText === uiProposalText &&
      pendingProposal.reviewDecision === "pending" &&
      pendingProposal.reviewedText === null &&
      pendingProposal.proposalCount === 1,
    "PostgreSQL did not persist exactly the provider-created pending proposal",
  );
  const atReviewRequired = await readMutationCounts(
    databaseUrl,
    leadId,
    seed.conversationId,
  );
  ensure(
    atReviewRequired.proposalCount === 1 &&
      atReviewRequired.wahaAttemptCount === 0 &&
      atReviewRequired.outboundMessageCount === 0 &&
      atReviewRequired.amocrmAttemptCount === 0 &&
      atReviewRequired.contactBindingCount === 0 &&
      atReviewRequired.leadBindingCount === 0,
    "The Gemini proposal stage mutated WAHA or amoCRM state",
  );
  if (recoveryMode) {
    const reviewMarker = await privateJson(
      path.join(evidenceDir, "review-required.json"),
      "V2-10D preserved human-review marker",
    );
    const reviewMarkerProposal = record(
      reviewMarker.proposal,
      "V2-10D preserved proposal marker is invalid",
    );
    const reviewMarkerProviderMutation = record(
      reviewMarker.providerMutation,
      "V2-10D preserved provider counts are invalid",
    );
    ensure(
      reviewMarker.status === "review_required" &&
        reviewMarker.gitSha === gitSha &&
        reviewMarkerProposal.proposalIdSha256 ===
          sha256(pendingProposal.proposalId) &&
        reviewMarkerProposal.draftSha256 ===
          sha256(pendingProposal.proposalText) &&
        reviewMarkerProposal.modelSha256 === sha256(pendingProposal.model) &&
        reviewMarkerProposal.proposalCount === 1 &&
        reviewMarkerProposal.reviewDecision === "pending" &&
        reviewMarkerProviderMutation.wahaSendAttemptCount === 0 &&
        reviewMarkerProviderMutation.wahaOutboundMessageCount === 0 &&
        reviewMarkerProviderMutation.amocrmProviderAttemptCount === 0 &&
        reviewMarkerProviderMutation.amocrmBindingCount === 0,
      "The preserved review marker does not match PostgreSQL exactly",
    );
  } else {
    await durableCreateJson(path.join(evidenceDir, "review-required.json"), {
      schemaVersion: 1,
      kind: "evo-v2-10d-human-review",
      status: "review_required",
      gitSha,
      createdAt: new Date().toISOString(),
      proposal: {
        proposalIdSha256: sha256(pendingProposal.proposalId),
        draftSha256: sha256(pendingProposal.proposalText),
        modelSha256: sha256(pendingProposal.model),
        proposalCount: pendingProposal.proposalCount,
        reviewDecision: pendingProposal.reviewDecision,
      },
      providerMutation: {
        wahaSendAttemptCount: atReviewRequired.wahaAttemptCount,
        wahaOutboundMessageCount: atReviewRequired.outboundMessageCount,
        amocrmProviderAttemptCount: atReviewRequired.amocrmAttemptCount,
        amocrmBindingCount:
          atReviewRequired.contactBindingCount +
          atReviewRequired.leadBindingCount,
      },
      boundaries: {
        target: "connected_waha_session_self_validation_entity",
        humanActionRequired: true,
        automatedReviewAction: false,
        automatedSendAction: false,
        rerunPolicy: "preserve_database_and_inspect_before_any_rerun",
      },
    });
  }

  // Keep the outbound controls inert across the review refresh until the
  // durable dispatch marker exists. This does not choose a review or send;
  // it only closes the tiny race between the human decision and fsync.
  const outboundHold = await page.addStyleTag({
    content:
      '[data-testid="canonical-whatsapp-outbound-confirm"], [data-testid="canonical-whatsapp-outbound-send"] { pointer-events: none !important; }',
  });
  await page.evaluate(() => {
    const scopedWindow = window as Window & {
      __evoV2DispatchMarkerBlocker?: EventListener;
    };
    const blocker: EventListener = (event) => {
      const form = event.target;
      if (
        form instanceof HTMLFormElement &&
        form.querySelector('[data-testid="canonical-whatsapp-outbound-send"]')
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    scopedWindow.__evoV2DispatchMarkerBlocker = blocker;
    document.addEventListener("submit", blocker, true);
  });

  // This is the real product decision. The headed browser remains on the
  // canonical review controls; Playwright deliberately does not click accept,
  // edit, or reject on behalf of the human operator.
  const humanActionTimeout = recoveryMode ? 0 : 20 * 60 * 1_000;
  const finalReview = page.getByTestId("canonical-gemini-review-final");
  await expect(finalReview).toBeVisible({ timeout: humanActionTimeout });
  const decision = await finalReview.getAttribute("data-review-decision");
  ensure(
    decision === "accepted" || decision === "edited" || decision === "rejected",
    "The human review ended in an invalid decision",
  );
  const reviewedProposal = await readProposalProof(
    databaseUrl,
    seed.conversationId,
  );
  ensure(
    reviewedProposal.proposalId === pendingProposal.proposalId &&
      reviewedProposal.proposalCount === 1 &&
      reviewedProposal.reviewDecision === decision &&
      reviewedProposal.reviewedByRole === "admin" &&
      reviewedProposal.reviewedAt instanceof Date,
    "PostgreSQL did not persist the exact human review decision",
  );
  const afterReview = await readMutationCounts(
    databaseUrl,
    leadId,
    seed.conversationId,
  );
  ensure(
    afterReview.wahaAttemptCount === 0 &&
      afterReview.outboundMessageCount === 0 &&
      afterReview.amocrmAttemptCount === 0 &&
      afterReview.contactBindingCount === 0 &&
      afterReview.leadBindingCount === 0,
    "Human proposal review caused an unauthorized provider mutation",
  );
  if (decision === "rejected") {
    ensure(
      reviewedProposal.reviewedText === null &&
        typeof reviewedProposal.reviewReason === "string" &&
        reviewedProposal.reviewReason.trim().length > 0,
      "The rejected proposal lacks its durable human reason",
    );
    await durableCreateJson(path.join(evidenceDir, "review-rejected.json"), {
      schemaVersion: 1,
      kind: "evo-v2-10d-human-review",
      status: "rejected_stopped_safely",
      gitSha,
      completedAt: new Date().toISOString(),
      proposalIdSha256: sha256(reviewedProposal.proposalId),
      reviewReasonSha256: sha256(reviewedProposal.reviewReason),
      providerMutation: false,
    });
    throw new Error(
      "Human rejected the Gemini proposal; provider workflow stopped safely",
    );
  }
  ensure(
    typeof reviewedProposal.reviewedText === "string" &&
      reviewedProposal.reviewedText.trim().length > 0,
    "Accepted human review lacks the exact final text",
  );
  const reviewedText = reviewedProposal.reviewedText;

  const composerText = page.getByTestId("canonical-whatsapp-outbound-text");
  await expect(composerText).toHaveValue(reviewedText, { timeout: 15_000 });
  const composer = page.getByTestId("canonical-whatsapp-outbound-composer");
  await expect(
    composer.locator('input[name="source_proposal_id"]'),
  ).toHaveValue(reviewedProposal.proposalId);
  const confirmation = page.getByTestId("canonical-whatsapp-outbound-confirm");
  const send = page.getByTestId("canonical-whatsapp-outbound-send");
  await expect(confirmation).not.toBeChecked();
  await expect(send).toBeDisabled();
  const sendRequestId = await composer
    .locator('input[name="send_request_id"]')
    .inputValue();
  ensure(
    UUID.test(sendRequestId),
    "The exact WAHA send request identity is invalid",
  );
  const beforeDispatchMarker = await readMutationCounts(
    databaseUrl,
    leadId,
    seed.conversationId,
  );
  ensure(
    beforeDispatchMarker.wahaAttemptCount === 0 &&
      beforeDispatchMarker.outboundMessageCount === 0 &&
      beforeDispatchMarker.amocrmAttemptCount === 0,
    "A provider dispatch occurred before the durable dispatch marker",
  );
  await durableCreateJson(path.join(evidenceDir, "dispatch-attempt.json"), {
    schemaVersion: 1,
    kind: "evo-v2-10d-real-provider-workflow",
    status: "dispatch_intent_recorded",
    gitSha,
    recovery: {
      occurred: recoveryMode,
      codeSha: recoverySha,
    },
    createdAt: new Date().toISOString(),
    review: {
      decision,
      proposalIdSha256: sha256(reviewedProposal.proposalId),
      reviewedTextSha256: sha256(reviewedText),
    },
    whatsapp: {
      requestIdSha256: sha256(sendRequestId),
      targetClass: "connected_provider_session_self",
      sendAttemptCountBeforeHumanAction: beforeDispatchMarker.wahaAttemptCount,
    },
    nextAuthorizedStep: "human_explicit_whatsapp_confirmation_and_send",
    rerunPolicy: "exact_read_only_reconciliation_before_any_resume",
  });
  await page.evaluate(
    ({ expectedText, expectedProposalId }) => {
      const scopedWindow = window as Window & {
        __evoV2ReviewedTextBlocker?: EventListener;
      };
      const blocker: EventListener = (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        const sendButton = form.querySelector(
          '[data-testid="canonical-whatsapp-outbound-send"]',
        );
        if (!sendButton) return;
        const text = form.querySelector<HTMLTextAreaElement>(
          '[data-testid="canonical-whatsapp-outbound-text"]',
        );
        const proposal = form.querySelector<HTMLInputElement>(
          'input[name="source_proposal_id"]',
        );
        if (
          text?.value !== expectedText ||
          proposal?.value !== expectedProposalId
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      };
      scopedWindow.__evoV2ReviewedTextBlocker = blocker;
      document.addEventListener("submit", blocker, true);
    },
    {
      expectedText: reviewedText,
      expectedProposalId: reviewedProposal.proposalId,
    },
  );
  await composerText.evaluate((element) => {
    (element as HTMLTextAreaElement).readOnly = true;
  });
  await outboundHold.evaluate((element) => {
    element.parentNode?.removeChild(element);
  });
  await page.evaluate(() => {
    const scopedWindow = window as Window & {
      __evoV2DispatchMarkerBlocker?: EventListener;
    };
    const blocker = scopedWindow.__evoV2DispatchMarkerBlocker;
    if (blocker) document.removeEventListener("submit", blocker, true);
    delete scopedWindow.__evoV2DispatchMarkerBlocker;
  });

  // The human now checks the confirmation box and clicks send in this same
  // headed browser. Playwright only observes the resulting canonical state.
  const sendState = page.getByTestId("canonical-whatsapp-outbound-state");
  await expect(sendState).toHaveAttribute("data-status", "accepted", {
    timeout: recoveryMode ? 0 : 10 * 60 * 1_000,
  });
  await page.evaluate(() => {
    const scopedWindow = window as Window & {
      __evoV2ReviewedTextBlocker?: EventListener;
    };
    const blocker = scopedWindow.__evoV2ReviewedTextBlocker;
    if (blocker) document.removeEventListener("submit", blocker, true);
    delete scopedWindow.__evoV2ReviewedTextBlocker;
  });
  await expect(
    page.getByTestId("canonical-staff-whatsapp-thread"),
  ).toContainText(reviewedText);
  const initialWaha = await readWahaDatabaseProof(
    databaseUrl,
    seed.conversationId,
  );
  ensure(
    initialWaha.status === "accepted" &&
      initialWaha.sessionName === sessionName &&
      initialWaha.recipientChatId === selfId &&
      initialWaha.finalText === reviewedText &&
      initialWaha.messageBody === reviewedText &&
      initialWaha.actorRole === "admin" &&
      initialWaha.sourceProposalId === reviewedProposal.proposalId &&
      initialWaha.providerMessageId.length > 0 &&
      initialWaha.messageExternalId === initialWaha.providerMessageId &&
      initialWaha.attemptCount === 1 &&
      initialWaha.outboundCount === 1,
    "PostgreSQL did not retain the exact human-confirmed WAHA result",
  );
  ensure(
    initialWaha.ack >= 0 &&
      initialWaha.ack <= 4 &&
      initialWaha.ackName === ACK_NAMES[initialWaha.ack as 0 | 1 | 2 | 3 | 4],
    "PostgreSQL retained an invalid WAHA ACK",
  );
  const wahaReadback = await readWahaProviderMessage(
    initialWaha.providerMessageId,
    reviewedText,
    selfId,
    selfRecipientIds,
  );
  ensure(
    wahaReadback.id === initialWaha.providerMessageId &&
      wahaReadback.ack >= initialWaha.ack,
    "The exact WAHA provider readback regressed from PostgreSQL",
  );
  await page.getByTestId("canonical-whatsapp-outbound-reconcile").click();
  await expect(
    page.getByTestId("canonical-whatsapp-reconcile-state"),
  ).toHaveAttribute("data-status", "reconciled", { timeout: 20_000 });
  const reconciledWaha = await readWahaDatabaseProof(
    databaseUrl,
    seed.conversationId,
  );
  ensure(
    reconciledWaha.providerMessageId === initialWaha.providerMessageId &&
      reconciledWaha.ack >= wahaReadback.ack &&
      reconciledWaha.ackName ===
        ACK_NAMES[reconciledWaha.ack as 0 | 1 | 2 | 3 | 4] &&
      reconciledWaha.attemptCount === 1 &&
      reconciledWaha.outboundCount === 1,
    "WAHA reconciliation changed identity, duplicated a send, or regressed ACK",
  );

  const beforeAmo = await readMutationCounts(
    databaseUrl,
    leadId,
    seed.conversationId,
  );
  ensure(
    beforeAmo.proposalCount === 1 &&
      beforeAmo.wahaAttemptCount === 1 &&
      beforeAmo.outboundMessageCount === 1 &&
      beforeAmo.amocrmAttemptCount === 0 &&
      beforeAmo.commandReceiptCount === 0 &&
      beforeAmo.contactBindingCount === 0 &&
      beforeAmo.leadBindingCount === 0,
    "The reconciled WAHA checkpoint is not isolated from amoCRM state",
  );
  await durableCreateOrValidateWahaCheckpoint(
    path.join(evidenceDir, "waha-reconciled.json"),
    {
      schemaVersion: 1,
      kind: "evo-v2-10d-waha-reconciled",
      status: "reconciled",
      gitSha,
      recovery: {
        occurred: recoveryMode,
        stage: "post-waha",
        codeSha: recoverySha,
      },
      completedAt: new Date().toISOString(),
      hashes: {
        proposalSha256: sha256(pendingProposal.proposalText),
        reviewedTextSha256: sha256(reviewedText),
        providerMessageIdSha256: sha256(reconciledWaha.providerMessageId),
      },
      review: {
        decision,
        proposalCount: reviewedProposal.proposalCount,
      },
      waha: {
        status: reconciledWaha.status,
        attemptCount: reconciledWaha.attemptCount,
        outboundMessageCount: reconciledWaha.outboundCount,
        databaseAck: initialWaha.ack,
        readbackAck: wahaReadback.ack,
        exactReadback: true,
      },
      amocrm: {
        attemptCount: beforeAmo.amocrmAttemptCount,
        receiptCount: beforeAmo.commandReceiptCount,
        bindingCount:
          beforeAmo.contactBindingCount + beforeAmo.leadBindingCount,
      },
      nextAuthorizedStep: "admin_amocrm_sync_only",
      boundaries: {
        providerReadMethod: "GET",
        whatsappActionRepeated: false,
        v1ApplicationPathExecuted: false,
        deploymentMutated: false,
        fallbackObserved: false,
      },
    },
  );

  const { amoDatabase, amoProvider, beforeReplay, afterReplay } =
    await runAmoCrmSyncReplayAndReload(page, {
      databaseUrl,
      leadId,
      conversationId: seed.conversationId,
      seedCorrelationId,
      discoverySnapshotSha256: discovery.snapshotSha256,
      expectedWahaProviderMessageId: reconciledWaha.providerMessageId,
      runtime,
      context,
    });
  await durableCreateJson(path.join(evidenceDir, "success.json"), {
    schemaVersion: 1,
    kind: "evo-v2-10d-real-provider-workflow",
    status: "passed",
    gitSha,
    recovery: {
      occurred: recoveryMode,
      codeSha: recoverySha,
    },
    completedAt: new Date().toISOString(),
    action: "one_human_reviewed_self_send_then_one_admin_amocrm_sync",
    hashes: {
      proposalSha256: sha256(pendingProposal.proposalText),
      reviewedTextSha256: sha256(reviewedText),
      wahaReceiptSha256: sha256(reconciledWaha.providerMessageId),
      amoEntitySetSha256: amoProvider.entitySetSha256,
    },
    review: {
      decision,
      proposalCount: reviewedProposal.proposalCount,
      humanActionObserved: true,
    },
    waha: {
      attemptCount: reconciledWaha.attemptCount,
      outboundMessageCount: reconciledWaha.outboundCount,
      exactReadback: true,
      initialAck: initialWaha.ack,
      readbackAck: wahaReadback.ack,
      reconciledAck: reconciledWaha.ack,
    },
    amocrm: {
      attemptCount: amoDatabase.attemptCount,
      receiptCount: amoDatabase.receiptCount,
      contactBindingCount: amoDatabase.contactBindingCount,
      leadBindingCount: amoDatabase.leadBindingCount,
      validationContactCount: amoProvider.validationContactCount,
      validationLeadCount: amoProvider.validationLeadCount,
      validationNoteCount: amoProvider.validationNoteCount,
      exactReadback: amoProvider.exactReadback,
    },
    replay: {
      messageDelta: afterReplay.messageCount - beforeReplay.messageCount,
      providerAttemptDelta:
        afterReplay.amocrmAttemptCount - beforeReplay.amocrmAttemptCount,
      receiptDelta:
        afterReplay.commandReceiptCount - beforeReplay.commandReceiptCount,
      bindingDelta:
        afterReplay.contactBindingCount +
        afterReplay.leadBindingCount -
        beforeReplay.contactBindingCount -
        beforeReplay.leadBindingCount,
      businessEventDelta:
        afterReplay.businessEventCount - beforeReplay.businessEventCount,
      providerEntitySetUnchanged: true,
    },
    boundaries: {
      database: "disposable_local_postgresql",
      target: "connected_waha_session_self_validation_entity",
      v1ApplicationPathExecuted: false,
      deploymentMutated: false,
      fallbackObserved: false,
    },
  });
});

test("post-WAHA recovery proves the accepted send before one amoCRM sync", async ({
  page,
}) => {
  const mode = requiredMode();
  test.skip(mode !== "post-waha", "post-WAHA recovery runs separately");
  test.setTimeout(0);

  const { gitSha, recoverySha, evidenceDir, runtimeFile, contextFile } =
    acceptanceInputs();
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await chmod(evidenceDir, 0o700);

  const blockedMarker = await privateJson(
    path.join(evidenceDir, "authority-blocked.json"),
    "V2-10D disabled-authority marker",
  );
  ensure(
    blockedMarker.status === "passed" &&
      blockedMarker.gitSha === gitSha &&
      blockedMarker.proofMode === "all-provider-authority-disabled",
    "The exact original-SHA disabled-authority proof is missing",
  );

  const runtime = await privateJson(
    runtimeFile,
    "Private V2-10D provider runtime",
  );
  const context = await privateJson(
    contextFile,
    "Private V2-10D validation context",
  );
  const leadId = context.leadId;
  const seedCorrelationId = context.seedCorrelationId;
  const expectedPhoneSha256 = context.selfPhoneSha256;
  const discovery = record(
    context.discovery,
    "Private amoCRM discovery context is missing",
  );
  ensure(
    typeof leadId === "string" && UUID.test(leadId),
    "Validation lead is invalid",
  );
  ensure(
    typeof seedCorrelationId === "string" && UUID.test(seedCorrelationId),
    "Validation seed correlation is invalid",
  );
  ensure(
    typeof expectedPhoneSha256 === "string" && SHA256.test(expectedPhoneSha256),
    "Validation phone digest is invalid",
  );
  ensure(
    typeof discovery.snapshotSha256 === "string" &&
      SHA256.test(discovery.snapshotSha256),
    "amoCRM discovery snapshot digest is invalid",
  );

  const { selfId, selfRecipientIds } = connectedSelfIdentities();
  const phoneE164 = `+${selfId.slice(0, selfId.indexOf("@"))}`;
  ensure(
    sha256(phoneE164) === expectedPhoneSha256,
    "Connected WAHA self identity does not match the preserved lead",
  );
  const databaseUrl = requireEnv("DATABASE_URL");
  const sessionName = requireEnv("EVO_V2_CONNECTED_WAHA_SESSION_NAME");
  const seed = await readExistingSelfConversation(databaseUrl, {
    leadId,
    selfId,
  });
  const reviewedProposal = await readProposalProof(
    databaseUrl,
    seed.conversationId,
  );
  ensure(
    reviewedProposal.provider === "gemini" &&
      reviewedProposal.model.length > 0 &&
      reviewedProposal.proposalText.length > 0 &&
      (reviewedProposal.reviewDecision === "accepted" ||
        reviewedProposal.reviewDecision === "edited") &&
      typeof reviewedProposal.reviewedText === "string" &&
      reviewedProposal.reviewedText.trim().length > 0 &&
      reviewedProposal.reviewedByRole === "admin" &&
      reviewedProposal.reviewedAt instanceof Date &&
      reviewedProposal.proposalCount === 1,
    "Post-WAHA recovery requires one accepted or edited human review",
  );
  const reviewedText = reviewedProposal.reviewedText;

  const reviewRequiredMarker = await privateJson(
    path.join(evidenceDir, "review-required.json"),
    "V2-10D preserved human-review marker",
  );
  const reviewRequiredProposal = record(
    reviewRequiredMarker.proposal,
    "V2-10D preserved human-review proposal is invalid",
  );
  const reviewRequiredProviderMutation = record(
    reviewRequiredMarker.providerMutation,
    "V2-10D preserved human-review provider counts are invalid",
  );
  ensure(
    reviewRequiredMarker.status === "review_required" &&
      reviewRequiredMarker.gitSha === gitSha &&
      reviewRequiredProposal.proposalIdSha256 ===
        sha256(reviewedProposal.proposalId) &&
      reviewRequiredProposal.draftSha256 ===
        sha256(reviewedProposal.proposalText) &&
      reviewRequiredProposal.modelSha256 === sha256(reviewedProposal.model) &&
      reviewRequiredProposal.proposalCount === reviewedProposal.proposalCount &&
      reviewRequiredProposal.reviewDecision === "pending" &&
      reviewRequiredProviderMutation.wahaSendAttemptCount === 0 &&
      reviewRequiredProviderMutation.wahaOutboundMessageCount === 0 &&
      reviewRequiredProviderMutation.amocrmProviderAttemptCount === 0 &&
      reviewRequiredProviderMutation.amocrmBindingCount === 0,
    "The preserved review-required marker does not match the reviewed proposal",
  );

  const beforeReadback = await readMutationCounts(
    databaseUrl,
    leadId,
    seed.conversationId,
  );
  ensure(
    beforeReadback.proposalCount === 1 &&
      beforeReadback.wahaAttemptCount === 1 &&
      beforeReadback.outboundMessageCount === 1 &&
      beforeReadback.amocrmAttemptCount === 0 &&
      beforeReadback.commandReceiptCount === 0 &&
      beforeReadback.contactBindingCount === 0 &&
      beforeReadback.leadBindingCount === 0,
    "Post-WAHA recovery did not begin from one accepted send and zero amoCRM state",
  );

  const dispatchMarker = await privateJson(
    path.join(evidenceDir, "dispatch-attempt.json"),
    "V2-10D preserved dispatch marker",
  );
  const dispatchReview = record(
    dispatchMarker.review,
    "V2-10D preserved dispatch review is invalid",
  );
  const dispatchWhatsapp = record(
    dispatchMarker.whatsapp,
    "V2-10D preserved dispatch counts are invalid",
  );
  ensure(
    dispatchMarker.status === "dispatch_intent_recorded" &&
      dispatchMarker.gitSha === gitSha &&
      dispatchReview.decision === reviewedProposal.reviewDecision &&
      dispatchReview.proposalIdSha256 === sha256(reviewedProposal.proposalId) &&
      dispatchReview.reviewedTextSha256 === sha256(reviewedText) &&
      dispatchWhatsapp.targetClass === "connected_provider_session_self" &&
      dispatchWhatsapp.sendAttemptCountBeforeHumanAction === 0,
    "The preserved dispatch marker does not match the accepted review",
  );

  const acceptedWaha = await readWahaDatabaseProof(
    databaseUrl,
    seed.conversationId,
  );
  ensure(
    acceptedWaha.status === "accepted" &&
      acceptedWaha.sessionName === sessionName &&
      acceptedWaha.recipientChatId === selfId &&
      acceptedWaha.finalText === reviewedText &&
      acceptedWaha.messageBody === reviewedText &&
      acceptedWaha.actorRole === "admin" &&
      acceptedWaha.sourceProposalId === reviewedProposal.proposalId &&
      acceptedWaha.providerMessageId.length > 0 &&
      acceptedWaha.messageExternalId === acceptedWaha.providerMessageId &&
      acceptedWaha.attemptCount === 1 &&
      acceptedWaha.outboundCount === 1 &&
      acceptedWaha.ack >= 0 &&
      acceptedWaha.ack <= 4 &&
      acceptedWaha.ackName === ACK_NAMES[acceptedWaha.ack as 0 | 1 | 2 | 3 | 4],
    "PostgreSQL does not contain one exact accepted WAHA result",
  );
  const wahaReadback = await readWahaProviderMessage(
    acceptedWaha.providerMessageId,
    reviewedText,
    selfId,
    selfRecipientIds,
  );
  ensure(
    wahaReadback.id === acceptedWaha.providerMessageId &&
      wahaReadback.ack >= acceptedWaha.ack,
    "Exact GET-only WAHA readback regressed from PostgreSQL",
  );
  const afterReadback = await readMutationCounts(
    databaseUrl,
    leadId,
    seed.conversationId,
  );
  ensure(
    sameMutationCounts(beforeReadback, afterReadback),
    "GET-only WAHA readback changed PostgreSQL or amoCRM state",
  );

  const wahaCheckpoint = {
    schemaVersion: 1,
    kind: "evo-v2-10d-waha-reconciled",
    status: "reconciled",
    gitSha,
    recovery: {
      occurred: true,
      stage: "post-waha",
      codeSha: recoverySha,
    },
    completedAt: new Date().toISOString(),
    hashes: {
      proposalSha256: sha256(reviewedProposal.proposalText),
      reviewedTextSha256: sha256(reviewedText),
      providerMessageIdSha256: sha256(acceptedWaha.providerMessageId),
    },
    review: {
      decision: reviewedProposal.reviewDecision,
      proposalCount: reviewedProposal.proposalCount,
    },
    waha: {
      status: acceptedWaha.status,
      attemptCount: acceptedWaha.attemptCount,
      outboundMessageCount: acceptedWaha.outboundCount,
      databaseAck: acceptedWaha.ack,
      readbackAck: wahaReadback.ack,
      exactReadback: true,
    },
    amocrm: {
      attemptCount: beforeReadback.amocrmAttemptCount,
      receiptCount: beforeReadback.commandReceiptCount,
      bindingCount:
        beforeReadback.contactBindingCount + beforeReadback.leadBindingCount,
    },
    nextAuthorizedStep: "admin_amocrm_sync_only",
    boundaries: {
      providerReadMethod: "GET",
      whatsappActionRepeated: false,
      geminiActionRepeated: false,
      humanReviewRepeated: false,
      v1ApplicationPathExecuted: false,
      deploymentMutated: false,
      fallbackObserved: false,
    },
  } as const;
  await durableCreateOrValidateWahaCheckpoint(
    path.join(evidenceDir, "waha-reconciled.json"),
    wahaCheckpoint,
  );

  await submitAdminGate(page);
  const { amoDatabase, amoProvider, beforeReplay, afterReplay } =
    await runAmoCrmSyncReplayAndReload(page, {
      databaseUrl,
      leadId,
      conversationId: seed.conversationId,
      seedCorrelationId,
      discoverySnapshotSha256: discovery.snapshotSha256,
      expectedWahaProviderMessageId: acceptedWaha.providerMessageId,
      runtime,
      context,
    });

  await durableCreateJson(path.join(evidenceDir, "success.json"), {
    schemaVersion: 1,
    kind: "evo-v2-10d-real-provider-workflow",
    status: "passed",
    gitSha,
    recovery: {
      occurred: true,
      stage: "post-waha",
      codeSha: recoverySha,
    },
    completedAt: new Date().toISOString(),
    action: "one_human_reviewed_self_send_then_one_admin_amocrm_sync",
    hashes: {
      proposalSha256: sha256(reviewedProposal.proposalText),
      reviewedTextSha256: sha256(reviewedText),
      wahaReceiptSha256: sha256(acceptedWaha.providerMessageId),
      amoEntitySetSha256: amoProvider.entitySetSha256,
    },
    review: {
      decision: reviewedProposal.reviewDecision,
      proposalCount: reviewedProposal.proposalCount,
      humanActionObserved: true,
    },
    waha: {
      attemptCount: acceptedWaha.attemptCount,
      outboundMessageCount: acceptedWaha.outboundCount,
      exactReadback: true,
      initialAck: acceptedWaha.ack,
      readbackAck: wahaReadback.ack,
      reconciledAck: acceptedWaha.ack,
    },
    amocrm: {
      attemptCount: amoDatabase.attemptCount,
      receiptCount: amoDatabase.receiptCount,
      contactBindingCount: amoDatabase.contactBindingCount,
      leadBindingCount: amoDatabase.leadBindingCount,
      validationContactCount: amoProvider.validationContactCount,
      validationLeadCount: amoProvider.validationLeadCount,
      validationNoteCount: amoProvider.validationNoteCount,
      exactReadback: amoProvider.exactReadback,
    },
    replay: {
      messageDelta: afterReplay.messageCount - beforeReplay.messageCount,
      providerAttemptDelta:
        afterReplay.amocrmAttemptCount - beforeReplay.amocrmAttemptCount,
      receiptDelta:
        afterReplay.commandReceiptCount - beforeReplay.commandReceiptCount,
      bindingDelta:
        afterReplay.contactBindingCount +
        afterReplay.leadBindingCount -
        beforeReplay.contactBindingCount -
        beforeReplay.leadBindingCount,
      businessEventDelta:
        afterReplay.businessEventCount - beforeReplay.businessEventCount,
      providerEntitySetUnchanged: true,
    },
    boundaries: {
      database: "disposable_local_postgresql",
      target: "connected_waha_session_self_validation_entity",
      whatsappActionRepeated: false,
      geminiActionRepeated: false,
      humanReviewRepeated: false,
      v1ApplicationPathExecuted: false,
      deploymentMutated: false,
      fallbackObserved: false,
    },
  });
});
