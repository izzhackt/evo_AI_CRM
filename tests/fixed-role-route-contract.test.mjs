import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { NextRequest } from "next/server.js";

import {
  FIXED_ROLE_ROUTES,
  fixedRoleCanAccessRoute,
} from "../src/lib/fixed-role-policy.ts";
import {
  canonicalPlatformPageOrigin,
  platformAudienceForHost,
  platformAudienceHomeRoute,
  shouldRenderPlatformLogin,
  PRODUCTION_STAFF_ORIGIN,
  PRODUCTION_STUDENT_ORIGIN,
} from "../src/lib/platform-public-origin.ts";
import {
  isConnectedPlatformApi,
  isConnectedPlatformPage,
  isConnectedPlatformPrivateApi,
  isConnectedStudentAuthPage,
  isConnectedStudentPortalApi,
  isConnectedStudentPortalPage,
  isRetiredPlatformRoute,
  platformHomeRoute,
} from "../src/lib/platform-route-contract.ts";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("login POST reaches credential verification for every previous session and host", () => {
  for (const host of ["crm.evoadmissions.com", "app.evoadmissions.com", "localhost:3000", null]) {
    for (const session of ["staff", "student", "missing", "invalid", "unavailable", "authenticated_without_product"]) {
      assert.equal(shouldRenderPlatformLogin("POST", host, session, null), true, `${host}:${session}`);
    }
  }
});

test("login navigation permits opposite audience without changing same-audience or unknown-host redirects", () => {
  for (const method of ["GET", "HEAD"]) {
    assert.equal(shouldRenderPlatformLogin(method, "app.evoadmissions.com", "staff", null), true);
    assert.equal(shouldRenderPlatformLogin(method, "crm.evoadmissions.com", "student", null), true);
    assert.equal(shouldRenderPlatformLogin(method, "app.evoadmissions.com", "student", null), false);
    assert.equal(shouldRenderPlatformLogin(method, "crm.evoadmissions.com", "staff", null), false);
    for (const host of ["localhost:3000", "app.evoadmissions.com.attacker.invalid", null]) {
      for (const session of ["staff", "student"]) assert.equal(shouldRenderPlatformLogin(method, host, session, null), false);
    }
    for (const host of ["crm.evoadmissions.com", "app.evoadmissions.com", "localhost:3000", null]) {
      for (const session of ["missing", "invalid", "unavailable"]) {
        assert.equal(shouldRenderPlatformLogin(method, host, session, null), true);
      }
      assert.equal(shouldRenderPlatformLogin(method, host, "authenticated_without_product", null), false);
      assert.equal(shouldRenderPlatformLogin(method, host, "authenticated_without_product", "other"), false);
      for (const error of ["session_invalid", "auth_unavailable"]) {
        assert.equal(shouldRenderPlatformLogin(method, host, "authenticated_without_product", error), true);
        for (const session of ["staff", "student"]) {
          assert.equal(shouldRenderPlatformLogin(method, host, session, error),
            shouldRenderPlatformLogin(method, host, session, null));
        }
      }
    }
  }
  // This narrow change grants no new behavior to unrelated methods.
  assert.equal(shouldRenderPlatformLogin("PUT", "app.evoadmissions.com", "staff", null), false);
});

