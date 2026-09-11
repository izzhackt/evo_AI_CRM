import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;

const PORTAL_ROUTES = [
  { path: "/portal", expectedText: "Замените документ: Паспорт" },
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

function canonicalTimestamp(value: string): string {
  return value.replace(" ", "T").replace(/([+-]\d{2})$/u, "$1:00");
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
    await document.fonts.ready;
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
    const style = world ? getComputedStyle(world) : null;
    return {
      bytes,
      hrefs: hrefs.length,
      failedHref: null,
      world: style
        ? {
            background: style.backgroundColor,
            colorScheme: style.colorScheme,
            accent: style.getPropertyValue("--accent").trim(),
            fontFamily: style.fontFamily,
          }
        : null,
    };
  });

  expect(proof.failedHref, `${context}: a stylesheet failed to load`).toBeNull();
  expect(proof.hrefs, `${context}: no stylesheet was linked`).toBeGreaterThan(0);
  // CSS volume depends on Tailwind's source inventory; assert rendered branding.
  expect(proof.bytes, `${context}: the served stylesheet bundle is empty`).toBeGreaterThan(0);
  expect(proof.world, `${context}: the V3 theme did not apply`).toMatchObject({
    background: "rgb(243, 243, 243)",
    colorScheme: "light",
    accent: "#d70217",
  });
  expect(proof.world?.fontFamily, `${context}: the EVO font did not apply`).toContain("Golos Text Variable");
  const logo = page.getByRole("img", { name: "EVO Admissions", exact: true });
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) =>
    image.complete && image.naturalWidth > 0,
  ), { message: `${context}: the original EVO logo did not load` }).toBe(true);
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
      viewportWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflowElements: Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .flatMap(element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          if (rect.width === 0 || rect.height === 0 || style.display === "none" || style.visibility === "hidden") return [];
          if (rect.right <= document.documentElement.clientWidth + 1 && rect.left >= -1
            && element.scrollWidth <= element.clientWidth + 1) return [];
          return [{ tag: element.tagName, id: element.id, className: String(element.className),
            label: element.getAttribute("aria-label"), left: rect.left, right: rect.right,
            width: rect.width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }];
        }).slice(0, 30),
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
  expect(geometry.documentOverflow, `${context}: document has horizontal overflow: ${JSON.stringify(geometry)}`).toBe(
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
    const screenshotDirectory = process.env.EVO_STUDENT_PORTAL_SCREENSHOT_DIR;
    if (screenshotDirectory) {
      const routeName = route.path.replaceAll("/", "-").replace(/^-/, "");
      const screenshotPath = join(screenshotDirectory, `${testInfo.project.name}-${routeName}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });
      await chmod(screenshotPath, 0o600);
    }
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

  for (const path of ["/preview/student", "/preview/student/tests/english"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByTestId("assessment-preview")).toHaveCount(0);
  }

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

test("the compact mobile Portal menu supports keyboard navigation and dismissal", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile-"), "mobile profiles only");

  await submitLogin(page, "student");
  const menu = page.getByRole("button", { name: "Меню", exact: true });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.focus();
  await page.keyboard.press("Enter");
  const close = page.getByRole("button", { name: "Закрыть", exact: true });
  await expect(close).toHaveAttribute("aria-expanded", "true");
  const navigation = page.getByRole("navigation", { name: "Разделы кабинета" });
  await expect(navigation.getByRole("link")).toHaveCount(7);
  const notifications = navigation.locator('a[href="/portal/notifications"]');
  for (let press = 0; press < 8; press += 1) {
    await page.keyboard.press("Tab");
    if (await notifications.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(notifications).toBeFocused();
  for (const link of await navigation.getByRole("link").all()) {
    expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await notifications.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/portal\/notifications$/);
  await expect(page.getByTestId("student-portal-shell")).toBeVisible();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  // The persistent shell and URL can update before the streamed page arrives.
  await expect(page.getByRole("heading", { level: 1, name: "Уведомления", exact: true })).toBeVisible();
  await expectPortalGeometry(page, testInfo.project.name);
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
  // The accessible name changes while the Server Action is pending, so wait
  // on the stable submit element before asserting the committed database state.
  const markReadSubmission = notification.locator('form button[type="submit"]');
  await expect(markReadSubmission).toHaveAccessibleName("Отметить прочитанным");
  await markReadSubmission.click();
  await expect(markReadSubmission).toHaveCount(0);

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
      });
      expect(typeof replay.data?.read_at).toBe("string");
      expect(canonicalTimestamp(replay.data!.read_at)).toBe(
        canonicalTimestamp(firstReadAt),
      );
    }

    await page.reload({ waitUntil: "networkidle" });
    await expect(
      notification.getByRole("button", { name: "Отметить прочитанным" }),
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

test("mobile document review and curator replies persist through real Auth and database", async ({
  page, browser,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile-"), "one isolated document per mobile width");
  test.setTimeout(180_000);
  const width = page.viewportSize()!.width;
  const caseId = requiredEnvironment("EVO_STUDENT_PORTAL_CASE_ID");
  const label = `Проверка интерфейса ${width}`;
  const subject = `${"В".repeat(150)}${width}`;
  const question = `Изолированная техническая проверка обращения ${width}.`;
  const answer = `Ответ для проверки интерфейса ${width}; не клиентская переписка.`;
  const reason = `Техническая проверка ${width}\nНужна читаемая копия.`;
  const canonicalReason = reason.replace(/\n/g, " ");
  const decision = width === 320 ? "correction_required" : "rejected";
  const sql = postgres(localDatabaseUrl(), { max: 1, prepare: false });
  const adminContext = await browser.newContext({ viewport: { width, height: 852 }, locale: "ru-RU" });
  const adminPage = await adminContext.newPage();
  page.setDefaultTimeout(15_000);
  adminPage.setDefaultTimeout(15_000);
  const appErrors: string[] = [];
  page.on("pageerror", error => appErrors.push(error.message));
  adminPage.on("pageerror", error => appErrors.push(error.message));
  const screenshot = async (target: Page, name: string) => {
    const directory = process.env.EVO_STUDENT_PORTAL_SCREENSHOT_DIR;
    if (!directory) return;
    const path = join(directory, `${testInfo.project.name}-${name}.png`);
    await target.screenshot({ path, fullPage: true, animations: "disabled" });
    await chmod(path, 0o600);
  };
  try {
    await submitLogin(page, "student");
    await page.getByText("Нужна помощь", { exact: true }).click();
    await page.getByLabel("Тема", { exact: true }).fill(subject);
    await page.getByLabel("Что нужно уточнить", { exact: true }).fill(question);
    await page.getByRole("button", { name: "Передать вопрос команде", exact: true }).click();
    await expect(page.getByRole("button", { name: "Новое обращение", exact: true })).toBeVisible();
    const [help] = await sql<{ id: string; version: string }[]>`
      SELECT id::TEXT, version::TEXT FROM platform.case_help_requests
      WHERE student_case_id = ${caseId}::UUID AND subject = ${subject}
    `;
    expect(help).toBeTruthy();
    await page.goto("/portal/documents");

    await submitLogin(adminPage, "admin");
    const profileResponse = await adminPage.goto(`/v3/profile?case=${caseId}&tab=documents`);
    expect(profileResponse?.status(), "The complete synthetic handoff must render the real staff document route").toBe(200);
    const item = adminPage.getByTestId("v3-document-item").filter({ hasText: label });
    await expect(item).toBeVisible();
    await item.getByText("Проверить документ", { exact: true }).click();
    const review = item.locator("form").filter({ has: adminPage.getByLabel("Решение", { exact: true }) });
    await expect(review.getByRole("option", { name: "Принять", exact: true })).toBeDisabled();
    await review.getByLabel("Решение", { exact: true }).selectOption(decision);
    const reasonInput = review.getByLabel("Что нужно исправить", { exact: true });
    await expect(reasonInput).toHaveAttribute("required", "");
    await review.getByRole("button", { name: "Сохранить решение", exact: true }).click();
    expect(await reasonInput.evaluate(element => (element as HTMLTextAreaElement).validity.valueMissing)).toBe(true);
    await reasonInput.fill(reason);
    expect(await adminPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    for (const control of await review.locator("select,textarea,button").all()) {
      expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await screenshot(adminPage, "document-review");
    await review.getByRole("button", { name: "Сохранить решение", exact: true }).click();
    await expect(item.getByText(canonicalReason, { exact: true })).toBeVisible();
    await expect(item.getByText("Проверить документ", { exact: true })).toHaveCount(0);
    const [reviewProof] = await sql<{ decision: string; reason: string; reviews: string; projections: string; scan_count: string; legacy_unscanned: boolean }[]>`
      SELECT slot.status::TEXT AS decision, review.reason,
        (SELECT count(*)::TEXT FROM platform.document_reviews r WHERE r.document_slot_id = slot.id) AS reviews,
        (SELECT count(*)::TEXT FROM platform.student_portal_notification_projection_v1 n WHERE n.document_slot_id = slot.id) AS projections,
        (SELECT count(*)::TEXT FROM platform_private.document_malware_scan_attestations a WHERE a.document_version_id = slot.current_version_id) AS scan_count,
        (SELECT NOT r.ingress_scan_required AND r.ingress_scan_result IS NULL AND r.ingress_scanner_engine IS NULL
          FROM platform_private.document_upload_reservations r WHERE r.document_version_id = slot.current_version_id) AS legacy_unscanned
      FROM platform.document_slots slot
      JOIN platform.document_requirements requirement ON requirement.id = slot.requirement_id
      JOIN platform.document_reviews review ON review.document_version_id = slot.current_version_id
      WHERE slot.student_case_id = ${caseId}::UUID AND requirement.label = ${label}
    `;
    expect(reviewProof).toEqual({ decision, reason: canonicalReason, reviews: "1", projections: "1", scan_count: "0", legacy_unscanned: true });
    await page.bringToFront();
    // No manual reload: the visible-tab updater must expose the committed decision.
    await expect(page.getByText(canonicalReason, { exact: true })).toBeVisible({ timeout: 45_000 });
    await expectPortalGeometry(page, `${width}px reviewed Student document`);

    await page.goto("/portal");
    await page.getByText("Нужна помощь", { exact: true }).click();
    await page.getByLabel("Тема", { exact: true }).fill("Несохранённый черновик");
    await page.getByLabel("Что нужно уточнить", { exact: true }).fill("Этот ввод должен сохраниться при обновлении ответа.");
    const config = localSupabaseApiConfig();
    const staffClient = createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${await browserSupabaseAccessToken(adminPage)}` } },
    });
    const command = { p_case_id: caseId, p_help_id: help.id, p_answer: answer,
      p_expected_version: help.version, p_request_id: randomUUID() };
    const response = await staffClient.schema("platform").rpc("answer_case_help_request_v1", command);
    expect(response.error).toBeNull();
    const replay = await staffClient.schema("platform").rpc("answer_case_help_request_v1", command);
    expect(replay.error).toBeNull();
    expect(replay.data).toEqual(response.data);
    await expect(page.locator("#case-help")).toContainText(answer, { timeout: 45_000 });
    await expect(page.getByLabel("Тема", { exact: true })).toHaveValue("Несохранённый черновик");
    await expect(page.getByLabel("Что нужно уточнить", { exact: true })).toHaveValue("Этот ввод должен сохраниться при обновлении ответа.");
    await expectPortalGeometry(page, `${width}px help reply preserves draft`);

    const notificationRows = await sql<{ id: string }[]>`
      SELECT id::TEXT FROM platform.notifications WHERE category = 'case_help.answer'
        AND student_case_id = ${caseId}::UUID AND dedupe_key = ${`case_help_answer:${command.p_request_id}`}
    `;
    expect(notificationRows).toHaveLength(1);
    const notificationId = notificationRows[0].id;
    await page.goto("/portal/notifications");
    const detailHref = `/portal/notifications/${notificationId}`;
    await page.locator(`a[href="${detailHref}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${detailHref}$`));
    await expect(page.getByRole("heading", { name: subject, exact: true })).toBeVisible();
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    await expectPortalGeometry(page, `${width}px exact reply detail`);
    await expectNoAutomatedWcagViolations(page, `${width}px exact reply detail`);
    const markRead = page.getByRole("button", { name: "Отметить прочитанным", exact: true });
    expect((await markRead.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await screenshot(page, "help-reply-detail");
    await markRead.click();
    await expect(markRead).toHaveCount(0);
    await page.reload();
    await expect(markRead).toHaveCount(0);
    const [readProof] = await sql<{ read: boolean; events: string; audits: string }[]>`
      SELECT read_at IS NOT NULL AS read,
        (SELECT count(*)::TEXT FROM platform.notification_events e WHERE e.notification_id = n.id AND e.event_type = 'read') AS events,
        (SELECT count(*)::TEXT FROM platform.audit_events a WHERE a.resource_id = n.id AND a.action = 'notification.read') AS audits
      FROM platform.notifications n WHERE id = ${notificationId}::UUID
    `;
    expect(readProof).toEqual({ read: true, events: "1", audits: "1" });
    const foreignClient = createClient(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const foreignAuth = await foreignClient.auth.signInWithPassword({
      email: requiredEnvironment("EVO_STUDENT_PORTAL_STUDENT_SECOND_EMAIL"),
      password: requiredEnvironment("EVO_STUDENT_PORTAL_STUDENT_SECOND_PASSWORD"),
    });
    expect(foreignAuth.error).toBeNull();
    const foreignReply = await foreignClient.schema("platform").rpc("student_portal_help_reply_v1", { p_notification_id: notificationId });
    expect(foreignReply.error?.code).toBe("42501");
    expect(foreignReply.data).toBeNull();
    expect(appErrors).toEqual([]);
  } finally {
    await adminContext.close();
    await sql.end({ timeout: 5 });
  }
});
