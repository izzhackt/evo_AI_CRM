/**
 * «Настройки → Телефония» (план телефонии §5.5, §6.3, §6.4, §9.1, §11, §12; срез
 * T4b): контракт данных экрана без чтений и без браузера. Здесь разбор ответа
 * `platform.telephony_manage_overview_v1` (миграция 295), черновик формы с
 * проверками, повторяющими CHECK таблицы настроек (288), патч для
 * `telephony_settings_save_v1` и русские слова экрана. Решает база: проверки
 * здесь только избавляют человека от лишнего круга.
 *
 * Номеров, ссылок, ключей и логинов в разборе, кроме логина пользователя ВАТС в
 * таблице сопоставления (его видит только держатель `telephony.manage`), нет:
 * здоровье интеграции состоит из чисел, времён и слов.
 */

/** Границы столбцов `telephony_settings` (288); те же числа в `min`/`max` полей. */
export const TELEPHONY_BOUNDS = Object.freeze({
  callbackWorkMinutes: Object.freeze({ min: 1, max: 480 }),
  limitUserDay: Object.freeze({ min: 1, max: 1000 }),
  limitUserGapSeconds: Object.freeze({ min: 1, max: 3600 }),
  limitOrgHour: Object.freeze({ min: 1, max: 1000 }),
  limitOrgDay: Object.freeze({ min: 1, max: 5000 }),
  ceilingLeadsHour: Object.freeze({ min: 1, max: 100 }),
  ceilingLeadsDay: Object.freeze({ min: 1, max: 400 }),
  ceilingTasksHour: Object.freeze({ min: 1, max: 300 }),
  ceilingTasksDay: Object.freeze({ min: 1, max: 1200 }),
});
export const TELEPHONY_PREFIX_LIMIT = 20;

export const TELEPHONY_FLAG_KEYS = Object.freeze([
  "projectionEnabled",
  "uiEnabled",
  "dialEnabled",
  "missedTaskEnabled",
  "unknownLeadEnabled",
  "backfillEnabled",
  "outboundPaused",
] as const);
export type TelephonyFlagKey = (typeof TELEPHONY_FLAG_KEYS)[number];

export const TELEPHONY_NUMBER_KEYS = Object.freeze([
  "callbackWorkMinutes",
  "limitUserDay",
  "limitUserGapSeconds",
  "limitOrgHour",
  "limitOrgDay",
  "ceilingLeadsHour",
  "ceilingLeadsDay",
  "ceilingTasksHour",
  "ceilingTasksDay",
] as const);
export type TelephonyNumberKey = (typeof TELEPHONY_NUMBER_KEYS)[number];

/** Все ключи патча правки (как в `telephony_settings_save_v1`). */
export const TELEPHONY_PATCH_KEYS = Object.freeze([
  ...TELEPHONY_FLAG_KEYS,
  ...TELEPHONY_NUMBER_KEYS,
  "workingDays",
  "workFrom",
  "workTo",
  "escalationMembershipId",
  "dialPrefixes",
] as const);

export type TelephonySettings = Readonly<{
  version: number;
  updatedAt: string | null;
  flags: Readonly<Record<TelephonyFlagKey, boolean>>;
  hours: Readonly<{
    timezone: string;
    workingDays: readonly number[];
    workFrom: string;
    workTo: string;
    callbackWorkMinutes: number;
  }>;
  escalationMembershipId: string | null;
  dial: Readonly<{
    prefixes: readonly string[];
    limitUserDay: number;
    limitUserGapSeconds: number;
    limitOrgHour: number;
    limitOrgDay: number;
  }>;
  ceilings: Readonly<{ leadsHour: number; leadsDay: number; tasksHour: number; tasksDay: number }>;
}>;

export type TelephonyAutomationStopCode = "leads_hour" | "leads_day" | "tasks_hour" | "tasks_day";

export type TelephonyPbxFacts = Readonly<{
  recordService: boolean | null;
  recordExternal: boolean | null;
  recordInner: boolean | null;
  recordExceptions: number | null;
  usersUsed: number | null;
  usersTotal: number | null;
}>;

