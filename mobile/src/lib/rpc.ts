// Клиентский слой RPC схемы `platform`.
//
// Инварианты iPhone 1.1 (docs/mobile/reference/ios-app-inventory.md §0, §8):
//  1. Каждая запись несёт клиентский `p_request_id` (UUID) и идемпотентна по нему.
//  2. Повтор после обрыва отправляет ТОТ ЖЕ замороженный запрос: тот же id, те же
//     аргументы. Новый id при повторе не создаётся никогда.
//  3. Тексты ошибок сервера не попадают ни в журнал, ни на экран: из ошибки
//     остаётся только `kind` и код, а экран берёт строку из словаря i18n.
import { randomUUID } from "expo-crypto";

export type RpcErrorKind =
  | "transport" // ответа нет: обрыв, таймаут, нет сети; повтор той же записи безопасен
  | "forbidden" // 42501
  | "invalid" // 22023
  | "conflict" // 40001 / 23505 / PT409
  | "rate_limited"
  | "server" // 5xx
  | "unknown";

/** Ошибка без текста сервера. */
export class RpcError extends Error {
  readonly kind: RpcErrorKind;
  readonly code: string | null;
  readonly status: number | null;
  constructor(kind: RpcErrorKind, code: string | null = null, status: number | null = null) {
    super(`rpc:${kind}`); // фиксированный текст, без ответа сервера
    this.name = "RpcError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

/** Форма ответа PostgREST/supabase-js, нужная слою. */
export type RpcTransportResult = Readonly<{
  data: unknown;
  error: Readonly<{ code?: string | null }> | null;
  status?: number | null;
}>;

export type RpcTransport = (
  name: string,
  args: Readonly<Record<string, unknown>> | undefined,
  options: Readonly<{ get: boolean }>,
) => PromiseLike<RpcTransportResult>;

export function classifyRpcFailure(code: string | null | undefined, status: number | null | undefined): RpcError {
  const c = code && code.length > 0 ? code : null;
  const s = typeof status === "number" ? status : null;
  if (c === "42501") return new RpcError("forbidden", c, s);
  if (c === "22023") return new RpcError("invalid", c, s);
  if (c === "40001" || c === "23505" || c === "PT409") return new RpcError("conflict", c, s);
  if (s === 429) return new RpcError("rate_limited", c, s);
  if (s !== null && s >= 500) return new RpcError("server", c, s);
  // Нет кода и нет HTTP-статуса: запрос не дошёл или ответ потерян.
  if (c === null && (s === null || s === 0)) return new RpcError("transport", null, s);
  return new RpcError("unknown", c, s);
}

function toError(result: RpcTransportResult): RpcError {
  return classifyRpcFailure(result.error?.code ?? null, result.status ?? null);
}

async function invoke(
  transport: RpcTransport,
  name: string,
  args: Readonly<Record<string, unknown>> | undefined,
  get: boolean,
): Promise<unknown> {
  let result: RpcTransportResult;
  try {
    result = await transport(name, args, { get });
  } catch {
    throw new RpcError("transport");
  }
  if (result.error) throw toError(result);
  return result.data;
}

/** GET-режим: `null` превратился бы в текст "null", поэтому ключи с null опускаются. */
export function omitNulls(args: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, v]) => v !== null && v !== undefined));
}

/** Чтение (STABLE-функции можно вызывать через GET). */
export async function rpcRead<T = unknown>(
  transport: RpcTransport,
  name: string,
  args?: Readonly<Record<string, unknown>>,
  options: Readonly<{ get?: boolean }> = {},
): Promise<T> {
  const get = options.get ?? false;
  const prepared = args ? (get ? omitNulls(args) : { ...args }) : undefined;
  return (await invoke(transport, name, prepared, get)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

/**
 * Замороженная запись: id и аргументы фиксируются при создании и уже не меняются.
 * `send()` можно вызывать сколько угодно раз, каждый раз уходит один и тот же запрос.
 */
export class FrozenWrite {
  readonly name: string;
  readonly requestId: string;
  readonly args: Readonly<Record<string, unknown>>;

  constructor(name: string, args: Readonly<Record<string, unknown>>, requestId: string) {
    if (Object.hasOwn(args, "p_request_id")) {
      throw new Error("p_request_id задаётся слоем RPC, а не вызывающим кодом");
    }
    this.name = name;
    this.requestId = requestId;
    this.args = deepFreeze({ ...structuredCloneSafe(args), p_request_id: requestId });
    Object.freeze(this);
  }

  send<T = unknown>(transport: RpcTransport): Promise<T> {
    return invoke(transport, this.name, this.args, false) as Promise<T>;
  }
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Создать запись. `requestId` можно передать явно (например, детерминированный
 * UUIDv5 для «прочитано»); иначе создаётся новый UUID. Он создаётся один раз.
 */
export function createWrite(
  name: string,
  args: Readonly<Record<string, unknown>>,
  options: Readonly<{ requestId?: string; newId?: () => string }> = {},
): FrozenWrite {
  const id = options.requestId ?? (options.newId ?? randomUUID)();
  return new FrozenWrite(name, args, id);
}

/**
 * Отправить запись; при обрыве повторить ровно тот же замороженный запрос
 * (до `retries` раз). Конфликт, отказ и прочее не повторяются.
 */
export async function rpcWrite<T = unknown>(
  transport: RpcTransport,
  write: FrozenWrite,
  options: Readonly<{ retries?: number; wait?: (attempt: number) => Promise<void> }> = {},
): Promise<T> {
  const retries = options.retries ?? 2;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await write.send<T>(transport);
    } catch (error) {
      if (!(error instanceof RpcError) || error.kind !== "transport" || attempt >= retries) throw error;
      await options.wait?.(attempt);
    }
  }
}

/** Ключ строки словаря для ошибки (см. src/i18n/mobile-strings.ts). */
export function rpcErrorKey(error: unknown): "error.offline" | "error.server" | "error.forbidden" | "error.conflict" | "error.rateLimited" | "error.generic" {
  if (!(error instanceof RpcError)) return "error.generic";
  switch (error.kind) {
    case "transport":
      return "error.offline";
    case "server":
      return "error.server";
    case "forbidden":
      return "error.forbidden";
    case "conflict":
      return "error.conflict";
    case "rate_limited":
      return "error.rateLimited";
    default:
      return "error.generic";
  }
}
