import { expect, test, type Page } from "@playwright/test";

const authMode = process.env.EVO_EXPECT_STAFF_AUTH_MODE ?? "configured";

const PROFILES = [
  {
    role: "admin",
    label: "Director/Admin",
    email: process.env.EVO_STAFF_AUTH_ADMIN_EMAIL,
    password: process.env.EVO_STAFF_AUTH_ADMIN_PASSWORD,
  },
  {
    role: "sales",
    label: "Sales Manager",
    email: process.env.EVO_STAFF_AUTH_SALES_EMAIL,
    password: process.env.EVO_STAFF_AUTH_SALES_PASSWORD,
  },
  {
    role: "admissions",
    label: "Admissions Manager",
    email: process.env.EVO_STAFF_AUTH_ADMISSIONS_EMAIL,
    password: process.env.EVO_STAFF_AUTH_ADMISSIONS_PASSWORD,
  },
] as const;

type TestRole = (typeof PROFILES)[number]["role"];

function profile(role: TestRole) {
  const value = PROFILES.find((candidate) => candidate.role === role);
  if (!value?.email || !value.password) {
    throw new Error(`missing Supabase staff browser credential for ${role}`);
  }
  return value as typeof value & { email: string; password: string };
}

async function submitLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#staff-email").fill(email);
  await page.locator("#staff-password").fill(password);
  await page.getByRole("button", { name: "Войти в CRM" }).click();
}

async function signIn(page: Page, role: TestRole) {
  const credentials = profile(role);
  await submitLogin(page, credentials.email, credentials.password);
  await expect(page.getByTestId("staff-entry-workspace")).toBeVisible();
}

async function expectActiveRole(
  page: Page,
  role: TestRole,
  authorityRole: TestRole = role,
) {
  await expect(page.getByTestId("active-role")).toHaveAttribute("data-role", role);
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-authority-role",
    authorityRole,
  );
}

async function expectDirectRouteDenied(
  page: Page,
  path: "/sales" | "/clients" | "/applications" | "/documents" | "/settings",
) {
  await page.goto(path);
  await expect(page).toHaveURL(
    new RegExp(`/access-denied\\?from=${encodeURIComponent(path)}$`),
  );
}

async function expectDirectRouteAllowed(
  page: Page,
  path: "/sales" | "/clients" | "/settings",
) {
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

function isSupabaseAuthCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("-auth-token");
}

test("the staff login exposes only email/password and removed access routes stay 404", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
  await expect(
    page.locator('form[aria-labelledby="login-title"] input:not([type="hidden"])'),
  ).toHaveCount(2);
  await expect(page.locator('input[name="email"]')).toHaveCount(1);
  await expect(page.locator('input[name="password"]')).toHaveCount(1);
  await expect(page.locator('input[name="identifier"]')).toHaveCount(0);
  await expect(page.locator('input[name="secret"]')).toHaveCount(0);
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

test("invalid credentials return one generic result and create no session", async ({
  page,
}) => {
  test.skip(authMode !== "configured");
  await submitLogin(page, "missing-staff@example.invalid", "invalid-password");
  await expect(page.locator("#login-error")).toHaveText(
    "Не удалось войти. Проверьте оба значения.",
  );
  expect(
    (await page.context().cookies()).some(({ name }) =>
      isSupabaseAuthCookie(name),
    ),
  ).toBe(false);
});

test("all three real identities persist, enforce role routes, and log out", async ({
  page,
}) => {
  test.skip(authMode !== "configured");

  for (const candidate of PROFILES) {
    await signIn(page, candidate.role);
    await expectActiveRole(page, candidate.role);
    await expect(page.getByTestId("active-role")).toHaveText(candidate.label);
    await expect
      .poll(async () =>
        (await page.context().cookies()).some(
          ({ name, sameSite }) =>
            isSupabaseAuthCookie(name) && sameSite === "Lax",
        ),
      )
      .toBe(true);
    await page.getByTestId("staff-logout").click();
    await expect(page).toHaveURL(/\/login$/);
    expect(
      (await page.context().cookies()).some(({ name }) =>
        isSupabaseAuthCookie(name),
      ),
    ).toBe(false);
  }
});

test("Sales and Admissions are denied outside their server-authorized interfaces", async ({
  page,
}) => {
  test.skip(authMode !== "configured");

  await signIn(page, "sales");
  await expectActiveRole(page, "sales");
  await expect(page.getByTestId("open-role-workspace")).toHaveAttribute(
    "href",
    "/sales",
  );
  for (const path of [
    "/clients",
    "/applications",
    "/documents",
    "/settings",
  ] as const) {
    await expectDirectRouteDenied(page, path);
  }

  await page.context().clearCookies();
  await signIn(page, "admissions");
  await expectActiveRole(page, "admissions");
  await expect(page.getByTestId("open-role-workspace")).toHaveAttribute(
    "href",
    "/clients",
  );
  await expectDirectRouteDenied(page, "/sales");
  await expectDirectRouteDenied(page, "/settings");
});

test("Admin preview changes only the effective interface, not Supabase authority", async ({
  page,
}) => {
  test.skip(authMode !== "configured");

  await signIn(page, "admin");
  await expectActiveRole(page, "admin");
  await page.goto("/settings");
  await expect(page.getByTestId("fixed-role-settings")).toBeVisible();
  await page.goto("/");

  await page.getByTestId("preview-role-sales").click();
  await expectActiveRole(page, "sales", "admin");
  await expect(page.getByTestId("preview-active")).toBeVisible();
  await expectDirectRouteAllowed(page, "/clients");
  await expectDirectRouteAllowed(page, "/settings");
  await expect(page.getByTestId("fixed-role-settings")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/platform-pending\?from=%2Fdashboard$/);
  await expect(page.getByTestId("platform-pending")).toBeVisible();
  await expect(page.getByTestId("pending-role")).toHaveAttribute(
    "data-role",
    "sales",
  );
  await expect(page.getByTestId("pending-role")).toHaveAttribute(
    "data-authority-role",
    "admin",
  );

  await page.goto("/");
  await page.getByTestId("preview-role-admissions").click();
  await expectActiveRole(page, "admissions", "admin");
  await expectDirectRouteAllowed(page, "/sales");

  await page.goto("/");
  await page.getByTestId("preview-role-admin").click();
  await expectActiveRole(page, "admin", "admin");
  await page.goto("/settings");
  await expect(page.getByTestId("fixed-role-settings")).toBeVisible();
});

test("an expired or removed browser session fails closed with no fallback", async ({
  page,
}) => {
  test.skip(authMode !== "configured");
  await signIn(page, "sales");

  await page.context().clearCookies();
  await page.goto("/sales");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId("staff-entry-workspace")).toHaveCount(0);
});

test("missing Supabase configuration stays unavailable instead of falling back", async ({
  page,
}) => {
  test.skip(authMode !== "unavailable");
  await submitLogin(page, "any@example.invalid", "any-password");
  await expect(page.locator("#login-error")).toHaveText(
    "Сервис входа временно недоступен.",
  );
  expect(
    (await page.context().cookies()).some(({ name }) =>
      isSupabaseAuthCookie(name),
    ),
  ).toBe(false);
});
