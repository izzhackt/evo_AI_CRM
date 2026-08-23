import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync, statSync, unlinkSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import {
  LocalSupabaseAuthReadinessError,
  waitForLocalSupabaseAuthAdmin,
} from "./supabase-auth-readiness.mjs";

process.on("uncaughtException", () => {
  console.error(
    "ERROR: local P2H Storage API gate failed before runtime initialization.",
  );
  process.exit(1);
});

class GateFailure extends Error {
  constructor(stage) {
    super(stage);
    this.stage = stage;
  }
}

const fail = (stage) => {
  throw new GateFailure(stage);
};

const assert = (condition, stage) => {
  if (!condition) {
    fail(stage);
  }
};

const assertExactKeys = (value, expectedKeys, stage) => {
  assert(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join("\n") ===
        [...expectedKeys].sort().join("\n"),
    stage,
  );
};

const statusPath = process.argv[2];
const databaseContainer = process.argv[3];

if (!statusPath || !databaseContainer) {
  fail("arguments");
}

let apiUrl;
let publishableKey;
let serviceRoleKey;

try {
  assert((statSync(statusPath).mode & 0o777) === 0o600, "status-file-mode");
  const status = JSON.parse(readFileSync(statusPath, "utf8"));
  apiUrl = status.API_URL;
  publishableKey = status.PUBLISHABLE_KEY;
  serviceRoleKey = status.SERVICE_ROLE_KEY;
} finally {
  // Supabase status contains multiple privileged disposable credentials. The
  // caller creates this file under umask 077 and chmod 0600. Delete it before
  // the first network/SQL assertion and never log any parsed value.
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
  /^supabase_db_evo-platform-local$/.test(databaseContainer),
  "database-container",
);

const BUCKET = "platform-documents";
const MAX_BYTES = 25 * 1024 * 1024;

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
      maxBuffer: 2 * 1024 * 1024,
    },
  );

  assert(result.status === 0, stage);
  return result.stdout.trim();
};

const BARRIER_SESSION_TIMEOUT_MS = 8_000;
const BARRIER_POLL_TIMEOUT_MS = 5_000;
const BARRIER_CLEANUP_TIMEOUT_MS = 1_000;

const withTimeout = async (promise, timeoutMs, stage) => {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new GateFailure(stage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
};

const startPsqlSession = (stage) => {
  const child = spawn(
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
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  let closed = false;
  let spawnError = null;

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  // Cleanup may race with psql closing stdin after an ON_ERROR_STOP failure.
  // The session result still records that failure through close/spawnError.
  child.stdin.on("error", () => {});

  const exitPromise = new Promise((resolve) => {
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, signal) => {
      closed = true;
      resolve({ code, signal });
    });
  });

  const write = (sql, writeStage = `${stage}-write`) => {
    assert(!closed && child.stdin.writable, writeStage);
    child.stdin.write(sql);
  };

  const end = () => {
    if (!closed && child.stdin.writable) {
      child.stdin.end();
    }
  };

  const waitForOutput = async (
    marker,
    timeoutMs = BARRIER_SESSION_TIMEOUT_MS,
    waitStage = `${stage}-output`,
  ) => {
    await withTimeout(
      (async () => {
        while (!stdout.includes(marker)) {
          assert(!closed, waitStage);
          await delay(25);
        }
      })(),
      timeoutMs,
      waitStage,
    );
  };

  const waitForSuccess = async (
    timeoutMs = BARRIER_SESSION_TIMEOUT_MS,
    waitStage = `${stage}-exit`,
  ) => {
    const result = await withTimeout(exitPromise, timeoutMs, waitStage);
    assert(spawnError === null && result.code === 0, waitStage);
    assert(!`${stdout}\n${stderr}`.includes("40P01"), `${waitStage}-40p01`);
    return { stdout, stderr };
  };

  const cleanup = async () => {
    if (closed) {
      return;
    }

    try {
      if (child.stdin.writable) {
        child.stdin.write("ROLLBACK;\n\\q\n");
        child.stdin.end();
      }
    } catch {
      // Continue to bounded process termination below.
    }

    let result = await Promise.race([
      exitPromise,
      delay(BARRIER_CLEANUP_TIMEOUT_MS).then(() => null),
    ]);
    if (result === null && !closed) {
      child.kill("SIGTERM");
      result = await Promise.race([
        exitPromise,
        delay(BARRIER_CLEANUP_TIMEOUT_MS).then(() => null),
      ]);
    }
    if (result === null && !closed) {
      child.kill("SIGKILL");
      await Promise.race([
        exitPromise,
        delay(BARRIER_CLEANUP_TIMEOUT_MS).then(() => null),
      ]);
    }
  };

  return {
    cleanup,
    end,
    waitForOutput,
    waitForSuccess,
    write,
    get stdout() {
      return stdout;
    },
  };
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

  const responseText = await response.text();
  let payload = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      // Error bodies are provider-owned and can change without changing the
      // authorization contract. Successful JSON calls must still be valid.
      if (response.ok) {
        fail(`${stage}-json`);
      }
    }
  }

  return { status: response.status, ok: response.ok, payload };
};

const requireSuccess = (result, stage) => {
  const failureCode =
    result.payload !== null &&
    typeof result.payload === "object" &&
    !Array.isArray(result.payload) &&
    typeof result.payload.code === "string" &&
    /^[0-9A-Z]{5}$/.test(result.payload.code)
      ? result.payload.code
      : "unknown";
  assert(result.ok, `${stage}-http-${result.status}-code-${failureCode}`);
  return result.payload;
};

const requireDenied = (result, stage) => {
  assert(!result.ok, `${stage}-unexpected-success`);
  assert(
    result.status >= 400 && result.status < 500,
    `${stage}-unexpected-http-${result.status}`,
  );
};

const denialSignature = (result, stage) => {
  requireDenied(result, stage);
  assertExactKeys(
    result.payload,
    ["code", "details", "hint", "message"],
    `${stage}-body-shape`,
  );
  return JSON.stringify({
    status: result.status,
    code: result.payload.code,
    details: result.payload.details,
    hint: result.payload.hint,
    message: result.payload.message,
  });
};

const requireApiError = (result, status, code, message, stage) => {
  const signature = JSON.parse(denialSignature(result, stage));
  assert(
    signature.status === status &&
      signature.code === code &&
      signature.details === null &&
      signature.hint === null &&
      signature.message === message,
    `${stage}-contract`,
  );
  return signature;
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

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    fail(stage);
  }
};

const syntheticIdentity = (label) => ({
  label,
  userId: null,
  email: `${randomUUID()}@example.invalid`,
  password: `Evo-${randomBytes(24).toString("base64url")}!9a`,
  accessToken: null,
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
    typeof payload.access_token === "string",
    `${identity.label}-signin-session`,
  );

  const claims = decodeClaims(
    payload.access_token,
    `${identity.label}-signin-claims`,
  );
  if (expectedRole === null) {
    for (const claim of [
      "platform_role",
      "platform_access_version",
      "platform_organization_id",
      "platform_membership_id",
      "platform_bundle_id",
      "platform_bundle_version",
    ]) {
      assert(!Object.hasOwn(claims, claim), `${identity.label}-${claim}-absent`);
    }
  } else {
    assert(claims.platform_role === expectedRole, `${identity.label}-role`);
    assert(
      Number.isSafeInteger(claims.platform_access_version) &&
        claims.platform_access_version > 0,
      `${identity.label}-access-version`,
    );
  }
  identity.accessToken = payload.access_token;
  return claims;
};

const membershipFor = (identity) => {
  const output = runSql(
    `
      SELECT jsonb_build_object(
        'id', membership.id,
        'organization_id', membership.organization_id,
        'profile_id', membership.profile_id,
        'role', membership."current_role",
        'status', membership.status,
        'access_version', profile.access_version,
        'bundle_id', bundle.id,
        'bundle_version', bundle.version
      )::text
      FROM platform.organization_memberships AS membership
      JOIN platform.profiles AS profile
        ON profile.id = membership.profile_id
      JOIN platform.role_bundle_versions AS bundle
        ON bundle.id = membership.current_bundle_id
      WHERE profile.auth_user_id = ${sqlUuid(
        identity.userId,
        `${identity.label}-membership-user`,
      )}
      ORDER BY membership.created_at DESC
      LIMIT 1;
    `,
    `${identity.label}-membership`,
  );
  assert(output.length > 0, `${identity.label}-membership`);
  return JSON.parse(output);
};

