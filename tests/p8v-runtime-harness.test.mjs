import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtimeHarness = readFileSync(
  new URL("../scripts/test-p8v-runtime.sh", import.meta.url),
  "utf8",
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
  const p8vCall = localResetHarness.indexOf(
    '"${REPO_ROOT}/scripts/test-p8v-runtime.sh"',
  );
  const postQueueReset = localResetHarness.indexOf("post-queue-reset.json");

  assert.ok(p2gCall > 0);
  assert.ok(p8vCall > p2gCall);
  assert.ok(postQueueReset > p8vCall);
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
