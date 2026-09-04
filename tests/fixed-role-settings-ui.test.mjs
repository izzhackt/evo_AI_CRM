import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actionSource = readFileSync(
  new URL("../src/lib/staff-auth-actions.ts", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../src/components/v3/AppShell.tsx", import.meta.url),
  "utf8",
);
const guardSource = readFileSync(
  new URL("../src/lib/platform-guards.ts", import.meta.url),
  "utf8",
);
const v3SettingsPageSource = readFileSync(
  new URL("../src/app/(v3)/v3/settings/page.tsx", import.meta.url),
  "utf8",
);
const v3SettingsSectionsSource = readFileSync(
  new URL("../src/components/v3/settings/sections.tsx", import.meta.url),
  "utf8",
);
const v3SettingsTypesSource = readFileSync(
  new URL("../src/components/v3/settings/types.ts", import.meta.url),
  "utf8",
);
const v3SettingsSource = readFileSync(
  new URL("../src/lib/v3/settings-source.ts", import.meta.url),
  "utf8",
);
const auditExportRouteSource = readFileSync(
  new URL("../src/app/api/platform-audit/export/route.ts", import.meta.url),
  "utf8",
);
const foundationHarnessSource = readFileSync(
  new URL("../scripts/test-postgres-v2-foundation.sh", import.meta.url),
  "utf8",
);

test("V3 settings is visible only in the Admin presentation interface", () => {
  assert.match(
    v3SettingsPageSource,
    /requireV3PageActor\("\/v3\/settings"\)/,
  );
  assert.match(
    guardSource,
    /fixedRoleCanAccessRoute\(actor\.presentationRole, route\)/,
  );
  assert.doesNotMatch(v3SettingsPageSource, /LegacySettings|isUiContractFixtureMode/);
});

test("only authority Admin can set the presentation-only preview cookie", () => {
  assert.match(actionSource, /resolvePlatformActor\(\)/);
  assert.match(actionSource, /result\.actor\.authorityRole/);
  assert.match(actionSource, /canAdminSelectEffectiveRole/);
  assert.match(actionSource, /ADMIN_ROLE_PREVIEW_COOKIE/);
  assert.doesNotMatch(actionSource, /updateUser|change_pilot_staff_role/);
});

test("the V3 shell renders presentation navigation and an authority-Admin controller", () => {
  assert.match(shellSource, /data-testid="v3-shell"/);
  assert.match(shellSource, /data-authority-role=\{authorityRole\}/);
  assert.match(shellSource, /data-presentation-role=\{presentationRole\}/);
  assert.match(shellSource, /fixedRoleCanAccessRoute\(presentationRole/);
  assert.match(shellSource, /authorityRole === "admin"/);
  assert.match(shellSource, /data-testid="staff-role-preview"/);
  assert.match(shellSource, /selectStaffRolePreviewAction/);
  assert.match(shellSource, /logoutStaffAction/);
  assert.match(shellSource, /data-testid="staff-logout"/);
  assert.doesNotMatch(shellSource, /Legacy|Connected|isUiContractFixtureMode/);
});

test("V3 exposes the canonical audit export only on the Admin journal surface", () => {
  assert.match(
    v3SettingsPageSource,
    /const isAdmin = actor\.presentationRole === "admin"/,
  );
  assert.match(
    v3SettingsTypesSource,
    /\{ key: "journal", title: "Журнал действий", admin: true \}/,
  );
  assert.match(v3SettingsSectionsSource, /data-testid="v3-audit-export"/);
  assert.match(v3SettingsPageSource, /normalizeJournalFilters\(\{/);
  assert.doesNotMatch(
    v3SettingsPageSource,
    /const journalFilters = \{ objectType: params\.object, role: params\.role \}/,
  );
  assert.match(v3SettingsPageSource, /auditExportEnabled=\{readAuditExportEnabled\(\)\}/);
  assert.match(v3SettingsSectionsSource, /\{exportEnabled \? \(\s*<Card title="Экспорт журнала">/);
  assert.match(v3SettingsSource, /return isPlatformP7AAuditEnabled\(environment\)/);
  assert.match(v3SettingsSectionsSource, /action="\/api\/platform-audit\/export"/);
  assert.match(auditExportRouteSource, /actor\.actor\.platformRole !== "admin"/);
  assert.match(auditExportRouteSource, /isPlatformP7AAuditEnabled\(dependencies\.env\)/);
  assert.match(
    foundationHarnessSource,
    /start_app configured unavailable blocked provider-not-authorized disabled/,
  );
  assert.match(
    foundationHarnessSource,
    /supabase_staff_auth_browser_assert audit-disabled "disabled canonical audit hides export"/,
  );
});

test("V3 posts the exact bounded export contract without inventing a role filter", () => {
  assert.match(v3SettingsSectionsSource, /method="post"/);
  assert.match(
    v3SettingsSectionsSource,
    /encType="application\/x-www-form-urlencoded"/,
  );
  assert.match(v3SettingsSectionsSource, /name="request_id" value=\{randomUUID\(\)\}/);
  assert.match(
    v3SettingsSectionsSource,
    /name="start_at" value=\{exportStartAt\.toISOString\(\)\}/,
  );
  assert.match(
    v3SettingsSectionsSource,
    /name="end_at" value=\{exportEndAt\.toISOString\(\)\}/,
  );
  assert.match(
    v3SettingsSectionsSource,
    /name="resource_types" value=\{active\.objectType\}/,
  );
  assert.doesNotMatch(v3SettingsSectionsSource, /<input[^>]+name="role"/);
  assert.match(v3SettingsSectionsSource, /30 \* 24 \* 60 \* 60 \* 1_000/);
});
