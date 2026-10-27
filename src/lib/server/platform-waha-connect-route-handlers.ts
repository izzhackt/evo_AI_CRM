import "server-only";

import { isStaffPreview, staffCanAccessRoute } from "../platform-access.ts";
import type { ActivePlatformActor, PlatformActorResult } from "../platform-auth.ts";
import { readPlatformWhatsAppTransport } from "../platform-whatsapp-transport.ts";
import {
  WHATSAPP_CONNECT_ACTIONS,
  WHATSAPP_CONNECT_BODY_KEYS,
  WHATSAPP_CONNECT_BODY_LIMIT_BYTES,
  type WhatsAppConnectAction,
} from "../v3/whatsapp-connect-contract.ts";
import { failure, json, readJsonObject, sameOrigin } from "./ai-agent-route-handlers.ts";
import {
  canConnectWhatsApp,
  performWhatsAppConnect,
  type WhatsAppConnectOutcome,
  type WhatsAppConnectRequest,
} from "./platform-waha-connect-service.ts";

/**
 * `POST /api/v3/settings/whatsapp-connect` — «Настройки → Интеграции →
 * Подключение WhatsApp» (решение владельца 20.10.2026).
 *
 * Тело — маленький JSON с точным набором ключей: `{action: "status", withQr?}`,
 * `{action: "connect"}` или `{action: "code", phone}`. Порядок проверок: тот же
 * Origin/Host (403), сессия сотрудника (401), не просмотр роли и только
 * администратор с доступом к «Настройкам» (403), и лишь потом разбор тела и
 * сервис с лимитами и следом. Каждый ответ — `Cache-Control: no-store`
 * (общие заголовки `json`); QR и код в ответе — только вызвавшему их администратору,
 * в журнал и в адрес они не попадают. Номер из тела не читается нигде, кроме
 * вызова WAHA.
 *
 * Пока действующий путь WhatsApp — Wazzup (план Wazzup §8-§9, миграция 325), маршрут отвечает 409 `transport_wazzup`
 * сразу после проверки администратора: до разбора тела, лимитов и любого обращения к WAHA (никаких QR, кодов и
 * перезапусков сессии `crm_primary`). Путь прочитать не удалось - 503 `transport_check_failed`, тоже до WAHA.
 */

type Authorization =
  | Readonly<{ status: "authorized"; actor: ActivePlatformActor }>
  | Readonly<{ status: "anonymous" | "forbidden" | "preview" | "unavailable"; actor: null }>;

export type WhatsAppConnectRouteDependencies = Readonly<{
  authorize(): Promise<Authorization>;
  perform(actor: ActivePlatformActor, request: WhatsAppConnectRequest): Promise<WhatsAppConnectOutcome>;
  /**
   * Действующий путь WhatsApp сейчас (сессией администратора). Не задан - проверки нет: так собраны обработчики в тестах
   * прежних правил; боевой обработчик (`defaultDependencies`) задаёт её всегда.
   */
  transport?(actor: ActivePlatformActor): Promise<"wazzup" | "other" | "unknown">;
}>;

/**
 * Кто может подключать WhatsApp: из результата входа — в решение. Отдельная чистая функция, чтобы
 * правило проверялось тестом, а не только чтением кода: только администратор вне просмотра роли
 * и с доступом к «Настройкам»; держатель `telephony.manage` страницу открывает, подключить не может.
 */
export function whatsappConnectAuthorization(result: PlatformActorResult): Authorization {
  if (result.status === "anonymous") return { status: "anonymous", actor: null };
  if (result.status === "invalid") return { status: "unavailable", actor: null };
  // Просмотр роли — только вид экрана: подключение он не запускает.
  if (isStaffPreview(result.actor)) return { status: "preview", actor: null };
  if (!canConnectWhatsApp(result.actor) || !staffCanAccessRoute(result.actor, "/v3/settings")) {
    return { status: "forbidden", actor: null };
  }
  return { status: "authorized", actor: result.actor };
}

async function defaultAuthorize(): Promise<Authorization> {
  const { resolvePlatformActor } = await import("../platform-auth.ts");
  return whatsappConnectAuthorization(await resolvePlatformActor());
}

async function defaultTransport(actor: ActivePlatformActor): Promise<"wazzup" | "other" | "unknown"> {
  const transport = await readPlatformWhatsAppTransport(actor);
  if (transport === null) return "unknown";
  return transport.activeTransport === "wazzup" ? "wazzup" : "other";
}

const defaultDependencies: WhatsAppConnectRouteDependencies = {
  authorize: defaultAuthorize,
  perform: (actor, request) => performWhatsAppConnect(actor, request),
  transport: defaultTransport,
};

function refusal(status: Exclude<Authorization["status"], "authorized">): Response {
  if (status === "anonymous") return failure(401, "authentication_required");
  if (status === "preview") return failure(403, "preview");
  if (status === "forbidden") return failure(403, "forbidden");
  return failure(503, "unavailable");
}

function isAction(value: unknown): value is WhatsAppConnectAction {
  return typeof value === "string" && (WHATSAPP_CONNECT_ACTIONS as readonly string[]).includes(value);
}

function requestFrom(body: Record<string, unknown>): WhatsAppConnectRequest | null {
  const keys = Object.keys(body);
  if (!isAction(body.action)) return null;
  if (body.action === "status") {
    if (keys.some((key) => key !== "action" && key !== "withQr")) return null;
    if (body.withQr !== undefined && typeof body.withQr !== "boolean") return null;
    return { action: "status", withQr: body.withQr === true };
  }
  if (body.action === "connect") return keys.length === 1 ? { action: "connect" } : null;
  if (keys.some((key) => key !== "action" && key !== "phone")) return null;
  return typeof body.phone === "string" ? { action: "code", phone: body.phone } : null;
}

export function createWhatsAppConnectHandler(dependencies: WhatsAppConnectRouteDependencies = defaultDependencies) {
  return async function POST(request: Request): Promise<Response> {
    try {
      if (!sameOrigin(request)) return failure(403, "forbidden");
      const authorization = await dependencies.authorize();
      if (authorization.status !== "authorized") return refusal(authorization.status);
      if (dependencies.transport !== undefined) {
        const transport = await dependencies.transport(authorization.actor).catch(() => "unknown" as const);
        if (transport === "wazzup") return failure(409, "transport_wazzup");
        if (transport === "unknown") return failure(503, "transport_check_failed");
      }
      const body = await readJsonObject(request, WHATSAPP_CONNECT_BODY_KEYS, WHATSAPP_CONNECT_BODY_LIMIT_BYTES);
      const parsed = body ? requestFrom(body) : null;
      if (!parsed || new URL(request.url).search !== "") return failure(400, "invalid_request");
      const outcome = await dependencies.perform(authorization.actor, parsed);
      if (outcome.status === "ok") return json(200, { status: outcome.session, qr: outcome.qr, code: outcome.code });
      const refused = failure(outcome.http, outcome.code, outcome.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: outcome.retryAfterSeconds });
      if (outcome.retryAfterSeconds !== undefined) refused.headers.set("Retry-After", String(outcome.retryAfterSeconds));
      return refused;
    } catch {
      return failure(503, "unavailable");
    }
  };
}
