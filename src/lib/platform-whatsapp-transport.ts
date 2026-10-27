import type { PlatformActor } from "./platform-auth.ts";

/**
 * Действующий путь WhatsApp для сотрудника (`platform.staff_whatsapp_transport_v1`, миграция 325, право
 * `communication.read.full`): какой путь включён, можно ли отвечать, состояние канала Wazzup. Ключа, адреса вебхука и
 * номера в ответе нет. Здесь только строгий разбор и чтение; решения («закрыть маршрут подключения WAHA», строка в
 * «Настройках») принимают вызывающие. Функция чтения - единственное, что даёт сессии администратора узнать путь
 * (у service_role читающей функции нет), поэтому ответ разбирается по точному набору ключей.
 */

export type PlatformWhatsAppActiveTransport = "none" | "waha" | "wazzup";

export type PlatformWhatsAppTransport = Readonly<{
  activeTransport: PlatformWhatsAppActiveTransport;
  canReply: boolean;
  replyMode: "waha" | "receive_only";
  channel: Readonly<{
    transport: "whatsapp" | "wapi";
    state: string | null;
    observedAt: string | null;
    /** Последние четыре цифры номера канала, если функция чтения их отдаёт (в 325 пока нет: поля нет); весь номер сюда не приходит. */
    last4?: string;
  }> | null;
  lastInboundAt: string | null;
}>;

const KEYS = Object.freeze(["activeTransport", "canReply", "replyMode", "channel", "lastInboundAt"]);
const CHANNEL_KEYS = Object.freeze(["transport", "state", "observedAt"]);
const LAST4 = /^\d{4}$/u;
const STATE_WORD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

function optionalTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined;
}

/** Ответ функции чтения -> разобранный путь, либо null при любом отклонении формы (закрыто по умолчанию). */
export function parsePlatformWhatsAppTransport(value: unknown): PlatformWhatsAppTransport | null {
  if (!isObject(value) || !exactKeys(value, KEYS)) return null;
  const active = value.activeTransport;
  if (active !== "none" && active !== "waha" && active !== "wazzup") return null;
  if (typeof value.canReply !== "boolean") return null;
  if (value.replyMode !== "waha" && value.replyMode !== "receive_only") return null;
  // Согласованность: при Wazzup отвечать из EVO нельзя, и режим - только чтение; иначе - прежний путь WAHA.
  if ((active === "wazzup") !== (value.replyMode === "receive_only") || value.canReply !== (active !== "wazzup")) return null;
  const lastInboundAt = optionalTimestamp(value.lastInboundAt);
  if (lastInboundAt === undefined) return null;
  let channel: PlatformWhatsAppTransport["channel"] = null;
  if (value.channel !== null) {
    // `last4` - необязательный пятый ключ: прежняя форма 325 (три ключа) и форма с четырьмя цифрами годятся, иное - нет.
    const withLast4 = isObject(value.channel) && Object.hasOwn(value.channel, "last4");
    if (!isObject(value.channel) || !exactKeys(value.channel, withLast4 ? [...CHANNEL_KEYS, "last4"] : CHANNEL_KEYS)) return null;
    const last4 = withLast4 ? value.channel.last4 : undefined;
    if (withLast4 && (typeof last4 !== "string" || !LAST4.test(last4))) return null;
    const transport = value.channel.transport;
    const state = value.channel.state;
    const observedAt = optionalTimestamp(value.channel.observedAt);
    if (transport !== "whatsapp" && transport !== "wapi") return null;
    if (state !== null && (typeof state !== "string" || !STATE_WORD.test(state))) return null;
    if (observedAt === undefined) return null;
    channel = Object.freeze(typeof last4 === "string" ? { transport, state, observedAt, last4 } : { transport, state, observedAt });
  }
  return Object.freeze({ activeTransport: active, canReply: value.canReply, replyMode: value.replyMode, channel, lastInboundAt });
}

type RpcClientLike = {
  schema(name: string): {
    rpc(name: string, args: Record<string, unknown>, options?: { get?: boolean }): PromiseLike<{ data: unknown; error: unknown }>;
  };
};

/**
 * Читает действующий путь сессией сотрудника (RLS: только его организация). Null - ответить нельзя (ошибка базы, чужая
 * форма, функции ещё нет); вызывающий решает, закрыто это или открыто.
 */
export async function readPlatformWhatsAppTransport(
  actor: Pick<PlatformActor, "organizationId">,
  injected?: RpcClientLike,
): Promise<PlatformWhatsAppTransport | null> {
  try {
    let client = injected;
    if (client === undefined) {
      if (typeof window !== "undefined") return null;
      // Динамический импорт: чистый разбор выше проверяется в Node без Next; запрос - только сессией сотрудника.
      const { createSupabaseServerClient } = await import("./supabase/server");
      client = (await createSupabaseServerClient()) as unknown as RpcClientLike;
    }
    const response = await client
      .schema("platform")
      .rpc("staff_whatsapp_transport_v1", { p_organization_id: actor.organizationId });
    if (response.error) return null;
    return parsePlatformWhatsAppTransport(response.data);
  } catch {
    return null;
  }
}
