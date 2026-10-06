import "server-only";

import { createHash } from "node:crypto";

import type { AiUploadFormat } from "../v3/ai-agent-knowledge.ts";
import { matchesOoxmlPackage, parseStandardZip } from "./platform-company-file-storage-route-handlers.ts";

/**
 * Файлы «ИИ-агента» (план §4.5, P2): bucket `platform-ai-agent-knowledge`
 * (271, закрыт для anon и authenticated), объекты только под
 * `{organization}/{document}/`:
 *
 *   original          — загруженный файл (CRM, без перезаписи);
 *   pages/{n}.png     — отрисовка страницы (агент через брокер);
 *   crops/{item}.png  — вырезка пункта «Листа сверки» (агент через брокер).
 *
 * Серверный ключ Supabase есть только у CRM; агент ходит во внутренний
 * брокер CRM, браузер — в маршруты сотрудника. Ни подписанных ссылок, ни
 * списка объектов наружу.
 */
export const AI_KNOWLEDGE_BUCKET = "platform-ai-agent-knowledge";
/** Картинка страницы или вырезка от агента: до 8 МБ и до 4000 px по стороне. */
export const AI_BROKER_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const AI_BROKER_IMAGE_MAX_SIDE = 4000;

export const aiDocumentPrefix = (organizationId: string, documentId: string) => `${organizationId}/${documentId}/`;
export const aiOriginalPath = (organizationId: string, documentId: string) => `${organizationId}/${documentId}/original`;
export const aiPagePath = (organizationId: string, documentId: string, pageNo: number) =>
  `${organizationId}/${documentId}/pages/${pageNo}.png`;
export const aiCropPath = (organizationId: string, documentId: string, itemId: string) =>
  `${organizationId}/${documentId}/crops/${itemId}.png`;

/**
 * Id документа из id запроса загрузки: повтор того же запроса (неизвестный
 * результат, «Повторить») кладёт файл туда же и попадает в ту же квитанцию
 * базы, а не во второй документ. Форма — UUID v4.
 */
export function aiDocumentIdForRequest(organizationId: string, requestId: string): string {
  const bytes = createHash("sha256").update(`evo-ai-agent-document:${organizationId}:${requestId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type AiContentCheck = Readonly<{ ok: true }> | Readonly<{ ok: false; code: "content_mismatch" | "macro" | "text_encoding" }>;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const startsWith = (bytes: Uint8Array, prefix: readonly number[]) =>
  bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);

/** Части OOXML, которые несут макросы или активное содержимое. */
const ACTIVE_PART = /(?:^|\/)(?:vbaProject\.bin|vbaData\.xml|vbaProjectSignature\.bin)$|(?:^|\/)activeX\//iu;

/**
 * Текст: UTF-8, а если нет — Windows-1251 (§7). У cp1251 любой байт что-то
 * значит, поэтому отличить его от двоичного файла можно только по
 * управляющим байтам: NUL и C0 (кроме табуляции, перевода строки, возврата
 * каретки и разрыва страницы) и неназначенный 0x98 — это не текст.
 */
function plausibleText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    for (const byte of bytes) {
      if ((byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) || byte === 0x7f || byte === 0x98) return false;
    }
    return true;
  }
}

/** Содержимое совпадает с форматом, выбранным по расширению (`checkAiUploadFile`). */
export function checkAiUploadContent(format: AiUploadFormat, bytes: Uint8Array): AiContentCheck {
  switch (format.kind) {
    case "pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) ? { ok: true } : { ok: false, code: "content_mismatch" };
    case "image":
      if (format.mimeType === "image/png") return startsWith(bytes, PNG_SIGNATURE) ? { ok: true } : { ok: false, code: "content_mismatch" };
      return startsWith(bytes, [0xff, 0xd8, 0xff]) ? { ok: true } : { ok: false, code: "content_mismatch" };
    case "docx":
    case "xlsx": {
      if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return { ok: false, code: "content_mismatch" };
      const entries = parseStandardZip(bytes);
      if (!entries) return { ok: false, code: "content_mismatch" };
      for (const name of entries.keys()) if (ACTIVE_PART.test(name)) return { ok: false, code: "macro" };
      // Тот же разбор пакета, что у файлов компании: [Content_Types].xml,
      // _rels/.rels и главная часть с правильным типом (не macroEnabled).
      return matchesOoxmlPackage(format.mimeType as Parameters<typeof matchesOoxmlPackage>[0], bytes)
        ? { ok: true } : { ok: false, code: "content_mismatch" };
    }
    default:
      return plausibleText(bytes) ? { ok: true } : { ok: false, code: "text_encoding" };
  }
}

/** Ширина и высота PNG из IHDR; не PNG — null. */
export function pngSize(bytes: Uint8Array): Readonly<{ width: number; height: number }> | null {
  if (bytes.length < 33 || !startsWith(bytes, PNG_SIGNATURE)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) !== "IHDR") return null;
  const width = view.getUint32(16), height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Тело запроса — по мере прихода, не больше `limit` байт: ни ложная длина,
 * ни поток без неё не заставят держать в памяти больше предела.
 */
export async function readCappedBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | "too_large" | "unreadable"> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d{1,12}$/u.test(declared) || Number(declared) > limit)) return "too_large";
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        return "too_large";
      }
      parts.push(value);
    }
  } catch {
    return "unreadable";
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return body;
}
