import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";

import * as handoff from "../src/lib/supabase/access-handoff.ts";
import * as routes from "../src/lib/platform-route-contract.ts";
import * as origins from "../src/lib/platform-public-origin.ts";
import * as requestIds from "../src/lib/request-id.ts";
import * as requestTiming from "../src/lib/request-timing.ts";
import * as accountDeletion from "../src/lib/account-deletion-contract.ts";
import * as callback from "../src/lib/student-invite-callback-contract.ts";
import * as signupContract from "../src/lib/student-signup-confirmation-contract.ts";
import * as recoveryContract from "../src/lib/student-password-recovery-contract.ts";
import { resolveStudentPortalActor } from "../src/lib/student-portal-auth.ts";
import { readStudentPortalAuthorityRows } from "../src/lib/supabase/student-portal-authority.ts";

// План A (docs/PLAN_CHANGES.md, 16.10.2026): одна живая проверка доступа на
// запрос. Proxy передаёт рендеру строки RPC в подписанном заголовке запроса.

const USER = "10000000-0000-4000-8000-000000000001";
const SESSION = "20000000-0000-4000-8000-000000000002";
const PROFILE = "30000000-0000-4000-8000-000000000003";
const MEMBERSHIP = "40000000-0000-4000-8000-000000000004";
const ORGANIZATION = "50000000-0000-4000-8000-000000000005";
const BUNDLE = "60000000-0000-4000-8000-000000000006";
const CASE = "70000000-0000-4000-8000-000000000007";
const REQUEST_ID = "access-handoff-request-1";

function claims(overrides = {}) {
  return { sub: USER, email: "person@example.test", session_id: SESSION, exp: 1_900_000_000,
    platform_bundle_id: BUNDLE, platform_bundle_version: 2, ...overrides };
}
const studentActorRows = [{ auth_user_id: USER, profile_id: PROFILE, membership_id: MEMBERSHIP, organization_id: ORGANIZATION,
  display_name: "Айжан Тестова", platform_role: "student", platform_access_version: 3 }];
const studentCaseRows = [{ case_id: CASE, case_state: "active", portal_activated_at: "2026-09-07T08:00:00.000Z" }];
const staffSnapshot = { schemaVersion: 1, authUserId: USER, profileId: PROFILE, membershipId: MEMBERSHIP,
  organizationId: ORGANIZATION, displayName: "Сотрудник", systemRole: "staff", accessVersion: 2, assignments: [], permissions: ["lead.read"] };

test("a handoff verifies only for the same request, session and fresh signature", async () => {
  const now = 1_800_000_000_000;
  const value = await handoff.createAccessHandoff(REQUEST_ID, claims(), { staff: staffSnapshot }, now);
  assert.equal(typeof value, "string");
  assert.deepEqual(await handoff.verifyAccessHandoff(value, REQUEST_ID, claims(), now + 50), { staff: staffSnapshot });

  // An RPC answer of NULL stays a present key (the proxy did read it).
  const empty = await handoff.createAccessHandoff(REQUEST_ID, claims(), { staff: null, actor: studentActorRows }, now);
  const rows = await handoff.verifyAccessHandoff(empty, REQUEST_ID, claims(), now);
  assert.equal(Object.hasOwn(rows, "staff"), true);
  assert.equal(rows.staff, null);
  assert.equal(Object.hasOwn(rows, "cases"), false, "a read that did not happen is not invented");

  const rejected = [
    [value, "another-request-id", claims(), now],
    [value, REQUEST_ID, claims({ sub: "10000000-0000-4000-8000-000000000009" }), now],
    [value, REQUEST_ID, claims({ session_id: "20000000-0000-4000-8000-000000000009" }), now],
    [value, REQUEST_ID, claims({ exp: 1_900_000_001 }), now],
    [value, REQUEST_ID, claims(), now + handoff.ACCESS_HANDOFF_MAX_AGE_MS + 1],
    [value, REQUEST_ID, claims(), now - 5_000],
    [value, null, claims(), now],
    [null, REQUEST_ID, claims(), now],
    ["", REQUEST_ID, claims(), now],
    [`${value}.extra`, REQUEST_ID, claims(), now],
    [value.replace(/^./u, (first) => (first === "e" ? "f" : "e")), REQUEST_ID, claims(), now],
    [`${value.split(".")[0]}.${"A".repeat(43)}`, REQUEST_ID, claims(), now],
    ["not-base64!.sig", REQUEST_ID, claims(), now],
  ];
  for (const [candidate, requestId, actor, at] of rejected) {
    assert.equal(await handoff.verifyAccessHandoff(candidate, requestId, actor, at), null, JSON.stringify([requestId, actor.sub, at]));
  }
});

