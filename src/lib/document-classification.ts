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
