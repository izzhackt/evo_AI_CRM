import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

process.on("uncaughtException", () => {
  console.error(
    "ERROR: local Supabase Auth smoke failed before runtime initialization.",
  );
  process.exit(1);
});

class SmokeFailure extends Error {
  constructor(stage) {
    super(stage);
    this.stage = stage;
  }
}

const fail = (stage) => {
  throw new SmokeFailure(stage);
};

const assert = (condition, stage) => {
  if (!condition) {
    fail(stage);
  }
};

const statusPath = process.argv[2];
const databaseContainer = process.argv[3];
const browserFixturePath = process.argv[4];

if (!statusPath || !databaseContainer) {
  fail("arguments");
}

let apiUrl;
let publishableKey;
let serviceRoleKey;
let jwtSecret;

try {
  const status = JSON.parse(readFileSync(statusPath, "utf8"));
  apiUrl = status.API_URL;
  publishableKey = status.PUBLISHABLE_KEY;
  serviceRoleKey = status.SERVICE_ROLE_KEY;
  jwtSecret = status.JWT_SECRET;
} finally {
  // The status payload also contains local-only privileged credentials. It is
  // mode 0600 (the caller sets umask 077), is never logged, and is removed
  // before any network or SQL request is made.
  unlinkSync(statusPath);
}

assert(
  typeof apiUrl === "string" &&
    /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(apiUrl),
  "local-api-url",
);
assert(
  typeof publishableKey === "string" &&
    publishableKey.startsWith("sb_publishable_"),
  "publishable-key",
);
assert(
  typeof serviceRoleKey === "string" && serviceRoleKey.split(".").length === 3,
  "service-role-key",
);
assert(
  typeof jwtSecret === "string" && jwtSecret.length >= 32,
  "jwt-secret",
);
assert(
  /^supabase_db_evo-platform-local$/.test(databaseContainer),
  "database-container",
);

const sqlUuid = (value, stage = "uuid") => {
  assert(
    typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
    stage,
  );
  return `'${value}'::uuid`;
};

const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'::text`;
const sqlIdentifier = (value) =>
  `"${String(value).replaceAll('"', '""')}"`;

const runSql = (sql, stage) => {
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      databaseContainer,
      "psql",
      "-X",
      "--no-psqlrc",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    {
      input: sql,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );

  assert(result.status === 0, stage);
  return result.stdout.trim();
};

const serviceFunctionResult = (expression, stage) => {
  const result = runSql(
    `
      BEGIN;
      SET LOCAL request.jwt.claims = '{"role":"service_role"}';
      SET LOCAL ROLE service_role;
      SELECT (${expression})::text;
      COMMIT;
    `,
    stage,
  );

  try {
    return JSON.parse(result);
  } catch {
    fail(`${stage}-result`);
  }
};

const requestJson = async (
  path,
  {
    method = "GET",
    token,
    apiKey = publishableKey,
    body,
    schema = false,
    stage,
  },
) => {
  const headers = {
    apikey: apiKey,
    Accept: "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (schema) {
    headers["Accept-Profile"] = "platform";
    headers["Content-Profile"] = "platform";
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (method === "PATCH") {
    headers.Prefer = "return=representation";
  }

  let response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    fail(stage);
  }

  let payload = null;
  const responseText = await response.text();
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      fail(stage);
    }
  }

  return { status: response.status, payload };
};

const waitForPlatformApi = async (identity, membershipId) => {
  const deadline = Date.now() + 30_000;
  const path =
    `/rest/v1/organization_memberships?select=id&id=eq.${membershipId}`;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiUrl}${path}`, {
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${identity.accessToken}`,
          Accept: "application/json",
          "Accept-Profile": "platform",
        },
      });

      if (response.status === 200) {
        const payload = await response.json();
        if (
          Array.isArray(payload) &&
          payload.some((row) => row.id === membershipId)
        ) {
          return;
        }
        fail("platform-readiness-rls");
      }

      if (![502, 503, 504].includes(response.status)) {
        fail(`platform-readiness-http-${response.status}`);
      }
    } catch (error) {
      if (error instanceof SmokeFailure) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  fail("platform-readiness-timeout");
};

const requireSuccess = (result, stage) => {
  assert(
    result.status >= 200 && result.status < 300,
    `${stage}-http-${result.status}`,
  );
  return result.payload;
};

const authRequest = async (path, body, stage) =>
  requireSuccess(
    await requestJson(path, {
      method: "POST",
      body,
      stage,
    }),
    stage,
  );

const decodeClaims = (accessToken, stage) => {
  assert(typeof accessToken === "string", stage);
  const parts = accessToken.split(".");
  assert(parts.length === 3, stage);

  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    fail(stage);
  }

  return claims;
};

const signLocalJwt = (payload) => {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", jwtSecret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
};

const syntheticIdentity = (label) => ({
  label,
  userId: null,
  email: `${randomUUID()}@example.invalid`,
  password: `Evo-${randomBytes(24).toString("base64url")}!9a`,
  accessToken: null,
  refreshToken: null,
});

