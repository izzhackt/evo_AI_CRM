/**
 * «ИИ-агент» P1 (docs/EVO_AI_AGENT_PLAN_2026-10-06.md §6, §10, §12): чистый
 * контракт окна ИИ в чате продаж и раздела «ИИ-агент» без React и без сервера.
 * Его читают маршруты CRM, клиентское окно, серверные страницы и Node-тесты.
 *
 * Что окно показывает, решает база: сохранённый ответ и его актуальность —
 * `platform.ai_agent_answer_current_v1` (источники — из ai_chunks /
 * ai_documents, миграция 270), вставка — `ai_agent_answer_insert_v1` (409 —
 * ответ устарел). Поток SSE агента — только живой предпросмотр: вставляется
 * всегда проверенный сохранённый текст.
 */
import { PLATFORM_ORGANIZATION_TIMEZONE } from "../platform-organization-time.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type AiAudience = "client" | "internal";
export type AiIntent = "reply" | "followup";
export type AiLanguage = "ru" | "ky" | "en";

/** Строка источника — из базы (270), не из JSON агента. */
export type AiSource = Readonly<{
  n: number | null;
  chunkId: number | null;
  documentId: string | null;
  title: string | null;
  audience: AiAudience | null;
  pageFrom: number | null;
  pageTo: number | null;
  sheetName: string | null;
  sectionPath: string;
  quote: string | null;
  /** Документ ещё действует (готов или на сверке, не заменён). */
  live: boolean;
  /** Фрагмента больше нет: документ удалён. */
  missing: boolean;
  /** На страницах фрагмента открыты пункты «Листа сверки». */
  unverified: boolean;
  unverifiedValues: readonly string[];
}>;

export type AiCitation = Readonly<{ n: number; chunkId: number }>;
export type AiReplyCitation = Readonly<{ n: number; start: number; end: number }>;

export type AiAnswerResult = Readonly<{
  reply: string;
  reason: string;
  question: string;
  language: AiLanguage | null;
  citations: readonly AiCitation[];
  replyCitations: readonly AiReplyCitation[];
  sources: readonly AiSource[];
  warnings: readonly string[];
}>;

export type AiSavedAnswer = Readonly<{
  answerId: string;
  status: "pending" | "ready" | "failed" | "superseded";
  intent: AiIntent;
  current: boolean;
  result: AiAnswerResult | null;
  errorCode: string | null;
  createdAt: string;
  insertedAt: string | null;
}>;

export type AiAnswerView = Readonly<{
  answer: AiSavedAnswer | null;
  latestInboundMessageId: string | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  consentRecorded: boolean;
}>;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 20_000): string => (typeof value === "string" ? value.slice(0, max) : "");
const nullableText = (value: unknown, max = 20_000): string | null => (typeof value === "string" ? value.slice(0, max) : null);
const smallInt = (value: unknown, max: number): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;
const uuidOrNull = (value: unknown): string | null => (typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null);

export class AiAgentShapeError extends Error {
  constructor() {
    super("ai_agent_shape_invalid");
    this.name = "AiAgentShapeError";
  }
}
const invalid = (): never => { throw new AiAgentShapeError(); };

function normalizeSource(value: unknown): AiSource | null {
  if (!isObject(value)) return null;
  const audience = value.audience === "client" || value.audience === "internal" ? value.audience : null;
  const missing = value.missing === true;
  return Object.freeze({
    n: smallInt(value.n, 999),
    chunkId: smallInt(value.chunk_id, Number.MAX_SAFE_INTEGER),
    documentId: uuidOrNull(value.document_id),
    title: missing ? null : nullableText(value.title, 240),
    audience: missing ? null : audience,
    pageFrom: smallInt(value.page_from, 300),
    pageTo: smallInt(value.page_to, 300),
    sheetName: nullableText(value.sheet_name, 200),
    sectionPath: text(value.section_path, 1000),
    quote: missing ? null : nullableText(value.quote, 4000),
    live: value.live === true,
    missing,
    unverified: value.unverified === true,
    unverifiedValues: Object.freeze(Array.isArray(value.unverified_values)
      ? value.unverified_values.filter((item): item is string => typeof item === "string").slice(0, 20).map((item) => item.slice(0, 100))
      : []),
  });
}