/** Здоровье интеграции (`telephony_health_snapshot`): числа, времена и слова. */
export type TelephonyHealth = Readonly<{
  directory: Readonly<{ active: number; inactive: number; unmapped: number; lastSeenAt: string | null }>;
  schedule: Readonly<{
    usersSyncSuccessAt: string | null;
    reconcileSuccessAt: string | null;
    reconcileCursorAt: string | null;
    reconcileLagSeconds: number | null;
    reconcileDailySuccessAt: string | null;
    backfillCursorAt: string | null;
    backfillDoneAt: string | null;
    probeSuccessAt: string | null;
  }>;
  pbx: Readonly<{
    lastOkAt: string | null;
    lastErrorAt: string | null;
    lastErrorCode: string | null;
    facts: TelephonyPbxFacts;
  }>;
  lastEventAt: string | null;
  evidence: Readonly<{ received: number; rejected: number; incomplete: number }>;
  automationStop: Readonly<{ stoppedAt: string; code: TelephonyAutomationStopCode }> | null;
  divergence: Readonly<{ reconciledCalls: number; calls: number }>;
}>;

export type TelephonyExtension = Readonly<{
  id: string;
  login: string;
  extension: string | null;
  name: string | null;
  active: boolean;
  membershipId: string | null;
  membershipName: string | null;
  lastSeenAt: string | null;
  /** Ноги звонков этого пользователя ВАТС, сохранённые до сопоставления: сотрудника у них нет. */
  legsWithoutStaff: number;
}>;

export type TelephonyStaffOption = Readonly<{ membershipId: string; name: string; canManage: boolean }>;

export type TelephonyEscalation = Readonly<{ membershipId: string; name: string; allowed: boolean }>;

export type TelephonyOverview = Readonly<{
  organizationId: string;
  now: string;
  settings: TelephonySettings;
  escalation: TelephonyEscalation | null;
  health: TelephonyHealth;
  extensions: readonly TelephonyExtension[];
  staff: readonly TelephonyStaffOption[];
}>;

/* ------------------------------------------------------------- разбор */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CLOCK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/u;
const PREFIX = /^\+[1-9][0-9]{0,3}$/u;
const STOP_CODES: ReadonlySet<string> = new Set(["leads_hour", "leads_day", "tasks_hour", "tasks_day"]);

export const isTelephonyUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const present = Object.keys(row);
  return present.length === keys.length && keys.every((key) => Object.hasOwn(row, key)) ? row : null;
}
function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function int(value: unknown, min = 0): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min ? value : null;
}
function text(value: unknown, max = 200): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}
function time(value: unknown): string | null {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(new Date(value).valueOf()) ? value : null;
}
function timeOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  const parsed = time(value);
  return parsed === null ? undefined : parsed;
}
function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function settingsFrom(value: unknown): TelephonySettings | null {
  const row = record(value, ["version", "updatedAt", "flags", "hours", "escalationMembershipId", "dial", "ceilings"]);
  if (!row) return null;
  const flagsRow = record(row.flags, TELEPHONY_FLAG_KEYS);
  const hoursRow = record(row.hours, ["timezone", "workingDays", "workFrom", "workTo", "callbackWorkMinutes"]);
  const dialRow = record(row.dial, ["prefixes", "limitUserDay", "limitUserGapSeconds", "limitOrgHour", "limitOrgDay"]);
  const ceilingRow = record(row.ceilings, ["leadsHour", "leadsDay", "tasksHour", "tasksDay"]);
  const version = int(row.version, 1);
  const updatedAt = timeOrNull(row.updatedAt);
  if (!flagsRow || !hoursRow || !dialRow || !ceilingRow || version === null || updatedAt === undefined) return null;
  const flags = {} as Record<TelephonyFlagKey, boolean>;
  for (const key of TELEPHONY_FLAG_KEYS) {
    const flag = bool(flagsRow[key]);
    if (flag === null) return null;
    flags[key] = flag;
  }
  const days = hoursRow.workingDays;
  if (!Array.isArray(days) || days.length < 1 || days.length > 7
    || days.some((day) => int(day, 1) === null || (day as number) > 7) || new Set(days).size !== days.length) return null;
  const callback = int(hoursRow.callbackWorkMinutes, 1);
  const timezone = text(hoursRow.timezone, 64);
  if (callback === null || timezone === null || typeof hoursRow.workFrom !== "string" || !CLOCK.test(hoursRow.workFrom)
    || typeof hoursRow.workTo !== "string" || !CLOCK.test(hoursRow.workTo)) return null;
  const prefixes = dialRow.prefixes;
  if (!Array.isArray(prefixes) || prefixes.length < 1 || prefixes.length > TELEPHONY_PREFIX_LIMIT
    || prefixes.some((prefix) => typeof prefix !== "string" || !PREFIX.test(prefix))) return null;
  const limits = [int(dialRow.limitUserDay, 1), int(dialRow.limitUserGapSeconds, 1), int(dialRow.limitOrgHour, 1), int(dialRow.limitOrgDay, 1)];
  const ceilings = [int(ceilingRow.leadsHour, 1), int(ceilingRow.leadsDay, 1), int(ceilingRow.tasksHour, 1), int(ceilingRow.tasksDay, 1)];
  if (limits.includes(null) || ceilings.includes(null)) return null;
  const escalation = row.escalationMembershipId;
  if (escalation !== null && !isTelephonyUuid(escalation)) return null;
  return Object.freeze({
    version,
    updatedAt,
    flags: Object.freeze(flags),
    hours: Object.freeze({
      timezone,
      workingDays: Object.freeze([...(days as number[])].sort((a, b) => a - b)),
      workFrom: hoursRow.workFrom,
      workTo: hoursRow.workTo,
      callbackWorkMinutes: callback,
    }),
    escalationMembershipId: escalation,
    dial: Object.freeze({
      prefixes: Object.freeze([...(prefixes as string[])]),
      limitUserDay: limits[0] as number,
      limitUserGapSeconds: limits[1] as number,
      limitOrgHour: limits[2] as number,
      limitOrgDay: limits[3] as number,
    }),
    ceilings: Object.freeze({
      leadsHour: ceilings[0] as number,
      leadsDay: ceilings[1] as number,
      tasksHour: ceilings[2] as number,
      tasksDay: ceilings[3] as number,
    }),
  });
}

