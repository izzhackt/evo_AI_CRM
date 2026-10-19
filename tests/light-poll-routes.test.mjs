import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";

import * as handlers from "../src/lib/server/light-poll-route-handlers.ts";
import * as routes from "../src/lib/platform-route-contract.ts";
import * as origins from "../src/lib/platform-public-origin.ts";
import * as requestIds from "../src/lib/request-id.ts";
import * as requestTiming from "../src/lib/request-timing.ts";
import * as accountDeletion from "../src/lib/account-deletion-contract.ts";
import * as callback from "../src/lib/student-invite-callback-contract.ts";
import * as signupContract from "../src/lib/student-signup-confirmation-contract.ts";
import * as recoveryContract from "../src/lib/student-password-recovery-contract.ts";
import * as handoff from "../src/lib/supabase/access-handoff.ts";

// Лёгкий опрос (A4, docs/PLAN_CHANGES.md 19.10.2026): разбор ответа RPC,
// два обработчика, вид запроса к PostgREST и путь через настоящий proxy.

const VERSION = "0123456789abcdef0123456789abcdef";
const REVISION = "fedcba9876543210fedcba9876543210fedcba98";

test("the RPC answer is decoded: access, a non-negative integer and a 32-hex or null version; everything else is a refusal", () => {
  const decode = handlers.decodeLightPollRpc;
  assert.deepEqual(decode({ data: { access: true, unread: 3, version: VERSION }, error: null }), { status: "ok", unread: 3, version: VERSION });
  assert.deepEqual(decode({ data: { access: true, unread: "12", version: null }, error: null }), { status: "ok", unread: 12, version: null }, "the staff function counts in text");
  assert.deepEqual(decode({ data: { access: false }, error: null }), { status: "denied" });
  assert.deepEqual(decode({ data: null, error: { code: "42501" }, status: 403 }), { status: "denied" });
  assert.deepEqual(decode({ data: null, error: { code: "PGRST301" }, status: 401 }), { status: "anonymous" });
  assert.deepEqual(decode({ data: null, error: { code: "57014" }, status: 500 }), { status: "unavailable" });
  for (const data of [
    null, [], "x", {}, { access: "yes", unread: 1, version: VERSION }, { access: true, unread: -1, version: VERSION },
    { access: true, unread: 1.5, version: VERSION }, { access: true, unread: "1x", version: VERSION },
    { access: true, unread: 1, version: "short" }, { access: true, unread: 1 }, { access: true, unread: 1, version: 5 },
  ]) assert.deepEqual(decode({ data, error: null }), { status: "unavailable" }, JSON.stringify(data));
});

function studentHandler({ outcome = { status: "ok", unread: 2, version: VERSION }, release = REVISION, calls = [] } = {}) {
  return {
    calls,
    GET: handlers.createStudentPortalUpdatesHandler({
      poll: async (section) => { calls.push(section); if (outcome instanceof Error) throw outcome; return outcome; },
      release: () => release,
    }),
  };
}

const get = (path) => new Request(`https://app.evoadmissions.com${path}`);

test("the student route answers a closed set of keys, never caches, and validates the section strictly", async () => {
  const route = studentHandler();
  const response = await route.GET(get("/api/portal/updates?s=home"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), { release: REVISION, unread: 2, version: VERSION });
  assert.deepEqual(route.calls, ["home"]);

  const bare = studentHandler();
  assert.equal((await bare.GET(get("/api/portal/updates"))).status, 200);
  assert.deepEqual(bare.calls, [null], "no section: the bell only");

  for (const query of ["?s=unknown", "?s=", "?s=home&s=documents", "?s=home&x=1", "?x=1", "?S=home", "?s=home%2Cdocuments"]) {
    const refused = studentHandler();
    const reply = await refused.GET(get(`/api/portal/updates${query}`));
    assert.equal(reply.status, 400, query);
    assert.deepEqual(refused.calls, [], `${query}: nothing is asked of the database`);
  }
  for (const section of ["home", "admission", "documents", "payments", "notifications", "messages"]) {
    assert.equal((await studentHandler().GET(get(`/api/portal/updates?s=${section}`))).status, 200, section);
  }
});

test("outcomes map to 401, 403 and 503 with nothing but an error key; a thrown reader is 503; no release is null", async () => {
  for (const [outcome, status, error] of [
    [{ status: "anonymous" }, 401, "authentication_required"],
    [{ status: "denied" }, 403, "forbidden"],
    [{ status: "unavailable" }, 503, "unavailable"],
    [new Error("database says: person@example.test"), 503, "unavailable"],
  ]) {
    const reply = await studentHandler({ outcome }).GET(get("/api/portal/updates?s=home"));
    assert.equal(reply.status, status);
    assert.deepEqual(await reply.json(), { error });
    assert.equal(reply.headers.get("cache-control"), "no-store");
  }
  const local = await studentHandler({ release: null }).GET(get("/api/portal/updates"));
  assert.deepEqual(await local.json(), { release: null, unread: 2, version: VERSION });
});

