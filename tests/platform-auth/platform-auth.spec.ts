import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type Identity = Readonly<{ email: string; password: string }>;
type ConversationFixture = Readonly<{
  id: string;
  subject: string;
  messages: readonly string[];
}>;
type Fixture = Readonly<{
  apiUrl: string;
  publishableKey: string;
  identities: Readonly<{
    admin: Identity;
    curator: Identity;
    crossOrgAdmin: Identity;
    salesScoped: Identity;
    finance: Identity;
    student: Identity;
    studentNoCase: Identity;
    blocked: Identity;
    noMembership: Identity;
  }>;
  conversations: Readonly<{
    orgA: ConversationFixture;
    orgB: ConversationFixture;
    orgAManual: ConversationFixture;
    orgBAiRequest: ConversationFixture;
    orgBAiReview: ConversationFixture;
    sameOrgOutsideSalesScope: ConversationFixture;
  }>;
  p3c: Readonly<{
    orgA: Readonly<{
      organizationId: string;
      studentCaseId: string;
      conversationId: string;
      selectedKnowledgeVersionId: string;
      aiDraftRequestId: string;
      aiDraftId: string;
      manualSendAuthorizationId: string;
      outboxWorkItemId: string;
      outboxKind: string;
      outboxState: string;
      outboxAttemptCount: number;
      outboxMaxAttempts: number;
      latestAuditAction: string;
      aiReadiness: string;
      aiEvidenceKind: string;
      wahaReadiness: string;
      wahaEvidenceKind: string;
      reviewedText: string;
      knowledgeTitle: string;
      knowledgeVersion: string;
      staleSalesAccessToken: string;
    }>;
    mutations: Readonly<{
      manualAiUnavailable: Readonly<{
        organizationId: string;
        conversationId: string;
        sourceMessageId: string;
        aiReadiness: string;
        wahaReadiness: string;
      }>;
      aiRequest: Readonly<{
        organizationId: string;
        conversationId: string;
        sourceMessageId: string;
        knowledgeVersionId: string;
      }>;
      aiReview: Readonly<{
        organizationId: string;
        conversationId: string;
        sourceMessageId: string;
        aiDraftId: string;
        generatedText: string;
      }>;
    }>;
  }>;
  bw3: Readonly<{
    orgA: Readonly<{
      organizationId: string;
      studentCaseId: string;
      studentProfileId: string;
      studentIdentityProfileId: string;
      sourceRegistryId: string;
      countryRequirementSourceLinkId: string;
      countryRequirementVersionId: string;
      documentRequirementId: string;
      documentSlotId: string;
      appliedDocumentSlotCount: number;
      profileRevision: number;
      checklist: Readonly<{
        targetCountry: string;
        targetDegree: string;
        programDirection: string;
        version: number;
        sourceCount: number;
        requiredProfileFields: readonly string[];
      }>;
      profile: Readonly<{
        preferredDisplayName: string;
        legalDisplayName: string | null;
        dateOfBirth: string | null;
        communicationLanguage: string;
        citizenshipCountry: string;
        residencyCountry: string | null;
        currentEducationSummary: string | null;
        academicSummary: string;
        languageSummary: string;
        budgetBand: string;
        decisionParticipantLabels: readonly string[];
        consentStatus: string;
        consentEvidenceRef: string | null;
        nextStep: string;
      }>;
      document: Readonly<{
        requirementKey: string;
        label: string;
        instructions: string;
        status: string;
      }>;
    }>;
    noCaseStudent: Readonly<{
      membershipId: string;
      profileId: string;
      displayName: string;
    }>;
  }>;
}>;

const fixturePath = process.env.EVO_PLATFORM_AUTH_FIXTURE_PATH;
if (!fixturePath || !path.isAbsolute(fixturePath)) {
  throw new Error("EVO_PLATFORM_AUTH_FIXTURE_PATH must be an absolute path");
}
if ((statSync(fixturePath).mode & 0o777) !== 0o600) {
  throw new Error("Platform Auth fixture must use mode 0600");
}
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
const configuredLegacyDatabaseSentinel =
  process.env.EVO_PLATFORM_LEGACY_DB_SENTINEL;
if (
  !configuredLegacyDatabaseSentinel ||
  !path.isAbsolute(configuredLegacyDatabaseSentinel)
) {
  throw new Error(
    "EVO_PLATFORM_LEGACY_DB_SENTINEL must be an absolute path",
  );
}
const legacyDatabaseSentinel = configuredLegacyDatabaseSentinel;

async function login(page: Page, identity: Identity) {
  await page.goto("/login");
  await page.locator("#login-email").fill(identity.email);
  await page.locator("#login-password").fill(identity.password);
  await page.getByRole("button", { name: "Войти" }).click();
}

