// Entry of the telephony maintenance job (docs/archive/plans/2026-10-16-telephony-plan.md
// §5.3). Bundled by scripts/maintenance/build-telephony-maintenance.mjs into
// .next/telephony-maintenance.mjs and run once a minute by the systemd timer
// (deploy/telephony/) as `docker exec evo-crm-app-1 node /app/telephony-maintenance.mjs`.
// It does nothing unless EVO_PLATFORM_TELEPHONY_ENABLED is exactly "1". The only
// output is one JSON line of counters and fixed words: no number, login, link,
// key or PBX text.
import { runTelephonyMaintenance } from "../../src/lib/server/platform-telephony-maintenance.ts";

try {
  const report = await runTelephonyMaintenance();
  console.log(JSON.stringify(report.log));
  process.exitCode = report.exitCode;
} catch {
  console.error("telephony_maintenance_failed");
  process.exitCode = 1;
}