function normalizeResult(value: unknown): AiAnswerResult | null {
  if (!isObject(value) || typeof value.reply !== "string") return null;
  const language = value.language === "ru" || value.language === "ky" || value.language === "en" ? value.language : null;
  const citations = Array.isArray(value.citations) ? value.citations.flatMap((item) => {
    if (!isObject(item)) return [];
    const n = smallInt(item.n, 999), chunkId = smallInt(item.chunk_id, Number.MAX_SAFE_INTEGER);
    return n !== null && chunkId !== null ? [Object.freeze({ n, chunkId })] : [];
  }) : [];
  const replyCitations = Array.isArray(value.reply_citations) ? value.reply_citations.flatMap((item) => {
    if (!isObject(item)) return [];
    const n = smallInt(item.n, 999), start = smallInt(item.start, 20_000), end = smallInt(item.end, 20_000);
    return n !== null && start !== null && end !== null && end >= start ? [Object.freeze({ n, start, end })] : [];
  }) : [];
  return Object.freeze({
    reply: value.reply.slice(0, 8000),
    reason: text(value.reason, 4000),
    question: text(value.question, 2000),
    language,
    citations: Object.freeze(citations),
    replyCitations: Object.freeze(replyCitations),
    sources: Object.freeze((Array.isArray(value.sources) ? value.sources : []).map(normalizeSource).filter((item): item is AiSource => item !== null).slice(0, 20)),
    warnings: Object.freeze((Array.isArray(value.warnings) ? value.warnings : []).filter((item): item is string => typeof item === "string").slice(0, 6).map((item) => item.slice(0, 200))),
  });
}

/** Ответ `ai_agent_answer_current_v1`; чужая форма — ошибка, а не пустое окно. */
export function normalizeAiAnswerView(value: unknown): AiAnswerView {
  if (!isObject(value) || typeof value.consentRecorded !== "boolean") return invalid();
  const direction = value.lastMessageDirection === "inbound" || value.lastMessageDirection === "outbound" ? value.lastMessageDirection : null;
  if (value.lastMessageDirection !== null && value.lastMessageDirection !== undefined && direction === null) return invalid();
  let answer: AiSavedAnswer | null = null;
  if (value.answer !== null && value.answer !== undefined) {
    const raw = value.answer;
    if (!isObject(raw)) return invalid();
    const answerId = uuidOrNull(raw.answerId);
    const status = raw.status === "pending" || raw.status === "ready" || raw.status === "failed" || raw.status === "superseded" ? raw.status : null;
    const intent = raw.intent === "reply" || raw.intent === "followup" ? raw.intent : null;
    if (!answerId || !status || !intent || typeof raw.current !== "boolean" || typeof raw.createdAt !== "string") return invalid();
    const result = status === "ready" ? normalizeResult(raw.result) : null;
    if (status === "ready" && result === null) return invalid();
    answer = Object.freeze({
      answerId, status, intent, current: raw.current && status === "ready", result,
      errorCode: typeof raw.errorCode === "string" ? raw.errorCode.slice(0, 64) : null,
      createdAt: raw.createdAt,
      insertedAt: typeof raw.insertedAt === "string" ? raw.insertedAt : null,
    });
  }
  return Object.freeze({
    answer,
    latestInboundMessageId: uuidOrNull(value.latestInboundMessageId),
    lastMessageDirection: direction,
    consentRecorded: value.consentRecorded,
  });
}

// ------------------------------------------------------------------ SSE

export type AiStreamEvent =
  | Readonly<{ type: "status"; stage: "searching" | "writing" }>
  | Readonly<{ type: "sources"; count: number }>
  | Readonly<{ type: "delta"; text: string }>
  | Readonly<{ type: "final"; answerId: string | null }>
  | Readonly<{ type: "error"; code: string; message: string | null; status: number }>;

/**
 * Разбор потока `text/event-stream` по кадрам: `event:`/`data:`, пустая строка
 * завершает кадр, `: ping` — комментарий. Кадр, разорванный между кусками,
 * ждёт продолжения.
 */
