import "server-only";

import { isStaffPreview } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import {
  PLATFORM_WAHA_SESSION_NAME,
  resolveManualSendWahaRuntime,
  type PlatformManualSendWahaRuntime,
} from "../platform-provider-workflows.ts";
import {
  WHATSAPP_CODE_MIN_INTERVAL_MS,
  WHATSAPP_CONNECT_MIN_INTERVAL_MS,
  WHATSAPP_CONNECT_WINDOW_MS,
  WHATSAPP_RESTART_MIN_INTERVAL_MS,
  WHATSAPP_STATUS_MIN_INTERVAL_MS,
  normalizePairingPhone,
  type WhatsAppConnectErrorCode,
} from "../v3/whatsapp-connect-contract.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import {
  WahaConnectError,
  createWahaConnectClient,
  type WahaConnectClient,
  type WahaConnectDependencies,
} from "./platform-waha-connect.ts";

/**
 * Привязка WhatsApp из CRM: правила вокруг клиента WAHA (решение владельца
 * 20.10.2026). Клиент (`platform-waha-connect.ts`) только разговаривает с WAHA;
 * здесь решается, кому можно, как часто, что записать и что вернуть.
 *
 *  - **Только администратор**, и это проверяется здесь, на сервере, а не только
 *    скрытием кнопки: `systemRole === "admin"`, не просмотр роли.
 *  - **Один след на запрос.** «Подключить» и «Получить код» — по одной записи
 *    (`recordAudit`) *до* обращения к WAHA. Ни QR, ни кода, ни номера в записи
 *    нет: вид запроса, кто, в какой организации, когда. Опрос состояния и
 *    обновление QR внутри открытого окна записей не пишут — окно открыл нажатый
 *    «Подключить», и QR выдаётся только ему (10 минут). След постоянный: функция
 *    базы `platform.record_whatsapp_connect_v1` (миграция 311) вызывается сессией
 *    самого администратора и пишет `platform.audit_events`; он виден в «Журнале
 *    действий». Не записалось (база не ответила, миграция ещё не применена, срок
 *    вышел) — остаётся строка журнала приложения `whatsapp_connect_audit`
 *    (`logAuditFallback`), а подключение не блокируется: запись следа — не
 *    условие входа в WhatsApp.
 *  - **Лимиты.** Не чаще одного запуска/перезапуска за 30 с на организацию;
 *    «Подключить» — раз в 10 с, код — раз в 20 с, опрос — раз в 1,5 с на
 *    администратора. Состояние держится в памяти процесса: приложение одно.
 *  - **Нет** выхода из аккаунта, удаления и создания сессии.
 *
 * Запись `platform.audit_events` идёт только через функцию базы, поэтому след — миграция
 * 311 и вызов под сессией администратора, а не сервисный ключ; см. запись
 * `docs/PLAN_CHANGES.md` от 20.10.2026.
 */

export type WhatsAppConnectRequest =
  | Readonly<{ action: "status"; withQr: boolean }>
  | Readonly<{ action: "connect" }>
  | Readonly<{ action: "code"; phone: string }>;

export type WhatsAppConnectOutcome =
  | Readonly<{ status: "ok"; session: string | null; qr: string | null; code: string | null }>
  | Readonly<{ status: "refused"; http: number; code: WhatsAppConnectErrorCode; retryAfterSeconds?: number }>;

export type WhatsAppConnectAuditEntry = Readonly<{
  /** `qr` — «Подключить»; `code` — «Получить код». Больше ничего в запись не идёт. */
  kind: "qr" | "code";
  organizationId: string;
  actorProfileId: string;
  actorMembershipId: string;
  at: string;
}>;

export type WhatsAppConnectDependencies = Readonly<{
  resolveRuntime?: (organizationId: string) => Promise<PlatformManualSendWahaRuntime>;
  createClient?: (runtime: PlatformManualSendWahaRuntime) => WahaConnectClient;
  clientDependencies?: WahaConnectDependencies;
  /** Постоянный след: вызов функции базы под сессией администратора. Бросает, если не записалось. */
  recordAudit?: (entry: WhatsAppConnectAuditEntry) => void | Promise<void>;
  /** Клиент базы с сессией администратора для `recordAudit` по умолчанию. */
  createAuditClient?: () => Promise<WhatsAppAuditRpcClient>;
  /** Запасной след, если `recordAudit` не отработал: строка журнала приложения. */
  logAuditFallback?: (entry: WhatsAppConnectAuditEntry, errorCode: string) => void;
  /** Сколько ждать запись следа, мс; потом подключение идёт дальше с запасным следом. */
  auditTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}>;

