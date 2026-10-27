// Entry of the Wazzup operator commands (docs/runbooks/wazzup-whatsapp.md, docs/EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md
// §5.5-§5.6). Bundled by scripts/build-whatsapp-health-maintenance.mjs into .next/wazzup-ops.mjs, shipped in the image as
// /app/wazzup-ops.mjs and run by the operator, with the owner's go-ahead, as
// `docker exec -i evo-crm-app-1 node /app/wazzup-ops.mjs <command>`.
// The Wazzup API key arrives only on stdin (hidden input in a terminal, a pipe otherwise) and goes to the Vault; the
// webhook token is read from the process environment. Neither is ever an argument, a log line or output. The only
// output is one JSON line of safe fields (key fingerprint, last four digits, address path).
import { runWazzupOps } from "../src/lib/server/platform-wazzup-ops.ts";

// Hard stop: `docker exec` leaves the process running when the operator's shell gives up. A command is a few requests.
const hardStop = setTimeout(() => {
  console.error("wazzup_ops_timeout");
  process.exit(1);
}, 90_000);
hardStop.unref();

try {
  process.exitCode = await runWazzupOps(process.argv.slice(2));
} catch {
  console.error("wazzup_ops_failed");
  process.exitCode = 1;
}