export function createSseDecoder(): (chunk: string) => Array<Readonly<{ event: string; data: string }>> {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.replace(/\r\n?/gu, "\n");
    const frames: Array<Readonly<{ event: string; data: string }>> = [];
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of raw.split("\n")) {
        if (line === "" || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const content = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /u, "");
        if (field === "event") event = content;
        else if (field === "data") data.push(content);
      }
      if (data.length > 0) frames.push(Object.freeze({ event, data: data.join("\n") }));
      boundary = buffer.indexOf("\n\n");
    }
    if (buffer.length > 262_144) buffer = "";
    return frames;
  };
}

/** Кадр агента (§6.3) → событие окна; чужой кадр — null. */
export function parseAiStreamEvent(event: string, data: string): AiStreamEvent | null {
  let payload: unknown;
  try { payload = JSON.parse(data); } catch { return null; }
  if (!isObject(payload)) return null;
  if (event === "status") {
    return payload.stage === "searching" || payload.stage === "writing" ? { type: "status", stage: payload.stage } : null;
  }
  if (event === "sources") {
    const count = smallInt(payload.count, 999);
    return count === null ? null : { type: "sources", count };
  }
  if (event === "delta") return typeof payload.text === "string" ? { type: "delta", text: payload.text.slice(0, 8000) } : null;
  if (event === "final") {
    const answer = isObject(payload.answer) ? payload.answer : null;
    return { type: "final", answerId: uuidOrNull(answer?.answer_id) };
  }
  if (event === "error") {
    const code = typeof payload.code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(payload.code) ? payload.code : "unavailable";
    const status = smallInt(payload.status, 599) ?? 503;
    const message = typeof payload.message_ru === "string" && payload.message_ru.trim() && payload.message_ru.length <= 300
      ? payload.message_ru.trim() : null;
    return { type: "error", code, message, status };
  }
  return null;
}

// ------------------------------------------------------------------ copy

/**
 * Честные состояния окна (§6.8). Известный код — наш текст; незнакомый —
 * короткий текст агента, если он есть, иначе общий.
 */
export const AI_ERROR_COPY: Readonly<Record<string, string>> = Object.freeze({
  ai_agent_off: "ИИ-агент не подключён к CRM — подключает администратор.",
  consent_required: "ИИ-агента включает администратор в разделе «ИИ-агент».",
  agent_unavailable: "ИИ-агент сейчас недоступен.",
  rate_limited: "Слишком много запросов. Подождите минуту.",
  budget_exhausted: "Месячный лимит расходов на ИИ исчерпан. Его можно поднять в «Расходах».",
  ai_model_unpriced: "У модели нет цены на сегодня — расходы не посчитать. Выберите другую модель в «Расходах».",
  gemini_billing: "Закончился оплаченный баланс Gemini. Пополните его в Google Cloud.",
  gemini_quota_day: "Дневной лимит запросов к модели исчерпан.",
  stale_answer: "Пришло новое сообщение — обновите ответ.",
  forbidden: "Помощник недоступен в этом чате.",
  preview: "В просмотре роли помощник не вызывается.",
  invalid_request: "Не удалось подготовить ответ. Обновите страницу.",
  unavailable: "Не удалось подготовить ответ. Повторите.",
});

export function aiErrorCopy(code: string, agentMessage: string | null = null): string {
  return AI_ERROR_COPY[code] ?? agentMessage ?? AI_ERROR_COPY.unavailable;
}

/** Ошибки, после которых «Повторить» имеет смысл сразу. */
export function aiErrorRetryable(code: string): boolean {
  return !["ai_agent_off", "consent_required", "forbidden", "preview", "gemini_billing", "gemini_quota_day",
    "budget_exhausted", "ai_model_unpriced"].includes(code);
}

/** «1 источник», «3 источника», «5 источников». */
export function sourcesWord(count: number): string {
  const mod10 = count % 10, mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} источник`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} источника`;
  return `${count} источников`;
}

/** Где в документе: «стр. 3», «стр. 3–4», «лист «Тарифы»». */
export function sourcePlace(source: Pick<AiSource, "pageFrom" | "pageTo" | "sheetName">): string | null {
  if (source.sheetName) return `лист «${source.sheetName}»`;
  if (source.pageFrom === null) return null;
  return source.pageTo !== null && source.pageTo !== source.pageFrom
    ? `стр. ${source.pageFrom}–${source.pageTo}` : `стр. ${source.pageFrom}`;
}

