/**
 * Эви — ИИ-профориентатор во вкладке «Подбор с Эви» раздела «Профессии» (решение владельца 16.11.2026). Модуль без
 * сервера и сети: форма ответа, строгий разбор того, что вернула модель, и проверка истории разговора, которую
 * присылает браузер. Всё, что не проходит разбор, — отказ, а не догадка: экран показывает «не получилось» и
 * «Повторить», выдуманного ответа нет.
 */

/** Мимика маскота: каждая — настоящее состояние разговора, а не украшение. */
export const EVI_MOODS = ["talk", "happy", "wow", "thinking", "eureka"] as const;
export type EviMood = (typeof EVI_MOODS)[number];

export const EVI_LIMITS = {
  /** Сообщений в разговоре (обе стороны). Длиннее — «начни новый чат». */
  maxTurns: 30,
  /** Одно сообщение ученика, символов. */
  maxUserChars: 500,
  /** Одна реплика Эви, которую браузер присылает обратно в истории, символов. */
  maxAssistantChars: 1200,
  maxOptions: 6,
  maxOptionChars: 60,
  maxWhyChars: 400,
  results: 3,
} as const;

export type EviTurn = Readonly<{ role: "user" | "assistant"; content: string }>;

/** Направление из каталога «Профессии»: ключ карточки и объяснение, почему подходит. */
export type EviPick = Readonly<{ cardKey: string; why: string }>;

export type EviReply = Readonly<{
  message: string;
  mood: EviMood;
  options: readonly string[];
  multi: boolean;
  /** Ровно три карточки каталога или null, пока Эви ещё спрашивает. */
  picks: readonly EviPick[] | null;
}>;

/** Направление, готовое к показу: карточка каталога, её название на языке кабинета и объяснение. */
export type EviResult = Readonly<{ cardId: string; title: string; why: string }>;

export type EviAnswer = Readonly<{
  message: string;
  mood: EviMood;
  options: readonly string[];
  multi: boolean;
  results: readonly EviResult[] | null;
}>;

export type EviFailure = "consent" | "unavailable" | "limit" | "busy" | "invalid" | "error";

export type EviActionResult =
  | Readonly<{ ok: true; answer: EviAnswer }>
  | Readonly<{ ok: false; reason: EviFailure }>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // Управляющие символы убираем, разрывы строк оставляем: Эви пишет короткими абзацами.
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").trim();
  if (text.length === 0 || text.length > max) return null;
  return text;
}

export function isEviMood(value: unknown): value is EviMood {
  return typeof value === "string" && (EVI_MOODS as readonly string[]).includes(value);
}

/**
 * Достаёт один JSON-объект из текста модели: весь текст, тело одного блока ```json``` или кусок от первой `{` до
 * последней `}`. Ничего не нашлось — null.
 */
export function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text);
  const candidates = [text, fenced?.[1] ?? "", text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const value: unknown = JSON.parse(trimmed);
      if (isPlainObject(value)) return value;
    } catch {
      // следующий кандидат
    }
  }
  return null;
}

/**
 * Строгий разбор ответа модели. `cardKeys` — ключи опубликованных карточек: направление вне каталога, повтор
 * карточки или не ровно три направления — отказ всего ответа (браузер покажет «Повторить»).
 */
export function parseEviReply(value: unknown, cardKeys: ReadonlySet<string>): EviReply | null {
  if (!isPlainObject(value)) return null;
  const message = cleanText(value.message, EVI_LIMITS.maxAssistantChars);
  if (message === null) return null;
  const rawOptions = Array.isArray(value.options) ? value.options : [];
  const options: string[] = [];
  for (const option of rawOptions) {
    const text = cleanText(option, EVI_LIMITS.maxOptionChars);
    if (text !== null && !options.includes(text)) options.push(text);
    if (options.length === EVI_LIMITS.maxOptions) break;
  }
  let picks: EviPick[] | null = null;
  if (value.results !== null && value.results !== undefined) {
    if (!Array.isArray(value.results) || value.results.length !== EVI_LIMITS.results) return null;
    picks = [];
    for (const item of value.results) {
      if (!isPlainObject(item) || typeof item.cardKey !== "string" || !cardKeys.has(item.cardKey)) return null;
      const why = cleanText(item.why, EVI_LIMITS.maxWhyChars);
      if (why === null || picks.some((pick) => pick.cardKey === item.cardKey)) return null;
      picks.push({ cardKey: item.cardKey, why });
    }
  }
  const mood: EviMood = picks !== null ? "eureka" : isEviMood(value.mood) && value.mood !== "eureka" ? value.mood : "talk";
  return { message, mood, options, multi: value.multi === true && options.length > 1, picks };
}

/**
 * История разговора из браузера: только роли user/assistant с непустым текстом в пределах лимитов, последнее —
 * сообщение ученика, не длиннее `maxTurns`. Иначе null (лимит разговора отличается отдельно — `historyTooLong`).
 */
export function parseEviHistory(value: unknown): EviTurn[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > EVI_LIMITS.maxTurns) return null;
  const turns: EviTurn[] = [];
  for (const item of value) {
    if (!isPlainObject(item) || (item.role !== "user" && item.role !== "assistant")) return null;
    const max = item.role === "user" ? EVI_LIMITS.maxUserChars : EVI_LIMITS.maxAssistantChars;
    const content = cleanText(item.content, max);
    if (content === null) return null;
    turns.push({ role: item.role, content });
  }
  return turns[turns.length - 1]?.role === "user" ? turns : null;
}

export function historyTooLong(value: unknown): boolean {
  return Array.isArray(value) && value.length > EVI_LIMITS.maxTurns;
}
