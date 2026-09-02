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
    throw new Error(`local Supabase password grant failed with ${response.status}`);
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
    | "staff_sales_owner_options"
    | "mutate_sales_lead_workflow"
    | "staff_lead_admissions_gate"
    | "mutate_lead_admissions_gate"
    | "staff_lead_admissions_handoff"
    | "handoff_lead_to_admissions"
    | "staff_student_case_handoff_context",
  body: Readonly<Record<string, unknown>>,
  accessToken?: string,
): Promise<Readonly<{ status: number; payload: unknown }>> {
  const { apiOrigin, publishableKey } = localSupabaseApiConfig();
  const response = await fetch(
    `${apiOrigin}/rest/v1/rpc/${functionName}`,
    {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Content-Profile": "platform",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    },
  );
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Status is still authoritative; never echo a provider body or token.
  }
  return { status: response.status, payload };
}

function assertDeniedRpc(result: Readonly<{ status: number; payload: unknown }>) {
  expect([401, 403]).toContain(result.status);
  expect(Array.isArray(result.payload) && result.payload.length > 0).toBe(false);
}

function expectObject(value: unknown): Record<string, unknown> {
  expect(value !== null && typeof value === "object" && !Array.isArray(value)).toBe(
    true,
  );
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

async function expectExactSupabaseSalesRead(
  page: Page,
  leadId: string,
  clientId: string,
) {
  await page.goto(`/sales?q=${encodeURIComponent(leadId)}`);
  await expect(page.getByTestId("platform-sales-page")).toBeVisible();
  await expect(page.getByTestId("canonical-records-unavailable")).toHaveCount(0);

  const rows = page.getByTestId("canonical-lead-row");
  await expect(rows).toHaveCount(1);
  const exactRow = page.locator(
    `[data-testid="canonical-lead-row"][data-lead-id="${leadId}"]`,
  );
  await expect(exactRow).toBeVisible();
  await expect(exactRow).toHaveAttribute("data-workflow-version", "7");
  await expect(exactRow).toContainText(clientId);

  await exactRow.locator(`a[href="/sales/${leadId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/sales/${leadId}$`));
  await expect(page.getByTestId("canonical-sales-lead-workspace")).toBeVisible();
  await expect(page.getByTestId("canonical-lead-id").locator("dd")).toHaveText(
    leadId,
  );
  await expect(page.getByTestId("canonical-client-id").locator("dd")).toHaveText(
    clientId,
  );
  await expect(
    page.getByTestId("canonical-lead-workflow-version").locator("dd"),
  ).toHaveText("7");
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
  await page.goto(`/sales/${leadId}`);
  await expect(page).toHaveURL(/\/access-denied\?from=%2Fsales$/);
  await expect(page.getByTestId("canonical-lead-detail")).toHaveCount(0);
});

test("Sales detail renders only the exact verified conversation and its link opens", async ({
  page,
}) => {
  test.skip(authMode !== "configured");
  const leadId = requireUuid("EVO_SUPABASE_SALES_CONVERSATION_LEAD_ID");
  const conversationId = requireUuid("EVO_SUPABASE_SALES_CONVERSATION_ID");

  await signIn(page, "sales");
  await page.goto(`/sales/${leadId}`);
  await expect(page.getByTestId("canonical-sales-conversations")).toBeVisible();
  const links = page.getByTestId("canonical-sales-conversation-link");
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute(
    "href",
    `/sales/${leadId}/conversations/${conversationId}`,
  );
  await expect(page.getByText("Negative proof:", { exact: false })).toHaveCount(
    0,
  );

  await links.click();
  await expect(page).toHaveURL(
    new RegExp(`/sales/${leadId}/conversations/${conversationId}$`),
  );
  await expect(page.getByTestId("canonical-sales-transcript")).toBeVisible();
  await expect(page.getByTestId("canonical-records-unavailable")).toHaveCount(0);
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
  expect(salesPage.status).toBe(200);
  expect(salesDetail.status).toBe(200);
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
      await directPlatformRpc("staff_sales_lead_detail", detailBody, accessToken),
    );
  }
});

