/**
 * Согласие студента на ИИ-помощников (решение владельца 25.10.2026; Apple
 * App Store 5.1.2(i): до передачи личных данных ИИ третьей стороны нужно
 * явное разрешение внутри приложения). Клиент-безопасные типы, версия текста
 * и строгий разбор RPC `platform.portal_ai_consent_get_v1` /
 * `portal_ai_consent_set_v1`: любое отклонение формы — null, экран говорит,
 * что выбор не проверен, а не выдумывает состояние.
 *
 * Кто видит какие данные, решает база (согласие хранится на студента, версия
 * политики — в таблице и в журнале событий платформы); веб только показывает
 * текст версии `AI_CONSENT_POLICY_VERSION` и отправляет выбор студента.
 */

/**
 * Версия текста согласия, который видит студент. Меняется вместе с текстом
 * `aiConsent` в `i18n.ts`; база отвергает неверную версию, а решение, принятое
 * по старой версии, считает «не выбрано» и просит подтвердить заново.
 */
export const AI_CONSENT_POLICY_VERSION = "2026-10-25";

/** Источник решения в журнале: этот кабинет в браузере (iPhone присылает `ios`). */
export const AI_CONSENT_SOURCE = "portal_web";

/** Политика конфиденциальности сайта. Кыргызской страницы нет, обе локали ведут на русскую. */
export const AI_CONSENT_PRIVACY_URL = "https://evoadmissions.com/ru/privacy/";

export type AiConsentStatus = "granted" | "declined";

/** Ответ обоих RPC: `status` и две следующие строки `null`, пока студента не спрашивали. */
export type AiConsent = Readonly<{
  status: AiConsentStatus | null;
  policyVersion: string | null;
  decidedAt: string | null;
  currentPolicyVersion: string;
}>;

/** Что видит студент: разрешено, не разрешено или ещё не выбрано для текущей версии. */
export type AiConsentState = "granted" | "declined" | "undecided";

export type AiConsentActionResult =
  | Readonly<{ ok: true; consent: AiConsent }>
  | Readonly<{ ok: false }>;

/**
 * Уровень доступа студента кабинета (`actor.accessTier`, PORT-1a): `assisted` —
 * клиент EVO с делом на сопровождении (active/closed), `approved` —
 * самостоятельный студент, у которого дела на сопровождении нет.
 */
export type AiConsentAccessTier = "approved" | "assisted";

/**
 * Итог чтения своего согласия: `ready` — вопрос применим и ответ получен,
 * `unavailable` — вопрос применим, но чтение не удалось, `not_applicable` —
 * вопроса нет, базу не спрашивали.
 */
export type AiConsentRead =
  | Readonly<{ status: "ready"; consent: AiConsent }>
  | Readonly<{ status: "unavailable" }>
  | Readonly<{ status: "not_applicable" }>;

/**
 * Вопрос о согласии задаём только клиентам EVO с делом на сопровождении:
 * ИИ-помощники читают переписку и документы дела, а у самостоятельного
 * студента (уровень `approved`) дела на сопровождении нет, и его данные они не
 * читают. Всё, что не равно `assisted`, — «нет вопроса» (закрыто по умолчанию).
 */
export function aiConsentApplies(accessTier: unknown): accessTier is "assisted" {
  return accessTier === "assisted";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/u;
const VERSION = /^[0-9A-Za-z._-]{1,32}$/u;

export function isAiConsentStatus(value: unknown): value is AiConsentStatus {
  return value === "granted" || value === "declined";
}

export function isAiConsentRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

function version(value: unknown): value is string {
  return typeof value === "string" && VERSION.test(value);
}

/**
 * Строгий разбор ответа: ровно четыре поля; «не спрашивали» — три `null`
 * вместе с текущей версией, решение — статус, версия и время вместе.
 */
export function parseAiConsent(value: unknown): AiConsent | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "currentPolicyVersion,decidedAt,policyVersion,status") return null;
  if (!version(row.currentPolicyVersion)) return null;
  if (row.status === null) {
    if (row.policyVersion !== null || row.decidedAt !== null) return null;
    return { status: null, policyVersion: null, decidedAt: null, currentPolicyVersion: row.currentPolicyVersion };
  }
  if (!isAiConsentStatus(row.status) || !version(row.policyVersion) || !timestamp(row.decidedAt)) return null;
  return {
    status: row.status,
    policyVersion: row.policyVersion,
    decidedAt: row.decidedAt,
    currentPolicyVersion: row.currentPolicyVersion,
  };
}

/**
 * Решение, принятое по старой версии политики, для текущей не действует: как
 * и в базе, это «не выбрано». Только разрешение или отказ по текущей версии
 * прекращают вопрос.
 */
export function aiConsentState(consent: AiConsent): AiConsentState {
  if (consent.status === null || consent.policyVersion !== consent.currentPolicyVersion) return "undecided";
  return consent.status;
}

/** Студент решал раньше, но текст политики с тех пор обновился. */
export function aiConsentOutdated(consent: AiConsent): boolean {
  return consent.status !== null && consent.policyVersion !== consent.currentPolicyVersion;
}

/** Дата решения для людей: «25.10.2026» по Бишкеку (организация работает по нему). */
export function aiConsentDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Bishkek",
  }).format(new Date(iso));
}
