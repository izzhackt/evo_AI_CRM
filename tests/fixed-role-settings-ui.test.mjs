import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildV3Navigation } from "../src/lib/v3/navigation.ts";
import { staffCanAccessRoute } from "../src/lib/platform-access.ts";
import { staffDirectoryAccessSummary } from "../src/lib/v3/wording.ts";

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

test("V3 settings uses live staff authority and denies non-Admin routes", () => {
  assert.match(
    v3SettingsPageSource,
    /requireV3PageActor\("\/v3\/settings"\)/,
  );
  assert.match(
    guardSource,
    /staffCanAccessRoute\(actor, route\)/,
  );
  assert.doesNotMatch(v3SettingsPageSource, /LegacySettings|isUiContractFixtureMode/);
});

test("only authority Admin can set the presentation-only preview cookie", () => {
  assert.match(actionSource, /resolvePlatformActor\(\)/);
  assert.match(actionSource, /result\.actor\.systemRole/);
  assert.match(actionSource, /canAdminSelectEffectiveRole/);
  assert.match(actionSource, /ADMIN_ROLE_PREVIEW_COOKIE/);
  assert.doesNotMatch(actionSource, /updateUser|change_pilot_staff_role/);
});

test("the V3 shell renders assigned permissions and a protected Admin preview", () => {
  assert.match(shellSource, /data-testid="v3-shell"/);
  assert.match(shellSource, /data-system-role=\{actor\.systemRole\}/);
  assert.match(shellSource, /data-presentation-role=\{actor\.presentationRole \?\? "actual"\}/);
  assert.match(shellSource, /buildV3Navigation\(actor,/);
  const examples = [
    { systemRole: "admin", permissionKeys: [], presentationRole: null, settings: true, summary: true },
    { systemRole: "admin", permissionKeys: [], presentationRole: "sales", settings: false, summary: false },
    { systemRole: "admin", permissionKeys: [], presentationRole: "admissions", settings: false, summary: true },
    { systemRole: "staff", permissionKeys: ["lead.read"], presentationRole: null, settings: false, summary: false },
    { systemRole: "staff", permissionKeys: ["case.read.full"], presentationRole: null, settings: false, summary: true },
    { systemRole: "staff", permissionKeys: ["lead.read", "case.read.full"], presentationRole: null, settings: false, summary: true },
    { systemRole: "staff", permissionKeys: ["catalog.read"], presentationRole: null, settings: false, summary: false },
    { systemRole: "staff", permissionKeys: [], presentationRole: null, settings: false, summary: false },
  ];
  for (const example of examples) {
    const actor = { ...example, platformAccessVersion: 1 };
    const navigation = buildV3Navigation(actor, "/v3/profile", new URLSearchParams());
    const links = [navigation.home, ...navigation.groups.flatMap((group) => group.links), ...navigation.common, navigation.settings].filter(Boolean);
    for (const link of links) assert.ok(staffCanAccessRoute(actor, link.route), `${actor.systemRole}: ${link.href}`);
    assert.equal(Boolean(navigation.settings), example.settings);
    assert.equal(navigation.groups.some((group) => group.links.some((link) => link.id === "admissions-summary")), example.summary);
    if (actor.systemRole === "staff" && actor.permissionKeys.length === 0) assert.deepEqual(links, []);
    if (actor.permissionKeys[0] === "catalog.read") assert.deepEqual(links.map((link) => link.route), ["/v3/universities"]);
  }
  assert.match(shellSource, /systemRole === "admin"/);
  assert.doesNotMatch(shellSource, /data-testid="staff-role-preview"/);
  const roleSettingsSource = readFileSync(new URL("../src/components/v3/settings/StaffRolesSection.tsx", import.meta.url), "utf8");
  assert.match(roleSettingsSource, /data-testid="staff-role-preview"/);
  assert.match(roleSettingsSource, /Посмотреть интерфейс роли/);
  assert.match(roleSettingsSource, /action=\{selectStaffRolePreviewAction\}/);
  assert.match(shellSource, /data-testid="preview-role-admin"/);
  assert.match(shellSource, /Вернуться к Администратору/);
  assert.match(shellSource, /selectStaffRolePreviewAction/);
  assert.match(shellSource, /logoutStaffAction/);
  assert.match(shellSource, /data-testid="staff-logout"/);
  assert.doesNotMatch(shellSource, /Legacy|Connected|isUiContractFixtureMode/);
});

test("directory labels use assigned roles and reject mismatched access snapshots", () => {
  const member = { membershipId: "member-a", version: 3 };
  const access = { membershipId: "member-a", accessVersion: 3, systemRole: "staff",
    assignments: [{ label: "Куратор Китая" }, { label: "Продажи" }, { label: "Куратор Китая" }] };
  assert.equal(staffDirectoryAccessSummary(member, access), "Куратор Китая, Продажи");
  assert.equal(staffDirectoryAccessSummary(member, { ...access, systemRole: "admin" }), "Администратор");
  assert.equal(staffDirectoryAccessSummary(member, { ...access, assignments: [] }), "Роли не назначены");
  for (const unavailable of [undefined, { ...access, accessVersion: 2 }, { ...access, membershipId: "member-b" }]) {
    assert.match(staffDirectoryAccessSummary(member, unavailable), /Обновите страницу/);
  }
});

test("V3 exposes the canonical audit export only on the Admin journal surface", () => {
  assert.match(
    v3SettingsPageSource,
    /const isAdmin = actor\.systemRole === "admin" && actor\.presentationRole === null/,
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
  assert.match(auditExportRouteSource, /actor\.actor\.systemRole !== "admin"/);
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
