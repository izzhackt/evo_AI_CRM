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

test("the mobile page title is never truncated", async ({ page }, testInfo) => {
  // The lockup and the title share one row on a phone. When the lockup won,
  // "Воронка поступления" rendered as "Воронка поступл…" while the h1 below
  // said something else, so the full label appeared nowhere on the screen.
  test.skip(testInfo.project.name !== "mobile-chromium", "phone layout only");
  await openDevelopmentGate(page, "admin");

  for (const route of ROLE_ROUTES.admin) {
    await page.goto(route);
    const title = page.locator(".staff-topbar__mobile-title");
    await expect(title).toBeVisible();
    const cut = await title.evaluate((el) => ({
      truncated: el.scrollWidth > el.clientWidth,
      text: el.textContent,
      needs: el.scrollWidth,
      has: el.clientWidth,
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
    await openDevelopmentGate(page, role);
    await page.goto("/whatsapp");
    await expect(page.locator("main")).toBeVisible();

    const pane = await page.evaluate(() => {
      const el = [...document.querySelectorAll("div")].find((node) =>
        node.className.toString().includes("100dvh-"),
      );
      if (!el) return { found: false, bottom: 0, viewport: window.innerHeight };
      const box = el.getBoundingClientRect();
      return {
        found: true,
        bottom: Math.round(box.bottom),
        viewport: window.innerHeight,
      };
    });

    expect(pane.found, `${role}: the conversation pane should be on this page`).toBe(true);
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
