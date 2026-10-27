import "server-only";

/**
 * Клиент API Wazzup (docs/EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md §5.5). Базовый адрес `https://api.wazzup24.com`,
 * заголовок `Authorization: Bearer <ключ>` (wazzup24.ru/help/api-ru/avtorizaciya/, прочитано 27.10.2026).
 *
 * Только три вызова, и ровно те, что разрешены Sidecar-ключу интеграции (страница «Способы подключения»:
 * `GET /channels`, `POST /message`, `GET /webhooks`, `PATCH /webhooks`, `GET /v3/templates/whatsapp`):
 *  - `listChannels` - `GET /v3/channels` (состояние канала, таймер и команды оператора);
 *  - `getWebhooks` - `GET /v3/webhooks` (занят ли адрес, какие подписки);
 *  - `patchWebhooks` - `PATCH /v3/webhooks` (только по команде оператора).
 * Вызова `POST /v3/message` в этапе 1 нет и быть не должно: отправка из EVO закрыта в базе (§6 B.9), а этот модуль не
 * умеет писать клиентам вовсе. Тест проверяет, что других путей нет.
 *
 * Ключ даёт право писать от имени номера продаж, поэтому он секрет того же класса, что ключ WAHA: он живёт только в
 * замыкании клиента, в заголовке запроса, и ни в одной ошибке, строке журнала или поле результата не появляется.
 * Ошибки несут фиксированный вид, HTTP-статус и (для 400) безопасный код Wazzup, но никогда не текст ответа, адрес
 * с токеном или сообщение сети.
 */

export const WAZZUP_API_BASE_URL = "https://api.wazzup24.com";
export const WAZZUP_CHANNELS_PATH = "/v3/channels";
export const WAZZUP_WEBHOOKS_PATH = "/v3/webhooks";
/** Пути, которые модуль вообще умеет вызывать (тест сверяет это с реально отправленными запросами). */
export const WAZZUP_CLIENT_PATHS: readonly string[] = Object.freeze([WAZZUP_CHANNELS_PATH, WAZZUP_WEBHOOKS_PATH]);
export const WAZZUP_DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const CHANNEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const STATE_WORD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const TRANSPORT_WORD = /^[a-z][a-z0-9_]{0,31}$/u;
const ERROR_CODE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const API_KEY = /^[\x21-\x7e]{16,4096}$/u;

export type WazzupApiErrorKind =
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "bad_request"
  | "server"
  | "http_error"
  | "timeout"
  | "network"
  | "invalid_response";

export class WazzupApiError extends Error {
  readonly kind: WazzupApiErrorKind;
  readonly status: number | null;
  /** Код ошибки из тела 400 (`testPostNotPassed`, `uriNotValid`...), только если он безопасной формы. */
  readonly code: string | null;
  /** Для `testPostNotPassed`: какой HTTP-статус Wazzup получил на проверочный POST. */
  readonly testStatus: number | null;

  constructor(
    kind: WazzupApiErrorKind,
    options: Readonly<{ status?: number | null; code?: string | null; testStatus?: number | null }> = {},
  ) {
    super(`wazzup_api_${kind}`);
    this.name = "WazzupApiError";
    this.kind = kind;
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.testStatus = options.testStatus ?? null;
  }
}

export type WazzupChannel = Readonly<{
  channelId: string;
  /** `whatsapp` (обычный), `wapi` (WABA), `instagram`, `tgapi`, ... */
  transport: string;
  /** Номер или имя в мессенджере. Это персональные данные: не писать в журнал и вывод целиком. */
  plainId: string | null;
  state: string;
}>;

export type WazzupSubscriptions = Readonly<{
  messagesAndStatuses: boolean;
  contactsAndDealsCreation: boolean;
  channelsUpdates: boolean;
  templateStatus: boolean;
}>;

export type WazzupWebhooksState = Readonly<{
  /** Установленный адрес вместе с токеном: вызывающий не выводит его целиком (см. `describeWebhookAddress`). */
  webhooksUri: string | null;
  subscriptions: WazzupSubscriptions;
}>;

