// Общие подставки для тестов рантайма ИИ-агентов (tests/ai-agents-runtime|dispatch.test.mjs).
// Это не тест (имя без `.test.`): подставной fetch по форме документации Managed Agents
// (platform.claude.com/docs/en/managed-agents, сверена 22.10.2026) и подставные RPC Supabase.
// Живого Claude API здесь нет; данные синтетические.
import { createHash } from "node:crypto";

import { createAnthropicClient } from "../src/lib/server/ai-agents/anthropic.ts";

export const ORG = "11111111-1111-4111-8111-111111111111";
export const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
export const STAFF_ID = "33333333-3333-4333-8333-333333333333";
export const RUN_ID = "44444444-4444-4444-8444-444444444444";
export const REQ_ID = "55555555-5555-4555-8555-555555555555";
export const DRAFT_ID = "66666666-6666-4666-8666-666666666666";
export const CLAUDE_TEST_KEY = "sk-ant-test-0000000000000000000000";
export const NOW = Date.parse("2026-10-22T12:00:00.000Z");

export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

export function actor(overrides = {}) {
  return {
    authUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    membershipId: ADMIN_ID,
    organizationId: ORG,
    displayName: "Тестовый сотрудник",
    systemRole: "admin",
    platformAccessVersion: 1,
    assignments: [],
    permissionKeys: ["ai.agent.use", "ai.agent.manage"],
    email: "staff@example.test",
    presentationRole: null,
    ...overrides,
  };
}

/**
 * Подставной клиент Supabase: `schema("platform").rpc(name, args)`. Обработчик имени возвращает
 * `{data}` или `{error:{code,message}}`; нет обработчика — как у отсутствующей функции PostgREST.
 */
export function fakeRpc(handlers = {}) {
  const calls = [];
  const client = {
    schema(name) {
      if (name !== "platform") throw new Error(`unexpected schema ${name}`);
      return {
        async rpc(fn, args) {
          calls.push({ fn, args });
          const handler = handlers[fn];
          if (!handler) return { data: null, error: { code: "PGRST202", message: `no function ${fn}` } };
          const result = await handler(args, calls);
          return { data: result?.data ?? null, error: result?.error ?? null };
        },
      };
    },
  };
  const called = (fn) => calls.filter((call) => call.fn === fn);
  return { client, calls, called };
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export { json as jsonResponse };

/**
 * Подставной Claude API: таблица «метод путь» → ответ. Запись вызовов — `calls` с телом и
 * заголовками. Маршрут — функция `(request) => Response | object | {status, body}`.
 */
export function fakeClaude(routes = {}) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init.body ? JSON.parse(init.body) : null;
    const query = Object.fromEntries([...parsed.searchParams.entries()]);
    const queryAll = parsed.searchParams;
    const call = { method, path: parsed.pathname, search: parsed.search, query, queryAll, headers, body, url: String(url) };
    calls.push(call);
    const key = `${method} ${parsed.pathname}`;
    const route = routes[key] ?? Object.entries(routes).find(([pattern]) => {
      const [m, p] = pattern.split(" ");
      if (m !== method || !p.includes(":")) return false;
      const a = p.split("/");
      const b = parsed.pathname.split("/");
      return a.length === b.length && a.every((part, i) => part.startsWith(":") || part === b[i]);
    })?.[1];
    if (!route) return json(404, { type: "error", error: { type: "not_found_error", message: `no route ${key}` } });
    const out = typeof route === "function" ? await route(call) : route;
    if (out instanceof Response) return out;
    if (out && typeof out === "object" && "status" in out && "body" in out) return json(out.status, out.body);
    return json(200, out);
  };
  const callsFor = (method, path) => calls.filter((call) => call.method === method && call.path === path);
  return { fetch: fetchFn, calls, callsFor };
}

export function claudeError(status, type, message) {
  return { status, body: { type: "error", error: { type, message } } };
}

/** Зависимости рантайма: клиент Claude на подставном fetch, сервисный клиент, фиксированное время. */
export function runtimeDeps({ claude, service, env = {}, noKey = false, now = NOW } = {}) {
  const fullEnv = { EVO_ANTHROPIC_API_KEY: CLAUDE_TEST_KEY, EVO_PLATFORM_ORGANIZATION_ID: ORG, ...env };
  const logs = [];
  return {
    deps: {
      env: () => fullEnv,
      anthropic: () => noKey ? null : createAnthropicClient({ fetch: claude.fetch, apiKey: CLAUDE_TEST_KEY, sleep: async () => {} }),
      serviceClient: async () => service.client,
      now: () => (typeof now === "function" ? now() : now),
      randomBytes: (size) => Buffer.alloc(size, 7),
      sleep: async () => {},
      log: (line) => { logs.push(line); },
    },
    logs,
  };
}
