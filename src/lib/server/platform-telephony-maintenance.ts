import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getPlatformMessagingBackendConfig,
  type PlatformMessagingBackendConfig,
} from "./platform-messaging-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import { isPlatformTelephonyEnabled } from "./platform-telephony-ingress-config.ts";
import {
  createTelephonyPbxClient,
  TELEPHONY_PBX_HISTORY_LIMIT,
  TELEPHONY_PBX_STOPPING_ERRORS,
  TelephonyPbxError,
  type TelephonyPbxClient,
  type TelephonyPbxHistoryRow,
} from "./platform-telephony-pbx-client.ts";
import {
  readPlatformTelephonyPbxConfig,
  type PlatformTelephonyPbxConfig,
} from "./platform-telephony-pbx-config.ts";

/**
 * Background work for Beeline KG telephony (docs/EVO_TELEPHONY_PLAN_2026-10-16.md
 * §5.3, §5.4; ADR 0033), run once a minute by the systemd timer as
 * `docker exec evo-crm-app-1 node /app/telephony-maintenance.mjs`.
 *
 * One run:
 *  1. does nothing at all unless EVO_PLATFORM_TELEPHONY_ENABLED is exactly "1";
 *  2. asks the database what is due (`platform.telephony_maintenance_plan_v1`:
 *     the windows and the schedule are decided by the database clock, so a
 *     restart or a second run never doubles a job);
 *  3. local jobs, no PBX request: retry of the stored projection backlog, the
 *     90-second settle window (both closed by the projection flag inside the
 *     database) and, right after the settle window, the missed-call automation
 *     tick of slice T8 (callback tasks, the no-answer cadence, auto-close,
 *     automation ceilings; closed inside the database by `projection_enabled`
 *     and `missed_task_enabled`, both OFF by default). A failure of the tick is
 *     recorded as a fixed word and ends the run with exit code 1, but it never
 *     stops the PBX jobs that follow: the reconcile must not stall behind a bug
 *     in the automation;
 *  4. PBX jobs, only when the PBX key group is complete and the outbound pause
 *     is off: the user directory (`GET /users`), the facts probe
 *     (`GET /domain`, `/record`, `/groups`), then AT MOST ONE history job per
 *     run (`GET /history/json`): the 10-minute reconcile, else the daily
 *     «yesterday», else one window of the first-year import. So the PBX sees
 *     at most one history job a minute, and the 1-second pause between the
 *     requests of a window keeps even a split window gentle.
 *
 * The cursor of a history job moves only after every row of the window has been
 * applied. A PBX failure is recorded as a fixed code (`last_pbx_error_code`) and
 * the run still ends cleanly; only a database failure ends it with exit code 1.
 * After an authentication-class error the rest of the run's PBX jobs are
 * skipped. The log carries counters and fixed words only: never a number, a
 * login, a link, a key or PBX text.
 */

const RETRY_BATCH = 20;
const RETRY_MAX_ROUNDS = 5;
const RETRY_LEASE_SECONDS = 120;
const SETTLE_BATCH = 200;
const AUTOMATION_BATCH = 100;
const APPLY_BATCH = 100;
const INTAKE_BATCH = 100;
const USERS_MAX = 200;
const HISTORY_MAX_REQUESTS = 16;
const HISTORY_PAUSE_MS = 1_000;
const HISTORY_MIN_SPLIT_MS = 60_000;
const HISTORY_MAX_DEPTH = 8;
const MAX_WINDOW_MS = 25 * 60 * 60 * 1000;
const DEFAULT_RPC_DEADLINE_MS = 20_000;
// The unit's TimeoutStartSec is 240 s and `docker exec` would leave the process
// running if systemd gave up, so the run budgets itself: no PBX job or request
// starts after this much time (one request with its retries takes up to ~35 s).
const DEFAULT_RUN_BUDGET_MS = 150_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ZONE_NAME_PATTERN = /^[A-Za-z0-9_/+-]{1,64}$/u;
const FIXED_WORD_PATTERN = /^[a-z][a-z0-9_]{0,31}$/u;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;

type RpcClient = Pick<SupabaseClient, "schema">;
type JsonObject = Record<string, unknown>;
type LogValue = string | number | boolean;
type HistoryMode = "reconcile" | "daily" | "backfill";

