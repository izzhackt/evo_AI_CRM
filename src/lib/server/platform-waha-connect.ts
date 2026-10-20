import "server-only";

import {
  isWahaStatusWord,
  normalizePairingCode,
  normalizePairingPhone,
  WHATSAPP_QR_MAX_DATA_URL_CHARS,
} from "../v3/whatsapp-connect-contract.ts";
import type { PlatformManualSendWahaRuntime } from "../platform-provider-workflows.ts";
import { requirePlatformWahaRuntime } from "./platform-waha-provider.ts";

/**
 * Привязка сессии WhatsApp из CRM (решение владельца 20.10.2026): тонкий
 * клиент WAHA для блока «Настройки → Интеграции → Подключение WhatsApp».
 *
 * Все вызовы идут отсюда, с сервера, по тому же адресу и ключу, что ручная
 * отправка и живая проверка (`resolveManualSendWahaRuntime`, Vault). Адрес и
 * ключ в браузер не попадают; ответ — слово состояния, картинка QR или код.
 * Номер, QR и код нигде не пишутся и не кешируются: они живут в одном вызове.
 *
 * Версия WAHA на сервере — `devlikeapro/waha:gows-2026.9.2` (GOWS, Core).
 * Адреса проверены по её OpenAPI (`/-json`) и живым прогоном той же сборки
 * на отдельной локальной сессии:
 *
 *  - `GET  /api/sessions/{name}`            → `{name, status, …}`; статусы STOPPED,
 *    STARTING, SCAN_QR_CODE, PASSKEY_REQUIRED, PASSKEY_CONFIRMATION_REQUIRED,
 *    WORKING, FAILED;
 *  - `POST /api/sessions/{name}/start`      — запустить остановленную (STOPPED);
 *  - `POST /api/sessions/{name}/restart`    — перезапустить сломанную (FAILED);
 *  - `GET  /api/{name}/auth/qr?format=image` — PNG, пока сессия ждёт сканирования;
 *  - `POST /api/{name}/auth/request-code`   — `{phoneNumber}` → код по номеру
 *    (движок GOWS: gRPC `RequestCode`, реализован).
 *
 * Выхода из аккаунта (`logout`), удаления и создания сессии здесь нет и быть
 * не должно: это отдельное решение владельца.
 */

export const WAHA_CONNECT_STATUS_TIMEOUT_MS = 5_000;
export const WAHA_CONNECT_MUTATION_TIMEOUT_MS = 20_000;
export const WAHA_CONNECT_QR_TIMEOUT_MS = 8_000;
export const WAHA_CONNECT_CODE_TIMEOUT_MS = 30_000;

const MAX_JSON_BYTES = 64 * 1_024;
const MAX_QR_BYTES = 128 * 1_024;
const MAX_ERROR_BODY_BYTES = 16 * 1_024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export type WahaConnectErrorCode =
  | "configuration_invalid"
  | "session_missing"
  | "session_not_ready"
  | "invalid_phone"
  | "phone_rejected"
  | "already_connected"
  | "provider_unreachable"
  | "provider_timeout"
  | "provider_rejected"
  | "provider_unavailable"
  | "provider_malformed_response";

export class WahaConnectError extends Error {
  readonly code: WahaConnectErrorCode;
  readonly statusCode: number | null;

  constructor(code: WahaConnectErrorCode, statusCode: number | null = null) {
    super("WAHA connect operation failed.");
    this.name = "WahaConnectError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type WahaConnectDependencies = Readonly<{
  fetch?: typeof fetch;
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal;
}>;

export type WahaConnectClient = Readonly<{
  /** Состояние сессии словом WAHA (`WORKING`, `FAILED`, …). */
  getStatus(): Promise<string>;
  /** Запустить остановленную сессию; ответ — состояние после запуска. */
  start(): Promise<string>;
  /** Перезапустить сессию; ответ — состояние после перезапуска. */
  restart(): Promise<string>;
  /** PNG с QR как `data:image/png;base64,…`; `null` — QR сейчас нет. */
  fetchQr(): Promise<string | null>;
  /** Код привязки по номеру; номер проверяется здесь же. */
  requestPairingCode(phone: string): Promise<string>;
}>;

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

async function readBounded(response: Response, limit: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit)) {
    throw new Error("response too large");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new Error("response too large");
  return bytes;
}

async function readJson(response: Response): Promise<unknown> {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBounded(response, MAX_JSON_BYTES)));
}