test("real proxy forwards exact login POST unchanged while rejecting cross-audience action routes", async () => {
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL("../src/proxy.ts", import.meta.url))],
    bundle: true, packages: "external", platform: "node", format: "cjs", write: false,
  });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  const { proxy } = loaded.exports;
  for (const host of ["app.evoadmissions.com", "crm.evoadmissions.com", "localhost:3000"]) {
    for (const actionHeader of [null, "routing-boundary-only"]) {
      const headers = { host, origin: `https://${host}`, "x-forwarded-host": host,
        cookie: "routing-boundary-not-a-session=1", "content-type": "application/x-www-form-urlencoded" };
      if (actionHeader) headers["next-action"] = actionHeader;
      const request = new NextRequest(`https://${host}/login`, {
        method: "POST", headers, body: "routing-boundary-only=1",
      });
      const response = await proxy(request);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
      assert.equal(response.headers.get("location"), null);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.ok(response.headers.get("x-request-id"));
      assert.equal(response.cookies.getAll().length, 0);
      for (const [name, value] of Object.entries(headers)) {
        assert.equal(request.headers.get(name), value);
        assert.equal(response.headers.get(`x-middleware-request-${name}`), value);
      }
      assert.equal(await request.text(), "routing-boundary-only=1");
      assert.equal(request.method, "POST");
    }
  }
  const denied = await proxy(new NextRequest("https://app.evoadmissions.com/auth/staff", {
    method: "POST", headers: { host: "app.evoadmissions.com" }, body: "routing-boundary-only=1",
  }));
  assert.equal(denied.status, 404);
  assert.equal(denied.headers.get("location"), null);
  for (const path of ["/login/foo", "/loginish"]) {
    const denied = await proxy(new NextRequest(`https://app.evoadmissions.com${path}`, {
      method: "POST", headers: { host: "app.evoadmissions.com" }, body: "routing-boundary-only=1",
    }));
    assert.notEqual(denied.headers.get("x-middleware-next"), "1", path);
  }
});

test("canonical audience hosts relocate only exact known pages, not API authority", () => {
  assert.equal(platformAudienceForHost("crm.evoadmissions.com"), "staff");
  assert.equal(platformAudienceForHost("app.evoadmissions.com"), "student");
  for (const host of [null, "", "127.0.0.1:3000", "evo-crm.72.62.119.112.sslip.io",
    "app.evoadmissions.com.attacker.invalid", "app.evoadmissions.com, crm.evoadmissions.com"]) {
    assert.equal(platformAudienceForHost(host), null);
    assert.equal(canonicalPlatformPageOrigin(host, "/portal"), null);
  }
  for (const path of ["/portal", "/portal/documents", "/portal/tests", "/auth/callback", "/auth/set-password", "/auth/account-pending"]) {
    assert.equal(canonicalPlatformPageOrigin("crm.evoadmissions.com", path), PRODUCTION_STUDENT_ORIGIN, path);
    assert.equal(canonicalPlatformPageOrigin("app.evoadmissions.com", path), null, path);
  }
  for (const path of ["/v3/main", "/v3/calendar", "/auth/staff", "/platform-pending", "/access-denied"]) {
    assert.equal(canonicalPlatformPageOrigin("app.evoadmissions.com", path), PRODUCTION_STAFF_ORIGIN, path);
    assert.equal(canonicalPlatformPageOrigin("crm.evoadmissions.com", path), null, path);
  }
  for (const host of ["crm.evoadmissions.com", "app.evoadmissions.com"]) {
    for (const path of ["/", "/login", "/api/health", "/api/portal/unknown", "/api/public/website-leads", "/portal/unknown", "//attacker.invalid"]) {
      assert.equal(canonicalPlatformPageOrigin(host, path), null, path);
    }
  }
});

test("verified actor home dispatch cannot loop Staff through the Student portal", () => {
  assert.equal(platformAudienceHomeRoute("app.evoadmissions.com", "staff", "/v3/main"), "https://crm.evoadmissions.com/v3/main");
  assert.equal(platformAudienceHomeRoute("crm.evoadmissions.com", "student", "/portal"), "https://app.evoadmissions.com/portal");
  assert.equal(platformAudienceHomeRoute("crm.evoadmissions.com", "student", "/auth/account-pending"), "https://app.evoadmissions.com/auth/account-pending");
  assert.equal(platformAudienceHomeRoute("app.evoadmissions.com", "student", "/portal"), "/portal");
  assert.equal(platformAudienceHomeRoute("crm.evoadmissions.com", "staff", "/v3/calendar"), "/v3/calendar");
  assert.equal(platformAudienceHomeRoute("127.0.0.1:31457", "staff", "/v3/main"), "/v3/main");
  assert.equal(platformAudienceHomeRoute("127.0.0.1:31457", "student", "/portal"), "/portal");
  assert.equal(new URL(platformAudienceHomeRoute("app.evoadmissions.com", "staff", "//attacker.invalid")).origin, PRODUCTION_STAFF_ORIGIN);
  const proxy = source("src/proxy.ts");
  assert.match(proxy, /canonicalPlatformPageOrigin\(request.headers.get\("host"\), path\)/u);
  assert.match(proxy, /if \(request.method !== "GET" && request.method !== "HEAD"\) return hiddenNotFound\(id\)/u);
  assert.match(proxy, /target.search = request.nextUrl.search/u);
  assert.match(proxy, /response.headers.set\("Referrer-Policy", "no-referrer"\)/u);
});

