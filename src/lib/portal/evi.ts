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
  /** Вопросов в разговоре не больше — граница для «Вопрос N из M». */
  maxQuestions: 10,
} as const;

/** Где разговор: «Вопрос step из total». Только от модели; нет или неверно — полоски нет. */
export type EviProgress = Readonly<{ step: number; total: number }>;

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
  /** «Вопрос N из M», если модель его прислала и он правдоподобен; с итогом — null. */
  progress: EviProgress | null;
}>;

/**
 * Направление, готовое к показу: карточка каталога (id и ключ — по ключу находится фото профессии), её название и
 * строка «чем занимается» на языке кабинета (из самой карточки, не от модели; null — не рисуется) и объяснение Эви,
 * почему подходит.
 */
export type EviResult = Readonly<{ cardId: string; cardKey: string; title: string; summary: string | null; why: string }>;

export type EviAnswer = Readonly<{
  message: string;
  mood: EviMood;
  options: readonly string[];
  multi: boolean;
  results: readonly EviResult[] | null;
  progress: EviProgress | null;
}>;

export type EviFailure = "consent" | "unavailable" | "limit" | "busy" | "invalid" | "error";

export type EviActionResult =
  | Readonly<{ ok: true; answer: EviAnswer }>
  | Readonly<{ ok: false; reason: EviFailure }>;

/**
 * Одно действие, которым ученик выходит из сбоя: повторить тот же вопрос, начать заново или, пока Эви недоступен,
 * открыть каталог профессий (поле ввода тогда закрыто — сообщения без ответа не копятся). Согласие на ИИ-помощников
 * ученик даёт при регистрации, на рабочих экранах его не спрашивают (решения владельца 07.11 и 14.11.2026, повторено
 * 17.11): отозвал его посреди разговора — для Эви это то же «недоступен».
 */
export const EVI_FAILURE_ACTION = {
  error: "retry",
  busy: "retry",
  limit: "restart",
  invalid: "restart",
  consent: "catalog",
  unavailable: "catalog",
} as const satisfies Record<EviFailure, "retry" | "restart" | "catalog">;

/**
 * Такт робота (исключение владельца 17.11.2026): сначала реакция на новый ответ, потом «говорит» по длине реплики,
 * потом спокойное лицо. Текст при этом виден сразу — такт ничего не задерживает. Миллисекунды.
 */
export const EVI_BEAT = {
  react: { happy: 900, wow: 900, eureka: 2400 },
  /** Короткая радость на действие ученика: выбрал вариант, отправил ответ. */
  poke: 700,
  perWord: 60,
  base: 400,
  speakMin: 800,
  speakMax: 2400,
} as const;

/** Сколько робот «говорит» реплику: 60 мс на слово плюс 400 мс, от 0,8 до 2,4 с. */
export function eviSpeakMs(text: string): number {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return Math.min(EVI_BEAT.speakMax, Math.max(EVI_BEAT.speakMin, words * EVI_BEAT.perWord + EVI_BEAT.base));
}

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
  return { message, mood, options, multi: value.multi === true && options.length > 1, picks, progress: picks ? null : parseEviProgress(value.progress) };
}

/**
 * «Вопрос N из M» от модели: целые 1 ≤ step ≤ total, а total — ровно maxQuestions, как велит промт (иначе полоса прыгала бы
 * от ответа к ответу). Иначе null — без полоски, а не выдуманная цифра.
 */
export function parseEviProgress(value: unknown): EviProgress | null {
  if (!isPlainObject(value)) return null;
  const { step, total } = value;
  if (!Number.isInteger(step) || !Number.isInteger(total)) return null;
  const s = step as number;
  const t = total as number;
  return s >= 1 && s <= t && t === EVI_LIMITS.maxQuestions ? { step: s, total: t } : null;
}

/**
 * История разговора из браузера: только роли user/assistant с непустым текстом в пределах лимитов, первое — реплика
 * Эви (приветствие), последнее — сообщение ученика, не длиннее `maxTurns`. Иначе null (лимит разговора отличается
 * отдельно — `historyTooLong`). Первое сообщение запроса к модели — заметка кабинета; история с репликой ученика
 * в начале слилась бы с ней.
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
  return turns[0]?.role === "assistant" && turns[turns.length - 1]?.role === "user" ? turns : null;
}

export function historyTooLong(value: unknown): boolean {
  return Array.isArray(value) && value.length > EVI_LIMITS.maxTurns;
}
