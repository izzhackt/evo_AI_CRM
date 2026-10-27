// Entry of the WhatsApp connection alert job (docs/runbooks/whatsapp-go-live.md, «Тревога об отключении и тишине»;
// docs/runbooks/wazzup-whatsapp.md for the Wazzup part).
// Bundled by scripts/build-whatsapp-health-maintenance.mjs into .next/whatsapp-health-maintenance.mjs and run
// every 5 minutes by the systemd timer on the host (deploy/whatsapp/) as
// `docker exec evo-crm-app-1 node /app/whatsapp-health-maintenance.mjs`.
// Two independent parts per pass:
//  - the WAHA part does nothing unless EVO_PLATFORM_WAHA_INGRESS_ENABLED is exactly "1" in the app container. It asks
//    WAHA only for the session status (one GET), sends no message to anyone and never touches the session;
//  - the Wazzup part (three steps: sweep, health, reconciliation) runs when EVO_PLATFORM_WAZZUP_INGRESS_ENABLED is
//    exactly "1"; each step says `transport_inactive` when the Wazzup transport is not the active one. With the stop
//    closed but a webhook token in the env it only checks that the database path is not Wazzup (silent) or reports
//    `degraded` and keeps the health step; with neither it does nothing and never calls the database. It reads Wazzup
//    with GET /v3/channels only and sends nothing to customers.
// The only output is one JSON line of counters and fixed words (the Wazzup part nested under `wazzup`, only when it is
// switched on): no phone number, key, token, message text or client data.
import { runWhatsAppHealthMaintenance } from "../src/lib/server/platform-whatsapp-health-maintenance.ts";
import { runWazzupMaintenance } from "../src/lib/server/platform-wazzup-maintenance.ts";

// Hard stop: the unit's TimeoutStartSec is 120 s and `docker exec` leaves the process running when systemd gives
// up. A pass is a few requests; this guards a hung socket.
const hardStop = setTimeout(() => {
  console.error("whatsapp_health_maintenance_timeout");
  process.exit(1);
}, 100_000);
hardStop.unref();

try {
  const waha = await runWhatsAppHealthMaintenance();
  let wazzup = null;
  try {
    wazzup = await runWazzupMaintenance();
  } catch {
    wazzup = { exitCode: 1, log: { status: "failed", reason: "unexpected" } };
  }
  // One report: the WAHA line as it always was, with the Wazzup part nested under `wazzup` only when it is switched on.
  const report = {
    exitCode: Math.max(waha.exitCode, wazzup.exitCode),
    log: wazzup.log.status === "disabled" ? waha.log : { ...waha.log, wazzup: wazzup.log },
  };
  console.log(JSON.stringify(report.log));
  process.exitCode = report.exitCode;
} catch {
  console.error("whatsapp_health_maintenance_failed");
  process.exitCode = 1;
}
