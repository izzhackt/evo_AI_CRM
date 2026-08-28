import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isConnectedPlatformApi,
  isConnectedPlatformPage,
  isConnectedPlatformSettingsRequest,
  platformHomeRoute,
} from "../src/lib/platform-route-contract.ts";

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