function expectedStaffHome(identity: Identity): RegExp {
  if (identity === fixture.identities.curator) return /\/clients$/;
  if (identity === fixture.identities.finance) return /\/platform-pending$/;
  if (identity === fixture.identities.student) return /\/portal$/;
  if (identity === fixture.identities.studentNoCase) {
    return /\/platform-pending(?:\?.*)?$/;
  }
  return /\/sales$/;
}

async function loginToMessaging(page: Page, identity: Identity) {
  await login(page, identity);
  await expect(page).toHaveURL(expectedStaffHome(identity));
  await page.goto("/whatsapp");
  await expect(page).toHaveURL(/\/whatsapp$/);
}

async function localAccessToken(identity: Identity): Promise<string> {
  const response = await fetch(
    `${fixture.apiUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: fixture.publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(identity),
    },
  );
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("Local Auth did not return an admin access token");
  }
  return payload.access_token;
}

async function applicationCreateAudit(
  token: string,
  applicationId: string,
  requestId: string,
) {
  const query = new URLSearchParams({
    select:
      "organization_id,action,resource_type,resource_id,request_id",
    organization_id: `eq.${fixture.p3c.orgA.organizationId}`,
    action: "eq.application.create",
    resource_type: "eq.university_application",
    resource_id: `eq.${applicationId}`,
    request_id: `eq.${requestId}`,
  });
  const response = await fetch(
    `${fixture.apiUrl}/rest/v1/audit_events?${query.toString()}`,
    {
      headers: {
        apikey: fixture.publishableKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Accept-Profile": "platform",
      },
    },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as unknown;
}

function escapePathForRegex(pathname: string) {
  return pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function expectDeniedConversationRoute(page: Page, pathname: string) {
  await page.goto(pathname);
  await expect(page).toHaveURL(new RegExp(`${escapePathForRegex(pathname)}$`));
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "This page could not be found." }),
  ).toBeVisible();
  await expect(page.getByTestId("platform-conversation-thread")).toHaveCount(0);
}

async function workflowRpc(
  token: string,
  conversationId: string,
) {
  const response = await fetch(`${fixture.apiUrl}/rest/v1/rpc/staff_conversation_workflow`, {
    method: "POST",
    headers: {
      apikey: fixture.publishableKey,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Profile": "platform",
      "Content-Profile": "platform",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_organization_id: fixture.p3c.orgA.organizationId,
      p_conversation_id: conversationId,
    }),
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) payload = JSON.parse(text);
  return { status: response.status, payload };
}

async function platformRpc(
  token: string,
  routineName: string,
  body: Readonly<Record<string, unknown>>,
) {
  const response = await fetch(
    `${fixture.apiUrl}/rest/v1/rpc/${routineName}`,
    {
      method: "POST",
      headers: {
        apikey: fixture.publishableKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Accept-Profile": "platform",
        "Content-Profile": "platform",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const text = await response.text();
  let payload: unknown = null;
  if (text) payload = JSON.parse(text);
  return { status: response.status, payload };
}

function expectLegacyDatabaseUntouched() {
  expect(existsSync(legacyDatabaseSentinel)).toBe(false);
}

async function openOrgAConversation(page: Page, identity: Identity) {
  await loginToMessaging(page, identity);
  await page.goto(`/whatsapp/${fixture.p3c.orgA.conversationId}`);
  await expect(page).toHaveURL(
    new RegExp(`/whatsapp/${fixture.p3c.orgA.conversationId}$`),
  );
}

async function openConversation(
  page: Page,
  identity: Identity,
  conversationId: string,
) {
  await loginToMessaging(page, identity);
  await page.goto(`/whatsapp/${conversationId}`);
  await expect(page).toHaveURL(new RegExp(`/whatsapp/${conversationId}$`));
  await expect(page.getByTestId("platform-messaging-workflow")).toBeVisible();
}

async function assertPersistedP3cWorkflow(page: Page) {
  const thread = page.getByTestId("platform-conversation-thread");
  await expect(thread).toBeVisible();
  await expect(thread).toHaveAttribute("data-provider-proof", "not-proved");

  const workflow = page.getByTestId("platform-messaging-workflow");
  await expect(workflow).toBeVisible();
  await expect(workflow).toHaveAttribute("data-provider-proof", "not-proved");

  const health = page.getByTestId("platform-workflow-health");
  await expect(health).toBeVisible();
  await expect(
    health.locator(
      `[data-integration-readiness="${fixture.p3c.orgA.aiReadiness}"][data-provider-proof="not-proved"]`,
    ),
  ).toHaveCount(1);
  await expect(
    health.locator(
      `[data-integration-readiness="${fixture.p3c.orgA.wahaReadiness}"][data-provider-proof="proved"]`,
    ),
  ).toHaveCount(1);
  await expect(workflow).not.toContainText("synthetic:health:");

  await expect(page.getByTestId("platform-workflow-audit")).toContainText(
    fixture.p3c.orgA.latestAuditAction,
  );
  await expect(
    workflow.getByText(fixture.p3c.orgA.reviewedText, { exact: true }),
  ).toBeVisible();
  await expect(workflow).toContainText(fixture.p3c.orgA.knowledgeTitle);

  const outbox = page.getByTestId("platform-outbox-state");
  await expect(outbox).toBeVisible();
  await expect(
    outbox.locator(
      `[data-outbox-kind="${fixture.p3c.orgA.outboxKind}"][data-outbox-state="${fixture.p3c.orgA.outboxState}"]`,
    ),
  ).toHaveCount(1);

  await expect(page.getByTestId("platform-knowledge-select")).toHaveCount(0);
  await expect(page.getByTestId("platform-request-draft")).toHaveCount(0);
  await expect(page.getByTestId("platform-draft-editor")).toHaveCount(0);
  await expect(page.getByTestId("platform-review-approve")).toHaveCount(0);
  await expect(page.getByTestId("platform-manual-send")).toHaveCount(0);
}

test("self-registration is disabled before any account write", async ({
  page,
}) => {
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Доступ по приглашению" })).toBeVisible();
  await expect(page.locator('input[id^="register-"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Вернуться ко входу" })).toBeVisible();
});

test("wrong password and unprovisioned authorities fail closed", async ({
  page,
}) => {
  await login(page, {
    email: fixture.identities.admin.email,
    password: `${fixture.identities.admin.password}-wrong`,
  });
  await expect(page.locator("#login-error")).toHaveText(
    "Неверная почта или пароль",
  );
  await expect(page).toHaveURL(/\/login$/);

  for (const identity of [
    fixture.identities.blocked,
    fixture.identities.noMembership,
  ]) {
    await login(page, identity);
    await expect(page.locator("#login-error")).toContainText(
      "не назначен активный доступ",
    );
    await expect(page).toHaveURL(/\/login$/);
  }
});

test("route-level auth failures surface an explicit login error", async ({
  page,
}) => {
  await page.goto("/login?error=authority_not_found");
  await expect(page.locator("#login-error")).toContainText(
    "не назначен активный доступ",
  );

  await page.goto("/login?error=platform_unavailable");
  await expect(page.locator("#login-error")).toContainText(
    "не может проверить вход",
  );
});

test("admin opens ordered synthetic inbound messages through Supabase RLS", async ({
  page,
}) => {
  await loginToMessaging(page, fixture.identities.admin);

  const list = page.getByTestId("platform-conversation-list");
  await expect(list).toBeVisible();
  await expect(
    list.getByText(fixture.conversations.orgA.subject, { exact: true }),
  ).toBeVisible();
  await expect(
    list.getByText(fixture.conversations.orgB.subject, { exact: true }),
  ).toHaveCount(0);

  await list
    .locator(`a[href="/whatsapp/${fixture.conversations.orgA.id}"]`)
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/whatsapp/${fixture.conversations.orgA.id}$`),
  );

  const thread = page.getByTestId("platform-conversation-thread");
  await expect(thread).toBeVisible();
  await expect(thread).toHaveAttribute("data-provider-proof", "not-proved");
  const disclosure = page.getByTestId("platform-synthetic-data-disclosure");
  await expect(disclosure).toContainText("Синтетические локальные данные");
  await expect(disclosure).toContainText("не получена от клиента");
  await expect(disclosure).toContainText(
    "не подтверждает работу внешних провайдеров",
  );

  const inboundMessages = thread.locator(
    '[data-message-direction="inbound"]',
  );
  await expect(inboundMessages).toHaveCount(
    fixture.conversations.orgA.messages.length,
  );
  for (const [index, body] of fixture.conversations.orgA.messages.entries()) {
    await expect(inboundMessages.nth(index)).toContainText(body);
  }

  await expectDeniedConversationRoute(
    page,
    `/whatsapp/${fixture.conversations.orgB.id}`,
  );
});

