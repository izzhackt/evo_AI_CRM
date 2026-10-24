import "server-only";

import { createHash } from "node:crypto";
import { BlockList, isIP } from "node:net";

import {
  AI_AGENT_DIRECTIONS,
  AI_AGENTS_DEFAULT_MCP_IP_ALLOWLIST,
  AI_AGENTS_ENV,
  AI_AGENTS_MCP_IP_HEADER,
  isAiAgentKey,
  type AiAgentDirection,
  type AiAgentKey,
} from "../../ai-agents/contract.ts";

/*
 * MCP-сервер ИИ-агентов, часть «граница доступа» (контракт §B.2): разбор токена,
 * адрес клиента, список разрешённых сетей, ограничители в памяти процесса.
 * Токен хранится в базе только как SHA-256; здесь он нигде не журналируется.
 */

/** 256 бит в base64url без «=» — ровно 43 символа. */
export const MCP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const BEARER_PATTERN = /^Bearer[ \t]+([^\s]+)$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Токен из `Authorization: Bearer …`; null — заголовка нет или форма неверна. */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = BEARER_PATTERN.exec(header.trim());
  if (match === null) return null;
  return MCP_TOKEN_PATTERN.test(match[1]) ? match[1] : null;
}

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/* ------------------------------------------------------------------- принципал */

/** Ответ `platform.ai_agent_mcp_auth_v1` (camelCase): кто вызывает. */
export type AiAgentsMcpPrincipal = Readonly<{
  organizationId: string;
  agentKey: AiAgentKey;
  title: string;
  direction: AiAgentDirection | null;
  enabled: boolean;
  autoSend: boolean;
}>;

export function parseMcpPrincipal(value: unknown): AiAgentsMcpPrincipal | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const organizationId = record.organizationId;
  const agentKey = record.agentKey;
  if (typeof organizationId !== "string" || !UUID_PATTERN.test(organizationId)) return null;
  if (!isAiAgentKey(agentKey)) return null;
  if (typeof record.enabled !== "boolean") return null;
  const direction = record.direction;
  return Object.freeze({
    organizationId,
    agentKey,
    title: typeof record.title === "string" ? record.title.slice(0, 160) : "",
    direction:
      typeof direction === "string" && (AI_AGENT_DIRECTIONS as readonly string[]).includes(direction)
        ? (direction as AiAgentDirection)
        : null,
    enabled: record.enabled,
    autoSend: record.autoSend === true,
  });
}

/* ------------------------------------------------------------- адрес и сети */

/**
 * Приводит адрес к каноническому виду: без скобок, зоны и порта IPv4,
 * `::ffff:a.b.c.d` → `a.b.c.d`, строчные буквы. null — это не IP-адрес.
 */
export function normalizeIpAddress(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim().toLowerCase();
  if (value === "") return null;
  if (value.startsWith("[") && value.includes("]")) value = value.slice(1, value.indexOf("]"));
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(value);
  if (withPort !== null) value = withPort[1];
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped !== null) value = mapped[1];
  return isIP(value) === 0 ? null : value;
}

/**
 * Адрес клиента: заголовок, который ставит edge (`header_up X-Evo-Mcp-Ip
 * {remote_host}` — он заменяет присланный клиентом), иначе последний элемент
 * `X-Forwarded-For` (Caddy перезаписывает его адресом соединения). null —
 * определить не удалось.
 */
export function readClientAddress(headers: Headers): string | null {
  const fromEdge = normalizeIpAddress(headers.get(AI_AGENTS_MCP_IP_HEADER));
  if (fromEdge !== null) return fromEdge;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded === null) return null;
  const parts = forwarded.split(",");
  return normalizeIpAddress(parts[parts.length - 1]);
}

export type AiAgentsMcpIpPolicy =
  | Readonly<{ mode: "off" }>
  | Readonly<{ mode: "list"; entries: number; allows: (address: string) => boolean }>;

/**
 * `EVO_AI_AGENTS_MCP_IP_ALLOWLIST`: CIDR или адреса через запятую; пусто или не
 * задано — `160.79.104.0/21`; `off` — проверка выключена (временный обход).
 * Непонятные элементы пропускаются; если годных не осталось — отказ всем.
 */
export function parseMcpIpPolicy(raw: string | undefined): AiAgentsMcpIpPolicy {
  const configured = typeof raw === "string" ? raw.trim() : "";
  if (configured.toLowerCase() === "off") return Object.freeze({ mode: "off" });
  const source = configured === "" ? AI_AGENTS_DEFAULT_MCP_IP_ALLOWLIST : configured;
  const list = new BlockList();
  let entries = 0;
  for (const element of source.split(/[,\s]+/u)) {
    if (element === "") continue;
    const [addressPart, prefixPart, ...rest] = element.split("/");
    const address = normalizeIpAddress(addressPart);
    if (address === null || rest.length > 0) continue;
    const family = isIP(address) === 6 ? "ipv6" : "ipv4";
    try {
      if (prefixPart === undefined) {
        list.addAddress(address, family);
      } else {
        if (!/^\d{1,3}$/u.test(prefixPart)) continue;
        const prefix = Number(prefixPart);
        if (prefix > (family === "ipv6" ? 128 : 32)) continue;
        list.addSubnet(address, prefix, family);
      }
      entries += 1;
    } catch {
      // Непонятный элемент не должен расширять список.
    }
  }
  return Object.freeze({
    mode: "list",
    entries,
    allows: (address: string): boolean => {
      const normalized = normalizeIpAddress(address);
      if (normalized === null) return false;
      return list.check(normalized, isIP(normalized) === 6 ? "ipv6" : "ipv4");
    },
  });
}

