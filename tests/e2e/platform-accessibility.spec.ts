import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * V2 staff accessibility gate.
 *
 * It runs against the root application on the real local PostgreSQL V2
 * contract. It never uses EVO_UI_CONTRACT_FIXTURES, a demo seed, a mock
 * provider or a fallback repository, and it performs no provider side effect:
 * it only reads the surfaces the three fixed roles can already reach.
 */

const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;

type FixedRole = "admin" | "sales" | "admissions";

const ROLE_ROUTES: Readonly<Record<FixedRole, readonly string[]>> = {
  admin: [
    "/sales",
    "/clients",
    "/applications",
    "/documents",
    "/visa",
    "/finance",
    "/tasks",
    "/whatsapp",
    "/settings",
  ],
  sales: ["/sales", "/whatsapp"],
  admissions: [
    "/clients",
    "/applications",
    "/documents",
    "/visa",
    "/finance",
    "/tasks",
    "/whatsapp",
  ],
};

/** A denied route for each role, so the access-denied surface is covered too. */
const ROLE_DENIED_ROUTE: Readonly<Record<FixedRole, string | null>> = {
  admin: null,
  sales: "/clients",
  admissions: "/sales",
};

function credentials(role: FixedRole) {
  const prefix = `EVO_DEV_GATE_${role.toUpperCase()}`;
  const identifier = process.env[`${prefix}_IDENTIFIER`];
  const secret = process.env[`${prefix}_SECRET`];
  if (!identifier || !secret) {
    throw new Error(`missing development gate credential for ${role}`);
  }
  return { identifier, secret };
}

async function openDevelopmentGate(page: Page, role: FixedRole) {
  const { identifier, secret } = credentials(role);
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("#gate-identifier").fill(identifier);
  await page.locator("#gate-secret").fill(secret);
  await page
    .locator('form[aria-labelledby="login-title"] button[type="submit"]')
    .click();
  await expect(page.getByTestId("development-workspace")).toBeVisible();
  await page.getByTestId("open-role-workspace").click();
}

async function expectNoAutomatedWcagViolations(page: Page, context: string) {
  const results = await new AxeBuilder({ page })
    .withTags([...WCAG_TAGS])
    .analyze();

  expect(
    results.violations,
    `${context}\n\n${results.violations
      .map(
        ({ id, impact, help, nodes }) =>
          `${id} (${impact ?? "unknown"}): ${help}\n${nodes
            .map(
              ({ target, failureSummary }) =>
                `  ${target.join(" ")}: ${failureSummary ?? "no summary"}`,
            )
            .join("\n")}`,
      )
      .join("\n\n")}`,
  ).toEqual([]);
}

/** One page-level h1 is a release criterion, not polish. */
async function expectExactlyOneMainHeading(page: Page, context: string) {
  await expect(page.locator("h1"), `${context}: page-level h1`).toHaveCount(1);
}

/** WCAG 2.2 SC 1.4.10 forbids two-dimensional scrolling of the document. */
async function expectNoDocumentOverflow(page: Page, context: string) {
  const overflows = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth;
  });
  expect(overflows, `${context}: document scrolls horizontally`).toBe(false);
}

for (const role of ["admin", "sales", "admissions"] as const) {
  test(`${role} staff routes meet the automated WCAG A/AA gate`, async ({
    page,
  }) => {
    await openDevelopmentGate(page, role);

    for (const route of ROLE_ROUTES[role]) {
      await page.goto(route);
      await expect(page.locator("main")).toBeVisible();
      const context = `${role} ${route}`;
      await expectExactlyOneMainHeading(page, context);
      await expectNoDocumentOverflow(page, context);
      await expectNoAutomatedWcagViolations(page, context);
    }

    const denied = ROLE_DENIED_ROUTE[role];
    if (denied) {
      await page.goto(denied);
      await expect(page).toHaveURL(/\/access-denied/);
      const context = `${role} denied ${denied}`;
      await expectExactlyOneMainHeading(page, context);
      await expectNoDocumentOverflow(page, context);
      await expectNoAutomatedWcagViolations(page, context);
    }
  });
}

test("a deferred module fails closed without accessibility violations", async ({
  page,
}) => {
  await openDevelopmentGate(page, "admin");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/platform-pending/);
  await expectExactlyOneMainHeading(page, "platform-pending");
  await expectNoDocumentOverflow(page, "platform-pending");
  await expectNoAutomatedWcagViolations(page, "platform-pending");
});
