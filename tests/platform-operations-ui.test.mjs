import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const operationsPageSource = readFileSync(
  new URL(
    "../src/app/(staff)/settings/PlatformOperationsSettingsPage.tsx",
    import.meta.url,
  ),
  "utf8",
);
const guardsSource = readFileSync(
  new URL("../src/lib/platform-guards.ts", import.meta.url),
  "utf8",
);
const staffSettingsSource = readFileSync(
  new URL(
    "../src/app/(staff)/settings/PlatformStaffSettingsPage.tsx",
    import.meta.url,
  ),
  "utf8",
);
const auditSettingsSource = readFileSync(
  new URL(
    "../src/app/(staff)/settings/PlatformAuditSettingsPage.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("the operations page stays server-only behind the existing live Admin guard", () => {
  assert.doesNotMatch(operationsPageSource, /["']use client["']/);
  assert.match(
    operationsPageSource,
    /await requirePlatformOperationsAdminActor\(\)/,
  );
  assert.match(
    operationsPageSource,
    /await loadPlatformOperationsReadiness\(\)/,
  );
  assert.doesNotMatch(operationsPageSource, /\/api\/readiness/);
  assert.doesNotMatch(
    operationsPageSource,
    /EVO_PLATFORM_P7B_OBSERVABILITY_SECRET|SUPABASE_SECRET_KEY|observabilitySecret/,
  );
});

test("non-Admin operations access fails closed with the truthful operations return path", () => {
  assert.match(
    guardsSource,
    /export async function requirePlatformOperationsAdminActor\(\)[\s\S]*requirePlatformActor\(\)[\s\S]*actor\.platformRole !== "admin"[\s\S]*\/platform-pending\?from=%2Fsettings%3Ftab%3Doperations/,
  );
});

test("the Admin projection distinguishes readiness, partial platform aggregates, blockers and recovery proof", () => {
  for (const component of ["supabase", "audit_append", "waha", "ai"]) {
    assert.match(
      operationsPageSource,
      new RegExp(`readiness\\.components\\.${component}`),
      `${component} must come from canonical PlatformReadiness`,
    );
  }
  for (const recovery of ["restore_database", "restore_storage"]) {
    assert.match(
      operationsPageSource,
      new RegExp(`readiness\\.components\\.${recovery}`),
      `${recovery} evidence must be shown independently`,
    );
  }
  assert.match(operationsPageSource, /readiness\.alerts\.map/);
  assert.match(operationsPageSource, /alert\.code/);
  assert.match(operationsPageSource, /alert\.runbook_id/);
  assert.match(operationsPageSource, /readiness\.signals\.saturated/);
  assert.match(operationsPageSource, /data-testid="platform-counts-partial"/);
  assert.match(operationsPageSource, /readiness\.signals\.observed_at/);
  assert.match(
    operationsPageSource,
    /Безопасные агрегированные показатели по всей платформе/,
  );
  assert.doesNotMatch(
    operationsPageSource,
    /показател[а-я]* (?:этой|вашей) организаци/i,
  );
});

test("both existing Admin settings pages link to the operations view", () => {
  for (const source of [staffSettingsSource, auditSettingsSource]) {
    assert.match(source, /href="\/settings\?tab=operations"/);
    assert.match(source, />\s*Операции\s*</);
  }
});
