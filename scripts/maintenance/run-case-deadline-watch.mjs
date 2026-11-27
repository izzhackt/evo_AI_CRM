// Entry of the case deadline watch («Сторож сроков», migration 383; docs/runbooks/ai-agents-managed.md).
// Bundled by scripts/maintenance/build-case-deadline-watch.mjs into .next/case-deadline-watch.mjs and run by a systemd
// timer on the host on weekdays as `docker exec evo-crm-app-1 node /app/case-deadline-watch.mjs --apply`.
// DRY RUN BY DEFAULT: without `--apply` nothing is written. The only output is one JSON line of counters and fixed
// words: no case, name or document data. No Claude call, no tokens.
import { CASE_DEADLINE_WATCH_USAGE, parseCaseDeadlineWatchArgs, runCaseDeadlineWatch } from "../../src/lib/server/ai-agents/case-deadline-watch.ts";

const hardStop = setTimeout(() => {
  console.error("case_deadline_watch_timeout");
  process.exit(1);
}, 100_000);
hardStop.unref();

let command;
try {
  command = parseCaseDeadlineWatchArgs(process.argv.slice(2));
} catch {
  process.stderr.write(CASE_DEADLINE_WATCH_USAGE);
  process.exit(2);
}
try {
  const report = await runCaseDeadlineWatch(command);
  console.log(JSON.stringify(report.log));
  process.exitCode = report.exitCode;
} catch {
  console.error("case_deadline_watch_failed");
  process.exitCode = 1;
}
