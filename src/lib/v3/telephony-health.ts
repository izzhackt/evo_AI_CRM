import type { IntegrationRow } from "./settings-health.ts";
import {
  TELEPHONY_STOP_COPY,
  type TelephonyHealth,
  type TelephonyOverview,
} from "./telephony-settings.ts";

/**
 * Состояние телефонии для «Настроек» (план телефонии §12, строка «Телефония»):
 * переводит данные здоровья (числа, времена и слова из базы) и три факта
 * сервера (env) в честные состояния. Ключей, номеров, ссылок и логинов здесь нет
 * и быть не может: на входе их нет. Пока приёмка на настоящих звонках (§15) не
 * пройдена, ни одно слово не говорит «работает»: «приём включён» — факт о
 * приёме, а не оценка.
 */

/** Три факта сервера: булевы и слова, не значения env. */
export type TelephonyServerFacts = Readonly<{
  /** `EVO_PLATFORM_TELEPHONY_ENABLED=1`: приём событий и итогов открыт. */
  ingestEnabled: boolean;
  /** Ключ приёма (`…_CRM_TOKEN`) задан и правильной формы. */
  crmKey: "configured" | "missing";
  /** Идёт замена ключа приёма: задан и `…_CRM_TOKEN_NEXT`. */
  crmKeyRotating: boolean;
  /** Группа `…_PBX_TOKEN`/`_URL`/`_HOST`: «всё или ничего». */
  pbx: "ready" | "not_configured" | "invalid";
}>;

export type TelephonyTone = "ok" | "warn" | "blocked" | "off";

export type TelephonyStatusLine = Readonly<{
  id: string;
  label: string;
  value: string;
  tone: TelephonyTone;
  /** Что за этим стоит или кто это меняет; `null` — добавить нечего. */
  note: string | null;
  /** Что не работает из-за этой строки (только у «стоит проверить» и «не работает»); `null` — нечего добавить. */
  without: string | null;
  /** Работа на сервере и кто её делает («Передать техническому специалисту: …»); `null` — делается на этой странице. */
  handoff: string | null;
}>;

/**
 * Первая буква строчная — для слов внутри строки («Связь с ВАТС — ВАТС отклонила ключ»), но не у аббревиатуры:
 * «ВАТС отклонила ключ» остаётся «ВАТС…», а не «вАТС…».
 */
export function lowerFirstWord(text: string): string {
  const [first = ""] = text.split(" ");
  return /^[А-ЯЁA-Z]{2,}[.,;:]?$/u.test(first) ? text : `${text.charAt(0).toLocaleLowerCase("ru")}${text.slice(1)}`;
}

const MS_DAY = 86_400_000;
/** Тишина дольше двух суток при открытом приёме — повод посмотреть (в воскресенье звонков мало). */
export const TELEPHONY_QUIET_DAYS = 2;

/** «17.10 12:00» по Бишкеку; год — только если не текущий. */
export function formatTelephonyTime(value: string | null, now: Date): string | null {
  const parsed = value ? new Date(value) : null;
  if (!parsed || !Number.isFinite(parsed.valueOf()) || !Number.isFinite(now.valueOf())) return null;
  const parts = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Bishkek", year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const at = parts(parsed);
  const year = at.year === parts(now).year ? "" : `.${at.year}`;
  return `${at.day}.${at.month}${year} ${at.hour}:${at.minute}`;
}

const KEY_REJECTED = new Set(["pbx_invalid_token", "pbx_unauthorized"]);
const SWITCHED_OFF = new Set(["pbx_crm_disabled", "pbx_crm_switched_off"]);

type PbxLink =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "ok"; at: string }>
  | Readonly<{ kind: "error"; word: string; tone: "blocked" | "warn"; at: string; pbxKeyProblem: boolean }>;