test("retired Student preview is absent on both audiences and hidden before authentication", () => {
  const id = "b6214cbe-6d08-4a33-86b4-cdf5cc6ca5e2";
  for (const path of [
    "/preview/student",
    "/preview/student/documents",
    "/preview/student/applications",
    "/preview/student/payments",
    "/preview/student/notifications",
    "/preview/student/universities",
    `/preview/student/universities/${id}`,
    "/preview/student/tests",
    "/preview/student/tests/english",
    "/preview/student/tests/career",
    "/preview/student/",
    "/preview/student//tests",
    "/preview/student/tests/english/submit",
    "/preview/student/universities/manage",
    `/preview/student/universities/${id}/edit`,
  ]) {
    assert.equal(isRetiredPlatformRoute(path), true, path);
    assert.equal(isConnectedPlatformPage(path), false, path);
    assert.equal(isConnectedStudentPortalPage(path), false, path);
    assert.equal(isConnectedStudentPortalApi(path, "POST"), false, path);
    for (const host of ["crm.evoadmissions.com", "app.evoadmissions.com"]) {
      assert.equal(canonicalPlatformPageOrigin(host, path), null, `${host}${path}`);
    }
  }
  for (const path of [
    "/preview", "/preview/student/", "/preview/Student", "/preview/student//tests",
    "/preview/student/profile", "/preview/student/documents/upload",
    "/preview/student/tests/history", "/preview/student/tests/english/submit",
    "/preview/student/universities/manage", "/preview/student/universities/not-an-id",
    `/preview/student/universities/${id}/edit`, "/portal/preview", "/api/preview/student",
  ]) {
    assert.equal(isConnectedPlatformPage(path), false, path);
  }
  assert.equal(isRetiredPlatformRoute("/preview/student-other"), false);
  const proxy = source("src/proxy.ts");
  const retiredCheck = proxy.indexOf("isRetiredPlatformRoute(path)");
  assert.ok(retiredCheck >= 0);
  assert.ok(retiredCheck < proxy.indexOf('canonicalPlatformPageOrigin(request.headers.get("host"), path)'));
  assert.ok(retiredCheck < proxy.indexOf("await liveSessionState("));
});

test("only the exact V3 pages enter the active staff page contract", () => {
  for (const path of [
    "/",
    "/login",
    "/auth/staff",
    "/access-denied",
    "/platform-pending",
    "/v3",
    ...FIXED_ROLE_ROUTES,
  ]) {
    assert.equal(isConnectedPlatformPage(path), true, path);
  }

  for (const path of [
    "/v3/unknown",
    "/v3/main/child",
    "/v3//main",
    "/v3/Profile",
  ]) {
    assert.equal(isConnectedPlatformPage(path), false, path);
  }
});

test("university template workspace is an exact staff page, never Student or preview", () => {
  const id = "b6214cbe-6d08-4a33-86b4-cdf5cc6ca5e2";
  assert.equal(isConnectedPlatformPage(`/v3/universities/${id}/forms`), true);
  assert.equal(isConnectedStudentPortalPage(`/v3/universities/${id}/forms`), false);
  for (const path of [`/v3/universities/${id}/forms/`, `/v3/universities/${id}/forms/edit`,
    "/v3/universities/invalid/forms", `/portal/universities/${id}/forms`, `/preview/student/universities/${id}/forms`]) {
    assert.equal(isConnectedPlatformPage(path), false, path);
    assert.equal(isConnectedStudentPortalPage(path), false, path);
  }
});

