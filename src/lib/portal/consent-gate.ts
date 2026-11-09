/**
 * Экран «Конфиденциальность» при первом входе (решение владельца 09.11.2026, миграция 356). Любой студент без решения
 * о Политике конфиденциальности и об ИИ-помощниках EVO видит один экран с двумя обязательными галочками; работать в
 * кабинете без него нельзя. Клиент-безопасные типы, версии, разбор ответа базы и безопасный адрес возврата.
 *
 * «Нет решения» = Политика не принята по текущей версии ИЛИ выбор об ИИ-помощниках не сделан по текущей версии. Позднее
 * «Отозвать» в «Профиле» — это решение, экран после него не возвращается. Решает база (`needsDecision` ответа
 * `platform.portal_consent_status_v1`); веб только показывает экран и отправляет принятие.
 */
import { STUDENT_APPLICATION_CONSENT_VERSION } from "../student-application-contract.ts";
import { AI_CONSENT_POLICY_VERSION } from "./ai-consent.ts";

/** Версия текста Политики, которую принимает студент: та же, что у галочки анкеты (345). */
export const PRIVACY_POLICY_VERSION = STUDENT_APPLICATION_CONSENT_VERSION;

/** Версия текста согласия на ИИ-помощников (320). */
export const CONSENT_GATE_AI_POLICY_VERSION = AI_CONSENT_POLICY_VERSION;

/** Источник принятия в журнале: этот кабинет в браузере (приложения присылают `ios` / `android`). */
export const CONSENT_GATE_SOURCE = "portal_web";

/** Страница экрана. Её слой не закрывается самим экраном, выход и ссылка на Политику работают без решения. */
export const CONSENT_GATE_PATH = "/portal/privacy";

/** Заголовок запроса, который ставит только `src/proxy.ts`: путь и строка запроса страницы кабинета. */
export const CONSENT_GATE_PATH_HEADER = "x-evo-pathname";

/** Имена полей формы: обе галочки приходят строкой `granted`. */
export const CONSENT_GATE_FIELDS = ["policy_consent", "ai_consent", "request_id", "next"] as const;

export type ConsentStatus = Readonly<{
  policyVersionCurrent: string;
  policyAcceptedVersion: string | null;
  aiStatus: "granted" | "declined" | null;
  aiPolicyVersion: string | null;
  aiPolicyVersionCurrent: string;
  needsDecision: boolean;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const VERSION = /^[0-9A-Za-z._-]{1,32}$/u;

export function isConsentRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function version(value: unknown): value is string {
  return typeof value === "string" && VERSION.test(value);
}

/** Строгий разбор ответа: ровно шесть полей, любая другая форма - null (экран не выдумывает состояние). */
export function parseConsentStatus(value: unknown): ConsentStatus | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",")
    !== "aiPolicyVersion,aiPolicyVersionCurrent,aiStatus,needsDecision,policyAcceptedVersion,policyVersionCurrent") return null;
  if (!version(row.policyVersionCurrent) || !version(row.aiPolicyVersionCurrent) || typeof row.needsDecision !== "boolean") return null;
  if (row.policyAcceptedVersion !== null && !version(row.policyAcceptedVersion)) return null;
  if (row.aiStatus === null) {
    if (row.aiPolicyVersion !== null) return null;
  } else if (row.aiStatus !== "granted" && row.aiStatus !== "declined") {
    return null;
  } else if (!version(row.aiPolicyVersion)) {
    return null;
  }
  return {
    policyVersionCurrent: row.policyVersionCurrent,
    policyAcceptedVersion: row.policyAcceptedVersion,
    aiStatus: row.aiStatus,
    aiPolicyVersion: row.aiPolicyVersion,
    aiPolicyVersionCurrent: row.aiPolicyVersionCurrent,
    needsDecision: row.needsDecision,
  };
}

/**
 * Нужен ли экран. Веб показывает его только когда база говорит `needsDecision` И версии, которые знает этот
 * выпуск, совпадают с базой: иначе принятие было бы отвергнуто (`consent_*_version_mismatch`), и студент застрял бы
 * на экране, который не может закрыть. Расхождение версий - сбой выката, а не повод запирать кабинет.
 */
export function consentGateRequired(status: ConsentStatus): boolean {
  return status.needsDecision
    && status.policyVersionCurrent === PRIVACY_POLICY_VERSION
    && status.aiPolicyVersionCurrent === CONSENT_GATE_AI_POLICY_VERSION;
}

/**
 * Куда вернуть студента после экрана. Только путь кабинета «/portal...» без схемы, без «//», без обратных косых,
 * управляющих знаков и без самого экрана; всё остальное - «/portal».
 */
export function safeConsentReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return "/portal";
  if (!value.startsWith("/portal") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/u.test(value)) return "/portal";
  const next = value.charAt(7);
  if (next !== "" && next !== "/" && next !== "?" && next !== "#") return "/portal";
  const path = value.split(/[?#]/u)[0];
  if (path === CONSENT_GATE_PATH || path.startsWith(`${CONSENT_GATE_PATH}/`)) return "/portal";
  try {
    const url = new URL(value, "https://portal.invalid");
    if (url.origin !== "https://portal.invalid") return "/portal";
  } catch {
    return "/portal";
  }
  return value;
}

/** Адрес экрана с возвратом на запрошенную страницу (главную в адрес не кладём). */
export function consentGateDestination(requested: string | null): string {
  const target = safeConsentReturnPath(requested);
  return target === "/portal" ? CONSENT_GATE_PATH : `${CONSENT_GATE_PATH}?next=${encodeURIComponent(target)}`;
}

/** Страница экрана ли это (путь без строки запроса). */
export function isConsentGatePath(pathWithQuery: string | null): boolean {
  if (pathWithQuery === null) return false;
  const path = pathWithQuery.split(/[?#]/u)[0];
  return path === CONSENT_GATE_PATH || path === `${CONSENT_GATE_PATH}/`;
}

export type ConsentAcceptResult =
  | Readonly<{ ok: true; status: ConsentStatus }>
  | Readonly<{ ok: false }>;
