import { expect, test, type Locator, type Page } from "@playwright/test";
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
    responsibleSales: Identity;
    finance: Identity;
    student: Identity;
    studentNoCase: Identity;
    lifecycleStudent: Identity;
    blocked: Identity;
    noMembership: Identity;
    revocableCurator: Identity;
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
  p2r3: Readonly<{
    organizationId: string;
    revocableMembershipId: string;
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
  bw4: Readonly<{
    orgA: Readonly<{
      organizationId: string;
      conversationId: string;
      studentCaseId: string;
      decisionId: string;
      decisionQuestion: string;
      reviewedSourceId: string;
      sourceKey: string;
      sourceUrl: string;
      answerText: string;
      reopenedStatus: string;
      promptPolicyTitle: string;
      promptPolicyVersion: string;
      promptPolicySha: string;
      businessContextTitle: string;
      businessContextVersion: string;
      businessContextSha: string;
      rawContentSentinel: string;
      handoffNextStep: string;
      responsibleRole: string;
    }>;
    noCase: Readonly<{
      organizationId: string;
      conversationId: string;
      studentCaseId: null;
    }>;
    languages: Readonly<{
      ruConversationId: string;
      enConversationId: string;
      undeterminedConversationId: string;
    }>;
    negative: Readonly<{
      formerSalesMembershipId: string;
      crossOrgOrganizationId: string;
      unrelatedStudentCaseId: string;
    }>;
  }>;
  bw6: Readonly<{
    orgA: Readonly<{
      organizationId: string;
      activeStudentCaseId: string;
      contractTemplateVersionId: string;
      studentCaseContractDraftId: string;
      postContractItemId: string;
      postContractReportId: string;
      templateKey: string;
      templateTitle: string;
    }>;
    salesPending: Readonly<{
      organizationId: string;
      studentCaseId: string;
      responsibleSalesMembershipId: string;
    }>;
    negative: Readonly<{
      crossOrgOrganizationId: string;
      unassignedActiveStudentCaseId: string;
    }>;
  }>;
  bw7: Readonly<{
    orgA: Readonly<{
      organizationId: string;
      studentCaseId: string;
      studentMembershipId: string;
      studentProfileId: string;
      curatorMembershipId: string;
      studentDisplayName: string;
    }>;
  }>;
  p4b: Readonly<{
    orgA: Readonly<{
      organizationId: string;
      conversationId: string;
      noApprovalConversationId: string;
      amocrmAccountId: string;
      discoveryVersionId: string;
      discoveryVersion: number;
      approvalEventId: string;
      pipelineId: string;
      signedContractStatusId: string;
      leadFieldId: string;
      leadFieldName: string;
      contactFieldId: string;
      contactFieldName: string;
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
const appOrigin = "http://127.0.0.1:3311";
const platformAuthCookieBaseName = `sb-${new URL(fixture.apiUrl).hostname.split(".")[0]}-auth-token`;

function isCurrentPlatformAuthCookie(name: string) {
  if (name === platformAuthCookieBaseName) return true;
  const chunkPrefix = `${platformAuthCookieBaseName}.`;
  return (
    name.startsWith(chunkPrefix) &&
    /^\d+$/.test(name.slice(chunkPrefix.length))
  );
}
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

async function platformRows(
  token: string,
  resource: string,
  query: URLSearchParams,
) {
  const response = await fetch(
    `${fixture.apiUrl}/rest/v1/${resource}?${query.toString()}`,
    {
      headers: {
        apikey: fixture.publishableKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Accept-Profile": "platform",
      },
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

test("RU and EN draft requests work while uncertain language stops for manual selection", async ({
  page,
}) => {
  await loginToMessaging(page, fixture.identities.crossOrgAdmin);

  for (const [conversationId, language] of [
    [fixture.bw4.languages.ruConversationId, "ru"],
    [fixture.bw4.languages.enConversationId, "en"],
  ] as const) {
    await page.goto(`/whatsapp/${conversationId}`);
    await expect(page.getByTestId("platform-language-gate")).toHaveAttribute(
      "data-language-gate",
      language,
    );
    await expect(page.locator("#platform-draft-language")).toHaveValue(language);
    await page
      .locator("#platform-draft-reason")
      .fill(`Browser proof for the ${language.toUpperCase()} draft path`);
    await page.getByTestId("platform-request-draft").click();
    await expect(page.getByTestId("platform-draft-awaiting")).toBeVisible();
    await expect(
      page
        .getByTestId("platform-outbox-state")
        .locator('[data-outbox-kind="ai_draft_generate"]'),
    ).toHaveCount(1);
    await expect(
      page
        .getByTestId("platform-outbox-state")
        .locator('[data-outbox-kind="manual_whatsapp_send"]'),
    ).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("platform-language-gate")).toHaveAttribute(
      "data-language-gate",
      language,
    );
  }

  await page.goto(
    `/whatsapp/${fixture.bw4.languages.undeterminedConversationId}`,
  );
  const languageGate = page.getByTestId("platform-language-gate");
  await expect(languageGate).toHaveAttribute(
    "data-language-gate",
    "manual-selection-required",
  );
  const languageSelect = page.locator("#platform-draft-language");
  await expect(languageSelect).toHaveValue("");
  await expect(languageSelect).toBeEnabled();
  await expect(languageSelect.locator('option[value="ky"]')).toHaveCount(0);
  await expect(page.getByTestId("platform-request-draft")).toBeDisabled();

  await languageSelect.selectOption("ru");
  await expect(languageGate).toHaveAttribute("data-language-gate", "ru");
  await expect(page.getByTestId("platform-request-draft")).toBeEnabled();
});

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

test("a direct stale-session handler request preserves a valid Admin session", async ({
  page,
}) => {
  expectLegacyDatabaseUntouched();
  await login(page, fixture.identities.admin);
  await expect(page).toHaveURL(`${appOrigin}/sales`);

  const before = (await page.context().cookies()).filter(({ name }) =>
    isCurrentPlatformAuthCookie(name),
  );
  expect(before.length).toBeGreaterThan(0);

  await page.goto(
    "/auth/platform-session?reason=fake&next=https://evil.test",
  );
  await expect(page).toHaveURL(`${appOrigin}/sales`);

  const after = (await page.context().cookies()).filter(({ name }) =>
    isCurrentPlatformAuthCookie(name),
  );
  expect(after.length).toBeGreaterThan(0);
  expectLegacyDatabaseUntouched();
});

test("a revoked live authority clears only this Platform session", async ({
  page,
}) => {
  expectLegacyDatabaseUntouched();
  await login(page, fixture.identities.revocableCurator);
  await expect(page).toHaveURL(`${appOrigin}/clients`);

  const authenticatedCookies = (await page.context().cookies()).filter(
    ({ name }) => isCurrentPlatformAuthCookie(name),
  );
  expect(authenticatedCookies.length).toBeGreaterThan(0);

  const legacySentinelValue = `p2r3-legacy-${randomUUID()}`;
  const foreignSupabaseSentinelValue = `p2r3-foreign-${randomUUID()}`;
  await page.context().addCookies([
    {
      name: "edu_session",
      value: legacySentinelValue,
      url: appOrigin,
      sameSite: "Lax",
    },
    {
      name: "sb-other-auth-token",
      value: foreignSupabaseSentinelValue,
      url: appOrigin,
      sameSite: "Lax",
    },
  ]);

  const adminToken = await localAccessToken(fixture.identities.admin);
  const revocation = await platformRpc(
    adminToken,
    "change_membership_status",
    {
      p_organization_id: fixture.p2r3.organizationId,
      p_membership_id: fixture.p2r3.revocableMembershipId,
      p_new_status: "blocked",
      p_reason: "P2R3 local browser stale-authority proof",
      p_request_id: randomUUID(),
    },
  );
  expect(revocation.status).toBe(200);

  await page.goto("/whatsapp");
  await expect(page).toHaveURL(
    `${appOrigin}/login?error=authority_not_found`,
  );

  const finalCookies = await page.context().cookies();
  expect(
    finalCookies.filter(({ name }) => isCurrentPlatformAuthCookie(name)),
  ).toEqual([]);
  expect(
    finalCookies.find(({ name }) => name === "edu_session")?.value,
  ).toBe(legacySentinelValue);
  expect(
    finalCookies.find(({ name }) => name === "sb-other-auth-token")?.value,
  ).toBe(foreignSupabaseSentinelValue);
  expectLegacyDatabaseUntouched();
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
  await expect(page.getByText(/Утверждённый контракт OP v\d+/)).toBeVisible();

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

test("admin promotes a reviewed catalog batch before creating a catalog-linked application", async ({
  browser,
  page,
}) => {
  // This is one deliberate vertical-flow proof across source review, two
  // batches, publication/rejection, application creation, RLS and audit.
  test.setTimeout(90_000);
  const runId = randomUUID();
  const notionPageId = runId.replaceAll("-", "");
  const rejectedNotionPageId = `${notionPageId.startsWith("a") ? "b" : "a"}${notionPageId.slice(1)}`;
  const sourceUrl = `https://notion.so/${notionPageId}`;
  const rejectedSourceUrl = `https://notion.so/${rejectedNotionPageId}`;
  const sourceRevision = `bw5-${runId.slice(0, 8)}`;
  const rejectedSourceRevision = `bw5-reject-${runId.slice(0, 8)}`;
  const sourceRecordReference = `notion-row-${runId}`;
  const rejectedSourceRecordReference = `notion-row-rejected-${runId}`;
  const institutionName = `Synthetic BW5 University ${runId.slice(0, 8)}`;
  const rejectedInstitutionName = `Synthetic rejected college ${runId.slice(0, 8)}`;
  const programName = `Synthetic catalog program ${runId.slice(9, 17)}`;
  const adminToken = await localAccessToken(fixture.identities.admin);
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  const expectCatalogWorkspaceAccessible = async () => {
    const results = await new AxeBuilder({ page })
      .include('[data-testid="platform-catalog-import-workspace"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      results.violations,
      results.violations
        .map(
          ({ id, impact, help, nodes }) =>
            `${id} (${impact ?? "unknown"}): ${help}\n${nodes
              .map(
                ({ target, failureSummary }) =>
                  `  ${target.join(" ")}: ${failureSummary ?? "No failure summary"}`,
              )
              .join("\n")}`,
        )
        .join("\n\n"),
    ).toEqual([]);
  };
  const registerSource = async (
    source: string,
    revision: string,
    reason: string,
  ) => {
    await page.getByText("Зарегистрировать метаданные источника").click();
    const form = page.getByTestId("platform-catalog-register-source-form");
    await form.locator('select[name="source_kind"]').selectOption("notion_database");
    await form.locator('input[name="source_url"]').fill(source);
    await form.locator('input[name="source_revision"]').fill(revision);
    await form.locator('input[name="reason"]').fill(reason);
    await form
      .getByRole("button", { name: "Сохранить source metadata" })
      .click();
    await expect(page).toHaveURL(/catalog_result=source_saved/);
  };

  await login(page, fixture.identities.admin);
  await expect(page).toHaveURL(/\/sales$/);
  await page.goto("/applications#catalog-import");
  await expect(
    page.getByTestId("platform-catalog-import-workspace"),
  ).toBeVisible();

  await registerSource(
    rejectedSourceUrl,
    rejectedSourceRevision,
    "Register source metadata for the rejection-path proof",
  );
  const rejectedSourceContainer = page
    .getByText(rejectedSourceUrl, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'space-y-3')]")
    .first();
  const rejectedSourceReviewForm = rejectedSourceContainer.getByTestId(
    "platform-catalog-source-review-form",
  );
  await expectCatalogWorkspaceAccessible();
  await rejectedSourceReviewForm
    .locator('input[name="reason"]')
    .fill("Reject unauthorized disposable source metadata");
  await rejectedSourceReviewForm
    .getByRole("button", { name: "Отклонить" })
    .click();
  await expect(page).toHaveURL(/catalog_result=source_rejected/);
  await expect(page.getByText("Источник отклонён", { exact: true })).toBeVisible();

  await registerSource(
    sourceUrl,
    sourceRevision,
    "Register disposable BW5 browser-proof source metadata",
  );
  const sourceContainer = page
    .getByText(sourceUrl, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'space-y-3')]")
    .first();
  const reviewForm = sourceContainer.getByTestId(
    "platform-catalog-source-review-form",
  );
  const sourceRegistryId = await reviewForm
    .locator('input[name="source_registry_id"]')
    .inputValue();
  expect(sourceRegistryId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await reviewForm
    .locator('input[name="reason"]')
    .fill("Review synthetic source metadata for local BW5 proof");
  await reviewForm.getByRole("button", { name: "Подтвердить" }).click();

  await expect(page).toHaveURL(/catalog_result=source_reviewed/);
  const createBatchForm = page.getByTestId(
    "platform-catalog-create-batch-form",
  );
  await expect(
    createBatchForm.locator(`option[value="${sourceRegistryId}"]`),
  ).toContainText(sourceUrl);
  await createBatchForm
    .locator('select[name="source_registry_id"]')
    .selectOption(sourceRegistryId);
  await createBatchForm
    .locator('select[name="institution_kind"]')
    .selectOption("university");
  await createBatchForm
    .locator('input[name="reason"]')
    .fill("Create disposable BW5 staging batch");
  await createBatchForm.getByRole("button", { name: "Создать batch" }).click();

  await expect(page).toHaveURL(/catalog_result=batch_created/);
  const batchId = new URL(page.url()).searchParams.get("catalog_batch_id");
  expect(batchId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await expect(page.getByTestId("platform-catalog-batch-list")).toContainText(
    sourceUrl,
  );
  await expect(page.getByTestId("platform-catalog-batch-detail")).toContainText(
    sourceUrl,
  );
  const stageForm = page.getByTestId("platform-catalog-stage-candidate-form");
  await stageForm
    .locator('input[name="source_record_reference"]')
    .fill(sourceRecordReference);
  await stageForm
    .locator('input[name="institution_name"]')
    .fill(institutionName);
  await stageForm.locator('input[name="country_code"]').fill("MY");
  await stageForm.locator('input[name="city"]').fill("Kuala Lumpur");
  await stageForm
    .locator('input[name="reason"]')
    .fill("Stage one synthetic institution candidate");
  await stageForm
    .getByRole("button", { name: "Добавить в staging" })
    .click();

  await expect(page).toHaveURL(/catalog_result=candidate_staged/);
  await expect(page.getByText(institutionName, { exact: true })).toBeVisible();
  await expect(page.getByText(sourceRecordReference, { exact: true })).toHaveCount(0);
  const beforeApproval = await platformRpc(
    adminToken,
    "staff_catalog_institutions",
    {},
  );
  expect(beforeApproval.status).toBe(200);
  expect(Array.isArray(beforeApproval.payload)).toBe(true);
  expect(
    (beforeApproval.payload as Array<Record<string, unknown>>).some(
      (row) => row.institution_name === institutionName,
    ),
  ).toBe(false);
  await expect(
    page.getByTestId("platform-catalog-approve-batch-form"),
  ).toHaveCount(0);

  const validateForm = page.getByTestId("platform-catalog-validate-batch-form");
  await validateForm
    .locator('input[name="reason"]')
    .fill("Validate typed candidate fields without publication");
  await validateForm
    .getByRole("button", { name: "Запустить validation" })
    .click();
  await expect(page).toHaveURL(/catalog_result=batch_validated/);
  await expect(page.getByText(institutionName, { exact: true })).toBeVisible();
  await expectCatalogWorkspaceAccessible();

  const approveForm = page.getByTestId("platform-catalog-approve-batch-form");
  await approveForm
    .locator('input[name="reason"]')
    .fill("Approve validated disposable catalog candidate");
  await approveForm
    .getByRole("button", { name: "Approve и опубликовать" })
    .click();
  await expect(page).toHaveURL(/catalog_result=batch_approved/);
  await expect(
    page
      .getByTestId("platform-approved-catalog")
      .locator("tbody tr", { hasText: institutionName }),
  ).toBeVisible();

  const approved = await platformRpc(
    adminToken,
    "staff_catalog_institutions",
    {},
  );
  expect(approved.status).toBe(200);
  expect(Array.isArray(approved.payload)).toBe(true);
  const approvedInstitution = (approved.payload as Array<Record<string, unknown>>).find(
    (row) => row.institution_name === institutionName,
  );
  expect(approvedInstitution).toBeTruthy();
  const catalogInstitutionId = approvedInstitution?.catalog_institution_id;
  expect(catalogInstitutionId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  if (typeof catalogInstitutionId !== "string") {
    throw new Error("Approved catalog row did not expose its UUID");
  }

  const rejectionBatchForm = page.getByTestId(
    "platform-catalog-create-batch-form",
  );
  await rejectionBatchForm
    .locator('select[name="source_registry_id"]')
    .selectOption(sourceRegistryId);
  await rejectionBatchForm
    .locator('select[name="institution_kind"]')
    .selectOption("college");
  await rejectionBatchForm
    .locator('input[name="reason"]')
    .fill("Create a disposable batch for the pre-validation rejection proof");
  await rejectionBatchForm
    .getByRole("button", { name: "Создать batch" })
    .click();
  await expect(page).toHaveURL(/catalog_result=batch_created/);
  const rejectedBatchId = new URL(page.url()).searchParams.get(
    "catalog_batch_id",
  );
  expect(rejectedBatchId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  const rejectedStageForm = page.getByTestId(
    "platform-catalog-stage-candidate-form",
  );
  await rejectedStageForm
    .locator('input[name="source_record_reference"]')
    .fill(rejectedSourceRecordReference);
  await rejectedStageForm
    .locator('input[name="institution_name"]')
    .fill(rejectedInstitutionName);
  await rejectedStageForm.locator('input[name="country_code"]').fill("KG");
  await rejectedStageForm.locator('input[name="city"]').fill("Bishkek");
  await rejectedStageForm
    .locator('input[name="reason"]')
    .fill("Stage a pending candidate before rejecting the batch");
  await rejectedStageForm
    .getByRole("button", { name: "Добавить в staging" })
    .click();
  await expect(page).toHaveURL(/catalog_result=candidate_staged/);
  await expect(
    page.getByText(rejectedInstitutionName, { exact: true }),
  ).toBeVisible();
  const rejectBatchForm = page.getByTestId(
    "platform-catalog-reject-batch-form",
  );
  await rejectBatchForm
    .locator('input[name="reason"]')
    .fill("Reject staging batch before candidate validation");
  await rejectBatchForm.getByRole("button", { name: "Отклонить" }).click();
  await expect(page).toHaveURL(/catalog_result=batch_rejected/);
  await expect(page.getByText("Batch отклонён", { exact: true })).toBeVisible();

  await page.locator("#add > summary").click();
  const applicationForm = page.locator("#add form");
  const applicationRequestId = await applicationForm
    .locator('input[name="request_id"]')
    .inputValue();
  await applicationForm
    .locator('select[name="student_case_id"]')
    .selectOption(fixture.p3c.orgA.studentCaseId);
  const catalogInstitutionSelect = applicationForm.locator(
    'select[name="catalog_institution_id"]',
  );
  const manualInstitutionInput = applicationForm.locator(
    'input[name="institution_name"]',
  );
  await expect(catalogInstitutionSelect).toHaveValue("");
  await expect(manualInstitutionInput).toBeEnabled();
  await expect(manualInstitutionInput).toHaveAttribute("required", "");
  await catalogInstitutionSelect.selectOption(catalogInstitutionId);
  await expect(manualInstitutionInput).toBeDisabled();
  await expect(manualInstitutionInput).not.toHaveAttribute("required", "");
  await catalogInstitutionSelect.selectOption("");
  await expect(manualInstitutionInput).toBeEnabled();
  await expect(manualInstitutionInput).toHaveAttribute("required", "");
  await catalogInstitutionSelect.selectOption(catalogInstitutionId);
  await applicationForm.locator('input[name="program_name"]').fill(programName);
  await applicationForm
    .locator('textarea[name="note"]')
    .fill("Catalog-linked local BW5 application proof; no provider was called.");
  await applicationForm
    .getByRole("button", { name: "Создать с аудитом" })
    .click();

  await expect(page).toHaveURL(/\/applications\?result=saved$/);
  const applicationLink = page.locator('a[href^="/applications/"]:visible', {
    hasText: institutionName,
  });
  await expect(applicationLink).toHaveCount(1);
  const applicationRows = await platformRows(
    adminToken,
    "university_applications",
    new URLSearchParams({
      select:
        "id,catalog_institution_id,institution_name,program_name,student_case_id",
      catalog_institution_id: `eq.${catalogInstitutionId}`,
      program_name: `eq.${programName}`,
    }),
  );
  expect(applicationRows.status).toBe(200);
  expect(applicationRows.payload).toEqual([
    expect.objectContaining({
      catalog_institution_id: catalogInstitutionId,
      institution_name: institutionName,
      program_name: programName,
      student_case_id: fixture.p3c.orgA.studentCaseId,
    }),
  ]);
  const linkedApplication = (applicationRows.payload as Array<Record<string, unknown>>)[0];
  const linkedApplicationId = linkedApplication?.id;
  expect(typeof linkedApplicationId).toBe("string");
  if (typeof linkedApplicationId !== "string") {
    throw new Error("Catalog-linked application did not expose its UUID");
  }
  await expect(
    applicationCreateAudit(
      adminToken,
      linkedApplicationId,
      applicationRequestId,
    ),
  ).resolves.toHaveLength(1);

  const curatorContext = await browser.newContext();
  const curatorPage = await curatorContext.newPage();
  await login(curatorPage, fixture.identities.curator);
  await expect(curatorPage).toHaveURL(/\/clients$/);
  await curatorPage.goto("/applications#catalog-import");
  await expect(
    curatorPage
      .getByTestId("platform-approved-catalog")
      .locator("tbody tr", { hasText: institutionName }),
  ).toBeVisible();
  await expect(
    curatorPage.getByTestId("platform-catalog-register-source-form"),
  ).toHaveCount(0);
  await expect(
    curatorPage.getByTestId("platform-catalog-create-batch-form"),
  ).toHaveCount(0);
  await curatorContext.close();
  expectLegacyDatabaseUntouched();
});

test("BW6 keeps contract drafts and post-contract reports versioned, authorized, and auditable", async ({
  browser,
  page,
}) => {
  test.setTimeout(150_000);
  expectLegacyDatabaseUntouched();

  const runId = randomUUID();
  const suffix = runId.replaceAll("-", "").slice(0, 10);
  const templateKey = `contract_bw6_${suffix}`;
  const templateTitle = `Synthetic BW6 contract ${suffix}`;
  const welcomeItemKey = `welcome_${suffix}`;
  const documentItemKey = `document_${suffix}`;
  const welcomeLabel = `Send synthetic welcome pack ${suffix}`;
  const documentLabel = `Review synthetic document plan ${suffix}`;
  const templateText = `Synthetic contract ${suffix}\nStudent: {{student_name}}`;
  const manifestLines =
    "student_name|student_case.student_display_name|text|true";
  const checklistLines = [
    `${welcomeItemKey}|${welcomeLabel}|curator|Send the synthetic non-provider welcome pack`,
    `${documentItemKey}|${documentLabel}|curator|Review the synthetic document plan`,
  ].join("\n");
  const activePath = `/clients/${fixture.bw6.orgA.activeStudentCaseId}`;
  const salesPendingPath = `/clients/${fixture.bw6.salesPending.studentCaseId}`;
  const adminToken = await localAccessToken(fixture.identities.admin);
  const auditedRequestIds: string[] = [];
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const requestIdFrom = async (form: Locator) => {
    const value = await form.locator('input[name="request_id"]').inputValue();
    expect(value).toMatch(uuidPattern);
    return value;
  };
  const expectWorkspaceAccessible = async (targetPage: Page) => {
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    const results = await new AxeBuilder({ page: targetPage })
      .include('[data-testid="platform-contract-draft-report-workspace"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      results.violations,
      results.violations
        .map(
          ({ id, impact, help, nodes }) =>
            `${id} (${impact ?? "unknown"}): ${help}\n${nodes
              .map(
                ({ target, failureSummary }) =>
                  `  ${target.join(" ")}: ${failureSummary ?? "No failure summary"}`,
              )
              .join("\n")}`,
        )
        .join("\n\n"),
    ).toEqual([]);
  };
  const expectOneAuditEvent = async (requestId: string) => {
    const rows = await platformRows(
      adminToken,
      "audit_events",
      new URLSearchParams({
        select: "action,resource_type,resource_id,request_id",
        organization_id: `eq.${fixture.bw6.orgA.organizationId}`,
        request_id: `eq.${requestId}`,
      }),
    );
    expect(rows.status).toBe(200);
    expect(rows.payload).toEqual([
      expect.objectContaining({ request_id: requestId }),
    ]);
  };

  await login(page, fixture.identities.admin);
  await expect(page).toHaveURL(/\/sales$/);
  await page.goto(`${activePath}#contract-workflow`);
  const adminWorkspace = page.getByTestId(
    "platform-contract-draft-report-workspace",
  );
  await expect(adminWorkspace).toBeVisible();
  await expect(page.locator("#profile + #contract-workflow")).toBeVisible();
  await expectWorkspaceAccessible(page);

  await adminWorkspace
    .getByTestId("platform-contract-template-create-panel")
    .locator("summary")
    .click();
  const createTemplateForm = adminWorkspace.getByTestId(
    "platform-contract-template-create-form",
  );
  await createTemplateForm.locator('input[name="template_key"]').fill(templateKey);
  await createTemplateForm.locator('input[name="title"]').fill(templateTitle);
  await createTemplateForm
    .locator('select[name="source_registry_id"]')
    .selectOption(fixture.bw3.orgA.sourceRegistryId);
  const selectedSourceEvidence = await createTemplateForm
    .locator('select[name="source_registry_id"] option:checked')
    .textContent();
  expect(selectedSourceEvidence).toBeTruthy();
  await createTemplateForm
    .locator('textarea[name="template_text"]')
    .fill(templateText);
  await createTemplateForm
    .locator('textarea[name="manifest_lines"]')
    .fill(manifestLines);
  await createTemplateForm
    .locator('textarea[name="checklist_lines"]')
    .fill(checklistLines);
  await createTemplateForm
    .locator('input[name="reason"]')
    .fill("Create a reviewed synthetic BW6 template version");
  auditedRequestIds.push(await requestIdFrom(createTemplateForm));
  await createTemplateForm
    .getByRole("button", { name: "Создать неизменяемую версию" })
    .click();
  await expect(page).toHaveURL(/bw6_result=template_created/);

  let templateVersion = page
    .getByTestId("platform-contract-template-version")
    .filter({ hasText: templateTitle });
  await expect(templateVersion).toHaveCount(1);
  for (const sourcePart of (selectedSourceEvidence ?? "").split(" · ")) {
    await expect(templateVersion).toContainText(sourcePart);
  }
  const approveTemplateForm = templateVersion.getByTestId(
    "platform-contract-template-approve-form",
  );
  const contractTemplateVersionId = await approveTemplateForm
    .locator('input[name="contract_template_version_id"]')
    .inputValue();
  expect(contractTemplateVersionId).toMatch(uuidPattern);
  await approveTemplateForm
    .locator('input[name="reason"]')
    .fill("Approve reviewed synthetic typed template");
  auditedRequestIds.push(await requestIdFrom(approveTemplateForm));
  await approveTemplateForm
    .getByRole("button", { name: "Утвердить версию" })
    .click();
  await expect(page).toHaveURL(/bw6_result=template_approved/);
  templateVersion = page
    .getByTestId("platform-contract-template-version")
    .filter({ hasText: templateTitle });
  await expect(templateVersion.getByText("approved", { exact: true })).toBeVisible();

  const salesContext = await browser.newContext();
  const salesPage = await salesContext.newPage();
  await login(salesPage, fixture.identities.salesScoped);
  await expect(salesPage).toHaveURL(/\/sales$/);
  await salesPage.goto(`${salesPendingPath}#contract-workflow`);
  const salesWorkspace = salesPage.getByTestId(
    "platform-contract-draft-report-workspace",
  );
  await expect(salesWorkspace).toBeVisible();
  await expect(
    salesWorkspace.getByTestId("platform-contract-template-create-form"),
  ).toHaveCount(0);
  await expect(
    salesWorkspace.getByTestId("platform-post-contract-seed-form"),
  ).toHaveCount(0);

  let generateDraftForm = salesWorkspace.getByTestId(
    "platform-contract-draft-generate-form",
  );
  await generateDraftForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(contractTemplateVersionId);
  await generateDraftForm
    .locator('input[name="reason"]')
    .fill("Generate the first immutable synthetic contract draft");
  await generateDraftForm.getByRole("button", { name: /Сгенерировать/ }).click();
  await expect(salesPage).toHaveURL(/bw6_result=draft_generated/);

  const approveDraftForm = salesWorkspace.getByTestId(
    "platform-contract-draft-approved-form",
  );
  const firstDraftId = await approveDraftForm
    .locator('input[name="student_case_contract_draft_id"]')
    .inputValue();
  expect(firstDraftId).toMatch(uuidPattern);
  const firstDraft = salesWorkspace.locator(
    `[data-testid="platform-contract-draft-version"][data-draft-id="${firstDraftId}"]`,
  );
  const firstRenderedText = await firstDraft
    .getByTestId("platform-contract-rendered-draft")
    .textContent();
  const firstRenderedHash = await firstDraft
    .getByText("Rendered SHA-256", { exact: true })
    .locator("..")
    .locator("dd")
    .textContent();
  expect(firstRenderedText).toContain("Student:");
  expect(firstRenderedHash).toMatch(/^[0-9a-f]{64}$/i);
  await approveDraftForm
    .locator('input[name="reason"]')
    .fill("Approve the reviewed immutable synthetic draft");
  auditedRequestIds.push(await requestIdFrom(approveDraftForm));
  await approveDraftForm.getByRole("button", { name: "Утвердить" }).click();
  await expect(salesPage).toHaveURL(/bw6_result=draft_approved/);

  generateDraftForm = salesWorkspace.getByTestId(
    "platform-contract-draft-generate-form",
  );
  await generateDraftForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(contractTemplateVersionId);
  await generateDraftForm
    .locator('input[name="reason"]')
    .fill("Generate a second immutable version for rejection proof");
  await generateDraftForm.getByRole("button", { name: /Сгенерировать/ }).click();
  await expect(salesPage).toHaveURL(/bw6_result=draft_generated/);
  const rejectDraftForm = salesWorkspace.getByTestId(
    "platform-contract-draft-rejected-form",
  );
  const secondDraftId = await rejectDraftForm
    .locator('input[name="student_case_contract_draft_id"]')
    .inputValue();
  expect(secondDraftId).not.toBe(firstDraftId);
  await rejectDraftForm
    .locator('input[name="reason"]')
    .fill("Reject the second immutable version without rewriting the first");
  await rejectDraftForm.getByRole("button", { name: "Отклонить" }).click();
  await expect(salesPage).toHaveURL(/bw6_result=draft_rejected/);
  const preservedFirstDraft = salesWorkspace.locator(
    `[data-testid="platform-contract-draft-version"][data-draft-id="${firstDraftId}"]`,
  );
  await expect(preservedFirstDraft.getByText("approved", { exact: true })).toBeVisible();
  expect(
    await preservedFirstDraft
      .getByTestId("platform-contract-rendered-draft")
      .textContent(),
  ).toBe(firstRenderedText);
  expect(
    await preservedFirstDraft
      .getByText("Rendered SHA-256", { exact: true })
      .locator("..")
      .locator("dd")
      .textContent(),
  ).toBe(firstRenderedHash);

  await salesPage.goto(activePath);
  await expect(salesPage.getByText("404", { exact: true })).toBeVisible();
  await expect(
    salesPage.getByTestId("platform-contract-draft-report-workspace"),
  ).toHaveCount(0);
  await salesContext.close();

  const responsibleSalesContext = await browser.newContext();
  const responsibleSalesPage = await responsibleSalesContext.newPage();
  await login(responsibleSalesPage, fixture.identities.responsibleSales);
  await expect(responsibleSalesPage).toHaveURL(/\/sales$/);
  const responsibleSalesToken = await localAccessToken(
    fixture.identities.responsibleSales,
  );
  const responsibleSalesSummaries = await platformRpc(
    responsibleSalesToken,
    "sales_handoff_summaries",
    {},
  );
  expect(responsibleSalesSummaries.status).toBe(200);
  expect(responsibleSalesSummaries.payload).toEqual([
    expect.objectContaining({
      case_id: fixture.bw6.orgA.activeStudentCaseId,
      case_state: "active",
    }),
  ]);
  await responsibleSalesPage.goto(activePath);
  await expect(
    responsibleSalesPage.getByTestId("platform-sales-handoff-summary"),
  ).toBeVisible();
  await expect(
    responsibleSalesPage.getByTestId("platform-contract-draft-report-workspace"),
  ).toHaveCount(0);
  await responsibleSalesContext.close();

  await page.goto(`${activePath}#contract-workflow`);
  const activeWorkspace = page.getByTestId(
    "platform-contract-draft-report-workspace",
  );
  const activeGenerateDraftForm = activeWorkspace.getByTestId(
    "platform-contract-draft-generate-form",
  );
  await activeGenerateDraftForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(contractTemplateVersionId);
  await activeGenerateDraftForm
    .locator('input[name="reason"]')
    .fill("Generate the reviewed active-case contract before post-contract work");
  auditedRequestIds.push(await requestIdFrom(activeGenerateDraftForm));
  await activeGenerateDraftForm
    .getByRole("button", { name: /Сгенерировать/ })
    .click();
  await expect(page).toHaveURL(/bw6_result=draft_generated/);

  const activeApproveDraftForm = activeWorkspace.getByTestId(
    "platform-contract-draft-approved-form",
  );
  await activeApproveDraftForm
    .locator('input[name="reason"]')
    .fill("Approve the active-case draft before seeding its checklist");
  auditedRequestIds.push(await requestIdFrom(activeApproveDraftForm));
  await activeApproveDraftForm
    .getByRole("button", { name: "Утвердить" })
    .click();
  await expect(page).toHaveURL(/bw6_result=draft_approved/);

  const seedItemsForm = page.getByTestId("platform-post-contract-seed-form");
  await seedItemsForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(contractTemplateVersionId);
  await seedItemsForm
    .locator('input[name="reason"]')
    .fill("Seed synthetic post-contract items from the approved blueprint");
  auditedRequestIds.push(await requestIdFrom(seedItemsForm));
  await seedItemsForm.getByRole("button", { name: "Создать пункты" }).click();
  await expect(page).toHaveURL(/bw6_result=items_seeded/);

  let welcomeItem = page.locator(
    `[data-testid="platform-post-contract-item"][data-item-key="${welcomeItemKey}"]`,
  );
  let welcomeForm = welcomeItem.getByTestId("platform-post-contract-item-form");
  await welcomeForm.locator('select[name="status"]').selectOption("delivered");
  await welcomeForm.locator('input[name="evidence_ref"]').fill("");
  await welcomeForm
    .locator('input[name="reason"]')
    .fill("Prove delivered fails closed without evidence");
  const deliveredRetryRequestId = await requestIdFrom(welcomeForm);
  await welcomeForm.getByRole("button", { name: "Сохранить пункт" }).click();
  await expect(page).toHaveURL(/bw6_result=invalid/);
  welcomeItem = page.locator(
    `[data-testid="platform-post-contract-item"][data-item-key="${welcomeItemKey}"]`,
  );
  welcomeForm = welcomeItem.getByTestId("platform-post-contract-item-form");
  expect(await requestIdFrom(welcomeForm)).toBe(deliveredRetryRequestId);
  await welcomeForm.locator('select[name="status"]').selectOption("delivered");
  await welcomeForm
    .locator('input[name="evidence_ref"]')
    .fill(`synthetic:evidence:welcome-pack:${suffix}`);
  await welcomeForm
    .locator('input[name="reason"]')
    .fill("Record delivered synthetic item with bounded evidence");
  auditedRequestIds.push(deliveredRetryRequestId);
  await welcomeForm.getByRole("button", { name: "Сохранить пункт" }).click();
  await expect(page).toHaveURL(/bw6_result=item_updated/);

  let documentItem = page.locator(
    `[data-testid="platform-post-contract-item"][data-item-key="${documentItemKey}"]`,
  );
  let documentForm = documentItem.getByTestId("platform-post-contract-item-form");
  const assignedCuratorMembershipId = await documentForm
    .locator('input[name="owner_membership_id"]')
    .inputValue();
  expect(assignedCuratorMembershipId).toMatch(uuidPattern);
  await documentForm.locator('select[name="status"]').selectOption("blocked");
  await documentForm.locator('input[name="owner_membership_id"]').fill("");
  await documentForm.locator('textarea[name="next_action"]').fill("");
  await documentForm
    .locator('input[name="reason"]')
    .fill("Prove blocked fails closed without owner and next action");
  const blockedRetryRequestId = await requestIdFrom(documentForm);
  await documentForm.getByRole("button", { name: "Сохранить пункт" }).click();
  await expect(page).toHaveURL(/bw6_result=invalid/);
  documentItem = page.locator(
    `[data-testid="platform-post-contract-item"][data-item-key="${documentItemKey}"]`,
  );
  documentForm = documentItem.getByTestId("platform-post-contract-item-form");
  expect(await requestIdFrom(documentForm)).toBe(blockedRetryRequestId);
  await documentForm.locator('select[name="status"]').selectOption("blocked");
  await documentForm
    .locator('input[name="owner_membership_id"]')
    .fill(assignedCuratorMembershipId);
  await documentForm
    .locator('textarea[name="next_action"]')
    .fill("Request synthetic missing input");
  await documentForm
    .locator('input[name="reason"]')
    .fill("Record blocked synthetic item with owner and next action");
  auditedRequestIds.push(blockedRetryRequestId);
  await documentForm.getByRole("button", { name: "Сохранить пункт" }).click();
  await expect(page).toHaveURL(/bw6_result=item_updated/);

  let generateReportForm = page.getByTestId(
    "platform-post-contract-report-generate-form",
  );
  await generateReportForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(contractTemplateVersionId);
  await generateReportForm
    .locator('input[name="reason"]')
    .fill("Generate an immutable report from validated synthetic items");
  auditedRequestIds.push(await requestIdFrom(generateReportForm));
  await generateReportForm
    .getByRole("button", { name: "Создать новую версию отчёта" })
    .click();
  await expect(page).toHaveURL(/bw6_result=report_generated/);
  const approveReportForm = page.getByTestId(
    "platform-contract-report-approved-form",
  );
  const generatedReportId = await approveReportForm
    .locator('input[name="post_contract_report_id"]')
    .inputValue();
  const generatedReport = page.locator(
    `[data-testid="platform-post-contract-report-version"][data-report-id="${generatedReportId}"]`,
  );
  await expect(generatedReport).toHaveAttribute(
    "data-template-id",
    contractTemplateVersionId,
  );
  const deliveredCount = Number(
    await generatedReport.getByText("Доставлено", { exact: true }).locator("..").locator("dd").textContent(),
  );
  const blockedCount = Number(
    await generatedReport.getByText("Заблокировано", { exact: true }).locator("..").locator("dd").textContent(),
  );
  expect(deliveredCount).toBe(1);
  expect(blockedCount).toBe(1);
  await expect(generatedReport).toContainText(
    `synthetic:evidence:welcome-pack:${suffix}`,
  );
  await expect(generatedReport).toContainText("Request synthetic missing input");
  expect(
    await generatedReport
      .getByTestId("platform-post-contract-report-item")
      .count(),
  ).toBe(2);
  await expect(
    generatedReport.locator(
      `[data-testid="platform-post-contract-report-item"][data-item-id="${fixture.bw6.orgA.postContractItemId}"]`,
    ),
  ).toHaveCount(0);
  await expect(
    page.locator(
      `[data-testid="platform-post-contract-report-version"][data-report-id="${fixture.bw6.orgA.postContractReportId}"]`,
    ),
  ).toHaveAttribute(
    "data-template-id",
    fixture.bw6.orgA.contractTemplateVersionId,
  );
  await approveReportForm
    .locator('input[name="reason"]')
    .fill("Approve report with delivered evidence and blocked ownership");
  auditedRequestIds.push(await requestIdFrom(approveReportForm));
  await approveReportForm.getByRole("button", { name: "Утвердить" }).click();
  await expect(page).toHaveURL(/bw6_result=report_approved/);
  await expectWorkspaceAccessible(page);

  const curatorContext = await browser.newContext();
  const curatorPage = await curatorContext.newPage();
  await login(curatorPage, fixture.identities.curator);
  await expect(curatorPage).toHaveURL(/\/clients$/);
  await curatorPage.goto(`${activePath}#contract-workflow`);
  const curatorWorkspace = curatorPage.getByTestId(
    "platform-contract-draft-report-workspace",
  );
  await expect(curatorWorkspace).toBeVisible();
  await expect(
    curatorWorkspace.getByTestId("platform-contract-template-create-form"),
  ).toHaveCount(0);
  const curatorItem = curatorWorkspace.locator(
    `[data-testid="platform-post-contract-item"][data-item-key="${documentItemKey}"]`,
  );
  const curatorItemForm = curatorItem.getByTestId(
    "platform-post-contract-item-form",
  );
  await curatorItemForm.locator('select[name="status"]').selectOption("in_progress");
  await curatorItemForm
    .locator('textarea[name="next_action"]')
    .fill("Continue synthetic review as assigned Curator");
  await curatorItemForm
    .locator('input[name="reason"]')
    .fill("Assigned Curator advances the synthetic item");
  await curatorItemForm.getByRole("button", { name: "Сохранить пункт" }).click();
  await expect(curatorPage).toHaveURL(/bw6_result=item_updated/);
  generateReportForm = curatorWorkspace.getByTestId(
    "platform-post-contract-report-generate-form",
  );
  await generateReportForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(contractTemplateVersionId);
  await generateReportForm
    .locator('input[name="reason"]')
    .fill("Assigned Curator snapshots the updated synthetic checklist");
  await generateReportForm
    .getByRole("button", { name: "Создать новую версию отчёта" })
    .click();
  await expect(curatorPage).toHaveURL(/bw6_result=report_generated/);
  const rejectReportForm = curatorWorkspace.getByTestId(
    "platform-contract-report-rejected-form",
  );
  await rejectReportForm
    .locator('input[name="reason"]')
    .fill("Reject Curator report version while preserving its audit history");
  await rejectReportForm.getByRole("button", { name: "Отклонить" }).click();
  await expect(curatorPage).toHaveURL(/bw6_result=report_rejected/);
  const deniedCuratorResponse = await curatorPage.goto(
    `/clients/${fixture.bw6.negative.unassignedActiveStudentCaseId}`,
  );
  expect(deniedCuratorResponse?.status()).toBe(404);
  await expect(
    curatorPage.getByTestId("platform-contract-draft-report-workspace"),
  ).toHaveCount(0);
  await curatorContext.close();

  for (const identity of [
    fixture.identities.crossOrgAdmin,
    fixture.identities.finance,
    fixture.identities.student,
  ]) {
    const context = await browser.newContext();
    const deniedPage = await context.newPage();
    await login(deniedPage, identity);
    await expect(deniedPage).toHaveURL(expectedStaffHome(identity));
    const response = await deniedPage.goto(activePath);
    await expect(
      deniedPage.getByTestId("platform-contract-draft-report-workspace"),
    ).toHaveCount(0);
    if (identity === fixture.identities.crossOrgAdmin) {
      expect(response?.status()).toBe(404);
    } else {
      await expect(deniedPage).not.toHaveURL(
        new RegExp(`${escapePathForRegex(activePath)}$`),
      );
    }
    await context.close();
  }

  for (const requestId of auditedRequestIds) {
    await expectOneAuditEvent(requestId);
  }
  expectLegacyDatabaseUntouched();
});

test("BW7 proves one Supabase case from Sales draft through Admin handoff to Curator, Portal, and Sales summary", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  expectLegacyDatabaseUntouched();

  const casePath = `/clients/${fixture.bw7.orgA.studentCaseId}`;
  const templateVersionId = fixture.bw6.orgA.contractTemplateVersionId;
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const requestIdFrom = async (form: Locator) => {
    const value = await form.locator('input[name="request_id"]').inputValue();
    expect(value).toMatch(uuidPattern);
    return value;
  };

  const salesContext = await browser.newContext();
  const salesPage = await salesContext.newPage();
  await login(salesPage, fixture.identities.salesScoped);
  await expect(salesPage).toHaveURL(/\/sales$/);
  await salesPage.goto(`${casePath}#contract-workflow`);
  const salesWorkspace = salesPage.getByTestId(
    "platform-contract-draft-report-workspace",
  );
  await expect(salesWorkspace).toBeVisible();
  const generateDraftForm = salesWorkspace.getByTestId(
    "platform-contract-draft-generate-form",
  );
  await generateDraftForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(templateVersionId);
  await generateDraftForm
    .locator('input[name="reason"]')
    .fill("Generate the BW7 one-case lifecycle draft");
  await generateDraftForm.getByRole("button", { name: /Сгенерировать/ }).click();
  await expect(salesPage).toHaveURL(/bw6_result=draft_generated/);
  const approveDraftForm = salesWorkspace.getByTestId(
    "platform-contract-draft-approved-form",
  ).first();
  await approveDraftForm
    .locator('input[name="reason"]')
    .fill("Approve the reviewed BW7 lifecycle draft");
  await approveDraftForm.getByRole("button", { name: "Утвердить" }).click();
  await expect(salesPage).toHaveURL(/bw6_result=draft_approved/);
  await salesContext.close();

  const pendingStudentContext = await browser.newContext();
  const pendingStudentPage = await pendingStudentContext.newPage();
  await login(pendingStudentPage, fixture.identities.lifecycleStudent);
  await expect(pendingStudentPage).toHaveURL(/\/platform-pending(?:\?.*)?$/);
  await expect(
    pendingStudentPage.getByTestId("platform-pending"),
  ).toBeVisible();
  await pendingStudentPage.goto("/portal");
  await expect(pendingStudentPage).toHaveURL(
    /\/platform-pending\?from=\/portal$/,
  );
  await pendingStudentContext.close();

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage, fixture.identities.admin);
  await expect(adminPage).toHaveURL(/\/sales$/);
  await adminPage.goto(`${casePath}#case-lifecycle`);
  const assignmentForm = adminPage.getByTestId("curator-assignment-form");
  await expect(assignmentForm).toBeVisible();
  await assignmentForm
    .locator('select[name="curator_id"]')
    .selectOption(fixture.bw7.orgA.curatorMembershipId);
  await assignmentForm
    .locator('textarea[name="reason"]')
    .fill("Assign the Curator and activate the bounded BW7 lifecycle");
  const assignmentRequestId = await requestIdFrom(assignmentForm);
  await assignmentForm.getByRole("button", { name: "Назначить куратора" }).click();
  await expect(adminPage).toHaveURL(/result=saved/);
  await expect(adminPage.getByTestId("platform-client-detail-page")).toBeVisible();
  await expect(
    adminPage.getByTestId("curator-assignment-form")
      .locator('select[name="curator_id"]'),
  ).toHaveValue(fixture.bw7.orgA.curatorMembershipId);
  await expect(
    adminPage.locator("#case-lifecycle").getByText("Активно", { exact: true }),
  ).toBeVisible();

  const adminToken = await localAccessToken(fixture.identities.admin);
  const caseRows = await platformRows(
    adminToken,
    "student_cases",
    new URLSearchParams({
      select:
        "id,state,current_curator_membership_id,handoff_at,portal_activated_at",
      id: `eq.${fixture.bw7.orgA.studentCaseId}`,
    }),
  );
  expect(caseRows.status).toBe(200);
  expect(Array.isArray(caseRows.payload)).toBe(true);
  if (!Array.isArray(caseRows.payload)) {
    throw new Error("BW7 student case projection was not an array");
  }
  expect(caseRows.payload).toHaveLength(1);
  expect(caseRows.payload[0]).toMatchObject({
    id: fixture.bw7.orgA.studentCaseId,
    state: "active",
    current_curator_membership_id: fixture.bw7.orgA.curatorMembershipId,
  });
  expect(caseRows.payload[0].handoff_at).toEqual(expect.any(String));
  expect(caseRows.payload[0].portal_activated_at).toEqual(expect.any(String));
  const assignmentAudit = await platformRows(
    adminToken,
    "audit_events",
    new URLSearchParams({
      select: "action,resource_type,resource_id,request_id",
      action: "eq.case.curator.set",
      resource_id: `eq.${fixture.bw7.orgA.studentCaseId}`,
      request_id: `eq.${assignmentRequestId}`,
    }),
  );
  expect(assignmentAudit.status).toBe(200);
  expect(assignmentAudit.payload).toEqual([{
    action: "case.curator.set",
    resource_type: "student_case",
    resource_id: fixture.bw7.orgA.studentCaseId,
    request_id: assignmentRequestId,
  }]);
  await adminContext.close();

  const curatorContext = await browser.newContext();
  const curatorPage = await curatorContext.newPage();
  await login(curatorPage, fixture.identities.curator);
  await expect(curatorPage).toHaveURL(/\/clients$/);
  await curatorPage.goto(`${casePath}#contract-workflow`);
  const curatorWorkspace = curatorPage.getByTestId(
    "platform-contract-draft-report-workspace",
  );
  await expect(curatorWorkspace).toBeVisible();
  const seedForm = curatorWorkspace.getByTestId(
    "platform-post-contract-seed-form",
  );
  await seedForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(templateVersionId);
  await seedForm
    .locator('input[name="reason"]')
    .fill("Seed the assigned Curator checklist for BW7");
  await seedForm.getByRole("button", { name: "Создать пункты" }).click();
  await expect(curatorPage).toHaveURL(/bw6_result=items_seeded/);
  await expect(
    curatorWorkspace.getByTestId("platform-post-contract-item"),
  ).toHaveCount(2);

  const reportForm = curatorWorkspace.getByTestId(
    "platform-post-contract-report-generate-form",
  );
  await reportForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(templateVersionId);
  await reportForm
    .locator('input[name="reason"]')
    .fill("Snapshot the BW7 assigned Curator checklist");
  await reportForm
    .getByRole("button", { name: "Создать новую версию отчёта" })
    .click();
  await expect(curatorPage).toHaveURL(/bw6_result=report_generated/);
  const approveReportForm = curatorWorkspace.getByTestId(
    "platform-contract-report-approved-form",
  ).first();
  await approveReportForm
    .locator('input[name="reason"]')
    .fill("Approve the reviewed BW7 post-contract report");
  await approveReportForm.getByRole("button", { name: "Утвердить" }).click();
  await expect(curatorPage).toHaveURL(/bw6_result=report_approved/);
  await curatorContext.close();

  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await login(studentPage, fixture.identities.lifecycleStudent);
  await expect(studentPage).toHaveURL(/\/portal$/);
  await expect(
    studentPage.locator("#portal-main").getByRole("heading", {
      level: 1,
      name: "Главная",
      exact: true,
    }),
  ).toBeVisible();
  await studentPage.goto("/portal/profile");
  await expect(
    studentPage.locator("#portal-main").getByText(
      "BW7 Lifecycle Student",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    studentPage.getByTestId("platform-contract-draft-report-workspace"),
  ).toHaveCount(0);
  await studentPage.goto(casePath);
  await expect(studentPage).toHaveURL(/\/portal/);
  await studentContext.close();

  const summaryContext = await browser.newContext();
  const summaryPage = await summaryContext.newPage();
  await login(summaryPage, fixture.identities.salesScoped);
  await expect(summaryPage).toHaveURL(/\/sales$/);
  await summaryPage.goto(casePath);
  await expect(summaryPage.getByTestId("platform-sales-handoff-summary"))
    .toBeVisible();
  await expect(summaryPage.getByText(fixture.bw7.orgA.studentDisplayName, {
    exact: true,
  })).toBeVisible();
  await expect(
    summaryPage.getByTestId("platform-contract-draft-report-workspace"),
  ).toHaveCount(0);
  await expect(summaryPage.getByTestId("curator-assignment-form")).toHaveCount(0);
  await summaryContext.close();

  expectLegacyDatabaseUntouched();
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

test("BW4 renders immutable handoff and metadata-only approved prompt evidence", async ({
  page,
}) => {
  await openConversation(
    page,
    fixture.identities.admin,
    fixture.bw4.orgA.conversationId,
  );

  const handoff = page.getByTestId("platform-handoff-context");
  await expect(handoff).toHaveAttribute("data-handoff-state", "recorded");
  await expect(handoff).toContainText(fixture.bw4.orgA.handoffNextStep);
  await expect(handoff).toContainText(
    new RegExp(fixture.bw4.orgA.responsibleRole, "i"),
  );

  const promptPolicy = page.getByTestId("platform-active-prompt-policy");
  await expect(promptPolicy).toHaveAttribute("data-artifact-state", "approved");
  await expect(promptPolicy).toContainText(fixture.bw4.orgA.promptPolicyTitle);
  await expect(promptPolicy).toContainText(
    fixture.bw4.orgA.promptPolicyVersion,
  );
  await expect(promptPolicy).toContainText(fixture.bw4.orgA.promptPolicySha);

  const businessContext = page.getByTestId("platform-active-business-context");
  await expect(businessContext).toHaveAttribute(
    "data-artifact-state",
    "approved",
  );
  await expect(businessContext).toContainText(
    fixture.bw4.orgA.businessContextTitle,
  );
  await expect(businessContext).toContainText(
    fixture.bw4.orgA.businessContextVersion,
  );
  await expect(businessContext).toContainText(
    fixture.bw4.orgA.businessContextSha,
  );

  expect(await page.content()).not.toContain(
    fixture.bw4.orgA.rawContentSentinel,
  );
});

test("Admin creates, answers, reopens, and retires one versioned BW4 decision", async ({
  page,
}) => {
  const question = `BW4 browser decision ${randomUUID()}`;
  const answer = "Reviewed BW4 browser answer grounded in the synthetic source.";
  await openConversation(
    page,
    fixture.identities.admin,
    fixture.bw4.orgA.conversationId,
  );

  const createDisclosure = page.getByTestId("platform-decision-create");
  await createDisclosure.locator("summary").click();
  await expect(
    createDisclosure.locator('select[name="owner_role"] option'),
  ).toHaveCount(3);
  const requirementKind = createDisclosure.locator(
    'select[name="affected_requirement_kind"]',
  );
  await expect(requirementKind.locator('option[value="country_requirement"]')).toHaveCount(1);
  await expect(requirementKind.locator('option[value="document_requirement"]')).toHaveCount(1);
  await requirementKind.selectOption("country_requirement");
  await expect(
    createDisclosure.getByTestId("platform-decision-requirement-target"),
  ).toContainText(fixture.bw3.orgA.checklist.targetCountry);
  await requirementKind.selectOption("document_requirement");
  await expect(
    createDisclosure.getByTestId("platform-decision-requirement-target"),
  ).toContainText(fixture.bw3.orgA.document.label);
  await createDisclosure.locator('textarea[name="question"]').fill(question);
  await requirementKind.selectOption("student_profile");
  const affectedProfileField = createDisclosure.locator(
    'select[name="affected_requirement_field"]',
  );
  await expect(affectedProfileField.locator("option")).toHaveCount(15);
  await affectedProfileField.selectOption("communication_language");
  await createDisclosure
    .locator('input[name="reason"]')
    .fill("Record a synthetic unresolved decision for browser lifecycle proof");
  await createDisclosure.getByTestId("platform-decision-create-submit").click();

  await expect(page.getByTestId("platform-decision-action-result")).toHaveAttribute(
    "data-decision-action-result",
    "saved",
  );
  let entry = page
    .getByTestId("platform-decision-entry")
    .filter({ hasText: question });
  await expect(entry).toHaveAttribute("data-decision-status", "unresolved");

  const answerDisclosure = entry
    .locator("details")
    .filter({ hasText: "Зафиксировать ответ" });
  await answerDisclosure.locator("summary").click();
  await answerDisclosure.locator('textarea[name="answer"]').fill(answer);
  await answerDisclosure
    .locator('select[name="source_registry_id"]')
    .selectOption(fixture.bw4.orgA.reviewedSourceId);
  await answerDisclosure
    .locator('input[name="evidence_ref"]')
    .fill("Synthetic reviewed source passage used for the exact answer");
  await answerDisclosure
    .locator('input[name="reason"]')
    .fill("Answer reviewed against the selected source");
  await answerDisclosure.getByTestId("platform-decision-answer-submit").click();

  entry = page
    .getByTestId("platform-decision-entry")
    .filter({ hasText: question });
  await expect(entry).toHaveAttribute("data-decision-status", "answered");
  await expect(entry).toContainText(answer);
  await expect(entry).toContainText(fixture.bw4.orgA.sourceKey);

  const historySummary = entry.locator("summary").filter({
    hasText: "История решения",
  });
  await historySummary.focus();
  await page.keyboard.press("Enter");
  await expect(entry.getByTestId("platform-decision-history")).toBeVisible();
  await expect(
    entry.getByTestId("platform-decision-history").locator("li"),
  ).toHaveCount(2);

  await entry
    .locator('input[id^="platform-decision-unresolved-reason-"]')
    .fill("Explicitly reopen after new information arrived");
  await entry.getByTestId("platform-decision-reopen-submit").click();

  entry = page
    .getByTestId("platform-decision-entry")
    .filter({ hasText: question });
  await expect(entry).toHaveAttribute("data-decision-status", "unresolved");
  await expect(entry).toContainText("Ответ ещё не зафиксирован");
  await entry
    .locator('input[id^="platform-decision-retired-reason-"]')
    .fill("Retire the synthetic question after lifecycle proof");
  await entry.getByTestId("platform-decision-retire-submit").click();

  entry = page
    .getByTestId("platform-decision-entry")
    .filter({ hasText: question });
  await expect(entry).toHaveAttribute("data-decision-status", "retired");
  await expect(entry.getByTestId("platform-decision-controls")).toHaveCount(0);
  await entry.locator("summary").filter({ hasText: "История решения" }).click();
  await expect(
    entry.getByTestId("platform-decision-history").locator("li"),
  ).toHaveCount(4);
});

test("responsible Sales gets a fixed owner role and a clear no-case handoff state", async ({
  page,
}) => {
  await openConversation(
    page,
    fixture.identities.salesScoped,
    fixture.bw4.noCase.conversationId,
  );

  await expect(page.getByTestId("platform-handoff-context")).toHaveAttribute(
    "data-handoff-state",
    "no-linked-case",
  );
  const createDisclosure = page.getByTestId("platform-decision-create");
  await createDisclosure.locator("summary").click();
  await expect(
    createDisclosure.locator('input[name="owner_role"]'),
  ).toHaveValue("sales");
  await expect(
    createDisclosure.locator('select[name="owner_role"]'),
  ).toHaveCount(0);
  await expect(
    createDisclosure.locator(
      'select[name="affected_requirement_kind"] option',
    ),
  ).toHaveCount(1);
});

test("Finance, Students, former Sales, and cross-org staff see no BW4 controls", async ({
  browser,
}) => {
  for (const identity of [
    fixture.identities.finance,
    fixture.identities.student,
    fixture.identities.studentNoCase,
  ]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, identity);
    await page.goto(`/whatsapp/${fixture.bw4.orgA.conversationId}`);
    await expect(page.getByTestId("platform-decision-create")).toHaveCount(0);
    await expect(page.getByTestId("platform-decision-controls")).toHaveCount(0);
    await expect(page.getByTestId("platform-decision-backlog")).toHaveCount(0);
    await expect(page.getByTestId("platform-handoff-context")).toHaveCount(0);
    await expect(page.getByTestId("platform-prompt-evidence")).toHaveCount(0);
    await context.close();
  }

  const crossOrgContext = await browser.newContext();
  const crossOrgPage = await crossOrgContext.newPage();
  await loginToMessaging(crossOrgPage, fixture.identities.crossOrgAdmin);
  await expectDeniedConversationRoute(
    crossOrgPage,
    `/whatsapp/${fixture.bw4.orgA.conversationId}`,
  );
  await expect(crossOrgPage.getByTestId("platform-decision-controls")).toHaveCount(
    0,
  );
  await expect(crossOrgPage.getByTestId("platform-decision-backlog")).toHaveCount(0);
  await expect(crossOrgPage.getByTestId("platform-handoff-context")).toHaveCount(0);
  await expect(crossOrgPage.getByTestId("platform-prompt-evidence")).toHaveCount(0);
  await crossOrgContext.close();

  const formerSalesResult = await platformRpc(
    fixture.p3c.orgA.staleSalesAccessToken,
    "staff_conversation_bw4_workspace",
    {
      p_organization_id: fixture.bw4.orgA.organizationId,
      p_conversation_id: fixture.bw4.orgA.conversationId,
    },
  );
  expect([401, 403]).toContain(formerSalesResult.status);
});

test("P4B Admin reviews an approved local mapping without provider-proof claims", async ({
  page,
}) => {
  await loginToMessaging(page, fixture.identities.admin);
  await page.goto(`/whatsapp/${fixture.p4b.orgA.conversationId}`);

  const panel = page.getByTestId("platform-amocrm-mapping");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute(
    "data-mapping-state",
    "approved_configured_unverified",
  );
  await expect(panel).toHaveAttribute("data-provider-proof", "not-proved");
  await expect(page.getByTestId("platform-amocrm-admin-workspace")).toBeVisible();
  await expect(page.getByTestId("platform-amocrm-approve-form")).toBeVisible();
  await expect(page.getByTestId("platform-amocrm-revoke-form")).toBeVisible();
  await expect(page.locator('select[name="pipeline_id"]')).toHaveValue(
    fixture.p4b.orgA.pipelineId,
  );
  await expect(
    page.locator('select[name="signed_contract_status_id"]'),
  ).toHaveValue(fixture.p4b.orgA.signedContractStatusId);
  await expect(page.locator('select[name="lead_field_id"]')).toHaveValue(
    fixture.p4b.orgA.leadFieldId,
  );
  await expect(page.locator('select[name="contact_field_id"]')).toHaveValue(
    fixture.p4b.orgA.contactFieldId,
  );
  await expect(panel).toContainText(fixture.p4b.orgA.leadFieldName);
  await expect(panel).toContainText(fixture.p4b.orgA.contactFieldName);
  await expect(panel).toContainText(fixture.p4b.orgA.amocrmAccountId);
  await expect(panel).toContainText(/работа провайдера не проверена/i);
});

test("P4B ignores forged URL outcomes and retry request IDs", async ({ page }) => {
  await loginToMessaging(page, fixture.identities.admin);
  const forgedRequestId = "59999999-9999-4999-8999-999999999999";
  await page.goto(
    `/whatsapp/${fixture.p4b.orgA.conversationId}` +
      `?mapping_result=approved&mapping_retry_operation=approve&mapping_retry_request_id=${forgedRequestId}`,
  );

  await expect(page.getByTestId("platform-amocrm-mapping-result")).toHaveCount(0);
  await expect(
    page.getByTestId("platform-amocrm-approve-form").locator('[name="request_id"]'),
  ).toHaveValue("");
  await expect(
    page.getByTestId("platform-amocrm-revoke-form").locator('[name="request_id"]'),
  ).toHaveValue("");
  await expect(page.getByTestId("platform-amocrm-mapping")).toHaveAttribute(
    "data-mapping-state",
    "approved_configured_unverified",
  );
});

test("P4B Curator receives only bounded read-only mapping state", async ({
  page,
}) => {
  await loginToMessaging(page, fixture.identities.curator);
  await page.goto(`/whatsapp/${fixture.p4b.orgA.conversationId}`);

  const panel = page.getByTestId("platform-amocrm-mapping");
  await expect(panel).toHaveAttribute(
    "data-mapping-state",
    "approved_configured_unverified",
  );
  await expect(panel).toHaveAttribute("data-provider-proof", "not-proved");
  await expect(page.getByTestId("platform-amocrm-admin-workspace")).toHaveCount(0);
  await expect(page.getByTestId("platform-amocrm-approve-form")).toHaveCount(0);
  await expect(page.getByTestId("platform-amocrm-revoke-form")).toHaveCount(0);
  await expect(page.locator('[name="pipeline_id"]')).toHaveCount(0);
  await expect(panel).not.toContainText(fixture.p4b.orgA.amocrmAccountId);
  await expect(panel).not.toContainText(fixture.p4b.orgA.leadFieldName);
  await expect(panel).not.toContainText(fixture.p4b.orgA.contactFieldName);
});

test("P4B Admin sees an explicit fail-closed state when no approval exists", async ({
  page,
}) => {
  await loginToMessaging(page, fixture.identities.admin);
  await page.goto(`/whatsapp/${fixture.p4b.orgA.noApprovalConversationId}`);

  const panel = page.getByTestId("platform-amocrm-mapping");
  await expect(panel).toHaveAttribute("data-mapping-state", "not_approved");
  await expect(panel).toHaveAttribute("data-provider-proof", "not-proved");
  await expect(page.getByTestId("platform-amocrm-approve-form")).toBeVisible();
  await expect(page.getByTestId("platform-amocrm-revoke-form")).toHaveCount(0);
  await expect(panel).toContainText(/Связка не одобрена/i);
});
