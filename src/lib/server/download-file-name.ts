import { buildDownloadFilename, buildStoredDownloadFilename } from "../download-filename.ts";

type NameRpcClient = Readonly<{
  schema: (name: "platform") => {
    rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  };
}>;

function logFallback(kind: string, reason: string): void {
  // Одна структурная строка без персональных данных: сорванный выкат миграции или функции виден в журнале приложения.
  console.warn(JSON.stringify({ event: "download_name_fallback", kind, reason }));
}

/**
 * Параметр `download` для `createSignedUrl`: имя файла «<Тип> — <Фамилия>.<расширение>» или `true` (прежнее поведение).
 *
 * Данные для имени читает функция базы под сессией того же человека, что скачивает (миграция 366). Любая ошибка (нет
 * миграции, нет права, сбой сети, неожиданный ответ) возвращает `true`: скачивание не ломается, файл просто получает имя
 * Storage по умолчанию. Имя никогда не берётся из ключа объекта.
 */
export async function resolveDownloadName(
  client: unknown,
  rpcName: string,
  args: Record<string, unknown>,
  mode: "document" | "stored" = "document",
): Promise<string | true> {
  try {
    const response = await (client as NameRpcClient).schema("platform").rpc(rpcName, args);
    if (response.error) {
      const code = (response.error as { code?: unknown }).code;
      logFallback(rpcName, typeof code === "string" && /^[A-Za-z0-9_]{1,16}$/u.test(code) ? `rpc_error_${code}` : "rpc_error");
      return true;
    }
    const data = response.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      logFallback(rpcName, "unexpected_shape");
      return true;
    }
    const record = data as Record<string, unknown>;
    const text = (key: string): string | null => (typeof record[key] === "string" ? (record[key] as string) : null);
    if (!text("label") && !text("student_surname") && !text("original_filename")) {
      logFallback(rpcName, "no_usable_fields");
      return true;
    }
    const name = mode === "stored"
      ? buildStoredDownloadFilename({ name: text("original_filename"), mimeType: text("mime_type") })
      : buildDownloadFilename({
        label: text("label"),
        surname: text("student_surname"),
        mimeType: text("mime_type"),
        fallbackName: text("original_filename"),
      });
    return name.length > 0 ? name : true;
  } catch {
    logFallback(rpcName, "exception");
    return true;
  }
}

/**
 * Подставляет имя в готовую подписанную ссылку: параметр `download=<имя>`, по которому Storage сам отвечает
 * `Content-Disposition: attachment; filename="<ASCII>"; filename*=UTF-8''<процент-кодирование>`.
 *
 * Имя нельзя передавать в `createSignedUrl(..., { download: '<имя>' })`: storage-js собирает запрос через URLSearchParams
 * и затем прогоняет всю ссылку через `encodeURI`, поэтому кириллица кодируется дважды и файл получил бы имя
 * «%D0%9F%D0%B0…». Здесь параметр ставится один раз и кодируется один раз. `true` оставляет ссылку как есть.
 */
export function applyDownloadName(signedUrl: string, name: string | true): string {
  if (name === true) return signedUrl;
  try {
    const url = new URL(signedUrl);
    url.searchParams.set("download", name);
    return url.toString();
  } catch {
    return signedUrl;
  }
}