const createOrganizationFixture = (adminIdentity, label) => {
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
      VALUES (
        ${sqlUuid(organizationId)},
        ${sqlText(`Synthetic ${label}`)}
      );
      INSERT INTO platform.profiles (
        id,
        auth_user_id,
        display_name
      )
      VALUES (
        ${sqlUuid(profileId)},
        ${sqlUuid(adminIdentity.userId, `${label}-admin-user`)},
        ${sqlText(`Synthetic ${label} admin`)}
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
        'local P2H Storage organization fixture',
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
        'local P2H Storage organization fixture',
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
        'local-p2h-fixture',
        'organization.bootstrap',
        'organization',
        ${sqlUuid(organizationId)},
        NULL,
        jsonb_build_object(
          'organization_id', ${sqlUuid(organizationId)},
          'membership_id', ${sqlUuid(membershipId)}
        ),
        'local P2H Storage organization fixture',
        ${sqlUuid(auditRequestId)}
      );
      COMMIT;
    `,
    `${label}-organization-fixture`,
  );
  const membership = membershipFor(adminIdentity);
  assert(
    membership.organization_id === organizationId &&
      membership.id === membershipId,
    `${label}-organization-fixture-result`,
  );
  return organizationId;
};

const routineArgumentNames = (routineName) => {
  assert(/^[a-z][a-z0-9_]+$/.test(routineName), "routine-name");
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
  assert(
    Array.isArray(names) && names.length > 0,
    `routine-${routineName}-names`,
  );
  return names;
};

const rpcRequest = async (
  { token, apiKey = publishableKey },
  routineName,
  orderedValues,
  stage,
) => {
  const argumentNames = routineArgumentNames(routineName);
  assert(
    argumentNames.length === orderedValues.length,
    `${stage}-argument-count`,
  );
  const body = Object.fromEntries(
    argumentNames.map((name, index) => [name, orderedValues[index]]),
  );

  return requestJson(`/rest/v1/rpc/${routineName}`, {
    method: "POST",
    token,
    apiKey,
    body,
    schema: true,
    stage,
  });
};

const rpc = async (identity, routineName, orderedValues, stage) =>
  requireSuccess(
    await rpcRequest(
      { token: identity.accessToken },
      routineName,
      orderedValues,
      stage,
    ),
    stage,
  );

const serviceRpc = async (routineName, orderedValues, stage) =>
  requireSuccess(
    await rpcRequest(
      { token: serviceRoleKey, apiKey: serviceRoleKey },
      routineName,
      orderedValues,
      stage,
    ),
    stage,
  );

const waitForPlatformApi = async (identity, membershipId) => {
  const deadline = Date.now() + 30_000;
  const path = `/rest/v1/organization_memberships?select=id&id=eq.${membershipId}`;

  while (Date.now() < deadline) {
    const result = await requestJson(path, {
      token: identity.accessToken,
      schema: true,
      stage: "platform-api-readiness",
    });
    if (
      result.ok &&
      Array.isArray(result.payload) &&
      result.payload.length === 1
    ) {
      return;
    }
    await delay(250);
  }
  fail("platform-api-readiness");
};

const provisionMembership = async (
  adminIdentity,
  organizationId,
  identity,
  role,
) => {
  if (["admin", "sales", "curator"].includes(role)) {
    await rpc(
      adminIdentity,
      "provision_pilot_staff_member",
      [
        organizationId,
        identity.userId,
        `Synthetic ${identity.label}`,
        role,
        "local P2H Storage provision",
        randomUUID(),
      ],
      `${identity.label}-provision`,
    );
  } else {
    // Student Portal and retired Finance identities are historical Storage
    // fixtures only. The authenticated U1 Admin API deliberately cannot assign
    // either role, so disposable setup calls the old implementation as postgres
    // with an exact synthetic Admin authority bundle.
    const adminMembership = membershipFor(adminIdentity);
    runSql(
      `
        BEGIN;
        SELECT set_config(
          'request.jwt.claims',
          jsonb_build_object(
            'sub', ${sqlUuid(adminIdentity.userId)},
            'role', 'authenticated',
            'platform_role', 'admin',
            'platform_access_version', ${adminMembership.access_version},
            'platform_organization_id', ${sqlText(adminMembership.organization_id)},
            'platform_membership_id', ${sqlText(adminMembership.id)},
            'platform_bundle_id', ${sqlText(adminMembership.bundle_id)},
            'platform_bundle_version', ${adminMembership.bundle_version}
          )::TEXT,
          TRUE
        );
        SELECT platform.provision_member(
          ${sqlUuid(organizationId)},
          ${sqlUuid(identity.userId)},
          ${sqlText(`Synthetic ${identity.label}`)},
          ${sqlText(role)}::platform.business_role,
          'privileged local historical Storage fixture setup',
          ${sqlUuid(randomUUID())}
        )::TEXT;
        COMMIT;
      `,
      `${identity.label}-historical-provision`,
    );
  }
  const membership = membershipFor(identity);
  await rpc(
    adminIdentity,
    "assign_organization_scope",
    [
      organizationId,
      membership.id,
      "local P2H Storage organization scope",
      randomUUID(),
    ],
    `${identity.label}-organization-scope`,
  );
  return membershipFor(identity);
};

const createPendingCase = async (
  organizationId,
  studentMembershipId,
  salesMembershipId,
  label,
) => {
  const result = await serviceRpc(
    "create_pending_student_case",
    [
      organizationId,
      studentMembershipId,
      salesMembershipId,
      `p2h-${label}`,
      `contract-${label}.example.invalid`,
      new Date().toISOString(),
      `Synthetic ${label}`,
      "Kyrgyzstan",
      "bachelor",
      "computer-science",
      "2027-fall",
      "en",
      "self-funded",
      "contract_confirmed",
      "Assign a curator",
      randomUUID(),
    ],
    `${label}-case-create`,
  );
  assert(
    typeof result.student_case_id === "string",
    `${label}-case-create-result`,
  );
  return result.student_case_id;
};

const assignCurator = async (
  adminIdentity,
  organizationId,
  studentCaseId,
  curatorMembershipId,
  label,
) =>
  rpc(
    adminIdentity,
    "assign_student_case_curator",
    [
      organizationId,
      studentCaseId,
      curatorMembershipId,
      `local P2H Storage ${label}`,
      randomUUID(),
    ],
    `${label}-curator-assign`,
  );

const createDocumentRequirement = async (adminIdentity, organizationId) => {
  const result = await rpc(
    adminIdentity,
    "create_document_requirement",
    [
      organizationId,
      "Kyrgyzstan",
      "bachelor",
      "computer-science",
      1,
      `p2h-${randomUUID()}`,
      "Synthetic identity document",
      "Local P2H policy fixture only",
      randomUUID(),
    ],
    "document-requirement-create",
  );
  assert(
    typeof result.document_requirement_id === "string",
    "document-requirement-result",
  );
  return result.document_requirement_id;
};

const createDocumentSlot = async (
  adminIdentity,
  organizationId,
  studentCaseId,
  requirementId,
  label,
) => {
  const result = await rpc(
    adminIdentity,
    "create_document_slot",
    [
      organizationId,
      studentCaseId,
      requirementId,
      null,
      `Upload synthetic ${label} evidence`,
      randomUUID(),
    ],
    `${label}-slot-create`,
  );
  assert(typeof result.document_slot_id === "string", `${label}-slot-result`);
  return result.document_slot_id;
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const opaqueObjectName = (value, originalFilename, stage) => {
  assert(
    typeof value === "string" &&
      value.length >= 32 &&
      value.length <= 512 &&
      !value.includes("..") &&
      !value.includes(originalFilename) &&
      /^[a-zA-Z0-9/_-]+(?:\.[a-zA-Z0-9]+)?$/.test(value),
    stage,
  );
  return value;
};

const reserveUpload = async (
  identity,
  organizationId,
  documentSlotId,
  originalFilename,
  mimeType,
  bytes,
  requestId = randomUUID(),
) => {
  const result = await rpc(
    identity,
    "reserve_document_upload",
    [
      organizationId,
      documentSlotId,
      originalFilename,
      mimeType,
      bytes.length,
      sha256(bytes),
      requestId,
    ],
    `${identity.label}-reserve-upload`,
  );

  assert(result.bucket_id === BUCKET, `${identity.label}-reserve-bucket`);
  assert(
    typeof result.document_version_id === "string" &&
      typeof result.upload_reservation_id === "string" &&
      typeof result.expires_at === "string",
    `${identity.label}-reserve-result`,
  );
  result.object_name = opaqueObjectName(
    result.object_name,
    originalFilename,
    `${identity.label}-reserve-object-name`,
  );
  return { ...result, requestId };
};

const assertFinalizationResult = (
  result,
  organizationId,
  reservation,
  stage,
) => {
  assertExactKeys(
    result,
    [
      "organization_id",
      "student_case_id",
      "document_slot_id",
      "document_version_id",
      "upload_reservation_id",
      "bucket_id",
      "object_name",
      "object_created_at",
      "finalized_at",
      "published_slot_status",
      "published_version_no",
      "document_slot_published",
    ],
    `${stage}-keys`,
  );
  assert(
    result.organization_id === organizationId &&
      result.upload_reservation_id === reservation.upload_reservation_id &&
      result.document_version_id === reservation.document_version_id &&
      result.object_name === reservation.object_name &&
      result.published_slot_status === "submitted" &&
      Number.isInteger(result.published_version_no) &&
      result.document_slot_published === true,
    `${stage}-result`,
  );
  return result;
};

const finalizeUpload = async (
  organizationId,
  reservation,
  requestId = randomUUID(),
  stage = "finalize-document-upload",
) => {
  const result = assertFinalizationResult(
    await serviceRpc(
      "finalize_document_upload",
      [organizationId, reservation.upload_reservation_id, requestId],
      stage,
    ),
    organizationId,
    reservation,
    stage,
  );
  return { ...result, requestId };
};

const encodeObjectName = (objectName) =>
  objectName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const storageRequest = async (
  path,
  {
    method = "GET",
    token,
    apiKey = publishableKey,
    body,
    contentType,
    upsert,
    json,
    stage,
  },
) => {
  const headers = { apikey: apiKey };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (contentType) {
    headers["Content-Type"] = contentType;
  }
  if (upsert !== undefined) {
    headers["x-upsert"] = String(upsert);
  }
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(`${apiUrl}/storage/v1${path}`, {
      method,
      headers,
      body: json === undefined ? body : JSON.stringify(json),
    });
  } catch {
    fail(stage);
  }

  const responseBytes = Buffer.from(await response.arrayBuffer());
  let payload = null;
  if (
    responseBytes.length > 0 &&
    response.headers.get("content-type")?.includes("application/json")
  ) {
    try {
      payload = JSON.parse(responseBytes.toString("utf8"));
    } catch {
      if (response.ok) {
        fail(`${stage}-json`);
      }
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    bytes: responseBytes,
    payload,
  };
};

const upload = async (
  identity,
  reservation,
  bytes,
  contentType,
  { upsert = false, stage },
) =>
  storageRequest(
    `/object/${BUCKET}/${encodeObjectName(reservation.object_name)}`,
    {
      method: "POST",
      token: identity.accessToken,
      body: bytes,
      contentType,
      upsert,
      stage,
    },
  );

const requireStorageSuccess = (result, stage) => {
  assert(result.ok, `${stage}-http-${result.status}`);
};

const requireStorageDenied = (result, stage) => {
  assert(!result.ok, `${stage}-unexpected-success`);
  assert(
    result.status >= 400 && result.status < 500,
    `${stage}-unexpected-http-${result.status}`,
  );
};

const serviceDownload = async (objectName, stage) => {
  const result = await storageRequest(
    `/object/authenticated/${BUCKET}/${encodeObjectName(objectName)}`,
    {
      token: serviceRoleKey,
      apiKey: serviceRoleKey,
      stage,
    },
  );
  requireStorageSuccess(result, stage);
  return result.bytes;
};

const assertSameBytes = (actual, expected, stage) => {
  assert(actual.length === expected.length, `${stage}-length`);
  const actualHash = Buffer.from(sha256(actual), "hex");
  const expectedHash = Buffer.from(sha256(expected), "hex");
  assert(
    actualHash.length === expectedHash.length &&
      timingSafeEqual(actualHash, expectedHash),
    `${stage}-hash`,
  );
};

const directAuthenticatedGet = (token, objectName, stage) =>
  storageRequest(
    `/object/authenticated/${BUCKET}/${encodeObjectName(objectName)}`,
    { token, stage },
  );

const signObject = (
  token,
  objectName,
  stage,
  { apiKey = publishableKey, expiresIn = 60 } = {},
) =>
  storageRequest(`/object/sign/${BUCKET}/${encodeObjectName(objectName)}`, {
    method: "POST",
    token,
    apiKey,
    json: { expiresIn },
    stage,
  });

const listObjects = (token, apiKey, stage) =>
  storageRequest(`/object/list/${BUCKET}`, {
    method: "POST",
    token,
    apiKey,
    json: {
      prefix: "",
      limit: 100,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    },
    stage,
  });

const assertListDeniedOrEmpty = (result, stage) => {
  if (!result.ok) {
    assert(
      result.status >= 400 && result.status < 500,
      `${stage}-unexpected-http-${result.status}`,
    );
    return;
  }
  assert(
    Array.isArray(result.payload) && result.payload.length === 0,
    `${stage}-visible-objects`,
  );
};

const readBackupInventory = async () => {
  const result = await requestJson(
    "/rest/v1/rpc/document_storage_backup_inventory",
    {
      method: "POST",
      token: serviceRoleKey,
      apiKey: serviceRoleKey,
      body: {},
      schema: true,
      stage: "service-backup-inventory",
    },
  );
  const rows = requireSuccess(result, "service-backup-inventory");
  assert(Array.isArray(rows), "service-backup-inventory-shape");

  const forbiddenKey = /(?:original_?filename|signed_?url|token|credential)/i;
  for (const row of rows) {
    assert(
      row &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        Object.keys(row).every((key) => !forbiddenKey.test(key)) &&
        Object.values(row).every(
          (value) =>
            typeof value !== "string" ||
            (!value.includes("@example.invalid") &&
              !value.startsWith("Bearer ")),
        ),
      "service-backup-inventory-redaction",
    );
  }
  return rows;
};

const attestValidation = async (
  organizationId,
  documentVersionId,
  expectedBytes,
  objectName,
  label,
) => {
  const downloaded = await serviceDownload(
    objectName,
    `${label}-attestation-download`,
  );
  assertSameBytes(downloaded, expectedBytes, `${label}-attestation-bytes`);

  await serviceRpc(
    "attest_document_validation",
    [
      organizationId,
      documentVersionId,
      "verified",
      "clean",
      "local-p2h-byte-hash-no-malware-provider",
      `sha256:${sha256(downloaded)}`,
      randomUUID(),
    ],
    `${label}-attest-validation`,
  );

  const attestation = JSON.parse(
    runSql(
      `
      SELECT jsonb_build_object(
        'integrity_status', integrity_status,
        'malware_status', malware_status,
        'validation_recorded', validation_updated_at IS NOT NULL
      )::text
      FROM platform.document_versions
      WHERE organization_id = ${sqlUuid(organizationId)}
        AND id = ${sqlUuid(documentVersionId)};
    `,
      `${label}-attestation-state`,
    ),
  );
  assert(
    attestation.integrity_status === "verified" &&
      attestation.malware_status === "clean" &&
      attestation.validation_recorded === true,
    `${label}-attestation-state`,
  );
};

const grantDownload = async (
  identity,
  organizationId,
  documentVersionId,
  purpose,
  expiresInSeconds,
  requestId = randomUUID(),
  stage = `${identity.label}-grant-download`,
) => {
  const result = await rpc(
    identity,
    "grant_document_download",
    [organizationId, documentVersionId, purpose, expiresInSeconds, requestId],
    stage,
  );
  assertExactKeys(
    result,
    [
      "document_download_grant_id",
      "expires_at",
      "signed_url",
      "storage_api_service_sign_required",
    ],
    `${stage}-result-keys`,
  );
  assert(
    typeof result.document_download_grant_id === "string" &&
      typeof result.expires_at === "string" &&
      result.signed_url === null &&
      result.storage_api_service_sign_required === true,
    `${stage}-result`,
  );
  return { ...result, requestId };
};

const waitForGrantBlockedBeforeVersion = async (ownerPid, stage) =>
  withTimeout(
    (async () => {
      while (true) {
        const waiters = JSON.parse(
          runSql(
            `
            SELECT COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'pid', activity.pid,
                  'wait_event_type', activity.wait_event_type,
                  'organization_row_share', EXISTS (
                    SELECT 1
                    FROM pg_locks AS relation_lock
                    WHERE relation_lock.pid = activity.pid
                      AND relation_lock.locktype = 'relation'
                      AND relation_lock.relation =
                        'platform.organizations'::regclass
                      AND relation_lock.mode = 'RowShareLock'
                      AND relation_lock.granted
                  ),
                  'case_row_share', EXISTS (
                    SELECT 1
                    FROM pg_locks AS relation_lock
                    WHERE relation_lock.pid = activity.pid
                      AND relation_lock.locktype = 'relation'
                      AND relation_lock.relation =
                        'platform.student_cases'::regclass
                      AND relation_lock.mode = 'RowShareLock'
                      AND relation_lock.granted
                  ),
                  'version_row_share', EXISTS (
                    SELECT 1
                    FROM pg_locks AS relation_lock
                    WHERE relation_lock.pid = activity.pid
                      AND relation_lock.locktype = 'relation'
                      AND relation_lock.relation =
                        'platform.document_versions'::regclass
                      AND relation_lock.mode = 'RowShareLock'
                      AND relation_lock.granted
                  )
                )
                ORDER BY activity.pid
              ),
              '[]'::jsonb
            )::text
            FROM pg_stat_activity AS activity
            WHERE activity.state = 'active'
              AND activity.query ILIKE '%grant_document_download%'
              AND ${Number(ownerPid)} =
                ANY(pg_blocking_pids(activity.pid));
          `,
            `${stage}-observe-grant-wait`,
          ),
        );

        if (
          waiters.length === 1 &&
          waiters[0].wait_event_type === "Lock" &&
          waiters[0].organization_row_share === true &&
          waiters[0].case_row_share === false &&
          waiters[0].version_row_share === false
        ) {
          return waiters[0];
        }

        await delay(25);
      }
    })(),
    BARRIER_POLL_TIMEOUT_MS,
    `${stage}-grant-did-not-wait-organization-before-case-version`,
  );

const parsePsqlPrefixedValue = (stdout, prefix, stage) => {
  const line = stdout
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith(prefix));
  assert(typeof line === "string", stage);
  return line.slice(prefix.length);
};

const runOrganizationBeforeCaseVersionGrantBarrier = async ({
  stage,
  ownerRole,
  ownerClaims,
  ownerResultExpression,
  organizationId,
  documentVersionId,
  grantIdentity,
  grantPurpose,
  grantRequestId,
}) => {
  assert(
    ownerRole === "authenticated" || ownerRole === "service_role",
    `${stage}-owner-role`,
  );
  assert(
    ownerClaims !== null &&
      typeof ownerClaims === "object" &&
      !Array.isArray(ownerClaims),
    `${stage}-owner-claims`,
  );

  const markerToken = randomUUID().replaceAll("-", "");
  const pidPrefix = `P2H_${markerToken}_PID=`;
  const resultPrefix = `P2H_${markerToken}_RESULT=`;
  const readyMarker = `P2H_${markerToken}_ORGANIZATION_LOCKED`;
  const doneMarker = `P2H_${markerToken}_COMMITTED`;
  const session = startPsqlSession(`${stage}-owner`);
  let grantOutcomePromise = null;

  try {
    session.write(
      [
        "\\set VERBOSITY verbose",
        "BEGIN;",
        `SET LOCAL statement_timeout = '${BARRIER_SESSION_TIMEOUT_MS}ms';`,
        `SET LOCAL lock_timeout = '${BARRIER_POLL_TIMEOUT_MS}ms';`,
        "SET LOCAL idle_in_transaction_session_timeout = '12000ms';",
        `SELECT set_config('application_name', ${sqlText(
          `p2h-${stage}-owner`,
        )}, true);`,
        `SELECT ${sqlText(pidPrefix)} || pg_backend_pid()::text;`,
        "SELECT id::text",
        "FROM platform.organizations",
        `WHERE id = ${sqlUuid(organizationId)}`,
        "FOR UPDATE;",
        `\\echo ${readyMarker}`,
        "",
      ].join("\n"),
      `${stage}-lock-organization`,
    );
    await session.waitForOutput(
      readyMarker,
      BARRIER_SESSION_TIMEOUT_MS,
      `${stage}-organization-lock-ready`,
    );

    const ownerPidText = parsePsqlPrefixedValue(
      session.stdout,
      pidPrefix,
      `${stage}-owner-pid`,
    );
    assert(/^[1-9][0-9]*$/.test(ownerPidText), `${stage}-owner-pid`);
    const ownerPid = Number(ownerPidText);

    grantOutcomePromise = grantDownload(
      grantIdentity,
      organizationId,
      documentVersionId,
      grantPurpose,
      60,
      grantRequestId,
      `${stage}-grant`,
    ).then(
      (value) => ({ fulfilled: true, value }),
      (error) => ({ fulfilled: false, error }),
    );

    const waiter = await waitForGrantBlockedBeforeVersion(ownerPid, stage);
    assert(
      Number.isInteger(waiter.pid) && waiter.pid !== ownerPid,
      `${stage}-grant-waiter`,
    );

    const independentlyLockedVersionId = runSql(
      `
      BEGIN;
      SET LOCAL lock_timeout = '1000ms';
      SELECT id::text
      FROM platform.document_versions
      WHERE organization_id = ${sqlUuid(organizationId)}
        AND id = ${sqlUuid(documentVersionId)}
      FOR UPDATE NOWAIT;
      ROLLBACK;
    `,
      `${stage}-version-nowait`,
    );
    assert(
      independentlyLockedVersionId === documentVersionId,
      `${stage}-version-nowait-result`,
    );

    session.write(
      [
        `SELECT set_config('request.jwt.claims', ${sqlText(
          JSON.stringify(ownerClaims),
        )}, true);`,
        `SET LOCAL ROLE ${ownerRole};`,
        `SELECT ${sqlText(resultPrefix)} || (${ownerResultExpression})::text;`,
        "COMMIT;",
        `\\echo ${doneMarker}`,
        "\\q",
        "",
      ].join("\n"),
      `${stage}-owner-operation`,
    );
    session.end();
    await session.waitForOutput(
      doneMarker,
      BARRIER_SESSION_TIMEOUT_MS,
      `${stage}-owner-commit`,
    );
    const ownerSession = await session.waitForSuccess(
      BARRIER_SESSION_TIMEOUT_MS,
      `${stage}-owner-success`,
    );
    const ownerResult = JSON.parse(
      parsePsqlPrefixedValue(
        ownerSession.stdout,
        resultPrefix,
        `${stage}-owner-result`,
      ),
    );

    const grantOutcome = await withTimeout(
      grantOutcomePromise,
      BARRIER_SESSION_TIMEOUT_MS,
      `${stage}-grant-timeout`,
    );
    if (!grantOutcome.fulfilled) {
      throw grantOutcome.error;
    }

    return { ownerResult, grant: grantOutcome.value };
  } finally {
    await session.cleanup();
    if (grantOutcomePromise !== null) {
      try {
        await withTimeout(
          grantOutcomePromise,
          BARRIER_SESSION_TIMEOUT_MS,
          `${stage}-grant-cleanup`,
        );
      } catch {
        // The primary assertion remains authoritative. Session cleanup has
        // already released the row lock and bounded the child process.
      }
    }
  }
};

const consumeDownloadGrant = async (
  documentDownloadGrantId,
  requestId = randomUUID(),
) => {
  const result = await serviceRpc(
    "consume_document_download_grant",
    [documentDownloadGrantId, requestId],
    "consume-download-grant",
  );
  assertExactKeys(
    result,
    [
      "organization_id",
      "student_case_id",
      "document_slot_id",
      "document_version_id",
      "document_download_grant_id",
      "document_download_consumption_id",
      "document_access_event_id",
      "bucket_id",
      "object_name",
      "max_signed_url_expires_in_seconds",
      "grant_expires_at",
      "signed_url",
      "storage_api_service_sign_required",
    ],
    "consume-download-grant-result-keys",
  );
  assert(
    result.bucket_id === BUCKET &&
      result.document_download_grant_id === documentDownloadGrantId &&
      typeof result.document_download_consumption_id === "string" &&
      Number.isInteger(result.max_signed_url_expires_in_seconds) &&
      result.max_signed_url_expires_in_seconds >= 1 &&
      result.max_signed_url_expires_in_seconds <= 60 &&
      result.signed_url === null &&
      result.storage_api_service_sign_required === true,
    "consume-download-grant-result",
  );
  return { ...result, requestId };
};

const signedDownload = async (
  signedPath,
  expectedBytes,
  maximumLifetimeSeconds,
  stage,
) => {
  assert(
    typeof signedPath === "string" && signedPath.length > 0,
    `${stage}-url`,
  );
  const normalizedSignedPath = signedPath.startsWith("/object/")
    ? `/storage/v1${signedPath}`
    : signedPath;
  const target = new URL(normalizedSignedPath, `${apiUrl}/storage/v1/`);
  const expectedOrigin = new URL(apiUrl).origin;
  assert(
    target.origin === expectedOrigin &&
      target.pathname.startsWith("/storage/v1/object/sign/"),
    `${stage}-local-url`,
  );
  const signedToken = target.searchParams.get("token");
  const signedClaims = decodeClaims(signedToken, `${stage}-token`);
  const nowSeconds = Math.floor(Date.now() / 1000);
  assert(
    Number.isSafeInteger(signedClaims.exp) &&
      signedClaims.exp > nowSeconds &&
      signedClaims.exp - nowSeconds <= maximumLifetimeSeconds + 1,
    `${stage}-bounded-expiry`,
  );

  let response;
  try {
    response = await fetch(target);
  } catch {
    fail(stage);
  }
  assert(response.ok, `${stage}-http-${response.status}`);
  assertSameBytes(
    Buffer.from(await response.arrayBuffer()),
    expectedBytes,
    `${stage}-bytes`,
  );
};

const mutationState = (slotId = null) => {
  const slotExpression =
    slotId === null ? "NULL::uuid" : sqlUuid(slotId, "mutation-state-slot");
  return JSON.parse(
    runSql(
      `
        SELECT jsonb_build_object(
          'slot', (
            SELECT jsonb_build_object(
              'status', slot.status,
              'current_version_id', slot.current_version_id,
              'current_version_no', slot.current_version_no
            )
            FROM platform.document_slots AS slot
            WHERE slot.id = ${slotExpression}
          ),
          'version_count', (
            SELECT count(*) FROM platform.document_versions
          ),
          'reservation_count', (
            SELECT count(*)
            FROM platform_private.document_upload_reservations
          ),
          'binding_count', (
            SELECT count(*)
            FROM platform_private.document_storage_bindings
          ),
          'object_count', (
            SELECT count(*)
            FROM storage.objects
            WHERE bucket_id = ${sqlText(BUCKET)}
          ),
          'grant_count', (
            SELECT count(*)
            FROM platform_private.document_download_grants
          ),
          'consumption_count', (
            SELECT count(*)
            FROM platform_private.document_download_consumptions
          ),
          'access_event_count', (
            SELECT count(*) FROM platform.document_access_events
          ),
          'audit_count', (
            SELECT count(*) FROM platform.audit_events
          )
        )::text;
      `,
      "mutation-state",
    ),
  );
};

const requestMutationCounts = (requestId) =>
  JSON.parse(
    runSql(
      `
        SELECT jsonb_build_object(
          'version_count', (
            SELECT count(*)
            FROM platform.document_versions AS version
            JOIN platform_private.document_upload_reservations AS reservation
              ON reservation.document_version_id = version.id
            WHERE reservation.request_id =
              ${sqlUuid(requestId, "request-counts-id")}
          ),
          'reservation_count', (
            SELECT count(*)
            FROM platform_private.document_upload_reservations
            WHERE request_id = ${sqlUuid(requestId, "request-counts-id")}
          ),
          'binding_count', (
            SELECT count(*)
            FROM platform_private.document_storage_bindings AS binding
            JOIN platform_private.document_upload_reservations AS reservation
              ON reservation.id = binding.upload_reservation_id
            WHERE reservation.request_id =
              ${sqlUuid(requestId, "request-counts-id")}
          ),
          'grant_count', (
            SELECT count(*)
            FROM platform_private.document_download_grants
            WHERE request_id = ${sqlUuid(requestId, "request-counts-id")}
          ),
          'consumption_count', (
            SELECT count(*)
            FROM platform_private.document_download_consumptions
            WHERE request_id = ${sqlUuid(requestId, "request-counts-id")}
          ),
          'access_event_count', (
            SELECT count(*)
            FROM platform.document_access_events
            WHERE request_id = ${sqlUuid(requestId, "request-counts-id")}
          ),
          'audit_count', (
            SELECT count(*)
            FROM platform.audit_events
            WHERE request_id = ${sqlUuid(requestId, "request-counts-id")}
          )
        )::text;
      `,
      "request-mutation-counts",
    ),
  );

const canonicalJson = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
};

const assertUnchanged = (before, after, stage) => {
  assert(
    JSON.stringify(canonicalJson(before)) ===
      JSON.stringify(canonicalJson(after)),
    stage,
  );
};

const metadataInventoryCounts = (expectedObjects) => {
  const output = runSql(
    `
      SELECT jsonb_build_object(
        'bucket_count', (
          SELECT count(*)
          FROM storage.buckets
          WHERE id = ${sqlText(BUCKET)}
            AND name = ${sqlText(BUCKET)}
            AND public IS FALSE
            AND file_size_limit = ${MAX_BYTES}
            AND allowed_mime_types = ARRAY[
              'application/pdf',
              'image/jpeg',
              'image/png'
            ]::text[]
        ),
        'object_count', (
          SELECT count(*)
          FROM storage.objects
          WHERE bucket_id = ${sqlText(BUCKET)}
        ),
        'reservation_count', (
          SELECT count(*)
          FROM platform_private.document_upload_reservations
        ),
        'binding_count', (
          SELECT count(*)
          FROM platform_private.document_storage_bindings
        ),
        'download_grant_count', (
          SELECT count(*)
          FROM platform_private.document_download_grants
        ),
        'download_consumption_count', (
          SELECT count(*)
          FROM platform_private.document_download_consumptions
        ),
        'access_event_count', (
          SELECT count(*)
          FROM platform.document_access_events
        )
      )::text;
    `,
    "redacted-inventory",
  );
  const counts = JSON.parse(output);
  assert(counts.bucket_count === 1, "inventory-bucket");
  assert(counts.object_count === expectedObjects, "inventory-objects");
  assert(
    counts.reservation_count >= expectedObjects &&
      counts.binding_count === counts.reservation_count &&
      counts.download_grant_count >= 2 &&
      counts.download_consumption_count >= 1 &&
      counts.access_event_count >= counts.download_grant_count,
    "inventory-metadata",
  );
  return counts;
};

const main = async () => {
  const identities = {
    adminA: syntheticIdentity("admin-a"),
    adminB: syntheticIdentity("admin-b"),
    salesA: syntheticIdentity("sales-a"),
    financeA: syntheticIdentity("finance-a"),
    curatorFormer: syntheticIdentity("curator-former"),
    curatorCurrent: syntheticIdentity("curator-current"),
    studentA: syntheticIdentity("student-a"),
    studentB: syntheticIdentity("student-b"),
    studentPending: syntheticIdentity("student-pending"),
    studentBlocked: syntheticIdentity("student-blocked"),
  };

  try {
    // `supabase db reset` can report success on loaded OrbStack hosts before
    // the restarted Auth Admin API is actually reachable through Kong. Keep
    // this read-only probe patient but bounded; mutating user creation below
    // remains single-attempt and never participates in the retry loop.
    await waitForLocalSupabaseAuthAdmin({
      apiUrl,
      serviceRoleKey,
      maxAttempts: 1_200,
      readinessTimeoutMs: 300_000,
    });
  } catch (error) {
    if (error instanceof LocalSupabaseAuthReadinessError) {
      fail(error.stage);
    }
    throw error;
  }

  // Creation stays single-attempt. An unknown result from a mutating request
  // must never be retried automatically because the first request may have
  // succeeded even when the gateway response was lost.
  await Promise.all(Object.values(identities).map(signUp));

  const organizationA = createOrganizationFixture(identities.adminA, "org-a");
  const organizationB = createOrganizationFixture(identities.adminB, "org-b");
  await signIn(identities.adminA, "admin");
  await signIn(identities.adminB, "admin");
  assert(
    membershipFor(identities.adminB).organization_id === organizationB,
    "org-b-membership",
  );
  await waitForPlatformApi(
    identities.adminA,
    membershipFor(identities.adminA).id,
  );

  const memberships = {
    adminA: membershipFor(identities.adminA),
    adminB: membershipFor(identities.adminB),
  };
  for (const [key, role] of [
    ["salesA", "sales"],
    ["financeA", "finance"],
    ["curatorFormer", "curator"],
    ["curatorCurrent", "curator"],
    ["studentA", "student"],
    ["studentB", "student"],
    ["studentPending", "student"],
    ["studentBlocked", "student"],
  ]) {
    memberships[key] = await provisionMembership(
      identities.adminA,
      organizationA,
      identities[key],
      role,
    );
  }

  await Promise.all([
    signIn(identities.salesA, "sales"),
    signIn(identities.financeA, null),
    signIn(identities.curatorFormer, "curator"),
    signIn(identities.curatorCurrent, "curator"),
    signIn(identities.studentA, "student"),
    signIn(identities.studentB, "student"),
    signIn(identities.studentPending, "student"),
    signIn(identities.studentBlocked, "student"),
  ]);

  const cases = {
    studentA: await createPendingCase(
      organizationA,
      memberships.studentA.id,
      memberships.salesA.id,
      "student-a",
    ),
    studentB: await createPendingCase(
      organizationA,
      memberships.studentB.id,
      memberships.salesA.id,
      "student-b",
    ),
    pending: await createPendingCase(
      organizationA,
      memberships.studentPending.id,
      memberships.salesA.id,
      "student-pending",
    ),
    blocked: await createPendingCase(
      organizationA,
      memberships.studentBlocked.id,
      memberships.salesA.id,
      "student-blocked",
    ),
  };

  await assignCurator(
    identities.adminA,
    organizationA,
    cases.studentA,
    memberships.curatorFormer.id,
    "initial assignment",
  );
  await assignCurator(
    identities.adminA,
    organizationA,
    cases.studentB,
    memberships.curatorCurrent.id,
    "student B assignment",
  );
  await assignCurator(
    identities.adminA,
    organizationA,
    cases.blocked,
    memberships.curatorCurrent.id,
    "blocked fixture assignment",
  );

  // Refresh after case-scope changes so the custom access-version claim is
  // current before any positive assertion.
  await Promise.all([
    signIn(identities.curatorFormer, "curator"),
    signIn(identities.curatorCurrent, "curator"),
    signIn(identities.studentA, "student"),
    signIn(identities.studentB, "student"),
    signIn(identities.studentBlocked, "student"),
  ]);

  const requirementId = await createDocumentRequirement(
    identities.adminA,
    organizationA,
  );
  const formerCuratorRequirementId = await createDocumentRequirement(
    identities.adminA,
    organizationA,
  );
  const wrongMimeRequirementId = await createDocumentRequirement(
    identities.adminA,
    organizationA,
  );
  const jpegRequirementId = await createDocumentRequirement(
    identities.adminA,
    organizationA,
  );
  const pngRequirementId = await createDocumentRequirement(
    identities.adminA,
    organizationA,
  );
  const limitRequirementId = await createDocumentRequirement(
    identities.adminA,
    organizationA,
  );
  const overLimitRequirementId = await createDocumentRequirement(
    identities.adminA,
    organizationA,
  );
  const livenessRequirementId = await createDocumentRequirement(
    identities.adminA,
    organizationA,
  );
  const slots = {
    formerCurator: await createDocumentSlot(
      identities.adminA,
      organizationA,
      cases.studentA,
      formerCuratorRequirementId,
      "former-curator",
    ),
    wrongMime: await createDocumentSlot(
      identities.adminA,
      organizationA,
      cases.studentA,
      wrongMimeRequirementId,
      "wrong-mime",
    ),
    jpeg: await createDocumentSlot(
      identities.adminA,
      organizationA,
      cases.studentA,
      jpegRequirementId,
      "jpeg",
    ),
    png: await createDocumentSlot(
      identities.adminA,
      organizationA,
      cases.studentA,
      pngRequirementId,
      "png",
    ),
    limit: await createDocumentSlot(
      identities.adminA,
      organizationA,
      cases.studentA,
      limitRequirementId,
      "limit",
    ),
    overLimit: await createDocumentSlot(
      identities.adminA,
      organizationA,
      cases.studentA,
      overLimitRequirementId,
      "over-limit",
    ),
    liveness: await createDocumentSlot(
      identities.adminA,
      organizationA,
      cases.studentA,
      livenessRequirementId,
      "liveness",
    ),
    studentA: await createDocumentSlot(
      identities.adminA,
      organizationA,
      cases.studentA,
      requirementId,
      "student-a",
    ),
    studentB: await createDocumentSlot(
      identities.adminA,
      organizationA,
      cases.studentB,
      requirementId,
      "student-b",
    ),
    pending: await createDocumentSlot(
      identities.adminA,
      organizationA,
      cases.pending,
      requirementId,
      "student-pending",
    ),
    blocked: await createDocumentSlot(
      identities.adminA,
      organizationA,
      cases.blocked,
      requirementId,
      "student-blocked",
    ),
  };

  const smallPdf = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
  );
  const smallJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0xff, 0xd9,
  ]);
  const smallPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x49, 0x45, 0x4e, 0x44,
  ]);

  const formerReservation = await reserveUpload(
    identities.curatorFormer,
    organizationA,
    slots.formerCurator,
    "former-curator.pdf",
    "application/pdf",
    smallPdf,
  );
  const formerHeldToken = identities.curatorFormer.accessToken;

  await assignCurator(
    identities.adminA,
    organizationA,
    cases.studentA,
    memberships.curatorCurrent.id,
    "reassignment for former curator denial",
  );
  await signIn(identities.curatorCurrent, "curator");
  await signIn(identities.studentA, "student");

  identities.curatorFormer.accessToken = formerHeldToken;
  requireStorageDenied(
    await upload(
      identities.curatorFormer,
      formerReservation,
      smallPdf,
      "application/pdf",
      { stage: "former-curator-stale-upload" },
    ),
    "former-curator-stale-upload",
  );
  await signIn(identities.curatorFormer, "curator");
  requireStorageDenied(
    await upload(
      identities.curatorFormer,
      formerReservation,
      smallPdf,
      "application/pdf",
      { stage: "former-curator-fresh-upload" },
    ),
    "former-curator-fresh-upload",
  );

  const blockedReservation = await reserveUpload(
    identities.studentBlocked,
    organizationA,
    slots.blocked,
    "blocked.pdf",
    "application/pdf",
    smallPdf,
  );
  const blockedHeldToken = identities.studentBlocked.accessToken;
  const adminAuthority = membershipFor(identities.adminA);
  runSql(
    `
      BEGIN;
      SELECT set_config(
        'request.jwt.claims',
        jsonb_build_object(
          'sub', ${sqlUuid(identities.adminA.userId)},
          'role', 'authenticated',
          'platform_role', 'admin',
          'platform_access_version', ${adminAuthority.access_version},
          'platform_organization_id', ${sqlText(adminAuthority.organization_id)},
          'platform_membership_id', ${sqlText(adminAuthority.id)},
          'platform_bundle_id', ${sqlText(adminAuthority.bundle_id)},
          'platform_bundle_version', ${adminAuthority.bundle_version}
        )::TEXT,
        TRUE
      );
      SELECT platform.change_membership_status(
        ${sqlUuid(organizationA)},
        ${sqlUuid(memberships.studentBlocked.id)},
        'blocked'::platform.membership_status,
        'privileged local historical Storage fixture status change',
        ${sqlUuid(randomUUID())}
      )::TEXT;
      COMMIT;
    `,
    "blocked-membership-status",
  );
  identities.studentBlocked.accessToken = blockedHeldToken;
  requireStorageDenied(
    await upload(
      identities.studentBlocked,
      blockedReservation,
      smallPdf,
      "application/pdf",
      { stage: "blocked-held-token-upload" },
    ),
    "blocked-held-token-upload",
  );

  requireDenied(
    await rpcRequest(
      { token: identities.studentPending.accessToken },
      "reserve_document_upload",
      [
        organizationA,
        slots.pending,
        "pending.pdf",
        "application/pdf",
        smallPdf.length,
        sha256(smallPdf),
        randomUUID(),
      ],
      "pending-portal-reserve",
    ),
    "pending-portal-reserve",
  );

  const slotOracleBefore = mutationState(slots.studentA);
  const absentSlotDenial = requireApiError(
    await rpcRequest(
      { token: identities.studentB.accessToken },
      "reserve_document_upload",
      [
        organizationA,
        randomUUID(),
        "oracle.pdf",
        "application/pdf",
        smallPdf.length,
        sha256(smallPdf),
        randomUUID(),
      ],
      "absent-slot-oracle",
    ),
    403,
    "42501",
    "Document is unavailable",
    "absent-slot-oracle",
  );
  const unauthorizedSlotDenial = requireApiError(
    await rpcRequest(
      { token: identities.studentB.accessToken },
      "reserve_document_upload",
      [
        organizationA,
        slots.studentA,
        "oracle.pdf",
        "application/pdf",
        smallPdf.length,
        sha256(smallPdf),
        randomUUID(),
      ],
      "unauthorized-slot-oracle",
    ),
    403,
    "42501",
    "Document is unavailable",
    "unauthorized-slot-oracle",
  );
  assertUnchanged(
    absentSlotDenial,
    unauthorizedSlotDenial,
    "slot-oracle-signature",
  );
  assertUnchanged(
    slotOracleBefore,
    mutationState(slots.studentA),
    "slot-oracle-no-side-effects",
  );

  const longFilenameRequestId = randomUUID();
  const longFilenameBefore = mutationState(slots.studentA);
  requireApiError(
    await rpcRequest(
      { token: identities.studentA.accessToken },
      "reserve_document_upload",
      [
        organizationA,
        slots.studentA,
        "a".repeat(256),
        "application/pdf",
        smallPdf.length,
        sha256(smallPdf),
        longFilenameRequestId,
      ],
      "long-filename-reserve",
    ),
    400,
    "22023",
    "Valid private document upload metadata is required",
    "long-filename-reserve",
  );
  assertUnchanged(
    longFilenameBefore,
    mutationState(slots.studentA),
    "long-filename-no-side-effects",
  );
  assertUnchanged(
    requestMutationCounts(longFilenameRequestId),
    {
      version_count: 0,
      reservation_count: 0,
      binding_count: 0,
      grant_count: 0,
      consumption_count: 0,
      access_event_count: 0,
      audit_count: 0,
    },
    "long-filename-request-no-side-effects",
  );

  const primaryRequestId = randomUUID();
  const primaryReservation = await reserveUpload(
    identities.studentA,
    organizationA,
    slots.studentA,
    "identity.pdf",
    "application/pdf",
    smallPdf,
    primaryRequestId,
  );
  const primaryReplayBefore = mutationState(slots.studentA);
  const primaryReplay = await reserveUpload(
    identities.studentA,
    organizationA,
    slots.studentA,
    "identity.pdf",
    "application/pdf",
    smallPdf,
    primaryRequestId,
  );
  assert(
    primaryReplay.document_version_id ===
      primaryReservation.document_version_id &&
      primaryReplay.upload_reservation_id ===
        primaryReservation.upload_reservation_id &&
      primaryReplay.object_name === primaryReservation.object_name,
    "reservation-replay",
  );
  assertUnchanged(
    primaryReplayBefore,
    mutationState(slots.studentA),
    "reservation-replay-no-side-effects",
  );
  assertUnchanged(
    requestMutationCounts(primaryRequestId),
    {
      version_count: 1,
      reservation_count: 1,
      binding_count: 1,
      grant_count: 0,
      consumption_count: 0,
      access_event_count: 0,
      audit_count: 1,
    },
    "reservation-replay-request-cardinality",
  );
  const uploadMismatchBefore = mutationState(slots.studentA);
  requireApiError(
    await rpcRequest(
      { token: identities.studentA.accessToken },
      "reserve_document_upload",
      [
        organizationA,
        slots.studentA,
        "identity.pdf",
        "application/pdf",
        smallPdf.length + 1,
        sha256(smallPdf),
        primaryRequestId,
      ],
      "reservation-replay-mismatch",
    ),
    409,
    "23505",
    "request_id was already used with different upload inputs",
    "reservation-replay-mismatch",
  );
  assertUnchanged(
    uploadMismatchBefore,
    mutationState(slots.studentA),
    "reservation-replay-mismatch-no-side-effects",
  );

  const competingUploadRequestId = randomUUID();
  const competingUploadBefore = mutationState(slots.studentA);
  requireApiError(
    await rpcRequest(
      { token: identities.curatorCurrent.accessToken },
      "reserve_document_upload",
      [
        organizationA,
        slots.studentA,
        "competing-curator.pdf",
        "application/pdf",
        smallPdf.length,
        sha256(smallPdf),
        competingUploadRequestId,
      ],
      "competing-live-upload",
    ),
    409,
    "PT409",
    "A document upload is already in progress",
    "competing-live-upload",
  );
  assertUnchanged(
    competingUploadBefore,
    mutationState(slots.studentA),
    "competing-live-upload-no-side-effects",
  );
  assertUnchanged(
    requestMutationCounts(competingUploadRequestId),
    {
      version_count: 0,
      reservation_count: 0,
      binding_count: 0,
      grant_count: 0,
      consumption_count: 0,
      access_event_count: 0,
      audit_count: 0,
    },
    "competing-live-upload-request-no-side-effects",
  );

  for (const [identity, stage] of [
    [identities.salesA, "sales-cross-role-upload"],
    [identities.financeA, "finance-cross-role-upload"],
    [identities.studentB, "same-org-cross-student-upload"],
    [identities.adminB, "cross-org-upload"],
  ]) {
    requireStorageDenied(
      await upload(identity, primaryReservation, smallPdf, "application/pdf", {
        stage,
      }),
      stage,
    );
  }

  const unreserved = {
    object_name: primaryReservation.object_name.replace(
      /[^/]+$/,
      `${randomUUID()}.pdf`,
    ),
  };
  requireStorageDenied(
    await upload(identities.studentA, unreserved, smallPdf, "application/pdf", {
      stage: "unreserved-object-upload",
    }),
    "unreserved-object-upload",
  );

  requireStorageSuccess(
    await upload(
      identities.studentA,
      primaryReservation,
      smallPdf,
      "application/pdf",
      { stage: "allowed-pdf-upload" },
    ),
    "allowed-pdf-upload",
  );
  requireStorageDenied(
    await upload(
      identities.studentA,
      primaryReservation,
      smallPdf,
      "application/pdf",
      { stage: "same-path-second-upload" },
    ),
    "same-path-second-upload",
  );
  requireStorageDenied(
    await upload(
      identities.studentA,
      primaryReservation,
      smallPdf,
      "application/pdf",
      { upsert: true, stage: "same-path-upsert" },
    ),
    "same-path-upsert",
  );

  requireDenied(
    await rpcRequest(
      { token: identities.studentA.accessToken },
      "finalize_document_upload",
      [organizationA, primaryReservation.upload_reservation_id, randomUUID()],
      "browser-finalize-denial",
    ),
    "browser-finalize-denial",
  );
  requireDenied(
    await rpcRequest(
      { token: serviceRoleKey, apiKey: serviceRoleKey },
      "finalize_document_upload",
      [organizationB, primaryReservation.upload_reservation_id, randomUUID()],
      "cross-organization-finalize-denial",
    ),
    "cross-organization-finalize-denial",
  );

  const primaryFinalizeRequestId = randomUUID();
  const primaryFinalization = await finalizeUpload(
    organizationA,
    primaryReservation,
    primaryFinalizeRequestId,
    "primary-finalize",
  );
  const primaryFinalizationReplay = await finalizeUpload(
    organizationA,
    primaryReservation,
    primaryFinalizeRequestId,
    "primary-finalize-replay",
  );
  assertUnchanged(
    primaryFinalization,
    primaryFinalizationReplay,
    "primary-finalize-replay-result",
  );
  requireApiError(
    await rpcRequest(
      { token: serviceRoleKey, apiKey: serviceRoleKey },
      "finalize_document_upload",
      [organizationA, primaryReservation.upload_reservation_id, randomUUID()],
      "primary-finalize-second-request",
    ),
    409,
    "23505",
    "request_id or upload reservation was already finalized differently",
    "primary-finalize-second-request",
  );
  assert(
    Number(
      runSql(
        `
          SELECT count(*)
          FROM platform_private.document_upload_finalizations AS finalization
          JOIN platform.audit_events AS audit
            ON audit.id = finalization.finalization_audit_event_id
          WHERE finalization.request_id =
            ${sqlUuid(primaryFinalizeRequestId)}
            AND audit.request_id = finalization.request_id
            AND audit.action = 'document.upload.finalize';
        `,
        "primary-finalization-cardinality",
      ),
    ) === 1,
    "primary-finalization-cardinality",
  );

  const abandonedPrimaryV2 = await reserveUpload(
    identities.studentA,
    organizationA,
    slots.studentA,
    "identity-abandoned-v2.pdf",
    "application/pdf",
    smallPdf,
  );
  const primarySlotAfterAbandoned = mutationState(slots.studentA).slot;
  assert(
    abandonedPrimaryV2.document_slot_published === false &&
      primarySlotAfterAbandoned.current_version_id ===
        primaryReservation.document_version_id &&
      primarySlotAfterAbandoned.current_version_no === 1,
    "abandoned-v2-preserves-current-v1",
  );

  const jpegReservation = await reserveUpload(
    identities.studentA,
    organizationA,
    slots.jpeg,
    "identity.jpg",
    "image/jpeg",
    smallJpeg,
  );
  requireStorageSuccess(
    await upload(
      identities.studentA,
      jpegReservation,
      smallJpeg,
      "image/jpeg",
      { stage: "allowed-jpeg-upload" },
    ),
    "allowed-jpeg-upload",
  );

  const pngReservation = await reserveUpload(
    identities.studentA,
    organizationA,
    slots.png,
    "identity.png",
    "image/png",
    smallPng,
  );
  requireStorageSuccess(
    await upload(identities.studentA, pngReservation, smallPng, "image/png", {
      stage: "allowed-png-upload",
    }),
    "allowed-png-upload",
  );

  const wrongMimeReservation = await reserveUpload(
    identities.studentA,
    organizationA,
    slots.wrongMime,
    "wrong-mime.pdf",
    "application/pdf",
    smallPdf,
  );
  requireStorageDenied(
    await upload(
      identities.studentA,
      wrongMimeReservation,
      smallPdf,
      "text/plain",
      { stage: "unsupported-mime-upload" },
    ),
    "unsupported-mime-upload",
  );

  const exactLimitPdf = Buffer.alloc(MAX_BYTES, 0x20);
  Buffer.from("%PDF-1.4\n").copy(exactLimitPdf);
  const exactLimitReservation = await reserveUpload(
    identities.studentA,
    organizationA,
    slots.limit,
    "exact-limit.pdf",
    "application/pdf",
    exactLimitPdf,
  );
  requireStorageSuccess(
    await upload(
      identities.studentA,
      exactLimitReservation,
      exactLimitPdf,
      "application/pdf",
      { stage: "exact-25mib-upload" },
    ),
    "exact-25mib-upload",
  );

  const overLimitPdf = Buffer.alloc(MAX_BYTES + 1, 0x20);
  Buffer.from("%PDF-1.4\n").copy(overLimitPdf);
  const overLimitReservationRequestId = randomUUID();
  requireApiError(
    await rpcRequest(
      { token: identities.studentA.accessToken },
      "reserve_document_upload",
      [
        organizationA,
        slots.overLimit,
        "declared-over-limit.pdf",
        "application/pdf",
        overLimitPdf.length,
        sha256(overLimitPdf),
        overLimitReservationRequestId,
      ],
      "over-25mib-reservation",
    ),
    400,
    "22023",
    "Valid private document upload metadata is required",
    "over-25mib-reservation",
  );
  assertUnchanged(
    requestMutationCounts(overLimitReservationRequestId),
    {
      version_count: 0,
      reservation_count: 0,
      binding_count: 0,
      grant_count: 0,
      consumption_count: 0,
      access_event_count: 0,
      audit_count: 0,
    },
    "over-25mib-reservation-no-side-effects",
  );
  const overLimitReservation = await reserveUpload(
    identities.studentA,
    organizationA,
    slots.overLimit,
    "over-limit.pdf",
    "application/pdf",
    exactLimitPdf,
  );
  requireStorageDenied(
    await upload(
      identities.studentA,
      overLimitReservation,
      overLimitPdf,
      "application/pdf",
      { stage: "over-25mib-upload" },
    ),
    "over-25mib-upload",
  );

  const livenessV1 = await reserveUpload(
    identities.studentA,
    organizationA,
    slots.liveness,
    "liveness-v1.pdf",
    "application/pdf",
    smallPdf,
  );
  requireStorageSuccess(
    await upload(
      identities.studentA,
      livenessV1,
      smallPdf,
      "application/pdf",
      { stage: "liveness-v1-upload" },
    ),
    "liveness-v1-upload",
  );
  runSql(
    `
      ALTER TABLE platform_private.document_upload_reservations
        DISABLE TRIGGER document_upload_reservations_append_only_rows;
      UPDATE platform_private.document_upload_reservations
      SET
        created_at = statement_timestamp() - INTERVAL '20 minutes',
        expires_at = statement_timestamp() - INTERVAL '10 minutes'
      WHERE id = ${sqlUuid(livenessV1.upload_reservation_id)};
      ALTER TABLE platform_private.document_upload_reservations
        ENABLE TRIGGER document_upload_reservations_append_only_rows;
      UPDATE storage.objects
      SET created_at = statement_timestamp() - INTERVAL '5 minutes'
      WHERE bucket_id = ${sqlText(BUCKET)}
        AND name = ${sqlText(livenessV1.object_name)};
    `,
    "liveness-expired-clock-shift",
  );
  requireDenied(
    await rpcRequest(
      { token: serviceRoleKey, apiKey: serviceRoleKey },
      "finalize_document_upload",
      [organizationA, livenessV1.upload_reservation_id, randomUUID()],
      "late-object-finalize-denial",
    ),
    "late-object-finalize-denial",
  );
  runSql(
    `
      UPDATE storage.objects
      SET created_at = statement_timestamp() - INTERVAL '15 minutes'
      WHERE bucket_id = ${sqlText(BUCKET)}
        AND name = ${sqlText(livenessV1.object_name)};
    `,
    "liveness-in-window-object-shift",
  );
  const abandonedLivenessV2 = await reserveUpload(
    identities.studentA,
    organizationA,
    slots.liveness,
    "liveness-abandoned-v2.pdf",
    "application/pdf",
    smallPdf,
  );
  const livenessFinalization = await finalizeUpload(
    organizationA,
    livenessV1,
    randomUUID(),
    "liveness-v1-finalize-after-v2-reserve",
  );
  const livenessV2Number = Number(
    runSql(
      `
        SELECT version_no
        FROM platform.document_versions
        WHERE id = ${sqlUuid(abandonedLivenessV2.document_version_id)};
      `,
      "liveness-v2-version",
    ),
  );
  const livenessSlot = mutationState(slots.liveness).slot;
  assert(
    livenessFinalization.published_version_no === 1 &&
      livenessV2Number === 2 &&
      abandonedLivenessV2.document_slot_published === false &&
      livenessSlot.current_version_id === livenessV1.document_version_id &&
      livenessSlot.current_version_no === 1,
    "liveness-v1-finalizes-with-abandoned-v2",
  );
  requireDenied(
    await rpcRequest(
      { token: serviceRoleKey, apiKey: serviceRoleKey },
      "finalize_document_upload",
      [
        organizationA,
        abandonedLivenessV2.upload_reservation_id,
        randomUUID(),
      ],
      "missing-v2-object-finalize-denial",
    ),
    "missing-v2-object-finalize-denial",
  );

  // Exercise the two valid review/finalization business outcomes under
  // client-side contention. This Promise.all pair does not prove database
  // transaction overlap or lock order; the definition mutation checks and the
  // observable organization-before-case/version barrier below provide that
  // evidence. Finalization must publish v2 under either accepted ordering.
  requireStorageSuccess(
    await upload(
      identities.studentA,
      abandonedLivenessV2,
      smallPdf,
      "application/pdf",
      { stage: "concurrent-review-finalize-v2-upload" },
    ),
    "concurrent-review-finalize-v2-upload",
  );
  const concurrentV2FinalizeRequestId = randomUUID();
  const [concurrentReviewResult, concurrentV2FinalizeResult] =
    await Promise.all([
      rpcRequest(
        { token: identities.curatorCurrent.accessToken },
        "review_document_version",
        [
          organizationA,
          livenessV1.document_version_id,
          "correction_required",
          "Synthetic review/finalize contention outcome check",
          randomUUID(),
        ],
        "concurrent-v1-review",
      ),
      rpcRequest(
        { token: serviceRoleKey, apiKey: serviceRoleKey },
        "finalize_document_upload",
        [
          organizationA,
          abandonedLivenessV2.upload_reservation_id,
          concurrentV2FinalizeRequestId,
        ],
        "concurrent-v2-finalize",
      ),
    ]);
  const concurrentV2Finalization = assertFinalizationResult(
    requireSuccess(
      concurrentV2FinalizeResult,
      "concurrent-v2-finalize",
    ),
    organizationA,
    abandonedLivenessV2,
    "concurrent-v2-finalize",
  );
  if (!concurrentReviewResult.ok) {
    requireApiError(
      concurrentReviewResult,
      400,
      "22023",
      "Only the current submitted document version can be reviewed",
      "concurrent-v1-review-current-only",
    );
  } else {
    assert(
      concurrentReviewResult.payload?.decision ===
        "correction_required",
      "concurrent-v1-review-result",
    );
  }
  const concurrentV2Slot = mutationState(slots.liveness).slot;
  assert(
    concurrentV2Finalization.published_version_no === 2 &&
      concurrentV2Slot.current_version_id ===
        abandonedLivenessV2.document_version_id &&
      concurrentV2Slot.current_version_no === 2 &&
      concurrentV2Slot.status === "submitted",
    "concurrent-review-finalize-consistent-state",
  );

  // Two service workers racing with different request IDs must produce one
  // immutable receipt/audit and one deterministic conflict, never two
  // publications or an incidental server error.
  const livenessV3 = await reserveUpload(
    identities.studentA,
    organizationA,
    slots.liveness,
    "liveness-concurrent-v3.pdf",
    "application/pdf",
    smallPdf,
  );
  requireStorageSuccess(
    await upload(
      identities.studentA,
      livenessV3,
      smallPdf,
      "application/pdf",
      { stage: "concurrent-finalizers-v3-upload" },
    ),
    "concurrent-finalizers-v3-upload",
  );
  const concurrentFinalizeRequestIds = [randomUUID(), randomUUID()];
  const concurrentFinalizeResults = await Promise.all(
    concurrentFinalizeRequestIds.map((requestId, index) =>
      rpcRequest(
        { token: serviceRoleKey, apiKey: serviceRoleKey },
        "finalize_document_upload",
        [organizationA, livenessV3.upload_reservation_id, requestId],
        `concurrent-finalizer-${index + 1}`,
      ),
    ),
  );
  const successfulFinalizers = concurrentFinalizeResults
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.ok);
  assert(successfulFinalizers.length === 1, "concurrent-finalizer-winner");
  const winningFinalizer = successfulFinalizers[0];
  const losingFinalizer = concurrentFinalizeResults[
    winningFinalizer.index === 0 ? 1 : 0
  ];
  const concurrentV3Finalization = assertFinalizationResult(
    winningFinalizer.result.payload,
    organizationA,
    livenessV3,
    "concurrent-finalizer-winner",
  );
  requireApiError(
    losingFinalizer,
    409,
    "23505",
    "request_id or upload reservation was already finalized differently",
    "concurrent-finalizer-loser",
  );
  const concurrentFinalizerCardinality = JSON.parse(
    runSql(
      `
        SELECT jsonb_build_object(
          'receipt_count', (
            SELECT count(*)
            FROM platform_private.document_upload_finalizations
            WHERE upload_reservation_id =
              ${sqlUuid(livenessV3.upload_reservation_id)}
          ),
          'audit_count', (
            SELECT count(*)
            FROM platform.audit_events
            WHERE request_id IN (
              ${sqlUuid(concurrentFinalizeRequestIds[0])},
              ${sqlUuid(concurrentFinalizeRequestIds[1])}
            )
              AND action = 'document.upload.finalize'
          )
        )::text;
      `,
      "concurrent-finalizer-cardinality",
    ),
  );
  const concurrentV3Slot = mutationState(slots.liveness).slot;
  assert(
    concurrentV3Finalization.published_version_no === 3 &&
      concurrentFinalizerCardinality.receipt_count === 1 &&
      concurrentFinalizerCardinality.audit_count === 1 &&
      concurrentV3Slot.current_version_id ===
        livenessV3.document_version_id &&
      concurrentV3Slot.current_version_no === 3,
    "concurrent-finalizer-exactly-once",
  );

  // Hold the shared organization authorization row while the exact
  // finalization replay runs. The real HTTP grant must wait there before
  // touching the case or version, proving the complete authorization ->
  // case -> version order with two live database transactions.
  await attestValidation(
    organizationA,
    livenessV3.document_version_id,
    smallPdf,
    livenessV3.object_name,
    "concurrent-finalization-replay",
  );
  const winningFinalizationIndex = concurrentFinalizeResults.findIndex(
    (result) => result.ok,
  );
  const winningFinalizationRequestId =
    concurrentFinalizeRequestIds[winningFinalizationIndex];
  const concurrentFinalizationBarrier =
    await runOrganizationBeforeCaseVersionGrantBarrier({
      stage: "concurrent-finalization-exact-replay",
      ownerRole: "service_role",
      ownerClaims: decodeClaims(
        serviceRoleKey,
        "concurrent-finalization-service-role-claims",
      ),
      ownerResultExpression: `platform.finalize_document_upload(
        ${sqlUuid(organizationA)},
        ${sqlUuid(livenessV3.upload_reservation_id)},
        ${sqlUuid(winningFinalizationRequestId)}
      )`,
      organizationId: organizationA,
      documentVersionId: livenessV3.document_version_id,
      grantIdentity: identities.studentA,
      grantPurpose: "concurrent exact finalization replay proof",
      grantRequestId: randomUUID(),
    });
  const concurrentReplayGrant = concurrentFinalizationBarrier.grant;
  const concurrentFinalizationReplay = assertFinalizationResult(
    concurrentFinalizationBarrier.ownerResult,
    organizationA,
    livenessV3,
    "concurrent-finalization-exact-replay",
  );
  assertUnchanged(
    concurrentV3Finalization,
    concurrentFinalizationReplay,
    "concurrent-finalization-exact-replay-result",
  );
  assert(
    typeof concurrentReplayGrant.document_download_grant_id === "string",
    "concurrent-finalization-replay-grant",
  );

  requireStorageDenied(
    await signObject(
      identities.studentA.accessToken,
      primaryReservation.object_name,
      "pre-validation-sign",
    ),
    "pre-validation-sign",
  );
  requireDenied(
    await rpcRequest(
      { token: identities.studentA.accessToken },
      "grant_document_download",
      [
        organizationA,
        primaryReservation.document_version_id,
        "pre-validation local P2H check",
        60,
        randomUUID(),
      ],
      "pre-validation-grant",
    ),
    "pre-validation-grant",
  );

  requireStorageDenied(
    await directAuthenticatedGet(
      identities.studentA.accessToken,
      primaryReservation.object_name,
      "direct-authenticated-get",
    ),
    "direct-authenticated-get",
  );
  requireStorageDenied(
    await storageRequest(
      `/object/public/${BUCKET}/${encodeObjectName(
        primaryReservation.object_name,
      )}`,
      { stage: "anonymous-public-get" },
    ),
    "anonymous-public-get",
  );
  assertListDeniedOrEmpty(
    await listObjects(
      identities.studentA.accessToken,
      publishableKey,
      "authenticated-list",
    ),
    "authenticated-list",
  );
  assertListDeniedOrEmpty(
    await listObjects(undefined, publishableKey, "anonymous-list"),
    "anonymous-list",
  );

  await attestValidation(
    organizationA,
    primaryReservation.document_version_id,
    smallPdf,
    primaryReservation.object_name,
    "primary",
  );
  await attestValidation(
    organizationA,
    pngReservation.document_version_id,
    smallPng,
    pngReservation.object_name,
    "expiry",
  );

  const versionOracleBefore = mutationState(slots.studentA);
  const absentVersionDenial = requireApiError(
    await rpcRequest(
      { token: identities.studentB.accessToken },
      "grant_document_download",
      [
        organizationA,
        randomUUID(),
        "version oracle",
        60,
        randomUUID(),
      ],
      "absent-version-oracle",
    ),
    403,
    "42501",
    "Document is unavailable",
    "absent-version-oracle",
  );
  const unauthorizedVersionDenial = requireApiError(
    await rpcRequest(
      { token: identities.studentB.accessToken },
      "grant_document_download",
      [
        organizationA,
        primaryReservation.document_version_id,
        "version oracle",
        60,
        randomUUID(),
      ],
      "unauthorized-version-oracle",
    ),
    403,
    "42501",
    "Document is unavailable",
    "unauthorized-version-oracle",
  );
  assertUnchanged(
    absentVersionDenial,
    unauthorizedVersionDenial,
    "version-oracle-signature",
  );
  assertUnchanged(
    versionOracleBefore,
    mutationState(slots.studentA),
    "version-oracle-no-side-effects",
  );

  const longPurposeRequestId = randomUUID();
  const longPurposeBefore = mutationState(slots.studentA);
  requireApiError(
    await rpcRequest(
      { token: identities.studentA.accessToken },
      "grant_document_download",
      [
        organizationA,
        primaryReservation.document_version_id,
        "p".repeat(256),
        60,
        longPurposeRequestId,
      ],
      "long-purpose-grant",
    ),
    400,
    "22023",
    "Valid short-lived document download grant inputs are required",
    "long-purpose-grant",
  );
  assertUnchanged(
    longPurposeBefore,
    mutationState(slots.studentA),
    "long-purpose-no-side-effects",
  );
  assertUnchanged(
    requestMutationCounts(longPurposeRequestId),
    {
      version_count: 0,
      reservation_count: 0,
      binding_count: 0,
      grant_count: 0,
      consumption_count: 0,
      access_event_count: 0,
      audit_count: 0,
    },
    "long-purpose-request-no-side-effects",
  );

  // The real review transaction owns the shared organization authorization
  // row before it reaches case -> slot -> version. Observe the real HTTP grant
  // blocked there while both document rows remain independently lockable,
  // then commit the review and require both operations to finish cleanly.
  const grantRequestId = randomUUID();
  const concurrentGrantReviewRequestId = randomUUID();
  const concurrentGrantReviewBarrier =
    await runOrganizationBeforeCaseVersionGrantBarrier({
      stage: "concurrent-grant-review",
      ownerRole: "authenticated",
      ownerClaims: decodeClaims(
        identities.curatorCurrent.accessToken,
        "concurrent-grant-review-claims",
      ),
      ownerResultExpression: `platform.review_document_version(
        ${sqlUuid(organizationA)},
        ${sqlUuid(primaryReservation.document_version_id)},
        'approved'::platform.document_review_decision,
        NULL::text,
        ${sqlUuid(concurrentGrantReviewRequestId)}
      )`,
      organizationId: organizationA,
      documentVersionId: primaryReservation.document_version_id,
      grantIdentity: identities.studentA,
      grantPurpose: "local P2H audited download",
      grantRequestId,
    });
  const grant = concurrentGrantReviewBarrier.grant;
  const concurrentGrantReview = concurrentGrantReviewBarrier.ownerResult;
  assert(
    concurrentGrantReview.document_version_id ===
      primaryReservation.document_version_id &&
      concurrentGrantReview.decision === "approved",
    "concurrent-grant-review-result",
  );
  const grantReplayBefore = mutationState(slots.studentA);
  const grantReplay = await grantDownload(
    identities.studentA,
    organizationA,
    primaryReservation.document_version_id,
    "local P2H audited download",
    60,
    grantRequestId,
  );
  assert(
    grantReplay.document_download_grant_id ===
      grant.document_download_grant_id &&
      grantReplay.expires_at === grant.expires_at,
    "download-grant-replay",
  );
  assertUnchanged(
    grantReplayBefore,
    mutationState(slots.studentA),
    "download-grant-replay-no-side-effects",
  );
  assertUnchanged(
    requestMutationCounts(grantRequestId),
    {
      version_count: 0,
      reservation_count: 0,
      binding_count: 0,
      grant_count: 1,
      consumption_count: 0,
      access_event_count: 1,
      audit_count: 1,
    },
    "download-grant-replay-request-cardinality",
  );
  const grantMismatchBefore = mutationState(slots.studentA);
  requireApiError(
    await rpcRequest(
      { token: identities.studentA.accessToken },
      "grant_document_download",
      [
        organizationA,
        primaryReservation.document_version_id,
        "mismatched replay purpose",
        60,
        grantRequestId,
      ],
      "download-grant-replay-mismatch",
    ),
    409,
    "23505",
    "request_id was already used with different download inputs",
    "download-grant-replay-mismatch",
  );
  assertUnchanged(
    grantMismatchBefore,
    mutationState(slots.studentA),
    "download-grant-replay-mismatch-no-side-effects",
  );

  const outstandingGrantRequestId = randomUUID();
  const outstandingGrantBefore = mutationState(slots.studentA);
  requireApiError(
    await rpcRequest(
      { token: identities.studentA.accessToken },
      "grant_document_download",
      [
        organizationA,
        primaryReservation.document_version_id,
        "fresh duplicate live grant",
        60,
        outstandingGrantRequestId,
      ],
      "outstanding-download-grant",
    ),
    409,
    "PT409",
    "A document download grant is already active",
    "outstanding-download-grant",
  );
  assertUnchanged(
    outstandingGrantBefore,
    mutationState(slots.studentA),
    "outstanding-download-grant-no-side-effects",
  );
  assertUnchanged(
    requestMutationCounts(outstandingGrantRequestId),
    {
      version_count: 0,
      reservation_count: 0,
      binding_count: 0,
      grant_count: 0,
      consumption_count: 0,
      access_event_count: 0,
      audit_count: 0,
    },
    "outstanding-download-grant-request-no-side-effects",
  );

  for (const [identity, stage] of [
    [identities.salesA, "sales-cross-role-grant"],
    [identities.financeA, "finance-cross-role-grant"],
    [identities.studentB, "same-org-cross-student-grant"],
    [identities.adminB, "cross-org-grant"],
    [identities.curatorFormer, "former-curator-grant"],
  ]) {
    requireDenied(
      await rpcRequest(
        { token: identity.accessToken },
        "grant_document_download",
        [
          organizationA,
          primaryReservation.document_version_id,
          `local P2H ${stage}`,
          60,
          randomUUID(),
        ],
        stage,
      ),
      stage,
    );
  }

  requireDenied(
    await rpcRequest(
      { token: identities.studentA.accessToken },
      "consume_document_download_grant",
      [grant.document_download_grant_id, randomUUID()],
      "browser-consume-download-grant",
    ),
    "browser-consume-download-grant",
  );
  requireStorageDenied(
    await signObject(
      identities.studentA.accessToken,
      primaryReservation.object_name,
      "post-grant-browser-sign",
    ),
    "post-grant-browser-sign",
  );

  const consumeRequestId = randomUUID();
  const consumption = await consumeDownloadGrant(
    grant.document_download_grant_id,
    consumeRequestId,
  );
  assert(
    consumption.organization_id === organizationA &&
      consumption.student_case_id === cases.studentA &&
      consumption.document_slot_id === slots.studentA &&
      consumption.document_version_id ===
        primaryReservation.document_version_id &&
      consumption.object_name === primaryReservation.object_name &&
      typeof consumption.document_access_event_id === "string" &&
      typeof consumption.grant_expires_at === "string",
    "consume-download-grant-binding",
  );
  requireDenied(
    await rpcRequest(
      { token: serviceRoleKey, apiKey: serviceRoleKey },
      "consume_document_download_grant",
      [grant.document_download_grant_id, consumeRequestId],
      "consume-download-grant-request-replay",
    ),
    "consume-download-grant-request-replay",
  );
  requireDenied(
    await rpcRequest(
      { token: serviceRoleKey, apiKey: serviceRoleKey },
      "consume_document_download_grant",
      [grant.document_download_grant_id, randomUUID()],
      "consume-download-grant-grant-replay",
    ),
    "consume-download-grant-grant-replay",
  );

  const signResult = await signObject(
    serviceRoleKey,
    consumption.object_name,
    "post-consumption-service-sign",
    {
      apiKey: serviceRoleKey,
      expiresIn: consumption.max_signed_url_expires_in_seconds,
    },
  );
  requireStorageSuccess(signResult, "post-consumption-service-sign");
  const signedPath =
    signResult.payload?.signedURL ?? signResult.payload?.signedUrl;
  await signedDownload(
    signedPath,
    smallPdf,
    consumption.max_signed_url_expires_in_seconds,
    "post-consumption-signed-download",
  );

  requireStorageDenied(
    await directAuthenticatedGet(
      identities.studentA.accessToken,
      primaryReservation.object_name,
      "post-grant-direct-get",
    ),
    "post-grant-direct-get",
  );
  assertListDeniedOrEmpty(
    await listObjects(
      identities.studentA.accessToken,
      publishableKey,
      "post-grant-list",
    ),
    "post-grant-list",
  );

  const expiryGrant = await grantDownload(
    identities.studentA,
    organizationA,
    pngReservation.document_version_id,
    "local P2H expiry check",
    1,
  );
  await delay(1_500);
  requireDenied(
    await rpcRequest(
      { token: serviceRoleKey, apiKey: serviceRoleKey },
      "consume_document_download_grant",
      [expiryGrant.document_download_grant_id, randomUUID()],
      "expired-grant-consume",
    ),
    "expired-grant-consume",
  );

  requireDenied(
    await requestJson("/rest/v1/rpc/document_storage_backup_inventory", {
      method: "POST",
      token: identities.adminA.accessToken,
      body: {},
      schema: true,
      stage: "browser-backup-inventory",
    }),
    "browser-backup-inventory",
  );
  const backupRows = await readBackupInventory();
  const bindingCount = Number(
    runSql(
      "SELECT count(*) FROM platform_private.document_storage_bindings;",
      "backup-inventory-binding-count",
    ),
  );
  assert(
    backupRows.length === bindingCount &&
      backupRows.every((row) => row.binding_present === true) &&
      new Set(backupRows.map((row) => row.document_version_id)).size ===
        bindingCount,
    "backup-inventory-one-row-per-binding",
  );
  assert(
    backupRows.some(
      (row) =>
        row.storage_object_present === false &&
        row.inventory_state === "missing_object",
    ),
    "backup-inventory-missing-object-reconciliation",
  );

  const verifiedInventoryObjects = [
    {
      reservation: primaryReservation,
      bytes: smallPdf,
    },
    {
      reservation: pngReservation,
      bytes: smallPng,
    },
    {
      reservation: livenessV1,
      bytes: smallPdf,
    },
    {
      reservation: abandonedLivenessV2,
      bytes: smallPdf,
    },
    {
      reservation: livenessV3,
      bytes: smallPdf,
    },
  ];
  for (const { reservation, bytes } of verifiedInventoryObjects) {
    const row = backupRows.find(
      (candidate) =>
        candidate.document_version_id === reservation.document_version_id,
    );
    assert(
      row?.storage_object_present === true &&
        row.binding_present === true &&
        row.inventory_state === "present" &&
        row.bucket_id === BUCKET &&
        row.object_name === reservation.object_name &&
        Number(row.expected_byte_size) === bytes.length &&
        Number(row.storage_reported_byte_size) === bytes.length &&
        row.expected_sha256_hex === sha256(bytes),
      "backup-inventory-verified-object",
    );
    assertSameBytes(
      await serviceDownload(
        reservation.object_name,
        "backup-inventory-object-download",
      ),
      bytes,
      "backup-inventory-object-hash",
    );
  }

  const counts = metadataInventoryCounts(7);
  console.log(
    `Local P2H Storage API gate passed with redacted inventory: ${counts.object_count} private objects, ${counts.reservation_count} reservations, ${counts.download_grant_count} audited grants.`,
  );
  console.log(
    "Proof boundary: local Supabase Storage API/RLS only; no malware-provider, managed-Supabase, production, backup or restore claim.",
  );
};

main().catch((error) => {
  const stage =
    error instanceof GateFailure ? error.stage : "unexpected-runtime";
  console.error(`ERROR: local P2H Storage API gate failed at ${stage}.`);
  process.exitCode = 1;
});
