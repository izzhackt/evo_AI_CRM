import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getPlatformMessagingBackendConfig,
  type PlatformMessagingBackendConfig,
} from "./platform-messaging-backend-config.ts";
import {
  isPlatformTelephonyEnabled,
  readPlatformTelephonyCrmTokens,
  type PlatformTelephonyCrmTokens,
} from "./platform-telephony-ingress-config.ts";
import {
  parseTelephonyBody,
  readBoundedTelephonyBody,
  telephonyBodyBucket,
  telephonyBodyKind,
  telephonyLogMediaType,
  TELEPHONY_MAX_BODY_BYTES,
} from "./platform-telephony-ingress-body.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

/**
 * PBX → CRM intake for Beeline KG (docs/EVO_TELEPHONY_PLAN_2026-10-16.md §5.1,
 * ADR 0033), route `POST /api/v2/telephony/beeline/inbound`.
 *
 * The cheap refusals come first and the database is never called before the
 * `crm_token` has been checked in constant time. After it:
 *  - `contact` is answered `200 {}` at once, with no database access, whether
 *    or not intake is switched on and whatever the backend state: the PBX asks
 *    on every incoming call and its behaviour on an error is unknown, so this
 *    answer is never 503;
 *  - everything else is refused 503 unless EVO_PLATFORM_TELEPHONY_ENABLED is
 *    exactly "1";
 *  - `event`, `history` and `rating` are stored by `platform.telephony_receive_v1`
 *    (migration 289) — evidence first, projection second — and answered 200;
 *  - any other command stores only the form shape (field names and lengths)
 *    and is answered 400.
 *
 * The application log gets counters only (status, reason, media type, size
 * bucket, parse flag); no body, value, token, address or recording link is ever
 * logged. Failed requests are rate-limited per address; a request that carries
 * a valid key is never stopped by the limiter.
 */

const MAX_FAILURES_PER_WINDOW = 20;
const FAILURE_WINDOW_MS = 60_000;
const FAILURE_BLOCK_MS = 60_000;
const MAX_TRACKED_ADDRESSES = 10_000;
const DEFAULT_DATABASE_DEADLINE_MS = 8_000;
const ADDRESS_HEADER = "x-evo-telephony-ip";
const RECEIVE_COMMANDS: ReadonlySet<string> = new Set(["event", "history", "rating"]);
// The nineteen documented PBX fields (plan §3.2). The database repeats the list.
const DOCUMENTED_FIELDS: ReadonlySet<string> = new Set([
  "cmd",
  "type",
  "user",
  "phone",
  "diversion",
  "start",
  "duration",
  "callid",
  "status",
  "ext",
  "group",
  "groupRealName",
  "telnum",
  "telnum_name",
  "rating",
  "wait",
  "missedStatus",
  "direction",
  "second_callid",
]);
// A value that looks like a link or an audio file. The recording link has its
// own argument and its own column; a link in any other field would land in a
// free-text column of the evidence, so such a value is dropped here, before the
// writer (PLAN_CHANGES «Телефония T1a», item 17). Mirrors the database check
// platform_private.telephony_fields_ok.
const LINK_LOOKING_VALUE =
  /(?::\/\/|^\s*(?:https?|ftp|file):|\.(?:mp3|wav|ogg|m4a|aac|opus|flac)(?:\?|$))/iu;
const VALIDATION_STATES: ReadonlySet<string> = new Set(["ok", "incomplete", "rejected"]);
const PROJECTION_STATES: ReadonlySet<string> = new Set([
  "projected",
  "queued",
  "disabled",
  "internal",
  "not_applicable",
]);
const RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;

type RpcClient = Pick<SupabaseClient, "schema">;
type LogValue = string | number | boolean;
type JsonObject = Record<string, unknown>;

type Reason =
  | "method_not_allowed"
  | "not_configured"
  | "payload_too_large"
  | "unsupported_media_type"
  | "parse_failed"
  | "invalid_token"
  | "rate_limited"
  | "contact"
  | "disabled"
  | "backend_not_configured"
  | "stored"
  | "deduplicated"
  | "rejected_fields"
  | "unknown_cmd"
  | "database_unavailable"
  | "internal_error";

