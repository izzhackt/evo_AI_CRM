import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrySource = readFileSync(
  new URL("../src/app/(staff)/settings/page.tsx", import.meta.url),
  "utf8",
);
const platformSource = readFileSync(
  new URL("../src/app/(staff)/settings/PlatformAuditSettingsPage.tsx", import.meta.url),
  "utf8",
);
const legacySource = readFileSync(
  new URL("../src/app/(staff)/settings/LegacySettingsPage.tsx", import.meta.url),
  "utf8",
);
const layoutSource = readFileSync(
  new URL("../src/app/(staff)/layout.tsx", import.meta.url),
  "utf8",
);
const staffNavSource = readFileSync(
  new URL("../src/components/StaffNav.tsx", import.meta.url),
  "utf8",
);
const environmentExample = readFileSync(
  new URL("../.env.example", import.meta.url),
  "utf8",
);

test("connected audit settings returns before the isolated legacy SQLite module is imported", () => {
  assert.doesNotMatch(entrySource, /@\/lib\/(?:db|queries|actions|guards)/);
  assert.doesNotMatch(entrySource, /^import .*LegacySettingsPage/m);
  assert.match(entrySource, /await import\([\s\S]*"\.\/PlatformAuditSettingsPage"[\s\S]*\)/);
  assert.match(entrySource, /return <PlatformAuditSettingsPage/);
  assert.match(
    entrySource,
    /if \(!isUiContractFixtureMode\(\)\)[\s\S]*return <PlatformAuditSettingsPage[\s\S]*await import\("\.\/LegacySettingsPage"\)/,
  );

  assert.doesNotMatch(platformSource, /@\/lib\/(?:db|queries|actions|guards)/);
  assert.doesNotMatch(platformSource, /better-sqlite3|listOperationalAuditTrail|getSetting/);
  assert.match(legacySource, /@\/lib\/db/);
  assert.match(legacySource, /@\/lib\/queries/);
});

test("connected audit tab is Admin guarded and exposes only safe Platform fields", () => {
  assert.match(platformSource, /requirePlatformAuditAdminActor/);
  assert.match(platformSource, /searchPlatformAudit/);
  assert.match(platformSource, /data-testid="platform-audit-settings"/);
  assert.match(platformSource, /action="\/api\/platform-audit\/export"/);
  assert.match(platformSource, /method="post"/);
  assert.match(platformSource, /audit_event_id|auditEventId/);

  for (const privateName of [
    "before_state",
    "after_state",
    "actor_principal",
    "provider_payload",
    "object_key",
    "private_topic",
    "phone_number",
  ]) {
    assert.doesNotMatch(platformSource, new RegExp(privateName, "i"));
  }
});

test("connected staff navigation exposes the exact audit query only to Admin when P7A is enabled", () => {
  assert.match(
    layoutSource,
    /isPlatformP7AAuditEnabled\(\)[\s\S]*\["\/settings"\]/,
  );
  assert.match(
    layoutSource,
    /PLATFORM_AUDIT_SETTINGS_HREF = "\/settings\?tab=audit"/,
  );
  assert.match(
    layoutSource,
    /provider\.connectedRoutesOnly && href === "\/settings"[\s\S]*PLATFORM_AUDIT_SETTINGS_HREF/,
  );
  assert.match(layoutSource, /STAFF_NAV_ITEMS[\s\S]*allowedRoles/);
  assert.match(staffNavSource, /function navPath\(href: string\)/);
  assert.match(staffNavSource, /isCurrentPath[\s\S]*navPath\(href\)/);
  assert.equal(
    staffNavSource.match(/NAV_ICON\[navPath\(item\.href\)\]/g)?.length,
    3,
  );
});

test("P7A audit activation is documented as a server-only default-off flag", () => {
  assert.equal(
    environmentExample.match(/^EVO_PLATFORM_P7A_AUDIT_ENABLED=0$/gm)?.length,
    1,
  );
  assert.match(
    environmentExample,
    /P7A[\s\S]*Admin-only[\s\S]*safe audit[\s\S]*EVO_PLATFORM_P7A_AUDIT_ENABLED=0/,
  );
});

test("Platform audit UI contains bounded filters, stable cursor fields and accessible table text", () => {
  for (const field of [
    "start_at",
    "end_at",
    "actions",
    "resource_types",
    "resource_id",
    "page_size",
    "request_id",
  ]) {
    assert.match(platformSource, new RegExp(`name=["']${field}["']`));
  }
  for (const key of [
    "snapshot_created_at",
    "snapshot_id",
    "cursor_created_at",
    "cursor_id",
  ]) {
    assert.match(platformSource, new RegExp(`["']${key}["']`));
  }
  assert.match(platformSource, /<table/);
  assert.match(platformSource, /<caption/);
  assert.match(platformSource, /scope="col"/);
  assert.match(platformSource, /aria-live="polite"/);
});

test("P7A copy is present in Russian, Kyrgyz and English dictionaries", () => {
  const i18n = readFileSync(
    new URL("../src/lib/i18n-data.ts", import.meta.url),
    "utf8",
  );
  for (const key of [
    "platformAuditTitle",
    "platformAuditSafeProjectionHint",
    "platformAuditExportCsv",
    "platformAuditUnavailableHint",
  ]) {
    assert.equal(i18n.match(new RegExp(`\\b${key}:`, "g"))?.length, 3, key);
  }
});
