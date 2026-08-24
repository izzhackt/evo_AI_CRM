import assert from "node:assert/strict";
import test from "node:test";

import {
  isConnectedPlatformApi,
  isConnectedPlatformAuditSettingsRequest,
  isConnectedPlatformPage,
  isConnectedPlatformSettingsRequest,
  isConnectedPlatformStaffSettingsRequest,
} from "../src/lib/platform-route-contract.ts";
import { isPlatformP7AAuditEnabled } from "../src/lib/platform-audit-config.ts";

test("P7A stays fail-closed unless its exact flag is enabled", () => {
  assert.equal(isPlatformP7AAuditEnabled({}), false);
  assert.equal(
    isPlatformP7AAuditEnabled({ EVO_PLATFORM_P7A_AUDIT_ENABLED: "0" }),
    false,
  );
  assert.equal(
    isPlatformP7AAuditEnabled({ EVO_PLATFORM_P7A_AUDIT_ENABLED: "true" }),
    false,
  );
  assert.equal(
    isPlatformP7AAuditEnabled({ EVO_PLATFORM_P7A_AUDIT_ENABLED: "1" }),
    true,
  );
});

test("only the exact audit settings query is connected for P7A", () => {
  assert.equal(isConnectedPlatformPage("/settings"), true);
  assert.equal(
    isConnectedPlatformAuditSettingsRequest(
      "/settings",
      new URLSearchParams("tab=audit"),
    ),
    true,
  );

  for (const [path, query] of [
    ["/settings/", "tab=audit"],
    ["/settings/audit", "tab=audit"],
    ["/settings", ""],
    ["/settings", "tab=integrations"],
    ["/settings", "tab=audit&tab=audit"],
    ["/settings", "tab=audit&organization_id=11111111-1111-4111-8111-111111111111"],
  ]) {
    assert.equal(
      isConnectedPlatformAuditSettingsRequest(
        path,
        new URLSearchParams(query),
      ),
      false,
      `${path}?${query} must remain disconnected`,
    );
  }
});

test("staff settings stay connected independently of the P7A audit flag", () => {
  const staffQuery = new URLSearchParams("tab=staff");
  assert.equal(
    isConnectedPlatformStaffSettingsRequest("/settings", staffQuery),
    true,
  );
  assert.equal(
    isConnectedPlatformSettingsRequest("/settings", staffQuery, {
      auditEnabled: false,
    }),
    true,
  );
  assert.equal(
    isConnectedPlatformSettingsRequest("/settings", staffQuery, {
      auditEnabled: true,
    }),
    true,
  );
  assert.equal(
    isConnectedPlatformSettingsRequest(
      "/settings",
      new URLSearchParams("tab=audit"),
      { auditEnabled: false },
    ),
    false,
  );
  assert.equal(
    isConnectedPlatformSettingsRequest(
      "/settings",
      new URLSearchParams("tab=audit"),
      { auditEnabled: true },
    ),
    true,
  );
});

test("P7A connects one exact browser API path and no descendants", () => {
  assert.equal(isConnectedPlatformApi("/api/platform-audit/export"), true);
  assert.equal(isConnectedPlatformApi("/api/platform-audit/export/"), false);
  assert.equal(isConnectedPlatformApi("/api/platform-audit"), false);
  assert.equal(isConnectedPlatformApi("/api/platform-audit/export/preview"), false);
  assert.equal(isConnectedPlatformApi("/api/platform-audit/export.csv"), false);
});
