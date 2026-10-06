/**
 * «ИИ-агент» P2 (docs/EVO_AI_AGENT_PLAN_2026-10-06.md §4.5, §7, §8, §12.2):
 * чистый контракт загрузки знаний, просмотра документа, «Листа сверки» и
 * «Лаборатории» — без React и без сервера. Его читают маршруты CRM, клиентские
 * компоненты, серверные страницы и Node-тесты.
 *
 * Что показывать, решает база (271–273): строки нормализуются строго — чужая
 * форма — ошибка (`AiAgentShapeError`), а не пустой экран. Пути объектов
 * Storage (`imagePath`) — только для сервера CRM: нормализаторы их не
 * пропускают в браузер, остаётся лишь «есть картинка».
 */
import {
  AiAgentShapeError,
  createSseDecoder,
  normalizeAiDocument,
  normalizeResult,
  normalizeSource,
  parseAiStreamEvent,
  type AiAnswerResult,
  type AiAudience,
  type AiDocument,
  type AiSource,
  type AiStreamEvent,
} from "./ai-agent.ts";

export { createSseDecoder };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const invalid = (): never => { throw new AiAgentShapeError(); };
const uuidOrNull = (value: unknown): string | null => (typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null);
const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");
const nullableText = (value: unknown, max: number): string | null => (typeof value === "string" ? value.slice(0, max) : null);
const smallInt = (value: unknown, max: number): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;
const iso = (value: unknown): string | null => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null);

// ------------------------------------------------------------------ upload

/** Предел файла — как у bucket `platform-ai-agent-knowledge` (271, §4.5). */
export const AI_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const AI_UPLOAD_ACCEPT_LABEL = "PDF, DOCX, XLSX, CSV, TXT, MD, PNG, JPEG · до 25 МБ";

export type AiUploadKind = "pdf" | "docx" | "xlsx" | "csv" | "text" | "image";
export type AiUploadFormat = Readonly<{
  extensions: readonly string[];
  kind: AiUploadKind;
  /** Тип объекта в Storage и в строке документа. */
  mimeType: string;
  /** Что браузер может честно назвать типом этого файла; пустой тип — «не знаю». */
  declared: readonly string[];
}>;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const FORMATS: readonly AiUploadFormat[] = [
  { extensions: ["pdf"], kind: "pdf", mimeType: "application/pdf", declared: ["application/pdf"] },
  { extensions: ["docx"], kind: "docx", mimeType: DOCX, declared: [DOCX] },
  { extensions: ["xlsx"], kind: "xlsx", mimeType: XLSX, declared: [XLSX] },
  // Windows называет CSV типом Excel, macOS — text/plain: это тот же текст.
  { extensions: ["csv"], kind: "csv", mimeType: "text/csv", declared: ["text/csv", "application/csv", "text/x-csv", "application/vnd.ms-excel", "text/plain"] },
  { extensions: ["txt"], kind: "text", mimeType: "text/plain", declared: ["text/plain"] },
  { extensions: ["md", "markdown"], kind: "text", mimeType: "text/markdown", declared: ["text/markdown", "text/x-markdown", "text/plain"] },
  { extensions: ["png"], kind: "image", mimeType: "image/png", declared: ["image/png"] },
  { extensions: ["jpg", "jpeg"], kind: "image", mimeType: "image/jpeg", declared: ["image/jpeg", "image/pjpeg"] },
];
export const AI_UPLOAD_FORMATS: readonly AiUploadFormat[] = Object.freeze(FORMATS.map((format) => Object.freeze(format)));

/** Форматы с макросами и старые двоичные форматы Office — никогда (§4.5). */
const MACRO_OR_LEGACY = new Set(["docm", "dotm", "xlsm", "xltm", "xlsb", "xlam", "pptm", "doc", "dot", "xls", "xlt", "ppt"]);

export const AI_UPLOAD_ACCEPT_ATTRIBUTE = [
  ...AI_UPLOAD_FORMATS.flatMap((format) => format.extensions.map((extension) => `.${extension}`)),
  ...new Set(AI_UPLOAD_FORMATS.map((format) => format.mimeType)),
].join(",");

