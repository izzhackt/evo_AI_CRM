#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parseEnv } from "node:util";

const PRIVATE_FILE_MAX_BYTES = 256 * 1024;
const PROVIDER_ID = /^[1-9][0-9]{0,9}$/u;
const DIRECT_SELF_ID = /^[1-9][0-9]{4,31}@(c\.us|lid)$/u;
const SHA40 = /^[0-9a-f]{40}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MANAGED_TAGS = Object.freeze({
  sales: "EVO V2 Sales",
  admissions: "EVO V2 Admissions",
});
const ACTIVE_WAHA_SESSION = "crm_primary";
const LEGACY_KEYS = Object.freeze({
  baseUrl: "EVO_AGENT_AMO_BASE_URL",
  wahaApiKey: "EVO_AGENT_WAHA_API_KEY",
  wahaSession: "EVO_AGENT_WAHA_SESSION",
});

class ValidationPreparationError extends Error {
  constructor(code) {
    super("Connected amoCRM validation preparation failed.");
    this.name = "ValidationPreparationError";
    this.code = code;
  }
}

function fail(code) {
  throw new ValidationPreparationError(code);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactText(value, code, maximumBytes = 4_096) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    Buffer.byteLength(value, "utf8") > maximumBytes
  ) {
    fail(code);
  }
  return value;
}

function exactProviderId(value, code = "provider_response_invalid") {
  const parsed =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value
        : "";
  if (!PROVIDER_ID.test(parsed) || Number(parsed) > 2_147_483_647) fail(code);
  return parsed;
}

function localSupabaseDatabaseUrl() {
  const value = exactText(
    process.env.EVO_V2_SUPABASE_DATABASE_URL,
    "local_supabase_database_url_invalid",
    4_096,
  );
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("local_supabase_database_url_invalid");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.username.length === 0 ||
    parsed.password.length === 0 ||
    parsed.pathname.length <= 1 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    fail("local_supabase_database_url_invalid");
  }
  return value;
}

function validatePrivateIpv4(parsed) {
  const value = requiredOption(parsed, "value");
  if (isIP(value) !== 4) fail("private_tunnel_address_invalid");

  const [first, second] = value.split(".").map(Number);
  const isPrivate =
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
  if (!isPrivate) fail("private_tunnel_address_invalid");
}

function record(value, code = "private_input_invalid") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}

function array(value, code = "provider_response_invalid") {
  if (!Array.isArray(value) || value.length > 10_000) fail(code);
  return value;
}

function embedded(value, collection) {
  const root = record(value, "provider_response_invalid");
  const holder = record(root._embedded, "provider_response_invalid");
  return array(holder[collection]);
}

function parseOptions(rawArgs) {
  const options = new Map();
  let commandArgs = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];
    if (argument === "--") {
      commandArgs = rawArgs.slice(index + 1);
      break;
    }
    if (!argument.startsWith("--") || argument.includes("=")) {
      fail("arguments_invalid");
    }
    const name = argument.slice(2);
    const value = rawArgs[index + 1];
    if (!name || value === undefined || value === "--" || options.has(name)) {
      fail("arguments_invalid");
    }
    options.set(name, value);
    index += 1;
  }
  return Object.freeze({ options, commandArgs });
}

function requiredOption(parsed, name) {
  const value = parsed.options.get(name);
  if (value === undefined) fail("arguments_invalid");
  return value;
}

function assertExactOptions(parsed, allowedNames, commandRequired = false) {
  const allowed = new Set(allowedNames);
  if (
    [...parsed.options.keys()].some((name) => !allowed.has(name)) ||
    (commandRequired
      ? parsed.commandArgs.length < 1
      : parsed.commandArgs.length !== 0)
  ) {
    fail("arguments_invalid");
  }
}

function absolutePath(value, code = "private_path_invalid") {
  const safe = exactText(value, code);
  if (!isAbsolute(safe) || resolve(safe) !== safe) fail(code);
  return safe;
}

async function assertPrivateFile(filePath, code) {
  const safePath = absolutePath(filePath, code);
  let status;
  try {
    status = await lstat(safePath);
  } catch {
    fail(code);
  }
  if (
    !status.isFile() ||
    status.isSymbolicLink() ||
    status.size < 1 ||
    status.size > PRIVATE_FILE_MAX_BYTES ||
    (status.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && status.uid !== process.getuid())
  ) {
    fail(code);
  }
  return safePath;
}

