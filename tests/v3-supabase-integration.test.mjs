import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V3 server adapters use the canonical Supabase runtime only", () => {
  const adapterDirectory = new URL("../src/lib/v3/", import.meta.url);
  const adapterSources = readdirSync(adapterDirectory)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(new URL(name, adapterDirectory), "utf8"))
    .join("\n");

  assert.doesNotMatch(adapterSources, /@\/lib\/server\/database/);
  assert.doesNotMatch(adapterSources, /\bevo_[a-z0-9_]+\b/);
  assert.doesNotMatch(adapterSources, /better-sqlite3|drizzle-orm/i);
  assert.match(adapterSources, /listPlatformSalesLeads/);
  assert.match(adapterSources, /listPlatformConversations/);
  assert.match(adapterSources, /listPlatformAdmissionsTaskQueue/);
  assert.match(adapterSources, /listPlatformDocumentQueue/);
});

test("V3 has Supabase staff auth and no sample business-data path", () => {
  const layout = source("src/app/(v3)/layout.tsx");
  const profilePage = source("src/app/(v3)/v3/profile/page.tsx");
  const knowledgePage = source("src/app/(v3)/v3/knowledge/page.tsx");

  assert.match(layout, /requirePlatformStaffActor/);
  assert.doesNotMatch(profilePage, /PROFILE_SAMPLE|\.\/sample/);
  assert.doesNotMatch(knowledgePage, /COMPANY_FILES|Требования к нострификации/);
  assert.equal(
    existsSync(new URL("../src/app/(v3)/v3/profile/sample.ts", import.meta.url)),
    false,
  );
  assert.equal(
    existsSync(new URL("../scripts/v3-gate/seed.sql", import.meta.url)),
    false,
  );
});

test("ordinary real foundation proof runs the fail-closed V3 browser gate", () => {
  const gate = source("scripts/v3-gate/gate.mjs");
  const foundation = source("scripts/test-postgres-v2-foundation.sh");
  const manifest = JSON.parse(source("package.json"));

  assert.match(gate, /EVO_STAFF_AUTH_ADMIN_EMAIL/);
  assert.match(gate, /EVO_STAFF_AUTH_ADMIN_PASSWORD/);
  assert.match(gate, /#staff-email/);
  assert.match(gate, /#staff-password/);
  assert.match(gate, /process\.exitCode = 1/);
  assert.doesNotMatch(gate, /EVO_DEV_GATE|#gate-identifier|#gate-secret/);
  assert.match(foundation, /v3_browser_gate/);
  assert.match(foundation, /scripts\/v3-gate\/gate\.mjs/);
  assert.equal(manifest.scripts["test:v3:gate"], "node scripts/v3-gate/gate.mjs");
});
