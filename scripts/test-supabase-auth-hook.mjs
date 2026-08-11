import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

import {
  LocalSupabaseAuthReadinessError,
  waitForLocalSupabaseAuthAdmin,
} from "./supabase-auth-readiness.mjs";

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

const safeAuthErrorLabel = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value)
    ? value
    : "unclassified";

const verifyClientClaims = async (identity, expectedRole) => {
  const client = createClient(apiUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { data, error } = await client.auth.getClaims(identity.accessToken);
  if (error) {
    console.error(
      JSON.stringify({
        event: "local_supabase_get_claims_failed",
        error_name: safeAuthErrorLabel(error.name),
        error_code: safeAuthErrorLabel(error.code),
        status: Number.isSafeInteger(error.status) ? error.status : null,
      }),
    );
    fail(`${identity.label}-verified-claims`);
  }
  assert(
    data?.claims?.platform_role === expectedRole,
    `${identity.label}-verified-role`,
  );
  assert(
    Number.isSafeInteger(data?.claims?.platform_access_version) &&
      data.claims.platform_access_version > 0,
    `${identity.label}-verified-access-version`,
  );
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

  if (result.status !== 0) {
    const safeError = result.stderr
      .split("\n")
      .find((line) => line.startsWith("ERROR:"))
      ?.replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
        "[redacted-uuid]",
      );
    if (safeError) console.error(safeError);
  }
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

const authenticatedFunctionResult = (claims, expression, stage) => {
  const escapedClaims = JSON.stringify(claims).replaceAll("'", "''");
  const result = runSql(
    `
      BEGIN;
      SET LOCAL request.jwt.claims = '${escapedClaims}';
      SET LOCAL ROLE authenticated;
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
        'profile_id', membership.profile_id,
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
  studentCaseId = null,
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
      ${
        studentCaseId === null
          ? "NULL::uuid"
          : sqlUuid(studentCaseId, `${stage}-student-case`)
      },
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
        ${sqlText(message.language ?? "ru")}::platform.communication_message_language,
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
  const query = search.toString();
  const response = await requestJson(
    `/rest/v1/rpc/${routineName}${query ? `?${query}` : ""}`,
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

const workflowRows = async (identity, conversationId, stage) => {
  const payload = requireSuccess(
    await requestJson("/rest/v1/rpc/staff_conversation_workflow", {
      method: "POST",
      token: identity.accessToken,
      body: {
        p_organization_id: membershipFor(identity).organization_id,
        p_conversation_id: conversationId,
      },
      schema: true,
      stage,
    }),
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
    studentNoCase: syntheticIdentity("student-no-case"),
    lifecycleStudent: syntheticIdentity("lifecycle-student"),
    revocableCurator: syntheticIdentity("revocable-curator"),
    blocked: syntheticIdentity("blocked"),
    noMembership: syntheticIdentity("no-membership"),
    adminB: syntheticIdentity("admin-b"),
    salesB: syntheticIdentity("sales-b"),
  };

  try {
    await waitForLocalSupabaseAuthAdmin({ apiUrl, serviceRoleKey });
  } catch (error) {
    if (error instanceof LocalSupabaseAuthReadinessError) {
      fail(error.stage);
    }
    throw error;
  }

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
  await verifyClientClaims(identities.adminA, "admin");

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

  const noCaseStudentMembership = await provisionMembership(
    identities.adminA,
    adminAMembership.organization_id,
    identities.studentNoCase,
    "student",
  );
  sqlUuid(noCaseStudentMembership.profile_id, "student-no-case-profile-id");
  await signIn(identities.studentNoCase, "student");

  const lifecycleStudentMembership = await provisionMembership(
    identities.adminA,
    adminAMembership.organization_id,
    identities.lifecycleStudent,
    "student",
  );
  sqlUuid(
    lifecycleStudentMembership.profile_id,
    "lifecycle-student-profile-id",
  );
  await signIn(identities.lifecycleStudent, "student");

  const revocableCuratorMembership = await provisionMembership(
    identities.adminA,
    adminAMembership.organization_id,
    identities.revocableCurator,
    "curator",
  );
  await signIn(identities.revocableCurator, "curator");

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

  // P4A: prove the real local PostgREST grant boundary without contacting an
  // amoCRM provider. Only the service JWT may persist a sanitized immutable
  // snapshot; only a live same-organization Admin may read it.
  const p4aRequestId = randomUUID();
  const p4aAccountId = "93001";
  const p4aSnapshot = {
    schema_version: 1,
    account: {
      id: p4aAccountId,
      domain: "synthetic-evo.amocrm.ru",
      subdomain: "synthetic-evo",
    },
    pipelines: [
      {
        id: "93002",
        name: "Synthetic local sales pipeline",
        is_main: true,
        is_archive: false,
        statuses: [
          {
            id: "93003",
            name: "Synthetic contract confirmed",
            sort: 10,
            is_editable: true,
            type: 0,
          },
        ],
      },
    ],
    users: [
      {
        id: "93004",
        name: "Synthetic responsible manager",
        is_active: true,
      },
    ],
    lead_custom_fields: [],
    contact_custom_fields: [],
  };
  const p4aPersistBody = {
    p_organization_id: adminAMembership.organization_id,
    p_amocrm_account_id: p4aAccountId,
    p_account_domain: "synthetic-evo.amocrm.ru",
    p_account_subdomain: "synthetic-evo",
    p_sanitized_snapshot: p4aSnapshot,
    p_evidence_kind: "local_non_provider",
    p_evidence_ref: "scripts/test-supabase-auth-hook.mjs",
    p_discovered_at: "2026-08-04T00:00:00Z",
    p_request_id: p4aRequestId,
  };
  const p4aPersisted = requireSuccess(
    await requestJson(
      "/rest/v1/rpc/persist_amocrm_mapping_discovery",
      {
        method: "POST",
        token: serviceRoleKey,
        apiKey: serviceRoleKey,
        body: p4aPersistBody,
        schema: true,
        stage: "p4a-service-persist",
      },
    ),
    "p4a-service-persist",
  );
  assert(
    Array.isArray(p4aPersisted) &&
      p4aPersisted.length === 1 &&
      p4aPersisted[0].organization_id === adminAMembership.organization_id &&
      String(p4aPersisted[0].amocrm_account_id) === p4aAccountId &&
      p4aPersisted[0].version === 1 &&
      p4aPersisted[0].evidence_kind === "local_non_provider",
    "p4a-service-persist-row",
  );
  const p4aDiscoveryVersionId = p4aPersisted[0].discovery_version_id;
  sqlUuid(p4aDiscoveryVersionId, "p4a-discovery-version-id");

  const p4aReplay = requireSuccess(
    await requestJson(
      "/rest/v1/rpc/persist_amocrm_mapping_discovery",
      {
        method: "POST",
        token: serviceRoleKey,
        apiKey: serviceRoleKey,
        body: p4aPersistBody,
        schema: true,
        stage: "p4a-service-persist-replay",
      },
    ),
    "p4a-service-persist-replay",
  );
  assert(
    Array.isArray(p4aReplay) &&
      p4aReplay.length === 1 &&
      p4aReplay[0].discovery_version_id === p4aDiscoveryVersionId &&
      p4aReplay[0].created_at === p4aPersisted[0].created_at,
    "p4a-service-persist-replay-row",
  );

  const p4aAdminRows = await authenticatedPlatformRpcRows(
    identities.adminA,
    "admin_amocrm_mapping_discovery_versions",
    {
      p_organization_id: adminAMembership.organization_id,
      p_amocrm_account_id: p4aAccountId,
      p_version: 1,
    },
    "p4a-admin-read",
  );
  assert(
    p4aAdminRows.length === 1 &&
      p4aAdminRows[0].discovery_version_id === p4aDiscoveryVersionId &&
      p4aAdminRows[0].sanitized_snapshot?.account?.id === p4aAccountId,
    "p4a-admin-read-row",
  );

  const p4aReadQuery = new URLSearchParams({
    p_organization_id: adminAMembership.organization_id,
    p_amocrm_account_id: p4aAccountId,
    p_version: "1",
  });
  for (const [label, identity] of [
    ["sales", identities.sales],
    ["cross-org-admin", identities.adminB],
  ]) {
    const denied = await requestJson(
      `/rest/v1/rpc/admin_amocrm_mapping_discovery_versions?${p4aReadQuery}`,
      {
        token: identity.accessToken,
        schema: true,
        stage: `p4a-${label}-read-denied`,
      },
    );
    assert(
      denied.status >= 400 && denied.status < 500,
      `p4a-${label}-read-denied`,
    );
  }

  const p4aBrowserPersistDenied = await requestJson(
    "/rest/v1/rpc/persist_amocrm_mapping_discovery",
    {
      method: "POST",
      token: identities.adminA.accessToken,
      body: { ...p4aPersistBody, p_request_id: randomUUID() },
      schema: true,
      stage: "p4a-browser-persist-denied",
    },
  );
  assert(
    p4aBrowserPersistDenied.status >= 400 &&
      p4aBrowserPersistDenied.status < 500,
    "p4a-browser-persist-denied",
  );

  const p4aUnsafeSnapshotDenied = await requestJson(
    "/rest/v1/rpc/persist_amocrm_mapping_discovery",
    {
      method: "POST",
      token: serviceRoleKey,
      apiKey: serviceRoleKey,
      body: {
        ...p4aPersistBody,
        p_sanitized_snapshot: {
          ...p4aSnapshot,
          account: {
            ...p4aSnapshot.account,
            email: "forbidden@example.invalid",
          },
        },
        p_request_id: randomUUID(),
      },
      schema: true,
      stage: "p4a-unsafe-snapshot-denied",
    },
  );
  assert(
    p4aUnsafeSnapshotDenied.status >= 400 &&
      p4aUnsafeSnapshotDenied.status < 500,
    "p4a-unsafe-snapshot-denied",
  );

  const p4aArbitraryNestedExtraDenied = await requestJson(
    "/rest/v1/rpc/persist_amocrm_mapping_discovery",
    {
      method: "POST",
      token: serviceRoleKey,
      apiKey: serviceRoleKey,
      body: {
        ...p4aPersistBody,
        p_sanitized_snapshot: {
          ...p4aSnapshot,
          pipelines: [
            {
              ...p4aSnapshot.pipelines[0],
              unexpected_metadata: "synthetic-denied-value",
            },
          ],
        },
        p_request_id: randomUUID(),
      },
      schema: true,
      stage: "p4a-arbitrary-nested-extra-denied",
    },
  );
  assert(
    p4aArbitraryNestedExtraDenied.status >= 400 &&
      p4aArbitraryNestedExtraDenied.status < 500,
    "p4a-arbitrary-nested-extra-denied",
  );

  const p4aCamelSecretExtraDenied = await requestJson(
    "/rest/v1/rpc/persist_amocrm_mapping_discovery",
    {
      method: "POST",
      token: serviceRoleKey,
      apiKey: serviceRoleKey,
      body: {
        ...p4aPersistBody,
        p_sanitized_snapshot: {
          ...p4aSnapshot,
          users: [
            {
              ...p4aSnapshot.users[0],
              accessToken: "synthetic-denied-value",
            },
          ],
        },
        p_request_id: randomUUID(),
      },
      schema: true,
      stage: "p4a-camel-secret-extra-denied",
    },
  );
  assert(
    p4aCamelSecretExtraDenied.status >= 400 &&
      p4aCamelSecretExtraDenied.status < 500,
    "p4a-camel-secret-extra-denied",
  );

  const p4aSnakeSecretExtraDenied = await requestJson(
    "/rest/v1/rpc/persist_amocrm_mapping_discovery",
    {
      method: "POST",
      token: serviceRoleKey,
      apiKey: serviceRoleKey,
      body: {
        ...p4aPersistBody,
        p_sanitized_snapshot: {
          ...p4aSnapshot,
          pipelines: [
            {
              ...p4aSnapshot.pipelines[0],
              statuses: [
                {
                  ...p4aSnapshot.pipelines[0].statuses[0],
                  client_secret: "synthetic-denied-value",
                },
              ],
            },
          ],
        },
        p_request_id: randomUUID(),
      },
      schema: true,
      stage: "p4a-snake-secret-extra-denied",
    },
  );
  assert(
    p4aSnakeSecretExtraDenied.status >= 400 &&
      p4aSnakeSecretExtraDenied.status < 500,
    "p4a-snake-secret-extra-denied",
  );

  const p4aNestedTypeDenied = await requestJson(
    "/rest/v1/rpc/persist_amocrm_mapping_discovery",
    {
      method: "POST",
      token: serviceRoleKey,
      apiKey: serviceRoleKey,
      body: {
        ...p4aPersistBody,
        p_sanitized_snapshot: {
          ...p4aSnapshot,
          pipelines: [
            {
              ...p4aSnapshot.pipelines[0],
              statuses: [
                {
                  ...p4aSnapshot.pipelines[0].statuses[0],
                  sort: "10",
                },
              ],
            },
          ],
        },
        p_request_id: randomUUID(),
      },
      schema: true,
      stage: "p4a-nested-type-denied",
    },
  );
  assert(
    p4aNestedTypeDenied.status >= 400 && p4aNestedTypeDenied.status < 500,
    "p4a-nested-type-denied",
  );

  const staleResponsibleSalesAccessToken =
    identities.responsibleSales.accessToken;
  const orgAStudentCase = serviceFunctionResult(
    `platform.create_pending_student_case(
      ${sqlUuid(adminAMembership.organization_id, "p3c-org-a-case-org")},
      ${sqlUuid(roleMembers.student.id, "p3c-org-a-case-student")},
      ${sqlUuid(
        responsibleSalesMembership.id,
        "p3c-org-a-case-responsible-sales",
      )},
      'synthetic-local-fixture-org-a-contract',
      'synthetic-contract:org-a:confirmed',
      '2026-07-30T08:55:00+06:00'::timestamptz,
      'Synthetic Org A Student',
      'Malaysia',
      'Bachelor',
      NULL,
      '2027',
      'ru',
      'self-funded',
      'contract_confirmed',
      'Admin assigns the Curator for the local workflow proof',
      ${sqlUuid(randomUUID(), "p3c-org-a-case-request")}
    )`,
    "p3c-org-a-case-create",
  );
  const orgAStudentCaseId = orgAStudentCase?.student_case_id;
  sqlUuid(orgAStudentCaseId, "p3c-org-a-student-case-id");

  const orgACuratorAssignment = authenticatedFunctionResult(
    decodeClaims(
      identities.adminA.accessToken,
      "p3c-org-a-admin-claims-for-curator-assignment",
    ),
    `platform.assign_student_case_curator(
      ${sqlUuid(adminAMembership.organization_id, "p3c-org-a-assign-org")},
      ${sqlUuid(orgAStudentCaseId, "p3c-org-a-assign-case")},
      ${sqlUuid(roleMembers.curator.id, "p3c-org-a-assign-curator")},
      'Assign the synthetic student case to its Curator for local workflow proof',
      ${sqlUuid(randomUUID(), "p3c-org-a-assign-request")}
    )`,
    "p3c-org-a-curator-assignment",
  );
  assert(
    orgACuratorAssignment?.student_case_id === orgAStudentCaseId &&
      orgACuratorAssignment?.curator_membership_id === roleMembers.curator.id &&
      orgACuratorAssignment?.case_state === "active",
    "p3c-org-a-curator-assignment-result",
  );
  const orgARouteCompletion = authenticatedFunctionResult(
    decodeClaims(
      identities.adminA.accessToken,
      "bw3-org-a-admin-claims-for-route-completion",
    ),
    `platform.set_student_case_route(
      ${sqlUuid(adminAMembership.organization_id, "bw3-org-a-route-org")},
      ${sqlUuid(orgAStudentCaseId, "bw3-org-a-route-case")},
      'Malaysia',
      'Bachelor',
      'Synthetic admissions workflow',
      '2027',
      'ru',
      'self-funded',
      'draft',
      'profile_and_route',
      'Prepare the synthetic route before checklist binding',
      'Complete the previously nullable synthetic program direction',
      ${sqlUuid(randomUUID(), "bw3-org-a-route-request")}
    )`,
    "bw3-org-a-route-completion",
  );
  assert(
    orgARouteCompletion?.student_case_id === orgAStudentCaseId &&
      orgARouteCompletion?.program_direction ===
        "Synthetic admissions workflow" &&
      orgARouteCompletion?.route_approval_status === "draft",
    "bw3-org-a-route-completion-result",
  );
  await refresh(identities.responsibleSales, "sales");
  await refresh(identities.curator, "curator");
  await refresh(identities.student, "student");
  await refresh(identities.studentNoCase, "student");

  const bw3Checklist = {
    targetCountry: "Malaysia",
    targetDegree: "Bachelor",
    programDirection: "Synthetic admissions workflow",
    version: 1,
    sourceCount: 1,
    requiredProfileFields: [
      "academic_summary",
      "budget_band",
      "citizenship_country",
      "communication_language",
      "language_summary",
      "next_step",
      "preferred_display_name",
    ],
  };
  const bw3Profile = {
    preferredDisplayName: "Synthetic Portal Student",
    legalDisplayName: null,
    dateOfBirth: null,
    communicationLanguage: "ru",
    citizenshipCountry: "Synthetic Republic",
    residencyCountry: "Synthetic Residency",
    currentEducationSummary: "Synthetic current education summary",
    academicSummary: "Synthetic academic summary without source records",
    languageSummary: "Synthetic language summary: English B2",
    budgetBand: "Synthetic self-funded budget band",
    decisionParticipantLabels: [],
    consentStatus: "not_recorded",
    consentEvidenceRef: null,
    nextStep: "Review the synthetic checklist item with the Curator",
  };
  const bw3Document = {
    requirementKey: "synthetic_academic_transcript",
    label: "Synthetic academic transcript",
    instructions:
      "Use the approved private document channel; this fixture contains no file.",
    status: "required",
  };
  const bw3SourceKey = `src_${createHash("sha256")
    .update("evo-bw3-synthetic-country-requirement-source")
    .digest("hex")}`;
  const bw3SourceUrl =
    `https://github.com/izzhackt/evo_AI_CRM/commit/${"f".repeat(40)}`;
  const bw3SourceRegistryId = await rpc(
    identities.adminA,
    "register_workflow_source",
    [
      adminAMembership.organization_id,
      bw3SourceKey,
      "repository_contract",
      bw3SourceUrl,
      "synthetic_bw3_v1",
      "Register the synthetic repository contract used by the BW3 local fixture",
      randomUUID(),
    ],
  );
  sqlUuid(bw3SourceRegistryId, "bw3-source-registry-id");
  const reviewedBw3SourceRegistryId = await rpc(
    identities.adminA,
    "review_workflow_source",
    [
      adminAMembership.organization_id,
      bw3SourceRegistryId,
      "reviewed",
      "Approve the synthetic repository contract as local fixture provenance",
      randomUUID(),
    ],
  );
  assert(
    reviewedBw3SourceRegistryId === bw3SourceRegistryId,
    "bw3-reviewed-source-id",
  );

  // Seed one approved OP/OZO definition pair, then attach a single immutable
  // handoff to the synthetic org A case. This is local contract data only.
  const bw4OpContractId = await rpc(
    identities.adminA,
    "create_workflow_contract",
    [
      adminAMembership.organization_id,
      "wf_op",
      "op",
      "Create the synthetic BW4 OP workflow contract",
      randomUUID(),
    ],
  );
  const bw4OzoContractId = await rpc(
    identities.adminA,
    "create_workflow_contract",
    [
      adminAMembership.organization_id,
      "wf_ozo",
      "ozo",
      "Create the synthetic BW4 OZO workflow contract",
      randomUUID(),
    ],
  );
  sqlUuid(bw4OpContractId, "bw4-op-contract-id");
  sqlUuid(bw4OzoContractId, "bw4-ozo-contract-id");
  const bw4OpContractVersionId = await rpc(
    identities.adminA,
    "create_workflow_contract_version",
    [
      adminAMembership.organization_id,
      bw4OpContractId,
      1,
      [
        "new",
        "contacting",
        "qualified",
        "meeting_scheduled",
        "meeting_completed",
        "potential",
        "contract_signed",
      ],
      ["no_answer", "meeting_not_attended"],
      ["won", "lost"],
      [],
      "Create the synthetic BW4 OP workflow version",
      randomUUID(),
    ],
  );
  const bw4OzoContractVersionId = await rpc(
    identities.adminA,
    "create_workflow_contract_version",
    [
      adminAMembership.organization_id,
      bw4OzoContractId,
      1,
      [
        "intake",
        "profile_and_route",
        "documents",
        "applications",
        "decisions",
        "visa_and_predeparture",
        "arrival_and_adaptation",
        "completed",
        "closed",
      ],
      [],
      [],
      ["completed", "closed"],
      "Create the synthetic BW4 OZO workflow version",
      randomUUID(),
    ],
  );
  sqlUuid(bw4OpContractVersionId, "bw4-op-contract-version-id");
  sqlUuid(bw4OzoContractVersionId, "bw4-ozo-contract-version-id");
  for (const [versionId, label] of [
    [bw4OpContractVersionId, "op"],
    [bw4OzoContractVersionId, "ozo"],
  ]) {
    const sourceLinkId = await rpc(
      identities.adminA,
      "link_workflow_contract_version_source",
      [
        adminAMembership.organization_id,
        versionId,
        bw3SourceRegistryId,
        `Link the synthetic BW4 ${label.toUpperCase()} source`,
        randomUUID(),
      ],
    );
    sqlUuid(sourceLinkId, `bw4-${label}-source-link-id`);
    const approvedVersionId = await rpc(
      identities.adminA,
      "approve_workflow_contract_version",
      [
        adminAMembership.organization_id,
        versionId,
        `Approve the synthetic BW4 ${label.toUpperCase()} version`,
        randomUUID(),
      ],
    );
    assert(approvedVersionId === versionId, `bw4-${label}-version-approval`);
  }

  const bw4HandoffId = randomUUID();
  const bw4HandoffRequestId = randomUUID();
  const bw4HandoffNextStep =
    "Review the synthetic application checklist with the assigned Curator";
  const bw4HandoffResponsibleRole = "curator";
  const bw4HandoffInputSha = createHash("sha256")
    .update(
      JSON.stringify({
        organizationId: adminAMembership.organization_id,
        studentCaseId: orgAStudentCaseId,
        opVersionId: bw4OpContractVersionId,
        ozoVersionId: bw4OzoContractVersionId,
        nextStep: bw4HandoffNextStep,
      }),
    )
    .digest("hex");
  runSql(
    `
      DO $fixture$
      BEGIN
        UPDATE platform.student_cases
        SET applied_ozo_workflow_contract_version_id =
          ${sqlUuid(bw4OzoContractVersionId, "bw4-handoff-ozo-binding")}
        WHERE organization_id =
          ${sqlUuid(adminAMembership.organization_id, "bw4-handoff-org")}
          AND id = ${sqlUuid(orgAStudentCaseId, "bw4-handoff-case")}
          AND applied_ozo_workflow_contract_version_id IS NULL;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Synthetic BW4 case could not receive OZO binding';
        END IF;
      END
      $fixture$;

      INSERT INTO platform.student_case_op_handoffs (
        id,
        organization_id,
        student_case_id,
        op_workflow_contract_id,
        op_workflow_contract_version_id,
        ozo_workflow_contract_id,
        ozo_workflow_contract_version_id,
        approved_commercial_fields,
        unresolved_questions,
        promises,
        next_step,
        due_at,
        responsible_role,
        request_id,
        input_sha256
      ) VALUES (
        ${sqlUuid(bw4HandoffId, "bw4-handoff-id")},
        ${sqlUuid(adminAMembership.organization_id, "bw4-handoff-insert-org")},
        ${sqlUuid(orgAStudentCaseId, "bw4-handoff-insert-case")},
        ${sqlUuid(bw4OpContractId, "bw4-handoff-op-contract")},
        ${sqlUuid(bw4OpContractVersionId, "bw4-handoff-op-version")},
        ${sqlUuid(bw4OzoContractId, "bw4-handoff-ozo-contract")},
        ${sqlUuid(bw4OzoContractVersionId, "bw4-handoff-ozo-version")},
        '{"service_package":"synthetic_standard"}'::jsonb,
        '["Confirm the synthetic intake date"]'::jsonb,
        '["Share the synthetic checklist"]'::jsonb,
        ${sqlText(bw4HandoffNextStep)},
        '2026-08-15T12:00:00+06:00'::timestamptz,
        ${sqlText(bw4HandoffResponsibleRole)}::platform.business_role,
        ${sqlUuid(bw4HandoffRequestId, "bw4-handoff-request")},
        ${sqlText(bw4HandoffInputSha)}
      );
    `,
    "bw4-student-case-handoff-fixture",
  );

  const bw3DocumentRequirement = await rpc(
    identities.adminA,
    "create_document_requirement",
    [
      adminAMembership.organization_id,
      bw3Checklist.targetCountry,
      bw3Checklist.targetDegree,
      bw3Checklist.programDirection,
      bw3Checklist.version,
      bw3Document.requirementKey,
      bw3Document.label,
      bw3Document.instructions,
      randomUUID(),
    ],
  );
  const bw3DocumentRequirementId =
    bw3DocumentRequirement?.document_requirement_id;
  sqlUuid(bw3DocumentRequirementId, "bw3-document-requirement-id");

  const bw3CountryRequirementVersionId = await rpc(
    identities.adminA,
    "create_country_requirement_version",
    [
      adminAMembership.organization_id,
      bw3Checklist.targetCountry,
      bw3Checklist.targetDegree,
      bw3Checklist.programDirection,
      bw3Checklist.version,
      bw3Checklist.requiredProfileFields,
      "Create the synthetic BW3 country requirement version",
      randomUUID(),
    ],
  );
  sqlUuid(
    bw3CountryRequirementVersionId,
    "bw3-country-requirement-version-id",
  );
  const bw3CountryRequirementSourceLinkId = await rpc(
    identities.adminA,
    "link_country_requirement_version_source",
    [
      adminAMembership.organization_id,
      bw3CountryRequirementVersionId,
      bw3SourceRegistryId,
      "Link reviewed synthetic provenance to the BW3 requirement version",
      randomUUID(),
    ],
  );
  sqlUuid(
    bw3CountryRequirementSourceLinkId,
    "bw3-country-requirement-source-link-id",
  );
  const approvedBw3CountryRequirementVersionId = await rpc(
    identities.adminA,
    "approve_country_requirement_version",
    [
      adminAMembership.organization_id,
      bw3CountryRequirementVersionId,
      "Approve the reviewed synthetic BW3 requirement version",
      randomUUID(),
    ],
  );
  assert(
    approvedBw3CountryRequirementVersionId === bw3CountryRequirementVersionId,
    "bw3-approved-country-requirement-version-id",
  );

  const bw3Application = await rpc(
    identities.adminA,
    "apply_country_requirement_version",
    [
      adminAMembership.organization_id,
      orgAStudentCaseId,
      bw3CountryRequirementVersionId,
      "Apply the approved synthetic BW3 version to the active student case",
      randomUUID(),
    ],
  );
  assert(
    bw3Application?.student_case_id === orgAStudentCaseId &&
      bw3Application?.country_requirement_version_id ===
        bw3CountryRequirementVersionId &&
      bw3Application?.version === bw3Checklist.version &&
      bw3Application?.document_slot_count === 1,
    "bw3-country-requirement-application",
  );

  const bw3ProfileResult = await rpc(
    identities.adminA,
    "upsert_student_profile",
    [
      adminAMembership.organization_id,
      orgAStudentCaseId,
      0,
      bw3Profile.preferredDisplayName,
      bw3Profile.legalDisplayName,
      bw3Profile.dateOfBirth,
      bw3Profile.communicationLanguage,
      bw3Profile.citizenshipCountry,
      bw3Profile.residencyCountry,
      bw3Profile.currentEducationSummary,
      bw3Profile.academicSummary,
      bw3Profile.languageSummary,
      bw3Profile.budgetBand,
      bw3Profile.decisionParticipantLabels,
      bw3Profile.consentStatus,
      bw3Profile.consentEvidenceRef,
      bw3Profile.nextStep,
      "Persist the minimized synthetic BW3 Student Profile",
      randomUUID(),
    ],
  );
  assert(
    bw3ProfileResult?.student_case_id === orgAStudentCaseId &&
      bw3ProfileResult?.revision === 1 &&
      bw3ProfileResult?.applied_country_requirement_version_id ===
        bw3CountryRequirementVersionId,
    "bw3-student-profile-upsert",
  );
  const bw3StudentProfileId = bw3ProfileResult.id;
  sqlUuid(bw3StudentProfileId, "bw3-student-profile-id");
  sqlUuid(roleMembers.student.profile_id, "bw3-student-identity-profile-id");
  assert(
    bw3StudentProfileId !== roleMembers.student.profile_id,
    "bw3-domain-and-identity-profile-ids-distinct",
  );

  const bw3PortalProfileRows = await authenticatedPlatformRpcRows(
    identities.student,
    "student_portal_profile",
    {},
    "bw3-student-portal-profile",
  );
  assert(
    bw3PortalProfileRows.length === 1 &&
      bw3PortalProfileRows[0].case_id === orgAStudentCaseId &&
      bw3PortalProfileRows[0].student_profile_id === bw3StudentProfileId &&
      bw3PortalProfileRows[0].preferred_display_name ===
        bw3Profile.preferredDisplayName &&
      bw3PortalProfileRows[0].citizenship_country ===
        bw3Profile.citizenshipCountry &&
      bw3PortalProfileRows[0].residency_country ===
        bw3Profile.residencyCountry &&
      bw3PortalProfileRows[0].current_education_summary ===
        bw3Profile.currentEducationSummary &&
      bw3PortalProfileRows[0].academic_summary ===
        bw3Profile.academicSummary &&
      bw3PortalProfileRows[0].language_summary ===
        bw3Profile.languageSummary &&
      bw3PortalProfileRows[0].budget_band === bw3Profile.budgetBand &&
      bw3PortalProfileRows[0].profile_next_step === bw3Profile.nextStep &&
      bw3PortalProfileRows[0].applied_country_requirement_version_id ===
        bw3CountryRequirementVersionId &&
      bw3PortalProfileRows[0].checklist_version === bw3Checklist.version &&
      JSON.stringify(bw3PortalProfileRows[0].required_profile_fields) ===
        JSON.stringify(bw3Checklist.requiredProfileFields),
    "bw3-student-portal-profile-values",
  );

  const bw3CountryVersionRows = await authenticatedPlatformRpcRows(
    identities.adminA,
    "staff_country_requirement_versions_for_case",
    { p_student_case_id: orgAStudentCaseId },
    "bw3-staff-country-requirement-versions",
  );
  assert(
    bw3CountryVersionRows.length === 1 &&
      bw3CountryVersionRows[0].case_id === orgAStudentCaseId &&
      bw3CountryVersionRows[0].country_requirement_version_id ===
        bw3CountryRequirementVersionId &&
      bw3CountryVersionRows[0].target_country === bw3Checklist.targetCountry &&
      bw3CountryVersionRows[0].target_degree === bw3Checklist.targetDegree &&
      bw3CountryVersionRows[0].program_direction ===
        bw3Checklist.programDirection &&
      bw3CountryVersionRows[0].version === bw3Checklist.version &&
      bw3CountryVersionRows[0].status === "approved" &&
      bw3CountryVersionRows[0].source_count === bw3Checklist.sourceCount &&
      bw3CountryVersionRows[0].is_applied === true &&
      JSON.stringify(bw3CountryVersionRows[0].required_profile_fields) ===
        JSON.stringify(bw3Checklist.requiredProfileFields),
    "bw3-staff-country-requirement-version-values",
  );

  const bw3DocumentRows = await authenticatedPlatformRpcRows(
    identities.adminA,
    "staff_student_case_documents",
    { p_student_case_id: orgAStudentCaseId },
    "bw3-staff-student-case-documents",
  );
  assert(
    bw3DocumentRows.length === 1 &&
      bw3DocumentRows[0].case_id === orgAStudentCaseId &&
      bw3DocumentRows[0].document_requirement_id ===
        bw3DocumentRequirementId &&
      bw3DocumentRows[0].requirement_key === bw3Document.requirementKey &&
      bw3DocumentRows[0].requirement_label === bw3Document.label &&
      bw3DocumentRows[0].instructions === bw3Document.instructions &&
      bw3DocumentRows[0].checklist_version === bw3Checklist.version &&
      bw3DocumentRows[0].slot_status === bw3Document.status &&
      bw3DocumentRows[0].document_version_id === null &&
      bw3DocumentRows[0].original_filename === null &&
      bw3DocumentRows[0].submitted_at === null,
    "bw3-student-case-document-values",
  );
  const bw3DocumentSlotId = bw3DocumentRows[0].document_slot_id;
  sqlUuid(bw3DocumentSlotId, "bw3-document-slot-id");
  const noCasePortalRows = await authenticatedPlatformRpcRows(
    identities.studentNoCase,
    "student_portal_profile",
    {},
    "bw3-student-no-case-portal-profile",
  );
  assert(
    noCasePortalRows.length === 0,
    "bw3-student-no-case-portal-profile-empty",
  );

  const orgAConversation = createSyntheticConversationFixture({
    organizationId: adminAMembership.organization_id,
    studentCaseId: orgAStudentCaseId,
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
  const orgAManualConversation = createSyntheticConversationFixture({
    organizationId: adminAMembership.organization_id,
    studentCaseId: orgAStudentCaseId,
    responsibleSalesMembershipId: responsibleSalesMembership.id,
    fixtureKey: "org-a-manual-ai-unavailable",
    subject: "[SYNTHETIC-NON-PROVIDER] Org A manual reply while AI unavailable",
    accountSeed: 91_003,
    occurredAt: "2026-07-30T09:02:00+06:00",
    messages: [
      {
        providerMessageId:
          "synthetic-local-fixture-org-a-manual-message-1",
        bodyText:
          "Нужен ответ сотрудника без AI. Это синтетическое сообщение.",
        occurredAt: "2026-07-30T09:02:00+06:00",
      },
    ],
  });
  const orgAScopedConversation = createSyntheticConversationFixture({
    organizationId: adminAMembership.organization_id,
    responsibleSalesMembershipId: responsibleSalesMembership.id,
    fixtureKey: "org-a-other-sales-scope",
    subject: "[SYNTHETIC-NON-PROVIDER] Org A scoped sales inquiry",
    accountSeed: 91_002,
    occurredAt: "2026-07-30T09:03:00+06:00",
    messages: [],
  });
  const bw4NoCaseConversation = createSyntheticConversationFixture({
    organizationId: adminAMembership.organization_id,
    responsibleSalesMembershipId: salesScopedMembership.id,
    fixtureKey: "bw4-no-case-sales",
    subject: "[SYNTHETIC-NON-PROVIDER] BW4 no-case Sales inquiry",
    accountSeed: 91_004,
    occurredAt: "2026-07-30T09:07:00+06:00",
    messages: [],
  });
  const bw4RuConversation = createSyntheticConversationFixture({
    organizationId: adminBMembership.organization_id,
    responsibleSalesMembershipId: salesBMembership.id,
    fixtureKey: "bw4-language-ru",
    subject: "[SYNTHETIC-NON-PROVIDER] BW4 Russian draft path",
    accountSeed: 91_005,
    occurredAt: "2026-07-30T09:08:00+06:00",
    messages: [
      {
        providerMessageId: "synthetic-local-fixture-bw4-language-ru-message-1",
        bodyText: "Синтетическое сообщение для проверки русского черновика.",
        language: "ru",
        occurredAt: "2026-07-30T09:08:00+06:00",
      },
    ],
  });
  const bw4EnConversation = createSyntheticConversationFixture({
    organizationId: adminBMembership.organization_id,
    responsibleSalesMembershipId: salesBMembership.id,
    fixtureKey: "bw4-language-en",
    subject: "[SYNTHETIC-NON-PROVIDER] BW4 English draft path",
    accountSeed: 91_006,
    occurredAt: "2026-07-30T09:09:00+06:00",
    messages: [
      {
        providerMessageId: "synthetic-local-fixture-bw4-language-en-message-1",
        bodyText: "Synthetic message for the English draft path.",
        language: "en",
        occurredAt: "2026-07-30T09:09:00+06:00",
      },
    ],
  });
  const bw4UndeterminedConversation = createSyntheticConversationFixture({
    organizationId: adminBMembership.organization_id,
    responsibleSalesMembershipId: salesBMembership.id,
    fixtureKey: "bw4-language-undetermined",
    subject: "[SYNTHETIC-NON-PROVIDER] BW4 uncertain draft path",
    accountSeed: 91_007,
    occurredAt: "2026-07-30T09:10:00+06:00",
    messages: [
      {
        providerMessageId:
          "synthetic-local-fixture-bw4-language-undetermined-message-1",
        bodyText: "Synthetic message whose language needs staff selection.",
        language: "undetermined",
        occurredAt: "2026-07-30T09:10:00+06:00",
      },
    ],
  });
  const orgBConversation = createSyntheticConversationFixture({
    organizationId: adminBMembership.organization_id,
    responsibleSalesMembershipId: salesBMembership.id,
    fixtureKey: "org-b",
    subject: "[SYNTHETIC-NON-PROVIDER] Org B admissions inquiry",
    accountSeed: 92_001,
    occurredAt: "2026-07-30T09:04:00+06:00",
    messages: [],
  });
  const orgBAiRequestConversation = createSyntheticConversationFixture({
    organizationId: adminBMembership.organization_id,
    responsibleSalesMembershipId: salesBMembership.id,
    fixtureKey: "org-b-ai-request",
    subject: "[SYNTHETIC-NON-PROVIDER] Org B AI request mutation",
    accountSeed: 92_002,
    occurredAt: "2026-07-30T09:05:00+06:00",
    messages: [
      {
        providerMessageId:
          "synthetic-local-fixture-org-b-ai-request-message-1",
        bodyText: "Please prepare a synthetic admissions draft.",
        language: "en",
        occurredAt: "2026-07-30T09:05:00+06:00",
      },
    ],
  });
  const orgBAiReviewConversation = createSyntheticConversationFixture({
    organizationId: adminBMembership.organization_id,
    responsibleSalesMembershipId: salesBMembership.id,
    fixtureKey: "org-b-ai-review",
    subject: "[SYNTHETIC-NON-PROVIDER] Org B AI review mutation",
    accountSeed: 92_003,
    occurredAt: "2026-07-30T09:06:00+06:00",
    messages: [
      {
        providerMessageId:
          "synthetic-local-fixture-org-b-ai-review-message-1",
        bodyText: "Please review this synthetic draft before a manual send.",
        language: "en",
        occurredAt: "2026-07-30T09:06:00+06:00",
      },
    ],
  });
  await refresh(identities.responsibleSales, "sales");
  await refresh(identities.salesScoped, "sales");
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

  const orgAWorkflowInitialRows = await workflowRows(
    identities.adminA,
    orgAConversation.id,
    "p3c-org-a-initial-workflow",
  );
  assert(orgAWorkflowInitialRows.length === 1, "p3c-org-a-initial-workflow-row");
  const orgAWorkflowInitial = orgAWorkflowInitialRows[0];
  const orgALatestInboundMessageId = orgAWorkflowInitial.latest_inbound_message_id;
  sqlUuid(orgALatestInboundMessageId, "p3c-org-a-latest-inbound-message-id");
  const orgAManualWorkflowRows = await workflowRows(
    identities.adminA,
    orgAManualConversation.id,
    "p3c-org-a-manual-initial-workflow",
  );
  assert(
    orgAManualWorkflowRows.length === 1,
    "p3c-org-a-manual-initial-workflow-row",
  );
  const orgAManualLatestInboundMessageId =
    orgAManualWorkflowRows[0].latest_inbound_message_id;
  sqlUuid(
    orgAManualLatestInboundMessageId,
    "p3c-org-a-manual-latest-inbound-message-id",
  );
  const orgBAiRequestWorkflowRows = await workflowRows(
    identities.adminB,
    orgBAiRequestConversation.id,
    "p3c-org-b-ai-request-initial-workflow",
  );
  assert(
    orgBAiRequestWorkflowRows.length === 1,
    "p3c-org-b-ai-request-initial-workflow-row",
  );
  const orgBAiRequestLatestInboundMessageId =
    orgBAiRequestWorkflowRows[0].latest_inbound_message_id;
  sqlUuid(
    orgBAiRequestLatestInboundMessageId,
    "p3c-org-b-ai-request-latest-inbound-message-id",
  );
  const orgBAiReviewWorkflowRows = await workflowRows(
    identities.adminB,
    orgBAiReviewConversation.id,
    "p3c-org-b-ai-review-initial-workflow",
  );
  assert(
    orgBAiReviewWorkflowRows.length === 1,
    "p3c-org-b-ai-review-initial-workflow-row",
  );
  const orgBAiReviewLatestInboundMessageId =
    orgBAiReviewWorkflowRows[0].latest_inbound_message_id;
  sqlUuid(
    orgBAiReviewLatestInboundMessageId,
    "p3c-org-b-ai-review-latest-inbound-message-id",
  );

  const orgAKnowledgeVersionFirst = authenticatedFunctionResult(
    decodeClaims(identities.adminA.accessToken, "p3c-org-a-admin-claims"),
    `platform.publish_approved_knowledge_version(
      ${sqlUuid(adminAMembership.organization_id, "p3c-org-a-knowledge-org")},
      'synthetic.orga.admissions.general',
      'Synthetic org A admissions knowledge',
      1,
      'Synthetic org A approved knowledge v1.',
      encode(
        sha256(convert_to('Synthetic org A approved knowledge v1.', 'UTF8')),
        'hex'
      ),
      'synthetic:provenance:knowledge:org-a:v1',
      'Publish org A knowledge for local non-provider browser workflow proof',
      ${sqlUuid(randomUUID(), "p3c-org-a-knowledge-request")}
    )`,
    "p3c-org-a-knowledge-publish",
  );
  const orgAKnowledgeVersionId =
    orgAKnowledgeVersionFirst?.approved_knowledge_version_id;
  sqlUuid(orgAKnowledgeVersionId, "p3c-org-a-knowledge-version-id");
  const orgBKnowledgeVersionFirst = authenticatedFunctionResult(
    decodeClaims(identities.adminB.accessToken, "p3c-org-b-admin-claims"),
    `platform.publish_approved_knowledge_version(
      ${sqlUuid(adminBMembership.organization_id, "p3c-org-b-knowledge-org")},
      'synthetic.orgb.admissions.general',
      'Synthetic org B admissions knowledge',
      1,
      'Synthetic org B approved knowledge v1.',
      encode(
        sha256(convert_to('Synthetic org B approved knowledge v1.', 'UTF8')),
        'hex'
      ),
      'synthetic:provenance:knowledge:org-b:v1',
      'Publish org B knowledge for local mutation workflow proof',
      ${sqlUuid(randomUUID(), "p3c-org-b-knowledge-request")}
    )`,
    "p3c-org-b-knowledge-publish",
  );
  const orgBKnowledgeVersionId =
    orgBKnowledgeVersionFirst?.approved_knowledge_version_id;
  sqlUuid(orgBKnowledgeVersionId, "p3c-org-b-knowledge-version-id");

  const bw4RawContentSentinel =
    "BW4_RAW_PROMPT_SENTINEL_MUST_NOT_LEAK";
  const bw4PromptPolicyTitle =
    "Synthetic Lead Manager Prompt Policy v1";
  const bw4BusinessContextTitle =
    "Synthetic EVO Business Context v1";
  const publishPromptArtifacts = (identity, organizationId, tenantLabel) => {
    const claims = decodeClaims(
      identity.accessToken,
      `bw4-${tenantLabel}-admin-prompt-claims`,
    );
    const promptPolicy = authenticatedFunctionResult(
      claims,
      `platform.publish_ai_prompt_artifact_version(
        ${sqlUuid(organizationId, `bw4-${tenantLabel}-prompt-org`)},
        'prompt_policy',
        ${sqlText(bw4PromptPolicyTitle)},
        ${sqlText(`${bw4RawContentSentinel} synthetic policy content`)},
        ${sqlText(`synthetic:prompt-policy:${tenantLabel}:v1`)},
        'Publish the synthetic approved prompt policy for local browser proof',
        ${sqlUuid(randomUUID(), `bw4-${tenantLabel}-prompt-request`)}
      )`,
      `bw4-${tenantLabel}-prompt-publish`,
    );
    const businessContext = authenticatedFunctionResult(
      claims,
      `platform.publish_ai_prompt_artifact_version(
        ${sqlUuid(organizationId, `bw4-${tenantLabel}-context-org`)},
        'business_context',
        ${sqlText(bw4BusinessContextTitle)},
        ${sqlText(`${bw4RawContentSentinel} synthetic business context`)},
        ${sqlText(`synthetic:business-context:${tenantLabel}:v1`)},
        'Publish the synthetic approved business context for local browser proof',
        ${sqlUuid(randomUUID(), `bw4-${tenantLabel}-context-request`)}
      )`,
      `bw4-${tenantLabel}-context-publish`,
    );
    sqlUuid(
      promptPolicy?.prompt_artifact_version_id,
      `bw4-${tenantLabel}-prompt-version-id`,
    );
    sqlUuid(
      businessContext?.prompt_artifact_version_id,
      `bw4-${tenantLabel}-context-version-id`,
    );
    assert(
      promptPolicy?.artifact_kind === "prompt_policy" &&
        promptPolicy?.version === 1 &&
        promptPolicy?.status === "approved" &&
        /^[0-9a-f]{64}$/.test(promptPolicy?.content_sha256 ?? ""),
      `bw4-${tenantLabel}-prompt-result`,
    );
    assert(
      businessContext?.artifact_kind === "business_context" &&
        businessContext?.version === 1 &&
        businessContext?.status === "approved" &&
        /^[0-9a-f]{64}$/.test(businessContext?.content_sha256 ?? ""),
      `bw4-${tenantLabel}-context-result`,
    );
    return { promptPolicy, businessContext };
  };
  const orgAPromptArtifacts = publishPromptArtifacts(
    identities.adminA,
    adminAMembership.organization_id,
    "org-a",
  );
  publishPromptArtifacts(
    identities.adminB,
    adminBMembership.organization_id,
    "org-b",
  );

  const bw4DecisionQuestion =
    "Which synthetic admissions route is approved?";
  const bw4DecisionAnswer =
    "Synthetic reviewed BW4 answer for fixture metadata.";
  const bw4Decision = authenticatedFunctionResult(
    decodeClaims(
      identities.adminA.accessToken,
      "bw4-org-a-admin-decision-claims",
    ),
    `platform.create_decision_backlog_entry(
      ${sqlUuid(adminAMembership.organization_id, "bw4-decision-org")},
      ${sqlUuid(orgAConversation.id, "bw4-decision-conversation")},
      ${sqlUuid(orgAStudentCaseId, "bw4-decision-case")},
      ${sqlText(bw4DecisionQuestion)},
      'admin',
      'general',
      NULL::uuid,
      NULL::platform.student_profile_field,
      NULL::uuid,
      NULL::text,
      'Create one synthetic unresolved BW4 fixture decision',
      ${sqlUuid(randomUUID(), "bw4-decision-request")}
    )`,
    "bw4-org-a-decision-create",
  );
  const bw4DecisionId = bw4Decision?.decision_backlog_id;
  sqlUuid(bw4DecisionId, "bw4-decision-id");
  assert(
    bw4Decision?.status === "unresolved" &&
      bw4Decision?.effective_version === 1,
    "bw4-decision-result",
  );

  const bw4UnrelatedCase = serviceFunctionResult(
    `platform.create_pending_student_case(
      ${sqlUuid(adminAMembership.organization_id, "bw4-unrelated-case-org")},
      ${sqlUuid(roleMembers.student.id, "bw4-unrelated-case-student")},
      ${sqlUuid(
        responsibleSalesMembership.id,
        "bw4-unrelated-case-responsible-sales",
      )},
      'synthetic-local-fixture-bw4-unrelated-case',
      'synthetic-contract:bw4:unrelated:confirmed',
      '2026-07-30T09:11:00+06:00'::timestamptz,
      'Synthetic BW4 Unrelated Student Case',
      'Synthetic Country',
      'Bachelor',
      'synthetic_program',
      '2027',
      'en',
      'self-funded',
      'contract_confirmed',
      'Keep this case outside the BW4 conversation fixture',
      ${sqlUuid(randomUUID(), "bw4-unrelated-case-request")}
    )`,
    "bw4-unrelated-case-create",
  );
  const bw4UnrelatedCaseId = bw4UnrelatedCase?.student_case_id;
  sqlUuid(bw4UnrelatedCaseId, "bw4-unrelated-case-id");
  await refresh(identities.responsibleSales, "sales");

  const recordHealthEvent = ({
    organizationId,
    target,
    readiness,
    evidenceKind,
    reason,
    evidenceRef,
    stage,
  }) =>
    serviceFunctionResult(
      `platform.record_messaging_integration_health_event(
        ${sqlUuid(organizationId, `${stage}-org`)},
        ${sqlText(target)}::platform.messaging_integration_target,
        ${sqlText(readiness)}::platform.messaging_integration_readiness,
        ${sqlText(evidenceKind)}::platform.messaging_integration_evidence_kind,
        ${sqlText(reason)},
        ${sqlText(evidenceRef)},
        ${sqlUuid(randomUUID(), `${stage}-request`)}
      )`,
      stage,
    );

  recordHealthEvent({
    organizationId: adminAMembership.organization_id,
    target: "ai",
    readiness: "ready",
    evidenceKind: "provider_observed",
    reason:
      "Synthetic provider-observed AI readiness used only to create local workflow rows",
    evidenceRef: "synthetic:health:ai:provider-ready:org-a",
    stage: "p3c-org-a-ai-provider-ready",
  });
  recordHealthEvent({
    organizationId: adminAMembership.organization_id,
    target: "waha",
    readiness: "ready",
    evidenceKind: "provider_observed",
    reason:
      "Synthetic provider-observed WAHA readiness used only to create local workflow rows",
    evidenceRef: "synthetic:health:waha:provider-ready:org-a",
    stage: "p3c-org-a-waha-provider-ready",
  });
  recordHealthEvent({
    organizationId: adminBMembership.organization_id,
    target: "ai",
    readiness: "ready",
    evidenceKind: "provider_observed",
    reason:
      "Synthetic provider-observed AI readiness used only for local browser mutation contracts",
    evidenceRef: "synthetic:health:ai:provider-ready:org-b",
    stage: "p3c-org-b-ai-provider-ready",
  });
  recordHealthEvent({
    organizationId: adminBMembership.organization_id,
    target: "waha",
    readiness: "ready",
    evidenceKind: "provider_observed",
    reason:
      "Synthetic provider-observed WAHA readiness used only for local browser mutation contracts",
    evidenceRef: "synthetic:health:waha:provider-ready:org-b",
    stage: "p3c-org-b-waha-provider-ready",
  });

  const orgAAiRequest = authenticatedFunctionResult(
    decodeClaims(
      identities.curator.accessToken,
      "p3c-org-a-curator-claims-for-request",
    ),
    `platform.request_ai_draft_with_knowledge(
      ${sqlUuid(adminAMembership.organization_id, "p3c-org-a-request-org")},
      ${sqlUuid(orgAConversation.id, "p3c-org-a-request-conversation")},
      ${sqlUuid(
        orgALatestInboundMessageId,
        "p3c-org-a-request-source-message",
      )},
      'ru',
      ${sqlUuid(orgAKnowledgeVersionId, "p3c-org-a-request-knowledge")},
      'Review the synthetic local workflow on Thursday, July 30, 2026',
      ${sqlUuid(randomUUID(), "p3c-org-a-request-id")}
    )`,
    "p3c-org-a-ai-request",
  );
  const orgAAiDraftRequestId = orgAAiRequest?.ai_draft_request_id;
  sqlUuid(orgAAiDraftRequestId, "p3c-org-a-ai-draft-request-id");

  const orgASyntheticSourceContext = JSON.stringify({
    source_message_id: orgALatestInboundMessageId,
    knowledge_version_ids: [orgAKnowledgeVersionId],
    fixture_kind: "synthetic_non_provider",
  });
  serviceFunctionResult(
    `platform.record_ai_draft(
      ${sqlUuid(adminAMembership.organization_id, "p3c-org-a-draft-org")},
      ${sqlUuid(orgAConversation.id, "p3c-org-a-draft-conversation")},
      ${sqlUuid(orgALatestInboundMessageId, "p3c-org-a-draft-source-message")},
      'confident',
      'ru',
      ${sqlUuid(orgAKnowledgeVersionId, "p3c-org-a-draft-knowledge")},
      'Synthetic local draft for workflow rendering only.',
      'synthetic:ai-provider:not-real',
      'synthetic:model:not-real',
      'lead_manager.default@1',
      ${sqlText(orgASyntheticSourceContext)}::jsonb,
      encode(
        sha256(
          convert_to(
            (${sqlText(orgASyntheticSourceContext)}::jsonb)::text,
            'UTF8'
          )
        ),
        'hex'
      ),
      ${sqlUuid(randomUUID(), "p3c-org-a-draft-record-request")}
    )`,
    "p3c-org-a-ai-draft-record",
  );

  const orgAWorkflowAfterRequestRows = await workflowRows(
    identities.curator,
    orgAConversation.id,
    "p3c-org-a-workflow-after-request",
  );
  assert(
    orgAWorkflowAfterRequestRows.length === 1,
    "p3c-org-a-workflow-after-request-row",
  );
  const orgAAiDraftId = orgAWorkflowAfterRequestRows[0].latest_ai_draft_id;
  sqlUuid(orgAAiDraftId, "p3c-org-a-ai-draft-id");

  authenticatedFunctionResult(
    decodeClaims(
      identities.curator.accessToken,
      "p3c-org-a-curator-claims-for-review",
    ),
    `platform.review_ai_draft(
      ${sqlUuid(adminAMembership.organization_id, "p3c-org-a-review-org")},
      ${sqlUuid(orgAAiDraftId, "p3c-org-a-review-draft")},
      'approved',
      'Synthetic local reviewed reply for org A.',
      'Approve the synthetic local draft for browser workflow proof',
      ${sqlUuid(randomUUID(), "p3c-org-a-review-id")}
    )`,
    "p3c-org-a-ai-review",
  );

  const orgAManualBusinessKey = createHash("sha256")
    .update(
      JSON.stringify([
        "evo-platform-work-v1",
        "manual_whatsapp_send",
        adminAMembership.organization_id,
        orgAConversation.id,
        orgALatestInboundMessageId,
        orgAAiDraftId,
      ]),
      "utf8",
    )
    .digest("hex");
  const orgAManualSend = authenticatedFunctionResult(
    decodeClaims(
      identities.curator.accessToken,
      "p3c-org-a-curator-claims-for-manual-send",
    ),
    `platform.request_manual_whatsapp_send_with_authorization(
      ${sqlUuid(adminAMembership.organization_id, "p3c-org-a-manual-org")},
      ${sqlUuid(orgAConversation.id, "p3c-org-a-manual-conversation")},
      ${sqlUuid(
        orgALatestInboundMessageId,
        "p3c-org-a-manual-source-message",
      )},
      ${sqlUuid(orgAAiDraftId, "p3c-org-a-manual-draft")},
      'Synthetic local reviewed reply for org A.',
      'Authorize and enqueue the synthetic local manual send',
      ${sqlText(orgAManualBusinessKey)},
      ${sqlUuid(randomUUID(), "p3c-org-a-manual-send-id")}
    )`,
    "p3c-org-a-manual-send",
  );
  const orgAManualSendAuthorizationId =
    orgAManualSend?.manual_send_authorization_id;
  const orgAOutboxWorkItemId = orgAManualSend?.work_item_id;
  sqlUuid(
    orgAManualSendAuthorizationId,
    "p3c-org-a-manual-send-authorization-id",
  );
  sqlUuid(orgAOutboxWorkItemId, "p3c-org-a-outbox-work-item-id");

  const orgBAiReviewRequest = authenticatedFunctionResult(
    decodeClaims(
      identities.adminB.accessToken,
      "p3c-org-b-admin-claims-for-review-request",
    ),
    `platform.request_ai_draft_with_knowledge(
      ${sqlUuid(adminBMembership.organization_id, "p3c-org-b-review-request-org")},
      ${sqlUuid(orgBAiReviewConversation.id, "p3c-org-b-review-request-conversation")},
      ${sqlUuid(
        orgBAiReviewLatestInboundMessageId,
        "p3c-org-b-review-request-source-message",
      )},
      'en',
      ${sqlUuid(orgBKnowledgeVersionId, "p3c-org-b-review-request-knowledge")},
      'Prepare the synthetic draft that browser E2E will review',
      ${sqlUuid(randomUUID(), "p3c-org-b-review-request-id")}
    )`,
    "p3c-org-b-ai-review-request",
  );
  const orgBAiReviewDraftRequestId =
    orgBAiReviewRequest?.ai_draft_request_id;
  sqlUuid(
    orgBAiReviewDraftRequestId,
    "p3c-org-b-ai-review-draft-request-id",
  );
  const orgBAiReviewSourceContext = JSON.stringify({
    source_message_id: orgBAiReviewLatestInboundMessageId,
    knowledge_version_ids: [orgBKnowledgeVersionId],
    fixture_kind: "synthetic_non_provider",
  });
  serviceFunctionResult(
    `platform.record_ai_draft(
      ${sqlUuid(adminBMembership.organization_id, "p3c-org-b-review-draft-org")},
      ${sqlUuid(orgBAiReviewConversation.id, "p3c-org-b-review-draft-conversation")},
      ${sqlUuid(
        orgBAiReviewLatestInboundMessageId,
        "p3c-org-b-review-draft-source-message",
      )},
      'confident',
      'en',
      ${sqlUuid(orgBKnowledgeVersionId, "p3c-org-b-review-draft-knowledge")},
      'Synthetic local draft awaiting browser review.',
      'synthetic:ai-provider:not-real',
      'synthetic:model:not-real',
      'lead_manager.default@1',
      ${sqlText(orgBAiReviewSourceContext)}::jsonb,
      encode(
        sha256(
          convert_to(
            (${sqlText(orgBAiReviewSourceContext)}::jsonb)::text,
            'UTF8'
          )
        ),
        'hex'
      ),
      ${sqlUuid(randomUUID(), "p3c-org-b-review-draft-record-request")}
    )`,
    "p3c-org-b-ai-review-draft-record",
  );
  const orgBAiReviewReadyRows = await workflowRows(
    identities.adminB,
    orgBAiReviewConversation.id,
    "p3c-org-b-ai-review-ready-workflow",
  );
  assert(
    orgBAiReviewReadyRows.length === 1,
    "p3c-org-b-ai-review-ready-workflow-row",
  );
  const orgBAiReviewDraftId =
    orgBAiReviewReadyRows[0].latest_ai_draft_id;
  sqlUuid(orgBAiReviewDraftId, "p3c-org-b-ai-review-draft-id");

  recordHealthEvent({
    organizationId: adminAMembership.organization_id,
    target: "ai",
    readiness: "configured_unverified",
    evidenceKind: "local_non_provider",
    reason:
      "Latest local synthetic AI evidence is non-provider only and must not count as proved",
    evidenceRef: "synthetic:health:ai:local-non-provider:org-a",
    stage: "p3c-org-a-ai-local-non-provider",
  });
  recordHealthEvent({
    organizationId: adminAMembership.organization_id,
    target: "waha",
    readiness: "ready",
    evidenceKind: "provider_observed",
    reason:
      "Synthetic provider-observed WAHA readiness used only for the AI-unavailable manual-send browser contract",
    evidenceRef: "synthetic:health:waha:provider-ready:org-a-browser",
    stage: "p3c-org-a-waha-provider-ready-browser",
  });

  const orgAWorkflowFinalRows = await workflowRows(
    identities.curator,
    orgAConversation.id,
    "p3c-org-a-final-workflow",
  );
  assert(orgAWorkflowFinalRows.length === 1, "p3c-org-a-final-workflow-row");
  const orgAWorkflowFinal = orgAWorkflowFinalRows[0];
  assert(
    orgAWorkflowFinal.conversation_id === orgAConversation.id,
    "p3c-org-a-final-workflow-conversation",
  );
  assert(
    orgAWorkflowFinal.selected_knowledge_version_id === orgAKnowledgeVersionId,
    "p3c-org-a-final-workflow-knowledge",
  );
  assert(
    orgAWorkflowFinal.ai_readiness === "configured_unverified" &&
      orgAWorkflowFinal.ai_readiness_evidence_kind === "local_non_provider" &&
      orgAWorkflowFinal.ai_readiness_fresh === false,
    "p3c-org-a-final-workflow-ai-health",
  );
  assert(
    orgAWorkflowFinal.waha_readiness === "ready" &&
      orgAWorkflowFinal.waha_readiness_evidence_kind === "provider_observed" &&
      orgAWorkflowFinal.waha_readiness_fresh === true,
    "p3c-org-a-final-workflow-waha-health",
  );
  assert(
    !("ai_readiness_reason" in orgAWorkflowFinal) &&
      !("ai_readiness_evidence_ref" in orgAWorkflowFinal) &&
      !("waha_readiness_reason" in orgAWorkflowFinal) &&
      !("waha_readiness_evidence_ref" in orgAWorkflowFinal),
    "p3c-public-workflow-hides-private-health-evidence",
  );
  assert(
    orgAWorkflowFinal.latest_ai_draft_request_id === orgAAiDraftRequestId &&
      orgAWorkflowFinal.latest_ai_draft_id === orgAAiDraftId,
    "p3c-org-a-final-workflow-draft",
  );
  assert(
    orgAWorkflowFinal.latest_manual_send_authorization_id ===
      orgAManualSendAuthorizationId,
    "p3c-org-a-final-workflow-manual-authorization",
  );
  assert(
    orgAWorkflowFinal.latest_outbox_work_item_id === orgAOutboxWorkItemId &&
      orgAWorkflowFinal.latest_outbox_kind === "manual_whatsapp_send" &&
      orgAWorkflowFinal.latest_outbox_work_state === "queued" &&
      Number(orgAWorkflowFinal.latest_outbox_attempt_count) === 0 &&
      Number(orgAWorkflowFinal.latest_outbox_max_attempts) === 1,
    "p3c-org-a-final-workflow-outbox",
  );
  assert(
    orgAWorkflowFinal.latest_audit_action ===
      "communication.manual.send.request",
    "p3c-org-a-final-workflow-audit",
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
      identities.studentNoCase,
      noCaseStudentMembership,
      adminAMembership.organization_id,
    ],
    [
      identities.lifecycleStudent,
      lifecycleStudentMembership,
      adminAMembership.organization_id,
    ],
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
  const formerSalesWorkflowDenied = await requestJson(
    "/rest/v1/rpc/staff_conversation_workflow",
    {
      method: "POST",
      token: identities.sales.accessToken,
      body: {
        p_organization_id: adminAMembership.organization_id,
        p_conversation_id: orgAConversation.id,
      },
      schema: true,
      stage: "p3c-org-a-former-sales-workflow-denied",
    },
  );
  assert(
    formerSalesWorkflowDenied.status === 401 ||
      formerSalesWorkflowDenied.status === 403,
    "p3c-org-a-former-sales-workflow-denied",
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

  const bw4Workspace = requireSuccess(
    await requestJson(
      "/rest/v1/rpc/staff_conversation_bw4_workspace",
      {
        method: "POST",
        token: identities.adminA.accessToken,
        schema: true,
        body: {
          p_organization_id: adminAMembership.organization_id,
          p_conversation_id: orgAConversation.id,
        },
        stage: "bw4-workspace-postgrest",
      },
    ),
    "bw4-workspace-postgrest",
  );
  assert(
    bw4Workspace?.organization_id === adminAMembership.organization_id &&
      bw4Workspace?.conversation_id === orgAConversation.id &&
      bw4Workspace?.student_case_id === orgAStudentCaseId &&
      bw4Workspace?.actor_role === "admin" &&
      Array.isArray(bw4Workspace?.decisions) &&
      !JSON.stringify(bw4Workspace).includes(bw4RawContentSentinel),
    "bw4-workspace-postgrest-shape",
  );

  const bw6TemplateKey = "contract_bw6_fixture";
  const bw6TemplateTitle = "Synthetic BW6 Admissions Contract";
  const bw6FieldManifest = [
    {
      field_key: "student_name",
      source_path: "student_case.student_display_name",
      value_type: "text",
      required: true,
    },
    {
      field_key: "target_country",
      source_path: "student_case.target_country",
      value_type: "text",
      required: true,
    },
    {
      field_key: "service_package",
      source_path: "handoff.approved_commercial_fields.service_package",
      value_type: "text",
      required: true,
    },
  ];
  const bw6ChecklistBlueprint = [
    {
      item_key: "welcome_pack",
      label: "Send the synthetic welcome pack",
      owner_role: "curator",
      next_action: "Send the synthetic welcome pack",
    },
    {
      item_key: "commercial_follow_up",
      label: "Confirm the synthetic commercial follow-up",
      owner_role: "admin",
      next_action: "Confirm the synthetic commercial follow-up",
    },
  ];
  const bw6PendingCase = serviceFunctionResult(
    `platform.create_pending_student_case_with_handoff(
      ${sqlUuid(adminAMembership.organization_id, "bw6-pending-org")},
      ${sqlUuid(lifecycleStudentMembership.id, "bw6-pending-student")},
      ${sqlUuid(salesScopedMembership.id, "bw6-pending-sales")},
      'bw6-synthetic-sales-pending',
      'bw6-synthetic-contract-confirmation',
      '2026-08-04T08:00:00Z'::timestamptz,
      'BW7 Synthetic Lifecycle Student',
      ${sqlText(bw3Checklist.targetCountry)},
      ${sqlText(bw3Checklist.targetDegree)},
      ${sqlText(bw3Checklist.programDirection)},
      'synthetic_intake',
      'ru',
      'synthetic_budget',
      'intake',
      'Review the synthetic contract draft',
      ${sqlUuid(bw4OpContractVersionId, "bw6-pending-op-version")},
      ${sqlUuid(bw4OzoContractVersionId, "bw6-pending-ozo-version")},
      '{"service_package":"synthetic_standard","fee_currency":"USD","fee_amount_minor":125000,"payment_terms":"synthetic_single_payment"}'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb,
      'Complete the synthetic contract review',
      '2026-08-20T08:00:00Z'::timestamptz,
      'sales'::platform.business_role,
      ${sqlUuid(randomUUID(), "bw6-pending-request")}
    )`,
    "bw6-pending-case-create",
  );
  const bw6PendingStudentCaseId = bw6PendingCase?.student_case_id;
  sqlUuid(bw6PendingStudentCaseId, "bw6-pending-student-case-id");

  const bw7RequirementApplication = await rpc(
    identities.adminA,
    "apply_country_requirement_version",
    [
      adminAMembership.organization_id,
      bw6PendingStudentCaseId,
      bw3CountryRequirementVersionId,
      "Apply the approved synthetic checklist to the BW7 lifecycle case",
      randomUUID(),
    ],
  );
  assert(
    bw7RequirementApplication?.student_case_id === bw6PendingStudentCaseId &&
      bw7RequirementApplication?.country_requirement_version_id ===
        bw3CountryRequirementVersionId,
    "bw7-country-requirement-application",
  );
  const bw7ProfileResult = await rpc(
    identities.adminA,
    "upsert_student_profile",
    [
      adminAMembership.organization_id,
      bw6PendingStudentCaseId,
      0,
      "BW7 Lifecycle Student",
      null,
      bw3Profile.dateOfBirth,
      bw3Profile.communicationLanguage,
      bw3Profile.citizenshipCountry,
      bw3Profile.residencyCountry,
      bw3Profile.currentEducationSummary,
      bw3Profile.academicSummary,
      bw3Profile.languageSummary,
      bw3Profile.budgetBand,
      bw3Profile.decisionParticipantLabels,
      bw3Profile.consentStatus,
      bw3Profile.consentEvidenceRef,
      "Continue the BW7 lifecycle after Curator assignment",
      "Persist the minimized synthetic BW7 Student Profile",
      randomUUID(),
    ],
  );
  assert(
    bw7ProfileResult?.student_case_id === bw6PendingStudentCaseId &&
      bw7ProfileResult?.revision === 1,
    "bw7-student-profile-upsert",
  );
  const bw7StudentProfileId = bw7ProfileResult?.id;
  sqlUuid(bw7StudentProfileId, "bw7-student-profile-id");

  const bw6Template = await rpc(
    identities.adminA,
    "create_contract_template_version",
    [
      adminAMembership.organization_id,
      bw6TemplateKey,
      bw6TemplateTitle,
      bw3SourceRegistryId,
      bw6FieldManifest,
      "Student: {{student_name}}\nCountry: {{target_country}}\nPackage: {{service_package}}",
      bw6ChecklistBlueprint,
      "Create the synthetic BW6 contract template",
      randomUUID(),
    ],
  );
  const bw6ContractTemplateVersionId =
    bw6Template?.contract_template_version_id;
  sqlUuid(
    bw6ContractTemplateVersionId,
    "bw6-contract-template-version-id",
  );
  const bw6ApprovedTemplate = await rpc(
    identities.adminA,
    "approve_contract_template_version",
    [
      adminAMembership.organization_id,
      bw6ContractTemplateVersionId,
      "Approve the synthetic BW6 contract template",
      randomUUID(),
    ],
  );
  assert(
    bw6ApprovedTemplate?.status === "approved",
    "bw6-contract-template-approved",
  );

  const bw6Draft = await rpc(
    identities.adminA,
    "generate_student_case_contract_draft",
    [
      adminAMembership.organization_id,
      orgAStudentCaseId,
      bw6ContractTemplateVersionId,
      "Generate the synthetic BW6 contract draft",
      randomUUID(),
    ],
  );
  const bw6StudentCaseContractDraftId =
    bw6Draft?.student_case_contract_draft_id;
  sqlUuid(
    bw6StudentCaseContractDraftId,
    "bw6-student-case-contract-draft-id",
  );
  const bw6ReviewedDraft = await rpc(
    identities.adminA,
    "review_student_case_contract_draft",
    [
      adminAMembership.organization_id,
      orgAStudentCaseId,
      bw6StudentCaseContractDraftId,
      "approved",
      "Approve the synthetic BW6 contract draft",
      randomUUID(),
    ],
  );
  assert(
    bw6ReviewedDraft?.status === "approved",
    "bw6-contract-draft-approved",
  );

  const bw6SeedResult = await rpc(
    identities.adminA,
    "seed_post_contract_items",
    [
      adminAMembership.organization_id,
      orgAStudentCaseId,
      bw6ContractTemplateVersionId,
      "Seed the synthetic BW6 post-contract checklist",
      randomUUID(),
    ],
  );
  assert(
    bw6SeedResult?.total_item_count === bw6ChecklistBlueprint.length,
    "bw6-post-contract-items-seeded",
  );
  const bw6PostContractItems = JSON.parse(
    runSql(
      `
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', item.id,
              'item_key', item.item_key,
              'revision', item.revision,
              'owner_membership_id', item.owner_membership_id
            ) ORDER BY item.item_key
          ),
          '[]'::jsonb
        )::text
        FROM platform.post_contract_items AS item
        WHERE item.organization_id = ${sqlUuid(
          adminAMembership.organization_id,
          "bw6-items-org",
        )}
          AND item.student_case_id = ${sqlUuid(
            orgAStudentCaseId,
            "bw6-items-case",
          )}
          AND item.contract_template_version_id = ${sqlUuid(
            bw6ContractTemplateVersionId,
            "bw6-items-template",
          )};
      `,
      "bw6-post-contract-items-read",
    ),
  );
  assert(
    Array.isArray(bw6PostContractItems) &&
      bw6PostContractItems.length === bw6ChecklistBlueprint.length,
    "bw6-post-contract-items-shape",
  );
  const bw6CommercialItem = bw6PostContractItems.find(
    (item) => item.item_key === "commercial_follow_up",
  );
  const bw6WelcomeItem = bw6PostContractItems.find(
    (item) => item.item_key === "welcome_pack",
  );
  sqlUuid(bw6CommercialItem?.id, "bw6-commercial-item-id");
  sqlUuid(bw6WelcomeItem?.id, "bw6-welcome-item-id");
  await rpc(identities.adminA, "update_post_contract_item", [
    adminAMembership.organization_id,
    orgAStudentCaseId,
    bw6WelcomeItem.id,
    bw6WelcomeItem.revision,
    "delivered",
    roleMembers.curator.id,
    "Synthetic welcome pack delivered",
    "synthetic://bw6/welcome-pack",
    "Record synthetic welcome pack delivery",
    randomUUID(),
  ]);
  await rpc(identities.adminA, "update_post_contract_item", [
    adminAMembership.organization_id,
    orgAStudentCaseId,
    bw6CommercialItem.id,
    bw6CommercialItem.revision,
    "blocked",
    adminAMembership.id,
    "Resolve the synthetic commercial follow-up",
    null,
    "Record the synthetic commercial blocker",
    randomUUID(),
  ]);

  const bw6Report = await rpc(
    identities.adminA,
    "generate_post_contract_report",
    [
      adminAMembership.organization_id,
      orgAStudentCaseId,
      bw6ContractTemplateVersionId,
      "Generate the synthetic BW6 post-contract report",
      randomUUID(),
    ],
  );
  const bw6PostContractReportId = bw6Report?.post_contract_report_id;
  sqlUuid(bw6PostContractReportId, "bw6-post-contract-report-id");
  const bw6ReviewedReport = await rpc(
    identities.adminA,
    "review_post_contract_report",
    [
      adminAMembership.organization_id,
      orgAStudentCaseId,
      bw6PostContractReportId,
      "approved",
      "Approve the synthetic BW6 post-contract report",
      randomUUID(),
    ],
  );
  assert(
    bw6ReviewedReport?.status === "approved" &&
      bw6ReviewedReport?.delivered_item_count === 1 &&
      bw6ReviewedReport?.blocked_item_count === 1,
    "bw6-post-contract-report-approved",
  );

  // BW6 reuses the active case created before the contract fixture. Refresh the
  // responsible Sales token after every fixture mutation and prove that the
  // final database still exposes only the fixed post-handoff summary. This
  // catches access-version or fixture-owner drift before browser validation.
  await refresh(identities.responsibleSales, "sales");
  const bw6ResponsibleSalesSummaries = await authenticatedPlatformRpcRows(
    identities.responsibleSales,
    "sales_handoff_summaries",
    {},
    "bw6-responsible-sales-handoff-summary",
  );
  assert(
    bw6ResponsibleSalesSummaries.length === 1 &&
      bw6ResponsibleSalesSummaries[0].case_id === orgAStudentCaseId &&
      bw6ResponsibleSalesSummaries[0].case_state === "active",
    "bw6-responsible-sales-handoff-summary-shape",
  );

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
    // Provider-observed readiness is intentionally fresh for only five minutes.
    // The Auth/PostgREST smoke performs substantial setup after its first Org B
    // health event, so hand the browser suite a newly timestamped synthetic
    // contract fixture instead of coupling late scenarios to setup duration.
    // This remains a synthetic local contract fixture and is never real
    // live-provider proof.
    recordHealthEvent({
      organizationId: adminBMembership.organization_id,
      target: "ai",
      readiness: "ready",
      evidenceKind: "provider_observed",
      reason:
        "Synthetic provider-observed AI readiness refreshed only for the local browser contract gate",
      evidenceRef: "synthetic:browser:ai:provider-ready:org-b",
      stage: "p3c-org-b-ai-browser-ready",
    });
    const p5bIngressHmacSecret = randomBytes(48).toString("base64url");
    const p5bWorkerTriggerSecret = randomBytes(48).toString("base64url");
    const p5cWahaApiKey = randomBytes(48).toString("base64url");
    const p5cHistoryTriggerSecret = randomBytes(48).toString("base64url");
    const p5dWahaApiKey = randomBytes(48).toString("base64url");
    const p5dMediaTriggerSecret = randomBytes(48).toString("base64url");
    const p5dIngressHmacSecret = randomBytes(48).toString("base64url");
    const p5dWorkerTriggerSecret = randomBytes(48).toString("base64url");
    const p5f3AutonomousReplyTriggerSecret = randomBytes(48).toString("base64url");
    writeFileSync(
      browserFixturePath,
      JSON.stringify({
        apiUrl,
        publishableKey,
        p5b: {
          organizationId: adminAMembership.organization_id,
          intakeSalesMembershipId: responsibleSalesMembership.id,
          supabaseSecretKey: serviceRoleKey,
          ingressHmacSecret: p5bIngressHmacSecret,
          workerTriggerSecret: p5bWorkerTriggerSecret,
        },
        p5c: {
          wahaApiKey: p5cWahaApiKey,
          historyTriggerSecret: p5cHistoryTriggerSecret,
        },
        p5d: {
          organizationId: adminBMembership.organization_id,
          intakeSalesMembershipId: salesBMembership.id,
          supabaseSecretKey: serviceRoleKey,
          ingressHmacSecret: p5dIngressHmacSecret,
          workerTriggerSecret: p5dWorkerTriggerSecret,
          wahaApiKey: p5dWahaApiKey,
          mediaTriggerSecret: p5dMediaTriggerSecret,
        },
        p5f3: {
          autonomousReplyTriggerSecret: p5f3AutonomousReplyTriggerSecret,
        },
        identities: {
          admin: {
            email: identities.adminA.email,
            password: identities.adminA.password,
          },
          curator: {
            email: identities.curator.email,
            password: identities.curator.password,
          },
          crossOrgAdmin: {
            email: identities.adminB.email,
            password: identities.adminB.password,
          },
          salesScoped: {
            email: identities.salesScoped.email,
            password: identities.salesScoped.password,
          },
          responsibleSales: {
            email: identities.responsibleSales.email,
            password: identities.responsibleSales.password,
          },
          p5dSales: {
            email: identities.salesB.email,
            password: identities.salesB.password,
          },
          finance: {
            email: identities.finance.email,
            password: identities.finance.password,
          },
          student: {
            email: identities.student.email,
            password: identities.student.password,
          },
          studentNoCase: {
            email: identities.studentNoCase.email,
            password: identities.studentNoCase.password,
          },
          lifecycleStudent: {
            email: identities.lifecycleStudent.email,
            password: identities.lifecycleStudent.password,
          },
          revocableCurator: {
            email: identities.revocableCurator.email,
            password: identities.revocableCurator.password,
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
          orgAManual: orgAManualConversation,
          orgBAiRequest: orgBAiRequestConversation,
          orgBAiReview: orgBAiReviewConversation,
          sameOrgOutsideSalesScope: orgAScopedConversation,
        },
        bw6: {
          orgA: {
            organizationId: adminAMembership.organization_id,
            activeStudentCaseId: orgAStudentCaseId,
            contractTemplateVersionId: bw6ContractTemplateVersionId,
            studentCaseContractDraftId: bw6StudentCaseContractDraftId,
            postContractItemId: bw6WelcomeItem.id,
            postContractReportId: bw6PostContractReportId,
            templateKey: bw6TemplateKey,
            templateTitle: bw6TemplateTitle,
          },
          salesPending: {
            organizationId: adminAMembership.organization_id,
            studentCaseId: bw6PendingStudentCaseId,
            responsibleSalesMembershipId: salesScopedMembership.id,
          },
          negative: {
            crossOrgOrganizationId: adminBMembership.organization_id,
            unassignedActiveStudentCaseId: bw4UnrelatedCaseId,
          },
        },
        bw7: {
          orgA: {
            organizationId: adminAMembership.organization_id,
            studentCaseId: bw6PendingStudentCaseId,
            studentMembershipId: lifecycleStudentMembership.id,
            studentProfileId: bw7StudentProfileId,
            curatorMembershipId: roleMembers.curator.id,
            studentDisplayName: "BW7 Synthetic Lifecycle Student",
          },
        },
        p3c: {
          orgA: {
            organizationId: adminAMembership.organization_id,
            studentCaseId: orgAStudentCaseId,
            conversationId: orgAConversation.id,
            selectedKnowledgeVersionId: orgAKnowledgeVersionId,
            aiDraftRequestId: orgAAiDraftRequestId,
            aiDraftId: orgAAiDraftId,
            manualSendAuthorizationId: orgAManualSendAuthorizationId,
            outboxWorkItemId: orgAOutboxWorkItemId,
            outboxKind: "manual_whatsapp_send",
            outboxState: "queued",
            outboxAttemptCount: 0,
            outboxMaxAttempts: 1,
            latestAuditAction: "communication.manual.send.request",
            aiReadiness: "configured_unverified",
            aiEvidenceKind: "local_non_provider",
            wahaReadiness: "ready",
            wahaEvidenceKind: "provider_observed",
            reviewedText: "Synthetic local reviewed reply for org A.",
            knowledgeTitle: "Synthetic org A admissions knowledge",
            knowledgeVersion: "1",
            staleSalesAccessToken: staleResponsibleSalesAccessToken,
          },
          mutations: {
            manualAiUnavailable: {
              organizationId: adminAMembership.organization_id,
              conversationId: orgAManualConversation.id,
              sourceMessageId: orgAManualLatestInboundMessageId,
              aiReadiness: "configured_unverified",
              wahaReadiness: "ready",
            },
            aiRequest: {
              organizationId: adminBMembership.organization_id,
              conversationId: orgBAiRequestConversation.id,
              sourceMessageId: orgBAiRequestLatestInboundMessageId,
              knowledgeVersionId: orgBKnowledgeVersionId,
            },
            aiReview: {
              organizationId: adminBMembership.organization_id,
              conversationId: orgBAiReviewConversation.id,
              sourceMessageId: orgBAiReviewLatestInboundMessageId,
              aiDraftId: orgBAiReviewDraftId,
              generatedText: "Synthetic local draft awaiting browser review.",
            },
          },
        },
        p2r3: {
          organizationId: adminAMembership.organization_id,
          revocableMembershipId: revocableCuratorMembership.id,
        },
        bw4: {
          orgA: {
            organizationId: adminAMembership.organization_id,
            conversationId: orgAConversation.id,
            studentCaseId: orgAStudentCaseId,
            decisionId: bw4DecisionId,
            decisionQuestion: bw4DecisionQuestion,
            reviewedSourceId: bw3SourceRegistryId,
            sourceKey: bw3SourceKey,
            sourceUrl: bw3SourceUrl,
            answerText: bw4DecisionAnswer,
            reopenedStatus: "unresolved",
            promptPolicyTitle: bw4PromptPolicyTitle,
            promptPolicyVersion: String(
              orgAPromptArtifacts.promptPolicy.version,
            ),
            promptPolicySha:
              orgAPromptArtifacts.promptPolicy.content_sha256,
            businessContextTitle: bw4BusinessContextTitle,
            businessContextVersion: String(
              orgAPromptArtifacts.businessContext.version,
            ),
            businessContextSha:
              orgAPromptArtifacts.businessContext.content_sha256,
            rawContentSentinel: bw4RawContentSentinel,
            handoffNextStep: bw4HandoffNextStep,
            responsibleRole: bw4HandoffResponsibleRole,
          },
          noCase: {
            organizationId: adminAMembership.organization_id,
            conversationId: bw4NoCaseConversation.id,
            studentCaseId: null,
          },
          languages: {
            ruConversationId: bw4RuConversation.id,
            enConversationId: bw4EnConversation.id,
            undeterminedConversationId: bw4UndeterminedConversation.id,
          },
          negative: {
            formerSalesMembershipId: roleMembers.sales.id,
            crossOrgOrganizationId: adminBMembership.organization_id,
            unrelatedStudentCaseId: bw4UnrelatedCaseId,
          },
        },
        bw3: {
          orgA: {
            organizationId: adminAMembership.organization_id,
            studentCaseId: orgAStudentCaseId,
            studentProfileId: bw3StudentProfileId,
            studentIdentityProfileId: roleMembers.student.profile_id,
            sourceRegistryId: bw3SourceRegistryId,
            countryRequirementSourceLinkId:
              bw3CountryRequirementSourceLinkId,
            countryRequirementVersionId: bw3CountryRequirementVersionId,
            documentRequirementId: bw3DocumentRequirementId,
            documentSlotId: bw3DocumentSlotId,
            appliedDocumentSlotCount: bw3Application.document_slot_count,
            profileRevision: bw3ProfileResult.revision,
            checklist: bw3Checklist,
            profile: bw3Profile,
            document: bw3Document,
          },
          noCaseStudent: {
            membershipId: noCaseStudentMembership.id,
            profileId: noCaseStudentMembership.profile_id,
            displayName: "Synthetic student-no-case",
          },
        },
      }),
      { mode: 0o600 },
    );
  }

  console.log(
    "Local Supabase Auth/PostgREST smoke passed: public signup disabled; 14 admin-provisioned synthetic users, 5 roles, 2 organizations, expired/stale-token and blocked-claim invalidation; synthetic readiness rows are contract fixtures only and are not live provider proof.",
  );
};

main().catch((error) => {
  const stage =
    error instanceof SmokeFailure ? error.stage : "unexpected-runtime";
  console.error(`ERROR: local Supabase Auth smoke failed at ${stage}.`);
  process.exitCode = 1;
});