export type ReplySegment = Readonly<{ text: string; marks: readonly number[] }>;

/**
 * Текст ответа с номерами источников (§6.4): `reply_citations` агента — отрезки
 * в знаках (кодовых точках) ответа; номер ставится после отрезка и только если
 * ведёт на клиентский источник ответа. Без отрезков — текст одним куском.
 */
export function replySegments(result: Pick<AiAnswerResult, "reply" | "replyCitations" | "citations" | "sources">): readonly ReplySegment[] {
  const chars = Array.from(result.reply);
  const allowed = new Set(result.citations.map((item) => item.n)
    .filter((n) => result.sources.some((source) => source.n === n && source.audience === "client" && !source.missing)));
  const marksAt = new Map<number, number[]>();
  for (const citation of result.replyCitations) {
    if (!allowed.has(citation.n)) continue;
    const at = Math.min(Math.max(citation.end, 0), chars.length);
    const list = marksAt.get(at) ?? [];
    if (!list.includes(citation.n)) list.push(citation.n);
    marksAt.set(at, list);
  }
  const segments: ReplySegment[] = [];
  let from = 0;
  for (const at of [...marksAt.keys()].sort((left, right) => left - right)) {
    segments.push({ text: chars.slice(from, at).join(""), marks: Object.freeze(marksAt.get(at)!.sort((a, b) => a - b)) });
    from = at;
  }
  if (from < chars.length || segments.length === 0) segments.push({ text: chars.slice(from).join(""), marks: Object.freeze([]) });
  return Object.freeze(segments);
}

/**
 * Жёлтые плашки «Проверьте факты» (§6.4): что сказала проверка агента, и —
 * по строкам из базы — нет ни одного клиентского источника.
 */
export function answerWarnings(result: AiAnswerResult): readonly string[] {
  const out = [...result.warnings];
  const clientSources = result.sources.filter((source) => source.audience === "client" && !source.missing);
  if (clientSources.length === 0 && !out.some((item) => item.startsWith("Проверьте факты"))) {
    out.unshift("Проверьте факты — источники не найдены");
  }
  if (result.sources.some((source) => source.audience === "client" && source.unverified)
    && !out.includes("Число в источнике ещё не проверено")) out.push("Число в источнике ещё не проверено");
  return Object.freeze([...new Set(out)]);
}

// ------------------------------------------------------------------ section

export const AI_AGENT_SECTIONS = Object.freeze([
  { key: "documents", title: "Информация для агента" },
  { key: "rules", title: "Правила общения" },
  { key: "spend", title: "Расходы" },
] as const);
export type AiAgentSection = (typeof AI_AGENT_SECTIONS)[number]["key"];

export function parseAiAgentSection(value: string | undefined): AiAgentSection | null {
  if (value === undefined) return "documents";
  return AI_AGENT_SECTIONS.some((section) => section.key === value) ? value as AiAgentSection : null;
}
export function aiAgentHref(section: AiAgentSection): string {
  return section === "documents" ? "/v3/ai-agent" : `/v3/ai-agent?section=${section}`;
}

/** Версия текста согласия на передачу текстов в Gemini (Q4), её видит журнал. */
export const AI_CONSENT_TEXT_VERSION = "gemini-v1-2026-10-06";

export type AiDocumentStatus = "queued" | "processing" | "review" | "ready" | "failed" | "superseded";
export type AiDocument = Readonly<{
  id: string;
  title: string;
  kind: string;
  audience: AiAudience;
  status: AiDocumentStatus;
  stage: string | null;
  progress: number;
  errorCode: string | null;
  source: "upload" | "seed_kb" | "lab";
  sourceNodeVersion: number | null;
  editedInLab: boolean;
  rowVersion: number;
  pageCount: number | null;
  chunkCount: number;
  openReviewCount: number;
  updatedAt: string;
}>;

const DOCUMENT_STATUSES = new Set(["queued", "processing", "review", "ready", "failed", "superseded"]);