/**
 * Failed requests per address (plan §5.1, step 5). More than 20 in a minute
 * block the address for a minute. Only requests with a wrong key or an
 * unparsable body are counted, and only those are ever answered 429. The map is
 * a bounded LRU held in memory and reset by a restart.
 */
export class TelephonyFailureLimiter {
  private readonly entries = new Map<
    string,
    { windowStart: number; count: number; blockedUntil: number }
  >();
  private readonly now: () => number;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly blockMs: number;
  private readonly maxEntries: number;

  constructor(
    options: Readonly<{
      now?: () => number;
      limit?: number;
      windowMs?: number;
      blockMs?: number;
      maxEntries?: number;
    }> = {},
  ) {
    this.now = options.now ?? Date.now;
    this.limit = options.limit ?? MAX_FAILURES_PER_WINDOW;
    this.windowMs = options.windowMs ?? FAILURE_WINDOW_MS;
    this.blockMs = options.blockMs ?? FAILURE_BLOCK_MS;
    this.maxEntries = options.maxEntries ?? MAX_TRACKED_ADDRESSES;
  }

  /** Counts one failed request; true when it must be answered 429. */
  recordFailure(address: string): boolean {
    const now = this.now();
    let entry = this.entries.get(address);
    this.entries.delete(address);
    if (
      entry === undefined ||
      (now >= entry.blockedUntil &&
        (entry.blockedUntil !== 0 || now - entry.windowStart >= this.windowMs))
    ) {
      entry = { windowStart: now, count: 0, blockedUntil: 0 };
    }
    let limited = now < entry.blockedUntil;
    if (!limited) {
      entry.count += 1;
      if (entry.count > this.limit) {
        entry.blockedUntil = now + this.blockMs;
        limited = true;
      }
    }
    this.entries.set(address, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return limited;
  }

  /** Test aid: how many addresses are tracked. */
  get size(): number {
    return this.entries.size;
  }
}

export type PlatformTelephonyInboundDependencies = Readonly<{
  createServiceClient(config: PlatformMessagingBackendConfig): RpcClient;
  environment: Readonly<Record<string, string | undefined>>;
  limiter: TelephonyFailureLimiter;
  log(entry: Readonly<Record<string, LogValue>>): void;
  /** How long the database may take before the PBX is answered 503. */
  databaseDeadlineMs: number;
}>;

function defaultLog(entry: Readonly<Record<string, LogValue>>): void {
  console.info(JSON.stringify(entry));
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

// SHA-256 of both sides, then timingSafeEqual: equal-length inputs whatever the
// supplied value looks like. Both slots are always compared.
function matchTokenSlot(
  supplied: string | undefined,
  tokens: PlatformTelephonyCrmTokens,
): "current" | "next" | null {
  const suppliedDigest = digest(supplied ?? "");
  const current = timingSafeEqual(suppliedDigest, digest(tokens.current));
  const next =
    tokens.next !== null && timingSafeEqual(suppliedDigest, digest(tokens.next));
  if (current) return "current";
  return next ? "next" : null;
}

// The address comes only from the header the edge overwrites with
// `{remote_host}`; X-Forwarded-For and everything else a client can set is
// ignored. Until the edge is hardened (plan §5.7) the header may be absent or
// client-set: the worst effect is a shared or evaded failure counter, because
// the limiter never stops a valid key.
function clientAddress(request: Request): string {
  const raw = request.headers.get(ADDRESS_HEADER)?.trim().toLowerCase() ?? "";
  return raw !== "" && isIP(raw) !== 0 ? raw : "unknown";
}

function declaredLengthExceedsBound(request: Request): boolean {
  const declared = request.headers.get("content-length")?.trim();
  return (
    declared !== undefined &&
    /^[0-9]+$/u.test(declared) &&
    Number(declared) > TELEPHONY_MAX_BODY_BYTES
  );
}

class DeadlineExceeded extends Error {}

async function withDeadline<T>(operation: PromiseLike<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = Promise.resolve(operation);
  // A late failure of the abandoned call must not become an unhandled rejection.
  guarded.catch(() => undefined);
  try {
    return await Promise.race([
      guarded,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new DeadlineExceeded()), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function enumValue(value: unknown, allowed: ReadonlySet<string>): string | null {
  return typeof value === "string" && allowed.has(value) ? value : null;
}

export function createPlatformTelephonyInboundHandler(
  overrides: Partial<PlatformTelephonyInboundDependencies> = {},
): (request: Request) => Promise<Response> {
  const dependencies: PlatformTelephonyInboundDependencies = {
    createServiceClient: createPlatformSupabaseServiceClient,
    environment: process.env,
    limiter: new TelephonyFailureLimiter(),
    log: defaultLog,
    databaseDeadlineMs: DEFAULT_DATABASE_DEADLINE_MS,
    ...overrides,
  };

  const handle = async (request: Request): Promise<Response> => {
    const context: Record<string, LogValue> = {
      content_type: telephonyLogMediaType(request.headers.get("content-type")),
      body_bucket: "none",
      parse_failed: false,
      cmd: "none",
    };

    const finish = (
      status: number,
      body: Readonly<Record<string, unknown>>,
      reason: Reason,
      headers: Readonly<Record<string, string>> = {},
    ): Response => {
      try {
        dependencies.log({
          event: "telephony_inbound",
          service: "evo-crm",
          status,
          reason,
          ...context,
        });
      } catch {
        // Logging never changes the answer the PBX gets.
      }
      return new Response(JSON.stringify(body), {
        status,
        headers: { ...RESPONSE_HEADERS, ...headers },
      });
    };

    const unavailable = (reason: Reason) =>
      finish(503, { error: "telephony_unavailable" }, reason);

    // A request refused before the key is proven: counted per address, and
    // answered 429 once the address is over the limit.
    const refuse = (
      address: string,
      status: number,
      body: Readonly<Record<string, unknown>>,
      reason: Reason,
    ): Response => {
      if (dependencies.limiter.recordFailure(address)) {
        return finish(429, { error: "rate_limited" }, "rate_limited", {
          "retry-after": "60",
        });
      }
      return finish(status, body, reason);
    };

    // 1. Method.
    if (request.method !== "POST") {
      return finish(405, { error: "method_not_allowed" }, "method_not_allowed", {
        allow: "POST",
      });
    }

    // 2. No usable key configured: nothing can be authenticated.
    const tokens = readPlatformTelephonyCrmTokens(dependencies.environment);
    if (tokens === null) return unavailable("not_configured");

    const address = clientAddress(request);

    // 3. Declared size and media type.
    if (declaredLengthExceedsBound(request)) {
      context.body_bucket = "gt_32k";
      return refuse(address, 413, { error: "payload_too_large" }, "payload_too_large");
    }
    const contentType = request.headers.get("content-type");
    const kind = telephonyBodyKind(contentType);
    if (kind === null) {
      return refuse(
        address,
        415,
        { error: "unsupported_media_type" },
        "unsupported_media_type",
      );
    }

    // 4. Bounded read and narrow flat parse. Nothing here touches the database.
    let raw: Uint8Array | null;
    try {
      raw = await readBoundedTelephonyBody(request);
    } catch {
      context.parse_failed = true;
      return refuse(address, 400, { error: "Invalid parameters" }, "parse_failed");
    }
    if (raw === null) {
      context.body_bucket = "gt_32k";
      return refuse(address, 413, { error: "payload_too_large" }, "payload_too_large");
    }
    context.body_bucket = telephonyBodyBucket(raw.byteLength);
    const parsed = await parseTelephonyBody(kind, raw, contentType ?? "");
    if (parsed === null) {
      context.parse_failed = true;
      return refuse(address, 400, { error: "Invalid parameters" }, "parse_failed");
    }

    // 5. The key, in constant time, current or next. It leaves the map here and
    // is stored nowhere.
    const suppliedToken = parsed.get("crm_token");
    parsed.delete("crm_token");
    const slot = matchTokenSlot(suppliedToken, tokens);
    if (slot === null) {
      return refuse(address, 401, { error: "Invalid token" }, "invalid_token");
    }

    // 6. Authenticated.
    const cmd = (parsed.get("cmd") ?? "").trim().toLowerCase();
    context.cmd = cmd === "contact" || RECEIVE_COMMANDS.has(cmd) ? cmd : "other";

    if (cmd === "contact") return finish(200, {}, "contact");

    if (!isPlatformTelephonyEnabled(dependencies.environment)) {
      return unavailable("disabled");
    }

    const known = RECEIVE_COMMANDS.has(cmd);
    let config: PlatformMessagingBackendConfig | null = null;
    try {
      config = getPlatformMessagingBackendConfig(
        dependencies.environment as NodeJS.ProcessEnv,
      );
    } catch {
      // Without the backend nothing can be stored: a documented command is
      // refused 503, an unknown one is still answered 400 below.
      if (known) return unavailable("backend_not_configured");
    }

    // The link leaves the field list and travels as its own argument, only for
    // `history`; everything outside the documented fields is dropped here too.
    const fields: Record<string, string> = {};
    // An unknown command stores the form shape only: names and lengths.
    const shape: Record<string, number> = {};
    if (known) {
      let dropped = 0;
      for (const [name, value] of parsed) {
        if (name === "link") continue;
        if (DOCUMENTED_FIELDS.has(name) && !LINK_LOOKING_VALUE.test(value)) {
          fields[name] = value;
        } else {
          dropped += 1;
        }
      }
      if (dropped > 0) context.dropped_fields = dropped;
    } else {
      for (const [name, value] of parsed) shape[name] = value.length;
    }
    const link = cmd === "history" ? (parsed.get("link") ?? "") : "";

    let outcome: { data: unknown; error: unknown } = { data: null, error: true };
    if (config !== null) {
      try {
        const client = dependencies.createServiceClient(config);
        outcome = await withDeadline(
          client.schema("platform").rpc("telephony_receive_v1", {
            p_organization_id: config.organizationId,
            p_request_id: randomUUID(),
            p_cmd: cmd.slice(0, 64),
            p_token_slot: slot,
            p_body_sha256: createHash("sha256").update(raw).digest("hex"),
            p_fields: known ? fields : {},
            p_recording_link: known && link !== "" ? link : null,
            p_form_shape: known ? null : shape,
          }),
          dependencies.databaseDeadlineMs,
        );
      } catch {
        outcome = { data: null, error: true };
      }
    }

    if (!known) {
      // The command is not one the PBX documents. Whether or not the form shape
      // could be stored, the PBX is told the parameters are invalid.
      return finish(400, { error: "Invalid parameters" }, "unknown_cmd");
    }

    const result = isObject(outcome.data) ? outcome.data : null;
    if (outcome.error || result === null) return unavailable("database_unavailable");

    const validation = enumValue(result.validation_state, VALIDATION_STATES);
    if (validation !== null) context.validation_state = validation;
    const projection = enumValue(result.projection, PROJECTION_STATES);
    if (projection !== null) context.projection = projection;

    switch (result.status) {
      case "stored":
        return finish(200, {}, "stored");
      case "deduplicated":
      case "replayed":
        return finish(200, { deduplicated: true }, "deduplicated");
      case "rejected":
        // The database refused the fields (a value that looks like a link or a
        // secret) and kept only the form shape. A repeat would be refused the
        // same way and a 4xx could make the PBX drop the connection, so the
        // message is acknowledged; the reconciliation recovers the call.
        return finish(200, {}, "rejected_fields");
      default:
        return unavailable("database_unavailable");
    }
  };

  // Safety net: an unexpected failure is still a JSON 503 for the PBX (never the
  // framework's default error page), with a counter in the application log.
  return async (request: Request): Promise<Response> => {
    try {
      return await handle(request);
    } catch {
      try {
        dependencies.log({
          event: "telephony_inbound",
          service: "evo-crm",
          status: 503,
          reason: "internal_error",
        });
      } catch {
        // Logging never changes the answer the PBX gets.
      }
      return new Response(JSON.stringify({ error: "telephony_unavailable" }), {
        status: 503,
        headers: RESPONSE_HEADERS,
      });
    }
  };
}
