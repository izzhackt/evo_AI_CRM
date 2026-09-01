import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const NOTE_TEXT = "EVO V2 provider validation: reviewed by Admin.";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROVIDER_ID = /^[1-9][0-9]{0,9}$/u;
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const OPERATIONS = Object.freeze([
  "contact_create",
  "lead_create",
  "contact_lead_link",
  "lead_pipeline_status_update",
  "lead_responsible_update",
  "lead_note_create",
  "lead_tag_update",
]);

test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe.configure({ mode: "serial" });
test.skip(
  process.env.EVO_V2_REAL_AMOCRM_ACCEPTANCE !== "1",
  "requires the explicit connected-provider acceptance harness",
);

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required acceptance input: ${name}`);
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown, message: string): Record<string, unknown> {
  ensure(value !== null && typeof value === "object" && !Array.isArray(value), message);
  return value as Record<string, unknown>;
}

function array(value: unknown, message: string): unknown[] {
  ensure(Array.isArray(value) && value.length <= 10_000, message);
  return value;
}

function providerId(value: unknown, message: string): string {
  const parsed =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value
        : "";
  ensure(PROVIDER_ID.test(parsed), message);
  return parsed;
}

async function privateJson(filePath: string, label: string) {
  const resolved = path.resolve(filePath);
  ensure(resolved === filePath, `${label} path is not absolute and normalized`);
  const status = await lstat(resolved);
  ensure(status.isFile() && !status.isSymbolicLink(), `${label} is not a regular file`);
  ensure((status.mode & 0o077) === 0, `${label} permissions are not private`);
  ensure(status.size > 0 && status.size <= 256 * 1024, `${label} size is invalid`);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(resolved, "utf8"));
  } catch {
    throw new Error(`${label} is not valid private JSON`);
  }
  return record(value, `${label} shape is invalid`);
}

async function durableCreateJson(
  filePath: string,
  value: Readonly<Record<string, unknown>>,
) {
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(filePath, 0o600);
  const directory = await open(path.dirname(filePath), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function requiredMode(): "blocked" | "dispatch" {
  const mode = process.env.EVO_V2_CONNECTED_AMOCRM_MODE;
  if (mode !== "blocked" && mode !== "dispatch") {
    throw new Error("EVO_V2_CONNECTED_AMOCRM_MODE is invalid");
  }
  return mode;
}

function acceptanceInputs() {
  const gitSha = requireEnv("EVO_V2_ACCEPTANCE_MAIN_SHA");
  ensure(SHA40.test(gitSha), "Acceptance requires an exact main SHA");
  const evidenceDir = path.resolve(requireEnv("EVO_V2_AMOCRM_EVIDENCE_DIR"));
  const expectedEvidenceDir = path.resolve(
    process.cwd(),
    "output",
    "provider-acceptance",
    "amocrm",
    gitSha,
  );
  ensure(
    evidenceDir === expectedEvidenceDir,
    "Connected-provider evidence path escaped the exact-SHA root",
  );
  return Object.freeze({
    gitSha,
    evidenceDir,
    runtimeFile: path.resolve(requireEnv("EVO_V2_AMOCRM_PRIVATE_RUNTIME_FILE")),
    contextFile: path.resolve(requireEnv("EVO_V2_AMOCRM_PRIVATE_CONTEXT_FILE")),
  });
}

async function submitAdminGate(page: Page) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page
    .locator("#staff-email")
    .fill(requireEnv("EVO_STAFF_AUTH_ADMIN_EMAIL"));
  await page.locator("#staff-password").fill(requireEnv("EVO_STAFF_AUTH_ADMIN_PASSWORD"));
  await page.getByRole("button", { name: "Войти в CRM" }).click();
  await expect(page.getByTestId("staff-entry-workspace")).toBeVisible();
  await page.getByTestId("open-role-workspace").click();
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-authority-role",
    "admin",
  );
}

async function zeroMutationProof(connectionString: string, leadId: string) {
  const sql = postgres(connectionString, { max: 1, onnotice: () => undefined });
  try {
    const rows = await sql<
      Array<{
        attempt_count: number;
        contact_binding_count: number;
        lead_binding_count: number;
      }>
    >`
      select
        (select count(*)::integer
          from evo_amocrm_operation_attempts
        ) as attempt_count,
        (select count(*)::integer
          from evo_amocrm_lead_bindings
          where lead_id = ${leadId}) as lead_binding_count,
        (select count(*)::integer
          from evo_amocrm_contact_bindings
          where person_id = (select person_id from evo_leads where id = ${leadId}))
          as contact_binding_count
    `;
    ensure(rows.length === 1, "PostgreSQL zero-mutation proof was ambiguous");
    return Object.freeze(rows[0]);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

type AcceptedAttempt = Readonly<{
  operation_name: string;
  status: string;
  correlation_id: string;
  provider_http_status: number | null;
  provider_dispatched_at: Date | null;
  provider_responded_at: Date | null;
  provider_readback: Record<string, unknown> | null;
  provider_readback_sha256: string | null;
  receipt_status: string;
  receipt_correlation_id: string;
  receipt_id: string;
}>;

async function acceptedDatabaseProof(
  connectionString: string,
  input: Readonly<{
    leadId: string;
    requestId: string;
    seedCorrelationId: string;
    discoverySnapshotSha256: string;
  }>,
) {
  const sql = postgres(connectionString, { max: 1, onnotice: () => undefined });
  try {
    const attempts = await sql<AcceptedAttempt[]>`
      select
        attempt.operation_name,
        attempt.status,
        attempt.correlation_id,
        attempt.provider_http_status,
        attempt.provider_dispatched_at,
        attempt.provider_responded_at,
        attempt.provider_readback,
        attempt.provider_readback_sha256,
        receipt.status as receipt_status,
        receipt.correlation_id as receipt_correlation_id,
        receipt.id as receipt_id
      from evo_amocrm_operation_attempts attempt
      inner join evo_command_receipts receipt
        on receipt.id = attempt.command_receipt_id
      where attempt.correlation_id = ${input.requestId}
      order by attempt.created_at, attempt.id
    `;
    ensure(attempts.length === OPERATIONS.length, "The UI sync did not persist exactly seven provider attempts");
    ensure(
      new Set(attempts.map((attempt) => attempt.operation_name)).size ===
        OPERATIONS.length &&
        OPERATIONS.every((operation) =>
          attempts.some((attempt) => attempt.operation_name === operation),
        ),
      "The UI sync did not persist the exact canonical operation set",
    );
    ensure(
      attempts.every(
        (attempt) =>
          attempt.status === "accepted" &&
          attempt.receipt_status === "succeeded" &&
          attempt.correlation_id === input.requestId &&
          attempt.receipt_correlation_id === input.requestId &&
          attempt.provider_http_status !== null &&
          attempt.provider_http_status >= 200 &&
          attempt.provider_http_status < 300 &&
          attempt.provider_dispatched_at instanceof Date &&
          attempt.provider_responded_at instanceof Date &&
          attempt.provider_readback !== null &&
          typeof attempt.provider_readback_sha256 === "string" &&
          SHA256.test(attempt.provider_readback_sha256),
      ),
      "At least one canonical provider attempt lacks accepted readback evidence",
    );
    ensure(
      new Set(attempts.map((attempt) => attempt.receipt_id)).size ===
        OPERATIONS.length,
      "The canonical provider attempts did not retain seven distinct receipts",
    );

    const bindingRows = await sql<
      Array<{
        provider_contact_id: string;
        provider_lead_id: string;
      }>
    >`
      select contact.provider_contact_id, lead.provider_lead_id
      from evo_leads canonical_lead
      inner join evo_amocrm_contact_bindings contact
        on contact.person_id = canonical_lead.person_id
      inner join evo_amocrm_lead_bindings lead
        on lead.lead_id = canonical_lead.id
        and lead.account_id = contact.account_id
      where canonical_lead.id = ${input.leadId}
    `;
    ensure(bindingRows.length === 1, "PostgreSQL did not retain one exact contact/lead binding pair");
    const providerContactId = providerId(
      bindingRows[0].provider_contact_id,
      "The contact binding identity is invalid",
    );
    const providerLeadId = providerId(
      bindingRows[0].provider_lead_id,
      "The lead binding identity is invalid",
    );

    const noteAttempt = attempts.find(
      (attempt) => attempt.operation_name === "lead_note_create",
    );
    ensure(noteAttempt?.provider_readback, "The note attempt lacks readback evidence");
    const providerNoteId = providerId(
      noteAttempt.provider_readback.entityId,
      "The note readback identity is invalid",
    );
    const tagAttempt = attempts.find(
      (attempt) => attempt.operation_name === "lead_tag_update",
    );
    ensure(tagAttempt?.provider_readback, "The tag attempt lacks readback evidence");
    const providerManagedTagId = providerId(
      tagAttempt.provider_readback.tagId,
      "The managed tag readback identity is invalid",
    );

    const eventRows = await sql<
      Array<{ correlation_id: string; transition: string }>
    >`
      select correlation_id, transition
      from evo_business_events
      where business_object_id = ${input.leadId}
        and transition = 'lead.created'
    `;
    ensure(
      eventRows.length === 1 &&
        eventRows[0].correlation_id === input.seedCorrelationId,
      "The validation lead event is not correlated to its exact seed command",
    );

    const discoveryRows = await sql<Array<{ count: number }>>`
      select count(*)::integer as count
      from evo_amocrm_discovery_snapshots
      where snapshot_sha256 = ${input.discoverySnapshotSha256}
    `;
    ensure(
      discoveryRows.length === 1 && discoveryRows[0].count === 1,
      "The provider discovery snapshot was not durably persisted once",
    );

    return Object.freeze({
      attemptCount: attempts.length,
      receiptCount: new Set(attempts.map((attempt) => attempt.receipt_id)).size,
      contactBindingCount: 1,
      leadBindingCount: 1,
      eventCount: eventRows.length,
      discoverySnapshotCount: discoveryRows[0].count,
      providerContactId,
      providerLeadId,
      providerNoteId,
      providerManagedTagId,
      readbackSetSha256: sha256(
        attempts
          .map((attempt) => attempt.provider_readback_sha256)
          .sort()
          .join(":"),
      ),
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function providerGet(
  origin: string,
  pathName: string,
  accessToken: string,
) {
  let response: Response;
  try {
    response = await fetch(`${origin}${pathName}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("The exact provider readback was unavailable");
  }
  ensure(response.ok, "The exact provider readback was rejected");
  const raw = await response.text();
  ensure(Buffer.byteLength(raw, "utf8") <= 256 * 1024, "Provider readback exceeded the safe bound");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("The exact provider readback was not valid JSON");
  }
  return record(value, "The exact provider readback shape was invalid");
}