test("admin reads the persisted local P3C workflow without proving providers", async ({
  page,
}) => {
  await openOrgAConversation(page, fixture.identities.admin);
  await assertPersistedP3cWorkflow(page);
});

test("assigned Curator reads the same persisted local P3C workflow", async ({
  page,
}) => {
  await openOrgAConversation(page, fixture.identities.curator);
  await assertPersistedP3cWorkflow(page);
});

test("same-organization Sales cannot open another Sales scope", async ({
  page,
}) => {
  await loginToMessaging(page, fixture.identities.salesScoped);

  const list = page.getByTestId("platform-conversation-list");
  await expect(list).toBeVisible();
  await expect(
    list.getByText(fixture.conversations.sameOrgOutsideSalesScope.subject, {
      exact: true,
    }),
  ).toHaveCount(0);

  await expectDeniedConversationRoute(
    page,
    `/whatsapp/${fixture.conversations.sameOrgOutsideSalesScope.id}`,
  );
});

test("active staff reaches only connected Supabase-backed surfaces", async ({
  page,
}) => {
  await login(page, fixture.identities.admin);
  await expect(page).toHaveURL(/\/sales$/);
  await expect(page.getByTestId("platform-sales-page")).toBeVisible();
  await expect(
    page.getByRole("navigation", {
      name: /Вид воронки продаж|Сатуу воронкасынын көрүнүшү|Sales pipeline view/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", {
      name: /Основная навигация|Негизги навигация|Primary navigation/,
    }).first(),
  ).toBeVisible();
  await expect(page.getByText("Рабочий контракт OP не утверждён")).toBeVisible();

  await page.goto("/clients");
  const clientsPage = page.getByTestId("platform-clients-page");
  await expect(clientsPage).toBeVisible();
  await expect(
    clientsPage.getByRole("heading", { name: "Student 360" }),
  ).toBeVisible();
  await expect(
    clientsPage.getByText("Synthetic Org A Student", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: /Synthetic Org A Student/ }).first(),
  ).toBeVisible();

  await page.goto("/applications");
  await expect(page.getByTestId("platform-applications-page")).toBeVisible();
  await expect(
    page.getByRole("navigation", {
      name: /Статусы заявок|Арыз статустары|Application statuses/,
    }),
  ).toBeVisible();
  await expect(page.getByText("Заявок по выбранному фильтру нет.")).toBeVisible();

  await page.goto("/whatsapp");
  await expect(page).toHaveURL(/\/whatsapp$/);
  await expect(page.getByTestId("platform-conversation-list")).toBeVisible();
  await expect(
    page.getByText(fixture.conversations.orgA.subject, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/локальных таблиц CRM wa_/i)).toHaveCount(0);

  for (const legacyRoute of [
    "/dashboard",
    "/documents",
    "/visa",
    "/calls",
    "/notifications",
    "/tasks",
    "/chat",
    "/reports",
    "/finance",
    "/settings",
  ]) {
    await page.goto(legacyRoute);
    const destination = new URL(page.url());
    expect(destination.pathname, legacyRoute).toBe("/platform-pending");
    expect(destination.searchParams.get("from"), legacyRoute).toBe(legacyRoute);
    await expect(page.getByTestId("platform-pending")).toBeVisible();
  }

  const apiResults = await page.evaluate(
    async (requests) =>
      Promise.all(
        requests.map(async ({ path, method }) => {
          const response = await fetch(path, { method });
          return {
            path,
            status: response.status,
            body: await response.json(),
          };
        }),
      ),
    [
      { path: "/api/readiness", method: "GET" },
      { path: "/api/ai/draft", method: "POST" },
      { path: "/api/transcription/jobs", method: "POST" },
      { path: "/api/waha/qr", method: "GET" },
      { path: "/api/webhooks/waha", method: "POST" },
      { path: "/api/webhooks/whatsapp", method: "POST" },
      { path: "/api/webhooks/telephony", method: "POST" },
      { path: "/api/internal/lead-agent/whatsapp", method: "POST" },
    ],
  );
  for (const result of apiResults) {
    expect(result.status, result.path).toBe(403);
    expect(result.body, result.path).toEqual(
      expect.objectContaining({ error: "platform_route_not_connected" }),
    );
  }

  const actionBoundaryStatus = await page.evaluate(async () => {
    const response = await fetch("/finance", { method: "POST" });
    return response.status;
  });
  expect(actionBoundaryStatus).toBe(403);

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect
    .poll(async () =>
      (await page.context().cookies()).filter(({ name }) =>
        /^sb-[A-Za-z0-9_-]+-auth-token(?:\.\d+)?$/.test(name),
      ),
    )
    .toEqual([]);
  await page.goto("/whatsapp");
  await expect(page).toHaveURL(/\/login$/);
});

