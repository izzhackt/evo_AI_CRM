import { buildDownloadFilename, buildStoredDownloadFilename } from "../download-filename.ts";

type NameRpcClient = Readonly<{
  schema: (name: "platform") => {
    rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  };
}>;

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
    if (response.error) return true;
    const data = response.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) return true;
    const record = data as Record<string, unknown>;
    const text = (key: string): string | null => (typeof record[key] === "string" ? (record[key] as string) : null);
    if (!text("label") && !text("student_surname") && !text("original_filename")) return true;
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
