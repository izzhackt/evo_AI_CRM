// Pure shared contract for sorting amoCRM-imported files into checklist items (migration 333, PLAN_CHANGES 06.11.2026).
// No I/O, no provider, no authorization: the database decides who may read what, this file names the kinds, the
// confidence bands and the exact shapes that cross the boundary. Shared by the batch command, the staff read and the UI.

export const DOCUMENT_CLASSIFICATION_POLICY = "doc-kind-v1";

/** Группа пунктов, куда импорт из amoCRM сложил файлы без разбора («Из amoCRM (не разобрано)»). */
export const AMO_UNSORTED_GROUP_PATTERN = /^\s*Из amoCRM/i;
export function isAmoUnsortedGroup(label: string): boolean {
  return AMO_UNSORTED_GROUP_PATTERN.test(label);
}

/** Куда попадает принятый файл: пункт получает название вида и эту группу (команда change_document_slot_metadata). */
export const CLASSIFIED_GROUP_LABEL = "Документы студента";

export const DOCUMENT_KINDS = Object.freeze([
  { key: "passport", label: "Паспорт" },
  { key: "attestat", label: "Аттестат / диплом" },
  { key: "transcript", label: "Транскрипт / приложение к аттестату" },
  { key: "photo", label: "Фото" },
  { key: "medical", label: "Медицинская справка" },
  { key: "police_certificate", label: "Справка о несудимости" },
  { key: "bank_statement", label: "Банковская выписка" },
  { key: "motivation_letter", label: "Мотивационное письмо" },
  { key: "language_certificate", label: "Сертификат о знании языка" },
  { key: "birth_certificate", label: "Свидетельство о рождении" },
  { key: "recommendation_letter", label: "Рекомендательное письмо" },
  { key: "application_form", label: "Анкета / заявление" },
  { key: "payment_receipt", label: "Чек об оплате" },
] as const);
export type DocumentKindKey = (typeof DOCUMENT_KINDS)[number]["key"];
/** Ответ модели может быть «другое»: такой файл остаётся на ручной выбор и никогда не принимается пачкой. */
export type DocumentClassificationKey = DocumentKindKey | "other";
export const DOCUMENT_CLASSIFICATION_KEYS = Object.freeze([...DOCUMENT_KINDS.map((kind) => kind.key), "other"] as DocumentClassificationKey[]);

const KIND_BY_KEY: ReadonlyMap<string, string> = new Map(DOCUMENT_KINDS.map((kind) => [kind.key, kind.label]));
export function isDocumentKindKey(value: unknown): value is DocumentKindKey {
  return typeof value === "string" && KIND_BY_KEY.has(value);
}
export function documentKindLabel(key: DocumentKindKey): string {
  return KIND_BY_KEY.get(key) ?? key;
}

/**
 * Что сотрудник может выбрать вручную сверх 13 видов ИИ (решение владельца 08.11.2026). ИИ эти значения не подсказывает: список
 * видов модели, схема её ответа и `kind_key` подсказок остаются прежними (`DOCUMENT_KINDS`).
 *  - contract: принятый файл становится договором дела в «Деньги» (миграция 189);
 *  - other: своё название пункта (`normalizeCustomDocumentLabel`);
 *  - not_needed: пункт скрывается мягким удалением (`remove_document_slot`), файл остаётся в архиве удалённых пунктов.
 */
export const STAFF_EXTRA_KINDS = Object.freeze([
  { key: "contract", label: "Договор" },
  { key: "other", label: "Другое…" },
  { key: "not_needed", label: "Не нужное" },
] as const);
export type StaffExtraKindKey = (typeof STAFF_EXTRA_KINDS)[number]["key"];
export type AcceptKindKey = DocumentKindKey | StaffExtraKindKey;
export const CONTRACT_KIND_LABEL = "Договор";
const STAFF_EXTRA_KEYS: ReadonlySet<string> = new Set(STAFF_EXTRA_KINDS.map((kind) => kind.key));
export function isAcceptKindKey(value: unknown): value is AcceptKindKey {
  return isDocumentKindKey(value) || (typeof value === "string" && STAFF_EXTRA_KEYS.has(value));
}
export function acceptKindLabel(key: AcceptKindKey): string {
  return isDocumentKindKey(key) ? documentKindLabel(key) : STAFF_EXTRA_KINDS.find((kind) => kind.key === key)?.label ?? key;
}
/** Виды, которых по природе несколько на дело: для них проверка «пункт с таким названием уже есть» не применяется (паспорт и прочие одиночные её сохраняют). */
const DEDUPE_EXEMPT: ReadonlySet<string> = new Set<AcceptKindKey>(["payment_receipt", "contract", "other"]);
export function dedupeAppliesTo(kind: AcceptKindKey): boolean {
  return !DEDUPE_EXEMPT.has(kind);
}
/** Виды, которые при приёме уходят в «Деньги»: договор и чек. */
export function isFinanceKind(kind: AcceptKindKey): kind is "contract" | "payment_receipt" {
  return kind === "contract" || kind === "payment_receipt";
}
export const CUSTOM_DOCUMENT_LABEL_MAX = 120;
/** Своё название: пробелы по краям и повторы схлопываются, 1–120 знаков, без управляющих символов; иначе null. */
export function normalizeCustomDocumentLabel(raw: unknown): string | null {
  if (typeof raw !== "string" || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(raw)) return null;
  const label = raw.replace(/\s+/g, " ").trim();
  return label.length >= 1 && label.length <= CUSTOM_DOCUMENT_LABEL_MAX ? label : null;
}