export type WazzupClient = Readonly<{
  listChannels(): Promise<readonly WazzupChannel[]>;
  getWebhooks(): Promise<WazzupWebhooksState>;
  patchWebhooks(input: Readonly<{ webhooksUri: string; subscriptions: WazzupSubscriptions }>): Promise<void>;
}>;

export type WazzupClientOptions = Readonly<{
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Только для тестов: боевой код всегда ходит на `WAZZUP_API_BASE_URL`. */
  baseUrl?: string;
}>;

/** Ключ годной формы (как проверяет база): печатные знаки без пробелов, 16-4096. */
export function isWazzupApiKeyShape(value: string): boolean {
  return API_KEY.test(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBoundedText(response: Response): Promise<string | null> {
  const declared = response.headers.get("content-length");
  if (declared !== null && /^[0-9]+$/u.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) return null;
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new WazzupApiError("invalid_response");
  }
}

function badRequest(status: number, text: string | null): WazzupApiError {
  let code: string | null = null;
  let testStatus: number | null = null;
  if (text !== null && text !== "") {
    try {
      const body: unknown = JSON.parse(text);
      if (isObject(body) && typeof body.error === "string" && ERROR_CODE.test(body.error)) code = body.error;
      if (isObject(body)) {
        const data = body.data;
        const candidate = typeof data === "number" ? data : isObject(data) ? (data.status ?? data.statusCode) : null;
        if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 100 && candidate <= 599) {
          testStatus = candidate;
        }
      }
    } catch {
      // Тело не JSON: остаётся только статус.
    }
  }
  return new WazzupApiError("bad_request", { status, code, testStatus });
}

function booleanFlag(value: unknown): boolean {
  // Пример страницы «Webhooks» возвращает флаги строками ("true"), документация объявляет Boolean: принимаем оба вида.
  return value === true || value === "true";
}

/** `GET /v3/channels`: массив каналов; негодные записи отбрасываются, не массив - `invalid_response`. */
function normalizeChannels(value: unknown): readonly WazzupChannel[] {
  if (!Array.isArray(value)) throw new WazzupApiError("invalid_response");
  const channels: WazzupChannel[] = [];
  for (const item of value as unknown[]) {
    if (!isObject(item) || typeof item.channelId !== "string" || typeof item.transport !== "string") continue;
    const channelId = item.channelId.toLowerCase();
    if (!CHANNEL_ID.test(channelId) || !TRANSPORT_WORD.test(item.transport)) continue;
    const plain = item.plainId;
    channels.push(
      Object.freeze({
        channelId,
        transport: item.transport,
        plainId: typeof plain === "string" && plain !== "" ? plain : typeof plain === "number" ? String(plain) : null,
        state: typeof item.state === "string" && STATE_WORD.test(item.state) ? item.state : "unknown",
      }),
    );
  }
  return Object.freeze(channels);
}

function normalizeWebhooks(value: unknown): WazzupWebhooksState {
  if (!isObject(value)) throw new WazzupApiError("invalid_response");
  const uri = value.webhooksUri;
  const subscriptions = isObject(value.subscriptions) ? value.subscriptions : {};
  return Object.freeze({
    webhooksUri: typeof uri === "string" && uri !== "" ? uri : null,
    subscriptions: Object.freeze({
      messagesAndStatuses: booleanFlag(subscriptions.messagesAndStatuses),
      contactsAndDealsCreation: booleanFlag(subscriptions.contactsAndDealsCreation),
      channelsUpdates: booleanFlag(subscriptions.channelsUpdates),
      templateStatus: booleanFlag(subscriptions.templateStatus),
    }),
  });
}

