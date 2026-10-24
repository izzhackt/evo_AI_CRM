// Entry of the AI agents maintenance job (docs/runbooks/ai-agents-managed.md, «Фоновая сверка»).
// Bundled by scripts/build-ai-agents-maintenance.mjs into .next/ai-agents-maintenance.mjs and run
// every ~5 minutes by a systemd timer on the host as
// `docker exec evo-crm-app-1 node /app/ai-agents-maintenance.mjs`.
// It does nothing unless EVO_ANTHROPIC_API_KEY is set. The only output is one JSON line of counters
// and fixed words: no instruction text, key, token or client data.
import { runAiAgentsMaintenance } from "../src/lib/server/ai-agents/maintenance.ts";

// Hard stop: the unit's TimeoutStartSec is 240 s and `docker exec` leaves the process running when
// systemd gives up. The run budgets itself to 150 s; this guards a hung socket.
const hardStop = setTimeout(() => {
  console.error("ai_agents_maintenance_timeout");
  process.exit(1);
}, 200_000);
hardStop.unref();

try {
  const report = await runAiAgentsMaintenance();
  console.log(JSON.stringify(report.log));
  process.exitCode = report.exitCode;
} catch {
  console.error("ai_agents_maintenance_failed");
  process.exitCode = 1;
}
