/**
 * «Телефония Beeline KG», срез T7 (docs/EVO_TELEPHONY_PLAN_2026-10-16.md §5.4, §6.5, §8,
 * §12; миграция 299): чистый контракт кнопки «Позвонить» — без React и без сервера. Его
 * читают страницы, кнопка, маршрут `POST /api/v3/telephony/dial` и Node-тесты.
 *
 * Что показывать, решает база: `platform.telephony_dial_options_v1` отвечает, открыт ли
 * набор этому сотруднику (флаги `ui_enabled` и `dial_enabled`, нет паузы, есть право
 * `telephony.call.dial`) и сопоставлен ли он с пользователем ВАТС. Номера клиента здесь
 * нет и быть не может: браузер знает только идентификатор лида.
 *
 * Слова — единственное место. Главное, что они обязаны сказать честно: набор не
 * соединяет с клиентом сразу — сначала ВАТС звонит самому сотруднику (приложение или
 * вкладка с телефоном), и только после ответа набирает клиента.
 */

/** Отказы базы и проверки статуса сотрудника (миграция 299); новый код — новое слово. */
export const DIAL_REFUSAL_CODES = [
  "lead_no_phone",
  "number_invalid",
  "prefix_not_allowed",
  "number_blocked",
  "not_mapped",
  "rate_gap",
  "limit_user_day",
  "limit_org_hour",
  "limit_org_day",
  "pbx_offline",
  "pbx_user_not_found",
] as const;
export type DialRefusalCode = (typeof DIAL_REFUSAL_CODES)[number];

/** Почему ВАТС не приняла запрос (маршрут: 502 `pbx_failed` с `reason`). */
export const DIAL_FAILURE_REASONS = ["pbx_auth", "pbx_rejected", "pbx_unavailable"] as const;
export type DialFailureReason = (typeof DIAL_FAILURE_REASONS)[number];

/** Что показывает кнопка: `off` — кнопки нет (флаги, права, просмотр роли, сбой чтения). */
export type DialOptions =
  | Readonly<{ status: "off" }>
  | Readonly<{ status: "ready"; mapped: boolean }>;

export const DIAL_OFF: DialOptions = Object.freeze({ status: "off" });

/** Ответ `telephony_dial_options_v1`: ровно `{enabled, mapped}`; чужая форма — ошибка, а не кнопка. */
export function dialOptionsState(data: unknown): DialOptions {
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new TypeError("telephony_dial_options_shape");
  const object = data as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  if (keys.length !== 2 || keys[0] !== "enabled" || keys[1] !== "mapped"
    || typeof object.enabled !== "boolean" || typeof object.mapped !== "boolean") {
    throw new TypeError("telephony_dial_options_shape");
  }
  return object.enabled ? Object.freeze({ status: "ready", mapped: object.mapped }) : DIAL_OFF;
}

const LEAD_KEY = /^lead:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;

/**
 * Лид строки «Сегодня», которому можно позвонить: строки лидов и заявок (`lead:<id>`).
 * Задачи (в том числе «Перезвонить» среза T8) и дела студентов кнопки не получают: у них
 * нет лида в строке; срез T8 расширит этот выбор, когда задача понесёт идентификатор лида.
 */
export function todayDialLeadId(item: Readonly<{ source: string; key: string }>): string | null {
  if (item.source !== "leads" && item.source !== "requests") return null;
  const match = LEAD_KEY.exec(item.key);
  return match ? match[1] : null;
}

/** Постоянная подсказка у кнопки и в ответе «звоним». */
export const DIAL_ABOUT =
  "Сначала зазвонит ваш телефон или приложение ВАТС. Возьмите трубку — после этого мы наберём клиента.";

export const DIAL_COPY = Object.freeze({
  button: "Позвонить",
  busy: "Звоним…",
  sent: `Звоним. ${DIAL_ABOUT}`,
  // Повтор запроса, на который не дошёл ответ: звонок был набран раньше, нового нет.
  sentBefore:
    "Этот звонок уже был набран раньше, второй не создан. Если нужен новый звонок, нажмите «Позвонить» ещё раз.",
  unconfirmed:
    "ВАТС не подтвердила звонок. Проверьте телефон и приложение ВАТС. Повторно не нажимайте, пока не убедитесь, что звонка нет: он мог уйти.",
  inProgress: "Этот звонок уже набирается. Подождите.",
  notMapped:
    "Ваш логин ВАТС не связан с вашей учётной записью. Попросите руководителя сопоставить вас в «Настройки → Телефония».",
  fallback: "Не удалось позвонить. Клиенту не звонили. Повторите.",
  network: "Не удалось связаться с CRM. Проверьте, пошёл ли звонок, прежде чем нажимать снова.",
});

