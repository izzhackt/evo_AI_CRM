import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

const mode = process.env.EVO_EXPECT_PLATFORM_COMMUNICATIONS_MODE ?? "configured";
const conversationId = requiredUuid("EVO_PLATFORM_COMMUNICATIONS_CONVERSATION_ID");
const chatId = requiredChatId("EVO_PLATFORM_COMMUNICATIONS_CHAT_ID");
const inboundMessageId = requiredText("EVO_PLATFORM_COMMUNICATIONS_MESSAGE_ID");
const inboundText = requiredText("EVO_PLATFORM_COMMUNICATIONS_MESSAGE_TEXT");
const unknownResultText = process.env.EVO_PLATFORM_COMMUNICATIONS_UNKNOWN_TEXT ?? "";
const webhookSecret = requiredText("EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET");
const wahaResultFile = process.env.EVO_PLATFORM_WAHA_RESULT_FILE ?? "";

function requiredText(name: string): string {
  const value = process.env[name];
  if (!value || value !== value.trim()) throw new Error(`${name} is required`);
  return value;
}

function requiredUuid(name: string): string {
  const value = requiredText(name);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} must be a non-nil UUID`);
  }
  return value.toLowerCase();
}

function requiredChatId(name: string): string {
  const value = requiredText(name);
  if (!/^[1-9][0-9]{6,14}@c\.us$/u.test(value)) {
    throw new Error(`${name} must be a direct WhatsApp chat id`);
  }
  return value;
}

function staffCredentials(role: "sales") {
  return {
    email: requiredText(`EVO_STAFF_AUTH_${role.toUpperCase()}_EMAIL`),
    password: requiredText(`EVO_STAFF_AUTH_${role.toUpperCase()}_PASSWORD`),
  };
}

async function signIn(page: Page) {
  const credentials = staffCredentials("sales");
  await page.goto("/login");
  await page.locator("#staff-email").fill(credentials.email);
  await page.locator("#staff-password").fill(credentials.password);
  await page.getByRole("button", { name: "Войти в CRM" }).click();
  await expect(page.getByTestId("staff-entry-workspace")).toBeVisible();
}

function signedInboundBody(
  messageId = inboundMessageId,
  messageText = inboundText,
) {
  return signedWebhookBody({
    id: `platform-browser-${messageId}`,
    event: "message.any",
    session: "evo-inbox",
    timestamp: Date.now(),
    payload: {
      id: messageId,
      from: chatId,
      chatId,
      fromMe: false,
      source: "app",
      body: messageText,
    },
  });
}

function signedSessionStatusBody(eventId: string) {
  return signedWebhookBody({
    id: eventId,
    event: "session.status",
    session: "evo-inbox",
    timestamp: Math.floor(Date.now() / 1000),
    payload: { name: "evo-inbox", status: "WORKING" },
  });
}

function signedWebhookBody(body: object) {
  const rawBody = JSON.stringify(body);
  const signature = createHmac("sha512", webhookSecret)
    .update(rawBody)
    .digest("hex");
  return { rawBody, signature };
}

async function postInbound(
  baseURL: string,
  signedBody = signedInboundBody(),
) {
  const { rawBody, signature } = signedBody;
  const response = await fetch(`${baseURL}/api/v2/whatsapp/inbound`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-hmac": signature,
      "x-webhook-hmac-algorithm": "sha512",
    },
    body: rawBody,
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // The status is authoritative; never echo a provider response in failures.
  }
  return { response, payload };
}

test("signed WAHA ingress projects once and one explicit staff action sends once", async ({
  page,
  baseURL,
}) => {
  test.skip(mode !== "configured", "configured Platform communications proof only");
  if (!baseURL || !wahaResultFile) throw new Error("communications proof is not configured");

  const sessionStatus = await postInbound(
    baseURL,
    signedSessionStatusBody("platform-browser-session-status-send"),
  );
  expect(sessionStatus.response.status).toBe(200);
  expect(sessionStatus.payload).toMatchObject({
    ok: true,
    status: "synchronized",
    eventType: "session.status",
  });

  const signedBody = signedInboundBody();
  const firstIngress = await postInbound(baseURL, signedBody);
  expect(firstIngress.response.status).toBe(200);
  expect(firstIngress.payload).toMatchObject({
    ok: true,
    status: "projected",
    eventType: "message.any",
  });
  const replayIngress = await postInbound(baseURL, signedBody);
  expect(replayIngress.response.status).toBe(200);
  expect(replayIngress.payload).toMatchObject({
    ok: true,
    status: "projected",
    eventType: "message.any",
    deduplicated: true,
  });

  await signIn(page);
  await page.goto(`/whatsapp/${conversationId}`);
  await expect(page.getByTestId("platform-staff-whatsapp-page")).toBeVisible();
  await expect(page.getByTestId("platform-staff-whatsapp-thread")).toBeVisible();
  await expect(
    page.locator(".provider-status--ready:visible", { hasText: "WhatsApp" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "WhatsApp exact Sales-intake proof",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(inboundText, { exact: true })).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText(chatId);
  await expect(page.locator("body")).not.toContainText(inboundMessageId);

  const controls = page.getByTestId("platform-provider-workflow-controls");
  await expect(controls).toBeVisible();
  await controls.getByRole("button", { name: "Подготовить черновик" }).click();
  await expect(
    controls.getByText("Gemini не настроен на сервере.", { exact: true }),
  ).toBeVisible();

  const finalText = "Подтверждённый ответ EVO из Supabase browser proof";
  await controls.locator('textarea[name="message_text"]').fill(finalText);
  await controls.locator('input[name="confirm_send"]').check();
  await controls.getByTestId("platform-provider-send").click();
  await expect(
    controls.getByText(
      "WhatsApp принял сообщение; результат сохранён.",
      { exact: true },
    ),
  ).toBeVisible();

  const providerEvidence = JSON.parse(await readFile(wahaResultFile, "utf8"));
  expect(providerEvidence.sendCount).toBe(1);
  expect(providerEvidence.requests).toHaveLength(1);
  expect(providerEvidence.requests[0]).toEqual({
    session: "evo-inbox",
    chatId,
    text: finalText,
    reply_to: inboundMessageId,
  });

  await page.reload();
  await expect(page.getByText(finalText, { exact: true })).toHaveCount(1);
  await expect(page.getByText(/Последняя попытка/)).toBeVisible();
});

test("an ambiguous provider result blocks resend and exact WAHA readback resolves it", async ({
  page,
  baseURL,
}) => {
  test.skip(mode !== "configured", "configured Platform communications proof only");
  if (!baseURL || !wahaResultFile || !unknownResultText) {
    throw new Error("ambiguous-result communications proof is not configured");
  }

  const sessionStatus = await postInbound(
    baseURL,
    signedSessionStatusBody("platform-browser-session-status-unknown"),
  );
  expect(sessionStatus.response.status).toBe(200);
  expect(sessionStatus.payload).toMatchObject({
    ok: true,
    status: "synchronized",
    eventType: "session.status",
  });

  const beforeEvidence = JSON.parse(await readFile(wahaResultFile, "utf8"));
  const beforeSendCount = Number(beforeEvidence.sendCount);
  expect(Number.isSafeInteger(beforeSendCount)).toBe(true);

  const unknownSourceMessageId = `${inboundMessageId}_UNKNOWN`;
  const ingress = await postInbound(
    baseURL,
    signedInboundBody(
      unknownSourceMessageId,
      "Platform Supabase inbound for ambiguous-result reconciliation",
    ),
  );
  expect(ingress.response.status).toBe(200);
  expect(ingress.payload).toMatchObject({
    ok: true,
    status: "projected",
    eventType: "message.any",
  });

  await signIn(page);
  await page.goto(`/whatsapp/${conversationId}`);
  const controls = page.getByTestId("platform-provider-workflow-controls");
  await expect(controls).toBeVisible();
  await controls.locator('textarea[name="message_text"]').fill(unknownResultText);
  await controls.locator('input[name="confirm_send"]').check();
  const sendButton = controls.getByTestId("platform-provider-send");
  await sendButton.click();

  await expect(
    controls.getByText(
      "Результат неизвестен. Повторная отправка заблокирована до сверки с WAHA.",
      { exact: true },
    ).first(),
  ).toBeVisible();
  await expect(sendButton).toBeDisabled();

  const afterUnknownEvidence = JSON.parse(await readFile(wahaResultFile, "utf8"));
  expect(afterUnknownEvidence.sendCount - beforeSendCount).toBe(1);
  expect(
    afterUnknownEvidence.requests.filter(
      (request: { text?: unknown }) => request.text === unknownResultText,
    ),
  ).toHaveLength(1);

  await controls.getByTestId("platform-provider-reconcile").click();
  await expect(
    controls.getByText(
      "Сверка завершена; сохранено подтверждённое состояние.",
      { exact: true },
    ),
  ).toBeVisible();

  const reconciledEvidence = JSON.parse(await readFile(wahaResultFile, "utf8"));
  expect(reconciledEvidence.sendCount - beforeSendCount).toBe(1);
  expect(
    reconciledEvidence.requests.filter(
      (request: { text?: unknown }) => request.text === unknownResultText,
    ),
  ).toHaveLength(1);

  await page.reload();
  await expect(page.getByText(unknownResultText, { exact: true })).toHaveCount(1);
});

test("missing primary webhook secret fails clearly without projection", async ({ baseURL }) => {
  test.skip(mode !== "inbound-unavailable", "missing-primary proof only");
  if (!baseURL) throw new Error("communications proof is not configured");

  const result = await postInbound(baseURL);
  expect(result.response.status).toBe(503);
  expect(result.payload).toEqual({ ok: false, error: "waha_webhook_unavailable" });
});