test("Sales and Admin mutate one canonical workflow while anonymous and Admissions stay denied", async () => {
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
  expect(expectObject((finalDetail.payload as unknown[])[0])).toMatchObject({
    lead_id: leadId,
    stage_key: "qualified",
    next_action_text: "Direct API Admin verification",
    next_action_due_date: "2099-09-06",
    workflow_version: 23,
  });
});

test("Sales and Admin persist the same canonical workflow through the real interface", async ({
  page,
}) => {
  test.skip(authMode !== "configured");
  const leadId = requireUuid("EVO_SUPABASE_SALES_WORKFLOW_LEAD_ID");

  await signIn(page, "sales");
  await page.goto(`/sales/${leadId}`);
  await expect(page.getByTestId("platform-sales-workflow-form")).toBeVisible();
  await expect(
    page.getByTestId("canonical-lead-stage").locator("dd"),
  ).toHaveText(/new/i);
  await expect(
    page.getByTestId("canonical-lead-workflow-version").locator("dd"),
  ).toHaveText("11");
  await expect(page.getByTestId("platform-sales-owner")).not.toHaveValue("");

  await page
    .getByTestId("platform-sales-stage")
    .selectOption("meeting_scheduled");
  await page
    .getByTestId("platform-sales-next-action-text")
    .fill("Browser Sales meeting follow-up");
  await page
    .getByTestId("platform-sales-next-action-due-date")
    .fill("2099-09-08");
  await page.getByTestId("platform-sales-submit").click();
  await expect(page.getByTestId("platform-sales-action-status")).toHaveAttribute(
    "data-status",
    "saved",
  );
  await expect(
    page.getByTestId("canonical-lead-stage").locator("dd"),
  ).toHaveText(/meeting scheduled/i);
  await expect(
    page.getByTestId("canonical-lead-workflow-version").locator("dd"),
  ).toHaveText("12");

  await page.reload();
  await expect(page.getByTestId("platform-sales-stage")).toHaveValue(
    "meeting_scheduled",
  );
  await expect(page.getByTestId("platform-sales-next-action-text")).toHaveValue(
    "Browser Sales meeting follow-up",
  );
  await expect(
    page.getByTestId("platform-sales-next-action-due-date"),
  ).toHaveValue("2099-09-08");

  await page.context().clearCookies();
  await signIn(page, "admin");
  await page.goto(`/sales/${leadId}`);
  await expect(
    page.getByTestId("canonical-lead-workflow-version").locator("dd"),
  ).toHaveText("12");
  await page.getByTestId("platform-sales-stage").selectOption("qualified");
  await page
    .getByTestId("platform-sales-next-action-text")
    .fill("Browser Admin qualification review");
  await page
    .getByTestId("platform-sales-next-action-due-date")
    .fill("2099-09-09");
  await page.getByTestId("platform-sales-submit").click();
  await expect(page.getByTestId("platform-sales-action-status")).toHaveAttribute(
    "data-status",
    "saved",
  );
  await expect(
    page.getByTestId("canonical-lead-stage").locator("dd"),
  ).toHaveText(/qualified/i);
  await expect(
    page.getByTestId("canonical-lead-workflow-version").locator("dd"),
  ).toHaveText("13");

  await page.reload();
  await expect(page.getByTestId("platform-sales-stage")).toHaveValue("qualified");
  await expect(page.getByTestId("platform-sales-next-action-text")).toHaveValue(
    "Browser Admin qualification review",
  );
  await expect(
    page.getByTestId("platform-sales-next-action-due-date"),
  ).toHaveValue("2099-09-09");
});