export function normalizeAiDocuments(value: unknown): Readonly<{ items: readonly AiDocument[]; hasMore: boolean; canManage: boolean; isAdmin: boolean }> {
  if (!isObject(value) || !Array.isArray(value.items) || typeof value.hasMore !== "boolean"
    || typeof value.canManage !== "boolean" || typeof value.isAdmin !== "boolean") return invalid();
  const items = value.items.map((raw) => {
    if (!isObject(raw)) return invalid();
    const id = uuidOrNull(raw.id);
    const audience = raw.audience === "client" || raw.audience === "internal" ? raw.audience : null;
    const source = raw.source === "upload" || raw.source === "seed_kb" || raw.source === "lab" ? raw.source : null;
    if (!id || typeof raw.title !== "string" || !audience || !source || typeof raw.status !== "string"
      || !DOCUMENT_STATUSES.has(raw.status) || typeof raw.updatedAt !== "string") return invalid();
    const ref = isObject(raw.sourceRef) ? raw.sourceRef : {};
    return Object.freeze({
      id, title: raw.title.slice(0, 240), kind: text(raw.kind, 20), audience, status: raw.status as AiDocumentStatus,
      stage: nullableText(raw.stage, 20), progress: smallInt(raw.progress, 100) ?? 0,
      errorCode: nullableText(raw.errorCode, 64), source,
      sourceNodeVersion: smallInt(ref.nodeVersion, 1_000_000) ?? (typeof ref.nodeVersion === "string" && /^\d{1,6}$/u.test(ref.nodeVersion) ? Number(ref.nodeVersion) : null),
      editedInLab: raw.editedInLab === true,
      rowVersion: smallInt(raw.rowVersion, Number.MAX_SAFE_INTEGER) ?? invalid(),
      pageCount: smallInt(raw.pageCount, 300),
      chunkCount: smallInt(raw.chunkCount, 1_000_000) ?? 0,
      openReviewCount: smallInt(raw.openReviewCount, 1_000_000) ?? 0,
      updatedAt: raw.updatedAt,
    });
  });
  return Object.freeze({ items: Object.freeze(items), hasMore: value.hasMore, canManage: value.canManage, isAdmin: value.isAdmin });
}

const STAGE_WORDS: Readonly<Record<string, string>> = {
  extract: "извлечение текста", ocr: "распознавание", structure: "разметка", chunk: "фрагменты",
  enrich: "заголовки", embed: "векторы", index: "индекс",
};

/** Слово статуса документа и тон чипа: всегда со словом. */
export function documentStatus(document: Pick<AiDocument, "status" | "stage" | "progress">): Readonly<{ label: string; tone: "ok" | "warn" | "danger" | "muted" }> {
  switch (document.status) {
    case "ready": return { label: "Готов", tone: "ok" };
    case "review": return { label: "Готов, есть сверка", tone: "warn" };
    case "failed": return { label: "Ошибка обработки", tone: "danger" };
    case "superseded": return { label: "Заменён", tone: "muted" };
    case "queued": return { label: "В очереди", tone: "muted" };
    default: {
      const stage = document.stage ? STAGE_WORDS[document.stage] ?? null : null;
      return { label: `Обрабатывается${stage ? ` · ${stage}` : ""}${document.progress > 0 ? ` · ${document.progress}%` : ""}`, tone: "muted" };
    }
  }
}

export const AUDIENCE_LABEL: Readonly<Record<AiAudience, string>> = Object.freeze({ client: "Для клиентов", internal: "Внутреннее" });

export type AiRulesVersion = Readonly<{
  id: string; version: number; source: "seed" | "lab" | "manual"; createdAt: string; createdByName: string | null;
  confirmedAt: string | null; bytes: number; current: boolean;
}>;
export type AiRules = Readonly<{
  current: Readonly<{ id: string; version: number; body: string; source: "seed" | "lab" | "manual"; createdAt: string;
    createdByName: string | null; confirmedAt: string | null; confirmedByName: string | null; needsReview: boolean }> | null;
  versions: readonly AiRulesVersion[];
  canManage: boolean;
}>;

