/**
 * Согласие студента на ИИ-помощников (миграция 320, ADR 0035 «Последствия», решение владельца 25.10.2026).
 * Чистый модуль: без React, сервера и ввода-вывода. Общий словарь для CRM (чип в Student 360), для тестов и для
 * кода, который читает ответы `platform.portal_ai_consent_get_v1` / `platform.staff_student_ai_consent_v1`.
 *
 * Версия текста политики ЗДЕСЬ и в базе (`platform_private.student_ai_consent_policy_version()`) — одно значение:
 * `tests/ai-agents-consent.test.mjs` сверяет их по тексту миграции. Новая версия — новая миграция и эта константа.
 */

/** Действующая версия текста политики; решение студента на другой версии считается «не решено». */
export const AI_CONSENT_POLICY_VERSION = "2026-10-25";

export const AI_CONSENT_STATUSES = ["granted", "declined"] as const;
export type AiConsentStatus = (typeof AI_CONSENT_STATUSES)[number];

export const AI_CONSENT_SOURCES = ["portal_web", "ios"] as const;
export type AiConsentSource = (typeof AI_CONSENT_SOURCES)[number];

/**
 * Код отказа на каждом пути ИИ (инструмент агента Claude, билет окна ИИ в чате, память, автоответчик, распознавание
 * документов, SQLSTATE 42501 с этим текстом) и текст для модели (совпадает с `ERROR_MESSAGES` MCP-сервера).
 */
export const AI_CONSENT_MISSING_CODE = "ai_consent_missing";
export const AI_CONSENT_MISSING_MESSAGE = "Студент не дал согласия на ИИ-помощников: его документы и переписку агент не читает.";
/** Строка окна ИИ в чате продаж и блока «Что ИИ знает о клиенте» (решение владельца 25.10.2026): правда и для Claude, и для Gemini. */
export const AI_CONSENT_MISSING_CHAT_LINE = "Студент не дал согласия на ИИ-помощников — помощник не читает эту переписку.";
/** Строка под переключателем «Автоответчик в этом чате» для такого студента: база пропускает чат с `ai_consent_missing`, ночью ответа не будет. */
export const AI_CONSENT_MISSING_AUTOSEND_LINE = "Студент не дал согласия на ИИ-помощников — автоответчик здесь не отвечает.";

/**
 * Ответ `platform.staff_student_ai_consent_v1`: `status` - как его видит запрет (`granted` только на действующей версии
 * политики; `declined`; иначе null - не спрашивали или решение на прежней версии), `aiAllowed` - итог запрета для дела
 * (у студента без кабинета true и без согласия).
 */
export type StaffAiConsent = Readonly<{
  status: AiConsentStatus | null;
  decidedAt: string | null;
  aiAllowed: boolean;
}>;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/u;

/** Разбор ответа сотрудника; чужая форма - null (чип не рисуется, страница не падает). */
export function parseStaffAiConsent(value: unknown): StaffAiConsent | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (keys !== "aiAllowed,decidedAt,status") return null;
  const { status, decidedAt, aiAllowed } = record;
  if (status !== null && status !== "granted" && status !== "declined") return null;
  if (typeof aiAllowed !== "boolean") return null;
  if (decidedAt !== null && !(typeof decidedAt === "string" && ISO_TIMESTAMP.test(decidedAt))) return null;
  if ((status === null) !== (decidedAt === null)) return null;
  return Object.freeze({ status, decidedAt, aiAllowed });
}

export type AiConsentChipTone = "neutral" | "warn";

export type AiConsentChip = Readonly<{
  tone: AiConsentChipTone;
  /** Слово чипа: «ИИ: разрешено» / «ИИ: не разрешено» / «ИИ: не спрашивали». */
  label: string;
  /** Подсказка при наведении: что это значит для работы помощников. */
  title: string;
}>;

/**
 * Чип Student 360. Тихий (нейтральный) для «разрешено» и «не спрашивали», предупреждающий только для «не разрешено».
 * Подсказка называет следствие: без разрешения у студента с кабинетом ИИ-помощники не читают его документы и переписку.
 * Слова подсказки верны для всех путей, которым база отдаёт переписку и файлы: агенты Claude, Gemini-помощник в чате
 * продаж, память разговоров, ночной автоответчик и распознавание документов (миграция 320, docs/runbooks/
 * ai-agents-managed.md §10). Не закрыты `send_message`, старый `evo-lead-agent` (в базу Платформы не ходит, по умолчанию
 * выключен) и приложение-компаньон `agent-lead2-inbox` (своя таблица сообщений и свой Gemini-путь): в подсказку они не
 * входят, а в runbook названы.
 * «Не спрашивали» - и тот, кого не спрашивали, и тот, кто разрешил на прежней версии текста (RPC сотрудника
 * отдаёт `granted` только на действующей версии), поэтому подсказка называет оба случая.
 */
export function aiConsentChip(consent: StaffAiConsent): AiConsentChip {
  if (consent.status === "declined") {
    return { tone: "warn", label: "ИИ: не разрешено", title: "Студент не разрешил ИИ-помощников: помощники не читают его документы и переписку." };
  }
  if (consent.status === "granted") {
    return { tone: "neutral", label: "ИИ: разрешено", title: "Студент разрешил ИИ-помощников: помощники могут читать его документы и переписку." };
  }
  return consent.aiAllowed
    ? { tone: "neutral", label: "ИИ: не спрашивали", title: "У студента нет кабинета: помощники работают по договору и политике конфиденциальности." }
    : { tone: "neutral", label: "ИИ: не спрашивали", title: "Студент ещё не решил или разрешил на прежней версии текста: пока он не разрешит снова, помощники не читают его документы и переписку." };
}
