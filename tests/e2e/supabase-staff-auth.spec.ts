import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

import { expect, test, type Download, type Locator, type Page } from "@playwright/test";

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

const ORGANIZATION_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bishkek",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function organizationDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Supabase RPC returned an invalid timestamp");
  }
  const parts = ORGANIZATION_DATE.formatToParts(parsed);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Unable to resolve the EVO organization date");
  }
  return `${year}-${month}-${day}`;
}

function requireUuid(name: string): string {
  const value = process.env[name];
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error(`${name} must be a valid non-nil UUID`);
  }
  return value.toLowerCase();
}

function requireUuidValue(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error("Supabase RPC returned an invalid UUID");
  }
  return value.toLowerCase();
}

function localSupabaseApiConfig(): Readonly<{
  apiOrigin: string;
  publishableKey: string;
}> {
  const rawUrl = process.env.EVO_SUPABASE_DIRECT_API_URL;
  const publishableKey = process.env.EVO_SUPABASE_DIRECT_PUBLISHABLE_KEY;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl ?? "");
  } catch {
    throw new Error("EVO_SUPABASE_DIRECT_API_URL must be a valid URL");
  }
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  ) {
    throw new Error("EVO_SUPABASE_DIRECT_API_URL must be a loopback origin");
  }
  if (
    !publishableKey ||
    publishableKey.length < 16 ||
    /\s/.test(publishableKey)
  ) {
    throw new Error("EVO_SUPABASE_DIRECT_PUBLISHABLE_KEY is invalid");
  }
  return { apiOrigin: parsed.origin, publishableKey };
}

async function localSupabaseAccessToken(role: TestRole) {
  const { apiOrigin, publishableKey } = localSupabaseApiConfig();
  const credentials = profile(role);
  const response = await fetch(
    `${apiOrigin}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `local Supabase password grant failed with ${response.status}`,
    );
  }
  const payload: unknown = await response.json();
  const accessToken =
    payload && typeof payload === "object" && "access_token" in payload
      ? (payload as { access_token?: unknown }).access_token
      : null;
  if (typeof accessToken !== "string" || accessToken.length < 32) {
    throw new Error("local Supabase password grant returned no access token");
  }
  return accessToken;
}

async function directPlatformRpc(
  functionName:
    | "staff_sales_lead_page"
    | "staff_sales_lead_detail"
    | "staff_sales_stage_entry_cohort"
    | "staff_sales_owner_options"
    | "mutate_sales_lead_workflow"
    | "staff_lead_admissions_gate"
    | "mutate_lead_admissions_gate"
    | "staff_lead_admissions_handoff"
    | "handoff_lead_to_admissions"
    | "staff_student_case_handoff_context"
    | "staff_case_task_queue"
    | "staff_case_visa"
    | "staff_visa_queue"
    | "staff_document_queue"
    | "staff_student_case_document_workspace"
    | "set_student_case_route"
    | "create_document_requirement"
    | "create_document_slot"
    | "create_payment_obligation",
  body: Readonly<Record<string, unknown>>,
  accessToken?: string,
): Promise<Readonly<{ status: number; payload: unknown }>> {
  const { apiOrigin, publishableKey } = localSupabaseApiConfig();
  const response = await fetch(`${apiOrigin}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Content-Profile": "platform",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Status is still authoritative; never echo a provider body or token.
  }
  return { status: response.status, payload };
}

async function directStorageRequest(
  path: string,
  accessToken: string,
  init: Readonly<{
    method: "POST" | "PUT" | "DELETE";
    contentType: string;
    body: BodyInit;
    upsert?: boolean;
  }>,
): Promise<Readonly<{ status: number; payload: unknown }>> {
  const { apiOrigin, publishableKey } = localSupabaseApiConfig();
  const response = await fetch(`${apiOrigin}/storage/v1/${path}`, {
    method: init.method,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": init.contentType,
      ...(init.upsert ? { "x-upsert": "true" } : {}),
    },
    body: init.body,
    redirect: "manual",
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Status remains authoritative for non-JSON Storage responses.
  }
  return { status: response.status, payload };
}

function expectStorageDenied(status: number) {
  expect(status).toBeGreaterThanOrEqual(400);
  expect(status).toBeLessThan(500);
}

async function readDownload(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function submitDocumentUpload(page: Page, within?: Locator) {
  const root = within ?? page;
  const form = root.getByTestId("v3-document-upload-form");
  await expect(form.locator('input[name="request_id"]')).not.toHaveValue("");
  await form.locator('button[type="submit"]').click();
  await expect(root.getByTestId("v3-document-upload-status")).toHaveAttribute(
    "data-outcome",
    "saved",
  );
  await page.reload();
}

function writeP4AcceptanceResult(result: Readonly<Record<string, unknown>>) {
  const resultPath = process.env.EVO_P4_ACCEPTANCE_RESULT_FILE;
  if (!resultPath) {
    throw new Error("EVO_P4_ACCEPTANCE_RESULT_FILE is required");
  }
  writeFileSync(resultPath, JSON.stringify(result), { mode: 0o600 });
}

function assertDeniedRpc(
  result: Readonly<{ status: number; payload: unknown }>,
) {
  expect([401, 403]).toContain(result.status);
  expect(Array.isArray(result.payload) && result.payload.length > 0).toBe(
    false,
  );
}

function expectObject(value: unknown): Record<string, unknown> {
  expect(
    value !== null && typeof value === "object" && !Array.isArray(value),
  ).toBe(true);
  return value as Record<string, unknown>;
}

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
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-role",
    role,
  );
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-authority-role",
    authorityRole,
  );
}

async function expectDirectRouteDenied(
  page: Page,
  path:
    | "/sales"
    | "/clients"
    | "/applications"
    | "/documents"
    | "/v3/knowledge"
    | "/settings",
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

async function expectDashboardQueues(
  page: Page,
  visible: readonly ("sales" | "clients" | "tasks" | "finance" | "whatsapp")[],
) {
  const allQueues = [
    "sales",
    "clients",
    "tasks",
    "finance",
    "whatsapp",
  ] as const;

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("dashboard-page")).toBeVisible();
  await expect(page.getByTestId("canonical-records-unavailable")).toHaveCount(
    0,
  );

  for (const queue of allQueues) {
    await expect(page.getByTestId(`dashboard-queue-link-${queue}`)).toHaveCount(
      visible.includes(queue) ? 1 : 0,
    );
  }
}

async function expectExactSupabaseSalesRead(
  page: Page,
  leadId: string,
  clientId: string,
) {
  await page.goto(`/sales?q=${encodeURIComponent(leadId)}`);
  await expect(page.getByTestId("platform-sales-page")).toBeVisible();
  await expect(page.getByTestId("canonical-records-unavailable")).toHaveCount(
    0,
  );

  const rows = page.getByTestId("canonical-lead-row");
  await expect(rows).toHaveCount(1);
  const exactRow = page.locator(
    `[data-testid="canonical-lead-row"][data-lead-id="${leadId}"]`,
  );
  await expect(exactRow).toBeVisible();
  await expect(exactRow).toHaveAttribute("data-workflow-version", "7");
  await expect(exactRow).toContainText(clientId);

  await exactRow.locator(`a[href="/v3/profile?id=${leadId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/v3/profile\\?id=${leadId}$`));
  await expect(page.getByTestId("v3-profile")).toHaveAttribute(
    "data-lead-id",
    leadId,
  );
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
    page.locator(
      'form[aria-labelledby="login-title"] input:not([type="hidden"])',
    ),
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