const RULE_SOURCES = new Set(["seed", "lab", "manual"]);
/** «Правила общения» — предел текста версии в байтах UTF-8 (269). */
export const AI_RULES_BYTE_LIMIT = 32_768;

export function normalizeAiRules(value: unknown): AiRules {
  if (!isObject(value) || !Array.isArray(value.versions) || typeof value.canManage !== "boolean") return invalid();
  let current: AiRules["current"] = null;
  if (value.current !== null && value.current !== undefined) {
    const raw = value.current;
    if (!isObject(raw) || !uuidOrNull(raw.id) || typeof raw.body !== "string" || typeof raw.createdAt !== "string"
      || !RULE_SOURCES.has(String(raw.source)) || smallInt(raw.version, 1_000_000) === null) return invalid();
    current = Object.freeze({
      id: uuidOrNull(raw.id)!, version: raw.version as number, body: raw.body, source: raw.source as "seed" | "lab" | "manual",
      createdAt: raw.createdAt, createdByName: nullableText(raw.createdByName, 200),
      confirmedAt: nullableText(raw.confirmedAt, 64), confirmedByName: nullableText(raw.confirmedByName, 200),
      needsReview: raw.needsReview === true,
    });
  }
  const versions = value.versions.map((raw) => {
    if (!isObject(raw) || !uuidOrNull(raw.id) || typeof raw.createdAt !== "string" || !RULE_SOURCES.has(String(raw.source))
      || smallInt(raw.version, 1_000_000) === null) return invalid();
    return Object.freeze({
      id: uuidOrNull(raw.id)!, version: raw.version as number, source: raw.source as "seed" | "lab" | "manual",
      createdAt: raw.createdAt, createdByName: nullableText(raw.createdByName, 200),
      confirmedAt: nullableText(raw.confirmedAt, 64), bytes: smallInt(raw.bytes, 1_000_000) ?? 0, current: raw.current === true,
    });
  });
  return Object.freeze({ current, versions: Object.freeze(versions), canManage: value.canManage });
}

export const RULE_SOURCE_LABEL: Readonly<Record<"seed" | "lab" | "manual", string>> = Object.freeze({
  seed: "из «Базы знаний»", lab: "из Лаборатории", manual: "вручную",
});

export type AiPurposeGroup = "answers" | "search" | "precompute" | "memory" | "documents" | "ocr" | "laboratory" | "autosend" | "probe" | "dictation";
export const PURPOSE_GROUP_LABEL: Readonly<Record<AiPurposeGroup, string>> = Object.freeze({
  answers: "Ответы клиентам", search: "Поиск", precompute: "Подготовка заранее", memory: "Память о клиенте",
  documents: "Обработка документов", ocr: "Распознавание сканов", laboratory: "Лаборатория", autosend: "Автоответчик",
  probe: "Проверка доступности", dictation: "Диктовка",
});

export type AiSpend = Readonly<{
  today: string; monthStart: string;
  todayUsd: number; monthUsd: number; monthEstimated: boolean; forecastUsd: number;
  monthlyCapUsd: number; reservedUsd: number; remainingUsd: number;
  answers: number; averageAnswerUsd: number | null;
  byGroup: readonly Readonly<{ group: AiPurposeGroup; usd: number; calls: number; estimated: boolean }>[];
  priceChanges: readonly Readonly<{ model: string; kind: string; effectiveFrom: string; usdPerMillion: number; previousUsdPerMillion: number | null }>[];
}>;

const money = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : typeof value === "string" && /^-?\d+(?:\.\d+)?$/u.test(value) ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 && number < 1e9 ? number : null;
};
const isoDate = (value: unknown): string | null => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : null);

