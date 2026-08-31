import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settingsSource = readFileSync(
  new URL("../src/app/(staff)/settings/page.tsx", import.meta.url),
  "utf8",
);
const actionSource = readFileSync(
  new URL("../src/lib/development-gate-actions.ts", import.meta.url),
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

test("only authority Admin can reissue the same signed session for preview", () => {
  assert.match(actionSource, /currentUser\(\)/);
  assert.match(actionSource, /user\.authorityRole/);
  assert.match(actionSource, /canAdminSelectEffectiveRole/);
  assert.match(actionSource, /setSession\(user\.authorityRole, requestedRole\)/);
  assert.doesNotMatch(actionSource, /membership|organization/i);
});

test("the staff shell renders exact effective-role navigation and an Admin controller", () => {
  assert.match(layoutSource, /data-testid="staff-role-preview"/);
  assert.match(layoutSource, /provider\.user\.authorityRole === "admin"/);
  assert.match(layoutSource, /data-effective-role=\{provider\.user\.role\}/);
  assert.match(layoutSource, /selectDevelopmentRolePreviewAction/);
  assert.doesNotMatch(
    layoutSource,
    /loadFixtureShellProvider|Legacy|Connected|isUiContractFixtureMode|settings\?tab=staff/,
  );
  assert.match(layoutSource, /readCanonicalAmoCrmProviderAvailability/);
  assert.match(layoutSource, /readCanonicalWahaProviderAvailability/);
  assert.match(layoutSource, /readCanonicalGeminiProposalAvailability/);
  assert.match(layoutSource, /providerDisplayStatus/);
  assert.doesNotMatch(topBarSource, /connectedRoutesOnly|notification-menu|ADD_ROUTES/);
  assert.match(topBarSource, /integrationStatus\.ai/);
  assert.doesNotMatch(topBarSource, /<h1/);
});