test("retired P6B staff and API routes are absent from the authenticated runtime", async ({
  page,
}) => {
  test.skip(authMode !== "configured");

  await signIn(page, "admin");
  await expectActiveRole(page, "admin");

  for (const path of ["/calls", "/chat", "/notifications", "/reports"] as const) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }

  for (const path of [
    "/api/database/status",
    "/api/webhooks/telephony",
  ] as const) {
    const response = await page.request.get(path, { failOnStatusCode: false });
    expect(response.status(), path).toBe(404);
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
    "/v3/knowledge",
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

test("Admin downloads the canonical audit CSV while Sales is denied", async ({
  page,
}) => {
  test.skip(authMode !== "configured");

  await signIn(page, "admin");
  await page.goto("/v3/settings?section=journal");
  const exportForm = page.getByTestId("v3-audit-export");
  await expect(exportForm).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await exportForm.getByRole("button", { name: "Скачать CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("evo-platform-audit.csv");
  expect((await readDownload(download)).toString("utf8")).toContain(
    '"audit_event_id","created_at","action"',
  );

  await page.context().clearCookies();
  await signIn(page, "sales");
  const endAt = new Date();
  const startAt = new Date(endAt.getTime() - 30 * 24 * 60 * 60 * 1_000);
  const denial = await page.request.post("/api/platform-audit/export", {
    form: {
      request_id: randomUUID(),
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
    },
    headers: { origin: new URL(page.url()).origin },
    maxRedirects: 0,
  });
  expect(denial.status()).toBe(403);
});

test("disabled canonical audit hides export and rejects the route", async ({
  page,
}) => {
  test.skip(authMode !== "audit-disabled");

  await signIn(page, "admin");
  await page.goto("/v3/settings?section=journal");
  await expect(page.getByTestId("v3-audit-export")).toHaveCount(0);

  const endAt = new Date();
  const startAt = new Date(endAt.getTime() - 30 * 24 * 60 * 60 * 1_000);
  const denial = await page.request.post("/api/platform-audit/export", {
    form: {
      request_id: randomUUID(),
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
    },
    headers: { origin: new URL(page.url()).origin },
    maxRedirects: 0,
  });
  expect(denial.status()).toBe(503);
});

test("Sales reads the exact Supabase RLS queue and detail while Admissions is denied", async ({
  page,
}) => {
  test.skip(authMode !== "configured");
  const leadId = requireUuid("EVO_SUPABASE_SALES_PROOF_LEAD_ID");
  const clientId = requireUuid("EVO_SUPABASE_SALES_PROOF_CLIENT_ID");

  await signIn(page, "sales");
  await expectActiveRole(page, "sales");
  await expectExactSupabaseSalesRead(page, leadId, clientId);

  await page.context().clearCookies();
  await signIn(page, "admissions");
  await expectActiveRole(page, "admissions");
  await page.goto(`/v3/profile?id=${leadId}`);
  await expect(page).toHaveURL(new RegExp(`/v3/profile\\?id=${leadId}$`));
  await expect(page.getByTestId("v3-profile")).toHaveCount(0);
  await expect(
    page.getByText(
      "Такого человека в базе нет. Показывать вместо него другого мы не будем.",
    ),
  ).toBeVisible();
});

test("Sales inbox renders the exact verified conversation with canonical amoCRM placement", async ({
  page,
}) => {
  test.skip(authMode !== "configured");
  const conversationId = requireUuid("EVO_SUPABASE_SALES_CONVERSATION_ID");
  const leadId = requireUuid("EVO_SUPABASE_SALES_CONVERSATION_LEAD_ID");

  await signIn(page, "sales");
  await page.goto(`/v3/inbox?conversation=${conversationId}`);
  await expect(page).toHaveURL(
    new RegExp(`/v3/inbox\\?conversation=${conversationId}$`),
  );
  await expect(page.getByTestId("v3-inbox")).toBeVisible();
  await expect(page.getByTestId("v3-inbox-thread")).toBeVisible();
  await expect(page.getByTestId("v3-inbox-amocrm")).toHaveAttribute(
    "data-status",
    "available",
  );
  await expect(
    page.getByRole("link", { name: "Открыть профиль" }),
  ).toHaveAttribute("href", `/v3/profile?id=${leadId}`);
  await expect(
    page
      .getByTestId("v3-inbox-thread")
      .getByText("Negative proof:", { exact: false }),
  ).toHaveCount(0);
});

test("Sales RPCs deny anonymous and Admissions callers at the real API boundary", async () => {
  test.skip(authMode !== "configured");
  const leadId = requireUuid("EVO_SUPABASE_SALES_PROOF_LEAD_ID");
  const salesToken = await localSupabaseAccessToken("sales");
  const admissionsToken = await localSupabaseAccessToken("admissions");
  const pageBody = {
    p_limit: 2,
    p_cursor_updated_at: null,
    p_cursor_id: null,
    p_connection_filter: "all",
    p_stage_filter: "all",
    p_assignment_filter: "all",
    p_owner_membership_id: null,
    p_due_filter: "all",
    p_query: leadId,
  };
  const detailBody = { p_lead_id: leadId };
  const stageEntryBody = {
    p_from_date: "2026-01-01",
    p_to_date: "2026-12-31",
    p_limit: 101,
  };

  const salesPage = await directPlatformRpc(
    "staff_sales_lead_page",
    pageBody,
    salesToken,
  );
  const salesDetail = await directPlatformRpc(
    "staff_sales_lead_detail",
    detailBody,
    salesToken,
  );
  const salesStageEntries = await directPlatformRpc(
    "staff_sales_stage_entry_cohort",
    stageEntryBody,
    salesToken,
  );
  expect(salesPage.status).toBe(200);
  expect(salesDetail.status).toBe(200);
  expect(salesStageEntries.status).toBe(200);
  expect(Array.isArray(salesStageEntries.payload)).toBe(true);
  expect(
    Array.isArray(salesPage.payload) &&
      salesPage.payload.length === 1 &&
      (salesPage.payload[0] as { lead_id?: unknown }).lead_id === leadId,
  ).toBe(true);
  expect(
    Array.isArray(salesDetail.payload) &&
      salesDetail.payload.length === 1 &&
      (salesDetail.payload[0] as { lead_id?: unknown }).lead_id === leadId,
  ).toBe(true);

  for (const accessToken of [undefined, admissionsToken]) {
    assertDeniedRpc(
      await directPlatformRpc("staff_sales_lead_page", pageBody, accessToken),
    );
    assertDeniedRpc(
      await directPlatformRpc(
        "staff_sales_lead_detail",
        detailBody,
        accessToken,
      ),
    );
    assertDeniedRpc(
      await directPlatformRpc(
        "staff_sales_stage_entry_cohort",
        stageEntryBody,
        accessToken,
      ),
    );
  }
});

test("Sales and Admin mutate one canonical workflow while anonymous and Admissions stay denied", async ({
  page,
}) => {
  test.skip(authMode !== "configured");
  const leadId = requireUuid("EVO_SUPABASE_SALES_API_LEAD_ID");
  const salesToken = await localSupabaseAccessToken("sales");
  const adminToken = await localSupabaseAccessToken("admin");
  const admissionsToken = await localSupabaseAccessToken("admissions");

  const ownerOptions = await directPlatformRpc(
    "staff_sales_owner_options",
    { p_limit: 101 },
    salesToken,
  );
  expect(ownerOptions.status).toBe(200);
  expect(Array.isArray(ownerOptions.payload)).toBe(true);
  expect(ownerOptions.payload).toHaveLength(1);
  const owner = expectObject((ownerOptions.payload as unknown[])[0]);
  expect(typeof owner.membership_id).toBe("string");
  const ownerMembershipId = requireUuidValue(owner.membership_id);

  const salesMutation = await directPlatformRpc(
    "mutate_sales_lead_workflow",
    {
      p_lead_id: leadId,
      p_expected_workflow_version: 21,
      p_request_id: "54600000-0000-4000-8000-000000000101",
      p_stage_key: "contacting",
      p_owner_membership_id: ownerMembershipId,
      p_next_action_text: "Direct API Sales follow-up",
      p_next_action_due_date: "2099-09-05",
      p_clear_next_action: false,
      p_reason: null,
    },
    salesToken,
  );
  expect(salesMutation.status).toBe(200);
  expect(expectObject(salesMutation.payload)).toMatchObject({
    lead_id: leadId,
    stage_key: "contacting",
    current_owner_membership_id: ownerMembershipId,
    next_action_text: "Direct API Sales follow-up",
    next_action_due_date: "2099-09-05",
    workflow_version: 22,
  });

  const adminMutation = await directPlatformRpc(
    "mutate_sales_lead_workflow",
    {
      p_lead_id: leadId,
      p_expected_workflow_version: 22,
      p_request_id: "54600000-0000-4000-8000-000000000102",
      p_stage_key: "qualified",
      p_owner_membership_id: ownerMembershipId,
      p_next_action_text: "Direct API Admin verification",
      p_next_action_due_date: "2099-09-06",
      p_clear_next_action: false,
      p_reason: null,
    },
    adminToken,
  );
  expect(adminMutation.status).toBe(200);
  expect(expectObject(adminMutation.payload)).toMatchObject({
    lead_id: leadId,
    stage_key: "qualified",
    current_owner_membership_id: ownerMembershipId,
    next_action_text: "Direct API Admin verification",
    next_action_due_date: "2099-09-06",
    workflow_version: 23,
  });

  const deniedMutation = {
    p_lead_id: leadId,
    p_expected_workflow_version: 23,
    p_request_id: "54600000-0000-4000-8000-000000000103",
    p_stage_key: "potential",
    p_owner_membership_id: ownerMembershipId,
    p_next_action_text: "Must never persist",
    p_next_action_due_date: "2099-09-07",
    p_clear_next_action: false,
    p_reason: null,
  };
  for (const accessToken of [undefined, admissionsToken]) {
    assertDeniedRpc(
      await directPlatformRpc(
        "staff_sales_owner_options",
        { p_limit: 101 },
        accessToken,
      ),
    );
    assertDeniedRpc(
      await directPlatformRpc(
        "mutate_sales_lead_workflow",
        deniedMutation,
        accessToken,
      ),
    );
  }

  const finalDetail = await directPlatformRpc(
    "staff_sales_lead_detail",
    { p_lead_id: leadId },
    salesToken,
  );
  expect(finalDetail.status).toBe(200);
  expect(Array.isArray(finalDetail.payload)).toBe(true);
  expect(finalDetail.payload).toHaveLength(1);
  const finalDetailRow = expectObject((finalDetail.payload as unknown[])[0]);
  expect(finalDetailRow).toMatchObject({
    lead_id: leadId,
    stage_key: "qualified",
    next_action_text: "Direct API Admin verification",
    next_action_due_date: "2099-09-06",
    workflow_version: 23,
  });

  const cohortDate = organizationDate(String(finalDetailRow.created_at));
  const stageEntries = await directPlatformRpc(
    "staff_sales_stage_entry_cohort",
    { p_from_date: cohortDate, p_to_date: cohortDate, p_limit: 101 },
    adminToken,
  );
  expect(stageEntries.status).toBe(200);
  expect(Array.isArray(stageEntries.payload)).toBe(true);
  const qualifiedEntries = (stageEntries.payload as unknown[])
    .map(expectObject)
    .filter((entry) => entry.stage_key === "qualified");
  expect(qualifiedEntries.some((entry) => entry.lead_id === leadId)).toBe(true);

  await signIn(page, "admin");
  await page.goto(
    `/v3/main?period=custom&from=${cohortDate}&to=${cohortDate}`,
  );
  const qualifiedMetric = page.locator("li").filter({
    has: page.getByText("Квалифицированы", { exact: true }),
  });
  await expect(qualifiedMetric).toHaveCount(1);
  await expect(
    qualifiedMetric.getByText(String(qualifiedEntries.length), { exact: true }),
  ).toBeVisible();
});

test("Sales and Admin persist the same canonical workflow through the real interface", async ({
  page,
}) => {
  test.skip(authMode !== "configured");
  const leadId = requireUuid("EVO_SUPABASE_SALES_WORKFLOW_LEAD_ID");
  const workflowPanel = () =>
    page.locator(
      `[data-testid="v3-pipeline-decision"][data-lead-id="${leadId}"]`,
    );
  const workflowForm = () =>
    workflowPanel().getByTestId("v3-pipeline-workflow-form");
  const openWorkflow = async () => {
    const panel = workflowPanel();
    await expect(panel).toBeVisible();
    if ((await panel.getAttribute("open")) === null) {
      await panel.locator("summary").click();
    }
    return workflowForm();
  };

  await signIn(page, "sales");
  await page.goto("/v3/pipeline");
  let form = await openWorkflow();
  await expect(form).toBeVisible();
  await expect(form.getByTestId("v3-pipeline-stage")).toHaveValue("new");
  await expect(form.locator('input[name="expected_version"]')).toHaveValue("11");
  await expect(form.getByText("Версия 11", { exact: true })).toBeVisible();
  await expect(form.getByTestId("v3-pipeline-owner")).not.toHaveValue("");

  await form.getByTestId("v3-pipeline-stage").selectOption("meeting_scheduled");
  await form
    .getByTestId("v3-pipeline-next-action")
    .fill("Browser Sales meeting follow-up");
  await form
    .getByTestId("v3-pipeline-next-action-date")
    .fill("2099-09-08");
  await form.getByTestId("v3-pipeline-submit").click();
  await expect(workflowForm()).toHaveCount(0);
  form = await openWorkflow();
  await expect(form.locator('input[name="expected_version"]')).toHaveValue("12");
  await expect(form.getByText("Версия 12", { exact: true })).toBeVisible();

  await page.reload();
  form = await openWorkflow();
  await expect(form.getByTestId("v3-pipeline-stage")).toHaveValue(
    "meeting_scheduled",
  );
  await expect(form.getByTestId("v3-pipeline-next-action")).toHaveValue(
    "Browser Sales meeting follow-up",
  );
  await expect(
    form.getByTestId("v3-pipeline-next-action-date"),
  ).toHaveValue("2099-09-08");

  await page.context().clearCookies();
  await signIn(page, "admin");
  await page.goto("/v3/pipeline");
  form = await openWorkflow();
  await expect(form.locator('input[name="expected_version"]')).toHaveValue("12");
  await form.getByTestId("v3-pipeline-stage").selectOption("qualified");
  await form
    .getByTestId("v3-pipeline-next-action")
    .fill("Browser Admin qualification review");
  await form
    .getByTestId("v3-pipeline-next-action-date")
    .fill("2099-09-09");
  await form.getByTestId("v3-pipeline-submit").click();
  await expect(workflowForm()).toHaveCount(0);
  form = await openWorkflow();
  await expect(form.locator('input[name="expected_version"]')).toHaveValue("13");
  await expect(form.getByText("Версия 13", { exact: true })).toBeVisible();

  await page.reload();
  form = await openWorkflow();
  await expect(form.getByTestId("v3-pipeline-stage")).toHaveValue(
    "qualified",
  );
  await expect(form.getByTestId("v3-pipeline-next-action")).toHaveValue(
    "Browser Admin qualification review",
  );
  await expect(
    form.getByTestId("v3-pipeline-next-action-date"),
  ).toHaveValue("2099-09-09");
});

test("real contract, payment and handoff open one Supabase Student 360 with role-safe access", async ({
  page,
}) => {
  test.skip(authMode !== "configured");
  test.setTimeout(240_000);
  const leadId = requireUuid("EVO_SUPABASE_HANDOFF_PROOF_LEAD_ID");
  const [salesToken, admissionsToken, adminToken] = await Promise.all([
    localSupabaseAccessToken("sales"),
    localSupabaseAccessToken("admissions"),
    localSupabaseAccessToken("admin"),
  ]);

  assertDeniedRpc(
    await directPlatformRpc("staff_lead_admissions_gate", {
      p_lead_id: leadId,
    }),
  );
  assertDeniedRpc(
    await directPlatformRpc("staff_lead_admissions_handoff", {
      p_lead_id: leadId,
    }),
  );

  const admissionsGate = await directPlatformRpc(
    "staff_lead_admissions_gate",
    { p_lead_id: leadId },
    admissionsToken,
  );
  expect(admissionsGate.status).toBe(200);
  expect(admissionsGate.payload).toEqual([]);

  assertDeniedRpc(
    await directPlatformRpc(
      "staff_lead_admissions_handoff",
      { p_lead_id: leadId },
      admissionsToken,
    ),
  );

  const initialGate = await directPlatformRpc(
    "staff_lead_admissions_gate",
    { p_lead_id: leadId },
    salesToken,
  );
  expect(initialGate.status).toBe(200);
  expect(initialGate.payload).toHaveLength(1);
  expect(expectObject((initialGate.payload as unknown[])[0])).toMatchObject({
    lead_id: leadId,
    contract_confirmed: false,
    first_payment_received_date: null,
    gate_state: "blocked",
  });

  await signIn(page, "sales");
  await page.goto(`/v3/profile?id=${leadId}&tab=overview`);
  await expect(page.getByTestId("v3-sales-transition")).toBeVisible();

  const contractForm = page.getByTestId("v3-gate-contract-form");
  await expect(contractForm).toBeVisible();
  await contractForm.locator('input[name="amount"]').fill("1000.00");
  await contractForm.locator('input[name="currency"]').fill("KGS");
  await contractForm.locator('input[name="due_date"]').fill("2099-09-10");
  await contractForm
    .locator('input[name="evidence_reference"]')
    .fill("local-browser-contract-547");
  await contractForm.locator('button[type="submit"]').click();

  const paymentForm = page.getByTestId("v3-gate-payment-form");
  await expect(paymentForm).toBeVisible();
  const receivedDate = new Date().toISOString().slice(0, 10);
  await paymentForm.locator('input[name="received_date"]').fill(receivedDate);
  await paymentForm
    .locator('input[name="evidence_reference"]')
    .fill("local-browser-first-payment-547");
  await paymentForm.locator('button[type="submit"]').click();

  const handoffForm = page.getByTestId("v3-sales-handoff-form");
  await expect(handoffForm).toBeVisible();
  const ownerSelect = handoffForm.locator(
    'select[name="admissions_owner_membership_id"]',
  );
  const admissionsOwnerId = await ownerSelect
    .locator("option:not([disabled])")
    .first()
    .getAttribute("value");
  expect(admissionsOwnerId).toBeTruthy();
  await ownerSelect.selectOption(admissionsOwnerId!);
  await expect(
    handoffForm.locator('input[name="handoff_mode"]'),
  ).toHaveValue("normal");
  await handoffForm
    .locator('textarea[name="reason"]')
    .fill("Local browser proof of the reviewed Sales to Admissions handoff");
  await handoffForm.locator('button[type="submit"]').click();

  const result = page.getByTestId("v3-sales-handoff-completed");
  await expect(result).toBeVisible();
  await expect(
    result.getByText("Полное дело доступно Admissions и Admin.", {
      exact: true,
    }),
  ).toBeVisible();
  const handoffSnapshot = await directPlatformRpc(
    "staff_lead_admissions_handoff",
    { p_lead_id: leadId },
    salesToken,
  );
  expect(handoffSnapshot.status).toBe(200);
  expect(handoffSnapshot.payload).toHaveLength(1);
  const studentCaseId = requireUuidValue(
    expectObject((handoffSnapshot.payload as unknown[])[0]).case_id,
  );

  await page.context().clearCookies();
  await signIn(page, "admin");
  await page.goto(`/v3/profile?id=${leadId}&tab=overview`);
  const adminHandoff = page.getByTestId("v3-sales-handoff-completed");
  await expect(adminHandoff).toBeVisible();
  const caseLink = adminHandoff.getByRole("link", { name: "Открыть дело" });
  const caseHref = `/v3/profile?case=${studentCaseId}&tab=overview`;
  await expect(caseLink).toHaveAttribute("href", caseHref);
  await caseLink.click();
  await expect(page).toHaveURL(new RegExp(
    `/v3/profile\\?case=${studentCaseId}&tab=overview$`,
  ));
  await expect(page.getByTestId("v3-profile")).toBeVisible();
  await expect(page.getByTestId("v3-profile-admissions-workspace")).toBeVisible();

  assertDeniedRpc(
    await directPlatformRpc(
      "staff_student_case_handoff_context",
      { p_student_case_id: studentCaseId },
      salesToken,
    ),
  );
  assertDeniedRpc(
    await directPlatformRpc(
      "staff_student_case_handoff_context",
      { p_student_case_id: studentCaseId },
      admissionsToken,
    ),
  );
  assertDeniedRpc(
    await directPlatformRpc("staff_student_case_handoff_context", {
      p_student_case_id: studentCaseId,
    }),
  );
  const refreshedAdmissionsToken = await localSupabaseAccessToken("admissions");
  let organizationId: string | null = null;
  for (const accessToken of [refreshedAdmissionsToken, adminToken]) {
    const context = await directPlatformRpc(
      "staff_student_case_handoff_context",
      { p_student_case_id: studentCaseId },
      accessToken,
    );
    expect(context.status).toBe(200);
    expect(context.payload).toHaveLength(1);
    const contextRow = expectObject((context.payload as unknown[])[0]);
    expect(contextRow).toMatchObject({
      lead_id: leadId,
      student_case_id: studentCaseId,
      case_state: "active",
      handoff_mode: "normal",
      handoff_state: "completed",
    });
    organizationId ??= requireUuidValue(contextRow.organization_id);
  }
  expect(organizationId).not.toBeNull();

  const p4Route = {
    targetCountry: "Isolated technical country",
    targetDegree: "Isolated technical degree",
    programDirection: "EVO P4 browser verification",
  } as const;
  const routeResult = await directPlatformRpc(
    "set_student_case_route",
    {
      p_organization_id: organizationId,
      p_student_case_id: studentCaseId,
      p_target_country: p4Route.targetCountry,
      p_target_degree: p4Route.targetDegree,
      p_program_direction: p4Route.programDirection,
      p_intake: "2099 technical intake",
      p_language_assumption: "English",
      p_funding_assumption: "Isolated technical acceptance only",
      p_route_approval_status: "draft",
      p_operational_stage: "admissions_validation",
      p_next_action: "Run isolated browser admissions proof",
      p_reason: "Initialize the real case route for P4 browser acceptance",
      p_request_id: randomUUID(),
    },
    refreshedAdmissionsToken,
  );
  expect(routeResult.status, JSON.stringify(routeResult.payload)).toBe(200);
  expect(routeResult.payload).toMatchObject({
    organization_id: organizationId,
    student_case_id: studentCaseId,
    target_country: p4Route.targetCountry,
    target_degree: p4Route.targetDegree,
    program_direction: p4Route.programDirection,
    route_approval_status: "draft",
  });

  for (const [functionName, body] of [
    ["staff_case_task_queue", { p_limit: 50 }],
    ["staff_visa_queue", { p_limit: 50 }],
    ["staff_document_queue", { p_limit: 50 }],
    [
      "staff_student_case_document_workspace",
      { p_student_case_id: studentCaseId },
    ],
  ] as const) {
    const admissionsRead = await directPlatformRpc(
      functionName,
      body,
      refreshedAdmissionsToken,
    );
    const adminRead = await directPlatformRpc(functionName, body, adminToken);
    expect(admissionsRead.status).toBe(200);
    expect(adminRead.status).toBe(200);
    assertDeniedRpc(await directPlatformRpc(functionName, body, salesToken));
    assertDeniedRpc(await directPlatformRpc(functionName, body));
  }

  const requirementResult = await directPlatformRpc(
    "create_document_requirement",
    {
      p_organization_id: organizationId,
      p_target_country: p4Route.targetCountry,
      p_target_degree: p4Route.targetDegree,
      p_program_direction: p4Route.programDirection,
      p_checklist_version: 548,
      p_requirement_key: "p4.real-storage-proof",
      p_label: "P4 real private Storage proof",
      p_instructions:
        "Upload the isolated technical PDF and verify immutable resubmission.",
      p_request_id: randomUUID(),
    },
    adminToken,
  );
  expect(
    requirementResult.status,
    JSON.stringify(requirementResult.payload),
  ).toBe(200);
  const documentRequirementId = requireUuidValue(
    expectObject(requirementResult.payload).document_requirement_id,
  );

  assertDeniedRpc(
    await directPlatformRpc(
      "create_document_slot",
      {
        p_organization_id: organizationId,
        p_student_case_id: studentCaseId,
        p_document_requirement_id: documentRequirementId,
        p_deadline: "2099-09-12T12:00:00Z",
        p_next_action: "Run isolated browser upload proof",
        p_request_id: randomUUID(),
      },
      salesToken,
    ),
  );
  const slotResult = await directPlatformRpc(
    "create_document_slot",
    {
      p_organization_id: organizationId,
      p_student_case_id: studentCaseId,
      p_document_requirement_id: documentRequirementId,
      p_deadline: "2099-09-12T12:00:00Z",
      p_next_action: "Run isolated browser upload proof",
      p_request_id: randomUUID(),
    },
    adminToken,
  );
  expect(slotResult.status, JSON.stringify(slotResult.payload)).toBe(200);
  const documentSlotId = requireUuidValue(
    expectObject(slotResult.payload).document_slot_id,
  );

  const paymentResult = await directPlatformRpc(
    "create_payment_obligation",
    {
      p_organization_id: organizationId,
      p_student_case_id: studentCaseId,
      p_label: "P4 isolated payment proof",
      p_category: "evo_service_fee",
      p_amount_minor: 2500,
      p_currency: "USD",
      p_due_at: "2099-09-12T12:00:00Z",
      p_next_action: "Verify Admissions stop and Admin release",
      p_reason: "Initialize the real obligation used by the V3 finance proof",
      p_request_id: randomUUID(),
    },
    adminToken,
  );
  expect(paymentResult.status, JSON.stringify(paymentResult.payload)).toBe(200);
  const paymentObligationId = requireUuidValue(
    expectObject(paymentResult.payload).payment_obligation_id,
  );

  await page.context().clearCookies();
  await signIn(page, "admissions");
  await page.goto("/v3/calendar?view=day&date=2099-09-12");
  await page
    .locator("details")
    .filter({ hasText: "Создать задачу" })
    .locator("summary")
    .click();
  const createTask = page.getByTestId("v3-calendar-task-create-form");
  await createTask
    .locator('select[name="student_case_id"]')
    .selectOption(studentCaseId);
  await createTask
    .locator('input[name="title"]')
    .fill("P4 isolated Admissions task proof");
  await createTask.locator('select[name="deadline_kind"]').selectOption("all_day");
  await createTask.locator('input[name="due_on"]').fill("2099-09-12");
  await createTask.locator('select[name="priority"]').selectOption("high");
  await createTask
    .locator('select[name="student_visible"]')
    .selectOption("false");
  await createTask.locator('button[type="submit"]').click();

  const createdTask = page
    .locator('button[id^="task-"]')
    .filter({ hasText: "P4 isolated Admissions task proof" });
  await expect(createdTask).toHaveCount(1);
  await expect(createdTask).toContainText("весь день");
  const caseTaskId = requireUuidValue(
    (await createdTask.getAttribute("id"))?.replace(/^task-/, ""),
  );
  await createdTask.click();
  await expect(page.getByTestId("v3-calendar-task-controls")).toBeVisible();
  await page
    .getByTestId("v3-calendar-task-done-form")
    .locator('button[type="submit"]')
    .click();
  await expect(page.locator(`#task-${caseTaskId}`)).toContainText("выполнена");

  await page.goto(`/v3/profile?case=${studentCaseId}&tab=overview`);
  await expect(page.getByTestId("v3-profile")).toBeVisible();
  await expect(page.getByTestId("v3-profile-admissions-workspace")).toBeVisible();

  const applications = page.locator("#applications");
  await applications
    .locator("details")
    .filter({ hasText: "Новая заявка" })
    .locator("summary")
    .click();
  const createApplication = applications.locator(
    'form:has(input[name="institution_name"])',
  );
  await createApplication
    .locator('input[name="institution_name"]')
    .fill("P4 isolated technical university");
  await createApplication
    .locator('input[name="program_name"]')
    .fill("P4 isolated technical program");
  await createApplication
    .locator('input[name="evidence_reference"]')
    .fill("p4://application-created");
  await createApplication.locator('button[type="submit"]').click();

  const application = applications
    .locator("article")
    .filter({ hasText: "P4 isolated technical university" });
  await expect(application).toHaveCount(1);
  await application.locator("summary").click();
  const changeApplication = application.locator(
    'form:has(input[name="application_id"])',
  );
  const universityApplicationId = requireUuidValue(
    await changeApplication.locator('input[name="application_id"]').inputValue(),
  );
  await changeApplication
    .locator('select[name="status"]')
    .selectOption("submitted");
  await changeApplication
    .locator('input[name="evidence_reference"]')
    .fill("p4://application-submitted");
  await changeApplication.locator('button[type="submit"]').click();
  await expect(
    applications.locator("article").filter({ hasText: "P4 isolated technical university" }),
  ).toContainText("p4://application-submitted");

  const visaSection = page.locator("#visa");
  const visaForm = visaSection.locator('form:has(select[name="status"])');
  await visaForm.locator('select[name="status"]').selectOption("docs");
  await visaForm
    .locator('input[name="evidence_reference"]')
    .fill("p4://visa-documents");
  await visaForm
    .locator('textarea[name="note"]')
    .fill("Isolated P4 visa transition");
  await visaForm.locator('button[type="submit"]').click();
  const visaCaseIdInput = visaSection.locator('input[name="visa_case_id"]');
  await expect(visaCaseIdInput).toHaveValue(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  const browserVisaCaseId = requireUuidValue(
    await visaCaseIdInput.inputValue(),
  );
  const persistedVisaResult = await directPlatformRpc(
    "staff_case_visa",
    { p_student_case_id: studentCaseId },
    refreshedAdmissionsToken,
  );
  expect(
    persistedVisaResult.status,
    JSON.stringify(persistedVisaResult.payload),
  ).toBe(200);
  expect(persistedVisaResult.payload).toHaveLength(1);
  const persistedVisa = expectObject(
    (persistedVisaResult.payload as unknown[])[0],
  );
  expect(persistedVisa).toMatchObject({
    visa_case_id: browserVisaCaseId,
    case_id: studentCaseId,
    visa_status: "docs",
    note: "Isolated P4 visa transition",
  });
  const visaCaseId = requireUuidValue(persistedVisa?.visa_case_id);

  await page.goto(`/v3/profile?case=${studentCaseId}&tab=money`);
  const admissionsObligation = page
    .getByTestId("v3-profile-finance-controls")
    .locator("article")
    .filter({ hasText: "P4 isolated payment proof" });
  await admissionsObligation
    .locator("details")
    .filter({ hasText: "Поставить финансовый стоп" })
    .locator("summary")
    .click();
  const assertStop = admissionsObligation.locator(
    'form:has(input[name="payment_obligation_id"])',
  );
  await assertStop
    .locator('select[name="blocked_action"]')
    .selectOption("case_progression");
  await assertStop
    .locator('input[name="reason"]')
    .fill("P4 isolated finance stop");
  await assertStop
    .locator('input[name="next_action"]')
    .fill("Admin verifies and releases the stop");
  await assertStop
    .locator('input[name="evidence_ref"]')
    .fill("p4://stop-asserted");
  await assertStop.locator('button[type="submit"]').click();
  await expect(
    page
      .getByTestId("v3-profile-finance-controls")
      .locator("article")
      .filter({ hasText: "P4 isolated payment proof" }),
  ).toContainText("P4 isolated finance stop");
  await expect(
    page
      .getByTestId("v3-profile-finance-controls")
      .locator('form:has(input[name="stop_factor_id"])'),
  ).toHaveCount(0);

  const firstPdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n",
    "utf8",
  );
  const secondPdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Version/1.7>>endobj\n%%EOF\n",
    "utf8",
  );
  const unreservedObject = `unreserved/${randomUUID()}.pdf`;
  expectStorageDenied(
    (
      await directStorageRequest(
        `object/platform-documents/${unreservedObject}`,
        refreshedAdmissionsToken,
        {
          method: "POST",
          contentType: "application/pdf",
          body: firstPdf,
          upsert: true,
        },
      )
    ).status,
  );
  const directBucketList = await directStorageRequest(
    "object/list/platform-documents",
    refreshedAdmissionsToken,
    {
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ prefix: "", limit: 100, offset: 0 }),
    },
  );
  expect(directBucketList.status).toBe(200);
  expect(directBucketList.payload).toEqual([]);

  await page.goto(`/v3/profile?case=${studentCaseId}&tab=documents`);
  const documentItem = page
    .getByTestId("v3-document-item")
    .filter({ hasText: "P4 real private Storage proof" });
  await expect(documentItem).toHaveAttribute("data-document-presence", "absent");
  const firstUpload = documentItem.getByTestId("v3-document-upload-form");
  await firstUpload.locator('input[name="file"]').setInputFiles({
    name: "p4-isolated-proof-v1.pdf",
    mimeType: "application/pdf",
    buffer: firstPdf,
  });
  await submitDocumentUpload(page);
  await expect(documentItem).toHaveAttribute("data-document-presence", "present");
  await expect(documentItem).toContainText("p4-isolated-proof-v1.pdf");
  await expect(documentItem).toContainText("версия 1");
  const firstVersionHref = await documentItem
    .getByTestId("v3-document-download")
    .getAttribute("href");
  const firstDocumentVersionId = requireUuidValue(
    firstVersionHref?.split("/")[4],
  );
  const firstDownloadPromise = page.waitForEvent("download");
  await documentItem.getByTestId("v3-document-download").click();
  expect(await readDownload(await firstDownloadPromise)).toEqual(firstPdf);

  const secondUpload = documentItem.getByTestId("v3-document-upload-form");
  await secondUpload.locator('input[name="file"]').setInputFiles({
    name: "p4-isolated-proof-v2.pdf",
    mimeType: "application/pdf",
    buffer: secondPdf,
  });
  await submitDocumentUpload(page);
  await expect(documentItem).toContainText("p4-isolated-proof-v2.pdf");
  await expect(documentItem).toContainText("версия 2");
  const secondVersionHref = await documentItem
    .getByTestId("v3-document-download")
    .getAttribute("href");
  const secondDocumentVersionId = requireUuidValue(
    secondVersionHref?.split("/")[4],
  );
  expect(secondDocumentVersionId).not.toBe(firstDocumentVersionId);
  const secondDownloadPromise = page.waitForEvent("download");
  await documentItem.getByTestId("v3-document-download").click();
  expect(await readDownload(await secondDownloadPromise)).toEqual(secondPdf);
  const immutableFirstDownload = await page.request.get(firstVersionHref!);
  expect(immutableFirstDownload.status()).toBe(200);
  expect(await immutableFirstDownload.body()).toEqual(firstPdf);

  const createChecklistItem = page.getByTestId("v3-document-checklist-create");
  await createChecklistItem.locator('input[name="label"]').fill("P4 custom bank statement");
  await createChecklistItem.locator('input[name="group_label"]').fill("P4 finance documents");
  await createChecklistItem.locator('button[type="submit"]').click();
  const customDocumentItem = page
    .getByTestId("v3-document-item")
    .filter({ hasText: "P4 custom bank statement" });
  await expect(customDocumentItem).toHaveAttribute("data-document-intent", "custom");
  await expect(customDocumentItem).toHaveAttribute("data-document-presence", "absent");

  const customUpload = customDocumentItem.getByTestId("v3-document-upload-form");
  await customUpload.locator('input[name="file"]').setInputFiles({
    name: "p4-custom-bank-statement.pdf",
    mimeType: "application/pdf",
    buffer: firstPdf,
  });
  await submitDocumentUpload(page, customDocumentItem);
  await expect(customDocumentItem).toHaveAttribute("data-document-presence", "present");
  const customVersionHref = await customDocumentItem
    .getByTestId("v3-document-download")
    .getAttribute("href");
  requireUuidValue(customVersionHref?.split("/")[4]);

  await customDocumentItem.locator("summary").click();
  const editChecklistItem = customDocumentItem.getByTestId("v3-document-checklist-edit");
  await editChecklistItem.locator('input[name="label"]').fill("P4 renamed bank statement");
  await editChecklistItem.locator('input[name="group_label"]').fill("P4 renamed group");
  await editChecklistItem.locator('button[type="submit"]').click();
  const renamedDocumentItem = page
    .getByTestId("v3-document-item")
    .filter({ hasText: "P4 renamed bank statement" });
  await expect(renamedDocumentItem).toBeVisible();
  await expect(page.getByText("P4 renamed group", { exact: true })).toBeVisible();

  await renamedDocumentItem.locator("summary").click();
  await renamedDocumentItem
    .getByTestId("v3-document-checklist-remove")
    .locator('button[type="submit"]')
    .click();
  await expect(renamedDocumentItem).toHaveCount(0);
  const removedHistory = page.getByTestId("v3-removed-document-history");
  await expect(removedHistory).toBeVisible();
  const removedDocumentItem = removedHistory
    .getByTestId("v3-removed-document-item")
    .filter({ hasText: "P4 renamed bank statement" });
  await expect(removedDocumentItem).toContainText(
    "Удаление пункта из активного чек-листа сотрудником",
  );
  await expect(removedDocumentItem.getByTestId("v3-document-upload-form")).toHaveCount(0);
  await expect(removedDocumentItem.getByTestId("v3-document-checklist-edit")).toHaveCount(0);
  await expect(removedDocumentItem.getByTestId("v3-document-checklist-remove")).toHaveCount(0);
  const removedVersionDownload = removedDocumentItem.getByTestId(
    "v3-removed-document-download",
  );
  await expect(removedVersionDownload).toHaveAttribute("href", customVersionHref!);
  const removedDownloadPromise = page.waitForEvent("download");
  await removedVersionDownload.click();
  expect(await readDownload(await removedDownloadPromise)).toEqual(firstPdf);

  await page.context().clearCookies();
  await signIn(page, "sales");
  await page.goto(`/v3/profile?case=${studentCaseId}&tab=documents`);
  await expect(page.getByTestId("v3-profile")).toHaveCount(0);
  await expect(
    page.getByText(
      "Такого человека в базе нет. Показывать вместо него другого мы не будем.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByTestId("v3-document-upload-form")).toHaveCount(0);
  const deniedUpload = await page.request.post(
    `/api/v2/document-slots/${documentSlotId}/versions`,
    {
      multipart: {
        request_id: randomUUID(),
        file: {
          name: "p4-sales-denied.pdf",
          mimeType: "application/pdf",
          buffer: firstPdf,
        },
      },
      maxRedirects: 0,
    },
  );
  expect(deniedUpload.status()).toBe(403);
  expectStorageDenied(
    (
      await directStorageRequest(
        `object/platform-documents/sales-unreserved/${randomUUID()}.pdf`,
        salesToken,
        {
          method: "POST",
          contentType: "application/pdf",
          body: firstPdf,
          upsert: true,
        },
      )
    ).status,
  );

  await page.context().clearCookies();
  await signIn(page, "admin");
  await page.goto(`/v3/profile?id=${leadId}&tab=overview`);
  await expect(
    page
      .getByTestId("v3-sales-handoff-completed")
      .locator(`a[href="/v3/profile?case=${studentCaseId}&tab=overview"]`),
  ).toBeVisible();
  await page.goto(`/v3/profile?case=${studentCaseId}&tab=documents`);
  const adminDocumentItem = page
    .getByTestId("v3-document-item")
    .filter({ hasText: "P4 real private Storage proof" });
  await expect(adminDocumentItem).toContainText("p4-isolated-proof-v2.pdf");
  await expect(adminDocumentItem).toContainText("версия 2");

  await page.goto(`/v3/profile?case=${studentCaseId}&tab=money`);
  const adminObligation = page
    .getByTestId("v3-profile-finance-controls")
    .locator("article")
    .filter({ hasText: "P4 isolated payment proof" });
  const resolveStop = adminObligation.locator(
    'form:has(input[name="stop_factor_id"])',
  );
  await expect(resolveStop).toBeVisible();
  const stopFactorId = requireUuidValue(
    await resolveStop
      .locator('input[name="stop_factor_id"]')
      .getAttribute("value"),
  );
  await resolveStop
    .locator('input[name="reason"]')
    .fill("Admin completed isolated stop review");
  await resolveStop
    .locator('input[name="evidence_ref"]')
    .fill("p4://stop-released");
  await resolveStop.locator('button[type="submit"]').click();
  await expect(
    page
      .getByTestId("v3-profile-finance-controls")
      .locator("article")
      .filter({ hasText: "P4 isolated payment proof" })
      .locator('form:has(input[name="stop_factor_id"])'),
  ).toHaveCount(0);
  await expect(
    page
      .getByTestId("v3-profile-finance-controls")
      .locator("article")
      .filter({ hasText: "P4 isolated payment proof" }),
  ).toContainText("без стопа");

  writeP4AcceptanceResult({
    organizationId,
    studentCaseId,
    caseTaskId,
    universityApplicationId,
    visaCaseId,
    paymentObligationId,
    stopFactorId,
    documentSlotId,
    firstDocumentVersionId,
    secondDocumentVersionId,
  });
});

test("Admissions manages one real private company file through V3", async ({
  page,
}) => {
  test.skip(authMode !== "configured");
  const suffix = randomUUID().slice(0, 8);
  const folderName = `E2E company ${suffix}`;
  const destinationFolderName = `E2E destination ${suffix}`;
  const fileName = `E2E proof ${suffix}`;
  const renamedFileName = `${fileName} renamed`;
  const fileBytes = Buffer.from(`EVO private company file ${suffix}\n`, "utf8");
  const replacementBytes = Buffer.from(
    `EVO private company file ${suffix} replacement\n`,
    "utf8",
  );

  await signIn(page, "admissions");
  await page.goto("/v3/knowledge");

  const folderLinks = page.getByTestId("v3-knowledge-folder-link");
  await folderLinks.filter({ hasText: "Компания" }).first().click();
  await page.getByText("Новая папка", { exact: true }).click();
  const createFolder = page.getByTestId("v3-company-create-folder-form");
  await createFolder.getByTestId("v3-company-folder-name").fill(folderName);
  await createFolder.locator('button[type="submit"]').click();

  const createdFolderLink = folderLinks.filter({ hasText: folderName });
  await expect(createdFolderLink).toBeVisible();
  const refreshedCreateFolder = page.getByTestId("v3-company-create-folder-form");
  await refreshedCreateFolder
    .getByTestId("v3-company-folder-name")
    .fill(destinationFolderName);
  await refreshedCreateFolder.locator('button[type="submit"]').click();
  const destinationFolderLink = folderLinks.filter({
    hasText: destinationFolderName,
  });
  await expect(destinationFolderLink).toBeVisible();
  await createdFolderLink.click();
  await page.getByText("Новый файл", { exact: true }).click();
  const createFile = page.getByTestId("v3-company-create-file-form");
  await createFile.getByTestId("v3-company-file-name").fill(fileName);
  await createFile.locator('button[type="submit"]').click();

  let fileRow = page.getByTestId("v3-company-file-row").filter({ hasText: fileName });
  await expect(fileRow).toBeVisible();
  await fileRow.getByText("Действия", { exact: true }).click();
  const upload = fileRow.getByTestId("v3-company-file-upload-form");
  await upload.getByTestId("v3-company-file-input").setInputFiles({
    name: `${fileName}.txt`,
    mimeType: "text/plain",
    buffer: fileBytes,
  });
  const firstUploadResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/versions")
    && response.status() === 201
  );
  await upload.getByRole("button", { name: "Сохранить", exact: true }).click();
  const firstUploadResponse = await firstUploadResponsePromise;
  const firstUploadPayload = await firstUploadResponse.json() as {
    companyFile?: { companyFileVersionId?: unknown };
  };
  const firstCompanyFileVersionId = requireUuidValue(
    firstUploadPayload.companyFile?.companyFileVersionId,
  );

  fileRow = page.getByTestId("v3-company-file-row").filter({ hasText: fileName });
  const downloadLink = fileRow.getByRole("link", { name: fileName, exact: true });
  await expect(downloadLink).toHaveAttribute(
    "href",
    `/api/v3/company-file-versions/${firstCompanyFileVersionId}/download`,
  );
  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  expect(await readDownload(await downloadPromise)).toEqual(fileBytes);

  await fileRow.getByText("Действия", { exact: true }).click();
  const replacementUpload = fileRow.getByTestId("v3-company-file-upload-form");
  await replacementUpload.getByTestId("v3-company-file-input").setInputFiles({
    name: `${fileName}-replacement.txt`,
    mimeType: "text/plain",
    buffer: replacementBytes,
  });
  const replacementUploadResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/versions")
    && response.status() === 201
  );
  await replacementUpload
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
  const replacementUploadResponse = await replacementUploadResponsePromise;
  const replacementUploadPayload = await replacementUploadResponse.json() as {
    companyFile?: { companyFileVersionId?: unknown };
  };
  const replacementCompanyFileVersionId = requireUuidValue(
    replacementUploadPayload.companyFile?.companyFileVersionId,
  );

  fileRow = page.getByTestId("v3-company-file-row").filter({ hasText: fileName });
  const replacementDownloadLink = fileRow.getByRole("link", {
    name: fileName,
    exact: true,
  });
  await expect(replacementDownloadLink).toHaveAttribute(
    "href",
    `/api/v3/company-file-versions/${replacementCompanyFileVersionId}/download`,
  );
  const replacementDownload = page.waitForEvent("download");
  await replacementDownloadLink.click();
  expect(await readDownload(await replacementDownload)).toEqual(replacementBytes);

  await fileRow.getByText("Действия", { exact: true }).click();
  const renameForm = fileRow.locator('form:has(input[name="display_name"])');
  await renameForm.locator('input[name="display_name"]').fill(renamedFileName);
  await renameForm.getByRole("button", { name: "Переименовать", exact: true }).click();

  const renamedRow = page
    .getByTestId("v3-company-file-row")
    .filter({ hasText: renamedFileName });
  await expect(renamedRow).toBeVisible();
  await renamedRow.getByText("Действия", { exact: true }).click();
  const moveFileForm = renamedRow.locator('form:has(select[name="folder_id"])');
  await moveFileForm
    .locator('select[name="folder_id"]')
    .selectOption({ label: destinationFolderName });
  await moveFileForm
    .getByRole("button", { name: "Переместить", exact: true })
    .click();
  await expect(renamedRow).toHaveCount(0);

  await page.reload();
  await folderLinks.filter({ hasText: destinationFolderName }).click();
  const movedFileRow = page
    .getByTestId("v3-company-file-row")
    .filter({ hasText: renamedFileName });
  await expect(movedFileRow).toBeVisible();
  await expect(
    movedFileRow.getByRole("link", { name: renamedFileName, exact: true }),
  ).toHaveAttribute(
    "href",
    `/api/v3/company-file-versions/${replacementCompanyFileVersionId}/download`,
  );
  await movedFileRow.getByText("Действия", { exact: true }).click();
  await movedFileRow
    .getByRole("button", { name: "Удалить файл", exact: true })
    .click();
  await expect(movedFileRow).toHaveCount(0);

  await folderLinks.filter({ hasText: folderName }).click();
  let folderControls = page.getByTestId("v3-company-folder-controls");
  await folderControls.getByText("Управление папкой", { exact: true }).click();
  const moveFolderForm = folderControls.locator(
    'form:has(select[name="new_parent_folder_id"])',
  );
  await moveFolderForm
    .locator('select[name="new_parent_folder_id"]')
    .selectOption({ label: destinationFolderName });
  await moveFolderForm
    .getByRole("button", { name: "Переместить", exact: true })
    .click();
  await expect(page.getByRole("navigation", { name: "Путь к папке" }))
    .toContainText(destinationFolderName);

  await page.reload();
  await folderLinks.filter({ hasText: folderName }).click();
  await expect(page.getByRole("navigation", { name: "Путь к папке" }))
    .toContainText(destinationFolderName);

  folderControls = page.getByTestId("v3-company-folder-controls");
  await folderControls.getByText("Управление папкой", { exact: true }).click();
  await folderControls
    .getByRole("button", { name: "Удалить пустую папку", exact: true })
    .click();
  await expect(folderLinks.filter({ hasText: folderName })).toHaveCount(0);

  await folderLinks.filter({ hasText: destinationFolderName }).click();
  const destinationFolderControls = page.getByTestId(
    "v3-company-folder-controls",
  );
  await destinationFolderControls
    .getByText("Управление папкой", { exact: true })
    .click();
  await destinationFolderControls
    .getByRole("button", { name: "Удалить пустую папку", exact: true })
    .click();
  await expect(folderLinks.filter({ hasText: destinationFolderName }))
    .toHaveCount(0);
});

test("Admin preview changes only the effective interface, not Supabase authority", async ({
  page,
}) => {
  test.skip(authMode !== "configured");
  const leadId = requireUuid("EVO_SUPABASE_SALES_PROOF_LEAD_ID");
  const clientId = requireUuid("EVO_SUPABASE_SALES_PROOF_CLIENT_ID");

  await signIn(page, "admin");
  await expectActiveRole(page, "admin");
  await expectExactSupabaseSalesRead(page, leadId, clientId);
  await page.goto("/settings");
  await expect(page.getByTestId("fixed-role-settings")).toBeVisible();
  await page.goto("/");

  await page.getByTestId("preview-role-sales").click();
  await expectActiveRole(page, "sales", "admin");
  await expect(page.getByTestId("preview-active")).toBeVisible();
  await expectExactSupabaseSalesRead(page, leadId, clientId);
  await expectDirectRouteAllowed(page, "/clients");
  await expectDirectRouteAllowed(page, "/settings");
  await expect(page.getByTestId("fixed-role-settings")).toBeVisible();

  await expectDashboardQueues(page, ["sales", "whatsapp"]);

  await page.goto("/");
  await page.getByTestId("preview-role-admissions").click();
  await expectActiveRole(page, "admissions", "admin");
  await expectDirectRouteAllowed(page, "/settings");
  await expect(page.getByTestId("fixed-role-settings")).toBeVisible();
  await page.goto(`/v3/profile?id=${leadId}`);
  await expect(page.getByTestId("v3-profile")).toHaveCount(0);
  await expect(
    page.getByText(
      "Такого человека в базе нет. Показывать вместо него другого мы не будем.",
    ),
  ).toBeVisible();
  await expectDashboardQueues(page, [
    "clients",
    "tasks",
    "finance",
    "whatsapp",
  ]);

  await page.goto("/");
  await page.getByTestId("preview-role-admin").click();
  await expectActiveRole(page, "admin", "admin");
  await expectDashboardQueues(page, [
    "sales",
    "clients",
    "tasks",
    "finance",
    "whatsapp",
  ]);
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

  const documentResponse = await page.request.post(
    "/api/v2/document-slots/54600000-0000-4000-8000-000000000099/versions",
    {
      multipart: {
        request_id: randomUUID(),
        file: {
          name: "must-not-fall-back.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.4\n%%EOF\n", "utf8"),
        },
      },
      maxRedirects: 0,
    },
  );
  expect(documentResponse.status()).toBe(503);
  expect(await documentResponse.json()).toEqual({
    error: "auth_unavailable",
  });
});