export function normalizeAiSpend(value: unknown): AiSpend {
  if (!isObject(value)) return invalid();
  const need = (number: number | null) => number ?? invalid();
  const groups = Object.keys(PURPOSE_GROUP_LABEL);
  return Object.freeze({
    today: isoDate(value.today) ?? invalid(),
    monthStart: isoDate(value.monthStart) ?? invalid(),
    todayUsd: need(money(value.todayUsd)),
    monthUsd: need(money(value.monthUsd)),
    monthEstimated: value.monthEstimated === true,
    forecastUsd: need(money(value.forecastUsd)),
    monthlyCapUsd: need(money(value.monthlyCapUsd)),
    reservedUsd: need(money(value.reservedUsd)),
    remainingUsd: need(money(value.remainingUsd)),
    answers: smallInt(value.answers, Number.MAX_SAFE_INTEGER) ?? need(money(value.answers)),
    averageAnswerUsd: value.averageAnswerUsd === null || value.averageAnswerUsd === undefined ? null : need(money(value.averageAnswerUsd)),
    byGroup: Object.freeze((Array.isArray(value.byGroup) ? value.byGroup : invalid()).map((raw) => {
      if (!isObject(raw) || typeof raw.group !== "string" || !groups.includes(raw.group)) return invalid();
      return Object.freeze({ group: raw.group as AiPurposeGroup, usd: need(money(raw.usd)), calls: smallInt(raw.calls, Number.MAX_SAFE_INTEGER) ?? 0, estimated: raw.estimated === true });
    })),
    priceChanges: Object.freeze((Array.isArray(value.priceChanges) ? value.priceChanges : []).flatMap((raw) => {
      if (!isObject(raw) || typeof raw.model !== "string" || typeof raw.kind !== "string") return [];
      const effectiveFrom = isoDate(raw.effectiveFrom), usdPerMillion = money(raw.usdPerMillion);
      if (!effectiveFrom || usdPerMillion === null) return [];
      return [Object.freeze({ model: raw.model.slice(0, 80), kind: raw.kind.slice(0, 20), effectiveFrom, usdPerMillion, previousUsdPerMillion: money(raw.previousUsdPerMillion) })];
    })),
  });
}

export type AiSettings = Readonly<{
  version: number;
  models: Readonly<{ answer: string; fast: string; embedding: string }>;
  unpricedModels: readonly string[];
  monthlyCapUsd: number;
  ratePerMemberMinute: number;
  consent: Readonly<{ recorded: boolean; at: string | null; byName: string | null; textVersion: string | null }>;
  canManage: boolean;
  isAdmin: boolean;
}>;

export function normalizeAiSettings(value: unknown): AiSettings {
  if (!isObject(value) || !isObject(value.models) || !isObject(value.consent)
    || typeof value.canManage !== "boolean" || typeof value.isAdmin !== "boolean") return invalid();
  const models = value.models, consent = value.consent;
  return Object.freeze({
    version: smallInt(value.version, Number.MAX_SAFE_INTEGER) ?? invalid(),
    models: Object.freeze({ answer: text(models.answer, 80), fast: text(models.fast, 80), embedding: text(models.embedding, 80) }),
    unpricedModels: Object.freeze((Array.isArray(value.unpricedModels) ? value.unpricedModels : []).filter((item): item is string => typeof item === "string")),
    monthlyCapUsd: money(value.monthlyCapUsd) ?? invalid(),
    ratePerMemberMinute: smallInt(value.ratePerMemberMinute, 1000) ?? 20,
    consent: Object.freeze({
      recorded: consent.recorded === true, at: nullableText(consent.at, 64), byName: nullableText(consent.byName, 200),
      textVersion: nullableText(consent.textVersion, 40),
    }),
    canManage: value.canManage,
    isAdmin: value.isAdmin,
  });
}

// ------------------------------------------------------------------ format

const USD_SMALL = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const USD = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Доллары: доли цента видны у малых сумм (0,0123 $), от десяти центов — с центами. */
export function formatUsd(value: number, estimated = false): string {
  const formatted = (Math.abs(value) < 0.1 && value !== 0 ? USD_SMALL : USD).format(value);
  return estimated ? `≈ ${formatted}` : formatted;
}

const DATE_TIME = new Intl.DateTimeFormat("ru-RU", {
  timeZone: PLATFORM_ORGANIZATION_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const LONG_DATE = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

/** «06.10.2026, 14:05» по Бишкеку. */
export function aiDateTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DATE_TIME.format(date);
}
/** «1 января 2027 г.» для даты без времени. */
export function aiLongDate(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? day : LONG_DATE.format(date);
}

/** Длина текста в байтах UTF-8 (предел правил — 32 КБ в базе). */
export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}
