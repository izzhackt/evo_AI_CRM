import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const HARNESS_URL = new URL(
  "../scripts/verify-platform-provider-runtime-inventory.sh",
  import.meta.url,
);

function source(path) {
  return readFileSync(new URL(path, ROOT), "utf8");
}

test("P5D runtime inventory harness is exact-main, private, and reproducible", () => {
  assert.equal(existsSync(HARNESS_URL), true);
  const shell = readFileSync(HARNESS_URL, "utf8");

  assert.match(shell, /^set -euo pipefail$/mu);
  assert.match(shell, /^umask 077$/mu);
  assert.match(shell, /git status --porcelain=v1 --untracked-files=all/u);
  assert.match(shell, /git fetch --quiet origin/u);
  assert.match(shell, /git rev-parse HEAD/u);
  assert.match(shell, /git rev-parse origin\/main/u);
  assert.match(shell, /node --version|"\$node_bin" --version/u);
  assert.match(shell, /v22\./u);
  assert.match(shell, /uname -s/u);
  assert.match(shell, /orb status/u);
  assert.match(shell, /docker context show/u);
  assert.match(shell, /orbstack/u);
  assert.match(shell, /output\/provider-runtime-inventory/u);
  assert.match(shell, /chmod 700/u);
  assert.match(shell, /chmod 600/u);
  assert.match(shell, /npm run test:u9/u);
  assert.match(shell, /npm run test:database:local/u);
  assert.match(shell, /EVO_PLATFORM_RUNTIME_INVENTORY_EVIDENCE_DIR/u);
  assert.match(shell, /platform-provider-runtime-inventory\.mjs/u);
  assert.match(shell, /success\.json/u);
});

test("P5D remote WAHA inspection stays read-only and never copies a secret", () => {
  const shell = readFileSync(HARNESS_URL, "utf8");

  assert.match(shell, /ssh[^\n]*hermes-vps/u);
  assert.match(shell, /\/opt\/evo-crm\/\.env\.lead-agent/u);
  assert.match(shell, /EVO_AGENT_WAHA_SESSION/u);
  assert.match(shell, /crm_primary/u);
  assert.match(shell, /http:\/\/evo-crm-waha:3000/u);
  assert.match(shell, /evo-crm-waha-1/u);
  assert.match(shell, /evo_crm_private/u);
  assert.match(shell, /\/api\/sessions\/crm_primary/u);
  assert.match(shell, /method[^\n]*GET|curl[^\n]*--request GET/iu);
  assert.doesNotMatch(shell, /\bscp\b|provider\.bundle|ssh-tunnel|LocalForward/u);
  assert.doesNotMatch(shell, /\/api\/sendText|\/messages(?:\?|["'])|--request POST/iu);
  assert.doesNotMatch(shell, /\/opt\/evo-inbox|evo-inbox-waha/u);
});

test("P5D local foundation mounts the dedicated read-only Chromium proof", () => {
  const foundation = source("scripts/test-postgres-v2-foundation.sh");
  const staffLayout = source("src/app/(staff)/layout.tsx");
  const packageManifest = source("package.json");

  assert.match(foundation, /platform_provider_runtime_inventory_browser_assert/u);
  assert.match(foundation, /reset_next_dev_cache_once/u);
  assert.match(foundation, /rm -R -- "\$cache_path"/u);
  assert.match(
    foundation,
    /playwright\.platform-provider-runtime-inventory\.config\.ts/u,
  );
  assert.match(foundation, /EVO_PLATFORM_RUNTIME_INVENTORY_MAIN_SHA/u);
  assert.match(foundation, /EVO_PLATFORM_RUNTIME_INVENTORY_BROWSER_EVIDENCE_FILE/u);
  assert.match(foundation, /EVO_PLATFORM_RUNTIME_INVENTORY_DATABASE_EVIDENCE_FILE/u);
  assert.match(staffLayout, /data-testid="staff-shell"/u);
  assert.match(staffLayout, /data-authority-role=\{provider\.user\.authorityRole\}/u);
  assert.match(staffLayout, /data-effective-role=\{provider\.user\.role\}/u);
  assert.match(packageManifest, /platform-provider-runtime-inventory-helper\.test\.mjs/u);
  assert.match(packageManifest, /platform-provider-runtime-inventory-harness\.test\.mjs/u);
});
