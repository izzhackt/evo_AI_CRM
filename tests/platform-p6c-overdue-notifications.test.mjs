import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isPlatformP6COverdueNotificationsEnabled,
  loadPlatformP6COverdueConfig,
  PLATFORM_P6C_OVERDUE_WORKER_ID,
} from "../src/lib/server/platform-p6c-overdue-config.ts";
import {
  isPlatformP6BPortalNotificationsEnabled,
} from "../src/lib/server/platform-p6b-portal-notifications.ts";
import {
  createPlatformP6COverdueHandler,
  createPlatformP6COverdueRepository,
} from "../src/lib/server/platform-p6c-overdue-processor.ts";
import {
  listPlatformStudentPortalNotificationsV2,
  PlatformPortalRepositoryError,
} from "../src/lib/platform-portal.ts";

const REQUEST_ID = "c0000000-0000-4000-8000-000000000001";
const AUTH_USER_ID = "c0000000-0000-4000-8000-000000000002";
const PROFILE_ID = "c0000000-0000-4000-8000-000000000003";
const MEMBERSHIP_ID = "c0000000-0000-4000-8000-000000000004";
const ORGANIZATION_ID = "c0000000-0000-4000-8000-000000000005";
const NOTIFICATION_ID = "c0000000-0000-4000-8000-000000000006";
const NOW_MS = 1_786_522_500_000;
const TRIGGER_SECRET = "p6c-local-trigger-secret-32-bytes-minimum";

function enabledConfig() {
  return {
    enabled: true,
    supabaseUrl: "http://127.0.0.1:45421",
    supabaseSecretKey: "sb_secret_local_p6c_1234567890",
    triggerSecret: TRIGGER_SECRET,
    workerId: PLATFORM_P6C_OVERDUE_WORKER_ID,
    maxClockSkewMs: 5 * 60 * 1000,
  };
}

function signedRequest(overrides = {}, body) {
  const timestamp = String(NOW_MS);
  const signature = createHmac("sha256", TRIGGER_SECRET)
    .update(`${REQUEST_ID}.${timestamp}`, "utf8")
    .digest("hex");
  return new Request("http://localhost/api/internal/platform-operations/portal-overdue", {
    method: "POST",
    headers: {
      "x-evo-portal-overdue-request-id": REQUEST_ID,
      "x-evo-portal-overdue-timestamp": timestamp,
      "x-evo-portal-overdue-hmac-algorithm": "sha256",
      "x-evo-portal-overdue-hmac": signature,
      ...overrides,
    },
    body,
  });
}

function completedResult(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    status: "completed",
    organizationsProcessed: 1,
    taskCandidates: 2,
    taskPublished: 1,
    taskResolved: 0,
    paymentCandidates: 1,
    paymentPublished: 1,
    paymentResolved: 0,
    ...overrides,
  };
}

function studentActor(overrides = {}) {
  return {
    authUserId: AUTH_USER_ID,
    profileId: PROFILE_ID,
    membershipId: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    displayName: "Student",
    platformRole: "student",
    platformAccessVersion: 1,
    role: "client",
    ...overrides,
  };
}

test("P6C stays disabled unless its exact server flag is 1", () => {
  for (const value of [undefined, "", "0", "true", "yes", " 1 "]) {
    assert.equal(
      isPlatformP6COverdueNotificationsEnabled({
        EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED: value,
      }),
      false,
    );
  }
  assert.equal(
    isPlatformP6COverdueNotificationsEnabled({
      EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED: "1",
    }),
    true,
  );
  assert.deepEqual(loadPlatformP6COverdueConfig({}), { enabled: false });
  assert.match(
    readFileSync(new URL("../.env.example", import.meta.url), "utf8"),
    /^EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED=0$/m,
  );
});

test("P6C enabled configuration requires backend credentials and a dedicated secret", () => {
  assert.throws(() => loadPlatformP6COverdueConfig({
    EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED: "1",
  }));
  assert.deepEqual(loadPlatformP6COverdueConfig({
    EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:45421",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_local_p6c_1234567890",
    EVO_PLATFORM_P6C_OVERDUE_TRIGGER_SECRET: TRIGGER_SECRET,
  }), enabledConfig());
});

