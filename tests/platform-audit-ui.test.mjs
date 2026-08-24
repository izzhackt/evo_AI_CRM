import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
const actionsSource = readFileSync(
  new URL("../src/lib/actions.ts", import.meta.url),
  "utf8",
);
const scenarioSource = readFileSync(
  new URL("../scripts/scenarios/admissions-crm.mjs", import.meta.url),
  "utf8",
);
const legacyWahaQrRoute = new URL(
  "../src/app/api/waha/qr/route.ts",
  import.meta.url,
);
const legacyWahaQrComponent = new URL(
  "../src/components/WahaQr.tsx",
  import.meta.url,
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

test("fixture Settings awaits the isolated legacy renderer before returning raw form HTML", () => {
  assert.match(
    entrySource,
    /const \{ renderLegacySettingsPage \} = await import\("\.\/LegacySettingsPage"\)/,
  );
  assert.match(
    entrySource,
    /return renderLegacySettingsPage\(\{[\s\S]*searchParams: Promise\.resolve\(params\)[\s\S]*\}\)/,
  );
  assert.doesNotMatch(entrySource, /return <LegacySettingsPage/);
  assert.match(
    legacySource,
    /export async function renderLegacySettingsPage\(/,
  );
});

test("fixture Settings cannot configure a competing WAHA session or webhook", () => {
  assert.match(legacySource, /data-testid="legacy-waha-server-managed"/);
  assert.match(legacySource, /evo-inbox/);
  assert.match(
    legacySource,
    /\/api\/internal\/platform-messaging\/waha\/events/,
  );
  assert.doesNotMatch(
    legacySource,
    /name="(?:wa_(?:provider|token|phone_id|verify_token|app_secret)|waha_(?:account_name|base_url|session_name|webhook_url|api_key|webhook_secret)|lead_agent_sync_secret)"/,
  );
  assert.doesNotMatch(
    legacySource,
    /startWahaSessionAction|<WahaQr|crm_primary|evo-lead-agent:8000\/webhooks\/waha/,
  );
});

test("current main contains no legacy WAHA QR or SQLite session control path", () => {
  assert.equal(existsSync(legacyWahaQrRoute), false);
  assert.equal(existsSync(legacyWahaQrComponent), false);
  assert.doesNotMatch(actionsSource, /startWahaSessionAction|upsertWahaAccount/);
  assert.doesNotMatch(
    actionsSource,
    /"(?:wa_(?:provider|token|phone_id|verify_token|app_secret)|waha_(?:account_name|base_url|session_name|webhook_url|api_key|webhook_secret)|lead_agent_sync_secret)"/,
  );
});

test("CRM scenarios prove the server-managed WAHA boundary instead of legacy setup", () => {
  assert.match(scenarioSource, /server-managed `evo-inbox`/);
  assert.match(scenarioSource, /legacy WAHA QR route status/);
  assert.doesNotMatch(
    scenarioSource,
    /waha_account_name:|waha_webhook_secret:|session: "crm_primary"/,
  );
  assert.match(
    legacySource,
    /data-testid="legacy-amocrm-check"/,
  );
  assert.match(
    scenarioSource,
    /data-testid=\\"legacy-amocrm-check\\"/,
  );
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

test("connected staff navigation always opens Admin staff settings", () => {
  assert.match(
    layoutSource,
    /CONNECTED_STAFF_ROUTES[\s\S]*"\/settings"/,
  );
  assert.match(
    layoutSource,
    /PLATFORM_STAFF_SETTINGS_HREF = "\/settings\?tab=staff"/,
  );
  assert.match(
    layoutSource,
    /provider\.connectedRoutesOnly && href === "\/settings"[\s\S]*PLATFORM_STAFF_SETTINGS_HREF/,
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
