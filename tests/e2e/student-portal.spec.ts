import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;

const PORTAL_ROUTES = [
  { path: "/portal", expectedText: "Загрузить обновлённый паспорт" },
  { path: "/portal/documents", expectedText: "Паспорт" },
  {
    path: "/portal/applications",
    expectedText: "University of Browser Proof",
  },
  { path: "/portal/payments", expectedText: "Сервисный сбор EVO" },
  {
    path: "/portal/notifications",
    expectedText: "Загрузите более чёткую копию паспорта.",
  },
] as const;

// Empty/loading/error contracts stay in the component suite. This browser gate
// deliberately exercises real local data instead of injecting synthetic failures.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`STUDENT_PORTAL_GATE_MISSING:${name}`);
  return value;
}

function localDatabaseUrl(): string {
  const raw = requiredEnvironment("EVO_STUDENT_PORTAL_DB_URL");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("EVO_STUDENT_PORTAL_DB_URL must be a valid URL");
  }
  if (
    parsed.protocol !== "postgresql:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
  ) {
    throw new Error("EVO_STUDENT_PORTAL_DB_URL must target loopback PostgreSQL");
  }
  return raw;
}

function localSupabaseApiConfig() {
  const raw = requiredEnvironment("EVO_STUDENT_PORTAL_SUPABASE_URL");
  const publishableKey = requiredEnvironment(
    "EVO_STUDENT_PORTAL_SUPABASE_PUBLISHABLE_KEY",
  );
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("EVO_STUDENT_PORTAL_SUPABASE_URL must be a valid URL");
  }
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("EVO_STUDENT_PORTAL_SUPABASE_URL must be a loopback origin");
  }
  if (publishableKey.length < 16 || /\s/.test(publishableKey)) {
    throw new Error("EVO_STUDENT_PORTAL_SUPABASE_PUBLISHABLE_KEY is invalid");
  }
  return { url: parsed.origin, publishableKey };
}

async function browserSupabaseAccessToken(page: Page): Promise<string> {
  const authCookies = (await page.context().cookies())
    .filter(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"));
  const baseNames = new Set(
    authCookies.map(({ name }) => name.replace(/\.\d+$/, "")),
  );
  if (baseNames.size !== 1) {
    throw new Error("Expected exactly one browser Supabase auth session");
  }
  const [baseName] = [...baseNames];
  const direct = authCookies.find(({ name }) => name === baseName)?.value;
  const encoded =
    direct ??
    authCookies
      .filter(({ name }) => name.startsWith(`${baseName}.`))
      .sort(
        (left, right) =>
          Number(left.name.slice(baseName.length + 1)) -
          Number(right.name.slice(baseName.length + 1)),
      )
      .map(({ value }) => value)
      .join("");
  if (!encoded) throw new Error("Browser Supabase auth cookie is empty");

  let serialized = encoded;
  if (serialized.startsWith("base64-")) {
    serialized = Buffer.from(serialized.slice("base64-".length), "base64url").toString(
      "utf8",
    );
  }
  let session: unknown;
  try {
    session = JSON.parse(serialized);
  } catch {
    throw new Error("Browser Supabase auth cookie is malformed");
  }
  const accessToken =
    session && typeof session === "object" && "access_token" in session
      ? (session as { access_token?: unknown }).access_token
      : null;
  if (typeof accessToken !== "string" || accessToken.split(".").length !== 3) {
    throw new Error("Browser Supabase auth cookie contains no access token");
  }
  return accessToken;
}

function credentials(kind: "admin" | "student") {
  const prefix = `EVO_STUDENT_PORTAL_${kind.toUpperCase()}`;
  return {
    email: requiredEnvironment(`${prefix}_EMAIL`),
    password: requiredEnvironment(`${prefix}_PASSWORD`),
  };
}

async function submitLogin(page: Page, kind: "admin" | "student") {
  const identity = credentials(kind);
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("#staff-email").fill(identity.email);
  await page.locator("#staff-password").fill(identity.password);
  await page
    .locator('form[aria-labelledby="login-title"] button[type="submit"]')
    .click();
  await expect(page).toHaveURL(
    kind === "student" ? /\/portal$/ : /\/v3\/main$/,
  );
  await expect(
    page.getByTestId(
      kind === "student" ? "student-portal-shell" : "v3-shell",
    ),
  ).toBeVisible();
}

async function expectStylesLoaded(page: Page, context: string) {
  const proof = await page.evaluate(async () => {
    const hrefs = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'),
      (link) => link.href,
    );
    let bytes = 0;
    for (const href of new Set(hrefs)) {
      const response = await fetch(href);
      if (!response.ok) {
        return { bytes, hrefs: hrefs.length, failedHref: href, world: null };
      }
      bytes += (await response.text()).length;
    }
    const world = document.querySelector<HTMLElement>(".v3-world");
    return {
      bytes,
      hrefs: hrefs.length,
      failedHref: null,
      world: world ? getComputedStyle(world).backgroundColor : null,
    };
  });

  expect(proof.failedHref, `${context}: a stylesheet failed to load`).toBeNull();
  expect(proof.hrefs, `${context}: no stylesheet was linked`).toBeGreaterThan(0);
  expect(proof.bytes, `${context}: the served stylesheet bundle is too small`).toBeGreaterThan(
    100_000,
  );
  expect(proof.world, `${context}: the V3 theme did not apply`).not.toBeNull();
}

