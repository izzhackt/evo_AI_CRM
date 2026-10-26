// Entry of the WhatsApp connection alert job (docs/runbooks/whatsapp-go-live.md, «Тревога об отключении и тишине»).
// Bundled by scripts/build-whatsapp-health-maintenance.mjs into .next/whatsapp-health-maintenance.mjs and run
// every 5 minutes by the systemd timer on the host (deploy/whatsapp/) as
// `docker exec evo-crm-app-1 node /app/whatsapp-health-maintenance.mjs`.
// It does nothing unless EVO_PLATFORM_WAHA_INGRESS_ENABLED is exactly "1" in the app container. It asks WAHA only
// for the session status (one GET), sends no message to anyone and never touches the session. The only output is
// one JSON line of counters and fixed words: no phone number, key, token, message text or client data.
import { runWhatsAppHealthMaintenance } from "../src/lib/server/platform-whatsapp-health-maintenance.ts";

// Hard stop: the unit's TimeoutStartSec is 120 s and `docker exec` leaves the process running when systemd gives
// up. A pass is a few requests; this guards a hung socket.
const hardStop = setTimeout(() => {
  console.error("whatsapp_health_maintenance_timeout");
  process.exit(1);
}, 100_000);
hardStop.unref();

try {
  const report = await runWhatsAppHealthMaintenance();
  console.log(JSON.stringify(report.log));
  process.exitCode = report.exitCode;
} catch {
  console.error("whatsapp_health_maintenance_failed");
  process.exitCode = 1;
}