/** Сколько ждать функцию базы со следом; дольше — идём дальше, запись остаётся строкой журнала приложения. */
export const WHATSAPP_AUDIT_TIMEOUT_MS = 4_000;

/** Вид запроса в функции базы: `qr` — «Подключить», `pairing_code` — «Получить код». */
const AUDIT_RPC_KIND = { qr: "qr", code: "pairing_code" } as const satisfies Record<WhatsAppConnectAuditEntry["kind"], string>;

/** Ошибка записи следа: только короткий код (SQLSTATE, `PGRST…`, `timeout`), без текста базы. */
class WhatsAppAuditError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "WhatsAppAuditError";
    this.code = code;
  }
}

function auditErrorCode(error: unknown): string {
  const code = error instanceof WhatsAppAuditError ? error.code : (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,16}$/u.test(code) ? code : "unknown";
}

/** Сколько ждать, пока сессия после запуска дойдёт до «ждёт сканирования». */
export const WHATSAPP_CODE_READY_WAIT_MS = 20_000;
const READY_POLL_MS = 1_000;

type Limits = {
  restartAt: Map<string, number>;
  connectAt: Map<string, number>;
  codeAt: Map<string, number>;
  statusAt: Map<string, number>;
  windowUntil: Map<string, number>;
  inFlight: Set<string>;
};

const limits: Limits = {
  restartAt: new Map(),
  connectAt: new Map(),
  codeAt: new Map(),
  statusAt: new Map(),
  windowUntil: new Map(),
  inFlight: new Set(),
};

export function resetWhatsAppConnectLimitsForTests(): void {
  for (const value of Object.values(limits)) value.clear();
}

function defaultResolveRuntime(organizationId: string): Promise<PlatformManualSendWahaRuntime> {
  return resolveManualSendWahaRuntime(
    createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig()),
    organizationId,
  );
}

/** Из клиента базы нужен один вызов: `schema("platform").rpc(...)`. */
export type WhatsAppAuditRpcClient = Readonly<{
  schema(name: string): {
    rpc(
      name: string,
      args: Record<string, unknown>,
    ): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
  };
}>;

async function sessionAuditClient(): Promise<WhatsAppAuditRpcClient> {
  const { createSupabaseServerClient } = await import("../supabase/server.ts");
  return createSupabaseServerClient();
}

/**
 * Постоянный след: `platform.record_whatsapp_connect_v1` под сессией самого администратора (не
 * сервисный ключ). Функция сама берёт личность и организацию из токена и проверяет, что это
 * действующий администратор; в неё уходит только вид запроса, ни номер, ни QR, ни код. Расписка
 * должна повторить вид: ответ без неё записью не считается. Бросает, если не записалось.
 */
export async function recordWhatsAppConnectAudit(
  entry: WhatsAppConnectAuditEntry,
  createClient: () => Promise<WhatsAppAuditRpcClient> = sessionAuditClient,
): Promise<void> {
  const client = await createClient();
  const { data, error } = await client.schema("platform").rpc("record_whatsapp_connect_v1", {
    p_kind: AUDIT_RPC_KIND[entry.kind],
  });
  if (error) throw new WhatsAppAuditError(typeof error.code === "string" ? error.code : "unknown");
  const receipt = data as { kind?: unknown } | null;
  if (!receipt || typeof receipt !== "object" || receipt.kind !== AUDIT_RPC_KIND[entry.kind]) {
    throw new WhatsAppAuditError("receipt");
  }
}

/** Запасной след — строка журнала приложения; поля — перечисленные в `WhatsAppConnectAuditEntry` и код отказа записи. */
function defaultLogAuditFallback(entry: WhatsAppConnectAuditEntry, errorCode: string): void {
  console.info(JSON.stringify({
    event: "whatsapp_connect_audit",
    durable: false,
    audit_error: errorCode,
    kind: entry.kind,
    organization_id: entry.organizationId,
    actor_profile_id: entry.actorProfileId,
    actor_membership_id: entry.actorMembershipId,
    at: entry.at,
  }));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfter(lastAt: number | undefined, interval: number, now: number): number | null {
  if (lastAt === undefined || now - lastAt >= interval) return null;
  return Math.max(1, Math.ceil((interval - (now - lastAt)) / 1_000));
}

function refused(http: number, code: WhatsAppConnectErrorCode, retryAfterSeconds?: number): WhatsAppConnectOutcome {
  return { status: "refused", http, code, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) };
}