test("bodyless signed trigger invokes one fixed-worker bounded processor", async () => {
  let input;
  const handler = createPlatformP6COverdueHandler({
    config: enabledConfig(),
    nowMs: () => NOW_MS,
    repository: {
      async process(value) {
        input = value;
        return completedResult();
      },
    },
  });
  const response = await handler(signedRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(input, {
    requestId: REQUEST_ID,
    workerId: PLATFORM_P6C_OVERDUE_WORKER_ID,
  });
  assert.deepEqual(await response.json(), { ok: true, ...completedResult() });
});

test("trigger fails closed for disabled, unsigned, stale, uppercase, body and repository failure", async () => {
  const disabled = createPlatformP6COverdueHandler({ config: { enabled: false } });
  assert.equal((await disabled(signedRequest())).status, 503);

  const enabled = createPlatformP6COverdueHandler({
    config: enabledConfig(),
    nowMs: () => NOW_MS,
    repository: { async process() { return completedResult(); } },
  });
  assert.equal((await enabled(new Request("http://localhost"))).status, 401);
  assert.equal((await enabled(signedRequest({
    "x-evo-portal-overdue-timestamp": String(NOW_MS - 300_001),
  }))).status, 401);
  assert.equal((await enabled(signedRequest({
    "x-evo-portal-overdue-hmac": "A".repeat(64),
  }))).status, 401);
  assert.equal((await enabled(signedRequest({}, "{}"))).status, 400);
  const getRequest = signedRequest();
  assert.equal((await enabled(new Request(getRequest, { method: "GET" }))).status, 400);
  assert.equal((await enabled(signedRequest({ "content-length": "0" }, "{}"))).status, 400);

  const unavailable = createPlatformP6COverdueHandler({
    config: enabledConfig(),
    nowMs: () => NOW_MS,
    repository: { async process() { throw new Error("database down"); } },
  });
  assert.equal((await unavailable(signedRequest())).status, 503);
});

test("service repository binds exact RPC arguments and rejects malformed results", async () => {
  const calls = [];
  const client = {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(functionName, args) {
          calls.push({ functionName, args });
          return {
            data: {
              request_id: REQUEST_ID,
              status: "completed",
              organizations_processed: 1,
              task_candidates: 2,
              task_published: 1,
              task_resolved: 0,
              payment_candidates: 1,
              payment_published: 1,
              payment_resolved: 0,
            },
            error: null,
          };
        },
      };
    },
  };
  const repository = createPlatformP6COverdueRepository(client);
  assert.deepEqual(await repository.process({
    requestId: REQUEST_ID,
    workerId: PLATFORM_P6C_OVERDUE_WORKER_ID,
  }), completedResult());
  assert.deepEqual(calls, [{
    functionName: "process_student_portal_overdue_notifications_v1",
    args: {
      p_request_id: REQUEST_ID,
      p_worker_id: PLATFORM_P6C_OVERDUE_WORKER_ID,
    },
  }]);

  const invalid = createPlatformP6COverdueRepository({
    schema() {
      return { async rpc() { return { data: { status: "completed" }, error: null }; } };
    },
  });
  await assert.rejects(() => invalid.process({
    requestId: REQUEST_ID,
    workerId: PLATFORM_P6C_OVERDUE_WORKER_ID,
  }));
});

test("v2 feed maps only generalized safe document, task and payment DTOs", async () => {
  const rows = [
    {
      notification_id: NOTIFICATION_ID,
      category: "document.review",
      event_code: "correction_required",
      subject_label: "Passport copy",
      detail: "Upload a readable copy.",
      due_at: null,
      created_at: "2026-08-12T10:15:00Z",
      read_at: null,
    },
    {
      notification_id: "c0000000-0000-4000-8000-000000000007",
      category: "task.overdue",
      event_code: "overdue",
      subject_label: "Complete the questionnaire",
      detail: "This task needs your attention.",
      due_at: "2026-08-11T10:00:00Z",
      created_at: "2026-08-12T10:16:00Z",
      read_at: null,
    },
    {
      notification_id: "c0000000-0000-4000-8000-000000000008",
      category: "payment.overdue",
      event_code: "overdue",
      subject_label: "Service payment",
      detail: "Please review the payment action.",
      due_at: "2026-08-10T10:00:00Z",
      created_at: "2026-08-12T10:17:00Z",
      read_at: "2026-08-12T10:18:00Z",
    },
  ];
  const client = {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(functionName, args, options) {
          assert.equal(functionName, "student_portal_notifications_v2");
          assert.equal(args, undefined);
          assert.deepEqual(options, { get: true });
          return { data: rows, error: null };
        },
      };
    },
  };
  const notifications = await listPlatformStudentPortalNotificationsV2(
    studentActor(),
    { client },
  );
  assert.equal(notifications.length, 3);
  assert.deepEqual(notifications.map(({ category, eventCode, dueAt, isRead }) => ({
    category,
    eventCode,
    dueAt,
    isRead,
  })), [
    { category: "document.review", eventCode: "correction_required", dueAt: null, isRead: false },
    { category: "task.overdue", eventCode: "overdue", dueAt: "2026-08-11T10:00:00Z", isRead: false },
    { category: "payment.overdue", eventCode: "overdue", dueAt: "2026-08-10T10:00:00Z", isRead: true },
  ]);
  assert.doesNotMatch(
    JSON.stringify(notifications),
    /organization|membership|case_id|source|amount|provider|waha|amo/i,
  );
});

