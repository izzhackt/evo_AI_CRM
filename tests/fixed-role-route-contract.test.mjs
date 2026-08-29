import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fixedRoleCanAccessRoute } from "../src/lib/fixed-role-policy.ts";
import {
  isConnectedPlatformApi,
  isConnectedPlatformPage,
  isConnectedPlatformSettingsRequest,
  platformHomeRoute,
} from "../src/lib/platform-route-contract.ts";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const privateDocumentsPanelSource = source(
  "src/components/platform/documents/CanonicalPrivateDocumentsPanel.tsx",
);
const canonicalStudent360Source = source(
  "src/app/(staff)/clients/[id]/CanonicalStudentCaseWorkspace.tsx",
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

test("documents queue uses the fixed Admissions read boundary", () => {
  assert.equal(fixedRoleCanAccessRoute("admissions", "/documents"), true);
  assert.equal(fixedRoleCanAccessRoute("admin", "/documents"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/documents"), false);
});

test("Student 360 is the one canonical private-document write surface", () => {
  assert.match(canonicalStudent360Source, /listPrivateDocumentsForCase\(\{/);
  assert.match(canonicalStudent360Source, /<CanonicalPrivateDocumentsPanel/);
  assert.match(privateDocumentsPanelSource, /id="documents"/);
  assert.match(
    privateDocumentsPanelSource,
    /data-testid="canonical-private-documents"/,
  );
  assert.match(
    privateDocumentsPanelSource,
    /data-testid="canonical-private-document-upload-form"/,
  );
  assert.match(
    privateDocumentsPanelSource,
    /data-testid="canonical-private-document"/,
  );
  assert.match(
    privateDocumentsPanelSource,
    /data-testid="canonical-private-document-resubmit-form"/,
  );
  assert.match(
    privateDocumentsPanelSource,
    /data-testid="canonical-private-document-download"/,
  );
  assert.match(
    privateDocumentsPanelSource,
    /data-document-id=\{document\.documentId\}/,
  );
  assert.match(
    privateDocumentsPanelSource,
    /data-version-id=\{version\.versionId\}/,
  );
  assert.match(
    privateDocumentsPanelSource,
    /data-version-number=\{version\.versionNumber\}/,
  );
  assert.match(privateDocumentsPanelSource, /\/api\/v2\/documents/);
  assert.match(
    privateDocumentsPanelSource,
    /\/api\/v2\/document-versions\//,
  );
  assert.match(privateDocumentsPanelSource, /router\.refresh\(\)/);
  assert.match(
    privateDocumentsPanelSource,
    /application\/pdf,image\/jpeg,image\/png/,
  );
  assert.match(privateDocumentsPanelSource, /25 MiB/);
  assert.doesNotMatch(privateDocumentsPanelSource, /objectKey|supabase|sqlite/i);
});

test("the documents route is a read-only canonical queue linked to Student 360", () => {
  assert.match(canonicalDocumentsQueueSource, /requirePlatformDocumentsActor\(\)/);
  assert.match(
    canonicalDocumentsQueueSource,
    /listPrivateDocuments\(\{\s*actorRole: actor\.platformRole/,
  );
  assert.match(
    canonicalDocumentsQueueSource,
    /`\/clients\/\$\{document\.caseId\}#documents`/,
  );
  assert.doesNotMatch(
    canonicalDocumentsQueueSource,
    /<form|listDocumentsForActor|@\/lib\/queries|@\/lib\/db|\/documents\/\$\{/i,
  );
  assert.match(
    canonicalDocumentsLayoutSource,
    /requirePlatformDocumentsActor\(\)/,
  );
  assert.match(staffLayoutSource, /CONNECTED_STAFF_ROUTES[\s\S]*"\/documents"/);
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
  const documentId = "10000000-0000-4000-8000-000000000001";
  const versionId = "20000000-0000-4000-8000-000000000002";

  assert.equal(isConnectedPlatformApi("/api/v2/documents"), true);
  assert.equal(
    isConnectedPlatformApi(`/api/v2/documents/${documentId}/resubmissions`),
    true,
  );
  assert.equal(
    isConnectedPlatformApi(`/api/v2/document-versions/${versionId}/download`),
    true,
  );

  for (const path of [
    "/api/v2/documents/",
    "/api/v2/documents/not-a-uuid/resubmissions",
    `/api/v2/documents/${documentId}/download`,
    `/api/v2/document-versions/${versionId}`,
    "/private-documents/anything",
  ]) {
    assert.equal(isConnectedPlatformApi(path), false, path);
  }
});

test("only the canonical V2 WhatsApp inbound route enters the active contract", () => {
  assert.equal(isConnectedPlatformApi("/api/v2/whatsapp/inbound"), true);

  for (const path of [
    "/api/v2/whatsapp/inbound/",
    "/api/internal/platform-messaging/waha/events",
    "/api/internal/platform-messaging/waha/work",
    "/api/internal/platform-messaging/waha/history",
    "/api/internal/platform-messaging/waha/media",
    "/api/internal/lead-agent/whatsapp",
    "/api/webhooks/waha",
    "/api/webhooks/whatsapp",
  ]) {
    assert.equal(isConnectedPlatformApi(path), false, path);
  }
});