export function readMcpIpPolicy(environment: Readonly<Record<string, string | undefined>>): AiAgentsMcpIpPolicy {
  return parseMcpIpPolicy(environment[AI_AGENTS_ENV.mcpIpAllowlist]);
}

/* ------------------------------------------------------------- ограничители */

const MAX_FAILURES_PER_WINDOW = 20;
const FAILURE_WINDOW_MS = 60_000;
const FAILURE_BLOCK_MS = 60_000;
const MAX_TRACKED_ADDRESSES = 10_000;
const VALID_TOKEN_MEMORY_MS = 10 * 60_000;
const MAX_VALID_TOKENS = 1_000;

/**
 * Неудачные запросы по адресу (нет или неверный токен, чужой IP): больше 20 в
 * минуту — адрес блокируется на минуту (логика `TelephonyFailureLimiter`,
 * скопирована, а не импортирована: у телефонии своя граница). Дополнительно
 * помнит хеши токенов, которые недавно были верны: такой токен проверяется в
 * базе даже с заблокированного адреса (общий исходящий адрес Anthropic не
 * должен глушить настоящего агента чужими ошибками), а неизвестный — отказ без
 * обращения к базе. Истина о токене всегда в базе.
 */
export class AiAgentsMcpFailureLimiter {
  private readonly entries = new Map<string, { windowStart: number; count: number; blockedUntil: number }>();
  private readonly validTokens = new Map<string, number>();
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

  /** Считает одну неудачу; true — ответить 429. */
  recordFailure(address: string): boolean {
    const now = this.now();
    let entry = this.entries.get(address);
    this.entries.delete(address);
    if (
      entry === undefined ||
      (now >= entry.blockedUntil && (entry.blockedUntil !== 0 || now - entry.windowStart >= this.windowMs))
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

  /** Адрес сейчас заблокирован (без учёта новой неудачи). */
  isBlocked(address: string): boolean {
    const entry = this.entries.get(address);
    return entry !== undefined && this.now() < entry.blockedUntil;
  }

  /** Токен с этим хешем недавно прошёл проверку в базе. */
  recentlyValid(tokenSha256: string): boolean {
    const until = this.validTokens.get(tokenSha256);
    return until !== undefined && this.now() < until;
  }

  rememberValid(tokenSha256: string): void {
    this.validTokens.delete(tokenSha256);
    this.validTokens.set(tokenSha256, this.now() + VALID_TOKEN_MEMORY_MS);
    while (this.validTokens.size > MAX_VALID_TOKENS) {
      const oldest = this.validTokens.keys().next();
      if (oldest.done) break;
      this.validTokens.delete(oldest.value);
    }
  }

  /** Для тестов: сколько адресов отслеживается. */
  get size(): number {
    return this.entries.size;
  }
}

const CALL_LIMIT_PER_MINUTE = 120;
const CALL_WINDOW_MS = 60_000;
const MAX_TRACKED_AGENTS = 1_000;

/** Успешные вызовы: не больше 120 `tools/call` в минуту на агента (окно фиксированное). */
export class AiAgentsMcpCallLimiter {
  private readonly entries = new Map<string, { windowStart: number; count: number }>();
  private readonly now: () => number;
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(options: Readonly<{ now?: () => number; limit?: number; windowMs?: number }> = {}) {
    this.now = options.now ?? Date.now;
    this.limit = options.limit ?? CALL_LIMIT_PER_MINUTE;
    this.windowMs = options.windowMs ?? CALL_WINDOW_MS;
  }

  /** true — вызов разрешён и засчитан; false — лимит окна исчерпан. */
  take(key: string): boolean {
    const now = this.now();
    let entry = this.entries.get(key);
    this.entries.delete(key);
    if (entry === undefined || now - entry.windowStart >= this.windowMs) {
      entry = { windowStart: now, count: 0 };
    }
    const allowed = entry.count < this.limit;
    if (allowed) entry.count += 1;
    this.entries.set(key, entry);
    while (this.entries.size > MAX_TRACKED_AGENTS) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return allowed;
  }
}

/* ---------------------------------------------------------------- дедлайны */

export class DeadlineExceeded extends Error {}

/** Ждёт операцию не дольше срока; поздний сбой брошенного вызова не станет необработанным. */
export async function withDeadline<T>(operation: PromiseLike<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = Promise.resolve(operation);
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

/** Миграция 317 не применена: функции в базе нет. */
export function isSchemaMissingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "42883" || code === "PGRST202";
}
