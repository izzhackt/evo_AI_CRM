import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../scripts/provision-local-platform-communications.mjs", import.meta.url),
  "utf8",
);

test("local communications provisioning resolves one Admin organization, Sales intake owner and Vault runtime", () => {
  assert.match(source, /signInWithPassword/);
  assert.match(source, /rpc\("current_actor_authority"\)/);
  assert.match(source, /authority\.platform_role !== "admin"/);
  assert.match(source, /salesAuthority\.platform_role !== "sales"/);
  assert.match(source, /salesAuthority\.membership_id/);
  assert.match(source, /rpc\("provision_manual_send_waha_runtime"/);
  assert.match(source, /waha_session_name !== "evo-inbox"/);
  assert.match(source, /base_url !== "http:\/\/evo-inbox-waha:3000"/);
  assert.doesNotMatch(source, /evo-crm-waha/);
  assert.doesNotMatch(source, /console\.(?:log|error)|JSON\.stringify\(process\.env/);
});