/** Тело отказа WAHA читается только для классификации и сразу забывается. */
async function readErrorText(response: Response): Promise<string> {
  try {
    return new TextDecoder("utf-8").decode(await readBounded(response, MAX_ERROR_BODY_BYTES));
  } catch {
    return "";
  }
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.byteLength > PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

export function createWahaConnectClient(
  runtimeInput: PlatformManualSendWahaRuntime,
  dependencies: WahaConnectDependencies = {},
): WahaConnectClient {
  const runtime = requirePlatformWahaRuntime(runtimeInput);
  const fetchImpl = dependencies.fetch ?? fetch;
  const createTimeoutSignal = dependencies.createTimeoutSignal ?? ((timeoutMs: number) => AbortSignal.timeout(timeoutMs));
  const session = encodeURIComponent(runtime.wahaSessionName);
  const base = runtime.wahaBaseUrl;

  async function call(
    path: string,
    init: Readonly<{ method: "GET" | "POST"; accept: string; body?: string }>,
    timeoutMs: number,
  ): Promise<Response> {
    try {
      return await fetchImpl(`${base}${path}`, {
        method: init.method,
        headers: Object.freeze({
          Accept: init.accept,
          "X-Api-Key": runtime.wahaApiKey,
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        }),
        ...(init.body === undefined ? {} : { body: init.body }),
        cache: "no-store",
        redirect: "error",
        signal: createTimeoutSignal(timeoutMs),
      });
    } catch (error) {
      throw new WahaConnectError(isTimeoutError(error) ? "provider_timeout" : "provider_unreachable");
    }
  }

  function refusal(response: Response): WahaConnectError {
    if (response.status === 404) return new WahaConnectError("session_missing", 404);
    if (response.status === 401 || response.status === 403) return new WahaConnectError("configuration_invalid", response.status);
    if (response.status === 429 || response.status === 408) return new WahaConnectError("provider_unavailable", response.status);
    if (response.status >= 400 && response.status < 500) return new WahaConnectError("provider_rejected", response.status);
    return new WahaConnectError("provider_unavailable", response.status);
  }

  /** Состояние из ответа сессии: имя обязано быть нашим, слово — формата статуса. */
  async function sessionStatus(response: Response): Promise<string> {
    let body: unknown;
    try {
      body = await readJson(response);
    } catch {
      throw new WahaConnectError("provider_malformed_response");
    }
    if (
      typeof body !== "object" || body === null || Array.isArray(body) ||
      (body as { name?: unknown }).name !== runtime.wahaSessionName ||
      !isWahaStatusWord((body as { status?: unknown }).status)
    ) {
      throw new WahaConnectError("provider_malformed_response");
    }
    return (body as { status: string }).status;
  }

  async function sessionCommand(command: "start" | "restart"): Promise<string> {
    const response = await call(`/api/sessions/${session}/${command}`, { method: "POST", accept: "application/json" }, WAHA_CONNECT_MUTATION_TIMEOUT_MS);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw refusal(response);
    }
    return sessionStatus(response);
  }

  return Object.freeze({
    async getStatus(): Promise<string> {
      const response = await call(`/api/sessions/${session}`, { method: "GET", accept: "application/json" }, WAHA_CONNECT_STATUS_TIMEOUT_MS);
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw refusal(response);
      }
      return sessionStatus(response);
    },

    start: () => sessionCommand("start"),
    restart: () => sessionCommand("restart"),

    async fetchQr(): Promise<string | null> {
      const response = await call(`/api/${session}/auth/qr?format=image`, { method: "GET", accept: "image/png" }, WAHA_CONNECT_QR_TIMEOUT_MS);
      // Сессия не ждёт сканирования (уже подключена или ещё запускается): картинки нет.
      if (response.status === 404 || response.status === 422 || response.status === 409) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw refusal(response);
      }
      let bytes: Uint8Array;
      try {
        bytes = await readBounded(response, MAX_QR_BYTES);
      } catch {
        throw new WahaConnectError("provider_malformed_response");
      }
      if (!/^image\/png\b/iu.test(response.headers.get("content-type") ?? "") || !isPng(bytes)) {
        throw new WahaConnectError("provider_malformed_response");
      }
      const dataUrl = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
      if (dataUrl.length > WHATSAPP_QR_MAX_DATA_URL_CHARS) throw new WahaConnectError("provider_malformed_response");
      return dataUrl;
    },

    async requestPairingCode(phone: string): Promise<string> {
      const normalized = normalizePairingPhone(phone);
      if (normalized === null) throw new WahaConnectError("invalid_phone");
      const response = await call(
        `/api/${session}/auth/request-code`,
        { method: "POST", accept: "application/json", body: JSON.stringify({ phoneNumber: normalized }) },
        WAHA_CONNECT_CODE_TIMEOUT_MS,
      );
      if (!response.ok) {
        // WhatsApp отказал по номеру (не зарегистрирован, неверный формат): WAHA отвечает 500
        // с текстом «bad-request» от сервера WhatsApp. Текст нужен только для этого различения.
        const text = await readErrorText(response);
        if (/bad-request|not-?registered|invalid.*(phone|number)/iu.test(text)) {
          throw new WahaConnectError("phone_rejected", response.status);
        }
        if (response.status === 422 || response.status === 409) throw new WahaConnectError("session_not_ready", response.status);
        throw refusal(response);
      }
      let body: unknown;
      try {
        body = await readJson(response);
      } catch {
        throw new WahaConnectError("provider_malformed_response");
      }
      const code = normalizePairingCode(typeof body === "object" && body !== null ? (body as { code?: unknown }).code : null);
      if (code === null) throw new WahaConnectError("provider_malformed_response");
      return code;
    },
  });
}
