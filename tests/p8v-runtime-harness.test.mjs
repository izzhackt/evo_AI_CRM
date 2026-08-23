import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const runtimeHarness = readFileSync(
  new URL("../scripts/test-p8v-runtime.sh", import.meta.url),
  "utf8",
);
const currentRuntimeHarnessUrl = new URL(
  "../scripts/test-p8r6-runtime.sh",
  import.meta.url,
);
const postgresHarness = readFileSync(
  new URL("../scripts/test-postgres-authorization.sh", import.meta.url),
  "utf8",
);
const localResetHarness = readFileSync(
  new URL("../scripts/test-supabase-local-reset.sh", import.meta.url),
  "utf8",
);
const p2gHarness = readFileSync(
  new URL("../scripts/test-p2g-queues-runtime.sh", import.meta.url),
  "utf8",
);

test("P8V transactional runtime proof is isolated from migration 045", () => {
  assert.doesNotMatch(p2gHarness, /platform\.sync_lead_agent_whatsapp/);
  assert.doesNotMatch(p2gHarness, /platform\.claim_manual_whatsapp_send/);

  assert.match(
    postgresHarness,
    /if \[\[ "\$\(basename "\$migration"\)" == 077_\* \]\]; then[\s\S]*test-p8v-runtime\.sh[\s\S]*"\$container_name"[\s\S]*"\$test_database"/,
  );

  const p2gCall = localResetHarness.indexOf(
    '"${REPO_ROOT}/scripts/test-p2g-queues-runtime.sh"',
  );
  const p8r6Call = localResetHarness.indexOf(
    '"${REPO_ROOT}/scripts/test-p8r6-runtime.sh"',
  );
  const postQueueReset = localResetHarness.indexOf("post-queue-reset.json");

  assert.ok(p2gCall > 0);
  assert.ok(p8r6Call > p2gCall);
  assert.ok(postQueueReset > p8r6Call);
  assert.doesNotMatch(
    localResetHarness,
    /REPO_ROOT}\/scripts\/test-p8v-runtime\.sh/,
  );
});

test("P8V proof is transactional and exercises exact typed ingress and replay calls", () => {
  assert.match(runtimeHarness, /BEGIN;/);
  assert.match(runtimeHarness, /ROLLBACK;/);
  assert.match(
    runtimeHarness,
    /platform\.sync_lead_agent_whatsapp\([\s\S]*::UUID,[\s\S]*::BIGINT/,
  );
  assert.match(runtimeHarness, /platform\.claim_manual_whatsapp_send\(/);
  assert.match(
    runtimeHarness,
    /'\{"claimed":false,"queue":"platform_work_v1"\}'::JSONB/,
  );
});

test("P8V keeps its migration-077 session evidence while P8R6 selects current authority", () => {
  assert.match(runtimeHarness, /WAHA_SESSION_NAME="\$\{3:-crm_primary\}"/);
  assert.match(runtimeHarness, /'waha:' \|\| :'waha_session_name'/);
  assert.match(
    runtimeHarness,
    /set_config\([\s\S]*evo\.test_waha_session_name[\s\S]*current_setting\('evo\.test_waha_session_name'\)/,
  );
  assert.doesNotMatch(runtimeHarness, /'waha:evo-inbox'/);

  assert.equal(existsSync(currentRuntimeHarnessUrl), true);
  const currentRuntimeHarness = readFileSync(currentRuntimeHarnessUrl, "utf8");
  assert.match(
    currentRuntimeHarness,
    /test-p8v-runtime\.sh[\s\S]*"evo-inbox"[\s\S]*"P8R6"/,
  );
});