async function expectNoAutomatedWcagViolations(page: Page, context: string) {
  const results = await new AxeBuilder({ page })
    .withTags([...WCAG_TAGS])
    .analyze();
  expect(
    results.violations,
    `${context}\n${results.violations
      .map(
        ({ id, impact, nodes }) =>
          `${id} (${impact ?? "unknown"}): ${nodes.length} node(s)`,
      )
      .join("\n")}`,
  ).toEqual([]);
}

async function expectPortalGeometry(page: Page, context: string) {
  const geometry = await page.evaluate(() => {
    window.scrollTo(document.documentElement.scrollWidth, 0);
    const pageScrolled = window.scrollX !== 0;
    window.scrollTo(0, 0);

    const smallTargets: string[] = [];
    const selectors = [
      "a[href]",
      "button",
      'input:not([type="hidden"])',
      "select",
      "textarea",
      '[role="button"]',
    ];
    for (const element of document.querySelectorAll<HTMLElement>(selectors.join(","))) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        rect.width === 0 ||
        rect.height === 0
      ) {
        continue;
      }
      if (rect.width < 24 || rect.height < 24) {
        smallTargets.push(
          `${element.tagName} ${Math.round(rect.width)}x${Math.round(rect.height)} "${(
            element.getAttribute("aria-label") ??
            element.textContent ??
            ""
          )
            .trim()
            .slice(0, 40)}"`,
        );
      }
    }

    return {
      documentOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
      pageScrolled,
      headingCount: document.querySelectorAll("h1").length,
      smallTargets,
      nextError: Boolean(document.querySelector("#__next_error__")),
    };
  });

  expect(geometry.headingCount, `${context}: expected exactly one h1`).toBe(1);
  expect(geometry.documentOverflow, `${context}: document has horizontal overflow`).toBe(
    false,
  );
  expect(geometry.pageScrolled, `${context}: the page itself scrolls horizontally`).toBe(
    false,
  );
  expect(geometry.smallTargets, `${context}: interactive targets below 24px`).toEqual(
    [],
  );
  expect(geometry.nextError, `${context}: Next rendered an error boundary`).toBe(false);
}