test("the staff route takes no parameters and answers the same closed shape", async () => {
  const calls = [];
  const GET = handlers.createStaffNotificationsStateHandler({
    poll: async () => { calls.push("poll"); return { status: "ok", unread: 5, version: VERSION }; },
    release: () => REVISION,
  });
  const reply = await GET(new Request("https://crm.evoadmissions.com/api/v3/notifications/state"));
  assert.deepEqual(await reply.json(), { release: REVISION, unread: 5, version: VERSION });
  assert.equal(reply.headers.get("cache-control"), "no-store");
  const refused = await GET(new Request("https://crm.evoadmissions.com/api/v3/notifications/state?organization=1"));
  assert.equal(refused.status, 400);
  assert.deepEqual(calls, ["poll"]);
  const denied = handlers.createStaffNotificationsStateHandler({ poll: async () => ({ status: "denied" }), release: () => null });
  assert.equal((await denied(new Request("https://crm.evoadmissions.com/api/v3/notifications/state"))).status, 403);
});

function recordingClient() {
  const requests = [];
  const client = createClient("https://supabase.example.test", "synthetic-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input.url);
        requests.push({ method: init?.method ?? "GET", path: url.pathname, query: url.search, body: init?.body ?? null, profile: new Headers(init?.headers).get("accept-profile") ?? new Headers(init?.headers).get("content-profile") });
        return new Response(JSON.stringify({ access: true, unread: 1, version: VERSION }), { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  });
  return { client, requests };
}

test("the student poll is ONE GET RPC with no cursor-like null; the staff poll is ONE POST RPC with no arguments", async () => {
  const withSection = recordingClient();
  assert.deepEqual(await handlers.requestStudentPortalPoll(withSection.client, "documents"), { status: "ok", unread: 1, version: VERSION });
  assert.equal(withSection.requests.length, 1, "exactly one request to the database");
  assert.deepEqual(
    { ...withSection.requests[0], body: null },
    { method: "GET", path: "/rest/v1/rpc/student_portal_poll_v1", query: "?p_section=documents", body: null, profile: "platform" },
  );

  const bare = recordingClient();
  await handlers.requestStudentPortalPoll(bare.client, null);
  assert.equal(bare.requests[0].query, "", "a missing section is omitted, not the text «null»");

  const staff = recordingClient();
  assert.deepEqual(await handlers.requestStaffNotificationsState(staff.client), { status: "ok", unread: 1, version: VERSION });
  assert.equal(staff.requests.length, 1);
  assert.equal(staff.requests[0].method, "POST");
  assert.equal(staff.requests[0].path, "/rest/v1/rpc/staff_notifications_state_v1");
  assert.ok(staff.requests[0].body === null || staff.requests[0].body === "{}", `the call carries no arguments: ${staff.requests[0].body}`);
});

test("route contract: only GET on the two exact paths is a light poll", () => {
  assert.equal(routes.isLightPollApi("/api/portal/updates", "GET"), true);
  assert.equal(routes.isLightPollApi("/api/v3/notifications/state", "GET"), true);
  for (const [path, method] of [
    ["/api/portal/updates", "POST"], ["/api/portal/updates", "HEAD"], ["/api/portal/updates/", "GET"], ["/api/portal/updates/x", "GET"],
    ["/api/portal/updatesx", "GET"], ["/api/v3/notifications/state", "PUT"], ["/api/v3/notifications", "GET"], ["/api/v3/notifications/state/x", "GET"],
    ["/portal/updates", "GET"], ["/api/portal/updates?s=home", "GET"],
  ]) assert.equal(routes.isLightPollApi(path, method), false, `${method} ${path}`);
});

function compile(path, dependencies) {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, compiled, compiled.exports);
  return compiled.exports;
}

const USER = "10000000-0000-4000-8000-000000000001";

/** The real proxy with real routing; Supabase is a stub that counts every database read. */
function proxyHarness({ claims = { sub: USER, email: "person@example.test", session_id: "20000000-0000-4000-8000-000000000002", exp: 1_900_000_000 }, claimsError = null } = {}) {
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
    "@supabase/ssr": { createServerClient: () => ({ auth: { getClaims: async () => { calls.push("getClaims"); return claimsError ? { data: null, error: claimsError } : { data: { claims }, error: null }; } } }) },
    "@/lib/supabase/platform-authority": { readPlatformAuthoritySnapshot: async () => { calls.push("staff"); return { result: { status: "invalid", authority: null }, rows: {} }; } },
    "@/lib/supabase/student-portal-authority": {
      readStudentPortalAuthorityRows: async () => { calls.push("student"); return { result: { status: "invalid", authority: null }, rows: {} }; },
      isStudentAuthorityRow: () => false,
    },
    "@/lib/supabase/access-handoff": handoff,
  });
  return { proxy: loaded.proxy, calls };
}