test("v2 feed fails closed for wrong role, extra keys and invalid category invariants", async () => {
  const rpcClient = (rows) => ({
    schema() { return { async rpc() { return { data: rows, error: null }; } }; },
  });
  await assert.rejects(
    () => listPlatformStudentPortalNotificationsV2(
      studentActor({ platformRole: "sales" }),
      { client: rpcClient([]) },
    ),
    PlatformPortalRepositoryError,
  );
  const valid = {
    notification_id: NOTIFICATION_ID,
    category: "task.overdue",
    event_code: "overdue",
    subject_label: "Task",
    detail: "Needs attention.",
    due_at: "2026-08-11T10:00:00Z",
    created_at: "2026-08-12T10:15:00Z",
    read_at: null,
  };
  await assert.rejects(
    () => listPlatformStudentPortalNotificationsV2(studentActor(), {
      client: rpcClient([{ ...valid, amount_minor: 5000 }]),
    }),
    PlatformPortalRepositoryError,
  );
  await assert.rejects(
    () => listPlatformStudentPortalNotificationsV2(studentActor(), {
      client: rpcClient([{ ...valid, due_at: null }]),
    }),
    PlatformPortalRepositoryError,
  );
});

test("Portal v2 keeps hardcoded safe destinations, selectors, realtime and v2 ack", () => {
  const list = readFileSync(
    new URL("../src/components/platform/portal/PortalNotificationList.tsx", import.meta.url),
    "utf8",
  );
  assert.match(list, /data-notification-category=\{notification\.category\}/);
  assert.match(list, /data-testid="portal-notification-subject"/);
  assert.match(list, /data-testid="portal-notification-detail"/);
  assert.match(list, /data-testid="portal-notification-due-at"/);
  assert.match(list, /data-testid="portal-notification-destination"/);
  assert.match(list, /\? "\/portal"/);
  assert.doesNotMatch(list, /"\/portal\/tasks"/);
  assert.match(list, /"\/portal\/payments"/);
  assert.match(list, /"\/portal\/documents"/);
  assert.doesNotMatch(list, /sourceId|caseId|organizationId|membershipId|amountMinor|providerId/);

  const action = readFileSync(
    new URL("../src/lib/platform-portal-notification-actions.ts", import.meta.url),
    "utf8",
  );
  assert.match(action, /mark_own_student_portal_notification_read_v2/);
  const layout = readFileSync(
    new URL("../src/app/portal/layout.tsx", import.meta.url),
    "utf8",
  );
  assert.match(layout, /PortalNotificationsRealtime/);
});

test("P6C alone keeps the accepted private Portal Realtime subscription active", () => {
  const p6cOnlyEnvironment = {
    EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED: "0",
    EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED: "1",
  };
  assert.equal(
    isPlatformP6BPortalNotificationsEnabled(p6cOnlyEnvironment),
    false,
  );
  assert.equal(
    isPlatformP6COverdueNotificationsEnabled(p6cOnlyEnvironment),
    true,
  );

  const portalFacade = readFileSync(
    new URL("../src/lib/portal.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    portalFacade,
    /notificationsRealtimeScope:\s*\(\s*isPlatformP6BPortalNotificationsEnabled\(\)\s*\|\|\s*isPlatformP6COverdueNotificationsEnabled\(\)\s*\)/,
  );
});

test("proxy admits only the exact private P6C path", () => {
  const proxy = readFileSync(
    new URL("../src/proxy.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    proxy,
    /const PLATFORM_PORTAL_OVERDUE_PATH =\s*\n\s*"\/api\/internal\/platform-operations\/portal-overdue";/,
  );
  assert.match(proxy, /path === PLATFORM_PORTAL_OVERDUE_PATH/);
  assert.doesNotMatch(proxy, /startsWith\(PLATFORM_PORTAL_OVERDUE_PATH\)/);
  assert.doesNotMatch(proxy, /includes\(PLATFORM_PORTAL_OVERDUE_PATH\)/);
  assert.equal(proxy.match(/PLATFORM_PORTAL_OVERDUE_PATH/g)?.length, 2);
});
