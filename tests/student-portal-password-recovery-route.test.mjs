import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createStudentPortalPasswordRecoveryHandler } from "../src/lib/server/student-portal-password-recovery-route-handler.ts";

// #1287: native clients reach the same recovery core as the web form through
// POST /api/portal/password-recovery. The core itself (limits, staff lookup,
// fixed deadline) is pinned in student-password-recovery.test.mjs and
// student-recovery-request.test.mjs; these tests pin the adapter boundary.

function stub(status = "sent") {
  const calls = [];
  return {
    calls,
    now: () => 1234,
    async answer(input) {
      calls.push(input);
      return status;
    },
  };
}

function req(body, { contentType = "application/json", headers = {} } = {}) {
  return new Request("https://app.evoadmissions.com/api/portal/password-recovery", {
    method: "POST",
    headers: { ...(contentType ? { "content-type": contentType } : {}), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("valid body answers neutral 200 and calls the shared core with normalized email, IP header and start time", async () => {
  const s = stub();
  const handler = createStudentPortalPasswordRecoveryHandler(s);
  const response = await handler(req({ email: "  User@Example.COM " }, { headers: { "x-forwarded-for": "203.0.113.9" } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(s.calls, [{ email: "user@example.com", forwardedFor: "203.0.113.9", startedAt: 1234 }]);
});

test("no Origin header and no cookie are needed or used", async () => {
  const s = stub();
  const response = await createStudentPortalPasswordRecoveryHandler(s)(
    req({ email: "a@b.co" }, { headers: { cookie: "sb-x-auth-token=abc" } }),
  );
  assert.equal(response.status, 200);
  assert.equal(s.calls.length, 1);
});

test("unknown keys, missing email, bad types, bad address and bad transport answer 400 invalid_request", async () => {
  const s = stub();
  const handler = createStudentPortalPasswordRecoveryHandler(s);
  for (const request of [
    req({ email: "a@b.co", extra: 1 }),
    req({}),
    req({ email: 5 }),
    req({ email: "not-an-email" }),
    req([]),
    req("null"),
    req("not-json{"),
    req({ email: "a@b.co" }, { contentType: "text/plain" }),
    req({ email: "a@b.co" }, { contentType: null }),
    req({ email: `${"x".repeat(3000)}@b.co` }),
  ]) {
    const response = await handler(request);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.equal(s.calls.length, 0);
});

test("core verdicts map to 429 rate_limited, 503 unavailable and neutral 200", async () => {
  for (const [status, http, body] of [
    ["rate_limited", 429, { error: "rate_limited" }],
    ["unavailable", 503, { error: "unavailable" }],
    ["sent", 200, { ok: true }],
  ]) {
    const response = await createStudentPortalPasswordRecoveryHandler(stub(status))(req({ email: "a@b.co" }));
    assert.equal(response.status, http, status);
    assert.deepEqual(await response.json(), body);
  }
});

test("route file delegates on the node runtime and exports only POST", () => {
  const route = readFileSync(new URL("../src/app/api/portal/password-recovery/route.ts", import.meta.url), "utf8");
  assert.match(route, /createStudentPortalPasswordRecoveryHandler\(\)/u);
  assert.match(route, /export const runtime = "nodejs";/u);
  assert.match(route, /export const dynamic = "force-dynamic";/u);
  assert.doesNotMatch(route, /GET|PUT|DELETE/u);
});