test("real contract, payment and handoff open one Supabase Student 360 with role-safe access", async ({
  page,
}) => {
  test.skip(authMode !== "configured");
  const leadId = requireUuid("EVO_SUPABASE_HANDOFF_PROOF_LEAD_ID");
  const clientId = requireUuid("EVO_SUPABASE_HANDOFF_PROOF_CLIENT_ID");
  const [salesToken, admissionsToken, adminToken] = await Promise.all([
    localSupabaseAccessToken("sales"),
    localSupabaseAccessToken("admissions"),
    localSupabaseAccessToken("admin"),
  ]);

  assertDeniedRpc(
    await directPlatformRpc("staff_lead_admissions_gate", { p_lead_id: leadId }),
  );
  assertDeniedRpc(
    await directPlatformRpc("staff_lead_admissions_handoff", { p_lead_id: leadId }),
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
  await page.goto(`/sales/${leadId}`);
  await expect(page.getByTestId("canonical-client-id").locator("dd")).toHaveText(
    clientId,
  );

  const contractForm = page.getByTestId("platform-gate-contract-form");
  await expect(contractForm).toBeVisible();
  await contractForm.locator('input[name="amount"]').fill("1000.00");
  await contractForm.locator('input[name="currency"]').fill("KGS");
  await contractForm.locator('input[name="due_date"]').fill("2099-09-10");
  await contractForm
    .locator('input[name="evidence_reference"]')
    .fill("local-browser-contract-547");
  await contractForm.locator('button[type="submit"]').click();

  const paymentForm = page.getByTestId("platform-gate-payment-form");
  await expect(paymentForm).toBeVisible();
  const receivedDate = new Date().toISOString().slice(0, 10);
  await paymentForm.locator('input[name="received_date"]').fill(receivedDate);
  await paymentForm
    .locator('input[name="evidence_reference"]')
    .fill("local-browser-first-payment-547");
  await paymentForm.locator('button[type="submit"]').click();

  const handoffForm = page.getByTestId("platform-handoff-form");
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
  await handoffForm.locator('select[name="handoff_mode"]').selectOption("normal");
  await handoffForm
    .locator('textarea[name="reason"]')
    .fill("Local browser proof of the reviewed Sales to Admissions handoff");
  await handoffForm.locator('button[type="submit"]').click();

  const result = page.getByTestId("platform-handoff-result");
  await expect(result).toBeVisible();
  await expect(result.locator('a[href^="/clients/"]')).toHaveCount(0);
  const studentCaseId = requireUuidValue(
    (await result.locator("dd").first().textContent())?.trim() ?? null,
  );

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
    await directPlatformRpc(
      "staff_student_case_handoff_context",
      { p_student_case_id: studentCaseId },
    ),
  );
  const refreshedAdmissionsToken = await localSupabaseAccessToken("admissions");
  for (const accessToken of [refreshedAdmissionsToken, adminToken]) {
    const context = await directPlatformRpc(
      "staff_student_case_handoff_context",
      { p_student_case_id: studentCaseId },
      accessToken,
    );
    expect(context.status).toBe(200);
    expect(context.payload).toHaveLength(1);
    expect(expectObject((context.payload as unknown[])[0])).toMatchObject({
      lead_id: leadId,
      student_case_id: studentCaseId,
      case_state: "active",
      handoff_mode: "normal",
      handoff_state: "completed",
    });
  }

  await page.context().clearCookies();
  await signIn(page, "admissions");
  await page.goto(`/clients/${studentCaseId}`);
  await expect(page.getByTestId("platform-student-case-workspace")).toBeVisible();
  await expect(page.getByTestId("platform-student-handoff-context")).toBeVisible();
  await expect(page.getByTestId("platform-student-profile")).toHaveAttribute(
    "data-status",
    "not-created",
  );

  await page.context().clearCookies();
  await signIn(page, "admin");
  await page.goto(`/sales/${leadId}`);
  await expect(
    page.getByTestId("platform-handoff-result").locator(`a[href="/clients/${studentCaseId}"]`),
  ).toBeVisible();
  await page.goto(`/clients/${studentCaseId}`);
  await expect(page.getByTestId("platform-student-case-workspace")).toBeVisible();
  await expect(page.getByTestId("platform-student-handoff-context")).toContainText(
    studentCaseId,
  );
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
  await expectExactSupabaseSalesRead(page, leadId, clientId);

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
