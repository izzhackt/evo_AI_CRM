/**
 * Ссылка на отчёт Looker Studio (план `docs/EVO_LOOKER_REPORTS_PLAN_2026-10-27.md` §5).
 *
 * CRM хранит не адрес, а ИДЕНТИФИКАТОРЫ отчёта и страницы и всегда сама собирает адрес встраивания по шаблону, поэтому
 * в окно отчёта не может попасть чужой адрес ни из формы, ни из строки базы. Файл чистый (без сервера): его разбирает
 * действие сохранения и перепроверяет вывод страницы.
 *
 * Вход — то, что администратор вставил: код `<iframe …>` из окна «Файл → Встроить отчёт» или «ссылка для встраивания».
 * Принимается только `https://lookerstudio.google.com/embed/reporting/{отчёт}[/page/{страница}]`; прежнее имя сервиса
 * `datastudio.google.com` (в официальном примере Google) пересобирается в `lookerstudio.google.com`.
 */

/** Формат идентификаторов взят с запасом (у отчётов встречаются короткие, UUID и `p_…`); те же правила — в таблице 323. */
const REPORT_ID = /^[A-Za-z0-9_-]{8,100}$/u;
const PAGE_ID = /^[A-Za-z0-9_-]{1,100}$/u;
const LOOKER_HOSTS: ReadonlySet<string> = new Set(["lookerstudio.google.com", "datastudio.google.com"]);
const EMBED_HOST = "lookerstudio.google.com";
export const LOOKER_INPUT_MAX_LENGTH = 4000;

/**
 * Права `iframe` отчёта (план §7.4) — выбор CRM, а не код Google: БЕЗ `allow-top-navigation` (отчёт не уведёт вкладку
 * CRM) и БЕЗ `allow-popups-to-escape-sandbox` (окна, которые откроет содержимое отчёта, остаются в песочнице).
 * `allow-same-origin` здесь — origin Google, не CRM. Набор подтверждается на тестовом отчёте до слияния (§12.3).
 */
export const LOOKER_FRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-storage-access-by-user-activation";

export type LookerEmbedError = "empty" | "too_long" | "not_looker" | "share_link" | "invalid";
export type LookerEmbedParse =
  | Readonly<{ ok: true; reportId: string; pageId: string | null }>
  | Readonly<{ ok: false; error: LookerEmbedError }>;

export const isLookerReportId = (value: unknown): value is string => typeof value === "string" && REPORT_ID.test(value);
export const isLookerPageId = (value: unknown): value is string => typeof value === "string" && PAGE_ID.test(value);

const fail = (error: LookerEmbedError): LookerEmbedParse => ({ ok: false, error });

/** Значение `src` первого `<iframe>`; `null` — у тега нет `src` в кавычках. Остальные атрибуты не читаются. */
function iframeSrc(text: string): string | null {
  const tag = /<iframe\b([^>]*)>?/iu.exec(text);
  if (!tag) return null;
  const src = /(?:^|[\s"'])src\s*=\s*(?:"([^"]*)"|'([^']*)')/iu.exec(tag[1]);
  const value = src ? src[1] ?? src[2] ?? "" : null;
  // В коде встраивания адрес записан с `&amp;`; параметры всё равно отбрасываются, но раскодируем честно.
  return value === null ? null : value.replace(/&amp;/giu, "&").trim();
}

/**
 * Разбор вставленного текста. Порядок отказов: пусто / длинно; чужой адрес (`not_looker`: не https, не Looker Studio);
 * логин, пароль или порт в адресе и непонятный путь (`invalid`); обычная ссылка на отчёт (`share_link`: её встроить
 * нельзя, Google требует код из окна встраивания).
 */
export function parseLookerEmbedInput(input: unknown): LookerEmbedParse {
  if (typeof input !== "string") return fail("invalid");
  if (input.length > LOOKER_INPUT_MAX_LENGTH) return fail("too_long");
  const text = input.trim();
  if (text === "") return fail("empty");

  const candidate = /<iframe\b/iu.test(text) ? iframeSrc(text) : text;
  if (candidate === null || candidate === "") return fail("invalid");

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return fail("invalid");
  }
  if (url.protocol !== "https:" || !LOOKER_HOSTS.has(url.hostname)) return fail("not_looker");
  if (url.username !== "" || url.password !== "" || url.port !== "") return fail("invalid");

  // Параметры после `?` и `#` отбрасываются: ими нельзя подменить адрес. Выбор аккаунта `/u/{n}` — в начале пути или
  // сразу после `/embed` — распознаётся и отбрасывается.
  let path = url.pathname.replace(/^\/u\/\d{1,2}(?=\/)/u, "").replace(/^\/embed\/u\/\d{1,2}(?=\/)/u, "/embed");
  if (/^\/reporting\/[^/]/u.test(path)) return fail("share_link");
  path = path.replace(/\/+$/u, "");
  const match = /^\/embed\/reporting\/([^/]+)(?:\/page\/([^/]+))?$/u.exec(path);
  if (!match) return fail("invalid");
  const [, reportId, pageId] = match;
  if (!isLookerReportId(reportId) || (pageId !== undefined && !isLookerPageId(pageId))) return fail("invalid");
  return { ok: true, reportId, pageId: pageId ?? null };
}

function build(prefix: string, reportId: unknown, pageId: unknown): string | null {
  if (!isLookerReportId(reportId)) return null;
  if (pageId === null || pageId === undefined) return `https://${EMBED_HOST}/${prefix}/${reportId}`;
  return isLookerPageId(pageId) ? `https://${EMBED_HOST}/${prefix}/${reportId}/page/${pageId}` : null;
}

/** Адрес окна отчёта: всегда по шаблону, хост всегда `lookerstudio.google.com`, без `/u/{n}`. `null` — идентификатор не годится. */
export function lookerEmbedUrl(reportId: unknown, pageId: unknown): string | null {
  return build("embed/reporting", reportId, pageId);
}

/** Адрес «Открыть в новой вкладке»: обычный вид отчёта с входом в Google. `null` — идентификатор не годится. */
export function lookerOpenUrl(reportId: unknown, pageId: unknown): string | null {
  return build("reporting", reportId, pageId);
}

/** Слова ошибки разбора для администратора (план §7.1). */
export const LOOKER_EMBED_ERROR_TEXT: Readonly<Record<LookerEmbedError, string>> = {
  not_looker: "Нужна ссылка Looker Studio (lookerstudio.google.com).",
  share_link: "Это обычная ссылка на отчёт, её нельзя встроить. В Looker Studio откройте «Файл → Встроить отчёт», включите встраивание и скопируйте код.",
  empty: "Не удалось разобрать ссылку. Скопируйте код встраивания ещё раз.",
  too_long: "Не удалось разобрать ссылку. Скопируйте код встраивания ещё раз.",
  invalid: "Не удалось разобрать ссылку. Скопируйте код встраивания ещё раз.",
};