function factsFrom(value: unknown): TelephonyPbxFacts | null {
  if (value === null) {
    return Object.freeze({ recordService: null, recordExternal: null, recordInner: null, recordExceptions: null, usersUsed: null, usersTotal: null });
  }
  const row = objectOrNull(value);
  if (!row) return null;
  const optionalBool = (key: string) => (row[key] === undefined ? null : bool(row[key]));
  const optionalInt = (key: string) => (row[key] === undefined ? null : int(row[key], 0));
  const facts = {
    recordService: optionalBool("record_service"),
    recordExternal: optionalBool("record_external"),
    recordInner: optionalBool("record_inner"),
    recordExceptions: optionalInt("record_exceptions"),
    usersUsed: optionalInt("users_used"),
    usersTotal: optionalInt("users_total"),
  };
  // Известное, но неверного вида значение — порча ответа, а не «нет данных».
  for (const [key, field] of [["record_service", facts.recordService], ["record_external", facts.recordExternal],
    ["record_inner", facts.recordInner], ["record_exceptions", facts.recordExceptions],
    ["users_used", facts.usersUsed], ["users_total", facts.usersTotal]] as const) {
    if (row[key] !== undefined && field === null) return null;
  }
  return Object.freeze(facts);
}

function healthFrom(value: unknown): TelephonyHealth | null {
  const row = objectOrNull(value);
  if (!row || row.status !== "ok") return null;
  const directory = objectOrNull(row.directory);
  const schedule = objectOrNull(row.schedule);
  const pbx = objectOrNull(row.pbx);
  const evidence = objectOrNull(row.evidence);
  const stop = objectOrNull(row.automation_stop);
  const divergence = objectOrNull(row.divergence);
  if (!directory || !schedule || !pbx || !evidence || !stop || !divergence) return null;
  const facts = factsFrom(pbx.facts ?? null);
  const times = {
    lastSeenAt: timeOrNull(directory.last_seen_at),
    usersSyncSuccessAt: timeOrNull(schedule.users_sync_success_at),
    reconcileSuccessAt: timeOrNull(schedule.reconcile_success_at),
    reconcileCursorAt: timeOrNull(schedule.reconcile_cursor_at),
    reconcileDailySuccessAt: timeOrNull(schedule.reconcile_daily_success_at),
    backfillCursorAt: timeOrNull(schedule.backfill_cursor_at),
    backfillDoneAt: timeOrNull(schedule.backfill_done_at),
    probeSuccessAt: timeOrNull(schedule.probe_success_at),
    lastOkAt: timeOrNull(pbx.last_ok_at),
    lastErrorAt: timeOrNull(pbx.last_error_at),
    lastEventAt: timeOrNull(row.last_event_at),
    stoppedAt: timeOrNull(stop.stopped_at),
  };
  if (!facts || Object.values(times).some((item) => item === undefined)) return null;
  const counts = [int(directory.active), int(directory.inactive), int(directory.unmapped), int(evidence.received),
    int(evidence.rejected), int(evidence.incomplete), int(divergence.reconciled_calls), int(divergence.calls)];
  if (counts.includes(null)) return null;
  const lag = schedule.reconcile_lag_seconds === null || schedule.reconcile_lag_seconds === undefined ? null : int(schedule.reconcile_lag_seconds);
  if (schedule.reconcile_lag_seconds !== null && schedule.reconcile_lag_seconds !== undefined && lag === null) return null;
  const errorCode = pbx.last_error_code === null || pbx.last_error_code === undefined ? null : text(pbx.last_error_code, 64);
  if (pbx.last_error_code !== null && pbx.last_error_code !== undefined && (errorCode === null || !/^[a-z][a-z0-9_]{0,63}$/u.test(errorCode))) return null;
  let automationStop: TelephonyHealth["automationStop"] = null;
  if (stop.code !== null && stop.code !== undefined) {
    if (typeof stop.code !== "string" || !STOP_CODES.has(stop.code) || !times.stoppedAt) return null;
    automationStop = Object.freeze({ stoppedAt: times.stoppedAt, code: stop.code as TelephonyAutomationStopCode });
  }
  return Object.freeze({
    directory: Object.freeze({ active: counts[0] as number, inactive: counts[1] as number, unmapped: counts[2] as number, lastSeenAt: times.lastSeenAt as string | null }),
    schedule: Object.freeze({
      usersSyncSuccessAt: times.usersSyncSuccessAt as string | null,
      reconcileSuccessAt: times.reconcileSuccessAt as string | null,
      reconcileCursorAt: times.reconcileCursorAt as string | null,
      reconcileLagSeconds: lag,
      reconcileDailySuccessAt: times.reconcileDailySuccessAt as string | null,
      backfillCursorAt: times.backfillCursorAt as string | null,
      backfillDoneAt: times.backfillDoneAt as string | null,
      probeSuccessAt: times.probeSuccessAt as string | null,
    }),
    pbx: Object.freeze({
      lastOkAt: times.lastOkAt as string | null,
      lastErrorAt: times.lastErrorAt as string | null,
      lastErrorCode: errorCode,
      facts,
    }),
    lastEventAt: times.lastEventAt as string | null,
    evidence: Object.freeze({ received: counts[3] as number, rejected: counts[4] as number, incomplete: counts[5] as number }),
    automationStop,
    divergence: Object.freeze({ reconciledCalls: counts[6] as number, calls: counts[7] as number }),
  });
}