test("a handoff signed by another process key is rejected", async () => {
  const now = Date.now();
  const value = await handoff.createAccessHandoff(REQUEST_ID, claims(), { staff: staffSnapshot }, now);
  const key = Symbol.for("evo.platform.access-handoff.key.v1");
  const previous = globalThis[key];
  try {
    delete globalThis[key];
    assert.equal(await handoff.verifyAccessHandoff(value, REQUEST_ID, claims(), now), null);
  } finally {
    globalThis[key] = previous;
  }
  assert.deepEqual(await handoff.verifyAccessHandoff(value, REQUEST_ID, claims(), now), { staff: staffSnapshot });
});

function compile(path, dependencies = {}) {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

/** The real proxy with real routing and handoff; only Supabase and the authority RPCs are stubs. */
function proxyHarness({ role }) {
  const calls = [];
  const loaded = compile("src/proxy.ts", {
    "next/server": { NextRequest, NextResponse },
    "@/lib/platform-route-contract": routes,
    "@/lib/platform-public-origin": origins,
    "@/lib/request-id": requestIds,
    "@/lib/request-timing": requestTiming,
    "@/lib/account-deletion-contract": accountDeletion,
    "@/lib/student-invite-callback-contract": callback,
    "@/lib/student-signup-confirmation-contract": signupContract,
    "@/lib/student-password-recovery-contract": recoveryContract,
    "@/lib/supabase/config": { getSupabasePublicConfig: () => ({ url: "https://supabase.example.test", publishableKey: "synthetic-public-key" }) },
    "@supabase/ssr": { createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims: claims() }, error: null }) } }) },
    "@/lib/supabase/platform-authority": {
      readPlatformAuthoritySnapshot: async () => {
        calls.push("staff");
        return role === "staff"
          ? { result: { status: "authenticated", authority: { authUserId: USER } }, rows: { staff: staffSnapshot } }
          : { result: { status: "invalid", authority: null }, rows: { staff: null } };
      },
    },
    "@/lib/supabase/student-portal-authority": {
      readStudentPortalAuthorityRows: async (_client, _claims, options) => {
        calls.push(`student:${options?.parallel ? "parallel" : "sequential"}`);
        return role === "student"
          ? { result: { status: "authenticated", authority: { studentCaseId: CASE } }, rows: { actor: studentActorRows, cases: studentCaseRows } }
          : { result: { status: "invalid", authority: null }, rows: { actor: [{ ...studentActorRows[0], platform_role: "sales" }] } };
      },
      isStudentAuthorityRow: (rows) => Array.isArray(rows) && rows[0]?.platform_role === "student",
    },
    "@/lib/supabase/access-handoff": handoff,
  });
  return { proxy: loaded.proxy, calls };
}

function forwarded(response, name) {
  const names = (response.headers.get("x-middleware-override-headers") ?? "").split(",");
  return names.includes(name) ? response.headers.get(`x-middleware-request-${name}`) : null;
}

function request(host, path, method = "GET", extra = {}) {
  return new NextRequest(`https://${host}${path}`, {
    method,
    headers: { host, cookie: "sb-test-auth-token=session", "x-request-id": REQUEST_ID, ...extra },
  });
}

test("the proxy hands its live staff rows to the render of the same GET request", async () => {
  const run = proxyHarness({ role: "staff" });
  const response = await run.proxy(request("crm.evoadmissions.com", "/v3/main", "GET", { [handoff.ACCESS_HANDOFF_HEADER]: "forged.value" }));
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.deepEqual(run.calls, ["staff"], "staff route: one staff read, no Student read");
  const value = forwarded(response, handoff.ACCESS_HANDOFF_HEADER);
  assert.notEqual(value, "forged.value", "the client value never reaches the render");
  assert.deepEqual(await handoff.verifyAccessHandoff(value, forwarded(response, "x-request-id"), claims()), { staff: staffSnapshot });
});

test("a Student route asks the Student question first, both reads together, and hands both rows over", async () => {
  const run = proxyHarness({ role: "student" });
  const response = await run.proxy(request("app.evoadmissions.com", "/portal/home"));
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.deepEqual(run.calls, ["student:parallel"], "no staff snapshot for a Student");
  const rows = await handoff.verifyAccessHandoff(forwarded(response, handoff.ACCESS_HANDOFF_HEADER), REQUEST_ID, claims());
  assert.deepEqual(rows, { actor: studentActorRows, cases: studentCaseRows });
});