export type TelephonyMaintenanceDependencies = Readonly<{
  environment: Readonly<Record<string, string | undefined>>;
  createServiceClient(config: PlatformMessagingBackendConfig): RpcClient;
  createPbxClient(config: PlatformTelephonyPbxConfig): TelephonyPbxClient;
  sleep(milliseconds: number): Promise<void>;
  rpcDeadlineMs: number;
  leaseOwner: string;
  /** Milliseconds after which no further PBX job or request is started. */
  runBudgetMs: number;
  now(): number;
}>;

export type TelephonyMaintenanceReport = Readonly<{
  /** 1 only when the database could not be used; PBX errors are recorded state. */
  exitCode: 0 | 1;
  /** Flat counters and fixed words, safe for the application log. */
  log: Readonly<Record<string, LogValue>>;
}>;

export function defaultTelephonyMaintenanceDependencies(): TelephonyMaintenanceDependencies {
  return {
    environment: process.env,
    createServiceClient: createPlatformSupabaseServiceClient,
    createPbxClient: (config) => createTelephonyPbxClient(config),
    sleep: (milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
    rpcDeadlineMs: DEFAULT_RPC_DEADLINE_MS,
    leaseOwner: `evo-telephony-maintenance:${randomUUID()}`,
    runBudgetMs: DEFAULT_RUN_BUDGET_MS,
    now: Date.now,
  };
}

class TelephonyDatabaseError extends Error {
  constructor() {
    super("telephony_database_error");
    this.name = "TelephonyDatabaseError";
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

type Window = Readonly<{ due: boolean; start: Date; end: Date }>;

type Plan = Readonly<{
  retryDue: boolean;
  settleDue: boolean;
  usersDue: boolean;
  probeDue: boolean;
  outboundPaused: boolean;
  reconcile: Window;
  daily: Window;
  backfill: Window;
}>;

function parseWindow(value: unknown): Window {
  if (!isObject(value)) throw new TelephonyDatabaseError();
  const due = value.due === true;
  const start = typeof value.window_start === "string" ? new Date(value.window_start) : null;
  const end = typeof value.window_end === "string" ? new Date(value.window_end) : null;
  if (start === null || end === null || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    if (due) throw new TelephonyDatabaseError();
    return Object.freeze({ due: false, start: new Date(0), end: new Date(0) });
  }
  if (due && !(start.getTime() < end.getTime() && end.getTime() - start.getTime() <= MAX_WINDOW_MS)) {
    throw new TelephonyDatabaseError();
  }
  return Object.freeze({ due, start, end });
}

function parsePlan(value: unknown): Plan {
  if (!isObject(value) || value.status !== "ok") throw new TelephonyDatabaseError();
  return Object.freeze({
    retryDue: value.retry_due === true,
    settleDue: value.settle_due === true,
    usersDue: value.users_due === true,
    probeDue: value.probe_due === true,
    outboundPaused: value.outbound_paused === true,
    reconcile: parseWindow(value.reconcile),
    daily: parseWindow(value.daily),
    backfill: parseWindow(value.backfill),
  });
}

/**
 * Runs one maintenance pass. Never throws: the outcome is the report.
 */
export async function runTelephonyMaintenance(
  dependencies: TelephonyMaintenanceDependencies = defaultTelephonyMaintenanceDependencies(),
): Promise<TelephonyMaintenanceReport> {
  const log: Record<string, LogValue> = { event: "telephony_maintenance" };

  if (!isPlatformTelephonyEnabled(dependencies.environment)) {
    log.status = "disabled";
    log.reason = "env_switch";
    return Object.freeze({ exitCode: 0, log });
  }

  let config: PlatformMessagingBackendConfig;
  try {
    config = getPlatformMessagingBackendConfig(dependencies.environment as NodeJS.ProcessEnv);
  } catch {
    log.status = "failed";
    log.reason = "backend_not_configured";
    return Object.freeze({ exitCode: 1, log });
  }

  try {
    const client = dependencies.createServiceClient(config);
    const organizationId = config.organizationId;
    const deadline = dependencies.now() + dependencies.runBudgetMs;

    async function rpc(name: string, args: JsonObject): Promise<JsonObject> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const outcome = await Promise.race([
          Promise.resolve(client.schema("platform").rpc(name, args)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new TelephonyDatabaseError()), dependencies.rpcDeadlineMs);
          }),
        ]);
        if (outcome.error || !isObject(outcome.data)) throw new TelephonyDatabaseError();
        return outcome.data;
      } catch (error) {
        if (error instanceof TelephonyDatabaseError) throw error;
        throw new TelephonyDatabaseError();
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }

    async function mark(
      event: string,
      extra: Readonly<{ cursor?: Date; errorCode?: string; summary?: JsonObject; facts?: JsonObject }> = {},
    ): Promise<void> {
      const args: JsonObject = { p_organization_id: organizationId, p_event: event };
      if (extra.cursor !== undefined) args.p_cursor = extra.cursor.toISOString();
      if (extra.errorCode !== undefined) args.p_error_code = extra.errorCode;
      if (extra.summary !== undefined) args.p_summary = extra.summary;
      if (extra.facts !== undefined) args.p_facts = extra.facts;
      await rpc("telephony_runtime_mark_v1", args);
    }

    const plan = parsePlan(await rpc("telephony_maintenance_plan_v1", { p_organization_id: organizationId }));
    log.status = "ok";
    let automationFailed = false;
    const finish = (): TelephonyMaintenanceReport =>
      Object.freeze({ exitCode: automationFailed ? 1 : 0, log });

    // -- Local jobs: no PBX request. -----------------------------------------
    if (plan.retryDue) {
      let claimed = 0;
      let succeeded = 0;
      let waiting = 0;
      let dead = 0;
      for (let round = 0; round < RETRY_MAX_ROUNDS; round += 1) {
        const claim = await rpc("telephony_claim_work_v1", {
          p_organization_id: organizationId,
          p_lease_owner: dependencies.leaseOwner,
          p_limit: RETRY_BATCH,
          p_lease_seconds: RETRY_LEASE_SECONDS,
        });
        const items = claim.status === "ok" && Array.isArray(claim.items) ? claim.items : [];
        for (const item of items) {
          const workId = isObject(item) && typeof item.work_id === "string" ? item.work_id : "";
          if (!UUID_PATTERN.test(workId)) continue;
          claimed += 1;
          const result = await rpc("telephony_project_work_v1", {
            p_organization_id: organizationId,
            p_work_id: workId,
            p_lease_owner: dependencies.leaseOwner,
          });
          if (result.status === "succeeded") succeeded += 1;
          else if (result.status === "dead_lettered") dead += 1;
          else waiting += 1;
        }
        if (items.length < RETRY_BATCH) break;
      }
      log.retry_claimed = claimed;
      log.retry_succeeded = succeeded;
      log.retry_waiting = waiting;
      log.retry_dead = dead;
    }
    if (plan.settleDue) {
      const settled = await rpc("telephony_settle_calls_v1", {
        p_organization_id: organizationId,
        p_limit: SETTLE_BATCH,
      });
      // Unknown-number intake (T9): an unknown inbound number becomes a client and a «Звонок» lead, a
      // known client without an open lead gets one task. It decides what the quiet window just settled
      // and MUST run before the missed-call tick (T8), which leaves an unknown number to this step and
      // then finds the created lead. The database answers `disabled` while its flags are off. A failure
      // is recorded as a fixed word and ends the run with exit code 1, but never stops the PBX jobs.
      try {
        const intake = await rpc("telephony_intake_tick_v1", {
          p_organization_id: organizationId,
          p_limit: INTAKE_BATCH,
        });
        log.intake = typeof intake.status === "string" && FIXED_WORD_PATTERN.test(intake.status)
          ? intake.status
          : "unknown";
        if (log.intake === "ok" || log.intake === "stopped") {
          log.intake_created = count(intake.created);
          log.intake_attached = count(intake.attached);
          log.intake_tasks = count(intake.tasks);
          log.intake_failed = count(intake.failed);
          if (typeof intake.stop_code === "string" && FIXED_WORD_PATTERN.test(intake.stop_code)) {
            log.intake_stop = intake.stop_code;
          }
          if (typeof intake.last_error_code === "string" && ERROR_CODE_PATTERN.test(intake.last_error_code)) {
            log.intake_error = intake.last_error_code;
          }
        }
      } catch (error) {
        if (!(error instanceof TelephonyDatabaseError)) throw error;
        log.intake = "failed";
        automationFailed = true;
      }
      log.settled = count(settled.settled);
      log.settle_flagged = count(settled.flagged);
      log.settle_failed = count(settled.failed);
      // Missed-call automation (T8): the decisions the quiet window waits for.
      // The database answers `disabled` while its flags are off.
      try {
        const automation = await rpc("telephony_automation_tick_v1", {
          p_organization_id: organizationId,
          p_limit: AUTOMATION_BATCH,
        });
        log.automation = typeof automation.status === "string" && FIXED_WORD_PATTERN.test(automation.status)
          ? automation.status
          : "unknown";
        if (log.automation === "ok" || log.automation === "stopped") {
          log.automation_created = count(automation.created) + count(automation.callback_tasks);
          log.automation_merged = count(automation.merged);
          log.automation_closed = count(automation.closed) + count(automation.cancelled);
          log.automation_failed = count(automation.failed);
          if (typeof automation.stop_code === "string" && FIXED_WORD_PATTERN.test(automation.stop_code)) {
            log.automation_stop = automation.stop_code;
          }
          if (typeof automation.last_error_code === "string" && ERROR_CODE_PATTERN.test(automation.last_error_code)) {
            log.automation_error = automation.last_error_code;
          }
        }
      } catch (error) {
        if (!(error instanceof TelephonyDatabaseError)) throw error;
        log.automation = "failed";
        automationFailed = true;
      }
    }
    if (plan.retryDue || plan.settleDue) await mark("tick");

    // -- PBX jobs. -----------------------------------------------------------
    const pbxConfig = readPlatformTelephonyPbxConfig(dependencies.environment);
    if (pbxConfig.status !== "ready") {
      log.pbx = pbxConfig.status === "invalid" ? `invalid_${pbxConfig.reason}` : "not_configured";
      return finish();
    }
    if (plan.outboundPaused) {
      log.pbx = "paused";
      return finish();
    }
    log.pbx = "ready";
    const pbx = dependencies.createPbxClient(pbxConfig.config);
    let stopped = false;

    async function guarded(
      mode: "users" | "probe" | HistoryMode,
      errorEvent: string,
      job: () => Promise<string>,
    ): Promise<void> {
      if (stopped) {
        log[mode] = "skipped_after_auth_error";
        return;
      }
      if (dependencies.now() >= deadline) {
        log[mode] = "skipped_run_budget";
        return;
      }
      try {
        log[mode] = await job();
      } catch (error) {
        if (!(error instanceof TelephonyPbxError)) throw error;
        log[mode] = `error_${error.code}`;
        if (TELEPHONY_PBX_STOPPING_ERRORS.has(error.code)) stopped = true;
        await mark(errorEvent, { errorCode: error.code });
      }
    }

    if (plan.usersDue) {
      await guarded("users", "users_error", async () => {
        const { users, complete } = await pbx.listUsers();
        if (users.length === 0 || users.length > USERS_MAX) throw new TelephonyPbxError("pbx_bad_response");
        const result = await rpc("telephony_sync_extensions_v1", {
          p_organization_id: organizationId,
          p_users: users.map((user) => ({ login: user.login, name: user.name, ext: user.ext })),
          p_complete: complete,
        });
        if (result.status !== "ok") throw new TelephonyPbxError("pbx_bad_response");
        await mark("users_ok", {
          summary: {
            users: users.length,
            inserted: count(result.inserted),
            deactivated: count(result.deactivated),
            conflicts: count(result.conflicts),
            reactivated: count(result.reactivated),
          },
        });
        return "ok";
      });
    }

    if (plan.probeDue) {
      await guarded("probe", "probe_error", async () => {
        const domain = await pbx.getDomain();
        const record = await pbx.getRecordSettings();
        const groups = await pbx.countGroups();
        const facts: JsonObject = { groups_total: groups };
        if (domain.timezoneName !== null && ZONE_NAME_PATTERN.test(domain.timezoneName)) {
          facts.timezone_name = domain.timezoneName;
        }
        if (domain.timezoneOffsetMinutes !== null) facts.timezone_offset_minutes = domain.timezoneOffsetMinutes;
        if (domain.usersUsed !== null) facts.users_used = domain.usersUsed;
        if (domain.usersTotal !== null) facts.users_total = domain.usersTotal;
        if (domain.recordService !== null) facts.record_service = domain.recordService;
        if (record.external !== null) facts.record_external = record.external;
        if (record.inner !== null) facts.record_inner = record.inner;
        if (record.exceptions !== null) facts.record_exceptions = record.exceptions;
        await mark("probe_ok", { facts });
        return "ok";
      });
    }

    // At most one history job per run: reconcile, else daily, else one import window.
    const historyJob: Readonly<{ mode: HistoryMode; window: Window }> | null = plan.reconcile.due
      ? { mode: "reconcile", window: plan.reconcile }
      : plan.daily.due
        ? { mode: "daily", window: plan.daily }
        : plan.backfill.due
          ? { mode: "backfill", window: plan.backfill }
          : null;
    if (historyJob !== null) {
      const { mode, window } = historyJob;
      await guarded(mode, `${mode}_error`, async () => {
        const seen = new Map<string, TelephonyPbxHistoryRow>();
        const anonymous: TelephonyPbxHistoryRow[] = [];
        const budget = { requests: 0 };

        async function collect(startMs: number, endMs: number, depth: number): Promise<void> {
          if (budget.requests >= HISTORY_MAX_REQUESTS) throw new TelephonyPbxError("pbx_window_too_dense");
          if (dependencies.now() >= deadline) throw new TelephonyPbxError("pbx_timeout");
          if (budget.requests > 0) await dependencies.sleep(HISTORY_PAUSE_MS);
          budget.requests += 1;
          const result = await pbx.getHistory({
            start: new Date(startMs),
            end: new Date(endMs),
            limit: TELEPHONY_PBX_HISTORY_LIMIT,
          });
          if (result.full) {
            if (endMs - startMs <= HISTORY_MIN_SPLIT_MS || depth >= HISTORY_MAX_DEPTH) {
              throw new TelephonyPbxError("pbx_window_too_dense");
            }
            const middle = startMs + Math.floor((endMs - startMs) / 2);
            await collect(startMs, middle, depth + 1);
            await collect(middle, endMs, depth + 1);
            return;
          }
          for (const row of result.rows) {
            const uid = row.uid === undefined ? "" : String(row.uid);
            if (uid === "") anonymous.push(row);
            else seen.set(uid, row);
          }
        }

        await collect(window.start.getTime(), window.end.getTime(), 0);
        const rows = [...seen.values(), ...anonymous];
        const totals = {
          rows: rows.length,
          created: 0,
          updated: 0,
          unchanged: 0,
          invalid: 0,
          dropped: 0,
          suspected_duplicates: 0,
          links_set: 0,
          failed: 0,
        };
        // The daily job is a reconcile of «yesterday» and uses the same writer.
        const writerMode = mode === "backfill" ? "backfill" : "reconcile";
        for (let index = 0; index < rows.length; index += APPLY_BATCH) {
          const result = await rpc("telephony_reconcile_apply_v1", {
            p_organization_id: organizationId,
            p_mode: writerMode,
            p_rows: rows.slice(index, index + APPLY_BATCH),
          });
          if (result.status !== "ok") {
            // The flag was switched off (or the directory emptied) after the
            // plan was read: nothing is marked, the next plan decides again.
            return `skipped_${typeof result.status === "string" && /^[a-z_]{1,32}$/u.test(result.status) ? result.status : "unknown"}`;
          }
          totals.created += count(result.created);
          totals.updated += count(result.updated);
          totals.unchanged += count(result.unchanged);
          totals.invalid += count(result.invalid);
          totals.dropped += count(result.dropped);
          totals.suspected_duplicates += count(result.suspected_duplicates);
          totals.links_set += count(result.links_set);
          totals.failed += count(result.failed);
        }
        await mark(`${mode}_ok`, {
          ...(mode === "reconcile" ? { cursor: window.end } : {}),
          ...(mode === "backfill" ? { cursor: window.start } : {}),
          summary: { ...totals, requests: budget.requests, windows: 1 },
        });
        log[`${mode}_rows`] = totals.rows;
        log[`${mode}_created`] = totals.created;
        log[`${mode}_failed`] = totals.failed;
        log[`${mode}_requests`] = budget.requests;
        return "ok";
      });
    }

    return finish();
  } catch (error) {
    log.status = "failed";
    log.reason = error instanceof TelephonyDatabaseError ? "database_error" : "internal_error";
    return Object.freeze({ exitCode: 1, log });
  }
}
