import assert from "node:assert/strict";
import test from "node:test";

import {
  LocalSupabaseAuthReadinessError,
  waitForLocalSupabaseAuthAdmin,
} from "../scripts/supabase-auth-readiness.mjs";

const apiUrl = "http://127.0.0.1:45421";
const serviceRoleKey = "synthetic.service.role";
const response = (status) => new Response("{}", { status });

const runProbe = (overrides = {}) =>
  waitForLocalSupabaseAuthAdmin({
    apiUrl,
    serviceRoleKey,
    delayImpl: async () => {},
    requestTimeoutMs: 10,
    ...overrides,
  });

test("waits through transient gateway statuses using only a read-only request", async () => {
  const statuses = [502, 503, 504, 200];
  const requests = [];
  let delayCount = 0;

  await runProbe({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response(statuses.shift());
    },
    delayImpl: async () => {
      delayCount += 1;
    },
  });

  assert.equal(requests.length, 4);
  assert.equal(delayCount, 3);
  for (const request of requests) {
    assert.equal(request.url, `${apiUrl}/auth/v1/admin/users?page=1&per_page=1`);
    assert.equal(request.options.method, "GET");
    assert.equal(request.options.headers.apikey, serviceRoleKey);
    assert.equal(
      request.options.headers.Authorization,
      `Bearer ${serviceRoleKey}`,
    );
    assert.equal(request.options.body, undefined);
  }
});

test("waits through a transient network failure", async () => {
  let calls = 0;

  await runProbe({
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("synthetic network failure");
      return response(200);
    },
  });

  assert.equal(calls, 2);
});

test("fails immediately on an authorization response", async () => {
  let calls = 0;
  let delayCount = 0;

  await assert.rejects(
    runProbe({
      fetchImpl: async () => {
        calls += 1;
        return response(401);
      },
      delayImpl: async () => {
        delayCount += 1;
      },
    }),
    (error) =>
      error instanceof LocalSupabaseAuthReadinessError &&
      error.stage === "auth-admin-readiness-http-401",
  );

  assert.equal(calls, 1);
  assert.equal(delayCount, 0);
});

test("fails closed after the bounded transient retry budget", async () => {
  let calls = 0;
  let delayCount = 0;

  await assert.rejects(
    runProbe({
      maxAttempts: 3,
      fetchImpl: async () => {
        calls += 1;
        return response(502);
      },
      delayImpl: async () => {
        delayCount += 1;
      },
    }),
    (error) =>
      error instanceof LocalSupabaseAuthReadinessError &&
      error.stage === "auth-admin-readiness-timeout",
  );

  assert.equal(calls, 3);
  assert.equal(delayCount, 2);
});

test("honors the readiness deadline even when transient retries are fast", async () => {
  let now = 0;
  let calls = 0;
  const delays = [];

  await assert.rejects(
    runProbe({
      maxAttempts: 10,
      readinessTimeoutMs: 600,
      nowImpl: () => now,
      fetchImpl: async () => {
        calls += 1;
        return response(502);
      },
      delayImpl: async (milliseconds) => {
        delays.push(milliseconds);
        now += milliseconds;
      },
    }),
    (error) =>
      error instanceof LocalSupabaseAuthReadinessError &&
      error.stage === "auth-admin-readiness-timeout",
  );

  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 250, 100]);
});

test("never exposes credentials or provider errors in a readiness failure", async () => {
  const providerError = `provider echoed ${serviceRoleKey}`;

  await assert.rejects(
    runProbe({
      maxAttempts: 1,
      fetchImpl: async () => {
        throw new Error(providerError);
      },
    }),
    (error) => {
      assert.equal(error.stage, "auth-admin-readiness-timeout");
      assert.doesNotMatch(error.message, new RegExp(serviceRoleKey));
      assert.doesNotMatch(error.message, /provider echoed/);
      return true;
    },
  );
});
