import "server-only";

import { callRpc, isRecord, numberOr, resolveDeps, type AiAgentsRuntimeDeps } from "./deps.ts";
import { readOrganizationId } from "./env.ts";

/*
 * «Сторож сроков» (миграция 383): утренний проход, который находит дела со сроком, вычислимым без модели, и ставит
 * задачу куратору. Вся работа в базе (`platform.case_deadline_watch_run_v1`): здесь только разбор аргументов, один вызов
 * RPC и строка со счётчиками. Ни Claude, ни токенов. Запускается как
 * `docker exec evo-crm-app-1 node /app/case-deadline-watch.mjs [--dry-run | --apply]`
 * (scripts/maintenance/run-case-deadline-watch.mjs → .next/case-deadline-watch.mjs, docs/runbooks/ai-agents-managed.md).
 *
 * По умолчанию сухой прогон: в базу ничего не пишется. Задачи ставит только явный `--apply`.
 * В журнал уходят только счётчики и фиксированные слова: ни названий, ни имён, ни идентификаторов дел.
 */

export const CASE_DEADLINE_WATCH_USAGE = "Usage: node case-deadline-watch.mjs [--once] [--dry-run | --apply]\n";
export const CASE_DEADLINE_WATCH_REASONS = ["slot_due", "next_step_overdue", "tranche_overdue"] as const;
const COUNTERS = ["found", "created", "would_create", "skipped", "no_assignee"] as const;

export type CaseDeadlineWatchCommand = Readonly<{ apply: boolean }>;

/** `--once` (единственный режим, можно не писать), `--dry-run` (по умолчанию) или `--apply`; всё остальное — ошибка. */
export function parseCaseDeadlineWatchArgs(args: readonly string[]): CaseDeadlineWatchCommand {
  let dryRun = false;
  let apply = false;
  let once = false;
  for (const name of args) {
    if (name === "--dry-run" && !dryRun) dryRun = true;
    else if (name === "--apply" && !apply) apply = true;
    else if (name === "--once" && !once) once = true;
    else throw new Error("invalid_arguments");
  }
  if (dryRun && apply) throw new Error("invalid_arguments");
  return { apply };
}

export type CaseDeadlineWatchReport = Readonly<{
  /** 1 — не удалось запустить или база отказала; сухой прогон и пустой день — 0. */
  exitCode: 0 | 1;
  log: Readonly<Record<string, string | number | boolean | Readonly<Record<string, number>>>>;
}>;

function counters(source: unknown): Record<string, number> {
  const record = isRecord(source) ? source : {};
  return Object.fromEntries(COUNTERS.map((name) => [name, Math.max(0, Math.trunc(numberOr(record[name], 0)))]));
}

export async function runCaseDeadlineWatch(
  command: CaseDeadlineWatchCommand,
  overrides?: Partial<AiAgentsRuntimeDeps>,
): Promise<CaseDeadlineWatchReport> {
  const log: Record<string, string | number | boolean | Record<string, number>> = {
    event: "case_deadline_watch", mode: command.apply ? "apply" : "dry_run",
  };
  const done = (exitCode: 0 | 1): CaseDeadlineWatchReport => Object.freeze({ exitCode, log });
  try {
    const deps = resolveDeps(overrides);
    const organizationId = readOrganizationId(deps.env());
    if (!organizationId) {
      log.status = "failed";
      log.reason = "organization_not_configured";
      return done(1);
    }
    let client;
    try {
      client = await deps.serviceClient();
    } catch {
      log.status = "failed";
      log.reason = "backend_not_configured";
      return done(1);
    }
    // `p_today` не передаётся: день считает база по Asia/Bishkek.
    const outcome = await callRpc(client, "case_deadline_watch_run_v1", {
      p_organization_id: organizationId, p_dry_run: !command.apply,
    });
    if (!outcome.ok || !isRecord(outcome.data)) {
      log.status = "failed";
      log.reason = outcome.ok ? "unexpected_answer" : "rpc_failed";
      if (!outcome.ok) log.code = /^[0-9A-Z]{5}$/u.test(outcome.code) ? outcome.code : "unknown";
      return done(1);
    }
    log.status = "ok";
    if (typeof outcome.data.today === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(outcome.data.today)) log.today = outcome.data.today;
    Object.assign(log, counters(outcome.data));
    const byReason: Record<string, number> = {};
    const reasons = isRecord(outcome.data.by_reason) ? outcome.data.by_reason : {};
    for (const reason of CASE_DEADLINE_WATCH_REASONS) {
      const row = counters(reasons[reason]);
      for (const name of COUNTERS) byReason[`${reason}_${name}`] = row[name] ?? 0;
    }
    log.by_reason = byReason;
    return done(0);
  } catch {
    log.status = "failed";
    log.reason = "unexpected_error";
    return done(1);
  }
}
