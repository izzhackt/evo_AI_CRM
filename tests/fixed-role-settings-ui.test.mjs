import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settingsSource = readFileSync(
  new URL("../src/app/(staff)/settings/page.tsx", import.meta.url),
  "utf8",
);
const actionSource = readFileSync(
  new URL("../src/lib/staff-auth-actions.ts", import.meta.url),
  "utf8",
);
const layoutSource = readFileSync(
  new URL("../src/app/(staff)/layout.tsx", import.meta.url),
  "utf8",
);
const topBarSource = readFileSync(
  new URL("../src/components/TopBar.tsx", import.meta.url),
  "utf8",
);

test("settings is one Admin-only fixed-role preview UI", () => {
  assert.match(
    settingsSource,
    /requirePlatformCapability\("admin\.preview", "\/settings"\)/,
  );
  assert.match(settingsSource, /data-testid="fixed-role-settings"/);
  assert.match(settingsSource, /\["admin", "sales", "admissions"\]/);
  assert.doesNotMatch(
    settingsSource,
    /LegacySettings|PlatformStaffSettings|PlatformAuditSettings|PlatformOperationsSettings|isUiContractFixtureMode/,
  );
});

test("only authority Admin can set the presentation-only preview cookie", () => {
  assert.match(actionSource, /resolvePlatformActor\(\)/);
  assert.match(actionSource, /result\.actor\.authorityRole/);
  assert.match(actionSource, /canAdminSelectEffectiveRole/);
  assert.match(actionSource, /ADMIN_ROLE_PREVIEW_COOKIE/);
  assert.doesNotMatch(actionSource, /updateUser|change_pilot_staff_role/);
});

test("the staff shell renders exact effective-role navigation and an Admin controller", () => {
  assert.match(layoutSource, /data-testid="staff-role-preview"/);
  assert.match(layoutSource, /provider\.user\.authorityRole === "admin"/);
  assert.match(layoutSource, /role: actor\.presentationRole/);
  assert.match(layoutSource, /data-effective-role=\{provider\.user\.role\}/);
  assert.match(layoutSource, /selectStaffRolePreviewAction/);
  assert.doesNotMatch(
    layoutSource,
    /loadFixtureShellProvider|Legacy|Connected|isUiContractFixtureMode|settings\?tab=staff/,
  );
  assert.match(layoutSource, /readCanonicalAmoCrmProviderAvailability/);
  assert.match(layoutSource, /getPlatformWahaSessionHealth\(actor, "evo-inbox"\)/);
  assert.match(layoutSource, /readPlatformGeminiProviderAvailability/);
  assert.match(layoutSource, /platformWahaHealthDisplayStatus/);
  assert.doesNotMatch(layoutSource, /readCanonicalWahaProviderAvailability/);
  assert.doesNotMatch(layoutSource, /readCanonicalGeminiProposalAvailability/);
  assert.match(layoutSource, /providerDisplayStatus/);
  assert.doesNotMatch(topBarSource, /connectedRoutesOnly|notification-menu|ADD_ROUTES/);
  assert.match(topBarSource, /integrationStatus\.ai/);
  assert.doesNotMatch(topBarSource, /<h1/);
});