/** Ответ `telephony_manage_overview_v1`; любое отклонение от формы — `null`, экран говорит «недоступно». */
export function normalizeTelephonyOverview(data: unknown): TelephonyOverview | null {
  const row = record(data, ["schemaVersion", "organizationId", "now", "settings", "escalation", "health", "extensions", "staff"]);
  if (!row || row.schemaVersion !== 1 || !isTelephonyUuid(row.organizationId)) return null;
  const now = time(row.now);
  const settings = settingsFrom(row.settings);
  const health = healthFrom(row.health);
  if (!now || !settings || !health || !Array.isArray(row.extensions) || !Array.isArray(row.staff)) return null;
  let escalation: TelephonyEscalation | null = null;
  if (row.escalation !== null) {
    const raw = record(row.escalation, ["membershipId", "name", "allowed"]);
    const name = raw ? text(raw.name, 200) : null;
    if (!raw || !isTelephonyUuid(raw.membershipId) || name === null || typeof raw.allowed !== "boolean") return null;
    escalation = Object.freeze({ membershipId: raw.membershipId, name, allowed: raw.allowed });
  }
  const extensions: TelephonyExtension[] = [];
  for (const item of row.extensions) {
    const raw = record(item, ["id", "login", "extension", "name", "active", "membershipId", "membershipName", "lastSeenAt", "legsWithoutStaff"]);
    if (!raw) return null;
    const login = text(raw.login, 128);
    const lastSeenAt = timeOrNull(raw.lastSeenAt);
    const legs = int(raw.legsWithoutStaff);
    const optionalText = (value: unknown) => (value === null ? null : text(value, 200));
    if (!isTelephonyUuid(raw.id) || !login || typeof raw.active !== "boolean" || lastSeenAt === undefined || legs === null
      || (raw.membershipId !== null && !isTelephonyUuid(raw.membershipId))
      || (raw.extension !== null && optionalText(raw.extension) === null) || (raw.name !== null && optionalText(raw.name) === null)
      || (raw.membershipName !== null && optionalText(raw.membershipName) === null)) return null;
    extensions.push(Object.freeze({
      id: raw.id, login, extension: raw.extension as string | null, name: raw.name as string | null, active: raw.active,
      membershipId: raw.membershipId as string | null, membershipName: raw.membershipName as string | null,
      lastSeenAt, legsWithoutStaff: legs,
    }));
  }
  const staff: TelephonyStaffOption[] = [];
  for (const item of row.staff) {
    const raw = record(item, ["membershipId", "name", "canManage"]);
    const name = raw ? text(raw.name, 200) : null;
    if (!raw || !isTelephonyUuid(raw.membershipId) || !name || typeof raw.canManage !== "boolean") return null;
    staff.push(Object.freeze({ membershipId: raw.membershipId, name, canManage: raw.canManage }));
  }
  return Object.freeze({
    organizationId: row.organizationId, now, settings, escalation, health,
    extensions: Object.freeze(extensions), staff: Object.freeze(staff),
  });
}