const REFUSAL_COPY: Readonly<Record<DialRefusalCode, string>> = Object.freeze({
  lead_no_phone: "У клиента не записан номер телефона. Добавьте его в карточке.",
  number_invalid: "Номер клиента записан без кода страны или с ошибкой. Исправьте его в карточке, например +996…",
  prefix_not_allowed: "Звонки в эту страну не разрешены. Разрешённые страны задаёт руководитель в «Настройки → Телефония».",
  number_blocked: "Звонок на этот номер заблокирован: он короткий, служебный или платный.",
  not_mapped: DIAL_COPY.notMapped,
  rate_gap: "Подождите несколько секунд перед следующим звонком.",
  limit_user_day: "Вы достигли суточного лимита звонков. Лимит задаёт руководитель в «Настройки → Телефония».",
  limit_org_hour: "Достигнут часовой лимит звонков компании. Попробуйте позже.",
  limit_org_day: "Достигнут суточный лимит звонков компании. Попробуйте завтра.",
  pbx_offline:
    "Откройте приложение ВАТС (или вкладку с телефоном): сейчас ваше устройство не в сети. Клиенту не звонили.",
  pbx_user_not_found: "Ваш логин не найден в ВАТС. Сообщите руководителю. Клиенту не звонили.",
});

const FAILURE_COPY: Readonly<Record<DialFailureReason, string>> = Object.freeze({
  pbx_auth: "ВАТС не приняла запрос: ключ отклонён или подключение выключено в кабинете. Сообщите администратору. Клиенту не звонили.",
  pbx_rejected: "ВАТС отклонила запрос. Клиенту не звонили. Сообщите администратору, если повторится.",
  pbx_unavailable: "ВАТС сейчас не отвечает. Клиенту не звонили. Повторите позже.",
});

/** Слова кодов ошибок маршрута (`{error: {code}}`), кроме `dial_refused` и `pbx_failed`. */
const ERROR_COPY: Readonly<Record<string, string>> = Object.freeze({
  authentication_required: "Войдите снова и повторите.",
  forbidden: "Нет права звонить из CRM.",
  preview: "В просмотре роли звонки не набираются.",
  not_found: "Лид не найден или недоступен вам.",
  telephony_off: "Звонки из CRM сейчас выключены.",
  not_configured: "ВАТС не подключена: не задан ключ. Сообщите администратору. Клиенту не звонили.",
  request_conflict: "Этот запрос уже использован для другого лида. Нажмите ещё раз.",
  invalid_request: "Не удалось позвонить: проверьте лид и повторите.",
  unavailable: "Звонки сейчас недоступны. Повторите позже.",
});

/** Слова отказа по коду; незнакомый код — общая фраза, а не пустота. */
export function dialRefusalCopy(code: string | undefined): string {
  return code !== undefined && Object.prototype.hasOwnProperty.call(REFUSAL_COPY, code)
    ? REFUSAL_COPY[code as DialRefusalCode] : DIAL_COPY.fallback;
}

export function dialFailureCopy(reason: string | undefined): string {
  return reason !== undefined && Object.prototype.hasOwnProperty.call(FAILURE_COPY, reason)
    ? FAILURE_COPY[reason as DialFailureReason] : DIAL_COPY.fallback;
}

/** Слова ответа маршрута с ошибкой: код, а для `dial_refused` / `pbx_failed` — причина. */
export function dialErrorCopy(error: Readonly<{ code?: unknown; reason?: unknown }> | undefined): string {
  const code = typeof error?.code === "string" ? error.code : undefined;
  const reason = typeof error?.reason === "string" ? error.reason : undefined;
  if (code === "dial_refused") return dialRefusalCopy(reason);
  if (code === "pbx_failed") return dialFailureCopy(reason);
  return code !== undefined && Object.prototype.hasOwnProperty.call(ERROR_COPY, code) ? ERROR_COPY[code] : DIAL_COPY.fallback;
}

/** Слова успешного ответа маршрута: `sent`, `unconfirmed` или `in_progress`. */
export function dialSuccessCopy(status: unknown): string | null {
  if (status === "sent") return DIAL_COPY.sent;
  if (status === "unconfirmed") return DIAL_COPY.unconfirmed;
  if (status === "in_progress") return DIAL_COPY.inProgress;
  return null;
}

/**
 * Ответ маршрута для кнопки. `answered` — ответил именно наш маршрут: успех с известным `status`
 * или ошибка со своим `error.code`. Только тогда попытка завершена и следующее нажатие — новый
 * звонок. Всё прочее (страница шлюза 502/504, пустой или чужой ответ) о звонке ничего не говорит:
 * он мог уйти, поэтому `requestId` остаётся (повтор не удвоит звонок), а слова — «проверьте, пошёл
 * ли звонок», а не «клиенту не звонили». Повтор уже набранного звонка (`replayed`) говорит, что
 * звонок был, а не «Звоним».
 */
export function dialRouteAnswer(ok: boolean, body: unknown): Readonly<{ answered: boolean; note: string }> {
  const object: Record<string, unknown> = typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>) : {};
  if (ok) {
    const note = object.replayed === true && object.status === "sent" ? DIAL_COPY.sentBefore : dialSuccessCopy(object.status);
    return note === null ? { answered: false, note: DIAL_COPY.network } : { answered: true, note };
  }
  const error = typeof object.error === "object" && object.error !== null && !Array.isArray(object.error)
    ? (object.error as Record<string, unknown>) : undefined;
  if (typeof error?.code !== "string") return { answered: false, note: DIAL_COPY.network };
  return { answered: true, note: dialErrorCopy(error) };
}
