/**
 * «Настройки → Интеграции → Подключение WhatsApp» (решение владельца 20.10.2026):
 * общий договор браузера и сервера. Без `server-only` — файл читают и клиентский
 * блок, и маршрут. Ни адреса WAHA, ни ключа, ни номера здесь нет.
 *
 * Слова на экране живут в `wording.ts` (`whatsappConnectWords`,
 * `whatsappConnectionState`); здесь — только формы запроса и ответа, пределы и
 * разбор номера.
 */

/** Якорь блока на странице «Настройки → Интеграции»: на него ведёт строка WhatsApp таблицы. */
export const WHATSAPP_CONNECT_ANCHOR = "whatsapp-connect";

/** Единственный маршрут блока: POST, только администратор, `Cache-Control: no-store`. */
export const WHATSAPP_CONNECT_PATH = "/api/v3/settings/whatsapp-connect";

/**
 * `status` — спросить состояние (и QR, если окно подключения открыто);
 * `connect` — «Подключить»: запустить сессию и открыть окно QR;
 * `code` — «Получить код» по номеру телефона.
 */
export const WHATSAPP_CONNECT_ACTIONS = ["status", "connect", "code"] as const;
export type WhatsAppConnectAction = (typeof WHATSAPP_CONNECT_ACTIONS)[number];

/** Точный набор ключей тела запроса. */
export const WHATSAPP_CONNECT_BODY_KEYS = ["action", "phone", "withQr"] as const;
export const WHATSAPP_CONNECT_BODY_LIMIT_BYTES = 256;

/** Как часто блок спрашивает состояние и как часто обновляет QR. */
export const WHATSAPP_CONNECT_POLL_MS = 3_000;
export const WHATSAPP_CONNECT_QR_REFRESH_MS = 10_000;
/** Окно подключения: после «Подключить» QR выдаётся столько, потом нужно нажать снова. */
export const WHATSAPP_CONNECT_WINDOW_MS = 10 * 60_000;
/** Код по номеру живёт на экране недолго: WhatsApp сам гасит старые коды. */
export const WHATSAPP_CONNECT_CODE_SHOWN_MS = 3 * 60_000;

/** Ограничения сервера: не чаще одного перезапуска за 30 с и разумный опрос. */
export const WHATSAPP_RESTART_MIN_INTERVAL_MS = 30_000;
export const WHATSAPP_CONNECT_MIN_INTERVAL_MS = 10_000;
export const WHATSAPP_CODE_MIN_INTERVAL_MS = 20_000;
export const WHATSAPP_STATUS_MIN_INTERVAL_MS = 1_500;

/** Состояние сессии WAHA словом провайдера; пустое значение — не удалось узнать. */
const STATUS_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
export function isWahaStatusWord(value: unknown): value is string {
  return typeof value === "string" && STATUS_PATTERN.test(value);
}

/**
 * Коды отказа. Каждый имеет человеческое слово в `whatsappConnectWords.errors`;
 * неизвестный код слова не получает (`null`) — на экране он не рисуется.
 */
export const WHATSAPP_CONNECT_ERROR_CODES = [
  "authentication_required",
  "forbidden",
  "preview",
  "invalid_request",
  "invalid_phone",
  "rate_limited",
  "busy",
  "already_connected",
  "session_missing",
  "session_not_ready",
  "phone_rejected",
  "provider_unreachable",
  "provider_unavailable",
  "unavailable",
] as const;
export type WhatsAppConnectErrorCode = (typeof WHATSAPP_CONNECT_ERROR_CODES)[number];

export function isWhatsAppConnectErrorCode(value: unknown): value is WhatsAppConnectErrorCode {
  return typeof value === "string" && (WHATSAPP_CONNECT_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Номер для кода привязки: международный формат без `+`, 8–15 цифр, первая не
 * ноль (E.164). Пробелы, дефисы, скобки и ведущий `+` отбрасываются, всё
 * остальное — отказ. Номер нигде не хранится: он живёт в поле формы до отправки
 * и в одном запросе к серверу.
 */
export function normalizePairingPhone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 32) return null;
  const trimmed = value.trim();
  if (!/^\+?[\d\s().-]+$/u.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/gu, "");
  return /^[1-9]\d{7,14}$/u.test(digits) ? digits : null;
}

/** Код привязки WhatsApp: восемь букв и цифр, показывается как `ABCD-EFGH`. */
export function normalizePairingCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.trim().replace(/[\s-]/gu, "").toUpperCase();
  return /^[A-Z0-9]{8}$/u.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4)}` : null;
}

/** QR приходит картинкой в `data:` — иначе браузеру пришлось бы ходить по адресу, который можно закешировать. */
const QR_DATA_URL_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u;
export const WHATSAPP_QR_MAX_DATA_URL_CHARS = 256 * 1024;
export function isQrDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.length <= WHATSAPP_QR_MAX_DATA_URL_CHARS && QR_DATA_URL_PATTERN.test(value);
}

export type WhatsAppConnectReply = Readonly<{
  /** Состояние сессии словом WAHA; `null` — не определено. */
  status: string | null;
  /** QR-картинка; только когда окно подключения открыто и сессия ждёт сканирования. */
  qr: string | null;
  /** Код по номеру; только в ответе на `code`. */
  code: string | null;
}>;

/** Разбор ответа сервера в браузере: всё лишнее и неверное по форме отбрасывается. */
export function parseWhatsAppConnectReply(body: unknown): WhatsAppConnectReply | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const status = record.status === null || record.status === undefined ? null : isWahaStatusWord(record.status) ? record.status : null;
  const qr = isQrDataUrl(record.qr) ? record.qr : null;
  const code = normalizePairingCode(record.code);
  return { status, qr, code };
}

export function parseWhatsAppConnectError(body: unknown): Readonly<{ code: WhatsAppConnectErrorCode | null; retryAfterSeconds: number | null }> {
  const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : null;
  if (typeof error !== "object" || error === null) return { code: null, retryAfterSeconds: null };
  const { code, retryAfterSeconds } = error as { code?: unknown; retryAfterSeconds?: unknown };
  return {
    code: isWhatsAppConnectErrorCode(code) ? code : null,
    retryAfterSeconds: typeof retryAfterSeconds === "number" && Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds > 0 && retryAfterSeconds <= 3_600
      ? retryAfterSeconds : null,
  };
}