test("all five Student Portal routes pass the real authenticated quality gate", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console:${message.text()}`);
  });

  await submitLogin(page, "student");
  if (testInfo.project.name === "forced-dark-chromium") {
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  }

  for (const route of PORTAL_ROUTES) {
    const errorCountBeforeNavigation = browserErrors.length;
    const response = await page.goto(route.path, { waitUntil: "networkidle" });
    expect(response?.status(), route.path).toBe(200);
    expect(new URL(page.url()).pathname, route.path).toBe(route.path);
    await expect(page.getByTestId("student-portal-shell")).toBeVisible();
    await expect(page.locator("main")).toContainText(route.expectedText);
    await expect(
      page.locator(`nav a[href="${route.path}"][aria-current="page"]`),
    ).toHaveCount(1);

    const context = `${testInfo.project.name} ${route.path}`;
    await expectStylesLoaded(page, context);
    await expectPortalGeometry(page, context);
    await expectNoAutomatedWcagViolations(page, context);
    expect(
      browserErrors.slice(errorCountBeforeNavigation),
      `${context}: browser or React/Next errors were emitted`,
    ).toEqual([]);
  }
});

test("anonymous, staff and Student routes stay mutually isolated", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "one browser profile is sufficient");

  await page.context().clearCookies();
  await page.goto("/portal");
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
  await expect(page.getByTestId("student-portal-shell")).toHaveCount(0);

  await submitLogin(page, "student");
  await page.goto("/v3/main");
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByTestId("v3-shell")).toHaveCount(0);
  await expect(page.getByTestId("student-portal-shell")).toBeVisible();

  await submitLogin(page, "admin");
  await page.goto("/portal");
  await expect(page).toHaveURL(/\/v3\/main$/);
  await expect(page.getByTestId("student-portal-shell")).toHaveCount(0);
  await expect(page.getByTestId("v3-shell")).toBeVisible();

  const tombstone = await page.goto("/portal/legacy");
  expect(tombstone?.status()).toBe(404);
  expect(new URL(page.url()).pathname).toBe("/portal/legacy");
  await expect(page.getByTestId("student-portal-shell")).toHaveCount(0);
  await expect(page.getByTestId("v3-shell")).toHaveCount(0);
});

test("the 393px Portal navigation reaches its off-screen final tab by keyboard", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-393-chromium", "393px profile only");

  await submitLogin(page, "student");
  const scroller = page.locator('nav[aria-label="Разделы кабинета"] ul');
  const notifications = scroller.locator('a[href="/portal/notifications"]');
  await expect(scroller).toHaveAttribute("tabindex", "0");
  expect((await scroller.getAttribute("aria-label"))?.trim().length ?? 0).toBeGreaterThan(0);
  expect(
    await notifications.evaluate((element) => {
      const link = element.getBoundingClientRect();
      const container = element.parentElement?.parentElement?.getBoundingClientRect();
      return Boolean(container && link.right > container.right + 1);
    }),
    "the final Portal tab must begin outside the visible 393px scroll region",
  ).toBe(true);

  await scroller.focus();
  await expect(scroller).toBeFocused();
  for (let press = 0; press < 6; press += 1) {
    await page.keyboard.press("Tab");
    if (await notifications.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(notifications).toBeFocused();
  expect(await scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/portal\/notifications$/);
  await expect(page.getByTestId("student-portal-shell")).toBeVisible();
});

test("the Student can persist one own notification read through the UI", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "mutation proof runs once");

  const notificationId = requiredEnvironment("EVO_STUDENT_PORTAL_NOTIFICATION_ID");
  await submitLogin(page, "student");
  await page.goto("/portal/notifications", { waitUntil: "networkidle" });
  const notification = page.locator("li", {
    hasText: "Загрузите более чёткую копию паспорта.",
  });
  await expect(notification).toBeVisible();
  await notification.getByRole("button", { name: "Отметить прочитанным" }).click();
  await expect(notification.getByRole("button", { name: "Отметить прочитанным" })).toHaveCount(
    0,
  );

  const sql = postgres(localDatabaseUrl(), { max: 1, prepare: false });
  try {
    const [proof] = await sql<
      { read_at: string | null; audit_count: string; request_id: string | null }[]
    >`
      SELECT
        notification.read_at::TEXT AS read_at,
        (
          SELECT event.request_id::TEXT
          FROM platform.audit_events AS event
          WHERE event.action = 'notification.read'
            AND event.resource_type = 'notification'
            AND event.resource_id = notification.id
          LIMIT 1
        ) AS request_id,
        (
          SELECT pg_catalog.count(*)::TEXT
          FROM platform.audit_events AS event
          WHERE event.action = 'notification.read'
            AND event.resource_type = 'notification'
            AND event.resource_id = notification.id
        ) AS audit_count
      FROM platform.notifications AS notification
      WHERE notification.id = ${notificationId}::UUID
    `;
    expect(proof?.read_at).not.toBeNull();
    expect(proof?.audit_count).toBe("1");
    expect(proof?.request_id).toMatch(UUID_PATTERN);
    if (!proof?.read_at || !proof.request_id || !UUID_PATTERN.test(proof.request_id)) {
      throw new Error("The first mark-read call returned incomplete persistence proof");
    }
    const firstReadAt = proof.read_at;
    const requestId = proof.request_id;

    const accessToken = await browserSupabaseAccessToken(page);
    const api = localSupabaseApiConfig();
    const replayClient = createClient(api.url, api.publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const replayCall = () =>
      replayClient.schema("platform").rpc(
        "mark_own_student_portal_notification_read_v2",
        {
          p_notification_id: notificationId,
          p_request_id: requestId,
        },
      );
    const replays = await Promise.all([replayCall(), replayCall()]);
    for (const replay of replays) {
      expect(replay.error).toBeNull();
      expect(replay.data).toMatchObject({
        notification_id: notificationId,
        is_read: true,
        read_at: firstReadAt,
      });
    }

    await page.reload({ waitUntil: "networkidle" });
    await expect(
      page.getByRole("button", { name: "Отметить прочитанным" }),
    ).toHaveCount(0);

    const [afterReload] = await sql<
      { read_at: string | null; audit_count: string }[]
    >`
      SELECT
        notification.read_at::TEXT AS read_at,
        (
          SELECT pg_catalog.count(*)::TEXT
          FROM platform.audit_events AS event
          WHERE event.action = 'notification.read'
            AND event.resource_type = 'notification'
            AND event.resource_id = notification.id
        ) AS audit_count
      FROM platform.notifications AS notification
      WHERE notification.id = ${notificationId}::UUID
    `;
    expect(afterReload?.read_at).toBe(firstReadAt);
    expect(afterReload?.audit_count).toBe("1");
  } finally {
    await sql.end({ timeout: 5 });
  }
});