/* --------------------------------------------------- квитанции команд */

export type TelephonySaveReceipt = Readonly<{
  status: "saved" | "unchanged";
  version: number;
  changed: readonly string[];
  automationStopCleared: boolean;
  replayed: boolean;
}>;

/** Квитанция `telephony_settings_save_v1`: только то, что нужно экрану (без самих настроек). */
export function normalizeTelephonySaveReceipt(data: unknown): TelephonySaveReceipt | null {
  const row = objectOrNull(data);
  if (!row || (row.status !== "saved" && row.status !== "unchanged")) return null;
  const version = int(row.version, 1);
  const changed = row.changed;
  if (version === null || !Array.isArray(changed)
    || changed.some((key) => typeof key !== "string" || !(TELEPHONY_PATCH_KEYS as readonly string[]).includes(key))
    || typeof row.replayed !== "boolean") return null;
  const cleared = row.automationStopCleared === undefined ? false : row.automationStopCleared;
  if (typeof cleared !== "boolean") return null;
  return Object.freeze({ status: row.status, version, changed: Object.freeze([...(changed as string[])]), automationStopCleared: cleared, replayed: row.replayed });
}

export type TelephonyMapReceipt = Readonly<{
  status: "saved" | "unchanged";
  extensionId: string;
  membershipId: string | null;
  unmapped: number;
  replayed: boolean;
}>;

export function normalizeTelephonyMapReceipt(data: unknown): TelephonyMapReceipt | null {
  const row = objectOrNull(data);
  if (!row || (row.status !== "saved" && row.status !== "unchanged") || !isTelephonyUuid(row.extensionId)
    || (row.membershipId !== null && !isTelephonyUuid(row.membershipId)) || int(row.unmapped) === null
    || typeof row.replayed !== "boolean") return null;
  return Object.freeze({
    status: row.status, extensionId: row.extensionId, membershipId: row.membershipId as string | null,
    unmapped: row.unmapped as number, replayed: row.replayed,
  });
}

/* ------------------------------------------------ патч и его проверка */

export type TelephonyPatch = Readonly<Partial<Record<TelephonyFlagKey, boolean>
  & Record<TelephonyNumberKey, number>
  & { workingDays: readonly number[]; workFrom: string; workTo: string; escalationMembershipId: string | null; dialPrefixes: readonly string[] }>>;

/**
 * Форма патча до отправки в базу: известные ключи, нужные виды значений. Тот же
 * набор правил, что у базы, без границ значений (их держат CHECK таблицы).
 */
export function isTelephonyPatchShape(value: unknown): value is TelephonyPatch {
  const row = objectOrNull(value);
  if (!row) return false;
  const keys = Object.keys(row);
  if (keys.length === 0) return false;
  for (const key of keys) {
    const item = row[key];
    if ((TELEPHONY_FLAG_KEYS as readonly string[]).includes(key)) {
      if (typeof item !== "boolean") return false;
    } else if ((TELEPHONY_NUMBER_KEYS as readonly string[]).includes(key)) {
      if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 0 || item > 99_999) return false;
    } else if (key === "workingDays") {
      if (!Array.isArray(item) || item.length < 1 || item.length > 14 || item.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) return false;
    } else if (key === "dialPrefixes") {
      if (!Array.isArray(item) || item.length < 1 || item.length > 40 || item.some((prefix) => typeof prefix !== "string" || !PREFIX.test(prefix))) return false;
    } else if (key === "workFrom" || key === "workTo") {
      if (typeof item !== "string" || !CLOCK.test(item)) return false;
    } else if (key === "escalationMembershipId") {
      if (item !== null && !(typeof item === "string" && UUID.test(item) && item === item.toLowerCase())) return false;
    } else {
      return false;
    }
  }
  return true;
}