async function exactProviderReadback(
  runtime: Record<string, unknown>,
  context: Record<string, unknown>,
  database: Awaited<ReturnType<typeof acceptedDatabaseProof>>,
) {
  const providerEnvironment = record(
    runtime.providerEnvironment,
    "The private provider environment is invalid",
  );
  const baseUrl = providerEnvironment.EVO_V2_AMOCRM_BASE_URL;
  const tokenPath = providerEnvironment.EVO_V2_AMOCRM_TOKEN_FILE;
  ensure(typeof baseUrl === "string", "The private provider base URL is invalid");
  ensure(typeof tokenPath === "string", "The private provider token path is invalid");
  const parsedBase = new URL(baseUrl);
  ensure(
    parsedBase.protocol === "https:" &&
      parsedBase.origin === baseUrl.replace(/\/$/u, "") &&
      /\.(amocrm\.ru|kommo\.com)$/u.test(parsedBase.hostname),
    "The private provider origin is invalid",
  );
  const token = await privateJson(path.resolve(tokenPath), "Private OAuth token");
  const accessToken = token.access_token;
  ensure(
    typeof accessToken === "string" && accessToken.length >= 1,
    "The private OAuth access token is invalid",
  );

  const routing = record(context.routing, "The private routing context is invalid");
  const sales = record(routing.sales, "The private Sales routing context is invalid");
  const admissions = record(
    routing.admissions,
    "The private Admissions routing context is invalid",
  );
  const fields = record(
    routing.contactCustomFields,
    "The private contact-field routing is invalid",
  );
  const displayName = context.displayName;
  const expectedPhoneSha256 = context.selfPhoneSha256;
  ensure(typeof displayName === "string", "The private validation name is invalid");
  ensure(
    typeof expectedPhoneSha256 === "string" && SHA256.test(expectedPhoneSha256),
    "The private validation phone digest is invalid",
  );

  const contact = await providerGet(
    parsedBase.origin,
    `/api/v4/contacts/${database.providerContactId}?with=leads`,
    accessToken,
  );
  ensure(
    providerId(contact.id, "Provider contact readback identity changed") ===
      database.providerContactId && contact.name === displayName,
    "Provider contact readback did not match the validation entity",
  );
  const phoneFields = array(
    contact.custom_fields_values,
    "Provider contact custom fields were invalid",
  ).filter((fieldValue) => {
    const field = record(fieldValue, "Provider contact custom field was invalid");
    return providerId(field.field_id, "Provider contact field identity was invalid") ===
      String(fields.phoneFieldId);
  });
  ensure(phoneFields.length === 1, "Provider contact phone field was not exact");
  const phoneValues = array(
    record(phoneFields[0], "Provider contact phone field was invalid").values,
    "Provider contact phone values were invalid",
  );
  ensure(phoneValues.length === 1, "Provider contact phone value was not exact");
  const phoneValue = record(phoneValues[0], "Provider contact phone value was invalid").value;
  ensure(
    typeof phoneValue === "string" && sha256(phoneValue) === expectedPhoneSha256,
    "Provider contact phone did not match the connected WAHA self identity",
  );

  const lead = await providerGet(
    parsedBase.origin,
    `/api/v4/leads/${database.providerLeadId}?with=contacts`,
    accessToken,
  );
  ensure(
    providerId(lead.id, "Provider lead readback identity changed") ===
      database.providerLeadId &&
      lead.name === displayName &&
      providerId(lead.pipeline_id, "Provider lead pipeline was invalid") ===
        String(sales.pipelineId) &&
      providerId(lead.status_id, "Provider lead status was invalid") ===
        String(sales.statusId) &&
      providerId(
        lead.responsible_user_id,
        "Provider lead responsible user was invalid",
      ) === String(sales.responsibleUserId),
    "Provider lead readback did not match the exact Sales route",
  );
  const leadTags = array(
    record(lead._embedded, "Provider lead embedded data was invalid").tags,
    "Provider lead tags were invalid",
  ).map((tagValue) => {
    const tag = record(tagValue, "Provider lead tag was invalid");
    return Object.freeze({
      id: providerId(tag.id, "Provider lead tag identity was invalid"),
      name: tag.name,
    });
  });
  const exactSalesTags = leadTags.filter(
    (tag) => tag.name === "EVO V2 Sales",
  );
  ensure(
    exactSalesTags.length === 1 &&
      exactSalesTags[0].id === database.providerManagedTagId &&
      (sales.tagId === null || exactSalesTags[0].id === String(sales.tagId)) &&
      !leadTags.some((tag) => tag.name === "EVO V2 Admissions") &&
      (admissions.tagId === null ||
        !leadTags.some((tag) => tag.id === String(admissions.tagId))),
    "Provider lead tags did not preserve the exact fixed-role state",
  );

  const links = await providerGet(
    parsedBase.origin,
    `/api/v4/leads/${database.providerLeadId}/links`,
    accessToken,
  );
  const mainContacts = array(
    record(links._embedded, "Provider link readback was invalid").links,
    "Provider link collection was invalid",
  ).filter((linkValue) => {
    const link = record(linkValue, "Provider link was invalid");
    const metadata = record(link.metadata, "Provider link metadata was invalid");
    return link.to_entity_type === "contacts" && metadata.main_contact === true;
  });
  ensure(mainContacts.length === 1, "Provider lead did not retain exactly one main contact");
  ensure(
    providerId(
      record(mainContacts[0], "Provider main contact link was invalid").to_entity_id,
      "Provider main contact identity was invalid",
    ) === database.providerContactId,
    "Provider main contact link changed identity",
  );

  const note = await providerGet(
    parsedBase.origin,
    `/api/v4/leads/notes/${database.providerNoteId}`,
    accessToken,
  );
  const noteParams = record(note.params, "Provider note parameters were invalid");
  ensure(
    providerId(note.id, "Provider note identity changed") ===
      database.providerNoteId &&
      providerId(note.entity_id, "Provider note lead identity changed") ===
        database.providerLeadId &&
      noteParams.text === NOTE_TEXT,
    "Provider note readback did not match the reviewed text",
  );

  // Provider-side scoped collections are the duplicate detector. Re-reading
  // only the IDs persisted in PostgreSQL would miss an accidental extra
  // contact, lead, or note created by an exact replay.
  const contactSearch = await providerGet(
    parsedBase.origin,
    `/api/v4/contacts?limit=250&filter%5Bname%5D%5B%5D=${encodeURIComponent(displayName)}`,
    accessToken,
  );
  const validationContacts = array(
    record(
      contactSearch._embedded,
      "Provider contact search envelope was invalid",
    ).contacts,
    "Provider contact search collection was invalid",
  ).filter((candidate) => {
    const scopedContact = record(candidate, "Provider contact search item was invalid");
    return scopedContact.name === displayName;
  });
  ensure(
    validationContacts.length === 1,
    "Provider validation scope contains a duplicate or changed contact",
  );
  const validationContactId = providerId(
    record(validationContacts[0], "Provider validation contact was invalid").id,
    "Provider validation contact identity was invalid",
  );
  ensure(
    validationContactId === database.providerContactId,
    "Provider validation contact changed identity",
  );

  const leadSearch = await providerGet(
    parsedBase.origin,
    `/api/v4/leads?limit=250&filter%5Bname%5D%5B%5D=${encodeURIComponent(displayName)}`,
    accessToken,
  );
  const validationLeads = array(
    record(leadSearch._embedded, "Provider lead search envelope was invalid").leads,
    "Provider lead search collection was invalid",
  ).filter((candidate) => {
    const scopedLead = record(candidate, "Provider lead search item was invalid");
    return scopedLead.name === displayName;
  });
  ensure(
    validationLeads.length === 1,
    "Provider validation scope contains a duplicate or changed lead",
  );
  const validationLeadId = providerId(
    record(validationLeads[0], "Provider validation lead was invalid").id,
    "Provider validation lead identity was invalid",
  );
  ensure(
    validationLeadId === database.providerLeadId,
    "Provider validation lead changed identity",
  );

  const noteSearch = await providerGet(
    parsedBase.origin,
    `/api/v4/leads/${database.providerLeadId}/notes?limit=250&filter%5Bnote_type%5D%5B%5D=common`,
    accessToken,
  );
  const validationNotes = array(
    record(noteSearch._embedded, "Provider note search envelope was invalid").notes,
    "Provider note search collection was invalid",
  ).filter((candidate) => {
    const scopedNote = record(candidate, "Provider note search item was invalid");
    const params = record(scopedNote.params, "Provider note search params were invalid");
    return scopedNote.note_type === "common" && params.text === NOTE_TEXT;
  });
  ensure(
    validationNotes.length === 1,
    "Provider validation scope contains a duplicate or changed reviewed note",
  );
  const validationNoteId = providerId(
    record(validationNotes[0], "Provider validation note was invalid").id,
    "Provider validation note identity was invalid",
  );
  ensure(
    validationNoteId === database.providerNoteId,
    "Provider validation note changed identity",
  );

  return Object.freeze({
    exactReadback: true,
    entitySetSha256: sha256(
      [
        `contact:${validationContactId}`,
        `lead:${validationLeadId}`,
        `note:${validationNoteId}`,
      ].join(":"),
    ),
    validationContactCount: validationContacts.length,
    validationLeadCount: validationLeads.length,
    validationNoteCount: validationNotes.length,
    managedRoleTagCount: 1,
    mainContactCount: mainContacts.length,
  });
}

