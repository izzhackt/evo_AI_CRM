import "server-only";

import type { PlatformTelephonyPbxConfig } from "./platform-telephony-pbx-config.ts";

/**
 * Server-only client for the Beeline KG PBX `crmapi/v1` (EVO → PBX direction),
 * docs/EVO_TELEPHONY_PLAN_2026-10-16.md §3.2 and §5.4, ADR 0033.
 *
 * What it is allowed to do is a closed list (`TELEPHONY_PBX_OPERATIONS`): six
 * read paths and one write, `POST /makecall` (slice T7, the «Позвонить» button).
 * Every other path is unreachable from here, and the PBX management methods
 * (employees, departments, numbers, blacklist, restrictions, SIP, branches,
 * webhook subscriptions) are not callable at all.
 *
 * Rules that hold for every request:
 *  - https only, to the host of the configured base URL; redirects are refused
 *    (`redirect: "manual"`); `cache: "no-store"`; the key travels only in the
 *    `X-API-KEY` header, never in a URL, body or log;
 *  - the whole request is bounded by `timeoutMs` (10 s) — the plan's 5 s
 *    connect timeout cannot be separated with `fetch`, so only the total is
 *    enforced; the body is read with a hard size bound;
 *  - reads are retried twice, with a pause, on a timeout, a network error, a
 *    429 or a 5xx; a definitive answer (400, 401, 403, 405) is never retried;
 *    `makecall` is NEVER retried (a second call is worse than a lost one, plan
 *    5.4): one attempt, and its answer — or the lack of one — is the caller's
 *    to classify (`confirmed` / `unconfirmed` / `failed`);
 *  - errors carry a fixed code (`pbx_*`), never the PBX's text, the key, a URL
 *    or a number; `message` is the code.
 */

export type TelephonyPbxErrorCode =
  | "pbx_invalid_token"
  | "pbx_crm_disabled"
  | "pbx_crm_switched_off"
  | "pbx_unauthorized"
  | "pbx_forbidden"
  | "pbx_validation_error"
  | "pbx_method_not_allowed"
  | "pbx_not_found"
  | "pbx_rate_limited"
  | "pbx_server_error"
  | "pbx_unexpected_status"
  | "pbx_timeout"
  | "pbx_network_error"
  | "pbx_redirect_refused"
  | "pbx_bad_response"
  | "pbx_response_too_large"
  | "pbx_window_too_dense";

/** Errors after which no further request of this run can succeed. */
export const TELEPHONY_PBX_STOPPING_ERRORS: ReadonlySet<TelephonyPbxErrorCode> = new Set([
  "pbx_invalid_token",
  "pbx_crm_disabled",
  "pbx_crm_switched_off",
  "pbx_unauthorized",
  "pbx_forbidden",
]);