test("admin Student 360 renders the persisted BW3 profile, provenance, and read-only requirement", async ({
  page,
}) => {
  test.slow();
  expectLegacyDatabaseUntouched();

  await login(page, fixture.identities.admin);
  await expect(page).toHaveURL(/\/sales$/);
  const clientPath = `/clients/${fixture.bw3.orgA.studentCaseId}`;
  await page.goto(clientPath);
  await expect(page).toHaveURL(
    new RegExp(`${escapePathForRegex(clientPath)}$`),
  );

  const student360 = page.getByTestId("platform-client-detail-page");
  await expect(student360).toBeVisible();
  await expect(
    student360.locator("p").filter({ hasText: /^Student 360$/ }),
  ).toBeVisible();

  const profileForm = student360.getByTestId("platform-student-profile-form");
  await expect(profileForm).toBeVisible();
  await expect(
    profileForm.locator('input[name="student_case_id"]'),
  ).toHaveValue(fixture.bw3.orgA.studentCaseId);
  await expect(
    profileForm.locator('input[name="expected_revision"]'),
  ).toHaveValue(String(fixture.bw3.orgA.profileRevision));
  await expect(
    profileForm.locator('input[name="preferred_display_name"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.preferredDisplayName);
  await expect(
    profileForm.locator('select[name="communication_language"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.communicationLanguage);
  await expect(
    profileForm.locator('input[name="citizenship_country"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.citizenshipCountry);
  await expect(
    profileForm.locator('input[name="residency_country"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.residencyCountry ?? "");
  await expect(
    profileForm.locator('input[name="budget_band"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.budgetBand);
  await expect(
    profileForm.locator('select[name="consent_status"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.consentStatus);
  await expect(
    profileForm.locator('input[name="consent_evidence_ref"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.consentEvidenceRef ?? "");
  await expect(
    profileForm.locator('textarea[name="current_education_summary"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.currentEducationSummary ?? "");
  await expect(
    profileForm.locator('textarea[name="academic_summary"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.academicSummary);
  await expect(
    profileForm.locator('textarea[name="language_summary"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.languageSummary);
  await expect(
    profileForm.locator('input[name="decision_participant_labels"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.decisionParticipantLabels.join(", "));
  const participantInput = profileForm.locator(
    'input[name="decision_participant_labels"]',
  );
  const twelveParticipants = Array.from(
    { length: 12 },
    (_, index) => `participant-${index + 1}`,
  );
  await participantInput.fill(twelveParticipants.join(", "));
  expect(
    await participantInput.evaluate((input: HTMLInputElement) => input.checkValidity()),
  ).toBe(true);
  await participantInput.fill([...twelveParticipants, "participant-13"].join(", "));
  expect(
    await participantInput.evaluate((input: HTMLInputElement) => input.checkValidity()),
  ).toBe(false);
  await participantInput.fill(
    fixture.bw3.orgA.profile.decisionParticipantLabels.join(", "),
  );
  await expect(
    profileForm.locator('textarea[name="profile_next_step"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.nextStep);
  await expect(
    profileForm.locator('input[name="legal_display_name"]'),
  ).toHaveCount(0);
  await expect(
    profileForm.locator('input[name="date_of_birth"]'),
  ).toHaveCount(0);

  const checklist = student360.getByTestId("platform-country-checklist");
  await expect(checklist).toBeVisible();
  await expect(
    checklist.getByText(`v${fixture.bw3.orgA.checklist.version}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    checklist.getByText(
      `Подтверждённых источников: ${fixture.bw3.orgA.checklist.sourceCount}`,
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    checklist.locator('select[name="country_requirement_version_id"]'),
  ).toHaveCount(0);
  for (const requiredFieldLabel of [
    "Предпочитаемое имя",
    "Язык общения",
    "Гражданство",
    "Академический профиль",
    "Языковая подготовка",
    "Бюджетный диапазон",
    "Следующий шаг",
  ]) {
    await expect(checklist).toContainText(requiredFieldLabel);
  }

  const documents = student360.locator("section#documents");
  await expect(documents).toBeVisible();
  await expect(documents.locator("li")).toHaveCount(
    fixture.bw3.orgA.appliedDocumentSlotCount,
  );
  await expect(
    documents.getByText(fixture.bw3.orgA.document.label, { exact: true }),
  ).toHaveCount(1);
  await expect(
    documents.getByText(fixture.bw3.orgA.document.instructions, {
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(documents.getByText("Требуется", { exact: true })).toHaveCount(1);
  await expect(documents.locator('a[href^="/documents/"]')).toHaveCount(0);
  await expect(documents.locator('input[type="file"]')).toHaveCount(0);
  await expect(
    documents.getByRole("button", {
      name: /загрузить|отправить файл|добавить документ/i,
    }),
  ).toHaveCount(0);

  expectLegacyDatabaseUntouched();
});

test("student portal renders the persisted BW3 profile and one requirement without legacy SQLite", async ({
  page,
}) => {
  test.slow();
  expectLegacyDatabaseUntouched();
  expect(fixture.bw3.orgA.studentProfileId).not.toBe(
    fixture.bw3.orgA.studentIdentityProfileId,
  );
  await login(page, fixture.identities.student);
  await expect(page).toHaveURL(/\/portal$/);

  for (const [route, heading] of [
    ["/portal", "Главная"],
    ["/portal/profile", "Профиль"],
    ["/portal/documents", "Документы"],
    ["/portal/applications", "Заявки"],
    ["/portal/payments", "Оплаты"],
    ["/portal/visa", "Виза"],
    ["/portal/messages", "Сообщения"],
    ["/portal/team", "Моя команда"],
  ] as const) {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`${escapePathForRegex(route)}$`));
    await expect(
      page.locator("#portal-main").getByRole("heading", {
        level: 1,
        name: heading,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Навигация кабинета" })
        .first(),
    ).toBeVisible();
  }

  await page.goto("/portal/profile");
  for (const expectedValue of [
    fixture.bw3.orgA.profile.preferredDisplayName,
    fixture.bw3.orgA.profile.citizenshipCountry,
    fixture.bw3.orgA.profile.residencyCountry,
    fixture.bw3.orgA.profile.currentEducationSummary,
    fixture.bw3.orgA.profile.academicSummary,
    fixture.bw3.orgA.profile.languageSummary,
    fixture.bw3.orgA.profile.budgetBand,
    fixture.bw3.orgA.profile.nextStep,
    fixture.bw3.orgA.checklist.targetCountry,
    fixture.bw3.orgA.checklist.targetDegree,
    fixture.bw3.orgA.checklist.programDirection,
  ]) {
    if (!expectedValue) continue;
    await expect(
      page.getByText(expectedValue, { exact: true }).first(),
    ).toBeVisible();
  }

  await page.goto("/portal/documents");
  const documentList = page.locator('section[aria-label="Документы"]');
  await expect(documentList.locator("article")).toHaveCount(
    fixture.bw3.orgA.appliedDocumentSlotCount,
  );
  await expect(
    documentList.getByText(fixture.bw3.orgA.document.label, { exact: true }),
  ).toHaveCount(1);
  await expect(
    documentList.getByText("Требуется", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByText("Загрузка в кабинете пока недоступна", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "В этой версии кабинета нет защищённой загрузки или повторной отправки файлов. Не передавайте паспорт и другие чувствительные документы через обычный чат — уточните у куратора согласованный безопасный канал.",
      { exact: true },
    ).first(),
  ).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /загрузить|отправить файл/i }),
  ).toHaveCount(0);

  for (const route of ["/portal/profile", "/portal/documents"] as const) {
    await page.goto(
      `${route}?clientId=${encodeURIComponent(
        fixture.bw3.noCaseStudent.profileId,
      )}&studentCaseId=${encodeURIComponent(
        fixture.bw3.noCaseStudent.membershipId,
      )}`,
    );
    expect(new URL(page.url()).pathname).toBe(route);
    await expect(page.locator("#portal-main")).not.toContainText(
      fixture.bw3.noCaseStudent.displayName,
    );
    if (route === "/portal/profile") {
      await expect(
        page.getByText(fixture.bw3.orgA.profile.preferredDisplayName, {
          exact: true,
        }).first(),
      ).toBeVisible();
    } else {
      await expect(
        page.getByText(fixture.bw3.orgA.document.label, { exact: true }),
      ).toHaveCount(1);
    }
  }
  expectLegacyDatabaseUntouched();
});

test("BW3 RPCs deny cross-student reads and non-Admin checklist binding", async () => {
  const [studentToken, financeToken, salesToken, curatorToken] = await Promise.all([
    localAccessToken(fixture.identities.studentNoCase),
    localAccessToken(fixture.identities.finance),
    localAccessToken(fixture.identities.salesScoped),
    localAccessToken(fixture.identities.curator),
  ]);

  for (const routineName of [
    "staff_student_profile_snapshot",
    "staff_student_case_documents",
  ] as const) {
    const result = await platformRpc(studentToken, routineName, {
      p_student_case_id: fixture.bw3.orgA.studentCaseId,
    });
    expect(result.status, routineName).toBe(200);
    expect(result.payload, routineName).toEqual([]);
  }

  const financeProfile = await platformRpc(
    financeToken,
    "staff_student_profile_snapshot",
    { p_student_case_id: fixture.bw3.orgA.studentCaseId },
  );
  expect(financeProfile.status).toBe(200);
  expect(financeProfile.payload).toEqual([]);

  for (const [label, token] of [
    ["sales", salesToken],
    ["curator", curatorToken],
  ] as const) {
    const result = await platformRpc(
      token,
      "apply_country_requirement_version",
      {
        p_organization_id: fixture.bw3.orgA.organizationId,
        p_student_case_id: fixture.bw3.orgA.studentCaseId,
        p_country_requirement_version_id:
          fixture.bw3.orgA.countryRequirementVersionId,
        p_reason: `${label} direct RPC must remain denied`,
        p_request_id: randomUUID(),
      },
    );
    expect(result.status, label).toBe(403);
  }
});

test("admin creates a preparation application with one RLS-visible audit event", async ({
  page,
}) => {
  const runId = randomUUID();
  const institutionName = `Synthetic BW2 University ${runId.slice(0, 8)}`;
  const programName = `Synthetic admissions program ${runId.slice(9, 17)}`;

  await login(page, fixture.identities.admin);
  await expect(page).toHaveURL(/\/sales$/);
  await page.goto("/applications");
  await expect(page.getByTestId("platform-applications-page")).toBeVisible();

  await page.locator("#add > summary").click();
  const form = page.locator("#add form");
  const requestId = await form.locator('input[name="request_id"]').inputValue();
  expect(requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await form
    .locator('select[name="student_case_id"]')
    .selectOption(fixture.p3c.orgA.studentCaseId);
  await expect(form.locator('select[name="student_case_id"]')).toHaveValue(
    fixture.p3c.orgA.studentCaseId,
  );
  await form.locator('select[name="status"]').selectOption("preparation");
  await form.locator('input[name="institution_name"]').fill(institutionName);
  await form.locator('input[name="program_name"]').fill(programName);
  await form
    .locator('textarea[name="note"]')
    .fill("Synthetic local BW2 application proof; no provider was called.");
  await form.getByRole("button", { name: "Создать с аудитом" }).click();

  await expect(page).toHaveURL(/\/applications\?result=saved$/);
  await expect(page.getByText("Заявка сохранена", { exact: true })).toBeVisible();
  const applicationLink = page.locator('a[href^="/applications/"]:visible', {
    hasText: institutionName,
  });
  await expect(applicationLink).toHaveCount(1);
  const applicationRecord = applicationLink
    .locator("xpath=ancestor::tr | ancestor::article")
    .first();
  await expect(applicationRecord).toContainText(programName);
  const applicationHref = await applicationLink.getAttribute("href");
  const applicationId = applicationHref?.match(
    /^\/applications\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )?.[1];
  expect(applicationId).toBeTruthy();
  if (!applicationId) {
    throw new Error("Created application link did not contain a UUID");
  }

  await applicationLink.click();
  await expect(page).toHaveURL(new RegExp(`/applications/${applicationId}$`));
  await expect(page.getByTestId("platform-application-detail-page")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: institutionName, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(programName, { exact: true })).toBeVisible();

  const adminToken = await localAccessToken(fixture.identities.admin);
  const audit = await applicationCreateAudit(
    adminToken,
    applicationId,
    requestId,
  );
  expect(audit).toEqual([
    {
      organization_id: fixture.p3c.orgA.organizationId,
      action: "application.create",
      resource_type: "university_application",
      resource_id: applicationId,
      request_id: requestId,
    },
  ]);
});

test("staff cannot stay on the student portal and a Student without a case fails closed", async ({
  browser,
}) => {
  for (const [identity, expectedPath] of [
    [fixture.identities.admin, "/sales"],
    [fixture.identities.curator, "/clients"],
    [fixture.identities.finance, "/platform-pending"],
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, identity);
    await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPath);
    await page.goto("/portal");
    await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPath);
    await expect(
      page.getByRole("navigation", { name: "Навигация кабинета" }),
    ).toHaveCount(0);
    if (identity === fixture.identities.curator) {
      await expect(page.getByTestId("platform-clients-page")).toBeVisible();
      await page.goto("/sales");
      await expect(page).toHaveURL(/\/platform-pending\?from=%2Fsales$/);
    }
    if (identity === fixture.identities.finance) {
      for (const route of ["/clients", "/applications"]) {
        await page.goto(route);
        const destination = new URL(page.url());
        expect(destination.pathname, route).toBe("/platform-pending");
        expect(destination.searchParams.get("from"), route).toBe(route);
      }
    }
    if (expectedPath === "/platform-pending") {
      await expect(page.getByTestId("platform-pending")).toBeVisible();
      await expect(page.getByRole("link", { name: "Открыть сообщения" })).toHaveCount(0);
    }
    await context.close();
  }

  const noCaseContext = await browser.newContext();
  const noCasePage = await noCaseContext.newPage();
  await login(noCasePage, fixture.identities.studentNoCase);
  await expect
    .poll(() => new URL(noCasePage.url()).pathname)
    .toBe("/platform-pending");
  await expect(noCasePage.getByTestId("platform-pending")).toBeVisible();
  await expect(
    noCasePage.getByRole("link", { name: "Открыть сообщения" }),
  ).toHaveCount(0);
  await noCaseContext.close();
});

test("cross-organization admin is denied the org A P3C workflow route", async ({
  page,
}) => {
  await loginToMessaging(page, fixture.identities.crossOrgAdmin);
  const list = page.getByTestId("platform-conversation-list");
  await expect(
    list.getByText(fixture.conversations.orgA.subject, { exact: true }),
  ).toHaveCount(0);
  await expectDeniedConversationRoute(
    page,
    `/whatsapp/${fixture.p3c.orgA.conversationId}`,
  );
});

test("stale sales workflow claims fail closed at the live platform RPC seam", async () => {
  const result = await workflowRpc(
    fixture.p3c.orgA.staleSalesAccessToken,
    fixture.p3c.orgA.conversationId,
  );
  expect([401, 403]).toContain(result.status);
});

test("staff writes and persists a manual reply while AI is unavailable", async ({
  page,
}) => {
  const target = fixture.p3c.mutations.manualAiUnavailable;
  const finalText = "Ручной синтетический ответ сотрудника без AI.";
  await openConversation(page, fixture.identities.admin, target.conversationId);

  const health = page.getByTestId("platform-workflow-health");
  await expect(
    health.locator(
      `[data-integration-readiness="${target.aiReadiness}"][data-provider-proof="not-proved"]`,
    ),
  ).toHaveCount(1);
  await expect(
    health.locator(
      `[data-integration-readiness="${target.wahaReadiness}"][data-provider-proof="proved"]`,
    ),
  ).toHaveCount(1);
  await expect(page.getByTestId("platform-request-draft")).toBeDisabled();
  await expect(page.getByTestId("platform-manual-send")).toBeEnabled();

  await page.getByTestId("platform-manual-send-text").fill(finalText);
  await page
    .getByTestId("platform-manual-send-reason")
    .fill("Manual reply required while AI health is unavailable");
  await page.getByTestId("platform-manual-send").click();

  await expect(page.locator('[data-action-status="completed"]')).toBeVisible();
  await expect(page.getByText(finalText, { exact: true })).toBeVisible();
  await expect(
    page
      .getByTestId("platform-outbox-state")
      .locator(
        '[data-outbox-kind="manual_whatsapp_send"][data-outbox-state="queued"]',
      ),
  ).toHaveCount(1);
  await expect(page.getByTestId("platform-workflow-audit")).toContainText(
    "communication.manual.send.request",
  );

  await page.reload();
  await expect(page.getByText(finalText, { exact: true })).toBeVisible();
  await expect(
    page
      .getByTestId("platform-outbox-state")
      .locator('[data-outbox-kind="manual_whatsapp_send"]'),
  ).toHaveCount(1);
  await expect(page.getByTestId("platform-manual-send")).toHaveCount(0);
});

test("staff submits an approved-knowledge AI draft request through the real form", async ({
  page,
}) => {
  const target = fixture.p3c.mutations.aiRequest;
  await openConversation(
    page,
    fixture.identities.crossOrgAdmin,
    target.conversationId,
  );

  await expect(page.getByTestId("platform-messaging-workflow")).toHaveAttribute(
    "data-provider-proof",
    "proved",
  );
  await page
    .getByTestId("platform-knowledge-select")
    .selectOption(target.knowledgeVersionId);
  await page.locator("#platform-draft-language").selectOption("en");
  await page
    .locator("#platform-draft-reason")
    .fill("Prepare a grounded synthetic draft for browser mutation proof");
  await page.getByTestId("platform-request-draft").click();

  await expect(page.locator('[data-action-status="completed"]')).toBeVisible();
  await expect(page.getByTestId("platform-draft-awaiting")).toBeVisible();
  await expect(page.getByTestId("platform-selected-knowledge")).toBeVisible();
  await expect(
    page
      .getByTestId("platform-outbox-state")
      .locator(
        '[data-outbox-kind="ai_draft_generate"][data-outbox-state="queued"]',
      ),
  ).toHaveCount(1);
  await expect(page.getByTestId("platform-workflow-audit")).toContainText(
    "ai.draft.request.knowledge",
  );
});

test("staff reviews an AI draft then authorizes the edited final text", async ({
  page,
}) => {
  const target = fixture.p3c.mutations.aiReview;
  const reviewedText = "Staff-edited synthetic draft after human review.";
  const finalText = "Final staff-controlled synthetic message for manual send.";
  await openConversation(
    page,
    fixture.identities.crossOrgAdmin,
    target.conversationId,
  );

  await expect(page.getByTestId("platform-draft-editor")).toHaveValue(
    target.generatedText,
  );
  await page.getByTestId("platform-draft-editor").fill(reviewedText);
  await page
    .locator("#platform-review-reason")
    .fill("Human review edited and approved the synthetic draft");
  await page.getByTestId("platform-review-approve").click();

  await expect(page.getByTestId("platform-manual-send-text")).toHaveValue(
    reviewedText,
  );
  await page.getByTestId("platform-manual-send-text").fill(finalText);
  await page
    .getByTestId("platform-manual-send-reason")
    .fill("Human authorized the exact final text for the controlled outbox");
  await page.getByTestId("platform-manual-send").click();

  await expect(page.locator('[data-action-status="completed"]')).toBeVisible();
  await expect(page.getByText(finalText, { exact: true })).toBeVisible();
  await expect(
    page
      .getByTestId("platform-outbox-state")
      .locator(
        '[data-outbox-kind="manual_whatsapp_send"][data-outbox-state="queued"]',
      ),
  ).toHaveCount(1);
  await expect(page.getByTestId("platform-workflow-audit")).toContainText(
    "communication.manual.send.request",
  );

  await page.reload();
  await expect(page.getByText(finalText, { exact: true })).toBeVisible();
  await expect(
    page
      .getByTestId("platform-outbox-state")
      .locator('[data-outbox-kind="manual_whatsapp_send"]'),
  ).toHaveCount(1);
});
