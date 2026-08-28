import { expect, test, type Page } from "@playwright/test";

const mode = process.env.EVO_EXPECT_CANONICAL_READ_MODE ?? "configured";
const unavailableProbeLeadId = "00000000-0000-4000-8000-000000000429";

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

type TestRole = "admin" | "sales" | "admissions";

function credentials(role: TestRole) {
  const prefix = `EVO_DEV_GATE_${role.toUpperCase()}`;
  const identifier = process.env[`${prefix}_IDENTIFIER`];
  const secret = process.env[`${prefix}_SECRET`];
  if (!identifier || !secret) {
    throw new Error(`missing browser credential for ${role}`);
  }
  return { identifier, secret };
}

async function submitGate(page: Page, role: TestRole) {
  const { identifier, secret } = credentials(role);
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("#gate-identifier").fill(identifier);
  await page.locator("#gate-secret").fill(secret);
  await page.getByRole("button", { name: "Открыть CRM" }).click();
  await expect(page.getByTestId("development-workspace")).toBeVisible();
  await page.getByTestId("open-role-workspace").click();
}

test("missing PostgreSQL authority fails closed without a read fallback", async ({
  page,
}) => {
  test.skip(mode !== "unavailable", "only exercised in unavailable mode");

  await submitGate(page, "admissions");
  await expect(page).toHaveURL(/\/clients(?:\?|$)/);
  await expect(page.getByTestId("canonical-records-unavailable")).toBeVisible();
  await expect(page.getByTestId("canonical-student-cases-page")).toHaveCount(0);

  await submitGate(page, "sales");
  await expect(page).toHaveURL(/\/sales(?:\?|$)/);
  await expect(page.getByTestId("canonical-records-unavailable")).toBeVisible();
  await expect(page.getByTestId("canonical-sales-page")).toBeVisible();
  await page.goto(`/sales/${unavailableProbeLeadId}`);
  await expect(page.getByTestId("canonical-records-unavailable")).toBeVisible();
  await expect(page.getByTestId("canonical-lead-detail")).toHaveCount(0);
});

test("Admissions reads the real canonical Student Case queue", async ({ page }) => {
  test.skip(mode !== "configured", "only exercised in configured mode");
  const studentCaseId = requireUuid("EVO_CANONICAL_STUDENT_CASE_ID");

  await submitGate(page, "admissions");
  await expect(page).toHaveURL(/\/clients(?:\?|$)/);
  await expect(page.getByTestId("canonical-student-cases-page")).toBeVisible();
  await expect(
    page.locator(
      `[data-testid="canonical-student-case-row"][data-student-case-id="${studentCaseId}"]`,
    ),
  ).toBeVisible();

  await page.goto(`/clients?q=${encodeURIComponent(studentCaseId)}`);
  await expect(
    page.locator(
      `[data-testid="canonical-student-case-row"][data-student-case-id="${studentCaseId}"]`,
    ),
  ).toBeVisible();
});

test("Sales reads and updates the real canonical PostgreSQL workflow", async ({
  page,
}) => {
  test.skip(mode !== "configured", "only exercised in configured mode");
  const leadId = requireUuid("EVO_CANONICAL_LEAD_ID");

  await submitGate(page, "sales");
  await expect(page).toHaveURL(/\/sales(?:\?|$)/);
  await expect(page.getByTestId("canonical-sales-page")).toBeVisible();
  const row = page.locator(
    `[data-testid="canonical-lead-row"][data-lead-id="${leadId}"]`,
  );
  await expect(row).toBeVisible();

  await page.goto(`/sales?q=${encodeURIComponent(leadId)}`);
  await expect(
    page.locator(
      `[data-testid="canonical-lead-row"][data-lead-id="${leadId}"]`,
    ),
  ).toBeVisible();

  await page.goto(`/sales/${leadId}`);
  const detail = page.getByTestId("canonical-lead-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText(leadId);

  const form = page.getByTestId("canonical-sales-workflow-form");
  await expect(form).toBeVisible();
  await form.locator('select[name="stage"]').selectOption("qualified");
  await form
    .locator('textarea[name="qualification_summary"]')
    .fill("Browser-proven qualification summary");
  await form
    .locator('input[name="next_action"]')
    .fill("Browser-proven follow-up call");
  await form.locator('input[name="next_action_at"]').fill("2026-09-15");
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(
    page.getByTestId("canonical-sales-workflow-saved"),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("canonical-lead-detail")).toContainText(
    "Browser-proven qualification summary",
  );
  await expect(
    page.locator('input[name="next_action"]'),
  ).toHaveValue("Browser-proven follow-up call");
});

test("Admin sees the Sales union while Admissions stays server-denied", async ({
  page,
}) => {
  test.skip(mode !== "configured", "only exercised in configured mode");
  const leadId = requireUuid("EVO_CANONICAL_LEAD_ID");

  await submitGate(page, "admin");
  await page.goto(`/sales/${leadId}`);
  await expect(page.getByTestId("canonical-lead-detail")).toBeVisible();
  await expect(page.getByTestId("canonical-sales-workflow-form")).toBeVisible();

  await submitGate(page, "admissions");
  await page.goto("/sales");
  await expect(page).toHaveURL(/\/access-denied\?from=%2Fsales/);
  await expect(page.getByTestId("canonical-sales-page")).toHaveCount(0);
});
