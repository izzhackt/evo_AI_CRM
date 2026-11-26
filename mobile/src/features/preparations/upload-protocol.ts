// Протокол загрузки файла к требованию программы без React и без нативных модулей: замороженный запрос по выбранному
// файлу, заголовок `X-EVO-Upload-Intent`, разбор ответа сервера. Веб: `application-documents-upload.ts`
// (`freezeApplicationDocumentUploadIntent`, `encodeApplicationDocumentUploadHeader`, `uploadApplicationDocumentFile`).
// Тот модуль веба приложению не подходит (внутри `XMLHttpRequest`, `document`, `crypto.subtle`; страж общих импортов его
// не пропускает), поэтому протокол повторён здесь, а все разборщики, правила имён и квитанция берутся у веба.
// Тесты сверяют заголовок и ответ с настоящим модулем веба.
import {
  APPLICATION_DOCUMENT_MAX_FILE_BYTES,
  applicationDocumentCanonical,
  applicationDocumentExact,
  applicationDocumentRecord,
  parseApplicationDocumentItemTarget,
  parseApplicationDocumentUploadHeader,
  parseApplicationDocumentUploadIntent,
  parseApplicationDocumentUploadReceipt,
  type ApplicationDocumentFailure,
  type ApplicationDocumentItemTarget,
  type ApplicationDocumentUploadHeader,
  type ApplicationDocumentUploadIntent,
  type ApplicationDocumentUploadResult,
} from "@web/lib/portal/application-documents";

import { checkPickedFile, safeFileName, type PickedFile } from "@/domain/documents-model";

/** Заголовок с описанием файла и цели (base64url от JSON), как у веба. */
export const UPLOAD_INTENT_HEADER = "X-EVO-Upload-Intent";
export const UPLOAD_HEADER_MAX = 8192;
export const UPLOAD_METADATA_MAX = 6144;
/** Имя ФАЙЛА в части multipart (поле части называется `file`): сервер принимает только его (`file.name !== "upload"` - отказ). Файл перед отправкой копируется под этим именем. */
export const UPLOAD_TRANSPORT_FILENAME = "upload";
/** Адрес маршрута загрузки: тот же, что у веба; Bearer принимается (`platform-document-storage-route-handlers.ts`). */
export const UPLOAD_PATH = "/api/portal/application-document-uploads";

/** Размер и отпечаток содержимого: считает слой устройства по самим байтам, а не по ответу выбора файла. */
export type Fingerprint = Readonly<{ byteSize: number; sha256Hex: string }>;
export type Fingerprinter = (file: PickedFile) => Promise<Fingerprint>;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** Заголовок запроса: канонический JSON цели и файла в base64url. `null`, если запрос не годится или слишком велик. */
export function encodeUploadHeader(value: ApplicationDocumentUploadHeader): string | null {
  const header = parseApplicationDocumentUploadHeader(value);
  if (!header) return null;
  const bytes = new TextEncoder().encode(applicationDocumentCanonical(header));
  if (bytes.byteLength > UPLOAD_METADATA_MAX) return null;
  const encoded = base64url(bytes);
  return encoded.length <= UPLOAD_HEADER_MAX ? encoded : null;
}

/** Итог заморозки: запрос, «файл не годится» или «файл не прочитался» (студенту говорят о них разное). */
export type FrozenUpload =
  | Readonly<{ status: "frozen"; intent: ApplicationDocumentUploadIntent }>
  /** Тип, пустой файл, больше 25 МБ, имя или цель не проходят правила веба: выбрать другой файл. */
  | Readonly<{ status: "invalid" }>
  /** Байты не прочитались (файл исчез, не открывается или менялся во время чтения): тот же файл можно выбрать ещё раз. */
  | Readonly<{ status: "unreadable" }>;

/**
 * Замороженный запрос на загрузку выбранного файла: цель, тип, размер и SHA-256 содержимого, `requestId`.
 * `invalid`: файл не годится (тип, пустой, больше 25 МБ) или имя не проходит правила веба; `unreadable`: байты не прочитались.
 * Имя файла приводится к безопасному и получает расширение по типу (одно и то же имя для одного и того же файла: оно
 * сравнивается при повторном выборе).
 */