/** Связь с ВАТС по последним отметкам: ошибка считается живой, пока после неё не было успеха. */
function pbxLink(health: TelephonyHealth): PbxLink {
  const { lastOkAt, lastErrorAt, lastErrorCode } = health.pbx;
  const errorIsCurrent = lastErrorAt !== null
    && (lastOkAt === null || new Date(lastErrorAt).valueOf() > new Date(lastOkAt).valueOf());
  if (errorIsCurrent && lastErrorAt !== null) {
    if (lastErrorCode !== null && KEY_REJECTED.has(lastErrorCode)) return { kind: "error", word: "ВАТС отклонила ключ", tone: "blocked", at: lastErrorAt, pbxKeyProblem: true };
    if (lastErrorCode !== null && SWITCHED_OFF.has(lastErrorCode)) return { kind: "error", word: "Подключение выключено в кабинете", tone: "blocked", at: lastErrorAt, pbxKeyProblem: true };
    if (lastErrorCode === "pbx_forbidden") return { kind: "error", word: "У ключа ВАТС нет прав на метод", tone: "blocked", at: lastErrorAt, pbxKeyProblem: true };
    return { kind: "error", word: "ВАТС не ответила на последний запрос", tone: "warn", at: lastErrorAt, pbxKeyProblem: false };
  }
  return lastOkAt !== null ? { kind: "ok", at: lastOkAt } : { kind: "none" };
}

export type TelephonyIssue = Readonly<{
  id: string;
  /** Предложение с заглавной: строка списка и «Состояние»; в таблице «Интеграции» его первая буква строчная. */
  text: string;
  tone: "blocked" | "warn";
  /** Что не работает из-за этого, простыми словами. */
  without: string | null;
  /** Работа на сервере и кто её делает; `null` — делается на этой странице. */
  handoff: string | null;
}>;

function anyFlagOn(overview: TelephonyOverview): boolean {
  const { flags } = overview.settings;
  return flags.projectionEnabled || flags.uiEnabled || flags.dialEnabled || flags.missedTaskEnabled || flags.unknownLeadEnabled;
}

/** Все замечания по тяжести: сначала то, что останавливает, потом то, что стоит проверить. */
export function telephonyIssues(server: TelephonyServerFacts, overview: TelephonyOverview, now: Date): readonly TelephonyIssue[] {
  const { health } = overview;
  const issues: TelephonyIssue[] = [];
  const add = (issue: TelephonyIssue) => { issues.push(issue); };
  if (health.automationStop) {
    add({
      id: "automation_stop", tone: "blocked",
      text: `Автоматика остановлена по потолку (${TELEPHONY_STOP_COPY[health.automationStop.code]})`,
      without: "Задачи и лиды по звонкам не создаются, пока администратор не проверит и не включит снова", handoff: null,
    });
  }
  const link = server.pbx === "ready" ? pbxLink(health) : ({ kind: "none" } as const);
  if (link.kind === "error" && link.tone === "blocked") {
    add({ id: "pbx_error", tone: "blocked", text: link.word, without: "Запросы CRM к ВАТС не проходят: сверка, набор и список пользователей ждут", handoff: null });
  }
  if (!server.ingestEnabled && anyFlagOn(overview)) {
    add({
      id: "ingest_off", tone: "warn", text: "Приём выключен на сервере",
      without: "События звонков не принимаются, хотя включатели в CRM стоят",
      handoff: "Передать техническому специалисту: включить приём телефонии на сервере",
    });
  }
  if (server.ingestEnabled && server.crmKey === "missing") {
    add({
      id: "crm_key", tone: "blocked", text: "Ключ не задан",
      without: "ВАТС не сможет передавать звонки: ключ приёма не задан на сервере",
      handoff: "Передать техническому специалисту: задать ключ приёма телефонии на сервере",
    });
  }
  if (server.ingestEnabled && server.pbx === "not_configured") {
    add({
      id: "pbx_key", tone: "warn", text: "Ключ ВАТС не задан",
      without: "Сверка с историей ВАТС, список пользователей и звонок из CRM выключены",
      handoff: "Передать техническому специалисту: внести ключ ВАТС на сервер",
    });
  }
  if (server.pbx === "invalid") {
    add({
      id: "pbx_invalid", tone: "blocked", text: "Ключ ВАТС задан неверно",
      without: "Запросы CRM к ВАТС не отправляются",
      handoff: "Передать техническому специалисту: исправить параметры ВАТС на сервере",
    });
  }
  if (link.kind === "error" && link.tone === "warn") {
    add({ id: "pbx_slow", tone: "warn", text: link.word, without: null, handoff: null });
  }
  if (server.ingestEnabled && server.crmKey === "configured" && health.lastEventAt !== null) {
    const days = Math.floor((now.valueOf() - new Date(health.lastEventAt).valueOf()) / MS_DAY);
    if (days >= TELEPHONY_QUIET_DAYS) {
      add({ id: "quiet", tone: "warn", text: `Событий не было ${days} дн.`, without: "Звонки могут не доходить: проверьте подключение в кабинете ВАТС", handoff: null });
    }
  }
  if (health.directory.unmapped > 0) {
    add({
      id: "unmapped", tone: "warn", text: `Не сопоставлено пользователей: ${health.directory.unmapped}`,
      without: "Звонки этих пользователей ВАТС сохраняются без сотрудника", handoff: null,
    });
  }
  if (health.divergence.reconciledCalls > 0) {
    add({
      id: "divergence", tone: "warn", text: `Расхождений со сверкой за сутки: ${health.divergence.reconciledCalls}`,
      without: "Часть звонков пришла только из истории ВАТС, а не событиями: проверьте подключение", handoff: null,
    });
  }
  if (health.evidence.rejected > 0) {
    add({
      id: "rejected", tone: "warn", text: `Отклонённых после проверки ключа: ${health.evidence.rejected}`,
      without: "Сообщения с верным ключом, но неверной формой не разобраны", handoff: null,
    });
  }
  const { facts } = health.pbx;
  if (facts.recordService === false || facts.recordExternal === false) {
    add({ id: "record_off", tone: "warn", text: "Запись в ВАТС выключена", without: "Записей разговоров не будет: слушать нечего", handoff: null });
  } else if (facts.recordExceptions !== null && facts.recordExceptions > 0) {
    add({
      id: "record_exceptions", tone: "warn", text: `Сотрудников без записи разговоров: ${facts.recordExceptions}`,
      without: "Разговоры этих сотрудников не записываются", handoff: null,
    });
  }
  return Object.freeze(issues);
}

