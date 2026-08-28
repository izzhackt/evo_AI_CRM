import { expect, test } from "@playwright/test";

import {
  DEVELOPMENT_SESSION_COOKIE,
  DEVELOPMENT_SESSION_MAX_AGE_SECONDS,
  createDevelopmentSessionToken,
  readDevelopmentGateConfig,
} from "../../src/lib/development-gate-core";

const gateMode = process.env.EVO_EXPECT_GATE_MODE ?? "configured";

const PROFILES = [
  {
    role: "admin",
    label: "Director/Admin",
    identifier: process.env.EVO_DEV_GATE_ADMIN_IDENTIFIER,
    secret: process.env.EVO_DEV_GATE_ADMIN_SECRET,
  },
  {
    role: "sales",
    label: "Sales Manager",
    identifier: process.env.EVO_DEV_GATE_SALES_IDENTIFIER,
    secret: process.env.EVO_DEV_GATE_SALES_SECRET,
  },
  {
    role: "admissions",
    label: "Admissions Manager",
    identifier: process.env.EVO_DEV_GATE_ADMISSIONS_IDENTIFIER,
    secret: process.env.EVO_DEV_GATE_ADMISSIONS_SECRET,
  },
] as const;

async function submitGate(
  page: import("@playwright/test").Page,
  identifier: string,
  secret: string,
) {
  await page.goto("/login");
  await page.locator("#gate-identifier").fill(identifier);
  await page.locator("#gate-secret").fill(secret);
  await page.getByRole("button", { name: "Открыть CRM" }).click();
}

async function login(
  page: import("@playwright/test").Page,
  identifier: string,
  secret: string,
) {
  await submitGate(page, identifier, secret);
  await expect(page.getByTestId("development-workspace")).toBeVisible();
}

async function developmentSessionCookie(
  page: import("@playwright/test").Page,
) {
  await expect
    .poll(async () =>
      (await page.context().cookies()).some(
        ({ name }) => name === DEVELOPMENT_SESSION_COOKIE,
      ),
    )
    .toBe(true);
  return (await page.context().cookies()).find(
    ({ name }) => name === DEVELOPMENT_SESSION_COOKIE,
  );
}

function profile(role: (typeof PROFILES)[number]["role"]) {
  const value = PROFILES.find((candidate) => candidate.role === role);
  if (!value?.identifier || !value.secret) {
    throw new Error(`missing browser credential for ${role}`);
  }
  return value as typeof value & { identifier: string; secret: string };
}

async function expectActiveRole(
  page: import("@playwright/test").Page,
  role: (typeof PROFILES)[number]["role"],
  authorityRole = role,
) {
  await expect(page.getByTestId("active-role")).toHaveAttribute("data-role", role);
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-authority-role",
    authorityRole,
  );
}

async function expectDirectRouteDenied(
  page: import("@playwright/test").Page,
  path: "/sales" | "/clients" | "/applications" | "/settings",
) {
  await page.goto(path);
  await expect(page).toHaveURL(
    new RegExp(`/access-denied\\?from=${encodeURIComponent(path)}$`),
  );
}

test("the private gate has exactly two fields and removed access routes stay 404", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.locator(
      'form[aria-labelledby="login-title"] input:not([type="hidden"])',
    ),
  ).toHaveCount(2);
  await expect(page.locator('input[name="identifier"]')).toHaveCount(1);
  await expect(page.locator('input[name="secret"]')).toHaveCount(1);
  await expect(page.locator('input[name="email"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: /регистра/i })).toHaveCount(0);

  for (const path of [
    "/register",
    "/register/extra",
    "/auth/platform-session",
    "/auth/platform-session/extra",
  ]) {
    const removed = await page.goto(path);
    expect(removed?.status(), path).toBe(404);
  }
});

test("invalid input returns one generic result without creating a session", async ({
  page,
}) => {
  test.skip(gateMode !== "configured");
  await submitGate(page, "gate-invalid-identifier-probe", "gate-invalid-secret-probe");
  await expect(page.locator("#login-error")).toHaveText(
    "Не удалось войти. Проверьте оба значения.",
  );
  expect(
    (await page.context().cookies()).some(
      ({ name }) => name === DEVELOPMENT_SESSION_COOKIE,
    ),
  ).toBe(false);
});

