import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fixedRoleCanAccessRoute } from "../src/lib/fixed-role-policy.ts";
import {
  isConnectedPlatformApi,
  isConnectedPlatformPage,
  isConnectedPlatformSettingsRequest,
  isRetiredPlatformRoute,
  platformHomeRoute,
} from "../src/lib/platform-route-contract.ts";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const privateDocumentsPanelSource = source(
  "src/components/platform/documents/PlatformPrivateDocumentsPanel.tsx",
);
const student360Source = source(
  "src/app/(staff)/clients/[id]/StudentCaseWorkspace.tsx",
);
const canonicalDocumentsQueueSource = source(
  "src/app/(staff)/documents/(queue)/page.tsx",
);
const canonicalDocumentsLayoutSource = source(
  "src/app/(staff)/documents/layout.tsx",
);
const staffLayoutSource = source("src/app/(staff)/layout.tsx");

test("visa and finance queues use the fixed Admissions read boundary", () => {
  for (const route of ["/visa", "/finance"]) {
    assert.equal(fixedRoleCanAccessRoute("admissions", route), true, route);
    assert.equal(fixedRoleCanAccessRoute("admin", route), true, route);
    assert.equal(fixedRoleCanAccessRoute("sales", route), false, route);
  }
});

test("only the read-only admissions operations queues enter the page contract", () => {
  assert.equal(isConnectedPlatformPage("/applications"), true);
  assert.equal(isConnectedPlatformPage("/documents"), true);
  assert.equal(isConnectedPlatformPage("/visa"), true);
  assert.equal(isConnectedPlatformPage("/finance"), true);

  const id = "10000000-0000-4000-8000-000000000001";
  for (const path of [
    `/applications/${id}`,
    `/documents/${id}`,
    "/documents/3",
    `/visa/${id}`,
    `/finance/${id}`,
  ]) {
    assert.equal(isConnectedPlatformPage(path), false, path);
  }
});

test("the Supabase dashboard is connected for every staff role", () => {
  assert.equal(isConnectedPlatformPage("/dashboard"), true);
  for (const role of ["admin", "sales", "admissions"]) {
    assert.equal(fixedRoleCanAccessRoute(role, "/dashboard"), true, role);
  }
});

test("the namespaced V3 product surface is connected without opening descendants", () => {
  for (const path of [
    "/v3",
    "/v3/main",
    "/v3/pipeline",
    "/v3/inbox",
    "/v3/profile",
    "/v3/settings",
    "/v3/knowledge",
    "/v3/calendar",
  ]) {
    assert.equal(isConnectedPlatformPage(path), true, path);
  }
  for (const path of ["/v3/unknown", "/v3/unknown/child", "/v3//main", "/v3/Profile"]) {
    assert.equal(isConnectedPlatformPage(path), false, path);
  }
});

test("removed parallel pages stay outside the successor and stop before runtime", () => {
  for (const path of [
    "/reports",
    "/notifications",
    "/calls",
    "/chat",
    "/chat/1",
    "/whatsapp",
    "/whatsapp/10000000-0000-4000-8000-000000000001",
    "/sales/10000000-0000-4000-8000-000000000001",
    "/sales/10000000-0000-4000-8000-000000000001/conversations/20000000-0000-4000-8000-000000000002",
  ]) {
    assert.equal(isConnectedPlatformPage(path), false, path);
    assert.equal(isRetiredPlatformRoute(path), true, path);
  }

  for (const path of [
    "/api/database/status",
    "/api/database/status/details",
    "/api/webhooks/telephony",
    "/api/webhooks/telephony/retry",
  ]) {
    assert.equal(isRetiredPlatformRoute(path), true, path);
  }
  assert.equal(isRetiredPlatformRoute("/portal"), false);
  assert.equal(isRetiredPlatformRoute("/api/health"), false);
  assert.equal(isRetiredPlatformRoute("/sales"), false);
  assert.equal(isRetiredPlatformRoute("/sales/not-a-uuid"), false);

  const proxy = source("src/proxy.ts");
  const tombstone = proxy.indexOf("isRetiredPlatformRoute(path)");
  const routeBlock = proxy.indexOf(
    "if (!isConnectedPlatformPage(path) && !isConnectedPlatformApi(path))",
  );
  const liveSession = proxy.indexOf(
    "const session = await liveSessionState(request, requestHeaders)",
  );
  assert.notEqual(tombstone, -1);
  assert.notEqual(routeBlock, -1);
  assert.notEqual(liveSession, -1);
  assert.ok(tombstone < routeBlock);
  assert.ok(routeBlock < liveSession);
});