/** Черновик формы: числа — строками (поле бывает пустым), дни — отметками. */
export type TelephonyDraft = Readonly<{
  flags: Readonly<Record<TelephonyFlagKey, boolean>>;
  workingDays: readonly number[];
  workFrom: string;
  workTo: string;
  numbers: Readonly<Record<TelephonyNumberKey, string>>;
  prefixes: string;
  escalationMembershipId: string;
}>;

export function telephonyDraftFrom(settings: TelephonySettings): TelephonyDraft {
  return Object.freeze({
    flags: settings.flags,
    workingDays: settings.hours.workingDays,
    workFrom: settings.hours.workFrom,
    workTo: settings.hours.workTo,
    numbers: Object.freeze({
      callbackWorkMinutes: String(settings.hours.callbackWorkMinutes),
      limitUserDay: String(settings.dial.limitUserDay),
      limitUserGapSeconds: String(settings.dial.limitUserGapSeconds),
      limitOrgHour: String(settings.dial.limitOrgHour),
      limitOrgDay: String(settings.dial.limitOrgDay),
      ceilingLeadsHour: String(settings.ceilings.leadsHour),
      ceilingLeadsDay: String(settings.ceilings.leadsDay),
      ceilingTasksHour: String(settings.ceilings.tasksHour),
      ceilingTasksDay: String(settings.ceilings.tasksDay),
    }),
    prefixes: settings.dial.prefixes.join(", "),
    escalationMembershipId: settings.escalationMembershipId ?? "",
  });
}

/** «+996, 7  +992» → ["+996", "+7", "+992"]; лишнее и неверное — в `invalid`. */
export function parseTelephonyPrefixes(input: string): Readonly<{ list: readonly string[]; invalid: readonly string[] }> {
  const list: string[] = [];
  const invalid: string[] = [];
  for (const raw of input.split(/[\s,;]+/u)) {
    const token = raw.trim();
    if (!token) continue;
    const prefixed = /^[1-9][0-9]{0,3}$/u.test(token) ? `+${token}` : token;
    if (!PREFIX.test(prefixed)) invalid.push(token);
    else if (!list.includes(prefixed)) list.push(prefixed);
  }
  return Object.freeze({ list: Object.freeze(list), invalid: Object.freeze(invalid) });
}

export type TelephonyIssue = Readonly<{ field: string; message: string }>;

const NUMBER_LABEL: Readonly<Record<TelephonyNumberKey, string>> = Object.freeze({
  callbackWorkMinutes: "Срок перезвона",
  limitUserDay: "Звонков на сотрудника в сутки",
  limitUserGapSeconds: "Пауза между звонками сотрудника",
  limitOrgHour: "Звонков в час на всех",
  limitOrgDay: "Звонков в сутки на всех",
  ceilingLeadsHour: "Новых лидов в час",
  ceilingLeadsDay: "Новых лидов в сутки",
  ceilingTasksHour: "Задач в час",
  ceilingTasksDay: "Задач в сутки",
});
export const TELEPHONY_NUMBER_LABEL = NUMBER_LABEL;

function parsedNumber(value: string): number | null {
  const trimmed = value.trim();
  return /^[0-9]{1,5}$/u.test(trimmed) ? Number(trimmed) : null;
}

