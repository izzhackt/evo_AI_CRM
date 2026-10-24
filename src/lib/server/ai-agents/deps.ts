import "server-only";

import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ActivePlatformActor } from "../../platform-auth.ts";
import type { PlatformProviderRpcClient } from "../../platform-provider-workflows.ts";
import { createAnthropicClient, type AnthropicClient } from "./anthropic.ts";
import { readAnthropicApiKey, readAnthropicBaseUrl, type Env } from "./env.ts";

/*
 * Общие зависимости рантайма ИИ-агентов: окружение, клиент Claude, сервисный
 * клиент Supabase (service_role), время, случайные байты, журнал. Тесты
 * подставляют их частично (`Partial<AiAgentsRuntimeDeps>`).
 */

/** Контекст сотрудника: его серверный клиент Supabase и проверенный актор. */
export type AiAgentsStaffContext = Readonly<{ staffClient: SupabaseClient; actor: ActivePlatformActor }>;

export type ServiceClient = PlatformProviderRpcClient;

export type AiAgentsRuntimeDeps = Readonly<{
  env(): Env;
  /** Клиент Claude API; null — ключ не задан. */
  anthropic(): AnthropicClient | null;
  /** Клиент service_role: RPC `ai_agent_runtime_*` (схема platform). */
  serviceClient(): Promise<ServiceClient>;
  now(): number;
  randomBytes(size: number): Uint8Array;
  sleep(milliseconds: number): Promise<void>;
  /** Одна JSON-строка со счётчиками; без текстов, ключей и данных клиентов. */
  log(line: Readonly<Record<string, unknown>>): void;
}>;

export const defaultRuntimeDeps: AiAgentsRuntimeDeps = Object.freeze({
  env: () => process.env,
  anthropic() {
    const env = process.env;
    const apiKey = readAnthropicApiKey(env);
    if (!apiKey) return null;
    return createAnthropicClient({ fetch: globalThis.fetch.bind(globalThis), apiKey, baseUrl: readAnthropicBaseUrl(env) });
  },
  async serviceClient() {
    // Ленивая загрузка: без ключа и без вызовов Supabase модуль не трогает конфигурацию.
    const [{ getPlatformSupabaseBackendConfig }, { createPlatformSupabaseServiceClient }] = await Promise.all([
      import("../platform-supabase-backend-config.ts"),
      import("../platform-supabase-service-client.ts"),
    ]);
    return createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig()) as unknown as ServiceClient;
  },
  now: () => Date.now(),
  randomBytes: (size: number) => randomBytes(size),
  sleep: (milliseconds: number) => new Promise<void>((resolve) => { setTimeout(resolve, milliseconds); }),
  log(line) {
    const text = JSON.stringify({ event: "ai_agents_runtime", ...line });
    if (line.status === "error") console.warn(text); else console.info(text);
  },
});

export function resolveDeps(overrides?: Partial<AiAgentsRuntimeDeps>): AiAgentsRuntimeDeps {
  return overrides ? Object.freeze({ ...defaultRuntimeDeps, ...overrides }) : defaultRuntimeDeps;
}

/* ------------------------------------------------------------------ RPC */

type RpcPromise = PromiseLike<{ data: unknown; error: unknown }>;
type RpcSurface = Readonly<{ schema: (schema: "platform") => Readonly<{ rpc: (name: string, args?: Record<string, unknown>) => RpcPromise }> }>;

/** Результат RPC без исключения: данные либо код SQLSTATE/PostgREST и сообщение базы (там лежит код ошибки). */
export type RpcOutcome =
  | Readonly<{ ok: true; data: unknown }>
  | Readonly<{ ok: false; code: string; message: string }>;

export async function callRpc(client: unknown, name: string, args: Record<string, unknown>): Promise<RpcOutcome> {
  try {
    const response = await (client as RpcSurface).schema("platform").rpc(name, args);
    if (response && typeof response === "object" && "error" in response && response.error) {
      const error = response.error as { code?: unknown; message?: unknown };
      return {
        ok: false,
        code: typeof error.code === "string" ? error.code : "unknown",
        message: typeof error.message === "string" ? error.message.slice(0, 200) : "",
      };
    }
    return { ok: true, data: (response as { data?: unknown } | null)?.data ?? null };
  } catch {
    return { ok: false, code: "exception", message: "" };
  }
}

/** Сообщение базы содержит код ошибки из контракта (`agent_disabled` и т. п.). */
export function failureHas(outcome: Extract<RpcOutcome, { ok: false }>, token: string): boolean {
  return outcome.message.includes(token);
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const stringOrNull = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

export const numberOr = (value: unknown, fallback: number): number => {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : fallback;
};

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