const signUp = async (identity) => {
  const payload = requireSuccess(
    await requestJson("/auth/v1/admin/users", {
      method: "POST",
      token: serviceRoleKey,
      apiKey: serviceRoleKey,
      body: {
        email: identity.email,
        password: identity.password,
        email_confirm: true,
      },
      stage: `${identity.label}-admin-create`,
    }),
    `${identity.label}-admin-create`,
  );

  assert(typeof payload.id === "string", `${identity.label}-admin-create-user`);
  identity.userId = payload.id;
};

const assertPublicSignupDisabled = async () => {
  const result = await requestJson("/auth/v1/signup", {
    method: "POST",
    body: {
      email: `${randomUUID()}@example.invalid`,
      password: `Evo-${randomBytes(24).toString("base64url")}!9a`,
    },
    stage: "public-signup-disabled",
  });
  assert(
    result.status >= 400 && result.status < 500,
    "public-signup-disabled",
  );
};

const signIn = async (identity, expectedRole) => {
  const payload = await authRequest(
    "/auth/v1/token?grant_type=password",
    {
      email: identity.email,
      password: identity.password,
    },
    `${identity.label}-signin`,
  );

  assert(
    typeof payload.access_token === "string" &&
      typeof payload.refresh_token === "string",
    `${identity.label}-signin-session`,
  );

  identity.accessToken = payload.access_token;
  identity.refreshToken = payload.refresh_token;

  const claims = decodeClaims(
    identity.accessToken,
    `${identity.label}-signin-claims`,
  );
  if (expectedRole === null) {
    assert(
      !Object.hasOwn(claims, "platform_role") &&
        !Object.hasOwn(claims, "platform_access_version"),
      `${identity.label}-claims-absent`,
    );
  } else {
    assert(claims.platform_role === expectedRole, `${identity.label}-role`);
    assert(
      Number.isSafeInteger(claims.platform_access_version) &&
        claims.platform_access_version > 0,
      `${identity.label}-access-version`,
    );
  }
  return claims;
};

const refresh = async (identity, expectedRole) => {
  const previousRefreshToken = identity.refreshToken;
  const payload = await authRequest(
    "/auth/v1/token?grant_type=refresh_token",
    { refresh_token: previousRefreshToken },
    `${identity.label}-refresh`,
  );

  assert(
    typeof payload.access_token === "string" &&
      typeof payload.refresh_token === "string" &&
      payload.refresh_token !== previousRefreshToken,
    `${identity.label}-refresh-rotation`,
  );

  identity.accessToken = payload.access_token;
  identity.refreshToken = payload.refresh_token;

  const claims = decodeClaims(
    identity.accessToken,
    `${identity.label}-refresh-claims`,
  );
  if (expectedRole === null) {
    assert(
      !Object.hasOwn(claims, "platform_role") &&
        !Object.hasOwn(claims, "platform_access_version"),
      `${identity.label}-refreshed-claims-absent`,
    );
  } else {
    assert(
      claims.platform_role === expectedRole,
      `${identity.label}-refreshed-role`,
    );
    assert(
      Number.isSafeInteger(claims.platform_access_version) &&
        claims.platform_access_version > 0,
      `${identity.label}-refreshed-access-version`,
    );
  }

  return claims;
};