test("the active V3 route policy exposes each exact presentation interface", () => {
  for (const role of ["admin", "sales", "admissions"]) {
    assert.equal(fixedRoleCanAccessRoute(role, "/v3/inbox"), true, role);
    assert.equal(fixedRoleCanAccessRoute(role, "/v3/profile"), true, role);
  }

  for (const route of ["/v3/main", "/v3/pipeline"]) {
    assert.equal(fixedRoleCanAccessRoute("admin", route), true, route);
    assert.equal(fixedRoleCanAccessRoute("sales", route), true, route);
  }
  // «Мой день» gives admissions its own /v3/main dashboard; pipeline stays sales-only.
  assert.equal(fixedRoleCanAccessRoute("admissions", "/v3/main"), true);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/v3/pipeline"), false);

  assert.equal(fixedRoleCanAccessRoute("admin", "/v3/calendar"), true);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/v3/calendar"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/v3/calendar"), false);

  for (const role of ["admin", "sales", "admissions"]) {
    assert.equal(fixedRoleCanAccessRoute(role, "/v3/knowledge"), role === "admin", role);
  }

  assert.equal(fixedRoleCanAccessRoute("admin", "/v3/settings"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/v3/settings"), false);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/v3/settings"), false);

  // Unified workflow S1: «Заявки» is Продажи-only (sales.read), replacing the
  // retired /v3/admissions-requests (admissions.read). Admissions has no
  // sales.read at all, so it stays denied even though the intake queue used
  // to live in its own worklist.
  assert.equal(fixedRoleCanAccessRoute("admin", "/v3/requests"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/v3/requests"), true);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/v3/requests"), false);
});

test("the retired /v3/admissions-requests route stays connected for old links but leaves the fixed-role capability contract", () => {
  // "keep the route so old links work" (unified workflow S1): the page itself
  // is an unconditional redirect to /v3/requests and no longer needs its own
  // FixedRoleRoute/capability entry — isConnectedPlatformPage covers the
  // proxy allowlist, which is the only gate that still matters for it.
  assert.equal(isConnectedPlatformPage("/v3/admissions-requests"), true);
  assert.equal(FIXED_ROLE_ROUTES.includes("/v3/admissions-requests"), false);
  assert.equal(FIXED_ROLE_ROUTES.includes("/v3/requests"), true);
});

test("university routes admit only catalogue, management and bounded detail paths", () => {
  const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  for (const path of ["/v3/universities", "/v3/universities/manage", `/v3/universities/${id}`, "/portal/universities", `/portal/universities/${id}`]) {
    assert.equal(isConnectedPlatformPage(path), true, path);
  }
  for (const path of ["/v3/universities/manage/extra", "/portal/universities/manage", "/v3/universities/not-an-id", `/portal/universities/${id}/edit`]) {
    assert.equal(isConnectedPlatformPage(path), false, path);
  }
  assert.equal(isConnectedStudentPortalPage(`/portal/universities/${id}`), true);
  assert.equal(isConnectedStudentPortalPage("/v3/universities/manage"), false);
});