export class TelephonyPbxError extends Error {
  readonly code: TelephonyPbxErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(code: TelephonyPbxErrorCode, status: number | null = null, retryable = false) {
    super(code);
    this.name = "TelephonyPbxError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export type TelephonyPbxOperationName =
  | "users"
  | "user"
  | "groups"
  | "history"
  | "domain"
  | "record"
  | "makecall";

export type TelephonyPbxOperation = Readonly<{
  name: TelephonyPbxOperationName;
  method: "GET" | "POST";
  /** A path under the configured base URL; `{login}` is the only placeholder. */
  path: string;
}>;

/** The closed list. Nothing outside it is ever requested (test-enforced). */
export const TELEPHONY_PBX_OPERATIONS: readonly TelephonyPbxOperation[] = Object.freeze([
  Object.freeze({ name: "users", method: "GET", path: "/users" }),
  Object.freeze({ name: "user", method: "GET", path: "/users/{login}" }),
  Object.freeze({ name: "groups", method: "GET", path: "/groups" }),
  Object.freeze({ name: "history", method: "GET", path: "/history/json" }),
  Object.freeze({ name: "domain", method: "GET", path: "/domain" }),
  Object.freeze({ name: "record", method: "GET", path: "/record" }),
  Object.freeze({ name: "makecall", method: "POST", path: "/makecall" }),
] as const);

const OPERATION_BY_NAME: ReadonlyMap<TelephonyPbxOperationName, TelephonyPbxOperation> = new Map(
  TELEPHONY_PBX_OPERATIONS.map((operation) => [operation.name, operation]),
);

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [500, 1_500];
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 2 * 1024;
const USERS_PAGE_SIZE = 100;
const USERS_MAX_PAGES = 10;
const LOGIN_PATTERN = /^[A-Za-z0-9._@+-]{1,128}$/u;
// A number as the PBX takes it (plan 5.4): digits only, no «+», 9–15 of them.
const MAKECALL_PHONE_PATTERN = /^[1-9][0-9]{8,14}$/u;
const CALLID_PATTERN = /^[^\p{Cc}\s](?:[^\p{Cc}]{0,198}[^\p{Cc}\s])?$/u;
export const TELEPHONY_PBX_HISTORY_LIMIT = 500;

type JsonObject = Record<string, unknown>;

export type TelephonyPbxFetch = (input: string, init: RequestInit) => Promise<Response>;

export type TelephonyPbxClientDependencies = Readonly<{
  fetch?: TelephonyPbxFetch;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
  /** Called once per attempt with counters only: no URL, key, number or body. */
  onAttempt?: (
    attempt: Readonly<{
      operation: TelephonyPbxOperationName;
      attempt: number;
      status: number | null;
      errorCode: TelephonyPbxErrorCode | null;
      durationMs: number;
    }>,
  ) => void;
  now?: () => number;
}>;

// ---------------------------------------------------------------------------
// Normalised answers. Only the fields EVO uses are kept; everything else the
// PBX sends (e-mails, mobiles, schedules, greetings…) is dropped at once.
// ---------------------------------------------------------------------------

export type TelephonyPbxUser = Readonly<{
  login: string;
  name: string | null;
  ext: string | null;
}>;

export type TelephonyPbxUserStatus = Readonly<{
  login: string;
  status: "online" | "offline" | null;
  forwardingSip: boolean | null;
  forwardingMobile: boolean | null;
}>;

export type TelephonyPbxDomain = Readonly<{
  timezoneName: string | null;
  timezoneOffsetMinutes: number | null;
  usersUsed: number | null;
  usersTotal: number | null;
  recordService: boolean | null;
}>;

export type TelephonyPbxRecordSettings = Readonly<{
  external: boolean | null;
  inner: boolean | null;
  exceptions: number | null;
}>;

/** A `GET /history/json` row reduced to the fields the reconciliation reads. */
export type TelephonyPbxHistoryRow = Readonly<Record<string, string | number>>;

const HISTORY_FIELDS: readonly string[] = Object.freeze([
  "uid",
  "type",
  "status",
  "client",
  "diversion",
  "telnum_name",
  "destination",
  "user",
  "group_name",
  "start",
  "wait",
  "duration",
  "record",
  "missedStatus",
]);

export type TelephonyPbxHistoryRequest = Readonly<{
  start: Date;
  end: Date;
  limit?: number;
}>;

export type TelephonyPbxHistoryResult = Readonly<{
  rows: readonly TelephonyPbxHistoryRow[];
  /** True when the PBX returned as many rows as the limit: the window may hide more. */
  full: boolean;
}>;

/**
 * One `POST /makecall` (plan 5.4, 8.1): the PBX rings the employee's registered
 * device first and connects the client after the answer. `phone` is the client's
 * number in digits without «+»; `user` is the employee's PBX login. `clid` and
 * `show_phone` are never sent: the PBX uses the company's main number and its own
 * behaviour.
 */
export type TelephonyPbxMakeCallRequest = Readonly<{ phone: string; user: string }>;

/** `callId` is null when the PBX answered 2xx without a usable `callid`: the call may exist. */
export type TelephonyPbxMakeCallResult = Readonly<{ callId: string | null }>;

export type TelephonyPbxClient = Readonly<{
  listUsers(): Promise<Readonly<{ users: readonly TelephonyPbxUser[]; complete: boolean }>>;
  getUser(login: string): Promise<TelephonyPbxUserStatus>;
  countGroups(): Promise<number>;
  getHistory(request: TelephonyPbxHistoryRequest): Promise<TelephonyPbxHistoryResult>;
  getDomain(): Promise<TelephonyPbxDomain>;
  getRecordSettings(): Promise<TelephonyPbxRecordSettings>;
  /**
   * One attempt, no retry. Resolves with the call id (or null for a 2xx without one);
   * rejects with a `TelephonyPbxError`: an error answer (4xx/5xx) has a `status`, a
   * timeout / network error before any answer has none, and every failure AFTER a 2xx
   * answer (an unreadable, oversized or broken-off body: `pbx_bad_response`,
   * `pbx_response_too_large`, `pbx_timeout`, `pbx_network_error`) keeps that 2xx `status` —
   * the caller tells «failed» (a 4xx) from «unconfirmed» (no status, a 2xx, a 5xx) by it.
   */
  makeCall(request: TelephonyPbxMakeCallRequest): Promise<TelephonyPbxMakeCallResult>;
}>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOrNull(value: unknown, max: number): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" || trimmed.length > max ? null : trimmed;
}

function intOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value === "string" && /^-?[0-9]{1,9}$/u.test(value.trim())) return Number(value.trim());
  return null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function pbxTimestamp(date: Date): string {
  // YYYYmmddTHHMMSSZ, UTC (portal, «Выгрузка внешней истории»).
  return date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(joined);
}