export async function freezeUploadIntent(input: Readonly<{
  target: ApplicationDocumentItemTarget;
  file: PickedFile;
  requestId: string;
  fingerprint: Fingerprinter;
}>): Promise<FrozenUpload> {
  const target = parseApplicationDocumentItemTarget(input.target);
  const check = checkPickedFile(input.file);
  if (!target || !check.ok) return { status: "invalid" };
  let print: Fingerprint;
  try {
    print = await input.fingerprint(input.file);
  } catch {
    return { status: "unreadable" };
  }
  if (!Number.isInteger(print.byteSize) || print.byteSize < 1 || print.byteSize > APPLICATION_DOCUMENT_MAX_FILE_BYTES) return { status: "invalid" };
  try {
    const intent = parseApplicationDocumentUploadIntent({
      protocolVersion: 1,
      ...target,
      requestId: input.requestId,
      file: { originalFilename: safeFileName(input.file.name, check.mimeType), declaredMimeType: check.mimeType, byteSize: String(print.byteSize), sha256Hex: print.sha256Hex },
    });
    return intent ? { status: "frozen", intent } : { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
}

/** Один и тот же запрос: id, цель и все четыре признака файла совпадают (веб: `sameUpload`). */
export function sameUploadIntent(a: ApplicationDocumentUploadIntent, b: ApplicationDocumentUploadIntent): boolean {
  return (
    a.requestId === b.requestId &&
    a.studentCaseId === b.studentCaseId &&
    a.applicationId === b.applicationId &&
    a.requirementsRevisionId === b.requirementsRevisionId &&
    a.requirementItemId === b.requirementItemId &&
    a.documentSlotId === b.documentSlotId &&
    a.file.originalFilename === b.file.originalFilename &&
    a.file.declaredMimeType === b.file.declaredMimeType &&
    a.file.byteSize === b.file.byteSize &&
    a.file.sha256Hex === b.file.sha256Hex
  );
}

const KNOWN_FAILURES: readonly ApplicationDocumentFailure[] = [
  "invalid", "forbidden", "request_conflict", "stale_context", "case_ineligible", "application_ineligible", "file_unavailable",
  "busy", "lease_expired", "file_too_large", "unsupported_type", "malware_detected", "rate_limited", "unavailable",
];
const BY_STATUS: Readonly<Record<number, ApplicationDocumentFailure>> = { 400: "invalid", 403: "forbidden", 409: "request_conflict", 413: "file_too_large", 415: "unsupported_type", 422: "malware_detected", 429: "rate_limited" };

function failed(reason: ApplicationDocumentFailure): ApplicationDocumentUploadResult {
  return { ok: false, reason, resolution: "retain" };
}

/**
 * Ответ сервера на загрузку -> итог. Правила веба (`uploadApplicationDocumentFile`):
 *  - `201 {upload: <квитанция>}` и квитанция точно совпала с запросом - успех; иначе результат неизвестен (`unavailable`);
 *  - ошибка `{error: {code, resolution}}` из закрытого списка: `not_written` («в базу ничего не попало») верится, кроме
 *    `forbidden` и `request_conflict`, где запрос остаётся;
 *  - остальное - по коду статуса; всё прочее - `unavailable`, запрос остаётся.
 * Текст ответа на экран не попадает.
 */
export function parseUploadResponse(status: number, body: unknown, intent: ApplicationDocumentUploadIntent): ApplicationDocumentUploadResult {
  const errorBody = applicationDocumentRecord(body);
  const detail = errorBody && applicationDocumentExact(errorBody, ["error"]) ? applicationDocumentRecord(errorBody.error) : null;
  if (
    status >= 400 && status <= 599 && detail && applicationDocumentExact(detail, ["code", "resolution"]) &&
    KNOWN_FAILURES.includes(detail.code as ApplicationDocumentFailure) && ["retain", "not_written"].includes(String(detail.resolution))
  ) {
    const reason = detail.code as ApplicationDocumentFailure;
    return { ok: false, reason, resolution: detail.resolution === "not_written" && !["forbidden", "request_conflict"].includes(reason) ? "not_written" : "retain" };
  }
  if (status === 201) {
    const record = applicationDocumentRecord(body);
    const receipt = record && applicationDocumentExact(record, ["upload"]) ? parseApplicationDocumentUploadReceipt(record.upload, intent) : null;
    return receipt ? { ok: true, receipt } : failed("unavailable");
  }
  return failed(BY_STATUS[status] ?? "unavailable");
}
