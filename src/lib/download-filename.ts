/**
 * Имя скачиваемого файла: «<Тип документа> — <Фамилия>.<расширение>».
 *
 * Чистый модуль без обращения к серверу и браузеру: им пользуются маршруты скачивания (передают имя в Storage как
 * `createSignedUrl(path, ttl, { download: '<имя>' })`) и разбор заголовка Content-Disposition в браузере. Ключ объекта в
 * хранилище (62 шестнадцатеричных символа) в имя не попадает никогда.
 */

const MAX_STEM_LENGTH = 120;
const MAX_FILENAME_LENGTH = 200;
const SEPARATOR = " — ";

const MIME_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/gif": "gif",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
});

export type DownloadFilenameInput = Readonly<{
  /** Тип документа («Паспорт», «Договор», «Чек»). */
  label?: string | null;
  /** Фамилия студента. */
  surname?: string | null;
  mimeType?: string | null;
  /** Исходное имя файла: расширение, когда MIME неизвестен, и имя целиком, когда нет ни типа, ни фамилии. */
  fallbackName?: string | null;
}>;

// Управляющие символы (в том числе разрывы строк и нулевой символ), символы Unicode-форматирования (направление письма,
// невидимые) и всё, что опасно в имени файла: / \ : * ? " < > |
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}/\\:*?"<>|]/gu;

function cleanPart(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .replace(FORBIDDEN, " ")
    .replace(/\s+/gu, " ")
    .replace(/^[\s.]+|[\s.]+$/gu, "");
}

function clipStem(value: string): string {
  const chars = Array.from(value);
  if (chars.length <= MAX_STEM_LENGTH) return value;
  return chars.slice(0, MAX_STEM_LENGTH).join("").replace(/[\s.]+$/gu, "");
}

function extensionOf(name: string | null | undefined): string {
  if (typeof name !== "string") return "";
  const match = /\.([A-Za-z0-9]{1,8})\s*$/u.exec(name.replace(/[\p{Cc}\p{Cf}]/gu, ""));
  return match ? match[1].toLowerCase() : "";
}

function stemOf(name: string | null | undefined): string {
  const cleaned = cleanPart(name);
  const extension = extensionOf(cleaned);
  const withoutExtension = extension ? cleaned.slice(0, cleaned.length - extension.length - 1) : cleaned;
  return cleanPart(withoutExtension);
}

function mimeExtension(mimeType: string | null | undefined): string {
  if (typeof mimeType !== "string") return "";
  const key = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_EXTENSIONS[key] ?? "";
}

/**
 * Собирает имя файла. Порядок запасных вариантов: «Тип — Фамилия», затем тип один, затем исходное имя без расширения,
 * затем общее слово «Документ». Расширение берётся из MIME (pdf, jpg, png и др.), иначе из исходного имени.
 */
export function buildDownloadFilename(input: DownloadFilenameInput): string {
  const label = cleanPart(input.label);
  const surname = cleanPart(input.surname);
  const extension = mimeExtension(input.mimeType) || extensionOf(input.fallbackName);
  let stem: string;
  if (label && surname) stem = `${label}${SEPARATOR}${surname}`;
  else if (label) stem = label;
  else stem = stemOf(input.fallbackName) || (surname ? `Документ${SEPARATOR}${surname}` : "Документ");
  stem = clipStem(stem) || "Документ";
  const name = extension ? `${stem}.${extension}` : stem;
  return Array.from(name).length > MAX_FILENAME_LENGTH ? `${clipStem(stem)}${extension ? `.${extension}` : ""}` : name;
}

/** Имя без типа и фамилии: файл компании и вложения чата называются по сохранённому имени. */
export function buildStoredDownloadFilename(input: Readonly<{ name?: string | null; mimeType?: string | null }>): string {
  return buildDownloadFilename({ mimeType: input.mimeType, fallbackName: input.name });
}

/**
 * Имя из заголовка Content-Disposition: сначала `filename*=UTF-8''…` (RFC 5987), затем обычное `filename="…"`.
 * Storage отдаёт в `filename` запасной ASCII-вариант, где кириллица заменена на «_», поэтому порядок важен.
 */
export function parseContentDispositionFilename(header: string | null | undefined): string | null {
  if (typeof header !== "string" || header.length === 0 || header.length > 2048) return null;
  const extended = /filename\*\s*=\s*([^;]*)/iu.exec(header)?.[1]?.trim();
  if (extended) {
    const match = /^([A-Za-z0-9!#$%&+^_`{}~-]+)'[A-Za-z0-9-]*'(.*)$/u.exec(extended);
    if (match && /^utf-?8$/iu.test(match[1])) {
      try {
        const decoded = decodeURIComponent(match[2]);
        if (acceptableName(decoded)) return decoded;
      } catch {
        // Повреждённая последовательность: пробуем простое имя.
      }
    }
  }
  const plain = /(?:^|[;\s])filename\s*=\s*"([^"\r\n]*)"/iu.exec(header)?.[1];
  return plain !== undefined && acceptableName(plain) ? plain : null;
}

function acceptableName(value: string): boolean {
  return value.length > 0 && Array.from(value).length <= 255 && !/[\p{Cc}/\\]/u.test(value);
}
