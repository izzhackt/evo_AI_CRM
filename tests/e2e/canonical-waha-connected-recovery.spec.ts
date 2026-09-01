import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, open } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const FINAL_TEXT = "EVO V2 technical verification — no response needed.";
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
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
  process.env.EVO_V2_REAL_WAHA_RECOVERY !== "1",
  "requires the explicit connected-provider recovery harness",
);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required recovery input: ${name}`);
  return value;
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalAck(value: unknown): 0 | 1 | 2 | 3 | 4 {
  ensure(
    value === 0 || value === 1 || value === 2 || value === 3 || value === 4,
    "Recovery did not store a non-error provider ACK",
  );
  return value;
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

async function submitSalesGate(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page
    .locator("#staff-email")
    .fill(requireEnv("EVO_STAFF_AUTH_SALES_EMAIL"));
  await page
    .locator("#staff-password")
    .fill(requireEnv("EVO_STAFF_AUTH_SALES_PASSWORD"));
  await page.getByRole("button", { name: "Войти в CRM" }).click();
  await expect(page.getByTestId("staff-entry-workspace")).toBeVisible();
  await page.getByTestId("open-role-workspace").click();
}

type UnknownAttemptProof = Readonly<{
  attemptId: string;
  conversationId: string;
  status: string;
  actorRole: string;
  provider: string;
  finalText: string;
  failureCode: string | null;
  messageId: string | null;
  providerMessageId: string | null;
  providerOccurredAt: Date | null;
  providerSource: string | null;
  ack: number | null;
  ackName: string | null;
  createdAt: Date;
  settledAt: Date;
  attemptCount: number;
  matchingTextCount: number;
  outboundCount: number;
}>;

type RecoveredAttemptProof = Readonly<{
  attemptId: string;
  conversationId: string;
  status: string;
  actorRole: string;
  provider: string;
  finalText: string;
  failureCode: string | null;
  messageId: string;
  providerMessageId: string;
  providerOccurredAt: Date;
  providerSource: string;
  ack: 0 | 1 | 2 | 3 | 4;
  ackName: (typeof ACK_NAMES)[keyof typeof ACK_NAMES];
  lastReconciledAt: Date;
  messageExternalId: string;
  messageBody: string;
  attemptCount: number;
  matchingTextCount: number;
  outboundCount: number;
}>;

async function readUniqueUnknownAttempt(): Promise<UnknownAttemptProof> {
  const sql = postgres(requireEnv("DATABASE_URL"), {
    idle_timeout: 5,
    max: 1,
    onnotice: () => undefined,
  });
  try {
    const rows = await sql`
      select
        attempt.id as attempt_id,
        attempt.conversation_id,
        attempt.status,
        attempt.actor_role,
        attempt.provider,
        attempt.final_text,
        attempt.failure_code,
        attempt.message_id,
        attempt.provider_message_id,
        attempt.provider_occurred_at,
        attempt.provider_source,
        attempt.ack,
        attempt.ack_name,
        attempt.created_at,
        attempt.settled_at,
        (
          select count(*)::int
          from evo_whatsapp_send_attempts as counted_attempt
          where counted_attempt.conversation_id = attempt.conversation_id
        ) as attempt_count,
        (
          select count(*)::int
          from evo_whatsapp_send_attempts as matching_attempt
          where matching_attempt.final_text = ${FINAL_TEXT}
        ) as matching_text_count,
        (
          select count(*)::int
          from evo_messages as counted_message
          where counted_message.conversation_id = attempt.conversation_id
            and counted_message.direction = 'outbound'
        ) as outbound_count
      from evo_whatsapp_send_attempts as attempt
      where attempt.final_text = ${FINAL_TEXT}
      order by attempt.created_at asc, attempt.id asc
    `;
    ensure(
      rows.length === 1,
      "Recovery requires exactly one preserved attempt with the reviewed text",
    );
    const row = rows[0];
    ensure(row, "The preserved WhatsApp attempt is missing");
    ensure(
      row.created_at instanceof Date && row.settled_at instanceof Date,
      "The preserved attempt is missing immutable dispatch timestamps",
    );
    return Object.freeze({
      attemptId: String(row.attempt_id),
      conversationId: String(row.conversation_id),
      status: String(row.status),
      actorRole: String(row.actor_role),
      provider: String(row.provider),
      finalText: String(row.final_text),
      failureCode:
        typeof row.failure_code === "string" ? row.failure_code : null,
      messageId: typeof row.message_id === "string" ? row.message_id : null,
      providerMessageId:
        typeof row.provider_message_id === "string"
          ? row.provider_message_id
          : null,
      providerOccurredAt:
        row.provider_occurred_at instanceof Date
          ? row.provider_occurred_at
          : null,
      providerSource:
        typeof row.provider_source === "string" ? row.provider_source : null,
      ack: typeof row.ack === "number" ? row.ack : null,
      ackName: typeof row.ack_name === "string" ? row.ack_name : null,
      createdAt: row.created_at,
      settledAt: row.settled_at,
      attemptCount: Number(row.attempt_count),
      matchingTextCount: Number(row.matching_text_count),
      outboundCount: Number(row.outbound_count),
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function readRecoveredAttempt(
  attemptId: string,
): Promise<RecoveredAttemptProof> {
  const sql = postgres(requireEnv("DATABASE_URL"), {
    idle_timeout: 5,
    max: 1,
    onnotice: () => undefined,
  });
  try {
    const rows = await sql`
      select
        attempt.id as attempt_id,
        attempt.conversation_id,
        attempt.status,
        attempt.actor_role,
        attempt.provider,
        attempt.final_text,
        attempt.failure_code,
        attempt.message_id,
        attempt.provider_message_id,
        attempt.provider_occurred_at,
        attempt.provider_source,
        attempt.ack,
        attempt.ack_name,
        attempt.last_reconciled_at,
        message.external_message_id as message_external_id,
        message.body as message_body,
        (
          select count(*)::int
          from evo_whatsapp_send_attempts as counted_attempt
          where counted_attempt.conversation_id = attempt.conversation_id
        ) as attempt_count,
        (
          select count(*)::int
          from evo_whatsapp_send_attempts as matching_attempt
          where matching_attempt.final_text = ${FINAL_TEXT}
        ) as matching_text_count,
        (
          select count(*)::int
          from evo_messages as counted_message
          where counted_message.conversation_id = attempt.conversation_id
            and counted_message.direction = 'outbound'
        ) as outbound_count
      from evo_whatsapp_send_attempts as attempt
      inner join evo_messages as message on message.id = attempt.message_id
      where attempt.id = ${attemptId}
    `;
    ensure(
      rows.length === 1,
      "Recovery did not settle the same preserved attempt and one message",
    );
    const row = rows[0];
    ensure(row, "The recovered WhatsApp attempt is missing");
    ensure(
      row.provider_occurred_at instanceof Date &&
        row.last_reconciled_at instanceof Date,
      "Recovery did not retain provider and reconciliation timestamps",
    );
    const ack = canonicalAck(row.ack);
    ensure(
      row.ack_name === ACK_NAMES[ack],
      "Recovered ACK name did not match its exact numeric value",
    );
    return Object.freeze({
      attemptId: String(row.attempt_id),
      conversationId: String(row.conversation_id),
      status: String(row.status),
      actorRole: String(row.actor_role),
      provider: String(row.provider),
      finalText: String(row.final_text),
      failureCode:
        typeof row.failure_code === "string" ? row.failure_code : null,
      messageId: String(row.message_id),
      providerMessageId: String(row.provider_message_id),
      providerOccurredAt: row.provider_occurred_at,
      providerSource: String(row.provider_source),
      ack,
      ackName: ACK_NAMES[ack],
      lastReconciledAt: row.last_reconciled_at,
      messageExternalId: String(row.message_external_id),
      messageBody: String(row.message_body),
      attemptCount: Number(row.attempt_count),
      matchingTextCount: Number(row.matching_text_count),
      outboundCount: Number(row.outbound_count),
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test("recovers the one preserved unknown WAHA result without another send", async ({
  page,
}) => {
  test.setTimeout(90_000);
  ensure(
    process.env.EVO_V2_REAL_WAHA_RECOVERY === "1",
    "Connected-provider recovery requires the explicit harness flag",
  );
  const finalizationOnly =
    process.env.EVO_V2_WAHA_RECOVERY_FINALIZE === "1";
  const dispatchSha = requireEnv("EVO_V2_WAHA_DISPATCH_SHA");
  const currentMainSha = requireEnv("EVO_V2_RECOVERY_MAIN_SHA");
  const recoverySha = finalizationOnly
    ? requireEnv("EVO_V2_RECOVERY_OCCURRED_MAIN_SHA")
    : currentMainSha;
  ensure(
    SHA40.test(dispatchSha) &&
      SHA40.test(currentMainSha) &&
      SHA40.test(recoverySha) &&
      (!finalizationOnly || recoverySha !== currentMainSha),
    "Recovery requires exact and distinct dispatch, recovery, and finalization SHAs",
  );
  const dispatchRecordedAt = requireEnv(
    "EVO_V2_WAHA_DISPATCH_RECORDED_AT",
  );
  const dispatchRecordedAtMs = Date.parse(dispatchRecordedAt);
  ensure(
    Number.isFinite(dispatchRecordedAtMs) &&
      new Date(dispatchRecordedAtMs).toISOString() === dispatchRecordedAt,
    "The original dispatch marker timestamp is invalid",
  );
  const expectedProviderMessageIdSha256 = requireEnv(
    "EVO_V2_EXPECTED_PROVIDER_MESSAGE_ID_SHA256",
  );
  ensure(
    SHA256.test(expectedProviderMessageIdSha256),
    "Expected provider message identity must be a SHA-256 digest",
  );
  const expectedProviderSource = requireEnv(
    "EVO_V2_EXPECTED_PROVIDER_SOURCE",
  );
  ensure(
    expectedProviderSource === "api" || expectedProviderSource === "app",
    "Expected provider source must be exactly api or app",
  );

  const evidenceDir = path.resolve(requireEnv("EVO_V2_WAHA_EVIDENCE_DIR"));
  const expectedEvidenceDir = path.resolve(
    process.cwd(),
    "output",
    "provider-acceptance",
    "waha",
    dispatchSha,
  );
  ensure(
    evidenceDir === expectedEvidenceDir,
    "Recovery evidence path escaped the original dispatch-SHA root",
  );
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await chmod(evidenceDir, 0o700);

  const before = await readUniqueUnknownAttempt();
  ensure(
    before.actorRole === "sales" && before.provider === "waha",
    "The preserved attempt is not the authorized Sales WAHA action",
  );
  ensure(
    before.finalText === FINAL_TEXT,
    "The preserved attempt text differs from the reviewed final text",
  );
  ensure(
    before.createdAt.getTime() >= dispatchRecordedAtMs &&
      before.createdAt.getTime() <= dispatchRecordedAtMs + 60_000 &&
      before.settledAt.getTime() >= before.createdAt.getTime() &&
      before.settledAt.getTime() <= dispatchRecordedAtMs + 120_000,
    "The preserved attempt is outside the original dispatch marker window",
  );
  if (finalizationOnly) {
    ensure(
      before.status === "accepted" && before.failureCode === null,
      "Finalization requires the already recovered accepted attempt",
    );
    ensure(
      before.attemptCount === 1 &&
        before.matchingTextCount === 1 &&
        before.outboundCount === 1,
      "Finalization requires exactly one attempt and one outbound message",
    );
  } else {
    ensure(before.status === "unknown", "The preserved attempt is not unknown");
    ensure(
      before.failureCode === "provider_malformed_response",
      "The preserved attempt does not have the expected ambiguity reason",
    );
    ensure(
      before.messageId === null &&
        before.providerMessageId === null &&
        before.providerOccurredAt === null &&
        before.providerSource === null &&
        before.ack === null &&
        before.ackName === null,
      "The unknown attempt already contains accepted provider/message fields",
    );
    ensure(
      before.attemptCount === 1 &&
        before.matchingTextCount === 1 &&
        before.outboundCount === 0,
      "The preserved database does not contain exactly one attempt and zero outbound messages",
    );
  }

  await submitSalesGate(page);
  await page.goto(`/whatsapp/${before.conversationId}`);
  await expect(
    page.getByTestId("canonical-staff-whatsapp-thread"),
  ).toBeVisible();
  const recovery = page.getByTestId(
    "canonical-whatsapp-outbound-reconcile",
  );
  if (finalizationOnly) {
    await expect(
      page.getByTestId("canonical-whatsapp-provider-availability"),
    ).toHaveAttribute("data-status", "blocked");
    await expect(
      page.getByTestId("canonical-whatsapp-latest-attempt"),
    ).toContainText(/accepted/i);
    await expect(
      page.getByTestId("canonical-whatsapp-outbound-send"),
    ).toBeDisabled();
    await expect(recovery).toBeVisible();
    await expect(recovery).toBeDisabled();
  } else {
    await expect(
      page.getByTestId("canonical-whatsapp-provider-availability"),
    ).toHaveAttribute("data-status", "configured");
    await expect(
      page.getByTestId("canonical-whatsapp-latest-attempt"),
    ).toContainText(/unknown/i);
    await expect(
      page.getByTestId("canonical-whatsapp-outbound-unresolved"),
    ).toBeVisible();
    await expect(
      page.getByTestId("canonical-whatsapp-outbound-send"),
    ).toBeDisabled();
    await expect(recovery).toBeVisible();
    await expect(recovery).toBeEnabled();
    await recovery.click();
    await expect(
      page.getByTestId("canonical-whatsapp-reconcile-state"),
    ).toHaveAttribute("data-status", "reconciled", { timeout: 30_000 });
  }
  await expect(
    page.getByTestId("canonical-staff-whatsapp-thread"),
  ).toContainText(FINAL_TEXT);

  const after = await readRecoveredAttempt(before.attemptId);
  ensure(
    after.attemptId === before.attemptId &&
      after.conversationId === before.conversationId,
    "Recovery changed the preserved attempt or conversation identity",
  );
  ensure(
    after.status === "accepted" && after.failureCode === null,
    "Recovery did not promote the same attempt to accepted and clear failure",
  );
  ensure(
    after.actorRole === "sales" &&
      after.provider === "waha" &&
      after.providerSource === expectedProviderSource,
    "Recovery changed the authorized actor/provider lineage",
  );
  ensure(
    after.finalText === FINAL_TEXT && after.messageBody === FINAL_TEXT,
    "Recovery changed the reviewed text",
  );
  ensure(
    after.providerMessageId.length > 0 &&
      after.messageId.length > 0 &&
      after.messageExternalId === after.providerMessageId,
    "Recovery did not bind the exact provider message to one EVO message",
  );
  ensure(
    sha256(after.providerMessageId) === expectedProviderMessageIdSha256,
    "Recovered provider message identity did not match the expected digest",
  );
  ensure(
    after.attemptCount === 1 &&
      after.matchingTextCount === 1 &&
      after.outboundCount === 1,
    "Recovery created an extra attempt or more than one outbound message",
  );

  await durableCreateJson(path.join(evidenceDir, "recovered-success.json"), {
    schemaVersion: finalizationOnly ? 2 : 1,
    kind: "evo-v2-connected-waha-unknown-recovery",
    status: "passed",
    dispatchSha,
    reconciliationSha: recoverySha,
    ...(finalizationOnly ? { finalizationSha: currentMainSha } : {}),
    completedAt: new Date().toISOString(),
    action: finalizationOnly
      ? "resume_after_accepted_recovery_without_provider_calls"
      : "one_explicit_browser_recovery_without_resend",
    finalTextSha256: sha256(FINAL_TEXT),
    providerMessageIdSha256: sha256(after.providerMessageId),
    provider: {
      lookup: finalizationOnly
        ? "validated_preserved_get_only_unique_match"
        : "bounded_get_only_unique_match",
      source: after.providerSource,
      ack: after.ack,
      ackName: after.ackName,
    },
    database: {
      sameAttemptRecovered: true,
      failureCleared: true,
      dispatchCorrelation: "exact_text_and_marker_time_window",
      attemptCount: after.attemptCount,
      outboundMessageCount: after.outboundCount,
    },
    browser: {
      role: "sales",
      sendButtonClicked: false,
      recoveryButtonClicked: !finalizationOnly,
      finalizationReadOnly: finalizationOnly,
    },
    boundaries: {
      database: "preserved_disposable_local_postgresql",
      providerTransport: "harness_enforced_get_only_proxy",
      finalizationProviderTransport: finalizationOnly
        ? "disabled_no_provider_configuration"
        : null,
      productionDatabaseMutated: false,
      deploymentMutated: false,
    },
  });

  assert.equal(after.attemptId, before.attemptId);
  assert.equal(after.outboundCount, 1);
});