test("Student Portal and auth-only routes are exact and disjoint from tombstones", () => {
  assert.equal(isConnectedStudentAuthPage("/auth/staff"), false);
  assert.equal(isConnectedStudentPortalPage("/auth/staff"), false);
  assert.equal(isConnectedPlatformPage("/auth/staff/extra"), false);
  const portalRoutes = [
    "/portal",
    // PORT-9c: «Главная» кабинета.
    "/portal/home",
    "/portal/documents",
    "/portal/applications",
    "/portal/payments",
    "/portal/notifications",
    "/portal/tests",
    "/portal/tests/english",
    "/portal/tests/career",
    // Подключены релизом d1b64849 (миграции 195/196): экраны существуют,
    // но не были внесены в allowlist прокси — этот hotfix закрывает разрыв.
    "/portal/favorites",
    "/portal/profile",
    "/portal/english",
    "/portal/english/review",
    "/portal/professions",
    // PORT-5c: сообщения по делу (assisted; граница — RPC миграции 200).
    "/portal/messages",
  ];
  const authRoutes = [
    "/auth/callback",
    "/auth/set-password",
    "/auth/account-pending",
  ];

  for (const path of portalRoutes) {
    assert.equal(isConnectedStudentPortalPage(path), true, path);
    assert.equal(isConnectedStudentAuthPage(path), false, path);
    assert.equal(isConnectedPlatformPage(path), true, path);
    assert.equal(isRetiredPlatformRoute(path), false, path);
  }
  for (const path of authRoutes) {
    assert.equal(isConnectedStudentAuthPage(path), true, path);
    assert.equal(isConnectedStudentPortalPage(path), false, path);
    assert.equal(isConnectedPlatformPage(path), true, path);
    assert.equal(isRetiredPlatformRoute(path), false, path);
  }
  // PORT-4c: uuid-детали урока и профессии — ровно один сегмент-id.
  const detailId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  for (const path of [
    `/portal/english/lesson/${detailId}`,
    `/portal/professions/${detailId}`,
  ]) {
    assert.equal(isConnectedStudentPortalPage(path), true, path);
    assert.equal(isConnectedPlatformPage(path), true, path);
  }

  for (const path of [
    "/portal/",
    "/portal/profile/child",
    "/portal/documents/child",
    "/portal/tests/unknown",
    "/portal/tests/english/child",
    "/portal/english/lesson/not-an-id",
    `/portal/english/lesson/${detailId}/child`,
    "/portal/professions/not-an-id",
    `/portal/professions/${detailId}/edit`,
    "/portal/messages/child",
    "/auth/callback/",
    "/auth/set-password/child",
    "/auth/unknown",
  ]) {
    assert.equal(isConnectedStudentPortalPage(path), false, path);
    assert.equal(isConnectedStudentAuthPage(path), false, path);
    assert.equal(isConnectedPlatformPage(path), false, path);
  }
});

test("root and V3 entry share the exact role-home policy", () => {
  assert.equal(platformHomeRoute({ systemRole: "admin", presentationRole: "admin" === "admin" ? null : "admin", permissionKeys: [] }), "/v3/main");
  assert.equal(platformHomeRoute({ systemRole: "admin", presentationRole: "sales" === "admin" ? null : "sales", permissionKeys: [] }), "/v3/main");
  assert.equal(platformHomeRoute({ systemRole: "admin", presentationRole: "admissions" === "admin" ? null : "admissions", permissionKeys: [] }), "/v3/main");

  for (const path of ["src/app/page.tsx", "src/app/(v3)/v3/page.tsx"]) {
    const entry = source(path);
    assert.match(entry, /staffHomeRoute\(actor\)/, path);
    assert.doesNotMatch(entry, /\/sales|\/clients/, path);
  }
});

test("V3 pages guard presentation access before loading their workspace", () => {
  const pageRoutes = new Map([
    ["main", "/v3/main"],
    ["pipeline", "/v3/pipeline"],
    ["inbox", "/v3/inbox"],
    ["calendar", "/v3/calendar"],
    ["knowledge", "/v3/knowledge"],
    ["settings", "/v3/settings"],
  ]);

  for (const [page, route] of pageRoutes) {
    const pageSource = source(`src/app/(v3)/v3/${page}/page.tsx`);
    assert.match(
      pageSource,
      new RegExp(`requireV3PageActor\\(\"${route.replaceAll("/", "\\/")}\"\\)`),
      route,
    );
  }

  const pipeline = source("src/app/(v3)/v3/pipeline/page.tsx");
  assert.match(pipeline, /actor=\{actor\}/);
  assert.doesNotMatch(pipeline, /actorRole=\{actor\.authorityRole\}/);

  const guards = source("src/lib/platform-guards.ts");
  assert.match(
    guards,
    /staffCanAccessRoute\(actor, route\)/,
  );
  assert.match(guards, /staffCan\(actor, capability\)/);
});