function failureOutcome(error: unknown): WhatsAppConnectOutcome {
  if (error instanceof WahaConnectError) {
    switch (error.code) {
      case "session_missing": return refused(404, "session_missing");
      case "session_not_ready": return refused(409, "session_not_ready");
      case "invalid_phone": return refused(400, "invalid_phone");
      case "phone_rejected": return refused(422, "phone_rejected");
      case "already_connected": return refused(409, "already_connected");
      case "provider_unreachable":
      case "provider_timeout": return refused(503, "provider_unreachable");
      case "configuration_invalid":
      case "provider_rejected":
      case "provider_unavailable":
      case "provider_malformed_response": return refused(502, "provider_unavailable");
    }
  }
  return refused(503, "unavailable");
}

/** Только администратор вне просмотра роли; решает сервер, а не интерфейс. */
export function canConnectWhatsApp(actor: ActivePlatformActor): boolean {
  return actor.systemRole === "admin" && !isStaffPreview(actor);
}

export async function performWhatsAppConnect(
  actor: ActivePlatformActor,
  request: WhatsAppConnectRequest,
  dependencies: WhatsAppConnectDependencies = {},
): Promise<WhatsAppConnectOutcome> {
  if (actor.systemRole !== "admin") return refused(403, "forbidden");
  if (isStaffPreview(actor)) return refused(403, "preview");

  const now = dependencies.now ?? (() => Date.now());
  const organizationId = actor.organizationId;
  const actorKey = `${organizationId}:${actor.profileId}`;

  // Дешёвые отказы — до чтения привязки и до обращения к WAHA.
  if (request.action === "status") {
    const wait = retryAfter(limits.statusAt.get(actorKey), WHATSAPP_STATUS_MIN_INTERVAL_MS, now());
    if (wait !== null) return refused(429, "rate_limited", wait);
    limits.statusAt.set(actorKey, now());
    return withClient(actor, dependencies, (client) => readStatus(client, actorKey, request.withQr, now));
  }

  const phone = request.action === "code" ? normalizePairingPhone(request.phone) : null;
  if (request.action === "code" && phone === null) return refused(400, "invalid_phone");
  const [lastAt, interval] = request.action === "connect"
    ? [limits.connectAt.get(organizationId), WHATSAPP_CONNECT_MIN_INTERVAL_MS] as const
    : [limits.codeAt.get(organizationId), WHATSAPP_CODE_MIN_INTERVAL_MS] as const;
  const wait = retryAfter(lastAt, interval, now());
  if (wait !== null) return refused(429, "rate_limited", wait);

  // Действия, которые что-то запрашивают у WAHA, идут по одному. Проверка и занятие места — без ожидания
  // между ними, поэтому второй запрос не проскочит; место всегда снимает `finally`.
  if (limits.inFlight.has(organizationId)) return refused(409, "busy");
  limits.inFlight.add(organizationId);
  try {
    return await withClient(actor, dependencies, (client) =>
      request.action === "connect"
        ? connectSession(actor, client, dependencies)
        : pairByCode(actor, client, phone ?? "", dependencies));
  } finally {
    limits.inFlight.delete(organizationId);
  }
}

/** Привязка из Vault и клиент WAHA; нет привязки или сессия не та — «не удалось», WAHA не вызывается. */
async function withClient(
  actor: ActivePlatformActor,
  dependencies: WhatsAppConnectDependencies,
  run: (client: WahaConnectClient) => Promise<WhatsAppConnectOutcome>,
): Promise<WhatsAppConnectOutcome> {
  let client: WahaConnectClient;
  try {
    const runtime = await (dependencies.resolveRuntime ?? defaultResolveRuntime)(actor.organizationId);
    if (runtime.wahaSessionName !== PLATFORM_WAHA_SESSION_NAME) return refused(503, "unavailable");
    client = (dependencies.createClient ?? ((value) => createWahaConnectClient(value, dependencies.clientDependencies)))(runtime);
  } catch {
    return refused(503, "unavailable");
  }
  try {
    return await run(client);
  } catch (error) {
    return failureOutcome(error);
  }
}

/** Состояние, и QR — только администратору, который открыл окно подключения, и только пока сессия ждёт сканирования. */
async function readStatus(
  client: WahaConnectClient,
  actorKey: string,
  withQr: boolean,
  now: () => number,
): Promise<WhatsAppConnectOutcome> {
  const session = await client.getStatus();
  let qr: string | null = null;
  if (withQr && session === "SCAN_QR_CODE" && (limits.windowUntil.get(actorKey) ?? 0) > now()) {
    // Картинка не вышла — состояние всё равно отвечено; следующий опрос возьмёт QR заново.
    qr = await client.fetchQr().catch(() => null);
  }
  return { status: "ok", session, qr, code: null };
}

