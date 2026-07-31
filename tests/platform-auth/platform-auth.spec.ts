import { expect, test, type Page } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

type Identity = Readonly<{ email: string; password: string }>;
type ConversationFixture = Readonly<{
  id: string;
  subject: string;
  messages: readonly string[];
}>;
type Fixture = Readonly<{
  apiUrl: string;
  publishableKey: string;
  identities: Readonly<{
    admin: Identity;
    curator: Identity;
    crossOrgAdmin: Identity;
    salesScoped: Identity;
    finance: Identity;
    student: Identity;
    blocked: Identity;
    noMembership: Identity;
  }>;
  conversations: Readonly<{
    orgA: ConversationFixture;
    orgB: ConversationFixture;
    sameOrgOutsideSalesScope: ConversationFixture;
  }>;
  p3c: Readonly<{
    orgA: Readonly<{
      organizationId: string;
      conversationId: string;
      selectedKnowledgeVersionId: string;
      aiDraftRequestId: string;
      aiDraftId: string;
      manualSendAuthorizationId: string;
      outboxWorkItemId: string;
      outboxKind: string;
      outboxState: string;
      outboxAttemptCount: number;
      outboxMaxAttempts: number;
      latestAuditAction: string;
      aiReadiness: string;
      aiEvidenceKind: string;
      wahaReadiness: string;
      wahaEvidenceKind: string;
      reviewedText: string;
      knowledgeTitle: string;
      knowledgeVersion: string;
      staleSalesAccessToken: string;
    }>;
  }>;
}>;

const fixturePath = process.env.EVO_PLATFORM_AUTH_FIXTURE_PATH;
if (!fixturePath || !path.isAbsolute(fixturePath)) {
  throw new Error("EVO_PLATFORM_AUTH_FIXTURE_PATH must be an absolute path");
}
if ((statSync(fixturePath).mode & 0o777) !== 0o600) {
  throw new Error("Platform Auth fixture must use mode 0600");
}
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;

async function login(page: Page, identity: Identity) {
  await page.goto("/login");
  await page.locator("#login-email").fill(identity.email);
  await page.locator("#login-password").fill(identity.password);
  await page.getByRole("button", { name: "Войти" }).click();
}

function escapePathForRegex(pathname: string) {
  return pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function expectDeniedConversationRoute(page: Page, pathname: string) {
  await page.goto(pathname);
  await expect(page).toHaveURL(new RegExp(`${escapePathForRegex(pathname)}$`));
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "This page could not be found." }),
  ).toBeVisible();
  await expect(page.getByTestId("platform-conversation-thread")).toHaveCount(0);
}

async function workflowRpc(
  token: string,
  conversationId: string,
) {
  const response = await fetch(`${fixture.apiUrl}/rest/v1/rpc/staff_conversation_workflow`, {
    method: "POST",
    headers: {
      apikey: fixture.publishableKey,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Profile": "platform",
      "Content-Profile": "platform",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_organization_id: fixture.p3c.orgA.organizationId,
      p_conversation_id: conversationId,
    }),
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) payload = JSON.parse(text);
  return { status: response.status, payload };
}

async function openOrgAConversation(page: Page, identity: Identity) {
  await login(page, identity);
  await expect(page).toHaveURL(/\/whatsapp$/);
  await page.goto(`/whatsapp/${fixture.p3c.orgA.conversationId}`);
  await expect(page).toHaveURL(
    new RegExp(`/whatsapp/${fixture.p3c.orgA.conversationId}$`),
  );
}

async function assertPersistedP3cWorkflow(page: Page) {
  const thread = page.getByTestId("platform-conversation-thread");
  await expect(thread).toBeVisible();
  await expect(thread).toHaveAttribute("data-provider-proof", "not-proved");

  const workflow = page.getByTestId("platform-messaging-workflow");
  await expect(workflow).toBeVisible();
  await expect(workflow).toHaveAttribute("data-provider-proof", "not-proved");

  const health = page.getByTestId("platform-workflow-health");
  await expect(health).toBeVisible();
  await expect(
    health.locator(
      `[data-integration-readiness="${fixture.p3c.orgA.aiReadiness}"][data-provider-proof="not-proved"]`,
    ),
  ).toHaveCount(2);

  await expect(page.getByTestId("platform-workflow-audit")).toContainText(
    fixture.p3c.orgA.latestAuditAction,
  );
  await expect(
    workflow.getByText(fixture.p3c.orgA.reviewedText, { exact: true }),
  ).toBeVisible();
  await expect(workflow).toContainText(fixture.p3c.orgA.knowledgeTitle);

  const outbox = page.getByTestId("platform-outbox-state");
  await expect(outbox).toBeVisible();
  await expect(
    outbox.locator(
      `[data-outbox-kind="${fixture.p3c.orgA.outboxKind}"][data-outbox-state="${fixture.p3c.orgA.outboxState}"]`,
    ),
  ).toHaveCount(1);

  await expect(page.getByTestId("platform-knowledge-select")).toHaveCount(0);
  await expect(page.getByTestId("platform-request-draft")).toHaveCount(0);
  await expect(page.getByTestId("platform-draft-editor")).toHaveCount(0);
  await expect(page.getByTestId("platform-review-approve")).toHaveCount(0);
  await expect(page.getByTestId("platform-manual-send")).toHaveCount(0);
}