test("disabled provider authority fails clearly in the real browser before any provider dispatch", async ({
  page,
}) => {
  test.skip(requiredMode() !== "blocked", "dispatch pass runs this exact spec separately");
  const { gitSha, evidenceDir, contextFile } = acceptanceInputs();
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await chmod(evidenceDir, 0o700);
  const context = await privateJson(contextFile, "Private validation context");
  const leadId = context.leadId;
  ensure(typeof leadId === "string" && UUID.test(leadId), "Validation lead identity is invalid");
  const before = await zeroMutationProof(requireEnv("DATABASE_URL"), leadId);
  ensure(
    before.attempt_count === 0 &&
      before.contact_binding_count === 0 &&
      before.lead_binding_count === 0,
    "Disabled-authority proof did not start from a clean canonical provider state",
  );

  await submitAdminGate(page);
  await page.goto(`/sales/${leadId}`);
  const panel = page.getByTestId("canonical-amocrm-command-panel");
  await expect(panel).toBeVisible();
  await expect(
    panel.getByTestId("canonical-amocrm-provider-availability"),
  ).toHaveAttribute("data-status", "blocked");
  await expect(
    panel.getByTestId("canonical-amocrm-provider-availability"),
  ).toContainText(
    /Серверное разрешение провайдера не включено\.|Server-side provider authorization is disabled\.|Сервердик провайдер уруксаты өчүрүлгөн\./u,
  );
  await expect(panel.getByTestId("canonical-amocrm-note-text")).toBeDisabled();
  await expect(panel.getByTestId("canonical-amocrm-sync")).toBeDisabled();

  const after = await zeroMutationProof(requireEnv("DATABASE_URL"), leadId);
  ensure(
    after.attempt_count === 0 &&
      after.contact_binding_count === 0 &&
      after.lead_binding_count === 0,
    "Disabled provider authority dispatched or persisted a fallback result",
  );
  await durableCreateJson(path.join(evidenceDir, "authority-blocked.json"), {
    schemaVersion: 1,
    kind: "evo-v2-connected-amocrm-authority-blocked",
    status: "passed",
    proofMode: "provider-not-authorized",
    gitSha,
    completedAt: new Date().toISOString(),
    checks: {
      providerAuthorization: "disabled",
      reason: "provider-not-authorized",
      browserBlocked: true,
      providerAttemptCount: 0,
      bindingCount: 0,
      fallbackObserved: false,
    },
  });
});

