import { expect, test, type Page } from "@playwright/test";

type TestRole = "admin" | "sales" | "admissions";
type ProofMode =
  "provider-not-authorized" | "routing-missing" | "token-missing";

const proofMode = requiredProofMode();

const BLOCKED_COPY: Readonly<Record<ProofMode, RegExp>> = Object.freeze({
  "provider-not-authorized":
    /Серверное разрешение провайдера не включено\.|Server-side provider authorization is disabled\.|Сервердик провайдер уруксаты өчүрүлгөн\./u,
  "routing-missing":
    /Не настроен точный маршрут amoCRM\.|Exact amoCRM routing is not configured\.|amoCRM үчүн так маршрут конфигурацияланган эмес\./u,
  "token-missing":
    /Закрытый OAuth-токен недоступен серверу\.|The private OAuth token is unavailable to the server\.|Жеке OAuth токени серверге жеткиликсиз\./u,
});

function requiredProofMode(): ProofMode {
  const value = process.env.EVO_EXPECT_AMOCRM_BROWSER_MODE;
  if (
    value !== "provider-not-authorized" &&
    value !== "routing-missing" &&
    value !== "token-missing"
  ) {
    throw new Error("EVO_EXPECT_AMOCRM_BROWSER_MODE is invalid");
  }
  return value;
}

function requireUuid(name: string): string {
  const value = process.env[name];
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  ) {
    throw new Error(`${name} must be a valid non-nil UUID`);
  }
  return value.toLowerCase();
}

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

async function expectBlockedPanel(
  page: Page,
  input: Readonly<{
    route: string;
    scope: "sales" | "admissions";
    targetField: "lead_id" | "student_case_id";
    targetId: string;
  }>,
) {
  await page.goto(input.route);
  await expect(page).toHaveURL(
    new RegExp(`${input.route.replaceAll("/", "\\/")}$`, "u"),
  );

  const panel = page.getByTestId("canonical-amocrm-command-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-scope", input.scope);
  await expect(panel.locator(`input[name="${input.targetField}"]`)).toHaveValue(
    input.targetId,
  );

  const availability = page.getByTestId(
    "canonical-amocrm-provider-availability",
  );
  await expect(availability).toHaveAttribute("data-status", "blocked");
  await expect(availability).toContainText(BLOCKED_COPY[proofMode]);
  await expect(page.getByTestId("canonical-amocrm-note-text")).toBeDisabled();
  await expect(page.getByTestId("canonical-amocrm-sync")).toBeDisabled();
  await expect(page.getByTestId("canonical-amocrm-reconcile")).toHaveCount(0);

  const html = await page.content();
  const secretProbe = process.env.EVO_EXPECT_AMOCRM_SECRET_PROBE;
  if (!secretProbe) {
    throw new Error("missing amoCRM secret-leak probe");
  }
  expect(html).not.toContain(secretProbe);
  expect(html).not.toMatch(
    /access_token|refresh_token|client_secret|authorization["':\s]+bearer|"_embedded"/iu,
  );
}

test("amoCRM commands stay visibly disabled when the selected server prerequisite is absent", async ({
  page,
}) => {
  const leadId = requireUuid("EVO_CANONICAL_LEAD_ID");
  await submitGate(page, "sales");
  await expectBlockedPanel(page, {
    route: `/sales/${leadId}`,
    scope: "sales",
    targetField: "lead_id",
    targetId: leadId,
  });
});

test("Sales and Admin see the Sales command only at the canonical lead workspace", async ({
  page,
}) => {
  test.skip(
    proofMode !== "provider-not-authorized",
    "the complete role matrix runs once; other modes repeat only fail-closed availability",
  );
  const leadId = requireUuid("EVO_CANONICAL_LEAD_ID");

  for (const role of ["sales", "admin"] as const) {
    await submitGate(page, role);
    await expect(page.getByTestId("active-role")).toHaveAttribute(
      "data-authority-role",
      role,
    );
    await expectBlockedPanel(page, {
      route: `/sales/${leadId}`,
      scope: "sales",
      targetField: "lead_id",
      targetId: leadId,
    });
    await expect(
      page.getByTestId("canonical-sales-lead-workspace"),
    ).toBeVisible();
  }
});

test("Admissions and Admin see the Admissions command only at canonical Student 360", async ({
  page,
}) => {
  test.skip(
    proofMode !== "provider-not-authorized",
    "the complete role matrix runs once; other modes repeat only fail-closed availability",
  );
  const studentCaseId = requireUuid("EVO_CANONICAL_STUDENT_CASE_ID");

  for (const role of ["admissions", "admin"] as const) {
    await submitGate(page, role);
    await expect(page.getByTestId("active-role")).toHaveAttribute(
      "data-authority-role",
      role,
    );
    await expectBlockedPanel(page, {
      route: `/clients/${studentCaseId}`,
      scope: "admissions",
      targetField: "student_case_id",
      targetId: studentCaseId,
    });
    await expect(
      page.getByTestId("canonical-student-case-workspace"),
    ).toBeVisible();
  }
});

test("wrong fixed roles are denied before either owning amoCRM panel renders", async ({
  page,
}) => {
  test.skip(
    proofMode !== "provider-not-authorized",
    "the complete role matrix runs once; other modes repeat only fail-closed availability",
  );
  const leadId = requireUuid("EVO_CANONICAL_LEAD_ID");
  const studentCaseId = requireUuid("EVO_CANONICAL_STUDENT_CASE_ID");

  await submitGate(page, "admissions");
  await page.goto(`/sales/${leadId}`);
  await expect(page).toHaveURL(/\/access-denied\?from=%2Fsales/u);
  await expect(page.getByTestId("canonical-sales-lead-workspace")).toHaveCount(
    0,
  );
  await expect(page.getByTestId("canonical-amocrm-command-panel")).toHaveCount(
    0,
  );

  await submitGate(page, "sales");
  await page.goto(`/clients/${studentCaseId}`);
  await expect(page).toHaveURL(/\/access-denied\?from=%2Fclients/u);
  await expect(
    page.getByTestId("canonical-student-case-workspace"),
  ).toHaveCount(0);
  await expect(page.getByTestId("canonical-amocrm-command-panel")).toHaveCount(
    0,
  );
});