/** «1 звонка», «21 звонка», но «2 звонков», «11 звонков»: родительный падеж после числа. */
const genitive = (count: number, one: string, many: string) => (count % 10 === 1 && count % 100 !== 11 ? one : many);

function line(id: string, label: string, value: string, tone: TelephonyTone, note: string | null = null): TelephonyStatusLine {
  return { id, label, value, tone, note, without: null, handoff: null };
}

/** Какую строку «Состояния» объясняет замечание: у замечания свой id, у строки свой. */
const ISSUE_LINE: Readonly<Record<string, string>> = Object.freeze({
  automation_stop: "automation",
  pbx_error: "pbx_link",
  pbx_slow: "pbx_link",
  ingest_off: "intake",
  crm_key: "crm_key",
  pbx_key: "pbx_key",
  pbx_invalid: "pbx_key",
  quiet: "last_event",
  unmapped: "directory",
  divergence: "divergence",
  rejected: "evidence",
  record_off: "record",
  record_exceptions: "record",
});

/** Строки блока «Состояние» страницы «Телефония». */
export function telephonyStatusLines(server: TelephonyServerFacts, overview: TelephonyOverview, now: Date): readonly TelephonyStatusLine[] {
  const { health, settings } = overview;
  const at = (value: string | null) => formatTelephonyTime(value, now);
  const lines: TelephonyStatusLine[] = [];

  const serverNote = "Меняет технический специалист на сервере; в CRM это не переключается.";
  lines.push(server.ingestEnabled
    ? line("intake", "Приём событий на сервере", "включён", "ok")
    : line("intake", "Приём событий на сервере", "выключен", anyFlagOn(overview) ? "warn" : "off", serverNote));

  lines.push(server.crmKey === "configured"
    ? line("crm_key", "Ключ приёма («Ваша CRM»)", server.crmKeyRotating ? "задан, идёт замена" : "задан", "ok",
      server.crmKeyRotating ? "На время замены принимаются оба ключа." : null)
    : line("crm_key", "Ключ приёма («Ваша CRM»)", "не задан", server.ingestEnabled ? "blocked" : "off", "Задаёт технический специалист на сервере; значение здесь не показывается."));

  lines.push(server.pbx === "ready"
    ? line("pbx_key", "Ключ ВАТС", "задан", "ok")
    : server.pbx === "invalid"
      ? line("pbx_key", "Ключ ВАТС", "задан неверно", "blocked", "Проверить параметры ВАТС на сервере; значение здесь не показывается.")
      : line("pbx_key", "Ключ ВАТС", "не задан", "off", "Без него выключены сверка, список пользователей и звонок из CRM."));

  const link = server.pbx === "ready" ? pbxLink(health) : null;
  if (link === null) {
    lines.push(line("pbx_link", "Связь с ВАТС", "запросов нет: ключ ВАТС не задан", "off"));
  } else if (settings.flags.outboundPaused) {
    lines.push(line("pbx_link", "Связь с ВАТС", "исходящие запросы на паузе", "warn", "Пауза включена в этих настройках."));
  } else if (link.kind === "error") {
    lines.push(line("pbx_link", "Связь с ВАТС", lowerFirstWord(link.word), link.tone, at(link.at) ? `Последняя ошибка ${at(link.at)}.` : null));
  } else if (link.kind === "ok") {
    lines.push(line("pbx_link", "Связь с ВАТС", "на связи", "ok", at(link.at) ? `Последний ответ ${at(link.at)}.` : null));
  } else {
    lines.push(line("pbx_link", "Связь с ВАТС", "запросов к ВАТС ещё не было", "off"));
  }

  const lastEvent = at(health.lastEventAt);
  const silence = health.lastEventAt === null ? null : Math.floor((now.valueOf() - new Date(health.lastEventAt).valueOf()) / MS_DAY);
  if (lastEvent === null) {
    lines.push(line("last_event", "Последнее событие звонка", "ещё не было", "off"));
  } else {
    const quiet = silence !== null && silence >= TELEPHONY_QUIET_DAYS && server.ingestEnabled;
    lines.push(line("last_event", "Последнее событие звонка", lastEvent, quiet ? "warn" : "ok", quiet ? `Событий не было ${silence} дн.` : null));
  }

  if (!settings.flags.projectionEnabled) {
    lines.push(line("reconcile", "Сверка с историей ВАТС", "не идёт: разбор звонков выключен", "off"));
  } else if (health.schedule.reconcileSuccessAt === null) {
    lines.push(line("reconcile", "Сверка с историей ВАТС", "ещё не выполнялась", "warn"));
  } else {
    const lag = health.schedule.reconcileLagSeconds;
    const behind = lag !== null && lag > 3 * 3600;
    lines.push(line("reconcile", "Сверка с историей ВАТС", at(health.schedule.reconcileSuccessAt) ?? "выполнялась", behind ? "warn" : "ok",
      lag === null ? null : behind ? `Отстаёт примерно на ${Math.floor(lag / 3600)} ч.` : null));
  }

  const { directory } = health;
  lines.push(directory.active === 0 && directory.inactive === 0
    ? line("directory", "Пользователи ВАТС", "список ещё не получен", "off", "Приходит с сервера после того, как задан ключ ВАТС.")
    : line("directory", "Пользователи ВАТС",
      directory.unmapped > 0 ? `${directory.active} в ВАТС, не сопоставлено ${directory.unmapped}` : `${directory.active} в ВАТС, все сопоставлены`,
      directory.unmapped > 0 ? "warn" : "ok"));

  const { evidence } = health;
  const parts = [`принято ${evidence.received}`];
  if (evidence.rejected > 0) parts.push(`отклонено после проверки ключа ${evidence.rejected}`);
  if (evidence.incomplete > 0) parts.push(`неполных ${evidence.incomplete}`);
  lines.push(line("evidence", "Сообщения ВАТС за сутки", parts.join(", "), evidence.rejected > 0 ? "warn" : evidence.received > 0 ? "ok" : "off"));

  lines.push(health.divergence.calls === 0
    ? line("divergence", "Расхождения со сверкой за сутки", "звонков не было", "off")
    : line("divergence", "Расхождения со сверкой за сутки", `${health.divergence.reconciledCalls} из ${health.divergence.calls} ${genitive(health.divergence.calls, "звонка", "звонков")}`,
      health.divergence.reconciledCalls > 0 ? "warn" : "ok",
      health.divergence.reconciledCalls > 0 ? "Звонки, которые принесла только сверка." : null));

  const { facts } = health.pbx;
  if (facts.recordService === null && facts.recordExternal === null && facts.recordExceptions === null) {
    lines.push(line("record", "Запись разговоров в ВАТС", "ещё не проверялась", "off"));
  } else if (facts.recordService === false || facts.recordExternal === false) {
    lines.push(line("record", "Запись разговоров в ВАТС", "выключена", "warn"));
  } else if (facts.recordExceptions !== null && facts.recordExceptions > 0) {
    lines.push(line("record", "Запись разговоров в ВАТС", `включена, у ${facts.recordExceptions} ${genitive(facts.recordExceptions, "сотрудника", "сотрудников")} выключена`, "warn"));
  } else {
    lines.push(line("record", "Запись разговоров в ВАТС", "включена", "ok"));
  }

  if (settings.flags.backfillEnabled) {
    lines.push(health.schedule.backfillDoneAt
      ? line("backfill", "Первичный импорт за год", "завершён", "ok", at(health.schedule.backfillDoneAt))
      : line("backfill", "Первичный импорт за год", health.schedule.backfillCursorAt ? `идёт, дошёл до ${at(health.schedule.backfillCursorAt)}` : "включён, ещё не начался", "warn"));
  } else {
    lines.push(line("backfill", "Первичный импорт за год", "выключен", "off"));
  }

  lines.push(health.automationStop
    ? line("automation", "Автоматика", `остановлена по потолку (${TELEPHONY_STOP_COPY[health.automationStop.code]})`, "blocked", at(health.automationStop.stoppedAt))
    : settings.flags.missedTaskEnabled || settings.flags.unknownLeadEnabled
      ? line("automation", "Автоматика", "включена", "ok")
      : line("automation", "Автоматика", "выключена", "off"));
  // Что не работает и кто это делает — прямо в строке, у которой замечание: красная строка без «что делать» заставляла читать
  // весь список. Замечание садится на свою строку один раз (первое, самое тяжёлое), остальные идут в её пояснение не повторяясь.
  const byLine = new Map<string, TelephonyIssue>();
  for (const issue of telephonyIssues(server, overview, now)) {
    const target = ISSUE_LINE[issue.id];
    if (target !== undefined && !byLine.has(target)) byLine.set(target, issue);
  }
  return Object.freeze(lines.map((item) => {
    const issue = item.tone === "warn" || item.tone === "blocked" ? byLine.get(item.id) : undefined;
    // «Исходящие запросы на паузе» — слово самой строки, а не причина замечания о связи: чужое «что не работает» к ней не липнет.
    if (!issue || (item.id === "pbx_link" && item.value !== lowerFirstWord(issue.text))) return item;
    return { ...item, without: issue.without, handoff: issue.handoff };
  }));
}

