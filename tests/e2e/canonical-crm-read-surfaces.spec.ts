import { createHmac } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const mode = process.env.EVO_EXPECT_CANONICAL_READ_MODE ?? "configured";
const unavailableProbeLeadId = "00000000-0000-4000-8000-000000000429";
const unavailableProbeConversationId =
  "00000000-0000-4000-8000-000000000430";
const inboundPhone = process.env.EVO_V2_INBOUND_TEST_PHONE ?? "+15550004300";
const inboundConversationId =
  process.env.EVO_V2_INBOUND_TEST_CONVERSATION_ID ??
  "v2-browser-conversation-430";
const inboundMessageId =
  process.env.EVO_V2_INBOUND_TEST_MESSAGE_ID ?? "v2-browser-message-430";
const inboundText =
  process.env.EVO_V2_INBOUND_TEST_TEXT ?? "V2 inbound browser proof 430";

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

test("Sales records the real gate and Admissions receives exactly three starter tasks", async ({
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