test("access denial is a V3 surface and recovers only through active routes", () => {
  const denied = source("src/app/(v3)/access-denied/page.tsx");
  assert.match(denied, /requirePlatformStaffActor\(\)/);
  assert.match(denied, /staffCanAccessRoute\(actor/);
  assert.match(denied, /staffHomeRoute\(actor\)/);
  assert.doesNotMatch(denied, /@\/lib\/auth|@\/lib\/domain|ROLE_HOME_ROUTE/);
});

test("retired staff roots are hidden tombstones before auth", () => {
  for (const root of [
    "/dashboard",
    "/sales",
    "/clients",
    "/applications",
    "/documents",
    "/visa",
    "/finance",
    "/tasks",
    "/settings",
    "/portal/legacy",
    "/calls",
    "/chat",
    "/whatsapp",
    "/notifications",
    "/reports",
  ]) {
    assert.equal(isConnectedPlatformPage(root), false, root);
    assert.equal(isRetiredPlatformRoute(root), true, root);
    assert.equal(isRetiredPlatformRoute(`${root}/anything`), true, root);
  }

  const proxy = source("src/proxy.ts");
  const tombstone = proxy.indexOf("isRetiredPlatformRoute(path)");
  const routeBlock = proxy.indexOf(
    "if (!isConnectedPlatformPage(path) && !isConnectedPlatformApi(path))",
  );
  const liveSession = proxy.indexOf(
    "const session = await liveSessionState(request, requestHeaders)",
  );
  assert.ok(tombstone >= 0 && tombstone < routeBlock);
  assert.ok(routeBlock < liveSession);
});

test("only the exact canonical audit export enters the browser API contract", () => {
  assert.equal(isConnectedPlatformApi("/api/platform-audit/export"), true);
  assert.equal(isConnectedPlatformPrivateApi("/api/platform-audit/export"), false);
  for (const path of [
    "/api/platform-audit/export/",
    "/api/platform-audit/export.csv",
    "/api/platform-audit",
  ]) {
    assert.equal(isConnectedPlatformApi(path), false, path);
  }
});

test("only exact private document and company-file APIs are connected", () => {
  const documentSlotId = "10000000-0000-4000-8000-000000000001";
  const documentVersionId = "20000000-0000-4000-8000-000000000002";
  const companyFileId = "30000000-0000-4000-8000-000000000003";
  const companyVersionId = "40000000-0000-4000-8000-000000000004";

  for (const path of [
    `/api/v2/document-slots/${documentSlotId}/versions`,
    `/api/v2/document-versions/${documentVersionId}/download`,
    `/api/v3/company-files/${companyFileId}/versions`,
    `/api/v3/company-file-versions/${companyVersionId}/download`,
  ]) {
    assert.equal(isConnectedPlatformApi(path), true, path);
  }

  for (const path of [
    "/api/v2/documents",
    "/api/v2/document-slots/not-a-uuid/versions",
    `/api/v2/document-slots/${documentSlotId}/versions/`,
    "/api/v3/company-files",
    "/api/v3/company-files/not-a-uuid/versions",
    `/api/v3/company-file-versions/${companyVersionId}/download/`,
  ]) {
    assert.equal(isConnectedPlatformApi(path), false, path);
  }
});

test("retired transient Student Profile export is not an active API", () => {
  const path = "/api/v3/student-cases/10000000-0000-4000-8000-000000000001/profile-exports";
  assert.equal(isConnectedPlatformApi(path), false);
  assert.equal(isConnectedPlatformPrivateApi(path), false);
  assert.equal(isConnectedStudentPortalApi(path, "POST"), false);
  assert.equal(isConnectedPlatformApi(`${path}/`), false);
  assert.equal(isConnectedPlatformApi("/api/v3/student-cases/not-a-uuid/profile-exports"), false);
  assert.equal(isConnectedPlatformApi("/api/v3/student-cases"), false);
});

test("saved document artifacts use exact staff case and artifact routes, never Student APIs", () => {
  const root = "/api/v3/student-cases/10000000-0000-4000-8000-000000000001/document-exports";
  const artifact = "20000000-0000-4000-8000-000000000002";
  for (const path of [root, `${root}/${artifact}/download`, `${root}/${artifact}/reconcile`]) {
    assert.equal(isConnectedPlatformApi(path), true, path);
    assert.equal(isConnectedPlatformPrivateApi(path), false, path);
    for (const method of ["GET", "POST"]) assert.equal(isConnectedStudentPortalApi(path, method), false, path);
    assert.equal(isConnectedPlatformApi(`${path}/`), false);
  }
  for (const path of [`${root}/all`, `${root}/${artifact}`, `${root}/${artifact}/delete`, `${root}/invalid/download`,
    "/api/v3/student-cases/invalid/document-exports"]) assert.equal(isConnectedPlatformApi(path), false, path);
});

test("Student document APIs admit only the exact path and HTTP method", () => {
  const documentSlotId = "10000000-0000-4000-8000-000000000001";
  const documentVersionId = "20000000-0000-4000-8000-000000000002";

  assert.equal(
    isConnectedStudentPortalApi(
      `/api/portal/document-slots/${documentSlotId}/versions`,
      "POST",
    ),
    true,
  );
  assert.equal(
    isConnectedStudentPortalApi(
      `/api/portal/document-versions/${documentVersionId}/download`,
      "GET",
    ),
    true,
  );

  for (const [path, method] of [
    [`/api/portal/document-slots/${documentSlotId}/versions`, "GET"],
    [`/api/portal/document-versions/${documentVersionId}/download`, "POST"],
    [`/api/portal/document-slots/${documentSlotId}/versions/`, "POST"],
    ["/api/portal/document-slots/not-a-uuid/versions", "POST"],
    ["/api/portal/document-versions/00000000-0000-0000-0000-000000000000/download", "GET"],
    [`/api/portal/document-versions/${documentVersionId}/download/child`, "GET"],
  ]) {
    assert.equal(isConnectedStudentPortalApi(path, method), false, `${method} ${path}`);
  }

  const proxy = source("src/proxy.ts");
  const studentApiBranch = proxy.indexOf("if (studentPortalApi)");
  const genericStaffApiDenial = proxy.indexOf('if (session.state !== "staff")');
  assert.ok(studentApiBranch >= 0 && studentApiBranch < genericStaffApiDenial);
  const studentOnlyBranch = proxy.slice(studentApiBranch, genericStaffApiDenial);
  assert.match(studentOnlyBranch, /session\.state === "student"/u);
  assert.match(
    studentOnlyBranch,
    /NextResponse\.json\(\{ error: "forbidden" \}, \{ status: 403 \}\)/u,
  );
});

test("only the canonical WhatsApp inbound and private recovery routes enter the contract", () => {
  assert.equal(isConnectedPlatformApi("/api/v2/whatsapp/inbound"), true);
  assert.equal(
    isConnectedPlatformApi("/api/internal/platform-messaging/waha/work"),
    true,
  );

  for (const path of [
    "/api/v2/whatsapp/inbound/",
    "/api/internal/platform-messaging/waha/events",
    "/api/internal/platform-messaging/waha/work/",
    "/api/internal/lead-agent/whatsapp",
    "/api/webhooks/waha",
    "/api/webhooks/whatsapp",
  ]) {
    assert.equal(isConnectedPlatformApi(path), false, path);
  }
});

test("proxy hands a present-Authorization student document request to its fail-closed handler", () => {
  const proxy = source("src/proxy.ts");

  // PORT-8a (ADR 0030 «Решение» п. 2): the bearer pass-through exists exactly
  // once, is scoped to the two connected student document APIs, and returns
  // straight to the handler without running the cookie session gate.
  const passThroughPattern =
    /if \(studentPortalApi && request\.headers\.has\("authorization"\)\) \{[^{}]*return setResponseHeaders\(nextResponse\(requestHeaders\), id\);\s*\}/u;
  assert.match(proxy, passThroughPattern);
  assert.equal(proxy.split('request.headers.has("authorization")').length, 2);

  const bearerBranch = proxy.search(passThroughPattern);
  const cookieSessionGate = proxy.indexOf(
    "const session = await liveSessionState(request, requestHeaders);",
  );
  const studentApiCookieBranch = proxy.indexOf("if (studentPortalApi)");
  assert.ok(cookieSessionGate >= 0);
  assert.ok(
    bearerBranch >= 0 && bearerBranch < cookieSessionGate,
    "a present Authorization header must never reach the cookie session gate",
  );
  assert.ok(
    studentApiCookieBranch > cookieSessionGate,
    "requests without the header keep the unchanged cookie gate",
  );
});