const lowerFirst = lowerFirstWord;

export type TelephonyIntegrationFacts = Readonly<{
  server: TelephonyServerFacts;
  /** `null` — база не ответила: «нет данных», а не выдуманное состояние. */
  overview: TelephonyOverview | null;
}>;

const SETTINGS_LINK = { label: "Открыть «Телефония»", href: "/v3/settings?section=telephony" } as const;

/**
 * Строка «Телефония» таблицы «Интеграции» (ключ `telephony`). Состояние — самое
 * тяжёлое замечание; остальные идут в пояснение. Настроенным и сломанным она не
 * объявляется (`blocksWork` всегда `false`): приём событий и интерфейс сотрудников
 * решают флаги, а не эта таблица, а предупреждение страницы остаётся за
 * WhatsApp, amoCRM и Gemini.
 */
export function telephonyIntegrationRow(facts: TelephonyIntegrationFacts, now: Date): IntegrationRow {
  const base = { key: "telephony", name: "Телефония · Beeline", checkable: true, blocksWork: false } as const;
  const { server, overview } = facts;
  if (overview === null) {
    return {
      ...base, state: "нет данных", tone: "warn", detail: "Не удалось прочитать состояние телефонии.",
      checkedAt: null, checkedText: null, without: null, action: { handoff: null, link: SETTINGS_LINK },
    };
  }
  const issues = telephonyIssues(server, overview, now);
  const checkedAt = overview.health.pbx.lastOkAt;
  const checkedText = formatTelephonyTime(checkedAt, now);
  if (issues.length === 0) {
    const off = !server.ingestEnabled && !anyFlagOn(overview);
    return {
      ...base, state: off ? "выключено" : "приём включён", tone: off ? "off" : "ok",
      detail: off ? "Приём событий выключен на сервере, включатели выключены." : null,
      checkedAt, checkedText, without: off ? "Звонки не попадают в CRM" : null, action: { handoff: null, link: SETTINGS_LINK },
    };
  }
  const [first, ...rest] = issues;
  const handoff = issues.find((issue) => issue.handoff !== null)?.handoff ?? null;
  return {
    ...base, state: lowerFirst(first.text), tone: first.tone === "blocked" ? "blocked" : "warn",
    detail: rest.length > 0 ? rest.map((issue) => `${issue.text}.`).join(" ") : null,
    checkedAt, checkedText, without: first.without, action: { handoff, link: SETTINGS_LINK },
  };
}
