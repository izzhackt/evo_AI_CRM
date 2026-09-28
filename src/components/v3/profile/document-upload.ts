/**
 * Загрузка файла в пункт чек-листа (Э8.1): проверки до отправки и слова для
 * каждого ответа сервера. Проверки повторяют сервер и базу, чтобы отказ был
 * назван до отправки: тип и размер (`platform-document-storage-route-handlers`,
 * бакет `platform-documents`), имя — до 255 символов (`char_length` в 046/116).
 * Сам сервер остаётся решающим: любой его отказ получает своё слово ниже.
 */

export const DOCUMENT_UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const DOCUMENT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_UPLOAD_MAX_NAME = 255;
/** Подпись рядом с «Загрузить файл»: что примет сервер. */
export const DOCUMENT_UPLOAD_HINT = "PDF, JPEG, PNG · до 25 МБ";

export type DocumentUploadOutcome = "sending" | "saved" | "invalid" | "forbidden" | "conflict" | "unavailable";

/**
 * Итог попытки. `next` — что предложить рядом: «Повторить» тот же файл с тем
 * же ключом запроса (сервер повторит, а не задвоит) или «Обновить страницу»
 * (новый ключ и свежее состояние пункта).
 */
export type DocumentUploadResult = Readonly<{
  outcome: Exclude<DocumentUploadOutcome, "sending">;
  message: string;
  next: "retry" | "refresh" | null;
}>;

/**
 * Состояние загрузки пункта на странице. Живёт у списка, а не у строки:
 * строка пересоздаётся с новой версией файла, а слово итога остаётся.
 * `file` — только для «Повторить» (тот же файл, тот же ключ запроса).
 */
export type DocumentUploadState = Readonly<{
  outcome: DocumentUploadOutcome | "idle";
  message: string | null;
  next: DocumentUploadResult["next"];
  file: File | null;
}>;

export const DOCUMENT_UPLOAD_IDLE: DocumentUploadState = Object.freeze({ outcome: "idle", message: null, next: null, file: null });

const result = (outcome: DocumentUploadResult["outcome"], message: string, next: DocumentUploadResult["next"] = null): DocumentUploadResult =>
  Object.freeze({ outcome, message, next });

export const DOCUMENT_UPLOAD_SAVED = result("saved", "Файл загружен и отправлен на проверку.");

const TOO_LARGE = "Файл больше 25 МБ. Уменьшите его и загрузите снова.";

/** Файл, который сервер точно не примет, — до отправки. null — можно отправлять. */
export function documentUploadFileProblem(file: Readonly<{ name: string; size: number; type: string }>): DocumentUploadResult | null {
  if (!DOCUMENT_UPLOAD_TYPES.some((type) => type === file.type)) {
    return /\.(?:heic|heif)$/iu.test(file.name)
      ? result("invalid", "Фото в формате HEIC не принимается. Сохраните его как JPEG и загрузите снова.")
      : result("invalid", "Можно загрузить только PDF, JPEG или PNG.");
  }
  if (file.size <= 0) return result("invalid", "Файл пустой. Выберите другой файл.");
  if (file.size > DOCUMENT_UPLOAD_MAX_BYTES) return result("invalid", TOO_LARGE);
  // Символы, а не UTF-16: база считает `char_length`.
  if (Array.from(file.name).length > DOCUMENT_UPLOAD_MAX_NAME) {
    return result("invalid", "Имя файла длиннее 255 знаков. Переименуйте файл и загрузите снова.");
  }
  if (file.name !== file.name.trim() || /[\u0000-\u001f\u007f/\\]/u.test(file.name)) {
    return result("invalid", "Имя файла не подходит: уберите пробелы по краям и знаки / и \\.");
  }
  return null;
}

/**
 * Слово для ответа сервера. `status` null — ответа нет (сеть). Коды — из
 * `platform-document-storage-route-handlers.ts`; незнакомый код называется
 * по классу статуса, сырой код на экран не попадает.
 */
export function documentUploadFailure(status: number | null, code: string | null): DocumentUploadResult {
  if (status === 401) return result("forbidden", "Сессия закончилась. Войдите снова и повторите загрузку.");
  // 403 `upload_not_authorized` — отказ базы по этому пункту (принят, убран или
  // нет права); 403 `forbidden` и отказ до отправки (код null) — право роли.
  if (status === 403 && code === "upload_not_authorized") {
    return result("forbidden", "Загрузка в этот пункт недоступна: он уже принят, убран или у роли нет права. Обновите страницу.", "refresh");
  }
  if (status === 403) return result("forbidden", "У вашей роли нет права загружать этот документ.");
  if (status === 413) return result("invalid", TOO_LARGE);
  if (status === 400 && code === "file_signature_mismatch") {
    return result("invalid", "Содержимое файла не похоже на PDF, JPEG или PNG. Сохраните файл заново в одном из этих форматов.");
  }
  if (status === 409 && code === "upload_in_progress") {
    return result("conflict", "Этот документ уже загружается. Подождите минуту и обновите страницу.", "refresh");
  }
  if (status === 409 && code === "request_conflict") {
    return result("conflict", "Эта загрузка уже начата с другим файлом. Обновите страницу и выберите файл снова.", "refresh");
  }
  if (status === 409 && (code === "scan_admission_expired" || code === "scan_claim_expired")) {
    return result("unavailable", "Проверка файла не успела завершиться. Файл не сохранён — повторите загрузку.", "retry");
  }
  if (status === 409) return result("conflict", "Документ уже изменился. Обновите страницу.", "refresh");
  if (status === 422) return result("invalid", "Проверка на вирусы не пропустила файл. Он не сохранён.");
  if (status === 429) return result("unavailable", "Слишком много загрузок подряд. Подождите минуту и повторите.", "retry");
  if (status !== null && status >= 400 && status < 500) {
    return result("invalid", "Сервер не принял файл: нужен PDF, JPEG или PNG до 25 МБ с именем до 255 знаков.");
  }
  return result("unavailable", "Не удалось загрузить файл. Повторите попытку.", "retry");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Код ошибки из тела ответа (`{ error }`); чужое тело — null. */
export function documentUploadErrorCode(value: unknown): string | null {
  return isRecord(value) && typeof value.error === "string" ? value.error : null;
}

/** Успех — только 201 с квитанцией этого пункта и новой версией. */
export function documentUploadConfirmed(value: unknown, documentSlotId: string): boolean {
  if (!isRecord(value) || !isRecord(value.document)) return false;
  const document = value.document;
  return document.documentSlotId === documentSlotId
    && typeof document.documentVersionId === "string"
    && document.documentVersionId.length > 0
    && typeof document.versionNumber === "number"
    && Number.isInteger(document.versionNumber)
    && document.versionNumber > 0;
}
