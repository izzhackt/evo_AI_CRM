import { createHmac } from "node:crypto";
import {
  chmod,
  readFile,
  writeFile,
} from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIRECT_CHAT_PATTERN = /^[1-9][0-9]{6,14}@c\.us$/u;
const SAFE_IDENTIFIER_PATTERN = /^[ -~]{1,512}$/u;
const SYNTHETIC_INBOUND_SEED =
  "EVO Platform technical acceptance: prepare a concise confirmation reply.";

function requiredText(name: string): string {
  const value = process.env[name];
  if (!value || value !== value.trim()) throw new Error(`${name} is required`);
  return value;
}

function requiredUuid(name: string): string {
  const value = requiredText(name);
  if (!UUID_PATTERN.test(value)) throw new Error(`${name} must be a UUID`);
  return value.toLowerCase();
}

function requiredLoopbackOrigin(name: string): string {
  const value = requiredText(name);
  const parsed = new URL(value);
  if (
    parsed.protocol !== "http:" ||
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${name} must be a credential-free loopback HTTP origin`);
  }
  return parsed.origin;
}

function requiredDatabaseUrl(): string {
  const value = requiredText("SUPABASE_DB_URL");
  const parsed = new URL(value);
  if (
    parsed.protocol !== "postgresql:" ||
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
    !parsed.username ||
    !parsed.password
  ) {
    throw new Error("SUPABASE_DB_URL must address the private local Supabase database");
  }
  return value;
}

type ProviderSourceMessage = Readonly<{
  id: string;
  timestamp: number;
}>;

async function readProviderSourceMessage(
  path: string,
  expectedId: string,
  expectedChatId: string,
): Promise<ProviderSourceMessage> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("The protected WAHA source-message file is invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The protected WAHA source message has an invalid shape");
  }
  const message = value as Record<string, unknown>;
  const timestamp = Number(message.timestamp);
  if (
    message.id !== expectedId ||
    message.fromMe !== false ||
    message.from !== expectedChatId ||
    !Number.isFinite(timestamp) ||
    timestamp <= 0
  ) {
    throw new Error("The protected WAHA source message is not the authorized reply target");
  }
  return Object.freeze({
    id: expectedId,
    timestamp,
  });
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator("#staff-email").fill(requiredText("EVO_STAFF_AUTH_SALES_EMAIL"));
  await page
    .locator("#staff-password")
    .fill(requiredText("EVO_STAFF_AUTH_SALES_PASSWORD"));
  await page.getByRole("button", { name: "Войти в CRM" }).click();
  await expect(page.getByTestId("staff-entry-workspace")).toBeVisible();
}

async function writePrivateJson(
  path: string,
  value: Readonly<Record<string, unknown>>,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 256 * 1024) {
    throw new Error("The WAHA readback response exceeded its acceptance bound");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The WAHA readback response was not JSON");
  }
}

function asProviderMessage(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

test("one reviewed Gemini proposal produces one exact Supabase-backed WAHA send", async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Platform provider acceptance is not configured");

  const gitSha = requiredText("EVO_PLATFORM_ACCEPTANCE_HEAD_SHA");
  if (!SHA_PATTERN.test(gitSha)) throw new Error("Acceptance HEAD SHA is invalid");
  const organizationId = requiredUuid("EVO_PLATFORM_ORGANIZATION_ID");
  const targetChatId = requiredText("EVO_PLATFORM_ACCEPTANCE_TARGET_CHAT_ID");
  if (!DIRECT_CHAT_PATTERN.test(targetChatId)) {
    throw new Error("The acceptance target must be one direct WhatsApp chat");
  }
  const sourceMessageId = requiredText(
    "EVO_PLATFORM_ACCEPTANCE_SOURCE_MESSAGE_ID",
  );
  if (!SAFE_IDENTIFIER_PATTERN.test(sourceMessageId)) {
    throw new Error("The acceptance source message identifier is invalid");
  }
  const sourceMessage = await readProviderSourceMessage(
    requiredText("EVO_PLATFORM_ACCEPTANCE_SOURCE_FILE"),
    sourceMessageId,
    targetChatId,
  );
  const webhookSecret = requiredText("EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET");
  const databaseUrl = requiredDatabaseUrl();
  const wahaBaseUrl = requiredLoopbackOrigin(
    "EVO_PLATFORM_ACCEPTANCE_WAHA_BASE_URL",
  );
  const wahaApiKey = requiredText("EVO_PLATFORM_ACCEPTANCE_WAHA_API_KEY");
  const wahaSessionName = requiredText(
    "EVO_PLATFORM_ACCEPTANCE_WAHA_SESSION_NAME",
  );
  if (wahaSessionName !== "evo-inbox") {
    throw new Error("The acceptance WAHA session must be evo-inbox");
  }
  const evidenceDir = requiredText("EVO_PLATFORM_ACCEPTANCE_EVIDENCE_DIR");
  const dispatchMarkerPath = `${evidenceDir}/waha-dispatch-attempt.json`;
  const successEvidencePath = `${evidenceDir}/success.json`;

  const rawInboundBody = JSON.stringify({
    id: `platform-provider-acceptance:${gitSha}:${sourceMessage.id}`,
    event: "message.any",
    session: "evo-inbox",
    timestamp: sourceMessage.timestamp,
    payload: {
      id: sourceMessage.id,
      from: targetChatId,
      chatId: targetChatId,
      fromMe: false,
      source: "app",
      body: SYNTHETIC_INBOUND_SEED,
      timestamp: sourceMessage.timestamp,
    },
  });
  const signature = createHmac("sha512", webhookSecret)
    .update(rawInboundBody)
    .digest("hex");
  const ingress = await fetch(`${baseURL}/api/v2/whatsapp/inbound`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-hmac": signature,
      "x-webhook-hmac-algorithm": "sha512",
    },
    body: rawInboundBody,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const ingressPayload = await readBoundedJson(ingress);
  expect(ingress.status).toBe(200);
  expect(ingressPayload).toMatchObject({
    ok: true,
    status: "projected",
    eventType: "message.any",
  });

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    let conversationId = "";
    let sourceMessageUuid = "";
    await expect
      .poll(
        async () => {
          const rows = await sql<
            { conversation_id: string; source_message_id: string }[]
          >`
            SELECT
              binding.conversation_id::TEXT AS conversation_id,
              message_binding.communication_message_id::TEXT AS source_message_id
            FROM platform_private.waha_direct_chat_bindings AS binding
            JOIN platform_private.waha_message_bindings AS message_binding
              ON message_binding.organization_id = binding.organization_id
             AND message_binding.waha_session_name = binding.waha_session_name
             AND message_binding.raw_message_id = ${sourceMessage.id}
            WHERE binding.organization_id = ${organizationId}
              AND binding.waha_session_name = 'evo-inbox'
              AND binding.normalized_chat_id = ${targetChatId}
            LIMIT 1
          `;
          conversationId = rows[0]?.conversation_id ?? "";
          sourceMessageUuid = rows[0]?.source_message_id ?? "";
          return rows.length;
        },
        { timeout: 30_000, intervals: [100, 250, 500, 1_000] },
      )
      .toBe(1);
    if (!UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(sourceMessageUuid)) {
      throw new Error("The projected provider message did not resolve to one conversation");
    }

    await signIn(page);
    await page.goto(`/whatsapp/${conversationId}`);
    const controls = page.getByTestId("platform-provider-workflow-controls");
    await expect(controls).toBeVisible();

    await controls.getByRole("button", { name: "Подготовить черновик" }).click();
    await expect(
      controls.getByText("Черновик сохранён и ждёт решения сотрудника.", {
        exact: true,
      }),
    ).toBeVisible();

    const draftCard = controls
      .getByRole("heading", { name: "Черновик Gemini" })
      .locator("..");
    const generatedReply = (await draftCard.locator("p").first().innerText()).trim();
    if (!generatedReply || generatedReply.length > 3_000) {
      throw new Error("Gemini did not return one bounded reviewable reply");
    }
    const runMarker = `EVO provider acceptance ${gitSha.slice(0, 12)}`;
    const reviewedText = `${Array.from(generatedReply).slice(0, 2_850).join("")}\n\n[${runMarker}]`;
    const editButton = controls.getByRole("button", {
      name: "Сохранить исправленный текст",
    });
    const editForm = controls.locator("form").filter({ has: editButton });
    await editForm.locator('textarea[name="edited_reply_text"]').fill(reviewedText);
    await editForm
      .locator('input[name="reason"]')
      .fill("Bounded exact-head provider acceptance");
    await editButton.click();
    await expect(
      controls.getByText("Решение сохранено", { exact: true }),
    ).toBeVisible();

    await controls.locator('textarea[name="message_text"]').fill(reviewedText);
    await controls.locator('input[name="confirm_send"]').check();
    await writePrivateJson(dispatchMarkerPath, {
      schemaVersion: 1,
      status: "dispatch_attempted",
      gitSha,
      targetKind: "authorized_minimized_chat",
      maximumDispatches: 1,
      createdAt: new Date().toISOString(),
    });
    await controls.getByTestId("platform-provider-send").click();
    await expect(
      controls.getByText("WhatsApp принял сообщение; результат сохранён.", {
        exact: true,
      }),
    ).toBeVisible();

    const proofRows = await sql<
      {
        geminiRequestCount: number;
        geminiResultCount: number;
        geminiReviewCount: number;
        manualSendAuthorizationCount: number;
        manualSendWorkCount: number;
        manualSendAttemptCount: number;
        outboundMessageCount: number;
        providerBindingCount: number;
      }[]
    >`
      SELECT
        (
          SELECT count(*)::INTEGER
          FROM platform_private.gemini_proposal_request_receipts
          WHERE organization_id = ${organizationId}
            AND conversation_id = ${conversationId}::UUID
            AND source_message_id = ${sourceMessageUuid}::UUID
        ) AS "geminiRequestCount",
        (
          SELECT count(*)::INTEGER
          FROM platform_private.gemini_proposal_results
          WHERE organization_id = ${organizationId}
            AND conversation_id = ${conversationId}::UUID
            AND source_message_id = ${sourceMessageUuid}::UUID
            AND outcome = 'proposal_ready'
            AND private_provider_status = 'completed'
        ) AS "geminiResultCount",
        (
          SELECT count(*)::INTEGER
          FROM platform.gemini_proposal_reviews
          WHERE organization_id = ${organizationId}
            AND conversation_id = ${conversationId}::UUID
            AND source_message_id = ${sourceMessageUuid}::UUID
            AND decision = 'edited'
        ) AS "geminiReviewCount",
        (
          SELECT count(*)::INTEGER
          FROM platform.manual_send_authorizations
          WHERE organization_id = ${organizationId}
            AND conversation_id = ${conversationId}::UUID
            AND source_message_id = ${sourceMessageUuid}::UUID
            AND final_text = ${reviewedText}
        ) AS "manualSendAuthorizationCount",
        (
          SELECT count(*)::INTEGER
          FROM platform_private.durable_work_items AS item
          JOIN platform.manual_send_authorizations AS authorization
            ON authorization.organization_id = item.organization_id
           AND authorization.id = item.manual_send_authorization_id
          WHERE item.organization_id = ${organizationId}
            AND authorization.conversation_id = ${conversationId}::UUID
            AND authorization.source_message_id = ${sourceMessageUuid}::UUID
            AND item.kind = 'manual_whatsapp_send'
            AND item.state = 'succeeded'
            AND item.attempt_count = 1
        ) AS "manualSendWorkCount",
        (
          SELECT count(*)::INTEGER
          FROM platform_private.durable_work_attempts AS attempt
          JOIN platform_private.durable_work_items AS item
            ON item.organization_id = attempt.organization_id
           AND item.id = attempt.work_item_id
          JOIN platform.manual_send_authorizations AS authorization
            ON authorization.organization_id = item.organization_id
           AND authorization.id = item.manual_send_authorization_id
          WHERE attempt.organization_id = ${organizationId}
            AND authorization.conversation_id = ${conversationId}::UUID
            AND authorization.source_message_id = ${sourceMessageUuid}::UUID
            AND attempt.attempt_number = 1
            AND attempt.outcome = 'succeeded'
        ) AS "manualSendAttemptCount",
        (
          SELECT count(*)::INTEGER
          FROM platform.communication_messages
          WHERE organization_id = ${organizationId}
            AND conversation_id = ${conversationId}::UUID
            AND direction = 'outbound'
            AND body_text = ${reviewedText}
        ) AS "outboundMessageCount",
        (
          SELECT count(*)::INTEGER
          FROM platform_private.manual_send_provider_bindings AS binding
          JOIN platform.manual_send_authorizations AS authorization
            ON authorization.organization_id = binding.organization_id
           AND authorization.id = binding.manual_send_authorization_id
          WHERE binding.organization_id = ${organizationId}
            AND authorization.conversation_id = ${conversationId}::UUID
            AND authorization.source_message_id = ${sourceMessageUuid}::UUID
            AND binding.waha_session_name = 'evo-inbox'
        ) AS "providerBindingCount"
    `;
    const proof = proofRows[0];
    expect(proof).toEqual({
      geminiRequestCount: 1,
      geminiResultCount: 1,
      geminiReviewCount: 1,
      manualSendAuthorizationCount: 1,
      manualSendWorkCount: 1,
      manualSendAttemptCount: 1,
      outboundMessageCount: 1,
      providerBindingCount: 1,
    });

    const providerRows = await sql<
      { raw_message_id: string; provider_observed_at: Date }[]
    >`
      SELECT binding.raw_message_id, binding.provider_observed_at
      FROM platform_private.manual_send_provider_bindings AS binding
      JOIN platform.manual_send_authorizations AS authorization
        ON authorization.organization_id = binding.organization_id
       AND authorization.id = binding.manual_send_authorization_id
      WHERE binding.organization_id = ${organizationId}
        AND authorization.conversation_id = ${conversationId}::UUID
        AND authorization.source_message_id = ${sourceMessageUuid}::UUID
      LIMIT 1
    `;
    const providerMessageId = providerRows[0]?.raw_message_id;
    const providerObservedAt = providerRows[0]?.provider_observed_at;
    if (
      !providerMessageId ||
      !SAFE_IDENTIFIER_PATTERN.test(providerMessageId) ||
      !(providerObservedAt instanceof Date)
    ) {
      throw new Error("Supabase did not retain one bounded provider receipt");
    }

    const providerHeaders = {
      Accept: "application/json",
      "X-Api-Key": wahaApiKey,
    };
    const exactUrl = new URL(
      `/api/${encodeURIComponent(wahaSessionName)}/chats/${encodeURIComponent(targetChatId)}/messages/${encodeURIComponent(providerMessageId)}`,
      wahaBaseUrl,
    );
    exactUrl.searchParams.set("downloadMedia", "false");
    const exactResponse = await fetch(exactUrl, {
      headers: providerHeaders,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!exactResponse.ok) throw new Error("Exact WAHA readback failed");
    const exactMessage = asProviderMessage(await readBoundedJson(exactResponse));
    const exactReadback =
      exactMessage?.id === providerMessageId &&
      exactMessage.fromMe === true &&
      exactMessage.source === "api" &&
      exactMessage.to === targetChatId &&
      exactMessage.body === reviewedText;
    if (!exactReadback) throw new Error("Exact WAHA readback did not match the receipt");

    const windowStart = Math.floor(providerObservedAt.getTime() / 1_000) - 120;
    const windowEnd = Math.floor(Date.now() / 1_000) + 120;
    const historyUrl = new URL(
      `/api/${encodeURIComponent(wahaSessionName)}/chats/${encodeURIComponent(targetChatId)}/messages`,
      wahaBaseUrl,
    );
    historyUrl.searchParams.set("limit", "100");
    historyUrl.searchParams.set("downloadMedia", "false");
    historyUrl.searchParams.set("filter.fromMe", "true");
    historyUrl.searchParams.set("filter.timestamp.gte", String(windowStart));
    historyUrl.searchParams.set("filter.timestamp.lte", String(windowEnd));
    const historyResponse = await fetch(historyUrl, {
      headers: providerHeaders,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!historyResponse.ok) throw new Error("Bounded WAHA history readback failed");
    const history = await readBoundedJson(historyResponse);
    if (!Array.isArray(history)) throw new Error("WAHA history readback was not a list");
    const matchingProviderSendCount = history.filter((candidate) => {
      const message = asProviderMessage(candidate);
      return (
        message?.id === providerMessageId &&
        message.fromMe === true &&
        message.source === "api" &&
        message.to === targetChatId &&
        message.body === reviewedText
      );
    }).length;
    if (matchingProviderSendCount !== 1) {
      throw new Error("WAHA did not expose exactly one matching provider send");
    }

    await page.reload();
    await expect(page.getByText(reviewedText, { exact: true })).toHaveCount(1);

    const successEvidence = Object.freeze({
      schemaVersion: 1,
      status: "passed",
      gitSha,
      authority: "local_supabase_postgres",
      gemini: Object.freeze({
        requestCount: proof.geminiRequestCount,
        resultCount: proof.geminiResultCount,
        humanReviewCount: proof.geminiReviewCount,
        advisoryOnly: true,
      }),
      whatsapp: Object.freeze({
        authorizationCount: proof.manualSendAuthorizationCount,
        workCount: proof.manualSendWorkCount,
        attemptCount: proof.manualSendAttemptCount,
        outboundMessageCount: proof.outboundMessageCount,
        receiptCount: proof.providerBindingCount,
        exactReadback,
        matchingProviderSendCount,
        targetKind: "authorized_minimized_chat",
      }),
      safety: Object.freeze({
        inboundSeed: "synthetic_non_personal_setup",
        autonomousSend: false,
        broadcast: false,
        v1RuntimeUsed: false,
        retryAfterAmbiguousResult: false,
      }),
      completedAt: new Date().toISOString(),
    });
    await writePrivateJson(successEvidencePath, successEvidence);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