/**
 * След по нажатию: пишется до обращения к WAHA. Не записался (база недоступна, миграция не
 * применена, вышел срок) — строка журнала приложения вместо записи платформы; подключение это
 * не блокирует. Ничего, кроме короткого кода отказа, из ошибки в журнал не попадает.
 */
async function writeAudit(
  actor: ActivePlatformActor,
  kind: WhatsAppConnectAuditEntry["kind"],
  dependencies: WhatsAppConnectDependencies,
): Promise<void> {
  const entry: WhatsAppConnectAuditEntry = {
    kind,
    organizationId: actor.organizationId,
    actorProfileId: actor.profileId,
    actorMembershipId: actor.membershipId,
    at: new Date((dependencies.now ?? (() => Date.now()))()).toISOString(),
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const write = Promise.resolve().then(() =>
      dependencies.recordAudit
        ? dependencies.recordAudit(entry)
        : recordWhatsAppConnectAudit(entry, dependencies.createAuditClient));
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new WhatsAppAuditError("timeout")), dependencies.auditTimeoutMs ?? WHATSAPP_AUDIT_TIMEOUT_MS);
    });
    await Promise.race([write, expired]);
  } catch (error) {
    try {
      (dependencies.logAuditFallback ?? defaultLogAuditFallback)(entry, auditErrorCode(error));
    } catch {
      // Запасной след тоже не вышел — на подключение это не влияет.
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Нужен запуск (STOPPED) или перезапуск (FAILED); если лимит не пускает — сколько секунд ждать. */
function restartWait(organizationId: string, current: string, now: number): number | null {
  return current === "STOPPED" || current === "FAILED"
    ? retryAfter(limits.restartAt.get(organizationId), WHATSAPP_RESTART_MIN_INTERVAL_MS, now)
    : null;
}

/** Запустить остановленную или перезапустить сломанную сессию; состояние после. Остальные состояния не трогаются. */
async function ensureStarted(
  organizationId: string,
  client: WahaConnectClient,
  current: string,
  now: number,
): Promise<string> {
  if (current !== "STOPPED" && current !== "FAILED") return current;
  limits.restartAt.set(organizationId, now);
  return current === "FAILED" ? client.restart() : client.start();
}

/** «Подключить»: запуск при необходимости, окно QR на 10 минут, один след. */
async function connectSession(
  actor: ActivePlatformActor,
  client: WahaConnectClient,
  dependencies: WhatsAppConnectDependencies,
): Promise<WhatsAppConnectOutcome> {
  const now = dependencies.now ?? (() => Date.now());
  // Метка ставится до чтения состояния: недоступный WAHA тоже не даёт нажимать чаще раза в 10 с.
  limits.connectAt.set(actor.organizationId, now());
  const current = await client.getStatus();
  if (current === "WORKING") return { status: "ok", session: current, qr: null, code: null };
  const limited = restartWait(actor.organizationId, current, now());
  if (limited !== null) return refused(429, "rate_limited", limited);
  await writeAudit(actor, "qr", dependencies);
  const session = await ensureStarted(actor.organizationId, client, current, now());
  limits.windowUntil.set(`${actor.organizationId}:${actor.profileId}`, now() + WHATSAPP_CONNECT_WINDOW_MS);
  return { status: "ok", session, qr: null, code: null };
}

/** «Получить код»: довести сессию до «ждёт сканирования», попросить код у WAHA; номер и код нигде не остаются. */
async function pairByCode(
  actor: ActivePlatformActor,
  client: WahaConnectClient,
  phone: string,
  dependencies: WhatsAppConnectDependencies,
): Promise<WhatsAppConnectOutcome> {
  const now = dependencies.now ?? (() => Date.now());
  const sleep = dependencies.sleep ?? defaultSleep;
  limits.codeAt.set(actor.organizationId, now());
  const current = await client.getStatus();
  if (current === "WORKING") return refused(409, "already_connected");
  const limited = restartWait(actor.organizationId, current, now());
  if (limited !== null) return refused(429, "rate_limited", limited);
  await writeAudit(actor, "code", dependencies);
  let session = await ensureStarted(actor.organizationId, client, current, now());
  const deadline = now() + WHATSAPP_CODE_READY_WAIT_MS;
  while (session !== "SCAN_QR_CODE" && session !== "WORKING" && now() < deadline) {
    await sleep(READY_POLL_MS);
    session = await client.getStatus();
  }
  if (session === "WORKING") return refused(409, "already_connected");
  if (session !== "SCAN_QR_CODE") return refused(409, "session_not_ready");
  limits.windowUntil.set(`${actor.organizationId}:${actor.profileId}`, now() + WHATSAPP_CONNECT_WINDOW_MS);
  return { status: "ok", session, qr: null, code: await client.requestPairingCode(phone) };
}