test("documents queue uses the fixed Admissions read boundary", () => {
  assert.equal(fixedRoleCanAccessRoute("admissions", "/documents"), true);
  assert.equal(fixedRoleCanAccessRoute("admin", "/documents"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/documents"), false);
});

test("Student 360 is the one canonical private-document write surface", () => {
  assert.match(student360Source, /getPlatformCaseDocumentWorkspace\(actor, id\)/);
  assert.match(student360Source, /<PlatformPrivateDocumentsPanel/);
  assert.match(privateDocumentsPanelSource, /id="case-documents"/);
  assert.match(
    privateDocumentsPanelSource,
    /data-testid="platform-private-documents"/,
  );
  assert.match(
    privateDocumentsPanelSource,
    /data-testid="platform-document-upload-form"/,
  );
  assert.match(
    privateDocumentsPanelSource,
    /data-testid="platform-document-slot"/,
  );
  assert.match(
    privateDocumentsPanelSource,
    /data-testid="platform-document-version"/,
  );
  assert.match(
    privateDocumentsPanelSource,
    /data-testid="platform-document-download"/,
  );
  assert.match(
    privateDocumentsPanelSource,
    /data-document-slot-id=\{slot\.documentSlotId\}/,
  );
  assert.match(
    privateDocumentsPanelSource,
    /version\.documentVersionId/,
  );
  assert.match(
    privateDocumentsPanelSource,
    /data-version-number=\{version\.versionNumber\}/,
  );
  assert.match(privateDocumentsPanelSource, /\/api\/v2\/document-slots\//);
  assert.match(
    privateDocumentsPanelSource,
    /\/api\/v2\/document-versions\//,
  );
  assert.match(privateDocumentsPanelSource, /router\.refresh\(\)/);
  assert.match(privateDocumentsPanelSource, /const ACCEPTED_FILE_TYPES = \["application\/pdf", "image\/jpeg", "image\/png"\]/);
  assert.match(privateDocumentsPanelSource, /accept=\{ACCEPTED_FILE_TYPES\.join\(","\)\}/);
  assert.match(privateDocumentsPanelSource, /25 MiB/);
  assert.doesNotMatch(
    privateDocumentsPanelSource,
    /objectKey|private-document-repository|drizzle|sqlite|fallback/i,
  );
});

test("the documents route is a read-only Platform queue linked to Student 360", () => {
  assert.match(canonicalDocumentsQueueSource, /requirePlatformDocumentsActor\(\)/);
  assert.match(
    canonicalDocumentsQueueSource,
    /listPlatformDocumentQueue\(actor\)/,
  );
  assert.match(
    canonicalDocumentsQueueSource,
    /`\/clients\/\$\{row\.studentCaseId\}#case-documents`/,
  );
  assert.doesNotMatch(
    canonicalDocumentsQueueSource,
    /<form|listDocumentsForActor|@\/lib\/queries|@\/lib\/db|\/documents\/\$\{/i,
  );
  assert.match(
    canonicalDocumentsLayoutSource,
    /requirePlatformDocumentsActor\(\)/,
  );
  assert.match(staffLayoutSource, /new Set\(FIXED_ROLE_ROUTES\)/);
  assert.doesNotMatch(staffLayoutSource, /CONNECTED_STAFF_ROUTES/);
});

test("fixed roles resolve to their exact private workspaces", () => {
  assert.equal(platformHomeRoute("admin"), "/sales");
  assert.equal(platformHomeRoute("sales"), "/sales");
  assert.equal(platformHomeRoute("admissions"), "/clients");
  assert.equal(isConnectedPlatformPage("/portal"), false);
  assert.equal(isConnectedPlatformPage("/portal/profile"), false);
});

test("settings exposes only the V2 preview surface", () => {
  assert.equal(isConnectedPlatformPage("/settings"), true);
  assert.equal(
    isConnectedPlatformSettingsRequest("/settings", new URLSearchParams()),
    true,
  );

  for (const query of [
    "tab=staff",
    "tab=operations",
    "tab=audit",
    "role=sales",
    "tab=audit&tab=audit",
  ]) {
    assert.equal(
      isConnectedPlatformSettingsRequest(
        "/settings",
        new URLSearchParams(query),
      ),
      false,
      query,
    );
  }
  assert.equal(
    isConnectedPlatformSettingsRequest("/settings/", new URLSearchParams()),
    false,
  );
});

test("the deferred audit export is not an active V2 browser API", () => {
  assert.equal(isConnectedPlatformApi("/api/platform-audit/export"), false);

  const proxy = readFileSync(
    new URL("../src/proxy.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(proxy, /isPlatformP7AAuditEnabled/);
  assert.doesNotMatch(proxy, /isConnectedPlatformAuditExportApi/);
});

test("only the exact private document APIs enter the active V2 route contract", () => {
  const documentSlotId = "10000000-0000-4000-8000-000000000001";
  const versionId = "20000000-0000-4000-8000-000000000002";

  assert.equal(
    isConnectedPlatformApi(
      `/api/v2/document-slots/${documentSlotId}/versions`,
    ),
    true,
  );
  assert.equal(
    isConnectedPlatformApi(`/api/v2/document-versions/${versionId}/download`),
    true,
  );

  for (const path of [
    "/api/v2/documents",
    "/api/v2/document-slots/",
    "/api/v2/document-slots/not-a-uuid/versions",
    `/api/v2/document-slots/${documentSlotId}/versions/`,
    `/api/v2/document-versions/${versionId}`,
    "/private-documents/anything",
  ]) {
    assert.equal(isConnectedPlatformApi(path), false, path);
  }
});

test("only the canonical V2 WhatsApp inbound and private recovery routes enter the active contract", () => {
  assert.equal(isConnectedPlatformApi("/api/v2/whatsapp/inbound"), true);
  assert.equal(
    isConnectedPlatformApi("/api/internal/platform-messaging/waha/work"),
    true,
  );

  for (const path of [
    "/api/v2/whatsapp/inbound/",
    "/api/internal/platform-messaging/waha/events",
    "/api/internal/platform-messaging/waha/work/",
    "/api/internal/platform-messaging/waha/history",
    "/api/internal/platform-messaging/waha/media",
    "/api/internal/lead-agent/whatsapp",
    "/api/webhooks/waha",
    "/api/webhooks/whatsapp",
  ]) {
    assert.equal(isConnectedPlatformApi(path), false, path);
  }
});