export function createWazzupClient(options: WazzupClientOptions): WazzupClient {
  const { apiKey } = options;
  // Сообщение не содержит значения: ошибка конфигурации не должна выдать ключ.
  if (typeof apiKey !== "string" || !API_KEY.test(apiKey)) throw new RangeError("wazzup api key has an invalid shape");
  const baseUrl = options.baseUrl ?? WAZZUP_API_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? WAZZUP_DEFAULT_TIMEOUT_MS;

  async function call(method: "GET" | "PATCH", path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${apiKey}`,
            accept: "application/json",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
          // Заголовок с ключом не должен уйти на другой адрес по перенаправлению.
          redirect: "error",
        });
      } catch {
        throw new WazzupApiError(timedOut ? "timeout" : "network");
      }
      let text: string | null;
      try {
        text = await readBoundedText(response);
      } catch {
        throw new WazzupApiError(timedOut ? "timeout" : "network", { status: response.status });
      }
      const status = response.status;
      if (status === 400) throw badRequest(status, text);
      if (status === 401) throw new WazzupApiError("unauthorized", { status });
      if (status === 403) throw new WazzupApiError("forbidden", { status });
      if (status === 429) throw new WazzupApiError("rate_limited", { status });
      if (status >= 500) throw new WazzupApiError("server", { status });
      if (status < 200 || status >= 300) throw new WazzupApiError("http_error", { status });
      if (text === null) throw new WazzupApiError("invalid_response", { status });
      return text === "" ? null : parseJson(text);
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    async listChannels() {
      return normalizeChannels(await call("GET", WAZZUP_CHANNELS_PATH));
    },
    async getWebhooks() {
      return normalizeWebhooks(await call("GET", WAZZUP_WEBHOOKS_PATH));
    },
    async patchWebhooks(input) {
      if (input.webhooksUri.length < 1 || input.webhooksUri.length > 200) throw new RangeError("wazzup webhooks address length");
      await call("PATCH", WAZZUP_WEBHOOKS_PATH, {
        webhooksUri: input.webhooksUri,
        subscriptions: {
          messagesAndStatuses: input.subscriptions.messagesAndStatuses,
          contactsAndDealsCreation: input.subscriptions.contactsAndDealsCreation,
          channelsUpdates: input.subscriptions.channelsUpdates,
          templateStatus: input.subscriptions.templateStatus,
        },
      });
    },
  });
}

/**
 * Ключ Wazzup из Vault (`platform.wazzup_api_key_resolve_v1`, миграция 325) или null с причиной словом: привязки нет,
 * секрет пропал, негоден или не совпал с отпечатком. Только service_role.
 */
export type WazzupKeyResolution =
  | Readonly<{ ready: true; apiKey: string; fingerprint: string }>
  | Readonly<{ ready: false; reason: string }>;

type RpcClientLike = {
  schema(name: string): { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
};

/**
 * Разбор ответа `platform.wazzup_api_key_resolve_v1` (чистая функция): готовый ключ с отпечатком либо слово причины.
 * Таймер читает ключ через свой `rpc` с общим сроком и разбирает ответ здесь же, `wazzup-ops` - через `resolveWazzupApiKey`.
 */
export function parseWazzupKeyResolution(data: unknown): WazzupKeyResolution {
  if (!isObject(data)) return { ready: false, reason: "database_unavailable" };
  if (data.ready !== true) {
    const reason = typeof data.reasonCode === "string" && /^[a-z][a-z_]{0,40}$/u.test(data.reasonCode) ? data.reasonCode : "unavailable";
    return { ready: false, reason };
  }
  if (typeof data.apiKey !== "string" || !API_KEY.test(data.apiKey) || typeof data.apiKeySha256 !== "string"
    || !/^[0-9a-f]{64}$/u.test(data.apiKeySha256)) {
    return { ready: false, reason: "secret_invalid" };
  }
  return { ready: true, apiKey: data.apiKey, fingerprint: data.apiKeySha256.slice(0, 8) };
}

export async function resolveWazzupApiKey(client: RpcClientLike, organizationId: string): Promise<WazzupKeyResolution> {
  let outcome: { data: unknown; error: unknown };
  try {
    outcome = await client.schema("platform").rpc("wazzup_api_key_resolve_v1", { p_organization_id: organizationId });
  } catch {
    return { ready: false, reason: "database_unavailable" };
  }
  if (outcome.error) return { ready: false, reason: "database_unavailable" };
  return parseWazzupKeyResolution(outcome.data);
}
