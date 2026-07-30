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
  identities: Readonly<{
    admin: Identity;
    curator: Identity;
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