test("a staff actor on a Student route still gets the staff answer, and a POST never carries a handoff", async () => {
  const staff = proxyHarness({ role: "staff" });
  const redirected = await staff.proxy(request("app.evoadmissions.com", "/portal/home"));
  assert.deepEqual(staff.calls, ["student:parallel", "staff"]);
  assert.equal(redirected.status, 307);
  assert.equal(new URL(redirected.headers.get("location")).pathname, "/");

  const action = proxyHarness({ role: "staff" });
  const response = await action.proxy(request("crm.evoadmissions.com", "/v3/main", "POST", { [handoff.ACCESS_HANDOFF_HEADER]: "forged.value" }));
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(forwarded(response, handoff.ACCESS_HANDOFF_HEADER), null, "commands keep their own live check");
});

test("the Student resolver uses handed-off rows without an RPC, and reads live when they are incomplete", async () => {
  const rpcCalls = [];
  const client = {
    auth: { async getClaims() { return { data: { claims: claims() }, error: null }; } },
    schema() {
      return { async rpc(name) {
        rpcCalls.push(name);
        return { data: name === "current_actor_authority" ? studentActorRows : studentCaseRows, error: null };
      } };
    },
  };
  const handed = await resolveStudentPortalActor({ createClient: async () => client, handedOffRows: async () => ({ actor: studentActorRows, cases: studentCaseRows }) });
  assert.equal(handed.status, "authenticated");
  assert.equal(handed.actor.studentCaseId, CASE);
  assert.deepEqual(rpcCalls, []);

  const staffRow = await resolveStudentPortalActor({ createClient: async () => client, handedOffRows: async () => ({ actor: [{ ...studentActorRows[0], platform_role: "sales" }] }) });
  assert.equal(staffRow.status, "invalid");
  assert.deepEqual(rpcCalls, [], "a non-Student row needs no projection");

  const incomplete = await resolveStudentPortalActor({ createClient: async () => client, handedOffRows: async () => ({ actor: studentActorRows }) });
  assert.equal(incomplete.status, "authenticated");
  assert.deepEqual(rpcCalls.sort(), ["current_actor_authority", "student_portal_cases"]);

  rpcCalls.length = 0;
  const missing = await resolveStudentPortalActor({ createClient: async () => client, handedOffRows: async () => null });
  assert.equal(missing.status, "authenticated");
  assert.deepEqual(rpcCalls.sort(), ["current_actor_authority", "student_portal_cases"]);
});

test("the parallel Student read starts both RPCs together and keeps the sequential reader's answers", async () => {
  const started = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const client = (role, casesError = null) => ({
    schema() {
      return { rpc(name) {
        started.push(name);
        return gate.then(() => name === "current_actor_authority"
          ? { data: [{ ...studentActorRows[0], platform_role: role }], error: null }
          : { data: casesError ? null : studentCaseRows, error: casesError });
      } };
    },
  });
  const read = readStudentPortalAuthorityRows(client("student"), claims(), { parallel: true });
  await Promise.resolve();
  assert.deepEqual(started, ["current_actor_authority", "student_portal_cases"], "both reads start before either answers");
  release();
  assert.equal((await read).result.status, "authenticated");

  assert.deepEqual((await readStudentPortalAuthorityRows(client("sales", { code: "PGRST500" }), claims(), { parallel: true })).result,
    { status: "invalid", authority: null }, "a staff row is rejected before the projection is considered");
  assert.deepEqual((await readStudentPortalAuthorityRows(client("student", { code: "PGRST500" }), claims(), { parallel: true })).result,
    { status: "unavailable", authority: null });
});

test("proxy and resolvers keep the handoff narrow (source contract)", () => {
  const proxy = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
  const strip = proxy.indexOf("requestHeaders.delete(ACCESS_HANDOFF_HEADER);");
  assert.ok(strip > proxy.indexOf('requestHeaders.set("x-request-id", id);'), "strip right after the request id is set");
  assert.ok(strip < proxy.indexOf("isRetiredPlatformRoute(path)"), "before any early return");
  assert.match(proxy, /const handoffRequestId = request\.method === "GET" \|\| request\.method === "HEAD"/u);
  const platformAuth = readFileSync(new URL("../src/lib/platform-auth.ts", import.meta.url), "utf8");
  assert.match(platformAuth, /verifyAccessHandoff\(\s*requestHeaders\.get\(ACCESS_HANDOFF_HEADER\),\s*requestHeaders\.get\("x-request-id"\),\s*claims,/u);
  assert.match(platformAuth, /export const resolvePlatformActor = cache\(resolvePlatformActorOnce\);/u);
  const handoffSource = readFileSync(new URL("../src/lib/supabase/access-handoff.ts", import.meta.url), "utf8");
  assert.match(handoffSource, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/u);
  assert.doesNotMatch(handoffSource, /process\.env/u, "the key is never configuration or a secret on disk");
});