/** Ошибки черновика; те же правила, что CHECK таблицы настроек (288) и функция сохранения (295). */
export function telephonyDraftIssues(draft: TelephonyDraft): readonly TelephonyIssue[] {
  const issues: TelephonyIssue[] = [];
  const values = {} as Record<TelephonyNumberKey, number>;
  for (const key of TELEPHONY_NUMBER_KEYS) {
    const parsed = parsedNumber(draft.numbers[key]);
    const bounds = TELEPHONY_BOUNDS[key];
    if (parsed === null || parsed < bounds.min || parsed > bounds.max) {
      issues.push({ field: key, message: `${NUMBER_LABEL[key]}: целое число от ${bounds.min} до ${bounds.max}.` });
    } else {
      values[key] = parsed;
    }
  }
  if (values.limitOrgHour !== undefined && values.limitOrgDay !== undefined && values.limitOrgHour > values.limitOrgDay) {
    issues.push({ field: "limitOrgHour", message: "Звонков в час не может быть больше, чем в сутки." });
  }
  if (values.ceilingLeadsHour !== undefined && values.ceilingLeadsDay !== undefined && values.ceilingLeadsHour > values.ceilingLeadsDay) {
    issues.push({ field: "ceilingLeadsHour", message: "Лидов в час не может быть больше, чем в сутки." });
  }
  if (values.ceilingTasksHour !== undefined && values.ceilingTasksDay !== undefined && values.ceilingTasksHour > values.ceilingTasksDay) {
    issues.push({ field: "ceilingTasksHour", message: "Задач в час не может быть больше, чем в сутки." });
  }
  if (!CLOCK.test(draft.workFrom)) issues.push({ field: "workFrom", message: "Начало рабочего дня: время вида 10:00." });
  if (!CLOCK.test(draft.workTo)) issues.push({ field: "workTo", message: "Конец рабочего дня: время вида 20:00." });
  if (CLOCK.test(draft.workFrom) && CLOCK.test(draft.workTo) && draft.workFrom >= draft.workTo) {
    issues.push({ field: "workTo", message: "Рабочий день должен кончаться позже, чем начинается." });
  }
  if (draft.workingDays.length === 0) issues.push({ field: "workingDays", message: "Отметьте хотя бы один рабочий день." });
  const prefixes = parseTelephonyPrefixes(draft.prefixes);
  if (prefixes.invalid.length > 0) {
    issues.push({ field: "dialPrefixes", message: `Не похоже на код страны: ${prefixes.invalid.slice(0, 3).join(", ")}. Пример: +996.` });
  } else if (prefixes.list.length === 0) {
    issues.push({ field: "dialPrefixes", message: "Укажите хотя бы один код страны, например +996." });
  } else if (prefixes.list.length > TELEPHONY_PREFIX_LIMIT) {
    issues.push({ field: "dialPrefixes", message: `Не больше ${TELEPHONY_PREFIX_LIMIT} кодов стран.` });
  }
  const { flags } = draft;
  if ((flags.missedTaskEnabled || flags.unknownLeadEnabled || flags.backfillEnabled) && !flags.projectionEnabled) {
    issues.push({ field: "projectionEnabled", message: "Задачи, лиды по неизвестным номерам и первичный импорт работают только поверх разбора звонков: включите разбор." });
  }
  return issues;
}

/** Патч только из изменённых полей; `null` — менять нечего. Вызывать после `telephonyDraftIssues` без ошибок. */
export function telephonyPatchFrom(settings: TelephonySettings, draft: TelephonyDraft): TelephonyPatch | null {
  const patch: Record<string, unknown> = {};
  for (const key of TELEPHONY_FLAG_KEYS) if (draft.flags[key] !== settings.flags[key]) patch[key] = draft.flags[key];
  const current = telephonyDraftFrom(settings);
  for (const key of TELEPHONY_NUMBER_KEYS) {
    if (draft.numbers[key].trim() !== current.numbers[key]) patch[key] = parsedNumber(draft.numbers[key]);
  }
  const days = [...draft.workingDays].sort((a, b) => a - b);
  if (days.join(",") !== settings.hours.workingDays.join(",")) patch.workingDays = days;
  if (draft.workFrom !== settings.hours.workFrom) patch.workFrom = draft.workFrom;
  if (draft.workTo !== settings.hours.workTo) patch.workTo = draft.workTo;
  const prefixes = parseTelephonyPrefixes(draft.prefixes).list;
  if ([...prefixes].sort().join(",") !== [...settings.dial.prefixes].sort().join(",")) patch.dialPrefixes = prefixes;
  if ((draft.escalationMembershipId || null) !== settings.escalationMembershipId) patch.escalationMembershipId = draft.escalationMembershipId || null;
  return Object.keys(patch).length === 0 ? null : (patch as TelephonyPatch);
}

/**
 * Флаги, которые это сохранение «открывает» (план §9.1): интерфейс, набор,
 * задачи, лиды, разбор, первичный импорт — включением; исходящие — снятием
 * паузы. Для них форма просит отметить, что человек понимает последствия.
 */
export function telephonyOpeningFlags(settings: TelephonySettings, draft: TelephonyDraft): readonly TelephonyFlagKey[] {
  return Object.freeze(TELEPHONY_FLAG_KEYS.filter((key) => (key === "outboundPaused"
    ? settings.flags.outboundPaused && !draft.flags.outboundPaused
    : !settings.flags[key] && draft.flags[key])));
}

/* ------------------------------------------------------------- слова */