const columnName = (tableName, candidates) => {
  const rows = runSql(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'platform'
        AND table_name = ${sqlText(tableName)}
        AND column_name = ANY (
          ARRAY[${candidates.map(sqlText).join(", ")}]
        )
      ORDER BY array_position(
        ARRAY[${candidates.map(sqlText).join(", ")}],
        column_name
      )
      LIMIT 1;
    `,
    `column-${tableName}`,
  );
  assert(rows.length > 0, `column-${tableName}`);
  return rows;
};

const profileAuthColumn = columnName("profiles", ["auth_user_id", "user_id"]);
const membershipRoleColumn = columnName("organization_memberships", [
  "current_role",
  "business_role",
  "role",
]);

const membershipFor = (identity) => {
  const row = runSql(
    `
      SELECT jsonb_build_object(
        'id', membership.id,
        'organization_id', membership.organization_id,
        'role', membership.${sqlIdentifier(membershipRoleColumn)},
        'status', membership.status
      )::text
      FROM platform.organization_memberships AS membership
      JOIN platform.profiles AS profile
        ON profile.id = membership.profile_id
      WHERE profile.${profileAuthColumn} = ${sqlUuid(
        identity.userId,
        `${identity.label}-user-id`,
      )}
      ORDER BY membership.created_at DESC
      LIMIT 1;
    `,
    `${identity.label}-membership`,
  );
  assert(row.length > 0, `${identity.label}-membership`);
  return JSON.parse(row);
};

const bootstrapOrganization = (identity, name) => {
  const requestId = randomUUID();
  const result = runSql(
    `
      BEGIN;
      SET LOCAL request.jwt.claims = '{"role":"service_role"}';
      SET LOCAL ROLE service_role;
      SELECT platform.bootstrap_organization_admin(
        ${sqlText(name)},
        ${sqlUuid(identity.userId, `${identity.label}-bootstrap-user`)},
        ${sqlText(`Synthetic ${identity.label}`)},
        ${sqlText("local Auth hook smoke bootstrap")},
        ${sqlUuid(requestId)}
      )::text;
      COMMIT;
    `,
    `${identity.label}-bootstrap`,
  );
  assert(result.length > 0, `${identity.label}-bootstrap-result`);
  return membershipFor(identity);
};

const createCrossOrganizationFixture = (identity, name) => {
  const organizationId = randomUUID();
  const profileId = randomUUID();
  const membershipId = randomUUID();
  const scopeId = randomUUID();
  const roleRequestId = randomUUID();
  const scopeRequestId = randomUUID();
  const auditRequestId = randomUUID();

  runSql(
    `
      BEGIN;
      INSERT INTO platform.organizations (id, name)
      VALUES (${sqlUuid(organizationId)}, ${sqlText(name)});
      INSERT INTO platform.profiles (
        id,
        auth_user_id,
        display_name
      )
      VALUES (
        ${sqlUuid(profileId)},
        ${sqlUuid(identity.userId, `${identity.label}-fixture-user`)},
        ${sqlText(`Synthetic ${identity.label}`)}
      );
      INSERT INTO platform.organization_memberships (
        id,
        organization_id,
        profile_id,
        status,
        "current_role",
        current_bundle_id
      )
      SELECT
        ${sqlUuid(membershipId)},
        ${sqlUuid(organizationId)},
        ${sqlUuid(profileId)},
        'active',
        'admin',
        bundle.id
      FROM platform.role_bundle_versions AS bundle
      WHERE bundle.role = 'admin'
        AND bundle.status = 'published'
      ORDER BY bundle.version DESC
      LIMIT 1;
      INSERT INTO platform.membership_role_history (
        organization_id,
        membership_id,
        profile_id,
        role_version,
        previous_role,
        new_role,
        previous_bundle_id,
        new_bundle_id,
        actor_kind,
        actor_profile_id,
        reason,
        request_id
      )
      SELECT
        ${sqlUuid(organizationId)},
        ${sqlUuid(membershipId)},
        ${sqlUuid(profileId)},
        1,
        NULL,
        'admin',
        NULL,
        bundle.id,
        'system',
        NULL,
        'local Auth hook smoke cross-organization fixture',
        ${sqlUuid(roleRequestId)}
      FROM platform.role_bundle_versions AS bundle
      WHERE bundle.role = 'admin'
        AND bundle.status = 'published'
      ORDER BY bundle.version DESC
      LIMIT 1;
      INSERT INTO platform.record_scopes (
        id,
        organization_id,
        scope_kind,
        scope_key
      )
      VALUES (
        ${sqlUuid(scopeId)},
        ${sqlUuid(organizationId)},
        'organization',
        ${sqlUuid(organizationId)}
      );
      INSERT INTO platform.membership_scope_assignments (
        organization_id,
        membership_id,
        scope_id,
        scope_version,
        assignment_version,
        granted,
        actor_kind,
        actor_profile_id,
        reason,
        request_id
      )
      VALUES (
        ${sqlUuid(organizationId)},
        ${sqlUuid(membershipId)},
        ${sqlUuid(scopeId)},
        1,
        1,
        TRUE,
        'system',
        NULL,
        'local Auth hook smoke cross-organization fixture',
        ${sqlUuid(scopeRequestId)}
      );
      INSERT INTO platform.audit_events (
        organization_id,
        actor_kind,
        actor_profile_id,
        actor_principal,
        action,
        resource_type,
        resource_id,
        before_state,
        after_state,
        reason,
        request_id
      )
      VALUES (
        ${sqlUuid(organizationId)},
        'system',
        NULL,
        'local-test-fixture',
        'organization.bootstrap',
        'organization',
        ${sqlUuid(organizationId)},
        NULL,
        jsonb_build_object(
          'organization_id', ${sqlUuid(organizationId)},
          'membership_id', ${sqlUuid(membershipId)}
        ),
        'local Auth hook smoke cross-organization fixture',
        ${sqlUuid(auditRequestId)}
      );
      COMMIT;
    `,
    `${identity.label}-cross-organization-fixture`,
  );

  return membershipFor(identity);
};

const routineArgumentNames = (routineName) => {
  const output = runSql(
    `
      SELECT to_jsonb(proargnames)::text
      FROM pg_proc AS routine
      JOIN pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'platform'
        AND routine.proname = ${sqlText(routineName)}
        AND routine.prokind = 'f';
    `,
    `routine-${routineName}`,
  );
  const names = JSON.parse(output);
  assert(Array.isArray(names) && names.length > 0, `routine-${routineName}`);
  return names;
};

const reloadAndAssertCommunicationsReadRpcs = async () => {
  const routineMetadata = JSON.parse(
    runSql(
      `
        WITH routines AS (
          SELECT
            routine.oid,
            routine.proname,
            routine.provolatile,
            routine.prosecdef,
            routine.proacl,
            routine.proowner
          FROM pg_proc AS routine
          JOIN pg_namespace AS namespace
            ON namespace.oid = routine.pronamespace
          WHERE routine.prokind = 'f'
            AND ((
            namespace.nspname = 'platform_private'
            AND routine.proname = 'require_domain_actor_read'
          ) OR (
            namespace.nspname = 'platform'
            AND routine.proname IN (
              'staff_communication_queue',
              'staff_conversation_messages'
            )
          ))
        )
        SELECT jsonb_build_object(
          'volatility',
          (
            SELECT jsonb_object_agg(
              routine.proname,
              routine.provolatile
            )
            FROM routines AS routine
          ),
          'read_helper_security_definer',
          (
            SELECT routine.prosecdef
            FROM routines AS routine
            WHERE routine.proname = 'require_domain_actor_read'
          ),
          'read_helper_public_execute',
          EXISTS (
            SELECT 1
            FROM routines AS routine
            CROSS JOIN LATERAL aclexplode(
              COALESCE(
                routine.proacl,
                acldefault('f', routine.proowner)
              )
            ) AS privilege
            WHERE routine.proname = 'require_domain_actor_read'
              AND privilege.grantee = 0
              AND privilege.privilege_type = 'EXECUTE'
          ),
          'read_helper_anon_execute',
          has_function_privilege(
            'anon',
            'platform_private.require_domain_actor_read(uuid,text)',
            'EXECUTE'
          ),
          'read_helper_authenticated_execute',
          has_function_privilege(
            'authenticated',
            'platform_private.require_domain_actor_read(uuid,text)',
            'EXECUTE'
          ),
          'read_helper_service_execute',
          has_function_privilege(
            'service_role',
            'platform_private.require_domain_actor_read(uuid,text)',
            'EXECUTE'
          ),
          'read_helper_auth_admin_execute',
          has_function_privilege(
            'supabase_auth_admin',
            'platform_private.require_domain_actor_read(uuid,text)',
            'EXECUTE'
          ),
          'queue_authenticated_execute',
          has_function_privilege(
            'authenticated',
            'platform.staff_communication_queue(uuid)',
            'EXECUTE'
          ),
          'messages_authenticated_execute',
          has_function_privilege(
            'authenticated',
            'platform.staff_conversation_messages(uuid,uuid)',
            'EXECUTE'
          ),
          'read_rpcs_public_execute',
          EXISTS (
            SELECT 1
            FROM routines AS routine
            CROSS JOIN LATERAL aclexplode(
              COALESCE(
                routine.proacl,
                acldefault('f', routine.proowner)
              )
            ) AS privilege
            WHERE routine.proname IN (
                'staff_communication_queue',
                'staff_conversation_messages'
              )
              AND privilege.grantee = 0
              AND privilege.privilege_type = 'EXECUTE'
          ),
          'read_rpcs_anon_execute',
          has_function_privilege(
            'anon',
            'platform.staff_communication_queue(uuid)',
            'EXECUTE'
          ) OR has_function_privilege(
            'anon',
            'platform.staff_conversation_messages(uuid,uuid)',
            'EXECUTE'
          ),
          'read_rpcs_service_execute',
          has_function_privilege(
            'service_role',
            'platform.staff_communication_queue(uuid)',
            'EXECUTE'
          ) OR has_function_privilege(
            'service_role',
            'platform.staff_conversation_messages(uuid,uuid)',
            'EXECUTE'
          ),
          'read_rpcs_auth_admin_execute',
          has_function_privilege(
            'supabase_auth_admin',
            'platform.staff_communication_queue(uuid)',
            'EXECUTE'
          ) OR has_function_privilege(
            'supabase_auth_admin',
            'platform.staff_conversation_messages(uuid,uuid)',
            'EXECUTE'
          )
        )::text;
      `,
      "communications-read-rpc-volatility",
    ),
  );
  const volatility = routineMetadata.volatility;
  assert(
    volatility.require_domain_actor_read === "s" &&
    volatility.staff_communication_queue === "s" &&
      volatility.staff_conversation_messages === "s",
    "communications-read-rpc-volatility",
  );
  assert(
    routineMetadata.read_helper_security_definer === true &&
      routineMetadata.read_helper_public_execute === false &&
      routineMetadata.read_helper_anon_execute === false &&
      routineMetadata.read_helper_authenticated_execute === false &&
      routineMetadata.read_helper_service_execute === false &&
      routineMetadata.read_helper_auth_admin_execute === false,
    "communications-read-helper-containment",
  );
  assert(
    routineMetadata.queue_authenticated_execute === true &&
      routineMetadata.messages_authenticated_execute === true &&
      routineMetadata.read_rpcs_public_execute === false &&
      routineMetadata.read_rpcs_anon_execute === false &&
      routineMetadata.read_rpcs_service_execute === false &&
      routineMetadata.read_rpcs_auth_admin_execute === false,
    "communications-read-rpc-authenticated-grants",
  );

  runSql("NOTIFY pgrst, 'reload schema';", "postgrest-schema-reload");
  await new Promise((resolve) => setTimeout(resolve, 500));
};

const rpc = async (adminIdentity, routineName, orderedValues) => {
  const argumentNames = routineArgumentNames(routineName);
  assert(
    argumentNames.length === orderedValues.length,
    `${routineName}-arguments`,
  );
  const body = Object.fromEntries(
    argumentNames.map((name, index) => [name, orderedValues[index]]),
  );

  return requireSuccess(
    await requestJson(`/rest/v1/rpc/${routineName}`, {
      method: "POST",
      token: adminIdentity.accessToken,
      body,
      schema: true,
      stage: `${routineName}-rpc`,
    }),
    `${routineName}-rpc`,
  );
};

const provisionMembership = async (adminIdentity, organizationId, identity, role) => {
  await rpc(adminIdentity, "provision_member", [
    organizationId,
    identity.userId,
    `Synthetic ${identity.label}`,
    role,
    "local Auth hook smoke provision",
    randomUUID(),
  ]);
  const membership = membershipFor(identity);
  await rpc(adminIdentity, "assign_organization_scope", [
    organizationId,
    membership.id,
    "local Auth hook smoke organization scope",
    randomUUID(),
  ]);
  return membershipFor(identity);
};

const persistSyntheticFixtureEvent = ({
  organizationId,
  fixtureKey,
  wahaSessionName,
  payloadId,
  occurredAt,
  bodyText = null,
}) => {
  const rawPayload = JSON.stringify({
    fixture_kind: "synthetic_non_provider",
    provider_called: false,
    fixture_key: fixtureKey,
    payload_id: payloadId,
    body_text: bodyText,
  });
  const payloadSha256 = createHash("sha256")
    .update(rawPayload)
    .digest("hex");
  const stage = `synthetic-event-${fixtureKey}`;
  const result = serviceFunctionResult(
    `platform.persist_provider_webhook_event(
      ${sqlUuid(organizationId, `${stage}-organization`)},
      'waha',
      ${sqlText(`synthetic-local-fixture-account-${fixtureKey}`)},
      NULL::text,
      NULL::text,
      ${sqlText(`synthetic-local-fixture-request-${fixtureKey}`)},
      ${sqlText(wahaSessionName)},
      ${sqlText(payloadId)},
      'message.any',
      ${sqlText(occurredAt)}::timestamptz,
      'verified',
      ${sqlText(rawPayload)}::jsonb,
      ${sqlText(
        JSON.stringify({
          fixture_kind: "synthetic_non_provider",
          provider_called: false,
        }),
      )}::jsonb,
      'synthetic-local-fixture:not-provider-evidence',
      ${sqlText(payloadSha256)},
      ${sqlUuid(randomUUID(), `${stage}-request`)}
    )`,
    stage,
  );

  const eventId = result?.provider_webhook_event_id;
  sqlUuid(eventId, `${stage}-id`);
  return eventId;
};

const createSyntheticConversationFixture = ({
  organizationId,
  responsibleSalesMembershipId,
  fixtureKey,
  subject,
  accountSeed,
  occurredAt,
  messages,
}) => {
  const wahaSessionName = `synthetic-local-fixture-${fixtureKey}`;
  const kommoConversationId =
    `synthetic-local-fixture-${fixtureKey}-conversation`;
  const sourcePayloadId =
    messages[0]?.providerMessageId ??
    `synthetic-local-fixture-${fixtureKey}-conversation-source`;
  const sourceEventId = persistSyntheticFixtureEvent({
    organizationId,
    fixtureKey: `${fixtureKey}-source`,
    wahaSessionName,
    payloadId: sourcePayloadId,
    occurredAt,
    bodyText: messages[0]?.bodyText ?? null,
  });
  const stage = `synthetic-conversation-${fixtureKey}`;
  const conversationResult = serviceFunctionResult(
    `platform.create_communication_conversation(
      ${sqlUuid(organizationId, `${stage}-organization`)},
      NULL::uuid,
      ${sqlUuid(
        responsibleSalesMembershipId,
        `${stage}-responsible-sales`,
      )},
      ${sqlText(subject)},
      ${sqlText(wahaSessionName)},
      ${accountSeed},
      ${sqlText(kommoConversationId)},
      ${accountSeed + 10_000},
      ${accountSeed + 20_000},
      ${accountSeed + 30_000},
      ${sqlUuid(sourceEventId, `${stage}-source-event`)},
      ${sqlUuid(randomUUID(), `${stage}-request`)}
    )`,
    stage,
  );
  const conversationId =
    conversationResult?.communication_conversation_id;
  sqlUuid(conversationId, `${stage}-id`);

  const participantStage = `synthetic-participant-${fixtureKey}`;
  const participantResult = serviceFunctionResult(
    `platform.record_conversation_participant(
      ${sqlUuid(organizationId, `${participantStage}-organization`)},
      ${sqlUuid(conversationId, `${participantStage}-conversation`)},
      'customer',
      NULL::uuid,
      ${sqlText(`synthetic-local-fixture-${fixtureKey}-customer`)},
      ${sqlUuid(sourceEventId, `${participantStage}-source-event`)},
      ${sqlUuid(randomUUID(), `${participantStage}-request`)}
    )`,
    participantStage,
  );
  sqlUuid(
    participantResult?.conversation_participant_id,
    `${participantStage}-id`,
  );

  const messageBodies = [];
  messages.forEach((message, index) => {
    const messageFixtureKey = `${fixtureKey}-message-${index + 1}`;
    const messageEventId =
      index === 0
        ? sourceEventId
        : persistSyntheticFixtureEvent({
            organizationId,
            fixtureKey: messageFixtureKey,
            wahaSessionName,
            payloadId: message.providerMessageId,
            occurredAt: message.occurredAt,
            bodyText: message.bodyText,
          });
    const messageStage = `synthetic-message-${messageFixtureKey}`;
    const messageResult = serviceFunctionResult(
      `platform.record_communication_message(
        ${sqlUuid(organizationId, `${messageStage}-organization`)},
        ${sqlUuid(conversationId, `${messageStage}-conversation`)},
        'inbound',
        ${sqlText(message.bodyText)},
        'ru',
        FALSE,
        ${sqlText(wahaSessionName)},
        ${sqlText(message.providerMessageId)},
        ${accountSeed},
        ${sqlText(kommoConversationId)},
        ${sqlText(
          `synthetic-local-fixture-${fixtureKey}-kommo-message-${index + 1}`,
        )},
        ${accountSeed + 10_000},
        ${accountSeed + 20_000},
        ${accountSeed + 30_000},
        ${sqlUuid(messageEventId, `${messageStage}-source-event`)},
        NULL::uuid,
        ${sqlUuid(randomUUID(), `${messageStage}-request`)}
      )`,
      messageStage,
    );
    sqlUuid(
      messageResult?.communication_message_id,
      `${messageStage}-id`,
    );
    messageBodies.push(message.bodyText);
  });

  return {
    id: conversationId,
    subject,
    messages: messageBodies,
  };
};

const authenticatedPlatformRpcRows = async (
  identity,
  routineName,
  body,
  stage,
) => {
  const search = new URLSearchParams(
    Object.entries(body).map(([name, value]) => [name, String(value)]),
  );
  const response = await requestJson(
    `/rest/v1/rpc/${routineName}?${search}`,
    {
      token: identity.accessToken,
      schema: true,
      stage,
    },
  );
  if (response.status < 200 || response.status >= 300) {
    const safeCode =
      typeof response.payload?.code === "string" &&
      /^[A-Z0-9_]{1,32}$/.test(response.payload.code)
        ? response.payload.code
        : "NO_CODE";
    fail(`${stage}-http-${response.status}-${safeCode}`);
  }
  const payload = response.payload;
  assert(Array.isArray(payload), `${stage}-rows`);
  return payload;
};

const visibleMemberships = async (identity, stage) => {
  const payload = requireSuccess(
    await requestJson(
      `/rest/v1/organization_memberships?select=id,organization_id,${membershipRoleColumn},status`,
      {
        token: identity.accessToken,
        schema: true,
        stage,
      },
    ),
    stage,
  );
  assert(Array.isArray(payload), stage);
  return payload;
};

const assertOwnOrganizationOnly = async (
  identity,
  organizationId,
  membershipId,
) => {
  const rows = await visibleMemberships(
    identity,
    `${identity.label}-membership-read`,
  );
  assert(rows.some((row) => row.id === membershipId), `${identity.label}-own`);
  assert(
    rows.every((row) => row.organization_id === organizationId),
    `${identity.label}-cross-organization`,
  );
};

const assertNoPlatformRows = async (identity, stage) => {
  const rows = await visibleMemberships(identity, stage);
  assert(rows.length === 0, stage);
};

const assertDirectMutationDenied = async (identity, membership) => {
  const result = await requestJson(
    `/rest/v1/organization_memberships?id=eq.${membership.id}`,
    {
      method: "PATCH",
      token: identity.accessToken,
      body: { [membershipRoleColumn]: "admin" },
      schema: true,
      stage: `${identity.label}-direct-mutation`,
    },
  );

  assert(
    result.status === 401 ||
      result.status === 403 ||
      (result.status >= 200 &&
        result.status < 300 &&
        Array.isArray(result.payload) &&
        result.payload.length === 0),
    `${identity.label}-direct-mutation`,
  );

  const current = membershipFor(identity);
  assert(current.role === membership.role, `${identity.label}-role-unchanged`);
};

const main = async () => {
  const identities = {
    adminA: syntheticIdentity("admin-a"),
    sales: syntheticIdentity("sales"),
    responsibleSales: syntheticIdentity("responsible-sales"),
    salesScoped: syntheticIdentity("sales-scoped"),
    curator: syntheticIdentity("curator"),
    finance: syntheticIdentity("finance"),
    student: syntheticIdentity("student"),
    blocked: syntheticIdentity("blocked"),
    noMembership: syntheticIdentity("no-membership"),
    adminB: syntheticIdentity("admin-b"),
    salesB: syntheticIdentity("sales-b"),
  };

  await assertPublicSignupDisabled();
  await Promise.all(Object.values(identities).map(signUp));

  const adminAMembership = bootstrapOrganization(
    identities.adminA,
    "EVO P2C Synthetic Organization A",
  );
  const adminBMembership = createCrossOrganizationFixture(
    identities.adminB,
    "EVO P2C Synthetic Organization B",
  );

  await signIn(identities.adminA, "admin");
  await signIn(identities.adminB, "admin");

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiredResult = await requestJson(
    "/rest/v1/rpc/current_actor_authority",
    {
      method: "POST",
      token: signLocalJwt({
        aud: "authenticated",
        exp: nowSeconds - 60,
        iat: nowSeconds - 120,
        iss: "supabase",
        role: "authenticated",
        sub: identities.adminA.userId,
        platform_role: "admin",
        platform_access_version: 1,
      }),
      body: {},
      schema: true,
      stage: "expired-token",
    },
  );
  assert(expiredResult.status === 401, "expired-token");
  await waitForPlatformApi(identities.adminA, adminAMembership.id);

  const roleMembers = {};
  for (const [role, identity] of [
    ["sales", identities.sales],
    ["curator", identities.curator],
    ["finance", identities.finance],
    ["student", identities.student],
  ]) {
    roleMembers[role] = await provisionMembership(
      identities.adminA,
      adminAMembership.organization_id,
      identity,
      role,
    );
    await signIn(identity, role);
  }

  const responsibleSalesMembership = await provisionMembership(
    identities.adminA,
    adminAMembership.organization_id,
    identities.responsibleSales,
    "sales",
  );
  const salesScopedMembership = await provisionMembership(
    identities.adminA,
    adminAMembership.organization_id,
    identities.salesScoped,
    "sales",
  );
  const salesBMembership = await provisionMembership(
    identities.adminB,
    adminBMembership.organization_id,
    identities.salesB,
    "sales",
  );
  for (const identity of [
    identities.responsibleSales,
    identities.salesScoped,
    identities.salesB,
  ]) {
    await signIn(identity, "sales");
  }

  const orgAConversation = createSyntheticConversationFixture({
    organizationId: adminAMembership.organization_id,
    responsibleSalesMembershipId: responsibleSalesMembership.id,
    fixtureKey: "org-a-primary",
    subject: "[SYNTHETIC-NON-PROVIDER] Org A admissions inquiry",
    accountSeed: 91_001,
    occurredAt: "2026-07-30T09:00:00+06:00",
    messages: [
      {
        providerMessageId:
          "synthetic-local-fixture-org-a-primary-message-1",
        bodyText:
          "Первое входящее синтетическое сообщение. Внешний провайдер не вызывался.",
        occurredAt: "2026-07-30T09:00:00+06:00",
      },
      {
        providerMessageId:
          "synthetic-local-fixture-org-a-primary-message-2",
        bodyText:
          "Второе входящее синтетическое сообщение. Порядок сохранён в Supabase.",
        occurredAt: "2026-07-30T09:01:00+06:00",
      },
    ],
  });
  const orgAScopedConversation = createSyntheticConversationFixture({
    organizationId: adminAMembership.organization_id,
    responsibleSalesMembershipId: responsibleSalesMembership.id,
    fixtureKey: "org-a-other-sales-scope",
    subject: "[SYNTHETIC-NON-PROVIDER] Org A scoped sales inquiry",
    accountSeed: 91_002,
    occurredAt: "2026-07-30T09:02:00+06:00",
    messages: [],
  });
  const orgBConversation = createSyntheticConversationFixture({
    organizationId: adminBMembership.organization_id,
    responsibleSalesMembershipId: salesBMembership.id,
    fixtureKey: "org-b",
    subject: "[SYNTHETIC-NON-PROVIDER] Org B admissions inquiry",
    accountSeed: 92_001,
    occurredAt: "2026-07-30T09:03:00+06:00",
    messages: [],
  });
  await refresh(identities.responsibleSales, "sales");
  await refresh(identities.salesB, "sales");
  await reloadAndAssertCommunicationsReadRpcs();

  const adminConversationRows = await authenticatedPlatformRpcRows(
    identities.adminA,
    "staff_communication_queue",
    { p_organization_id: adminAMembership.organization_id },
    "admin-synthetic-conversation-queue",
  );
  const adminConversationIds = new Set(
    adminConversationRows.map((row) => row.conversation_id),
  );
  assert(
    adminConversationIds.has(orgAConversation.id) &&
      adminConversationIds.has(orgAScopedConversation.id) &&
      !adminConversationIds.has(orgBConversation.id),
    "admin-synthetic-conversation-queue-scope",
  );

  const adminMessageRows = await authenticatedPlatformRpcRows(
    identities.adminA,
    "staff_conversation_messages",
    {
      p_organization_id: adminAMembership.organization_id,
      p_conversation_id: orgAConversation.id,
    },
    "admin-synthetic-conversation-messages",
  );
  assert(
    adminMessageRows.length === orgAConversation.messages.length &&
      adminMessageRows.every(
        (row, index) =>
          row.direction === "inbound" &&
          row.body_text === orgAConversation.messages[index],
      ),
    "admin-synthetic-conversation-message-order",
  );

  const salesScopedConversationRows = await authenticatedPlatformRpcRows(
    identities.salesScoped,
    "staff_communication_queue",
    { p_organization_id: adminAMembership.organization_id },
    "sales-scoped-synthetic-conversation-queue",
  );
  assert(
    salesScopedConversationRows.every(
      (row) =>
        row.conversation_id !== orgAConversation.id &&
        row.conversation_id !== orgAScopedConversation.id,
    ),
    "sales-scoped-synthetic-conversation-denial",
  );

  const blockedMembership = await provisionMembership(
    identities.adminA,
    adminAMembership.organization_id,
    identities.blocked,
    "sales",
  );
  await signIn(identities.blocked, "sales");
  await signIn(identities.noMembership, null);

  for (const [role, identity] of [
    ["admin", identities.adminA],
    ["sales", identities.sales],
    ["curator", identities.curator],
    ["finance", identities.finance],
    ["student", identities.student],
  ]) {
    const membership =
      role === "admin" ? adminAMembership : roleMembers[role];
    await assertOwnOrganizationOnly(
      identity,
      adminAMembership.organization_id,
      membership.id,
    );
    await assertDirectMutationDenied(identity, membership);
  }

  for (const [identity, membership, organizationId] of [
    [
      identities.responsibleSales,
      responsibleSalesMembership,
      adminAMembership.organization_id,
    ],
    [
      identities.salesScoped,
      salesScopedMembership,
      adminAMembership.organization_id,
    ],
    [
      identities.salesB,
      salesBMembership,
      adminBMembership.organization_id,
    ],
  ]) {
    await assertOwnOrganizationOnly(
      identity,
      organizationId,
      membership.id,
    );
    await assertDirectMutationDenied(identity, membership);
  }

  await assertOwnOrganizationOnly(
    identities.adminB,
    adminBMembership.organization_id,
    adminBMembership.id,
  );

  const crossOrganization = requireSuccess(
    await requestJson(
      `/rest/v1/organization_memberships?select=id&organization_id=eq.${adminBMembership.organization_id}`,
      {
        token: identities.adminA.accessToken,
        schema: true,
        stage: "admin-cross-organization-read",
      },
    ),
    "admin-cross-organization-read",
  );
  assert(
    Array.isArray(crossOrganization) && crossOrganization.length === 0,
    "admin-cross-organization-read",
  );

  await assertNoPlatformRows(identities.noMembership, "no-membership-read");

  const anonymous = await requestJson(
    "/rest/v1/organization_memberships?select=id",
    {
      schema: true,
      stage: "anonymous-read",
    },
  );
  assert(
    anonymous.status === 401 ||
      anonymous.status === 403 ||
      (anonymous.status === 200 &&
        Array.isArray(anonymous.payload) &&
        anonymous.payload.length === 0),
    "anonymous-read",
  );

  const salesOldClaims = decodeClaims(
    identities.sales.accessToken,
    "sales-old-claims",
  );
  await rpc(identities.adminA, "change_membership_role", [
    adminAMembership.organization_id,
    roleMembers.sales.id,
    "curator",
    "local Auth hook smoke role change",
    randomUUID(),
  ]);
  await assertNoPlatformRows(identities.sales, "stale-role-token-read");
  const salesNewClaims = await refresh(identities.sales, "curator");
  assert(
    salesNewClaims.platform_access_version >
      salesOldClaims.platform_access_version,
    "role-change-version-increment",
  );
  await assertOwnOrganizationOnly(
    identities.sales,
    adminAMembership.organization_id,
    roleMembers.sales.id,
  );

  await rpc(identities.adminA, "change_membership_status", [
    adminAMembership.organization_id,
    blockedMembership.id,
    "blocked",
    "local Auth hook smoke block",
    randomUUID(),
  ]);
  await assertNoPlatformRows(identities.blocked, "blocked-held-token-read");
  await refresh(identities.blocked, null);
  await assertNoPlatformRows(identities.blocked, "blocked-refreshed-read");

  const legacySideEffects = Number(
    runSql(
      `
        SELECT
          (SELECT count(*)
           FROM platform.profiles
           WHERE ${profileAuthColumn} = ${sqlUuid(
             identities.noMembership.userId,
             "legacy-user-id",
           )})
          +
          (SELECT count(*)
           FROM platform.organization_memberships AS membership
           JOIN platform.profiles AS profile
             ON profile.id = membership.profile_id
           WHERE profile.${profileAuthColumn} = ${sqlUuid(
             identities.noMembership.userId,
             "legacy-membership-user-id",
           )});
      `,
      "legacy-signup-side-effects",
    ),
  );
  assert(legacySideEffects === 0, "legacy-signup-side-effects");

  if (browserFixturePath) {
    assert(
      (statSync(browserFixturePath).mode & 0o777) === 0o600,
      "browser-fixture-mode",
    );
    writeFileSync(
      browserFixturePath,
      JSON.stringify({
        apiUrl,
        publishableKey,
        identities: {
          admin: {
            email: identities.adminA.email,
            password: identities.adminA.password,
          },
          curator: {
            email: identities.curator.email,
            password: identities.curator.password,
          },
          salesScoped: {
            email: identities.salesScoped.email,
            password: identities.salesScoped.password,
          },
          finance: {
            email: identities.finance.email,
            password: identities.finance.password,
          },
          student: {
            email: identities.student.email,
            password: identities.student.password,
          },
          blocked: {
            email: identities.blocked.email,
            password: identities.blocked.password,
          },
          noMembership: {
            email: identities.noMembership.email,
            password: identities.noMembership.password,
          },
        },
        conversations: {
          orgA: orgAConversation,
          orgB: orgBConversation,
          sameOrgOutsideSalesScope: orgAScopedConversation,
        },
      }),
      { mode: 0o600 },
    );
  }

  console.log(
    "Local Supabase Auth/PostgREST smoke passed: public signup disabled; 11 admin-provisioned synthetic users, 5 roles, 2 organizations, expired/stale-token and blocked-claim invalidation; local conversation fixtures contain no provider proof.",
  );
};

main().catch((error) => {
  const stage =
    error instanceof SmokeFailure ? error.stage : "unexpected-runtime";
  console.error(`ERROR: local Supabase Auth smoke failed at ${stage}.`);
  process.exitCode = 1;
});