function request(host, path, method = "GET", cookie = "sb-test-auth-token=session", extra = {}) {
  return new NextRequest(`https://${host}${path}`, {
    method,
    headers: { host, ...(cookie ? { cookie } : {}), "x-request-id": "light-poll-request-1", ...extra },
  });
}

function forwarded(response, name) {
  const names = (response.headers.get("x-middleware-override-headers") ?? "").split(",");
  return names.includes(name) ? response.headers.get(`x-middleware-request-${name}`) : null;
}

test("the proxy lets a light poll through after refreshing the session, with NO authority RPC and no handoff", async () => {
  for (const [host, path] of [["app.evoadmissions.com", "/api/portal/updates?s=home"], ["crm.evoadmissions.com", "/api/v3/notifications/state"]]) {
    const run = proxyHarness();
    const response = await run.proxy(request(host, path, "GET", "sb-test-auth-token=session", { [handoff.ACCESS_HANDOFF_HEADER]: "forged.value" }));
    assert.equal(response.headers.get("x-middleware-next"), "1", path);
    assert.deepEqual(run.calls, ["getClaims"], `${path}: only the local session check, no staff/Student RPC`);
    assert.equal(forwarded(response, handoff.ACCESS_HANDOFF_HEADER), null, "a forged handoff never reaches the route and none is issued");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-request-id"), "light-poll-request-1");
  }
});

test("without a session, with a broken session or with Auth down the poll answers JSON 401/503, never a redirect", async () => {
  const none = proxyHarness({ claimsError: { name: "AuthSessionMissingError" } });
  const missing = await none.proxy(request("app.evoadmissions.com", "/api/portal/updates?s=home", "GET", null));
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { error: "authentication_required" });
  assert.deepEqual(none.calls, ["getClaims"]);

  const broken = proxyHarness({ claimsError: { name: "AuthApiError" } });
  const invalid = await broken.proxy(request("crm.evoadmissions.com", "/api/v3/notifications/state"));
  assert.equal(invalid.status, 401);
  assert.deepEqual(await invalid.json(), { error: "authentication_required" });
});

test("only GET is a light poll: other methods on the same paths keep the closed default and ask nothing", async () => {
  for (const [method, path] of [["POST", "/api/portal/updates"], ["PUT", "/api/v3/notifications/state"], ["DELETE", "/api/portal/updates"]]) {
    const run = proxyHarness();
    const response = await run.proxy(request("app.evoadmissions.com", path, method));
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.deepEqual(await response.json(), { error: "platform_route_not_connected", request_id: "light-poll-request-1" });
    assert.deepEqual(run.calls, []);
  }
});

test("source contract: the light-poll branch sits after the public pages and before the connected-route check", () => {
  const proxy = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
  const branch = proxy.indexOf("if (isLightPollApi(path, request.method))");
  assert.ok(branch > proxy.indexOf("if (isPublicStudentApplicationPage(path))"), "after the public анкета page");
  assert.ok(branch < proxy.indexOf("if (!isConnectedPlatformPage(path) && !isConnectedPlatformApi(path))"), "before the closed default");
  assert.match(proxy, /liveSessionState\(request, requestHeaders, true\)[\s\S]{0,200}authenticated_without_product/u, "refresh-only session state");
  const mark = proxy.indexOf("markProxied();");
  assert.ok(mark > proxy.indexOf('if (path === "/api/health" || path === "/api/version")'), "health and version are not measured");
  assert.ok(mark < proxy.indexOf("if (isConnectedPlatformPrivateApi(path))"), "everything else is");
  // The CRM page remembers the release it was rendered by (stale-build detection of the bell).
  const staffLayout = readFileSync(new URL("../src/app/(v3)/layout.tsx", import.meta.url), "utf8");
  assert.match(staffLayout, /<ServerReleaseMark release=\{release\.status === "available" \? release\.revision : null\} \/>/u);
  // The routes themselves repeat nothing of the proxy and stay thin.
  assert.match(readFileSync(new URL("../src/app/api/portal/updates/route.ts", import.meta.url), "utf8"), /export const GET = createStudentPortalUpdatesHandler\(\);/u);
  assert.match(readFileSync(new URL("../src/app/api/v3/notifications/state/route.ts", import.meta.url), "utf8"), /export const GET = createStaffNotificationsStateHandler\(\);/u);
});
