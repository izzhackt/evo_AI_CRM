import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isConnectedPlatformPrivateApi } from "../src/lib/platform-route-contract.ts";
import {
  isPlatformP6COverdueNotificationsEnabled,
  loadPlatformP6COverdueConfig,
  PLATFORM_P6C_OVERDUE_WORKER_ID,
} from "../src/lib/server/platform-p6c-overdue-config.ts";
import {
  createPlatformP6COverdueHandler,
  createPlatformP6COverdueRepository,
} from "../src/lib/server/platform-p6c-overdue-processor.ts";
const REQUEST_ID = "c0000000-0000-4000-8000-000000000001";
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

test("proxy admits only the exact private P6C path", () => {
  const proxy = readFileSync(
    new URL("../src/proxy.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    isConnectedPlatformPrivateApi(
      "/api/internal/platform-operations/portal-overdue",
    ),
    true,
  );
  for (const path of [
    "/api/internal/platform-operations/portal-overdue/",
    "/api/internal/platform-operations/portal-overdue/extra",
    "/api/internal/platform-operations/portal-overdue-preview",
  ]) {
    assert.equal(isConnectedPlatformPrivateApi(path), false, path);
  }
  assert.match(proxy, /isConnectedPlatformPrivateApi\(path\)/);
});
