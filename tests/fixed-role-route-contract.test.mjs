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