export function aiFileExtension(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

export type AiUploadCheck =
  | Readonly<{ ok: true; format: AiUploadFormat }>
  | Readonly<{ ok: false; code: "empty" | "too_large" | "macro" | "unsupported_type" | "type_mismatch" }>;

/**
 * Проверка до отправки (и та же — на сервере): расширение, заявленный тип и
 * размер. Содержимое (сигнатура, ZIP, кодировка) проверяет только сервер.
 */
export function checkAiUploadFile(name: string, declaredType: string, size: number): AiUploadCheck {
  if (!Number.isSafeInteger(size) || size < 1) return { ok: false, code: "empty" };
  if (size > AI_UPLOAD_MAX_BYTES) return { ok: false, code: "too_large" };
  const extension = aiFileExtension(name);
  if (extension && MACRO_OR_LEGACY.has(extension)) return { ok: false, code: "macro" };
  const format = extension ? AI_UPLOAD_FORMATS.find((candidate) => candidate.extensions.includes(extension)) : undefined;
  if (!format) return { ok: false, code: "unsupported_type" };
  const declared = declaredType.split(";", 1)[0]!.trim().toLowerCase();
  if (declared !== "" && !format.declared.includes(declared)) return { ok: false, code: "type_mismatch" };
  return { ok: true, format };
}

const CONTROL = /[\u0000-\u001f\u007f]/gu;

/** Название документа по имени файла: без расширения, без управляющих знаков, до 240 знаков. */
export function aiTitleFromFileName(name: string): string {
  const extension = aiFileExtension(name);
  const base = extension ? name.slice(0, -(extension.length + 1)) : name;
  const title = base.replace(CONTROL, " ").replace(/[_]+/gu, " ").replace(/\s+/gu, " ").trim();
  return Array.from(title || name.replace(CONTROL, " ").trim() || "Документ").slice(0, 240).join("");
}

export function isAiDocumentTitle(value: string): boolean {
  const length = Array.from(value.trim()).length;
  return length >= 1 && length <= 240 && !/[\u0000-\u001f\u007f]/u.test(value);
}

/**
 * Ответы маршрута загрузки — своими словами. 503 и сеть — «результат
 * неизвестен»: повтор тем же id запроса безопасен (база вернёт прежнюю
 * квитанцию или запишет документ один раз).
 */
export const AI_UPLOAD_ERROR_COPY: Readonly<Record<string, string>> = Object.freeze({
  empty: "Файл пустой.",
  too_large: "Файл больше 25 МБ.",
  macro: "Файлы с макросами и старые форматы Office не принимаются — сохраните как DOCX или XLSX.",
  unsupported_type: "Такой формат не принимается. Подходят PDF, DOCX, XLSX, CSV, TXT, MD, PNG и JPEG.",
  type_mismatch: "Содержимое файла не совпадает с его расширением.",
  content_mismatch: "Содержимое файла не совпадает с его расширением.",
  text_encoding: "Текст должен быть в UTF-8 или Windows-1251.",
  malware_detected: "Файл не прошёл проверку на вирусы.",
  malware_scanner_unavailable: "Проверка на вирусы сейчас недоступна — файл не сохранён. Повторите позже.",
  company_material_required: "Отметьте, что это материал компании, а не документ клиента.",
  client_confirmation_required: "Подтвердите, что материал можно использовать в ответах клиентам.",
  invalid_title: "Название — от 1 до 240 знаков.",
  replacement_pending: "Новая версия этого документа уже обрабатывается.",
  not_found: "Документ, который вы заменяете, уже удалён или заменён. Обновите страницу.",
  conflict: "Документ уже изменился — обновите страницу.",
  forbidden: "Загружать материалы может сотрудник с доступом к «ИИ-агенту».",
  preview: "В просмотре роли файлы не загружаются.",
  authentication_required: "Сессия закончилась — войдите снова.",
  invalid_request: "Не удалось загрузить файл. Обновите страницу.",
  storage_unavailable: "Не удалось сохранить файл. Повторите попытку.",
  unavailable: "Не удалось загрузить файл. Повторите попытку.",
});

export function aiUploadErrorCopy(code: string, duplicateTitle: string | null = null): string {
  if (code === "duplicate") return duplicateTitle ? `Этот файл уже загружен: «${duplicateTitle}».` : "Этот файл уже загружен.";
  return AI_UPLOAD_ERROR_COPY[code] ?? AI_UPLOAD_ERROR_COPY.unavailable!;
}

/** Повтор тем же запросом имеет смысл: результат неизвестен или временный отказ. */
export function aiUploadRetryable(code: string): boolean {
  return code === "unavailable" || code === "storage_unavailable" || code === "malware_scanner_unavailable";
}

/** «1,2 МБ», «850 КБ». */
export function formatAiFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("ru-RU")} КБ`;
}

// ------------------------------------------------------------------ boxes

/** Прямоугольник в долях страницы (0–1): x0, y0 — левый верх, x1, y1 — правый низ. */
export type AiBox = Readonly<{ x0: number; y0: number; x1: number; y1: number }>;

const fraction = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= -0.001 && value <= 1.001 ? Math.min(1, Math.max(0, value)) : null;

/** `[x0, y0, x1, y1]`, `{x0, y0, x1, y1}` или `{x, y, w, h}` в долях страницы; иное — null. */
export function normalizeAiBox(value: unknown): AiBox | null {
  let corners: Array<number | null>;
  if (Array.isArray(value) && value.length === 4) corners = value.map(fraction);
  else if (isObject(value) && "x0" in value) corners = [value.x0, value.y0, value.x1, value.y1].map(fraction);
  else if (isObject(value) && "w" in value) {
    const x = fraction(value.x), y = fraction(value.y), w = fraction(value.w), h = fraction(value.h);
    corners = x === null || y === null || w === null || h === null ? [null] : [x, y, Math.min(1, x + w), Math.min(1, y + h)];
  } else return null;
  if (corners.length !== 4 || corners.some((corner) => corner === null)) return null;
  const [x0, y0, x1, y1] = corners as number[];
  return x1! > x0! && y1! > y0! ? Object.freeze({ x0: x0!, y0: y0!, x1: x1!, y1: y1! }) : null;
}

const boxes = (value: unknown, limit: number): readonly AiBox[] =>
  Object.freeze((Array.isArray(value) ? value : []).slice(0, limit).map(normalizeAiBox).filter((box): box is AiBox => box !== null));

// ------------------------------------------------------------------ document

export type AiDocumentPageSummary = Readonly<{
  pageNo: number;
  sheetName: string | null;
  method: "text" | "ocr";
  hasImage: boolean;
  openReviewCount: number;
}>;

export type AiDocumentDetail = Readonly<{
  document: AiDocument;
  pages: readonly AiDocumentPageSummary[];
  canManage: boolean;
}>;

export type AiPageChunk = Readonly<{
  id: number;
  position: number;
  sectionPath: string;
  content: string;
  boxes: readonly AiBox[];
  unverified: boolean;
}>;

export type AiPageReviewMark = Readonly<{
  id: string;
  status: AiReviewStatus;
  value: string | null;
  box: AiBox | null;
}>;

export type AiDocumentPage = Readonly<{
  pageNo: number;
  sheetName: string | null;
  method: "text" | "ocr";
  /** Есть отрисовка страницы (скан или PNG) — браузер берёт её через CRM. */
  hasImage: boolean;
  width: number | null;
  height: number | null;
  textMd: string;
  lines: readonly Readonly<{ text: string; box: AiBox }>[];
  chunks: readonly AiPageChunk[];
  reviewItems: readonly AiPageReviewMark[];
}>;

/**
 * Карточка документа (`ai_agent_document_v1`, 271): строка списка тем же
 * нормализатором, что `ai_agent_documents_v1`, и страницы.
 */
export function normalizeAiDocumentDetail(value: unknown): AiDocumentDetail {
  if (!isObject(value) || !isObject(value.document) || typeof value.canManage !== "boolean") return invalid();
  const pages = (Array.isArray(value.pages) ? value.pages : invalid()).slice(0, 300).map((raw) => {
    if (!isObject(raw)) return invalid();
    const pageNo = smallInt(raw.pageNo, 300);
    if (pageNo === null || pageNo < 1) return invalid();
    return Object.freeze({
      pageNo,
      sheetName: nullableText(raw.sheetName, 200),
      method: raw.method === "ocr" ? "ocr" as const : "text" as const,
      hasImage: raw.hasImage === true || typeof raw.imagePath === "string",
      openReviewCount: smallInt(raw.openReviewCount, 100_000) ?? 0,
    });
  });
  return Object.freeze({ document: normalizeAiDocument(value.document), pages: Object.freeze(pages), canManage: value.canManage });
}

const overlaps = (left: AiBox, right: AiBox) =>
  left.x0 < right.x1 && right.x0 < left.x1 && left.y0 < right.y1 && right.y0 < left.y1;

/**
 * Страница документа (`ai_agent_document_page_v1`, 271): `{pageNo, page: {…},
 * chunks, reviewItems}`; путь картинки (`page.imagePath`) остаётся на сервере.
 * «Число не проверено» у фрагмента — по базе (`unverified`) или, если поля
 * нет, по открытому пункту сверки внутри его рамки.
 */
export function normalizeAiDocumentPage(value: unknown): AiDocumentPage {
  if (!isObject(value)) return invalid();
  const pageNo = smallInt(value.pageNo, 300);
  const body = isObject(value.page) ? value.page : value;
  if (pageNo === null || pageNo < 1 || (body.textMd !== undefined && body.textMd !== null && typeof body.textMd !== "string")) return invalid();
  const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 4000).flatMap((raw) => {
    if (!isObject(raw) || typeof raw.text !== "string") return [];
    const box = normalizeAiBox(raw.box ?? raw.bbox);
    return box ? [Object.freeze({ text: raw.text.slice(0, 2000), box })] : [];
  });
  const reviewItems = (Array.isArray(value.reviewItems) ? value.reviewItems : []).slice(0, 500).flatMap((raw) => {
    if (!isObject(raw)) return [];
    const id = uuidOrNull(raw.id);
    const status = parseReviewStatus(raw.status);
    if (!id || !status) return [];
    return [Object.freeze({
      id, status,
      value: nullableText(raw.value ?? raw.proposed, 200),
      box: normalizeAiBox(raw.bbox ?? raw.box),
    })];
  });
  const openBoxes = reviewItems.filter((item) => (item.status === "open" || item.status === "applying") && item.box).map((item) => item.box!);
  const chunks = (Array.isArray(value.chunks) ? value.chunks : []).slice(0, 500).map((raw) => {
    if (!isObject(raw)) return invalid();
    const id = smallInt(raw.chunkId ?? raw.id, Number.MAX_SAFE_INTEGER);
    if (id === null) return invalid();
    const chunkBoxes = boxes(raw.boxes, 64);
    return Object.freeze({
      id,
      position: smallInt(raw.position, 99_999) ?? 0,
      sectionPath: text(raw.sectionPath, 1000),
      content: text(raw.content, 16_000),
      boxes: chunkBoxes,
      unverified: raw.unverified === true
        || (raw.unverified === undefined && chunkBoxes.some((box) => openBoxes.some((open) => overlaps(box, open)))),
    });
  });
  return Object.freeze({
    pageNo,
    sheetName: nullableText(body.sheetName, 200),
    method: body.method === "ocr" ? "ocr" : "text",
    hasImage: typeof body.imagePath === "string" && body.imagePath.length > 0,
    width: smallInt(body.width, 100_000),
    height: smallInt(body.height, 100_000),
    textMd: text(body.textMd, 200_000),
    lines: Object.freeze(lines),
    chunks: Object.freeze(chunks),
    reviewItems: Object.freeze(reviewItems),
  });
}

/** Адреса картинок для браузера — только через CRM (§4.5), никогда не Storage. */
export function aiPageImageHref(documentId: string, pageNo: number): string {
  return `/api/v3/ai-agent/documents/${documentId}/pages/${pageNo}/image`;
}
export function aiCropHref(documentId: string, itemId: string): string {
  return `/api/v3/ai-agent/documents/${documentId}/crops/${itemId}`;
}

// ------------------------------------------------------------------ review

export type AiReviewStatus = "open" | "applying" | "resolved" | "dismissed";
export type AiReviewResolution = "confirmed" | "corrected" | "dismissed";

const parseReviewStatus = (value: unknown): AiReviewStatus | null =>
  value === "open" || value === "applying" || value === "resolved" || value === "dismissed" ? value : null;

export type AiReviewItem = Readonly<{
  id: string;
  documentId: string;
  documentTitle: string;
  documentVersion: number | null;
  pageNo: number;
  sheetName: string | null;
  kind: "number" | "text";
  status: AiReviewStatus;
  /** Первое чтение (Tesseract), второе (Gemini vision), проверка фрагмента (арбитр). */
  readings: Readonly<{ tesseract: string | null; vision: string | null; arbiter: string | null; arbiterModel: string | null }>;
  proposed: string | null;
  value: string | null;
  contextLabel: string | null;
  resolution: AiReviewResolution | null;
  errorCode: string | null;
  hasCrop: boolean;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
}>;

export type AiReviewList = Readonly<{
  items: readonly AiReviewItem[];
  hasMore: boolean;
  openCount: number;
  canManage: boolean;
}>;

const reading = (value: unknown): string | null => {
  if (typeof value === "string") return value.slice(0, 200);
  if (isObject(value) && typeof value.text === "string") return value.text.slice(0, 200);
  return null;
};

/** `ai_agent_review_v1` (272): пункты «Листа сверки» живых документов. */
export function normalizeAiReviewList(value: unknown): AiReviewList {
  if (!isObject(value) || !Array.isArray(value.items) || typeof value.canManage !== "boolean") return invalid();
  const items = value.items.slice(0, 200).map((raw) => {
    if (!isObject(raw)) return invalid();
    const id = uuidOrNull(raw.id), documentId = uuidOrNull(raw.documentId);
    const status = parseReviewStatus(raw.status), pageNo = smallInt(raw.pageNo, 300);
    if (!id || !documentId || !status || pageNo === null || pageNo < 1 || typeof raw.createdAt !== "string") return invalid();
    const candidates = isObject(raw.candidates) ? raw.candidates : {};
    const resolution = raw.resolution === "confirmed" || raw.resolution === "corrected" || raw.resolution === "dismissed" ? raw.resolution : null;
    return Object.freeze({
      id, documentId,
      documentTitle: text(raw.documentTitle, 240),
      documentVersion: smallInt(raw.docVersion ?? raw.documentVersion, 1_000_000),
      pageNo,
      sheetName: nullableText(raw.sheetName, 200),
      kind: raw.kind === "text" ? "text" as const : "number" as const,
      status,
      readings: Object.freeze({
        tesseract: reading(candidates.tesseract),
        vision: reading(candidates.vision),
        arbiter: reading(candidates.arbiter),
        arbiterModel: nullableText(candidates.arbiterModel, 80),
      }),
      proposed: nullableText(raw.proposed, 200),
      value: nullableText(raw.value, 200),
      contextLabel: nullableText(raw.contextLabel, 300),
      resolution,
      errorCode: typeof raw.errorCode === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(raw.errorCode) ? raw.errorCode : null,
      hasCrop: raw.hasCrop === true || typeof raw.cropPath === "string",
      createdAt: raw.createdAt,
      resolvedAt: iso(raw.resolvedAt),
      resolvedByName: nullableText(raw.resolvedByName, 200),
    });
  });
  return Object.freeze({
    items: Object.freeze(items),
    hasMore: value.hasMore === true,
    openCount: smallInt(isObject(value.counts) ? value.counts.open : value.openCount, 1_000_000)
      ?? items.filter((item) => item.status === "open").length,
    canManage: value.canManage,
  });
}

/** Поправка «Исправить»: одна строка до 200 знаков (272). */
export const AI_REVIEW_VALUE_LIMIT = 200;
export function isAiReviewCorrection(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 1 && Array.from(trimmed).length <= AI_REVIEW_VALUE_LIMIT && !/[\u0000-\u001f\u007f]/u.test(trimmed);
}

export type AiReviewAction = "confirm" | "correct" | "dismiss" | "reopen";

export const AI_REVIEW_RESOLUTION_LABEL: Readonly<Record<AiReviewResolution, string>> = Object.freeze({
  confirmed: "Подтверждено", corrected: "Исправлено", dismissed: "Оставлено как есть",
});

export const AI_REVIEW_ERROR_COPY: Readonly<Record<string, string>> = Object.freeze({
  anchor_ambiguous: "Исправление не применилось: число встречается в тексте не один раз. Подтвердите или исправьте снова.",
  anchor_missing: "Исправление не применилось: число уже изменилось в тексте. Проверьте и исправьте снова.",
});

export function aiReviewErrorCopy(code: string | null): string | null {
  if (!code) return null;
  return AI_REVIEW_ERROR_COPY[code] ?? "Исправление не применилось. Исправьте снова.";
}

// ------------------------------------------------------------------ laboratory

export type AiLabProposalKind = "document" | "knowledge" | "rules" | "example";
export type AiLabProposalStatus = "proposed" | "applied" | "rejected" | "expired" | "conflict";

export type AiLabProposal = Readonly<{
  id: string;
  kind: AiLabProposalKind;
  status: AiLabProposalStatus;
  target: Readonly<{ documentId: string | null; title: string | null; docVersion: number | null; rulesVersion: number | null }>;
  /** Название нового документа («Новый фрагмент знаний»). */
  newTitle: string | null;
  before: string;
  after: string;
  /** Эталонный ответ — станет примером после «Применить». */
  answer: string;
  question: string;
  finding: string;
  why: string;
  audience: AiAudience | null;
  sources: readonly AiSource[];
  createdAt: string;
  expiresAt: string | null;
}>;

export type AiLabSession = Readonly<{
  revision: number;
  question: string;
  answer: AiAnswerResult | null;
  finding: string;
  updatedAt: string | null;
  expiresAt: string | null;
}>;

export type AiLabState = Readonly<{
  session: AiLabSession | null;
  proposal: AiLabProposal | null;
  canManage: boolean;
}>;

const PROPOSAL_KINDS = new Set(["document", "knowledge", "rules", "example"]);
const PROPOSAL_STATUSES = new Set(["proposed", "applied", "rejected", "expired", "conflict"]);

export function normalizeAiLabProposal(value: unknown): AiLabProposal {
  if (!isObject(value)) return invalid();
  const id = uuidOrNull(value.id);
  if (!id || !PROPOSAL_KINDS.has(String(value.kind)) || !PROPOSAL_STATUSES.has(String(value.status))
    || typeof value.after !== "string" || typeof value.createdAt !== "string") return invalid();
  // 273 отдаёт цель плоско (documentId, docVersion, documentTitle, rulesVersionId);
  // `title` — название нового документа знаний.
  const target = isObject(value.target) ? value.target : value;
  return Object.freeze({
    id,
    kind: value.kind as AiLabProposalKind,
    status: value.status as AiLabProposalStatus,
    target: Object.freeze({
      documentId: uuidOrNull(target.documentId),
      title: nullableText(target.documentTitle ?? target.title, 240),
      docVersion: smallInt(target.docVersion, 1_000_000),
      rulesVersion: smallInt(target.rulesVersion, 1_000_000),
    }),
    newTitle: nullableText(value.kind === "knowledge" ? value.title : null, 240),
    before: text(value.before, 6000),
    after: value.after.slice(0, 6000),
    answer: text(value.answer, 8000),
    question: text(value.question, 4000),
    finding: text(value.finding, 4000),
    why: text(value.why, 4000),
    audience: value.audience === "client" || value.audience === "internal" ? value.audience : null,
    sources: Object.freeze((Array.isArray(value.sources) ? value.sources : []).map(normalizeSource)
      .filter((item): item is AiSource => item !== null).slice(0, 20)),
    createdAt: value.createdAt,
    expiresAt: iso(value.expiresAt),
  });
}

/** `ai_agent_lab_v1` (273): своя проверка сотрудника и его предложение. */
export function normalizeAiLabState(value: unknown): AiLabState {
  if (!isObject(value) || typeof value.canManage !== "boolean") return invalid();
  let session: AiLabSession | null = null;
  if (value.session !== null && value.session !== undefined) {
    const raw = value.session;
    if (!isObject(raw)) return invalid();
    const payload = isObject(raw.payload) ? raw.payload : raw;
    session = Object.freeze({
      revision: smallInt(raw.revision, Number.MAX_SAFE_INTEGER) ?? 0,
      question: text(payload.question, 4000),
      answer: payload.answer === null || payload.answer === undefined ? null : normalizeResult(payload.answer),
      finding: text(payload.finding, 4000),
      updatedAt: iso(raw.updatedAt),
      expiresAt: iso(raw.expiresAt),
    });
  }
  const proposal = value.proposal === null || value.proposal === undefined ? null : normalizeAiLabProposal(value.proposal);
  return Object.freeze({ session, proposal, canManage: value.canManage });
}

export const AI_LAB_KIND_LABEL: Readonly<Record<AiLabProposalKind, string>> = Object.freeze({
  document: "Правка документа", knowledge: "Новый фрагмент знаний", rules: "Правка «Правил общения»", example: "Исправленный пример",
});

export type AiGoldenExample = Readonly<{
  id: string;
  question: string;
  answer: string;
  feedback: string;
  confirmedAt: string;
  confirmedByName: string | null;
  /** Пример действует: документы, правила и модель те же, что при подтверждении. */
  valid: boolean;
  staleReason: "document" | "rules" | "model" | null;
}>;

export function normalizeAiExamples(value: unknown): Readonly<{ items: readonly AiGoldenExample[]; hasMore: boolean; canManage: boolean }> {
  if (!isObject(value) || !Array.isArray(value.items) || typeof value.canManage !== "boolean") return invalid();
  const items = value.items.slice(0, 200).map((raw) => {
    if (!isObject(raw)) return invalid();
    const id = uuidOrNull(raw.id);
    if (!id || typeof raw.question !== "string" || typeof raw.answer !== "string" || typeof raw.confirmedAt !== "string") return invalid();
    // 273: `stale {legacy, rules, model, documents[]}`; причина — первая по важности.
    const stale = isObject(raw.stale) ? raw.stale : {};
    const reason = raw.staleReason === "document" || raw.staleReason === "rules" || raw.staleReason === "model" ? raw.staleReason
      : Array.isArray(stale.documents) && stale.documents.length > 0 ? "document"
        : stale.rules === true ? "rules" : stale.model === true ? "model" : null;
    return Object.freeze({
      id,
      question: raw.question.slice(0, 4000),
      answer: raw.answer.slice(0, 8000),
      feedback: text(raw.feedback, 4000),
      confirmedAt: raw.confirmedAt,
      confirmedByName: nullableText(raw.confirmedByName, 200),
      valid: raw.valid === true || (raw.valid === undefined && reason === null),
      staleReason: reason,
    });
  });
  return Object.freeze({ items: Object.freeze(items), hasMore: value.hasMore === true, canManage: value.canManage });
}

export const AI_EXAMPLE_STALE_LABEL: Readonly<Record<"document" | "rules" | "model", string>> = Object.freeze({
  document: "документ изменён", rules: "правила изменены", model: "сменилась модель",
});

/** Поля Лаборатории: вопрос «как клиент» и «Что не так?». */
export const AI_LAB_TEXT_LIMIT = 2000;
export function isAiLabText(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 1 && Array.from(trimmed).length <= AI_LAB_TEXT_LIMIT && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(trimmed);
}

/**
 * Кадры Лаборатории: вопрос — те же `status`/`sources`/`delta`/`final`/`error`,
 * что у окна чата (§6.3); «Что не так?» — ещё `status` «reviewing», и конец
 * `final {proposal}` или `no_change {why}` (менять нечего).
 */
export type AiLabStreamEvent =
  | AiStreamEvent
  | Readonly<{ type: "reviewing" }>
  | Readonly<{ type: "no_change"; why: string }>
  | Readonly<{ type: "proposal"; proposalId: string | null }>;

export function parseAiLabStreamEvent(event: string, data: string): AiLabStreamEvent | null {
  let payload: unknown;
  try { payload = JSON.parse(data); } catch { return null; }
  if (!isObject(payload)) return null;
  if (event === "status" && (payload.stage === "reviewing" || payload.stage === "proposing")) return { type: "reviewing" };
  if (event === "no_change") return { type: "no_change", why: text(payload.why ?? payload.message_ru, 2000) };
  if (event === "final" && "proposal" in payload) {
    const proposal = isObject(payload.proposal) ? payload.proposal : null;
    return { type: "proposal", proposalId: uuidOrNull(proposal?.id ?? proposal?.proposal_id) };
  }
  return parseAiStreamEvent(event, data);
}

/** Ответы Лаборатории своими словами (§8). */
export const AI_LAB_ERROR_COPY: Readonly<Record<string, string>> = Object.freeze({
  lab_changed: "Знания или предложение изменились. Спросите заново.",
  lab_edit_invalid: "Правку нельзя применить: текст «Было» больше не встречается в документе ровно один раз. Спросите заново.",
  lab_expired: "Проверка устарела — прошло больше двух часов. Спросите заново.",
  lab_session_missing: "Сначала задайте вопрос.",
});