async function syncDirectory(filePath) {
  const directoryHandle = await open(dirname(filePath), "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

async function createPrivateJson(filePath, value) {
  const safePath = absolutePath(filePath);
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > PRIVATE_FILE_MAX_BYTES) {
    fail("private_output_too_large");
  }
  const handle = await open(safePath, "wx", 0o600);
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(safePath, 0o600);
  await syncDirectory(safePath);
}

async function replacePrivateJson(filePath, value) {
  const safePath = absolutePath(filePath);
  const temporaryPath = join(
    dirname(safePath),
    `.${basename(safePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > PRIVATE_FILE_MAX_BYTES) {
    fail("private_output_too_large");
  }
  let handle = null;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, safePath);
    await syncDirectory(safePath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function readPrivateJson(filePath, code) {
  const safePath = await assertPrivateFile(filePath, code);
  let value;
  try {
    value = JSON.parse(await readFile(safePath, "utf8"));
  } catch {
    fail(code);
  }
  return record(value, code);
}

function requiredLegacyValue(values, key, code, maximumBytes) {
  return exactText(values[key], code, maximumBytes);
}

async function mapLegacyProvider(parsed) {
  const providerEnvPath = await assertPrivateFile(
    requiredOption(parsed, "provider-env"),
    "legacy_provider_env_invalid",
  );
  const tokenFilePath = await assertPrivateFile(
    requiredOption(parsed, "token-file"),
    "token_file_invalid",
  );
  const outputPath = absolutePath(requiredOption(parsed, "runtime-file"));

  let values;
  try {
    values = parseEnv(await readFile(providerEnvPath, "utf8"));
  } catch {
    fail("legacy_provider_env_invalid");
  }

  const providerEnvironment = Object.freeze({
    EVO_V2_AMOCRM_BASE_URL: requiredLegacyValue(
      values,
      LEGACY_KEYS.baseUrl,
      "legacy_amocrm_base_url_invalid",
      2_048,
    ),
    // The legacy EVO_AGENT_AMO_TOKEN_FILE path is deliberately not trusted.
    // The harness maps only the caller's explicit private token copy.
    EVO_V2_AMOCRM_TOKEN_FILE: tokenFilePath,
  });
  const waha = Object.freeze({
    apiKey: requiredLegacyValue(
      values,
      LEGACY_KEYS.wahaApiKey,
      "legacy_waha_api_key_invalid",
      4_096,
    ),
    sessionName: requiredLegacyValue(
      values,
      LEGACY_KEYS.wahaSession,
      "legacy_waha_session_invalid",
      128,
    ),
  });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(waha.sessionName)) {
    fail("legacy_waha_session_invalid");
  }
  if (waha.sessionName !== ACTIVE_WAHA_SESSION) {
    fail("legacy_waha_session_invalid");
  }

  let token;
  try {
    token = JSON.parse(await readFile(tokenFilePath, "utf8"));
  } catch {
    fail("token_file_invalid");
  }
  const tokenRecord = record(token, "token_file_invalid");
  const tokenKeys = Object.keys(tokenRecord).sort();
  if (
    tokenKeys.length !== 2 ||
    tokenKeys[0] !== "access_token" ||
    tokenKeys[1] !== "token_type"
  ) {
    fail("token_file_invalid");
  }
  exactText(tokenRecord.access_token, "token_file_invalid", 16_384);
  if (
    exactText(
      tokenRecord.token_type,
      "token_file_invalid",
      32,
    ).toLowerCase() !== "bearer"
  ) {
    fail("token_file_invalid");
  }

  await createPrivateJson(outputPath, {
    schemaVersion: 1,
    providerEnvironment,
    waha,
  });
}

function loopbackBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(exactText(value, "waha_tunnel_url_invalid", 2_048));
  } catch {
    fail("waha_tunnel_url_invalid");
  }
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    !parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    fail("waha_tunnel_url_invalid");
  }
  return parsed.origin;
}

async function readWahaSelf(parsed) {
  const runtime = await readPrivateJson(
    requiredOption(parsed, "runtime-file"),
    "runtime_file_invalid",
  );
  const waha = record(runtime.waha, "runtime_file_invalid");
  const apiKey = exactText(waha.apiKey, "runtime_file_invalid", 4_096);
  const sessionName = exactText(waha.sessionName, "runtime_file_invalid", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(sessionName)) {
    fail("runtime_file_invalid");
  }
  const baseUrl = loopbackBaseUrl(requiredOption(parsed, "base-url"));

  let response;
  try {
    response = await fetch(
      `${baseUrl}/api/sessions/${encodeURIComponent(sessionName)}`,
      {
        method: "GET",
        headers: { Accept: "application/json", "X-Api-Key": apiKey },
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      },
    );
  } catch {
    fail("waha_session_unavailable");
  }
  if (!response.ok) fail("waha_session_unavailable");
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > 64 * 1024) {
    fail("waha_session_response_invalid");
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail("waha_session_response_invalid");
  }
  const session = record(value, "waha_session_response_invalid");
  const me = record(session.me, "waha_session_response_invalid");
  if (session.status !== "WORKING") fail("waha_session_not_working");
  const identities = [me.id, me.lid]
    .filter((candidate) => candidate !== undefined)
    .map((candidate) =>
      exactText(candidate, "waha_session_response_invalid", 64),
    );
  if (
    identities.length < 1 ||
    identities.some((identity) => !DIRECT_SELF_ID.test(identity)) ||
    new Set(identities).size !== identities.length
  ) {
    fail("waha_session_response_invalid");
  }
  const phoneIdentities = identities.filter((identity) =>
    identity.endsWith("@c.us"),
  );
  if (phoneIdentities.length !== 1) fail("waha_self_phone_unavailable");
  const digits = phoneIdentities[0].slice(0, -"@c.us".length);
  if (digits.length < 7 || digits.length > 15 || digits.startsWith("0")) {
    fail("waha_self_phone_unavailable");
  }
  await createPrivateJson(requiredOption(parsed, "self-file"), {
    schemaVersion: 1,
    phoneE164: `+${digits}`,
    selfIdentitySha256: sha256(phoneIdentities[0]),
  });
}

async function seedValidationLead(parsed) {
  const self = await readPrivateJson(
    requiredOption(parsed, "self-file"),
    "self_file_invalid",
  );
  const phoneE164 = exactText(self.phoneE164, "self_file_invalid", 32);
  if (!/^\+[1-9][0-9]{6,14}$/u.test(phoneE164)) fail("self_file_invalid");
  const selfIdentitySha256 = exactText(
    self.selfIdentitySha256,
    "self_file_invalid",
    64,
  );
  if (!/^[0-9a-f]{64}$/u.test(selfIdentitySha256)) fail("self_file_invalid");

  const seedCorrelationId = randomUUID();
  const clientId = randomUUID();
  const leadId = randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const displayName = `EVO V2 Provider Validation ${timestamp}`;
  const sourceRef = `connected-amocrm-acceptance:${seedCorrelationId}`;
  const adminEmail = exactText(
    process.env.EVO_STAFF_AUTH_ADMIN_EMAIL,
    "admin_identity_invalid",
    320,
  ).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(adminEmail)) {
    fail("admin_identity_invalid");
  }
  const postgres = (await import("postgres")).default;
  const sql = postgres(localSupabaseDatabaseUrl(), {
    max: 1,
    onnotice: () => undefined,
  });
  try {
    const seeded = await sql.begin(async (transaction) => {
      const authorityRows = await transaction`
        SELECT
          membership.organization_id,
          membership.id AS membership_id
        FROM auth.users AS auth_user
        JOIN platform.profiles AS profile
          ON profile.auth_user_id = auth_user.id
        JOIN platform.organization_memberships AS membership
          ON membership.profile_id = profile.id
        JOIN platform.organizations AS organization
          ON organization.id = membership.organization_id
        WHERE pg_catalog.lower(auth_user.email) = ${adminEmail}
          AND profile.status = 'active'
          AND membership.status = 'active'
          AND membership.current_role = 'admin'
          AND organization.status = 'active'
      `;
      if (
        authorityRows.length !== 1 ||
        !UUID.test(authorityRows[0].organization_id) ||
        !UUID.test(authorityRows[0].membership_id)
      ) {
        fail("admin_supabase_authority_invalid");
      }
      const organizationId = authorityRows[0].organization_id;
      const membershipId = authorityRows[0].membership_id;
      const observedAt = new Date();

      await transaction`
        INSERT INTO platform.clients (
          id,
          organization_id,
          display_name,
          normalized_name,
          phone,
          normalized_phone,
          lifecycle_state,
          created_at,
          updated_at
        ) VALUES (
          ${clientId},
          ${organizationId},
          ${displayName},
          platform_private.normalize_person_name(${displayName}),
          ${phoneE164},
          platform_private.normalize_person_phone(${phoneE164}),
          'active',
          ${observedAt},
          ${observedAt}
        )
      `;
      await transaction`
        INSERT INTO platform.leads (
          id,
          organization_id,
          client_id,
          current_owner_membership_id,
          stage_key,
          source_key,
          lifecycle_state,
          workflow_version,
          created_at,
          updated_at
        ) VALUES (
          ${leadId},
          ${organizationId},
          ${clientId},
          ${membershipId},
          'new',
          'provider_validation',
          'open',
          1,
          ${observedAt},
          ${observedAt}
        )
      `;
      await transaction`
        INSERT INTO platform.external_identifiers (
          organization_id,
          source_system,
          external_object_type,
          external_identifier,
          client_id,
          observed_at,
          imported_at,
          source_ref
        ) VALUES (
          ${organizationId},
          'provider_validation',
          'waha_self_client',
          ${seedCorrelationId},
          ${clientId},
          ${observedAt},
          ${observedAt},
          ${sourceRef}
        )
      `;
      await transaction`
        INSERT INTO platform.external_identifiers (
          organization_id,
          source_system,
          external_object_type,
          external_identifier,
          lead_id,
          observed_at,
          imported_at,
          source_ref
        ) VALUES (
          ${organizationId},
          'provider_validation',
          'amocrm_validation_lead',
          ${seedCorrelationId},
          ${leadId},
          ${observedAt},
          ${observedAt},
          ${sourceRef}
        )
      `;
      await transaction`
        INSERT INTO platform.subject_provenance (
          organization_id,
          client_id,
          source_system,
          evidence_type,
          observed_at,
          imported_at,
          source_ref
        ) VALUES (
          ${organizationId},
          ${clientId},
          'provider_validation',
          'connected_provider_acceptance',
          ${observedAt},
          ${observedAt},
          ${sourceRef}
        )
      `;
      await transaction`
        INSERT INTO platform.subject_provenance (
          organization_id,
          lead_id,
          source_system,
          evidence_type,
          observed_at,
          imported_at,
          source_ref
        ) VALUES (
          ${organizationId},
          ${leadId},
          'provider_validation',
          'connected_provider_acceptance',
          ${observedAt},
          ${observedAt},
          ${sourceRef}
        )
      `;
      const proofRows = await transaction`
        SELECT
          (SELECT pg_catalog.count(*)::integer
            FROM platform.clients AS client
            WHERE client.organization_id = ${organizationId}
              AND client.id = ${clientId}
              AND client.phone = ${phoneE164}) AS client_count,
          (SELECT pg_catalog.count(*)::integer
            FROM platform.leads AS lead
            WHERE lead.organization_id = ${organizationId}
              AND lead.id = ${leadId}
              AND lead.client_id = ${clientId}) AS lead_count,
          (SELECT pg_catalog.count(*)::integer
            FROM platform.subject_provenance AS provenance
            WHERE provenance.organization_id = ${organizationId}
              AND provenance.source_ref = ${sourceRef}) AS provenance_count
      `;
      if (
        proofRows.length !== 1 ||
        proofRows[0].client_count !== 1 ||
        proofRows[0].lead_count !== 1 ||
        proofRows[0].provenance_count !== 2
      ) {
        fail("validation_lead_count_invalid");
      }
      return Object.freeze({ organizationId });
    });
    await createPrivateJson(requiredOption(parsed, "context-file"), {
      schemaVersion: 1,
      databaseAuthority: "local_supabase_postgresql",
      organizationId: seeded.organizationId,
      clientId,
      leadId,
      displayName,
      selfPhoneSha256: sha256(phoneE164),
      selfIdentitySha256,
      seedCorrelationId,
      seedSourceRef: sourceRef,
      seedLeadCount: 1,
      seedProvenanceCount: 2,
      routing: null,
      discovery: null,
    });
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

function selectedProviderRouting(accountRaw, pipelinesRaw, usersRaw) {
  const account = record(accountRaw, "provider_response_invalid");
  const currentUserId = exactProviderId(account.current_user_id);
  const pipelines = embedded(pipelinesRaw, "pipelines");
  const mainPipelines = pipelines.filter((candidate) => {
    const pipeline = record(candidate, "provider_response_invalid");
    return pipeline.is_main === true && pipeline.is_archive === false;
  });
  if (mainPipelines.length !== 1) fail("main_pipeline_ambiguous");
  const mainPipeline = record(mainPipelines[0], "provider_response_invalid");
  const pipelineId = exactProviderId(mainPipeline.id);
  const statuses = embedded(mainPipeline, "statuses")
    .map((candidate) => {
      const status = record(candidate, "provider_response_invalid");
      return Object.freeze({
        id: exactProviderId(status.id),
        sort: Number.isSafeInteger(status.sort)
          ? status.sort
          : fail("provider_response_invalid"),
        type: Number.isSafeInteger(status.type)
          ? status.type
          : fail("provider_response_invalid"),
        isEditable: status.is_editable,
      });
    })
    .filter(
      (status) =>
        status.isEditable === true &&
        status.type === 0 &&
        status.id !== "142" &&
        status.id !== "143",
    )
    .sort(
      (left, right) =>
        left.sort - right.sort ||
        left.id.length - right.id.length ||
        left.id.localeCompare(right.id),
    );
  if (statuses.length < 2) fail("editable_statuses_insufficient");

  const currentUsers = embedded(usersRaw, "users").filter((candidate) => {
    const user = record(candidate, "provider_response_invalid");
    const rights = record(user.rights, "provider_response_invalid");
    return (
      exactProviderId(user.id) === currentUserId && rights.is_active === true
    );
  });
  if (currentUsers.length !== 1) fail("active_current_user_ambiguous");

  return Object.freeze({
    pipelineId,
    salesStatusId: statuses[0].id,
    admissionsStatusId: statuses[1].id,
    responsibleUserId: currentUserId,
    pipelineCount: pipelines.length,
    editableStatusCount: statuses.length,
    activeCurrentUserCount: currentUsers.length,
  });
}

function exactManagedTags(tagsRaw) {
  const tags = embedded(tagsRaw, "tags").map((candidate) => {
    const tag = record(candidate, "provider_response_invalid");
    return Object.freeze({
      id: exactProviderId(tag.id),
      name: exactText(tag.name, "provider_response_invalid", 128),
    });
  });
  const result = {};
  for (const [role, name] of Object.entries(MANAGED_TAGS)) {
    const matches = tags.filter((tag) => tag.name === name);
    if (matches.length > 1) fail("managed_tag_ambiguous");
    result[role] = matches[0] ?? null;
  }
  return Object.freeze({ tags, result: Object.freeze(result) });
}

async function discoverProviderRouting(parsed) {
  const runtimePath = requiredOption(parsed, "runtime-file");
  const contextPath = requiredOption(parsed, "context-file");
  const runtime = await readPrivateJson(runtimePath, "runtime_file_invalid");
  const context = await readPrivateJson(contextPath, "context_file_invalid");
  const providerEnvironment = record(
    runtime.providerEnvironment,
    "runtime_file_invalid",
  );

  const providerConfigModule =
    await import("../src/lib/server/canonical-amocrm-provider-config.ts");
  const providerModule =
    await import("../src/lib/server/canonical-amocrm-provider.ts");
  const commandConfigModule =
    await import("../src/lib/server/canonical-amocrm-command-config.ts");
  const discoveryRepositoryModule =
    await import("../src/lib/server/platform-amocrm-discovery-repository.ts");
  const discoveryModule =
    await import("../src/lib/server/canonical-amocrm-discovery-service.ts");
  const organizationId = exactText(
    context.organizationId,
    "context_file_invalid",
    36,
  );
  if (!UUID.test(organizationId)) fail("context_file_invalid");
  const providerConfig = providerConfigModule.loadCanonicalAmoCrmProviderConfig(
    {
      ...providerEnvironment,
      EVO_V2_AMOCRM_WRITES_ENABLED: "1",
      EVO_V2_AMOCRM_PROVIDER_AUTHORIZED: "1",
    },
  );
  if (providerConfig.status !== "ready") fail("provider_config_not_ready");
  const readProvider =
    providerModule.createCanonicalAmoCrmReadProvider(providerConfig);

  const accountRaw = await readProvider.getAccount();
  const pipelinesRaw = await readProvider.getPipelines();
  const usersRaw = await readProvider.getUsers();
  const selection = selectedProviderRouting(accountRaw, pipelinesRaw, usersRaw);

  const managed = exactManagedTags(await readProvider.getLeadTags());

  const commandEnvironment = Object.freeze({
    EVO_V2_AMOCRM_SALES_PIPELINE_ID: selection.pipelineId,
    EVO_V2_AMOCRM_SALES_STATUS_ID: selection.salesStatusId,
    EVO_V2_AMOCRM_SALES_RESPONSIBLE_USER_ID: selection.responsibleUserId,
    EVO_V2_AMOCRM_SALES_TAG_NAME: MANAGED_TAGS.sales,
    EVO_V2_AMOCRM_ADMISSIONS_PIPELINE_ID: selection.pipelineId,
    EVO_V2_AMOCRM_ADMISSIONS_STATUS_ID: selection.admissionsStatusId,
    EVO_V2_AMOCRM_ADMISSIONS_RESPONSIBLE_USER_ID: selection.responsibleUserId,
    EVO_V2_AMOCRM_ADMISSIONS_TAG_NAME: MANAGED_TAGS.admissions,
  });
  const commandConfig =
    commandConfigModule.loadCanonicalAmoCrmCommandConfig(commandEnvironment);
  const discovery = await discoveryModule.discoverCanonicalAmoCrmCommandRouting(
    {
      providerConfig,
      commandConfig,
      provider: readProvider,
      repository:
        discoveryRepositoryModule.createPlatformAmoCrmDiscoveryRepository({
          organizationId,
        }),
      correlationId: randomUUID(),
    },
  );

  const routing = Object.freeze({
    sales: discovery.sales,
    admissions: discovery.admissions,
    contactCustomFields: discovery.contactCustomFields,
  });
  await replacePrivateJson(contextPath, {
    ...context,
    routing,
    discovery: Object.freeze({
      snapshotId: discovery.discoverySnapshotId,
      snapshotSha256: discovery.snapshotSha256,
      routingSha256: sha256(JSON.stringify(routing)),
      pipelineCount: selection.pipelineCount,
      editableStatusCount: selection.editableStatusCount,
      activeCurrentUserCount: selection.activeCurrentUserCount,
      managedTagCountBeforeCommand: [
        managed.result.sales,
        managed.result.admissions,
      ].filter((tag) => tag !== null).length,
      leadTagCatalogCountBeforeCommand: managed.tags.length,
    }),
  });
}

async function createAttemptMarker(parsed) {
  const kind = requiredOption(parsed, "kind");
  const gitSha = requiredOption(parsed, "git-sha");
  if (kind !== "provider-preparation-attempt" || !SHA40.test(gitSha)) {
    fail("marker_input_invalid");
  }
  await createPrivateJson(requiredOption(parsed, "output"), {
    schemaVersion: 1,
    kind,
    status: "started",
    gitSha,
    startedAt: new Date().toISOString(),
  });
}

function appEnvironment(runtime, context, providerAuthorized) {
  const providerEnvironment = record(
    runtime.providerEnvironment,
    "runtime_file_invalid",
  );
  if (context.databaseAuthority !== "local_supabase_postgresql") {
    fail("context_file_invalid");
  }
  const environment = { ...process.env };
  delete environment.DATABASE_URL;
  delete environment.EVO_V2_SUPABASE_DATABASE_URL;
  for (const key of Object.keys(environment)) {
    if (
      key.startsWith("EVO_AGENT_AMO_") ||
      key.startsWith("EVO_PLATFORM_AMOCRM_") ||
      key.startsWith("EVO_V2_AMOCRM_")
    ) {
      delete environment[key];
    }
  }
  Object.assign(environment, providerEnvironment, {
    EVO_V2_AMOCRM_WRITES_ENABLED: "1",
    EVO_V2_AMOCRM_PROVIDER_AUTHORIZED: providerAuthorized ? "1" : "0",
  });
  if (providerAuthorized) {
    const routing = record(context.routing, "context_file_invalid");
    const sales = record(routing.sales, "context_file_invalid");
    const admissions = record(routing.admissions, "context_file_invalid");
    Object.assign(environment, {
      EVO_V2_AMOCRM_SALES_PIPELINE_ID: exactProviderId(
        sales.pipelineId,
        "context_file_invalid",
      ),
      EVO_V2_AMOCRM_SALES_STATUS_ID: exactProviderId(
        sales.statusId,
        "context_file_invalid",
      ),
      EVO_V2_AMOCRM_SALES_RESPONSIBLE_USER_ID: exactProviderId(
        sales.responsibleUserId,
        "context_file_invalid",
      ),
      EVO_V2_AMOCRM_SALES_TAG_NAME: exactText(
        sales.tagName,
        "context_file_invalid",
        128,
      ),
      EVO_V2_AMOCRM_ADMISSIONS_PIPELINE_ID: exactProviderId(
        admissions.pipelineId,
        "context_file_invalid",
      ),
      EVO_V2_AMOCRM_ADMISSIONS_STATUS_ID: exactProviderId(
        admissions.statusId,
        "context_file_invalid",
      ),
      EVO_V2_AMOCRM_ADMISSIONS_RESPONSIBLE_USER_ID: exactProviderId(
        admissions.responsibleUserId,
        "context_file_invalid",
      ),
      EVO_V2_AMOCRM_ADMISSIONS_TAG_NAME: exactText(
        admissions.tagName,
        "context_file_invalid",
        128,
      ),
    });
  }
  return environment;
}

async function runApp(parsed) {
  const runtime = await readPrivateJson(
    requiredOption(parsed, "runtime-file"),
    "runtime_file_invalid",
  );
  const context = await readPrivateJson(
    requiredOption(parsed, "context-file"),
    "context_file_invalid",
  );
  const authorization = requiredOption(parsed, "provider-authorized");
  if (authorization !== "0" && authorization !== "1") {
    fail("arguments_invalid");
  }
  if (parsed.commandArgs.length < 1) fail("arguments_invalid");

  const [command, ...args] = parsed.commandArgs;
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: appEnvironment(runtime, context, authorization === "1"),
    shell: false,
    stdio: "inherit",
  });
  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);
  const outcome = await new Promise((resolveOutcome, rejectOutcome) => {
    child.once("error", rejectOutcome);
    child.once("exit", (code, signal) => resolveOutcome({ code, signal }));
  });
  process.removeListener("SIGINT", forward);
  process.removeListener("SIGTERM", forward);
  if (outcome.signal) process.exitCode = 128;
  else process.exitCode = outcome.code ?? 1;
}

async function main() {
  const [command, ...rawArgs] = process.argv.slice(2);
  if (!command) fail("arguments_invalid");
  const parsed = parseOptions(rawArgs);
  if (command === "map") {
    assertExactOptions(parsed, ["provider-env", "token-file", "runtime-file"]);
    return mapLegacyProvider(parsed);
  }
  if (command === "read-waha-self") {
    assertExactOptions(parsed, ["runtime-file", "base-url", "self-file"]);
    return readWahaSelf(parsed);
  }
  if (command === "seed") {
    assertExactOptions(parsed, ["self-file", "context-file"]);
    return seedValidationLead(parsed);
  }
  if (command === "discover") {
    assertExactOptions(parsed, ["runtime-file", "context-file"]);
    return discoverProviderRouting(parsed);
  }
  if (command === "mark-attempt") {
    assertExactOptions(parsed, ["kind", "git-sha", "output"]);
    return createAttemptMarker(parsed);
  }
  if (command === "validate-private-ipv4") {
    assertExactOptions(parsed, ["value"]);
    return validatePrivateIpv4(parsed);
  }
  if (command === "run-app") {
    assertExactOptions(
      parsed,
      ["runtime-file", "context-file", "provider-authorized"],
      true,
    );
    return runApp(parsed);
  }
  fail("arguments_invalid");
}

main().catch((error) => {
  const code =
    error instanceof ValidationPreparationError
      ? error.code
      : error &&
          typeof error === "object" &&
          "code" in error &&
          typeof error.code === "string" &&
          /^[a-z0-9_]{1,80}$/u.test(error.code)
        ? error.code
        : "unexpected_failure";
  process.stderr.write(`Connected amoCRM preparation stopped (${code}).\n`);
  process.exitCode = 1;
});