/**
 * «Другое…» с названием стандартного вида (follow-up к PR 1403, 08.11.2026): «Паспорт», «паспорт », «Passport», «Паспорт» на кыргызском -
 * это тот же вид, а не второй документ под своей подписью. Сервер (`acceptOne`) сводит такое название к стандартному виду и дальше
 * действует как при выборе из списка, включая отказ «пункт с таким названием уже есть». Сравнение без регистра, пробелов и
 * знаков препинания («Аттестат/диплом» = «аттестат / диплом»). «Другое…» как название вида не считается (null).
 */
const STANDARD_KIND_ALIASES: Readonly<Record<Exclude<AcceptKindKey, "other">, readonly string[]>> = Object.freeze({
  passport: ["Паспорт", "Passport"],
  attestat: ["Аттестат / диплом", "Аттестат", "Диплом", "Certificate / diploma", "Diploma", "School certificate"],
  transcript: ["Транскрипт / приложение к аттестату", "Транскрипт", "Transcript", "Academic transcript"],
  photo: ["Фото", "Сүрөт", "Photo"],
  medical: ["Медицинская справка", "Медициналык справка", "Medical certificate"],
  police_certificate: ["Справка о несудимости", "Соттолбогондугу тууралуу справка", "Police certificate", "Police clearance certificate"],
  bank_statement: ["Банковская выписка", "Банк көчүрмөсү", "Bank statement"],
  motivation_letter: ["Мотивационное письмо", "Мотивациялык кат", "Motivation letter"],
  language_certificate: ["Сертификат о знании языка", "Тил билүү сертификаты", "Language certificate"],
  birth_certificate: ["Свидетельство о рождении", "Туулгандыгы тууралуу күбөлүк", "Birth certificate"],
  recommendation_letter: ["Рекомендательное письмо", "Сунуштама кат", "Recommendation letter"],
  application_form: ["Анкета / заявление", "Анкета", "Заявление", "Анкета / арыз", "Арыз", "Application form"],
  payment_receipt: ["Чек об оплате", "Чек", "Төлөм чеги", "Чек (төлөм)", "Payment receipt", "Receipt"],
  contract: ["Договор", "Келишим", "Contract", "Agreement"],
  not_needed: ["Не нужное", "Кереги жок", "Not needed"],
});
function foldKindLabel(raw: string): string {
  return raw.normalize("NFKC").toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
const STANDARD_KIND_BY_FOLDED: ReadonlyMap<string, AcceptKindKey> = new Map(
  (Object.entries(STANDARD_KIND_ALIASES) as [AcceptKindKey, readonly string[]][])
    .flatMap(([key, labels]) => labels.map((label): [string, AcceptKindKey] => [foldKindLabel(label), key])),
);
export function matchStandardKindLabel(raw: string): AcceptKindKey | null {
  const folded = foldKindLabel(raw);
  return folded === "" ? null : STANDARD_KIND_BY_FOLDED.get(folded) ?? null;
}

/** Порог «уверенно»: только такие файлы принимает кнопка «Принять все уверенные». Ниже порога «возможно» подсказка не показывается. */
export const CONFIDENCE_CONFIDENT = 0.9;
export const CONFIDENCE_POSSIBLE = 0.6;
export type ConfidenceBand = "confident" | "possible" | "unknown";
export function confidenceBand(kind: DocumentClassificationKey | null, confidence: number | null): ConfidenceBand {
  if (kind === null || kind === "other" || confidence === null || !Number.isFinite(confidence)) return "unknown";
  if (confidence >= CONFIDENCE_CONFIDENT) return "confident";
  return confidence >= CONFIDENCE_POSSIBLE ? "possible" : "unknown";
}
/** Итог для хранения: «suggested» только когда подсказку можно показать; остальное «unsure» (вид сохраняется, но не показывается). */
export function classificationStatus(kind: DocumentClassificationKey, confidence: number): "suggested" | "unsure" {
  return confidenceBand(kind, confidence) === "unknown" ? "unsure" : "suggested";
}

/** Только окончательные отказы пишутся строкой и тратят попытку; временный сбой провайдера (429, 5xx, таймаут) - нет. */
export const DOCUMENT_CLASSIFICATION_FAILURES = Object.freeze([
  "provider_rejected", "invalid_result", "source_unavailable", "too_large",
] as const);
export type DocumentClassificationFailure = (typeof DOCUMENT_CLASSIFICATION_FAILURES)[number];

// Схема ответа провайдера: только вид из списка и число. Свободного текста нет: документ - недоверенные данные, а не инструкция.
export const DOCUMENT_CLASSIFICATION_RESULT_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false, required: ["kind", "confidence"],
  properties: {
    kind: { type: "string", enum: [...DOCUMENT_CLASSIFICATION_KEYS] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const);
export type DocumentClassificationResult = Readonly<{ kind: DocumentClassificationKey; confidence: number }>;

export class DocumentClassificationValidationError extends Error {
  constructor() { super("Invalid document classification data"); this.name = "DocumentClassificationValidationError"; }
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const found = Object.keys(value);
  return found.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function isKey(value: unknown): value is DocumentClassificationKey {
  return typeof value === "string" && (DOCUMENT_CLASSIFICATION_KEYS as readonly string[]).includes(value);
}
/** Ответ модели принимается только в точной форме; значение округляется до трёх знаков, как хранит база. */
export function normalizeDocumentClassificationResult(value: unknown): DocumentClassificationResult {
  if (!record(value) || !exactKeys(value, ["kind", "confidence"]) || !isKey(value.kind)
    || typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new DocumentClassificationValidationError();
  }
  return Object.freeze({ kind: value.kind, confidence: Math.round(value.confidence * 1000) / 1000 });
}

export type DocumentSuggestion = Readonly<{
  documentSlotId: string;
  documentVersionId: string;
  status: "suggested" | "unsure";
  kind: DocumentClassificationKey;
  confidence: number;
}>;
export type CaseDocumentSuggestions = Readonly<{ aiAllowed: boolean; items: readonly DocumentSuggestion[] }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ответ staff_document_suggestions_v1. Чужая форма - ошибка, а не «подсказок нет»: вызывающий решает, как это показать. */
export function normalizeCaseDocumentSuggestions(value: unknown): CaseDocumentSuggestions {
  if (!record(value) || !exactKeys(value, ["ai_allowed", "items"]) || typeof value.ai_allowed !== "boolean"
    || !Array.isArray(value.items) || value.items.length > 500) throw new DocumentClassificationValidationError();
  const items = value.items.map((item): DocumentSuggestion => {
    if (!record(item) || !exactKeys(item, ["document_slot_id", "document_version_id", "status", "kind_key", "confidence"])
      || typeof item.document_slot_id !== "string" || !UUID.test(item.document_slot_id)
      || typeof item.document_version_id !== "string" || !UUID.test(item.document_version_id)
      || (item.status !== "suggested" && item.status !== "unsure") || !isKey(item.kind_key)) throw new DocumentClassificationValidationError();
    // numeric(4,3) приходит из PostgREST числом или строкой.
    const confidence = typeof item.confidence === "string" ? Number(item.confidence) : item.confidence;
    if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new DocumentClassificationValidationError();
    return Object.freeze({ documentSlotId: item.document_slot_id.toLowerCase(), documentVersionId: item.document_version_id.toLowerCase(),
      status: item.status, kind: item.kind_key, confidence });
  });
  if (new Set(items.map((item) => item.documentVersionId)).size !== items.length) throw new DocumentClassificationValidationError();
  return Object.freeze({ aiAllowed: value.ai_allowed, items: Object.freeze(items) });
}

/** Что показывает строка: подсказка только в полосах «уверенно» и «возможно». */
export function suggestionView(suggestion: DocumentSuggestion | null):
  Readonly<{ band: ConfidenceBand; kind: DocumentKindKey | null; text: string | null }> {
  if (!suggestion) return Object.freeze({ band: "unknown", kind: null, text: null });
  const band = confidenceBand(suggestion.kind, suggestion.confidence);
  if (band === "unknown" || !isDocumentKindKey(suggestion.kind)) return Object.freeze({ band: "unknown", kind: null, text: null });
  const word = band === "confident" ? "уверенно" : "возможно";
  return Object.freeze({ band, kind: suggestion.kind, text: `Похоже на: ${documentKindLabel(suggestion.kind)} (${word})` });
}
export function acceptLabel(kind: DocumentKindKey): string {
  return `Принять как ${documentKindLabel(kind)}`;
}
