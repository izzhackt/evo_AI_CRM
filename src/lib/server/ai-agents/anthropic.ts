import "server-only";

import { ANTHROPIC_API } from "../../ai-agents/contract.ts";

/*
 * Клиент Claude Managed Agents на `fetch` (контракт §C.1; документация
 * platform.claude.com/docs/en/managed-agents, сверена 22.10.2026). Без SDK.
 * Ключ API не попадает ни в сообщения ошибок, ни в журнал, ни в ответы. Все
 * функции рантайма принимают клиент аргументом — в тестах подставляется `fetch`.
 */

export type AnthropicJson = Record<string, unknown>;

/** Ошибка Claude API: статус HTTP (0 — сети нет), тип из тела ошибки и короткое сообщение. */
export class AnthropicApiError extends Error {
  readonly status: number;
  readonly type: string;

  constructor(status: number, type: string, message: string) {
    super(message);
    this.name = "AnthropicApiError";
    this.status = status;
    this.type = type;
  }
}

export type AnthropicEventsQuery = Readonly<{
  order?: "asc" | "desc";
  limit?: number;
  /** Нижняя граница по `processed_at` включительно (ISO). */
  createdAtGte?: string;
  types?: readonly string[];
  /** Непрозрачный `next_page` прошлого ответа. */
  page?: string;
}>;

export type AnthropicEventsPage = Readonly<{ data: readonly AnthropicJson[]; nextPage: string | null }>;

export type AnthropicClient = Readonly<{
  agents: Readonly<{
    create(body: AnthropicJson): Promise<AnthropicJson>;
    get(agentId: string): Promise<AnthropicJson>;
    update(agentId: string, body: AnthropicJson): Promise<AnthropicJson>;
  }>;
  environments: Readonly<{
    list(): Promise<readonly AnthropicJson[]>;
    create(body: AnthropicJson): Promise<AnthropicJson>;
  }>;
  vaults: Readonly<{
    create(body: AnthropicJson): Promise<AnthropicJson>;
    credentials: Readonly<{
      list(vaultId: string): Promise<readonly AnthropicJson[]>;
      create(vaultId: string, body: AnthropicJson): Promise<AnthropicJson>;
      update(vaultId: string, credentialId: string, body: AnthropicJson): Promise<AnthropicJson>;
      archive(vaultId: string, credentialId: string): Promise<AnthropicJson>;
    }>;
  }>;
  sessions: Readonly<{
    create(body: AnthropicJson): Promise<AnthropicJson>;
    get(sessionId: string): Promise<AnthropicJson>;
    sendEvents(sessionId: string, events: readonly AnthropicJson[]): Promise<AnthropicJson | null>;
    listEvents(sessionId: string, query?: AnthropicEventsQuery): Promise<AnthropicEventsPage>;
  }>;
  deployments: Readonly<{
    create(body: AnthropicJson): Promise<AnthropicJson>;
    update(deploymentId: string, body: AnthropicJson): Promise<AnthropicJson>;
    pause(deploymentId: string): Promise<AnthropicJson>;
    unpause(deploymentId: string): Promise<AnthropicJson>;
  }>;
  deploymentRuns: Readonly<{ list(deploymentId: string, limit?: number): Promise<readonly AnthropicJson[]> }>;
}>;

export type AnthropicClientOptions = Readonly<{
  fetch: typeof fetch;
  apiKey: string;
  baseUrl?: string;
  sleep?: (milliseconds: number) => Promise<void>;
}>;

const REQUEST_TIMEOUT_MS = 20_000;
const SESSION_CREATE_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [400, 1_200] as const;
const MAX_RETRY_AFTER_MS = 5_000;

type RequestOptions = Readonly<{
  query?: readonly (readonly [string, string])[];
  body?: unknown;
  timeoutMs?: number;
  /** Нужен ли `?beta=true` (events, deployments, deployment_runs — как в примерах документации). */
  beta?: boolean;
  /**
   * `all` — повтор при 429, 5xx и сетевой ошибке (чтение, идемпотентные записи);
   * `rate_limit` — только при 429: запрос точно не выполнен, повтор не создаст
   * вторую сессию или второе сообщение.
   */
  retry?: "all" | "rate_limit";
}>;