test("all three fixed roles persist, authorize the app, and log out", async ({ page }) => {
  test.skip(gateMode !== "configured");

  for (const profile of PROFILES) {
    if (!profile.identifier || !profile.secret) {
      throw new Error(`missing browser credential for ${profile.role}`);
    }
    await login(page, profile.identifier, profile.secret);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("development-workspace")).toBeVisible();
    await expect(page.getByTestId("active-role")).toHaveAttribute(
      "data-role",
      profile.role,
    );
    await expect(page.getByTestId("active-role")).toHaveAttribute(
      "data-authority-role",
      profile.role,
    );
    await expect(page.getByTestId("active-role")).toHaveText(profile.label);
    await expect(page.getByTestId("database-status")).toHaveAttribute(
      "data-status",
      "ready",
    );

    const session = await developmentSessionCookie(page);
    expect(session).toBeDefined();
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Strict");
    expect(session?.secure).toBe(false);
    expect((session?.expires ?? 0) - Date.now() / 1000).toBeGreaterThan(
      DEVELOPMENT_SESSION_MAX_AGE_SECONDS - 60,
    );

    await page.reload();
    await expect(page.getByTestId("active-role")).toHaveAttribute(
      "data-role",
      profile.role,
    );
    const version = await page.context().request.get("/api/version");
    expect(version.status()).not.toBe(401);

    await page.getByTestId("development-logout").click();
    await expect(page).toHaveURL(/\/login$/);
    expect(
      (await page.context().cookies()).some(
        ({ name }) => name === DEVELOPMENT_SESSION_COOKIE,
      ),
    ).toBe(false);
  }
});

test("Sales and Admissions receive exact route boundaries from the signed session", async ({
  page,
}) => {
  test.skip(gateMode !== "configured");

  const sales = profile("sales");
  await login(page, sales.identifier, sales.secret);
  await expectActiveRole(page, "sales");
  await expect(page.getByTestId("open-role-workspace")).toHaveAttribute(
    "href",
    "/sales",
  );
  for (const path of ["/clients", "/applications", "/settings"] as const) {
    await expectDirectRouteDenied(page, path);
  }

  await page.context().clearCookies();
  const admissions = profile("admissions");
  await login(page, admissions.identifier, admissions.secret);
  await expectActiveRole(page, "admissions");
  await expect(page.getByTestId("open-role-workspace")).toHaveAttribute(
    "href",
    "/clients",
  );
  await expectDirectRouteDenied(page, "/sales");
  await expectDirectRouteDenied(page, "/settings");
});

test("Admin preview preserves Admin authority while enforcing the exact effective role", async ({
  page,
}) => {
  test.skip(gateMode !== "configured");

  const admin = profile("admin");
  await login(page, admin.identifier, admin.secret);
  await expectActiveRole(page, "admin");

  await page.goto("/settings");
  await expect(page.getByTestId("fixed-role-settings")).toBeVisible();
  await page.goto("/");

  await page.getByTestId("preview-role-sales").click();
  await expectActiveRole(page, "sales", "admin");
  await expect(page.getByTestId("preview-active")).toBeVisible();
  await expectDirectRouteDenied(page, "/clients");
  await expectDirectRouteDenied(page, "/applications");
  await expectDirectRouteDenied(page, "/settings");

  await page.goto("/");
  await page.getByTestId("preview-role-admissions").click();
  await expectActiveRole(page, "admissions", "admin");
  await expectDirectRouteDenied(page, "/sales");
  await expectDirectRouteDenied(page, "/settings");

  await page.goto("/");
  await page.getByTestId("preview-role-admin").click();
  await expectActiveRole(page, "admin", "admin");
  await page.goto("/settings");
  await expect(page.getByTestId("fixed-role-settings")).toBeVisible();
});

test("tampered and expired role cookies fail closed", async ({ page }) => {
  test.skip(gateMode !== "configured");
  const profile = PROFILES[1];
  if (!profile.identifier || !profile.secret) throw new Error("missing sales profile");
  await login(page, profile.identifier, profile.secret);

  const session = await developmentSessionCookie(page);
  if (!session) throw new Error("development session cookie missing");
  const [payload, signature] = session.value.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  decoded.role = "admin";
  session.value = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;
  await page.context().addCookies([session]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?error=session_invalid$/);

  const config = readDevelopmentGateConfig(process.env);
  const expired = createDevelopmentSessionToken(config, "sales", {
    now: Date.now() - (DEVELOPMENT_SESSION_MAX_AGE_SECONDS + 60) * 1000,
    nonce: "expired-browser-proof",
  });
  await page.context().addCookies([
    {
      name: DEVELOPMENT_SESSION_COOKIE,
      value: expired,
      url: process.env.PLAYWRIGHT_BASE_URL,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?error=session_invalid$/);
});

test("missing primary configuration stays unavailable instead of falling back", async ({
  page,
}) => {
  test.skip(gateMode !== "unavailable");
  await submitGate(page, "any-identifier", "any-secret");
  await expect(page.locator("#login-error")).toHaveText(
    "Локальный доступ не настроен.",
  );
  expect(
    (await page.context().cookies()).some(
      ({ name }) => name === DEVELOPMENT_SESSION_COOKIE,
    ),
  ).toBe(false);
});