test("one explicit Admin browser sync persists and reads back the real amoCRM result", async ({
  page,
}) => {
  test.skip(requiredMode() !== "dispatch", "blocked-authority pass runs this exact spec separately");
  test.setTimeout(180_000);
  const { gitSha, evidenceDir, runtimeFile, contextFile } = acceptanceInputs();
  const blockedMarker = await privateJson(
    path.join(evidenceDir, "authority-blocked.json"),
    "Disabled-authority marker",
  );
  const preparationMarker = await privateJson(
    path.join(evidenceDir, "provider-preparation-attempt.json"),
    "Provider preparation marker",
  );
  ensure(
    blockedMarker.status === "passed" &&
      blockedMarker.gitSha === gitSha &&
      preparationMarker.status === "started" &&
      preparationMarker.gitSha === gitSha,
    "Required pre-dispatch boundaries were not proven at this exact SHA",
  );
  const runtime = await privateJson(runtimeFile, "Private provider runtime");
  const context = await privateJson(contextFile, "Private validation context");
  const leadId = context.leadId;
  const seedCorrelationId = context.seedCorrelationId;
  const discovery = record(context.discovery, "Private discovery context is missing");
  ensure(typeof leadId === "string" && UUID.test(leadId), "Validation lead identity is invalid");
  ensure(
    typeof seedCorrelationId === "string" && UUID.test(seedCorrelationId),
    "Seed correlation identity is invalid",
  );
  ensure(
    typeof discovery.snapshotSha256 === "string" &&
      SHA256.test(discovery.snapshotSha256),
    "Discovery snapshot digest is invalid",
  );
  const before = await zeroMutationProof(requireEnv("DATABASE_URL"), leadId);
  ensure(
    before.attempt_count === 0 &&
      before.contact_binding_count === 0 &&
      before.lead_binding_count === 0,
    "Connected dispatch did not start from a clean canonical binding state",
  );

  await submitAdminGate(page);
  await page.goto(`/sales/${leadId}`);
  const panel = page.getByTestId("canonical-amocrm-command-panel");
  await expect(panel).toBeVisible();
  await expect(
    panel.getByTestId("canonical-amocrm-provider-availability"),
  ).toHaveAttribute("data-status", "ready");
  const requestId = await panel
    .getByTestId("canonical-amocrm-sync-form")
    .locator('input[name="request_id"]')
    .inputValue();
  ensure(UUID.test(requestId), "The browser command request identity is invalid");

  await durableCreateJson(path.join(evidenceDir, "dispatch-attempt.json"), {
    schemaVersion: 1,
    kind: "evo-v2-connected-amocrm-ui-dispatch",
    status: "started",
    gitSha,
    startedAt: new Date().toISOString(),
    action: "one_explicit_admin_sync",
    reviewedNoteSha256: sha256(NOTE_TEXT),
  });
  await panel.getByTestId("canonical-amocrm-note-text").fill(NOTE_TEXT);
  await panel.getByTestId("canonical-amocrm-sync").click();
  await expect(
    panel.getByTestId("canonical-amocrm-command-state"),
  ).toHaveAttribute("data-status", "accepted", { timeout: 150_000 });
  const steps = panel.getByTestId("canonical-amocrm-command-step");
  await expect(steps).toHaveCount(OPERATIONS.length);
  for (const operation of OPERATIONS) {
    await expect(
      panel.locator(
        `[data-testid="canonical-amocrm-command-step"][data-operation="${operation}"]`,
      ),
    ).toHaveCount(1);
  }
  for (let index = 0; index < OPERATIONS.length; index += 1) {
    await expect(steps.nth(index)).toHaveAttribute("data-status", "accepted");
  }

  const database = await acceptedDatabaseProof(requireEnv("DATABASE_URL"), {
    leadId,
    requestId,
    seedCorrelationId,
    discoverySnapshotSha256: discovery.snapshotSha256,
  });
  const provider = await exactProviderReadback(runtime, context, database);

  // Re-submit the exact browser command identity and payload. A normal server
  // refresh may rotate the hidden request ID, so this acceptance-only probe
  // restores the original value in the rendered form to emulate an exact
  // transport replay. The canonical service must return stored success without
  // another provider mutation.
  const replayRequestInput = panel
    .getByTestId("canonical-amocrm-sync-form")
    .locator('input[name="request_id"]');
  await replayRequestInput.evaluate((element, exactRequestId) => {
    (element as HTMLInputElement).value = exactRequestId;
  }, requestId);
  await panel.getByTestId("canonical-amocrm-note-text").fill(NOTE_TEXT);
  const replayResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "POST" &&
      url.pathname === `/sales/${leadId}`
    );
  });
  await panel.getByTestId("canonical-amocrm-sync").click();
  const replayResponse = await replayResponsePromise;
  ensure(replayResponse.ok(), "The exact UI replay request was rejected");
  await expect(
    panel.getByTestId("canonical-amocrm-command-state"),
  ).toHaveAttribute("data-status", "accepted");
  const replayDatabase = await acceptedDatabaseProof(
    requireEnv("DATABASE_URL"),
    {
      leadId,
      requestId,
      seedCorrelationId,
      discoverySnapshotSha256: discovery.snapshotSha256,
    },
  );
  ensure(
    replayDatabase.attemptCount === database.attemptCount &&
      replayDatabase.receiptCount === database.receiptCount &&
      replayDatabase.contactBindingCount === database.contactBindingCount &&
      replayDatabase.leadBindingCount === database.leadBindingCount &&
      replayDatabase.providerContactId === database.providerContactId &&
      replayDatabase.providerLeadId === database.providerLeadId &&
      replayDatabase.providerNoteId === database.providerNoteId &&
      replayDatabase.providerManagedTagId === database.providerManagedTagId &&
      replayDatabase.readbackSetSha256 === database.readbackSetSha256,
    "Exact UI replay created a new attempt, receipt, binding or provider entity",
  );
  const replayProvider = await exactProviderReadback(
    runtime,
    context,
    replayDatabase,
  );
  ensure(
    replayProvider.exactReadback === true &&
      replayProvider.entitySetSha256 === provider.entitySetSha256 &&
      replayProvider.validationContactCount === provider.validationContactCount &&
      replayProvider.validationLeadCount === provider.validationLeadCount &&
      replayProvider.validationNoteCount === provider.validationNoteCount &&
      replayProvider.managedRoleTagCount === provider.managedRoleTagCount &&
      replayProvider.mainContactCount === provider.mainContactCount,
    "Exact UI replay changed the provider entity set",
  );

  await page.reload();
  await expect(page.getByTestId("canonical-sales-lead-workspace")).toBeVisible();
  await expect(
    page
      .getByTestId("canonical-amocrm-command-panel")
      .getByTestId("canonical-amocrm-provider-availability"),
  ).toHaveAttribute("data-status", "ready");
  const afterReload = await acceptedDatabaseProof(requireEnv("DATABASE_URL"), {
    leadId,
    requestId,
    seedCorrelationId,
    discoverySnapshotSha256: discovery.snapshotSha256,
  });
  ensure(
    afterReload.attemptCount === database.attemptCount &&
      afterReload.receiptCount === database.receiptCount &&
      afterReload.readbackSetSha256 === database.readbackSetSha256,
    "Reload changed the persisted canonical provider result",
  );

  await durableCreateJson(path.join(evidenceDir, "success.json"), {
    schemaVersion: 1,
    kind: "evo-v2-connected-amocrm-validation",
    status: "passed",
    gitSha,
    completedAt: new Date().toISOString(),
    action: "one_explicit_admin_sync",
    reviewedNoteSha256: sha256(NOTE_TEXT),
    discovery: {
      snapshotSha256: discovery.snapshotSha256,
      routingSha256: discovery.routingSha256,
      managedTagCountBeforeCommand: discovery.managedTagCountBeforeCommand,
      activeCurrentUserCount: discovery.activeCurrentUserCount,
    },
    provider: {
      exactReadback: provider.exactReadback,
      entitySetSha256: provider.entitySetSha256,
      validationContactCount: provider.validationContactCount,
      validationLeadCount: provider.validationLeadCount,
      validationNoteCount: provider.validationNoteCount,
      managedRoleTagCount: provider.managedRoleTagCount,
      mainContactCount: provider.mainContactCount,
    },
    database: {
      attemptCount: database.attemptCount,
      receiptCount: database.receiptCount,
      contactBindingCount: database.contactBindingCount,
      leadBindingCount: database.leadBindingCount,
      eventCount: database.eventCount,
      discoverySnapshotCount: database.discoverySnapshotCount,
      readbackSetSha256: database.readbackSetSha256,
      exactUiReplay: true,
      replayAddedAttemptCount: 0,
      replayAddedReceiptCount: 0,
      replayAddedBindingCount: 0,
      replayProviderEntitySetUnchanged: true,
      persistedAfterReload: true,
    },
    boundaries: {
      database: "disposable_local_postgresql",
      target: "connected_waha_session_self_validation_entity",
      v1ApplicationPathExecuted: false,
      existingWahaSessionReadOnly: true,
      deploymentMutated: false,
      fallbackObserved: false,
    },
  });
});
