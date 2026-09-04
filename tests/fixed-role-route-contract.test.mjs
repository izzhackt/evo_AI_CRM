import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  FIXED_ROLE_ROUTES,
  fixedRoleCanAccessRoute,
} from "../src/lib/fixed-role-policy.ts";
import {
  isConnectedPlatformApi,
  isConnectedPlatformPage,
  isConnectedPlatformPrivateApi,
  isRetiredPlatformRoute,
  platformHomeRoute,
} from "../src/lib/platform-route-contract.ts";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("only the exact V3 pages enter the active staff page contract", () => {
  for (const path of [
    "/",
    "/login",
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

test("the active V3 route policy exposes each exact presentation interface", () => {
  for (const role of ["admin", "sales", "admissions"]) {
    assert.equal(fixedRoleCanAccessRoute(role, "/v3/inbox"), true, role);
    assert.equal(fixedRoleCanAccessRoute(role, "/v3/profile"), true, role);
  }

  for (const route of ["/v3/main", "/v3/pipeline"]) {
    assert.equal(fixedRoleCanAccessRoute("admin", route), true, route);
    assert.equal(fixedRoleCanAccessRoute("sales", route), true, route);
    assert.equal(fixedRoleCanAccessRoute("admissions", route), false, route);
  }

  for (const route of ["/v3/calendar", "/v3/knowledge"]) {
    assert.equal(fixedRoleCanAccessRoute("admin", route), true, route);
    assert.equal(fixedRoleCanAccessRoute("admissions", route), true, route);
    assert.equal(fixedRoleCanAccessRoute("sales", route), false, route);
  }

  assert.equal(fixedRoleCanAccessRoute("admin", "/v3/settings"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/v3/settings"), false);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/v3/settings"), false);
});

test("root and V3 entry share the exact role-home policy", () => {
  assert.equal(platformHomeRoute("admin"), "/v3/main");
  assert.equal(platformHomeRoute("sales"), "/v3/main");
  assert.equal(platformHomeRoute("admissions"), "/v3/calendar");

  for (const path of ["src/app/page.tsx", "src/app/(v3)/v3/page.tsx"]) {
    const entry = source(path);
    assert.match(entry, /fixedRoleHomeRoute\(actor\.presentationRole\)/, path);
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
  assert.match(pipeline, /actorRole=\{actor\.presentationRole\}/);
  assert.doesNotMatch(pipeline, /actorRole=\{actor\.authorityRole\}/);

  const guards = source("src/lib/platform-guards.ts");
  assert.match(
    guards,
    /fixedRoleCanAccessRoute\(actor\.presentationRole, route\)/,
  );
  assert.match(guards, /fixedRoleCan\(actor\.authorityRole, capability\)/);
});

test("access denial is a V3 surface and recovers only through active routes", () => {
  const denied = source("src/app/(v3)/access-denied/page.tsx");
  assert.match(denied, /requirePlatformStaffActor\(\)/);
  assert.match(denied, /fixedRoleCanAccessRoute\(actor\.presentationRole/);
  assert.match(denied, /fixedRoleHomeRoute\(actor\.presentationRole\)/);
  assert.doesNotMatch(denied, /@\/lib\/auth|@\/lib\/domain|ROLE_HOME_ROUTE/);
});

test("retired staff and portal roots are hidden tombstones before auth", () => {
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
    "/portal",
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