function classifyUnauthorized(body: string | null): TelephonyPbxErrorCode {
  const text = (body ?? "").toLowerCase();
  if (text.includes("invalid token")) return "pbx_invalid_token";
  if (text.includes("crm switched off")) return "pbx_crm_switched_off";
  if (text.includes("crm disabled")) return "pbx_crm_disabled";
  return "pbx_unauthorized";
}

function errorForStatus(status: number, body: string | null): TelephonyPbxError {
  if (status === 401) return new TelephonyPbxError(classifyUnauthorized(body), status);
  if (status === 403) return new TelephonyPbxError("pbx_forbidden", status);
  if (status === 400) return new TelephonyPbxError("pbx_validation_error", status);
  if (status === 404) return new TelephonyPbxError("pbx_not_found", status);
  if (status === 405) return new TelephonyPbxError("pbx_method_not_allowed", status);
  if (status === 429) return new TelephonyPbxError("pbx_rate_limited", status, true);
  if (status >= 500) return new TelephonyPbxError("pbx_server_error", status, true);
  return new TelephonyPbxError("pbx_unexpected_status", status);
}

export function createTelephonyPbxClient(
  config: PlatformTelephonyPbxConfig,
  dependencies: TelephonyPbxClientDependencies = {},
): TelephonyPbxClient {
  const fetchImplementation: TelephonyPbxFetch =
    dependencies.fetch ?? ((input, init) => fetch(input, init));
  const sleep =
    dependencies.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelays = dependencies.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const now = dependencies.now ?? Date.now;
  const base = new URL(config.baseUrl);
  if (base.protocol !== "https:") throw new TelephonyPbxError("pbx_unexpected_status");

  function buildUrl(
    operation: TelephonyPbxOperation,
    pathValues: Readonly<Record<string, string>>,
    query: Readonly<Record<string, string>>,
  ): string {
    let path = operation.path;
    for (const [name, value] of Object.entries(pathValues)) {
      path = path.replace(`{${name}}`, encodeURIComponent(value));
    }
    const url = new URL(config.baseUrl + path);
    // The host is fixed by the configuration: a crafted path value must never
    // move the request elsewhere.
    if (url.protocol !== "https:" || url.host !== base.host || !url.pathname.startsWith(base.pathname)) {
      throw new TelephonyPbxError("pbx_unexpected_status");
    }
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    return url.toString();
  }

  async function attemptOnce(
    operation: TelephonyPbxOperation,
    url: string,
    attempt: number,
    body: string | null = null,
  ): Promise<unknown> {
    const started = now();
    let status: number | null = null;
    let errorCode: TelephonyPbxErrorCode | null = null;
    try {
      let response: Response;
      try {
        response = await fetchImplementation(url, {
          method: operation.method,
          headers: body === null
            ? { "X-API-KEY": config.apiKey, Accept: "application/json" }
            : { "X-API-KEY": config.apiKey, Accept: "application/json", "Content-Type": "application/json" },
          ...(body === null ? {} : { body }),
          redirect: "manual",
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new TelephonyPbxError(timedOut ? "pbx_timeout" : "pbx_network_error", null, true);
      }
      status = response.status;
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        throw new TelephonyPbxError("pbx_redirect_refused", response.status);
      }
      if (response.status < 200 || response.status >= 300) {
        let body: string | null = null;
        try {
          body = await readBoundedText(response, MAX_ERROR_BODY_BYTES);
        } catch {
          body = null;
        }
        throw errorForStatus(response.status, body);
      }
      let text: string | null;
      try {
        text = await readBoundedText(response, MAX_RESPONSE_BYTES);
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new TelephonyPbxError(timedOut ? "pbx_timeout" : "pbx_network_error", response.status, true);
      }
      if (text === null) throw new TelephonyPbxError("pbx_response_too_large", response.status);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new TelephonyPbxError("pbx_bad_response", response.status);
      }
    } catch (error) {
      const pbxError = error instanceof TelephonyPbxError ? error : new TelephonyPbxError("pbx_network_error", null, true);
      errorCode = pbxError.code;
      throw pbxError;
    } finally {
      try {
        dependencies.onAttempt?.({
          operation: operation.name,
          attempt,
          status,
          errorCode,
          durationMs: Math.max(0, now() - started),
        });
      } catch {
        // A logging hook never changes the outcome.
      }
    }
  }

  async function read(
    name: TelephonyPbxOperationName,
    pathValues: Readonly<Record<string, string>> = {},
    query: Readonly<Record<string, string>> = {},
  ): Promise<unknown> {
    const operation = OPERATION_BY_NAME.get(name);
    if (operation === undefined || operation.method !== "GET") {
      throw new TelephonyPbxError("pbx_method_not_allowed");
    }
    const url = buildUrl(operation, pathValues, query);
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await attemptOnce(operation, url, attempt);
      } catch (error) {
        const retryable = error instanceof TelephonyPbxError && error.retryable;
        const delay = retryDelays[attempt - 1];
        if (!retryable || delay === undefined) throw error;
        await sleep(delay);
      }
    }
  }

  function items(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;
    if (isObject(payload) && Array.isArray(payload.items)) return payload.items;
    throw new TelephonyPbxError("pbx_bad_response");
  }

  return Object.freeze({
    async listUsers() {
      const users: TelephonyPbxUser[] = [];
      let start = 0;
      for (let page = 0; page < USERS_MAX_PAGES; page += 1) {
        const payload = await read("users", {}, {
          start: String(start),
          limit: String(USERS_PAGE_SIZE),
        });
        const list = items(payload);
        for (const entry of list) {
          if (!isObject(entry)) continue;
          const login = textOrNull(entry.login, 128);
          if (login === null || !LOGIN_PATTERN.test(login)) continue;
          users.push(
            Object.freeze({
              login,
              name: textOrNull(entry.name, 200),
              ext: textOrNull(entry.ext, 32),
            }),
          );
        }
        const total = isObject(payload) && isObject(payload.info) ? intOrNull(payload.info.total) : null;
        start += list.length;
        if (list.length === 0 || list.length < USERS_PAGE_SIZE || (total !== null && start >= total)) {
          return Object.freeze({ users: Object.freeze(users), complete: true });
        }
      }
      // More pages than a five-user tenant could ever have: stop, not complete.
      return Object.freeze({ users: Object.freeze(users), complete: false });
    },

    async getUser(login) {
      if (!LOGIN_PATTERN.test(login)) throw new TelephonyPbxError("pbx_validation_error");
      const payload = await read("user", { login }, { with: "status" });
      if (!isObject(payload)) throw new TelephonyPbxError("pbx_bad_response");
      const forwarding = isObject(payload.calls_forwarding) ? payload.calls_forwarding : {};
      const status = payload.status === "online" || payload.status === "offline" ? payload.status : null;
      return Object.freeze({
        login: textOrNull(payload.login, 128) ?? login,
        status,
        forwardingSip: boolOrNull(forwarding.sip),
        forwardingMobile: boolOrNull(forwarding.mobile),
      });
    },

    async countGroups() {
      const payload = await read("groups", {}, { start: "0", limit: "1" });
      if (isObject(payload) && isObject(payload.info)) {
        const total = intOrNull(payload.info.total);
        if (total !== null && total >= 0) return total;
      }
      return items(payload).length;
    },

    async getHistory(request) {
      const limit = request.limit ?? TELEPHONY_PBX_HISTORY_LIMIT;
      if (
        !(request.start.getTime() < request.end.getTime()) ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 5_000
      ) {
        throw new TelephonyPbxError("pbx_validation_error");
      }
      const payload = await read("history", {}, {
        start: pbxTimestamp(request.start),
        end: pbxTimestamp(request.end),
        type: "all",
        limit: String(limit),
        first_answered: "true",
        processMissed: "true",
      });
      const list = items(payload);
      const rows: TelephonyPbxHistoryRow[] = [];
      for (const entry of list) {
        if (!isObject(entry)) continue;
        const row: Record<string, string | number> = {};
        for (const field of HISTORY_FIELDS) {
          const value = entry[field];
          if (typeof value === "number" && Number.isFinite(value)) row[field] = value;
          else if (typeof value === "string" && value.length <= 2_048) row[field] = value;
        }
        rows.push(Object.freeze(row));
      }
      return Object.freeze({ rows: Object.freeze(rows), full: list.length >= limit });
    },

    async getDomain() {
      const payload = await read("domain");
      if (!isObject(payload)) throw new TelephonyPbxError("pbx_bad_response");
      const timezone = isObject(payload.timezone) ? payload.timezone : {};
      const limits = isObject(payload.limits) ? payload.limits : {};
      const users = isObject(limits.users) ? limits.users : {};
      const services = isObject(payload.services) ? payload.services : {};
      return Object.freeze({
        timezoneName: textOrNull(timezone.name, 64),
        timezoneOffsetMinutes: intOrNull(timezone.offset),
        usersUsed: intOrNull(users.used),
        usersTotal: intOrNull(users.total),
        recordService: boolOrNull(services.record),
      });
    },

    async getRecordSettings() {
      const payload = await read("record");
      if (!isObject(payload)) throw new TelephonyPbxError("pbx_bad_response");
      return Object.freeze({
        external: boolOrNull(payload.external),
        inner: boolOrNull(payload.inner),
        exceptions: Array.isArray(payload.users_exception) ? payload.users_exception.length : null,
      });
    },

    async makeCall(request) {
      // Everything a request must satisfy is checked before the network: a wrong value is a
      // programming error of the caller, never something the PBX should be asked about.
      if (
        typeof request !== "object" || request === null
        || typeof request.phone !== "string" || !MAKECALL_PHONE_PATTERN.test(request.phone)
        || typeof request.user !== "string" || !LOGIN_PATTERN.test(request.user)
      ) {
        throw new TelephonyPbxError("pbx_validation_error");
      }
      const operation = OPERATION_BY_NAME.get("makecall");
      if (operation === undefined || operation.method !== "POST") {
        throw new TelephonyPbxError("pbx_method_not_allowed");
      }
      // One attempt: a second call is worse than a lost one (plan 5.4).
      const payload = await attemptOnce(
        operation,
        buildUrl(operation, {}, {}),
        1,
        JSON.stringify({ phone: request.phone, user: request.user }),
      );
      if (!isObject(payload)) throw new TelephonyPbxError("pbx_bad_response", 200);
      const raw = payload.callid;
      const callId = typeof raw === "number" && Number.isSafeInteger(raw) ? String(raw)
        : typeof raw === "string" && raw.length <= 200 && CALLID_PATTERN.test(raw) ? raw : null;
      return Object.freeze({ callId });
    },
  });
}