test("self-registration is disabled before any account write", async ({
  page,
}) => {
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Доступ по приглашению" })).toBeVisible();
  await expect(page.locator('input[id^="register-"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Вернуться ко входу" })).toBeVisible();
});

test("wrong password and unprovisioned authorities fail closed", async ({
  page,
}) => {
  await login(page, {
    email: fixture.identities.admin.email,
    password: `${fixture.identities.admin.password}-wrong`,
  });
  await expect(page.locator("#login-error")).toHaveText(
    "Неверная почта или пароль",
  );
  await expect(page).toHaveURL(/\/login$/);

  for (const identity of [
    fixture.identities.blocked,
    fixture.identities.noMembership,
  ]) {
    await login(page, identity);
    await expect(page.locator("#login-error")).toContainText(
      "не назначен активный доступ",
    );
    await expect(page).toHaveURL(/\/login$/);
  }
});

test("route-level auth failures surface an explicit login error", async ({
  page,
}) => {
  await page.goto("/login?error=authority_not_found");
  await expect(page.locator("#login-error")).toContainText(
    "не назначен активный доступ",
  );

  await page.goto("/login?error=platform_unavailable");
  await expect(page.locator("#login-error")).toContainText(
    "не может проверить вход",
  );
});

test("admin opens ordered synthetic inbound messages through Supabase RLS", async ({
  page,
}) => {
  await login(page, fixture.identities.admin);
  await expect(page).toHaveURL(/\/whatsapp$/);

  const list = page.getByTestId("platform-conversation-list");
  await expect(list).toBeVisible();
  await expect(
    list.getByText(fixture.conversations.orgA.subject, { exact: true }),
  ).toBeVisible();
  await expect(
    list.getByText(fixture.conversations.orgB.subject, { exact: true }),
  ).toHaveCount(0);

  await list
    .locator(`a[href="/whatsapp/${fixture.conversations.orgA.id}"]`)
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/whatsapp/${fixture.conversations.orgA.id}$`),
  );

  const thread = page.getByTestId("platform-conversation-thread");
  await expect(thread).toBeVisible();
  await expect(thread).toHaveAttribute("data-provider-proof", "not-proved");
  const disclosure = page.getByTestId("platform-synthetic-data-disclosure");
  await expect(disclosure).toContainText("Синтетические локальные данные");
  await expect(disclosure).toContainText("не получена от клиента");
  await expect(disclosure).toContainText(
    "не подтверждает работу внешних провайдеров",
  );

  const inboundMessages = thread.locator(
    '[data-message-direction="inbound"]',
  );
  await expect(inboundMessages).toHaveCount(
    fixture.conversations.orgA.messages.length,
  );
  for (const [index, body] of fixture.conversations.orgA.messages.entries()) {
    await expect(inboundMessages.nth(index)).toContainText(body);
  }

  await expectDeniedConversationRoute(
    page,
    `/whatsapp/${fixture.conversations.orgB.id}`,
  );
});

test("admin reads the persisted local P3C workflow without proving providers", async ({
  page,
}) => {
  await openOrgAConversation(page, fixture.identities.admin);
  await assertPersistedP3cWorkflow(page);
});

test("assigned Curator reads the same persisted local P3C workflow", async ({
  page,
}) => {
  await openOrgAConversation(page, fixture.identities.curator);
  await assertPersistedP3cWorkflow(page);
});

test("same-organization Sales cannot open another Sales scope", async ({
  page,
}) => {
  await login(page, fixture.identities.salesScoped);
  await expect(page).toHaveURL(/\/whatsapp$/);

  const list = page.getByTestId("platform-conversation-list");
  await expect(list).toBeVisible();
  await expect(
    list.getByText(fixture.conversations.sameOrgOutsideSalesScope.subject, {
      exact: true,
    }),
  ).toHaveCount(0);

  await expectDeniedConversationRoute(
    page,
    `/whatsapp/${fixture.conversations.sameOrgOutsideSalesScope.id}`,
  );
});

test("active messaging staff reaches only the Supabase-backed surface", async ({
  page,
}) => {
  await login(page, fixture.identities.admin);
  await expect(page).toHaveURL(/\/whatsapp$/);
  await expect(page.getByTestId("platform-conversation-list")).toBeVisible();
  await expect(
    page.getByText(fixture.conversations.orgA.subject, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/локальных таблиц CRM wa_/i)).toHaveCount(0);

  for (const legacyRoute of [
    "/dashboard",
    "/sales",
    "/clients",
    "/applications",
    "/documents",
    "/visa",
    "/calls",
    "/notifications",
    "/tasks",
    "/chat",
    "/reports",
    "/finance",
    "/settings",
    "/portal",
  ]) {
    await page.goto(legacyRoute);
    const destination = new URL(page.url());
    expect(destination.pathname, legacyRoute).toBe("/platform-pending");
    expect(destination.searchParams.get("from"), legacyRoute).toBe(legacyRoute);
    await expect(page.getByTestId("platform-pending")).toBeVisible();
  }

  const apiResults = await page.evaluate(
    async (requests) =>
      Promise.all(
        requests.map(async ({ path, method }) => {
          const response = await fetch(path, { method });
          return {
            path,
            status: response.status,
            body: await response.json(),
          };
        }),
      ),
    [
      { path: "/api/readiness", method: "GET" },
      { path: "/api/ai/draft", method: "POST" },
      { path: "/api/transcription/jobs", method: "POST" },
      { path: "/api/waha/qr", method: "GET" },
      { path: "/api/webhooks/waha", method: "POST" },
      { path: "/api/webhooks/whatsapp", method: "POST" },
      { path: "/api/webhooks/telephony", method: "POST" },
      { path: "/api/internal/lead-agent/whatsapp", method: "POST" },
    ],
  );
  for (const result of apiResults) {
    expect(result.status, result.path).toBe(403);
    expect(result.body, result.path).toEqual(
      expect.objectContaining({ error: "platform_route_not_connected" }),
    );
  }

  const actionBoundaryStatus = await page.evaluate(async () => {
    const response = await fetch("/finance", { method: "POST" });
    return response.status;
  });
  expect(actionBoundaryStatus).toBe(403);

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect
    .poll(async () =>
      (await page.context().cookies()).filter(({ name }) =>
        /^sb-[A-Za-z0-9_-]+-auth-token(?:\.\d+)?$/.test(name),
      ),
    )
    .toEqual([]);
  await page.goto("/whatsapp");
  await expect(page).toHaveURL(/\/login$/);
});

test("staff and student role destinations remain separated", async ({
  browser,
}) => {
  for (const [identity, expectedPath] of [
    [fixture.identities.curator, /\/whatsapp$/],
    [fixture.identities.finance, /\/platform-pending$/],
    [fixture.identities.student, /\/platform-pending$/],
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, identity);
    await expect(page).toHaveURL(expectedPath);
    if (expectedPath.source.includes("platform-pending")) {
      await expect(page.getByTestId("platform-pending")).toBeVisible();
      await expect(page.getByRole("link", { name: "Открыть сообщения" })).toHaveCount(0);
    }
    await context.close();
  }
});

test("cross-organization admin is denied the org A P3C workflow route", async ({
  page,
}) => {
  await login(page, fixture.identities.crossOrgAdmin);
  await expect(page).toHaveURL(/\/whatsapp$/);
  const list = page.getByTestId("platform-conversation-list");
  await expect(
    list.getByText(fixture.conversations.orgA.subject, { exact: true }),
  ).toHaveCount(0);
  await expectDeniedConversationRoute(
    page,
    `/whatsapp/${fixture.p3c.orgA.conversationId}`,
  );
});

test("stale sales workflow claims fail closed at the live platform RPC seam", async () => {
  const result = await workflowRpc(
    fixture.p3c.orgA.staleSalesAccessToken,
    fixture.p3c.orgA.conversationId,
  );
  expect([401, 403]).toContain(result.status);
});