function summarize(text: string, limit = 300): string {
  const clean = text.replace(/\s+/gu, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

const isRecord = (value: unknown): value is AnthropicJson =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function toApiError(response: Response): Promise<AnthropicApiError> {
  let type = "api_error";
  let message = `Claude API ответил ${response.status}`;
  try {
    const parsed: unknown = JSON.parse(await response.text());
    const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : null;
    if (error && typeof error.type === "string") type = summarize(error.type, 80);
    if (error && typeof error.message === "string" && error.message.trim()) message = summarize(error.message);
  } catch {
    // тело не JSON — остаётся статус
  }
  return new AnthropicApiError(response.status, type, message);
}

export function createAnthropicClient(options: AnthropicClientOptions): AnthropicClient {
  const fetchFn = options.fetch;
  const base = (options.baseUrl ?? ANTHROPIC_API.baseUrl).replace(/\/+$/u, "");
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => { setTimeout(resolve, milliseconds); }));
  const headers = Object.freeze({
    "x-api-key": options.apiKey,
    "anthropic-version": ANTHROPIC_API.version,
    "anthropic-beta": ANTHROPIC_API.betaHeaderValue,
    "content-type": "application/json",
  });

  function buildUrl(path: string, request: RequestOptions): string {
    const pairs: string[] = [];
    if (request.beta) pairs.push("beta=true");
    for (const [name, value] of request.query ?? []) pairs.push(`${name}=${encodeURIComponent(value)}`);
    return `${base}${path}${pairs.length > 0 ? `?${pairs.join("&")}` : ""}`;
  }

  async function call(method: "GET" | "POST", path: string, request: RequestOptions = {}): Promise<unknown> {
    const url = buildUrl(path, request);
    const retryAll = (request.retry ?? "all") === "all";
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await fetchFn(url, {
          method,
          headers,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          signal: AbortSignal.timeout(request.timeoutMs ?? REQUEST_TIMEOUT_MS),
        });
      } catch {
        if (retryAll && attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]!);
          continue;
        }
        throw new AnthropicApiError(0, "network_error", "Нет связи с Claude API");
      }
      if (response.ok) {
        const text = await response.text();
        if (!text.trim()) return null;
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new AnthropicApiError(502, "invalid_response", "Claude API вернул не JSON");
        }
      }
      const retriable = response.status === 429 || (retryAll && response.status >= 500);
      if (retriable && attempt < RETRY_DELAYS_MS.length) {
        const header = Number(response.headers.get("retry-after"));
        const waitMs = Number.isFinite(header) && header > 0 ? Math.min(MAX_RETRY_AFTER_MS, header * 1_000) : 0;
        await sleep(Math.max(RETRY_DELAYS_MS[attempt]!, waitMs));
        continue;
      }
      throw await toApiError(response);
    }
  }

  const object = async (method: "GET" | "POST", path: string, request?: RequestOptions): Promise<AnthropicJson> => {
    const value = await call(method, path, request);
    if (!isRecord(value)) throw new AnthropicApiError(502, "invalid_response", "Claude API вернул неожиданный ответ");
    return value;
  };

  /** Список с постраничным чтением (`next_page` → `page`), не более `maxPages` страниц. */
  async function listAll(path: string, request: RequestOptions, maxPages = 5): Promise<readonly AnthropicJson[]> {
    const items: AnthropicJson[] = [];
    let page: string | null = null;
    for (let index = 0; index < maxPages; index += 1) {
      const query: (readonly [string, string])[] = [...(request.query ?? [])];
      if (page) query.push(["page", page]);
      const value = await object("GET", path, { ...request, query });
      const data = Array.isArray(value.data) ? value.data : [];
      for (const item of data) if (isRecord(item)) items.push(item);
      page = typeof value.next_page === "string" && value.next_page ? value.next_page : null;
      if (!page) break;
    }
    return items;
  }

  const id = encodeURIComponent;

  return Object.freeze({
    agents: Object.freeze({
      create: (body: AnthropicJson) => object("POST", "/v1/agents", { body }),
      get: (agentId: string) => object("GET", `/v1/agents/${id(agentId)}`),
      update: (agentId: string, body: AnthropicJson) => object("POST", `/v1/agents/${id(agentId)}`, { body }),
    }),
    environments: Object.freeze({
      list: () => listAll("/v1/environments", {}),
      create: (body: AnthropicJson) => object("POST", "/v1/environments", { body, retry: "rate_limit" }),
    }),
    vaults: Object.freeze({
      create: (body: AnthropicJson) => object("POST", "/v1/vaults", { body, retry: "rate_limit" }),
      credentials: Object.freeze({
        list: (vaultId: string) => listAll(`/v1/vaults/${id(vaultId)}/credentials`, {}),
        create: (vaultId: string, body: AnthropicJson) =>
          object("POST", `/v1/vaults/${id(vaultId)}/credentials`, { body, retry: "rate_limit" }),
        update: (vaultId: string, credentialId: string, body: AnthropicJson) =>
          object("POST", `/v1/vaults/${id(vaultId)}/credentials/${id(credentialId)}`, { body }),
        archive: (vaultId: string, credentialId: string) =>
          object("POST", `/v1/vaults/${id(vaultId)}/credentials/${id(credentialId)}/archive`),
      }),
    }),
    sessions: Object.freeze({
      create: (body: AnthropicJson) =>
        object("POST", "/v1/sessions", { body, timeoutMs: SESSION_CREATE_TIMEOUT_MS, retry: "rate_limit" }),
      get: (sessionId: string) => object("GET", `/v1/sessions/${id(sessionId)}`),
      sendEvents: (sessionId: string, events: readonly AnthropicJson[]) =>
        call("POST", `/v1/sessions/${id(sessionId)}/events`, { beta: true, body: { events }, retry: "rate_limit" })
          .then((value) => (isRecord(value) ? value : null)),
      async listEvents(sessionId: string, query: AnthropicEventsQuery = {}) {
        const pairs: (readonly [string, string])[] = [];
        if (query.order) pairs.push(["order", query.order]);
        if (query.limit !== undefined) pairs.push(["limit", String(query.limit)]);
        if (query.createdAtGte) pairs.push(["created_at[gte]", query.createdAtGte]);
        for (const type of query.types ?? []) pairs.push(["types[]", type]);
        if (query.page) pairs.push(["page", query.page]);
        const value = await object("GET", `/v1/sessions/${id(sessionId)}/events`, { beta: true, query: pairs });
        const data = (Array.isArray(value.data) ? value.data : []).filter(isRecord);
        const nextPage = typeof value.next_page === "string" && value.next_page ? value.next_page : null;
        return Object.freeze({ data, nextPage });
      },
    }),
    deployments: Object.freeze({
      create: (body: AnthropicJson) => object("POST", "/v1/deployments", { beta: true, body, retry: "rate_limit" }),
      update: (deploymentId: string, body: AnthropicJson) =>
        object("POST", `/v1/deployments/${id(deploymentId)}`, { beta: true, body }),
      pause: (deploymentId: string) => object("POST", `/v1/deployments/${id(deploymentId)}/pause`, { beta: true }),
      unpause: (deploymentId: string) => object("POST", `/v1/deployments/${id(deploymentId)}/unpause`, { beta: true }),
    }),
    deploymentRuns: Object.freeze({
      async list(deploymentId: string, limit = 20) {
        const value = await object("GET", "/v1/deployment_runs", {
          beta: true,
          query: [["deployment_id", deploymentId], ["limit", String(limit)]],
        });
        return (Array.isArray(value.data) ? value.data : []).filter(isRecord);
      },
    }),
  });
}
