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

async function openDevelopmentGate(
  page: Page,
  role: FixedRole,
  { stayOnEntry = false }: { stayOnEntry?: boolean } = {},
) {
  const { identifier, secret } = credentials(role);
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("#gate-identifier").fill(identifier);
  await page.locator("#gate-secret").fill(secret);
  await page
    .locator('form[aria-labelledby="login-title"] button[type="submit"]')
    .click();
  await expect(page.getByTestId("development-workspace")).toBeVisible();
  // The entry page is a surface in its own right; callers auditing it stop here
  // rather than continuing into the staff shell.
  if (stayOnEntry) return;
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

/**
 * A decoration must never be able to blind the contrast check.
 *
 * axe resolves an element's background by walking what covers it. It cannot
 * compute the contribution of an SVG, and it cannot see through a stacking
 * context, so either one lying over text downgrades every contrast result
 * underneath from `violations` to `incomplete` -- and a gate that asserts on
 * violations alone then passes a page whose text is unreadable. A full-bleed
 * brand pattern did exactly that to 12 elements of /login, and an injected
 * 1.2:1 regression went undetected until this check existed.
 */
async function expectContrastActuallyChecked(page: Page, context: string) {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  const unresolved = results.incomplete.filter(({ id }) => id === "color-contrast");
  expect(
    unresolved.flatMap(({ nodes }) => nodes.map(({ target }) => target.join(" "))),
    `${context}: contrast could not be resolved, so a failure here would not be reported`,
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

test("the unauthenticated gate and the entry page meet the WCAG A/AA gate", async ({
  page,
}) => {
  // These two carry the brand surfaces -- the isometric field and the large
  // mark -- and neither was analysed before, so a decorative regression on
  // either could not fail this gate. /login is also the only page a person
  // sees before authenticating.
  await page.goto("/login");
  await expect(page.locator("main")).toBeVisible();
  await expectExactlyOneMainHeading(page, "login");
  await expectNoDocumentOverflow(page, "login");
  await expectNoAutomatedWcagViolations(page, "login");
  await expectContrastActuallyChecked(page, "login");

  await openDevelopmentGate(page, "admin", { stayOnEntry: true });
  await expectExactlyOneMainHeading(page, "entry");
  await expectNoDocumentOverflow(page, "entry");
  await expectNoAutomatedWcagViolations(page, "entry");
  await expectContrastActuallyChecked(page, "entry");
});

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