export const TELEPHONY_FLAG_COPY: Readonly<Record<TelephonyFlagKey, Readonly<{ title: string; hint: string; opens: string | null }>>> = Object.freeze({
  projectionEnabled: {
    title: "Разбор звонков",
    hint: "Принятые события раскладываются в звонки: кто, когда, чем закончился. Без него сохраняются только сами события.",
    opens: "События начнут превращаться в звонки в базе.",
  },
  uiEnabled: {
    title: "Звонки видны сотрудникам",
    hint: "Строки звонков в ленте лида, «Слушать», блок «Звонки» в отчёте, строка «Телефония» в состоянии для сотрудников.",
    opens: "Сотрудники увидят звонки в CRM.",
  },
  dialEnabled: {
    title: "Кнопка «Позвонить» и результат звонка",
    hint: "Исходящий звонок из CRM на устройство менеджера. Нужен ключ ВАТС на сервере.",
    opens: "Менеджеры смогут звонить клиентам из CRM (это стоит денег).",
  },
  missedTaskEnabled: {
    title: "Задачи «Перезвонить» и «Недозвон»",
    hint: "Пропущенный входящий становится задачей со сроком; недозвон повторяется по каденсу.",
    opens: "Система начнёт создавать задачи сотрудникам.",
  },
  unknownLeadEnabled: {
    title: "Лиды «Звонок» по неизвестным номерам",
    hint: "Звонок с неизвестного номера создаёт лид в «Заявках».",
    opens: "Система начнёт создавать лиды.",
  },
  backfillEnabled: {
    title: "Первичный импорт за 30 дней",
    hint: "Однократно подтягивает метаданные и ссылки на записи за последние 30 дней для клиентов, уже заведённых в EVO. Записи не копируются.",
    opens: "Начнётся разовая загрузка истории звонков из ВАТС.",
  },
  outboundPaused: {
    title: "Пауза исходящих запросов к ВАТС",
    hint: "Останавливает набор, сверку и первичный импорт, например при смене ключа ВАТС. Приём входящих событий не останавливается.",
    opens: "Набор, сверка и импорт снова пойдут.",
  },
});

export const TELEPHONY_DAY_LABEL: Readonly<Record<number, string>> = Object.freeze({
  1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб", 7: "Вс",
});
export const TELEPHONY_DAY_NAME: Readonly<Record<number, string>> = Object.freeze({
  1: "понедельник", 2: "вторник", 3: "среда", 4: "четверг", 5: "пятница", 6: "суббота", 7: "воскресенье",
});

export const TELEPHONY_STOP_COPY: Readonly<Record<TelephonyAutomationStopCode, string>> = Object.freeze({
  leads_hour: "потолок новых лидов в час",
  leads_day: "потолок новых лидов в сутки",
  tasks_hour: "потолок задач в час",
  tasks_day: "потолок задач в сутки",
});

/** Слова ответа API на русском; код — из `{ error: { code } }`. */
export function telephonyErrorMessage(code: string | null | undefined, constraint?: string | null): string {
  if (code === "version_conflict") return "Настройки уже изменили. Обновите страницу и повторите.";
  if (code === "request_conflict") return "Этот запрос уже был с другими данными. Обновите страницу и повторите.";
  if (code === "mapping_changed") return "Сопоставление уже изменили. Обновите страницу и проверьте.";
  if (code === "membership_taken") return "Этот сотрудник уже сопоставлен с другим пользователем ВАТС.";
  if (code === "membership_invalid") return "Этого сотрудника нельзя выбрать: он не работает в CRM.";
  if (code === "extension_inactive") return "Пользователь выключен в ВАТС: его нельзя сопоставить, только снять сопоставление.";
  if (code === "projection_required") return "Сначала включите разбор звонков: без него задачи, лиды и импорт не работают.";
  if (code === "escalation_invalid") return "Получателем эскалаций может быть только администратор или руководитель телефонии.";
  if (code === "not_found") return "Пользователь ВАТС не найден. Обновите страницу.";
  if (code === "forbidden") return "Нет права менять настройки телефонии.";
  if (code === "preview") return "В просмотре роли настройки не меняются.";
  if (code === "authentication_required") return "Войдите снова.";
  if (code === "settings_invalid") {
    if (constraint === "telephony_settings_hours_check") return "Рабочий день должен кончаться позже, чем начинается.";
    if (constraint === "telephony_settings_dial_limits_check") return "Звонков в час не может быть больше, чем в сутки.";
    if (constraint === "telephony_settings_ceilings_check") return "Потолок в час не может быть больше потолка в сутки.";
    return "Проверьте значения: одно из них вне допустимых границ.";
  }
  if (code === "invalid_request") return "Проверьте данные и повторите.";
  return "Результат пока неизвестен — безопасно повторите.";
}
