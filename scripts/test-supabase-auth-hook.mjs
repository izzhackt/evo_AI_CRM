import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
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

if (!statusPath || !databaseContainer) {
  fail("arguments");
}

let apiUrl;
let publishableKey;

try {
  const status = JSON.parse(readFileSync(statusPath, "utf8"));
  apiUrl = status.API_URL;
  publishableKey = status.PUBLISHABLE_KEY;
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

const requestJson = async (
  path,
  { method = "GET", token, body, schema = false, stage },
) => {
  const headers = {
    apikey: publishableKey,
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

const syntheticIdentity = (label) => ({
  label,
  userId: null,
  email: `${randomUUID()}@example.invalid`,
  password: `Evo-${randomBytes(24).toString("base64url")}!9a`,
  accessToken: null,
  refreshToken: null,
});

const signUp = async (identity) => {
  const payload = await authRequest(
    "/auth/v1/signup",
    {
      email: identity.email,
      password: identity.password,
    },
    `${identity.label}-signup`,
  );

  assert(typeof payload.user?.id === "string", `${identity.label}-signup-user`);
  identity.userId = payload.user.id;

  if (payload.access_token) {
    const claims = decodeClaims(
      payload.access_token,
      `${identity.label}-signup-claims`,
    );
    assert(
      !Object.hasOwn(claims, "platform_role") &&
        !Object.hasOwn(claims, "platform_access_version"),
      `${identity.label}-signup-platform-claims`,
    );
  }
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
    curator: syntheticIdentity("curator"),
    finance: syntheticIdentity("finance"),
    student: syntheticIdentity("student"),
    blocked: syntheticIdentity("blocked"),
    noMembership: syntheticIdentity("no-membership"),
    adminB: syntheticIdentity("admin-b"),
  };

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

  console.log(
    "Local Supabase Auth/PostgREST smoke passed: 8 synthetic users, 5 roles, 2 organizations, stale-token and blocked-claim invalidation.",
  );
};

main().catch((error) => {
  const stage =
    error instanceof SmokeFailure ? error.stage : "unexpected-runtime";
  console.error(`ERROR: local Supabase Auth smoke failed at ${stage}.`);
  process.exitCode = 1;
});
