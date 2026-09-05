import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Successor staff accessibility gate.
 *
 * It runs against the active application on the real local Supabase/PostgreSQL
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
    "/v3/main",
    "/v3/pipeline",
    "/v3/inbox",
    "/v3/profile",
    "/v3/calendar",
    "/v3/knowledge",
    "/v3/settings",
  ],
  sales: ["/v3/main", "/v3/pipeline", "/v3/inbox", "/v3/profile"],
  admissions: [
    "/v3/inbox",
    "/v3/profile",
    "/v3/calendar",
    "/v3/knowledge",
  ],
};

/** A denied route for each role, so the access-denied surface is covered too. */
const ROLE_DENIED_ROUTE: Readonly<Record<FixedRole, string | null>> = {
  admin: null,
  sales: "/v3/calendar",
  admissions: "/v3/pipeline",
};

const ROLE_HOME: Readonly<Record<FixedRole, string>> = {
  admin: "/v3/main",
  sales: "/v3/main",
  admissions: "/v3/calendar",
};

const RETIRED_UI_ROUTES = [
  "/dashboard",
  "/sales",
  "/clients",
  "/applications",
  "/documents",
  "/visa",
  "/finance",
  "/tasks",
  "/settings",
  "/portal",
  "/calls",
  "/chat",
  "/whatsapp",
  "/notifications",
  "/reports",
] as const;

function credentials(role: FixedRole) {
  const prefix = `EVO_STAFF_AUTH_${role.toUpperCase()}`;
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) {
    throw new Error(`missing Supabase staff credential for ${role}`);
  }
  return { email, password };
}

async function signInAsStaff(page: Page, role: FixedRole) {
  const { email, password } = credentials(role);
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("#staff-email").fill(email);
  await page.locator("#staff-password").fill(password);
  await page
    .locator('form[aria-labelledby="login-title"] button[type="submit"]')
    .click();
  await expect(page).toHaveURL(new RegExp(`${ROLE_HOME[role]}$`));
  await expect(page.getByTestId("v3-shell")).toBeVisible();
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-role",
    role,
  );
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-authority-role",
    role,
  );
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
    await signInAsStaff(page, role);

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

test("the unauthenticated gate and authenticated V3 root meet the WCAG A/AA gate", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
  await expect(page.locator("main")).toBeVisible();
  await expectExactlyOneMainHeading(page, "login");
  await expectNoDocumentOverflow(page, "login");
  await expectNoAutomatedWcagViolations(page, "login");
  await expectContrastActuallyChecked(page, "login");

  await signInAsStaff(page, "admin");
  await page.goto("/");
  await expect(page).toHaveURL(/\/v3\/main$/);
  await expectExactlyOneMainHeading(page, "authenticated V3 root");
  await expectNoDocumentOverflow(page, "authenticated V3 root");
  await expectNoAutomatedWcagViolations(page, "authenticated V3 root");
  await expectContrastActuallyChecked(page, "authenticated V3 root");
});

test("the mobile V3 page heading is never truncated", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "phone layout only");
  await signInAsStaff(page, "admin");

  for (const route of ROLE_ROUTES.admin) {
    await page.goto(route);
    const heading = page.locator("main h1");
    await expect(heading).toBeVisible();
    const cut = await heading.evaluate((element) => ({
      truncated: element.scrollWidth > element.clientWidth,
      text: element.textContent,
      needs: element.scrollWidth,
      has: element.clientWidth,
    }));
    expect(
      cut.truncated,
      `${route}: "${cut.text}" needs ${cut.needs}px and has ${cut.has}px`,
    ).toBe(false);
  }
});

test("the conversation pane fits the fold for every role", async ({ page }, testInfo) => {
  // It reserved a constant for the chrome above it, which is right for
  // whichever role it was measured on and wrong for the rest: the admin role
  // preview adds a band the other two never see, so 19rem left sales and
  // admissions with 116px of dead viewport while admin had 34px. Checking
  // only "does not overflow" would pass a pane that is far too short.
  test.skip(testInfo.project.name !== "desktop-chromium", "two-column layout only");

  for (const role of ["admin", "sales", "admissions"] as const) {
    await signInAsStaff(page, role);
    await page.goto("/v3/inbox");
    await expect(page.locator("main")).toBeVisible();

    const pane = await page.locator("main").evaluate((el) => {
      const box = el.getBoundingClientRect();
      return {
        bottom: Math.round(box.bottom),
        viewport: window.innerHeight,
      };
    });

    const unused = pane.viewport - pane.bottom;
    expect(
      unused,
      `${role}: the pane ends at ${pane.bottom}px on a ${pane.viewport}px viewport`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      unused,
      `${role}: the pane leaves ${unused}px of the viewport unused below it`,
    ).toBeLessThanOrEqual(64);
  }
});

test("retired V2 staff routes remain hidden 404s without a V3 fallback", async ({
  page,
}) => {
  await signInAsStaff(page, "admin");

  for (const route of RETIRED_UI_ROUTES) {
    const response = await page.goto(route);
    if (!response) throw new Error(`${route}: navigation returned no response`);
    expect(response.status(), route).toBe(404);
    expect(new URL(page.url()).pathname, route).toBe(route);
    await expect(page.getByTestId("v3-shell")).toHaveCount(0);
  }
});

test("an unknown module fails closed without accessibility violations", async ({
  page,
}) => {
  await signInAsStaff(page, "admin");
  await page.goto("/not-yet-connected");
  await expect(page).toHaveURL(/\/platform-pending/);
  await expectExactlyOneMainHeading(page, "platform-pending");
  await expectNoDocumentOverflow(page, "platform-pending");
  await expectNoAutomatedWcagViolations(page, "platform-pending");
});
