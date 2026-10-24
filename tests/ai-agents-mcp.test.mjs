import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AI_AGENT_TOOLS,
  AI_AGENT_TOOL_ERROR_CODES,
  AI_AGENTS_MCP_PROTOCOL_VERSIONS,
  AI_AGENTS_MCP_SERVER_INFO,
} from "../src/lib/ai-agents/contract.ts";
import {
  AiAgentsMcpCallLimiter,
  AiAgentsMcpFailureLimiter,
  normalizeIpAddress,
  parseBearerToken,
  parseMcpIpPolicy,
  readClientAddress,
} from "../src/lib/server/ai-agents/mcp-auth.ts";
import { createAiAgentsMcpHandler } from "../src/lib/server/ai-agents/mcp-server.ts";
import {
  classifyRpcError,
  deterministicRequestId,
  fitToolOutput,
  validateToolArguments,
} from "../src/lib/server/ai-agents/mcp-tools.ts";

// Everything is synthetic: the organization, the token, the ids. No real key,
// person, number or agent code appears in this file.
const ORG = "77300000-0000-4000-8000-000000000001";
const AGENT_USER = "77300000-0000-4000-8000-0000000000a1";
const CONVERSATION = "77300000-0000-4000-8000-0000000000c1";
const DRAFT = "77300000-0000-4000-8000-0000000000d1";
const SENDER = "77300000-0000-4000-8000-0000000000e1";
const TOKEN = randomBytes(32).toString("base64url");
const OTHER_TOKEN = randomBytes(32).toString("base64url");
const URL_ = "http://localhost/api/mcp/v1";
const SECRET_QUERY = "needle-value-that-must-not-reach-the-log";
const SDK_IP = "160.79.104.10";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function environment(overrides = {}) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_mcp_test_key_000000001",
    ...overrides,
  };
}

const PRINCIPAL = {
  organizationId: ORG,
  agentKey: "sales",
  title: "Продажи (Closer)",
  direction: null,
  enabled: true,
  autoSend: false,
};

function harness({
  rpc,
  env = environment(),
  principal = PRINCIPAL,
  sendResult = { status: "sent", failureCode: null },
  sendThrows = false,
  mcpOrigin = () => "https://crm.example.test",
  failureLimiter,
  callLimiter,
  toolDeadlineMs,
  now,
} = {}) {
  const state = { calls: [], logs: [], dispatches: [], schemas: [] };
  const defaultRpc = (name) => {
    if (name === "ai_agent_mcp_auth_v1") return { data: principal, error: null };
    if (name === "ai_agent_mcp_log_v1") return { data: { actionId: 1 }, error: null };
    if (name === "ai_agent_tool_get_my_settings_v1") return { data: { agent_key: "sales", auto_send: false }, error: null };
    return { data: { items: [], next_cursor: null }, error: null };
  };
  const handler = createAiAgentsMcpHandler({
    environment: env,
    log: (entry) => state.logs.push(entry),
    ...(now === undefined ? {} : { now }),
    ...(failureLimiter === undefined ? {} : { failureLimiter }),
    ...(callLimiter === undefined ? {} : { callLimiter }),
    ...(toolDeadlineMs === undefined ? {} : { toolDeadlineMs }),
    mcpOrigin,
    sendWhatsAppDraft: async (input) => {
      state.dispatches.push(input);
      if (sendThrows) throw new Error("boom");
      return sendResult;
    },
    createServiceClient: () => ({
      schema(name) {
        state.schemas.push(name);
        return {
          rpc: (functionName, args) => {
            state.calls.push({ functionName, args });
            return Promise.resolve((rpc ?? defaultRpc)(functionName, args, state));
          },
        };
      },
    }),
  });
  // The token check itself, for tests that only care about tool RPCs.
  const toolCalls = () => state.calls.filter((call) => call.functionName.startsWith("ai_agent_tool_"));
  const logCalls = () => state.calls.filter((call) => call.functionName === "ai_agent_mcp_log_v1");
  return { handler, state, toolCalls, logCalls };
}

// An rpc stub that knows the real token hash and answers tools through `tool`.
function rpcWith(tool, { principal = PRINCIPAL } = {}) {
  return (name, args, state) => {
    if (name === "ai_agent_mcp_auth_v1") {
      return { data: args.p_token_sha256 === sha256(TOKEN) ? principal : null, error: null };
    }
    if (name === "ai_agent_mcp_log_v1") return { data: { actionId: 1 }, error: null };
    return tool(name, args, state);
  };
}

function post(body, { token = TOKEN, ip = SDK_IP, headers = {}, contentType = "application/json", raw = false } = {}) {
  const requestHeaders = { "content-type": contentType, ...headers };
  if (token !== null) requestHeaders.authorization = `Bearer ${token}`;
  if (ip !== null) requestHeaders["x-evo-mcp-ip"] = ip;
  return new Request(URL_, {
    method: "POST",
    headers: requestHeaders,
    body: raw ? body : JSON.stringify(body),
  });
}

function rpcRequest(method, params, id = 1) {
  return { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
}

async function call(handler, body, options) {
  const response = await handler(post(body, options));
  const text = await response.text();
  return { response, text, json: text === "" ? null : JSON.parse(text) };
}

async function toolCall(handler, name, args, options) {
  const { json } = await call(handler, rpcRequest("tools/call", { name, arguments: args }), options);
  assert.ok(json.result, `tools/call ${name} must answer with a result: ${JSON.stringify(json)}`);
  return { result: json.result, body: JSON.parse(json.result.content[0].text) };
}

/* ----------------------------------------------------------------- токен и IP */

test("only POST is served: other methods get 405 with Allow, with no database call", async () => {
  const { handler, state } = harness();
  for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
    const response = await handler(new Request(URL_, { method }));
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("allow"), "POST");
  }
  const head = await handler(new Request(URL_, { method: "HEAD" }));
  assert.equal(head.status, 405);
  assert.equal(state.calls.length, 0);
});

test("a missing, malformed or unknown token is 401 and only the unknown one reaches the database", async () => {
  const { handler, state } = harness({ rpc: rpcWith(() => ({ data: null, error: null })) });
  for (const options of [
    { token: null },
    { token: "short" },
    { token: `${TOKEN}x` },
    { token: null, headers: { authorization: "Basic abc" } },
  ]) {
    const { response, json } = await call(handler, rpcRequest("ping"), options);
    assert.equal(response.status, 401);
    assert.deepEqual(json, { error: "invalid_token" });
    assert.match(response.headers.get("www-authenticate"), /^Bearer realm="evo-crm-agents"$/);
  }
  assert.equal(state.calls.length, 0, "malformed tokens never reach the database");

  const unknown = await call(handler, rpcRequest("ping"), { token: OTHER_TOKEN });
  assert.equal(unknown.response.status, 401);
  assert.deepEqual(state.calls.map((entry) => entry.functionName), ["ai_agent_mcp_auth_v1"]);
  assert.equal(state.calls[0].args.p_token_sha256, sha256(OTHER_TOKEN));
});

test("a valid token reaches the database as a SHA-256 hash, never as the token itself", async () => {
  const { handler, state } = harness({ rpc: rpcWith(() => ({ data: {}, error: null })) });
  const { response, json } = await call(handler, rpcRequest("ping"));
  assert.equal(response.status, 200);
  assert.deepEqual(json, { jsonrpc: "2.0", id: 1, result: {} });
  assert.equal(JSON.stringify(state.calls).includes(TOKEN), false);
  assert.deepEqual(state.schemas.every((name) => name === "platform"), true);
});

test("no Supabase configuration is 503 not_configured; a missing migration is 503 with reason schema_missing", async () => {
  const notConfigured = harness({ env: {} });
  const first = await call(notConfigured.handler, rpcRequest("ping"));
  assert.equal(first.response.status, 503);
  assert.deepEqual(first.json, { error: "not_configured" });
  assert.equal(notConfigured.state.logs.at(-1).reason, "not_configured");

  for (const code of ["42883", "PGRST202"]) {
    const missing = harness({ rpc: () => ({ data: null, error: { code, message: "function does not exist" } }) });
    const { response, json } = await call(missing.handler, rpcRequest("ping"));
    assert.equal(response.status, 503);
    assert.deepEqual(json, { error: "not_configured" });
    assert.equal(missing.state.logs.at(-1).reason, "schema_missing");
  }

  const down = harness({ rpc: () => ({ data: null, error: { code: "08006", message: "connection failure" } }) });
  const unavailable = await call(down.handler, rpcRequest("ping"));
  assert.equal(unavailable.response.status, 503);
  assert.deepEqual(unavailable.json, { error: "unavailable" });
});

test("IP policy: the Anthropic range passes, others are 403, the address is judged after the token", async () => {
  const { handler, state } = harness({ rpc: rpcWith(() => ({ data: {}, error: null })) });
  assert.equal((await call(handler, rpcRequest("ping"), { ip: "160.79.111.255" })).response.status, 200);
  assert.equal((await call(handler, rpcRequest("ping"), { ip: "160.79.104.0" })).response.status, 200);
  for (const ip of ["160.79.112.0", "8.8.8.8", "2001:db8::1"]) {
    const { response, json } = await call(handler, rpcRequest("ping"), { ip });
    assert.equal(response.status, 403, ip);
    assert.deepEqual(json, { error: "ip_not_allowed" });
    assert.equal(state.logs.at(-1).reason, "ip_denied");
  }
  // A foreign address with a wrong token is still a 401: the token comes first.
  const wrongToken = await call(handler, rpcRequest("ping"), { ip: "8.8.8.8", token: OTHER_TOKEN });
  assert.equal(wrongToken.response.status, 401);
});

test("IP policy: an undeterminable address is 403 ip_unknown; 'off' disables the check; custom lists work", async () => {
  const noAddress = harness({ rpc: rpcWith(() => ({ data: {}, error: null })) });
  const unknown = await call(noAddress.handler, rpcRequest("ping"), { ip: null });
  assert.equal(unknown.response.status, 403);
  assert.equal(noAddress.state.logs.at(-1).reason, "ip_unknown");

  const off = harness({ env: environment({ EVO_AI_AGENTS_MCP_IP_ALLOWLIST: "off" }), rpc: rpcWith(() => ({ data: {}, error: null })) });
  assert.equal((await call(off.handler, rpcRequest("ping"), { ip: "8.8.8.8" })).response.status, 200);
  assert.equal((await call(off.handler, rpcRequest("ping"), { ip: null })).response.status, 200);

  const custom = harness({
    env: environment({ EVO_AI_AGENTS_MCP_IP_ALLOWLIST: "203.0.113.0/24, 198.51.100.7, 2001:db8::/32" }),
    rpc: rpcWith(() => ({ data: {}, error: null })),
  });
  assert.equal((await call(custom.handler, rpcRequest("ping"), { ip: "203.0.113.200" })).response.status, 200);
  assert.equal((await call(custom.handler, rpcRequest("ping"), { ip: "198.51.100.7" })).response.status, 200);
  assert.equal((await call(custom.handler, rpcRequest("ping"), { ip: "2001:db8:1::5" })).response.status, 200);
  assert.equal((await call(custom.handler, rpcRequest("ping"), { ip: "160.79.104.10" })).response.status, 403);
});

test("client address: the edge header wins, otherwise the LAST X-Forwarded-For element", () => {
  const forwarded = (value, extra = {}) => new Headers({ "x-forwarded-for": value, ...extra });
  assert.equal(readClientAddress(forwarded("1.2.3.4, 160.79.104.9")), "160.79.104.9");
  assert.equal(readClientAddress(forwarded("160.79.104.9, 1.2.3.4")), "1.2.3.4");
  assert.equal(readClientAddress(forwarded("1.2.3.4", { "x-evo-mcp-ip": "160.79.104.9" })), "160.79.104.9");
  assert.equal(readClientAddress(forwarded("1.2.3.4", { "x-evo-mcp-ip": "not-an-ip" })), "1.2.3.4");
  assert.equal(readClientAddress(new Headers()), null);
  assert.equal(readClientAddress(forwarded("::ffff:160.79.104.9")), "160.79.104.9");
  assert.equal(readClientAddress(forwarded("[2001:db8::1]")), "2001:db8::1");
  assert.equal(readClientAddress(forwarded("garbage")), null);
});

test("X-Forwarded-For is honoured end to end when the edge header is absent", async () => {
  const { handler } = harness({ rpc: rpcWith(() => ({ data: {}, error: null })) });
  const allowed = await call(handler, rpcRequest("ping"), { ip: null, headers: { "x-forwarded-for": "9.9.9.9, 160.79.105.1" } });
  assert.equal(allowed.response.status, 200);
  const denied = await call(handler, rpcRequest("ping"), { ip: null, headers: { "x-forwarded-for": "160.79.105.1, 9.9.9.9" } });
  assert.equal(denied.response.status, 403);
});

test("auth helpers: bearer parsing, address normalisation and allow-list parsing", () => {
  assert.equal(parseBearerToken(`Bearer ${TOKEN}`), TOKEN);
  assert.equal(parseBearerToken(`bearer   ${TOKEN}`), TOKEN);
  assert.equal(parseBearerToken(TOKEN), null);
  assert.equal(parseBearerToken(`Bearer ${TOKEN} extra`), null);
  assert.equal(parseBearerToken(null), null);

  assert.equal(normalizeIpAddress("160.79.104.9:443"), "160.79.104.9");
  assert.equal(normalizeIpAddress("FE80::1%eth0"), "fe80::1");
  assert.equal(normalizeIpAddress("999.1.1.1"), null);

  assert.equal(parseMcpIpPolicy(undefined).mode, "list");
  assert.equal(parseMcpIpPolicy("  OFF ").mode, "off");
  const broken = parseMcpIpPolicy("nonsense, 10.0.0.0/99, 1.2.3.4/8/8");
  assert.equal(broken.mode === "list" && broken.entries, 0);
  assert.equal(broken.mode === "list" && broken.allows("10.0.0.1"), false, "an unusable list denies everyone");
  const mixed = parseMcpIpPolicy("nonsense, 192.0.2.0/24");
  assert.equal(mixed.mode === "list" && mixed.allows("192.0.2.9"), true);
});

/* --------------------------------------------------------------- тело запроса */

test("the body must be JSON and within the size limit", async () => {
  const { handler } = harness({ rpc: rpcWith(() => ({ data: {}, error: null })) });
  const wrongType = await handler(post("{}", { contentType: "text/plain", raw: true }));
  assert.equal(wrongType.status, 415);
  const withCharset = await handler(post(JSON.stringify(rpcRequest("ping")), { contentType: "application/json; charset=utf-8", raw: true }));
  assert.equal(withCharset.status, 200);

  const declared = await handler(post("{}", { raw: true, headers: { "content-length": "300000" } }));
  assert.equal(declared.status, 413);
  const streamed = await handler(post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", pad: "x".repeat(300_000) }), { raw: true }));
  assert.equal(streamed.status, 413);
});

/* ------------------------------------------------------------------ протокол */

test("initialize negotiates the protocol version and describes the server", async () => {
  const { handler } = harness();
  for (const version of AI_AGENTS_MCP_PROTOCOL_VERSIONS) {
    const { json } = await call(handler, rpcRequest("initialize", { protocolVersion: version, capabilities: {}, clientInfo: { name: "t", version: "1" } }));
    assert.equal(json.result.protocolVersion, version);
    assert.deepEqual(json.result.capabilities, { tools: { listChanged: false } });
    assert.deepEqual(json.result.serverInfo, AI_AGENTS_MCP_SERVER_INFO);
    assert.equal(typeof json.result.instructions, "string");
    assert.ok(json.result.instructions.length < 600);
  }
  const unknownVersion = await call(handler, rpcRequest("initialize", { protocolVersion: "1999-01-01" }));
  assert.equal(unknownVersion.json.result.protocolVersion, AI_AGENTS_MCP_PROTOCOL_VERSIONS[0]);
  const noParams = await call(handler, rpcRequest("initialize"));
  assert.equal(noParams.json.result.protocolVersion, AI_AGENTS_MCP_PROTOCOL_VERSIONS[0]);
});

test("tools/list returns exactly the 24 registry tools with their schemas", async () => {
  const { handler } = harness();
  const { response, json } = await call(handler, rpcRequest("tools/list"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const tools = json.result.tools;
  assert.equal(tools.length, 24);
  assert.deepEqual(
    tools.map((tool) => tool.name),
    AI_AGENT_TOOLS.map((tool) => tool.name),
  );
  for (const [index, tool] of tools.entries()) {
    const registry = AI_AGENT_TOOLS[index];
    assert.equal(tool.title, registry.title);
    assert.equal(tool.description, registry.description);
    assert.deepEqual(tool.inputSchema, JSON.parse(JSON.stringify(registry.inputSchema)));
  }
});

test("a disabled agent can still initialize, list tools and ping", async () => {
  const { handler } = harness({ principal: { ...PRINCIPAL, enabled: false } });
  for (const method of ["initialize", "tools/list", "ping"]) {
    const { response, json } = await call(handler, rpcRequest(method));
    assert.equal(response.status, 200, method);
    assert.ok(json.result, method);
  }
});

test("notifications are accepted with 202 and an empty body, and nothing is executed", async () => {
  const { handler, toolCalls } = harness();
  const initialized = await call(handler, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(initialized.response.status, 202);
  assert.equal(initialized.text, "");
  const other = await call(handler, { jsonrpc: "2.0", method: "notifications/whatever", params: {} });
  assert.equal(other.response.status, 202);
  // A tools/call without an id is a notification: it must never run a write.
  const silentCall = await call(handler, { jsonrpc: "2.0", method: "tools/call", params: { name: "get_my_settings", arguments: {} } });
  assert.equal(silentCall.response.status, 202);
  assert.equal(toolCalls().length, 0);
});

test("a batch answers every request in order, skips notifications, and is 202 when only notifications", async () => {
  const { handler } = harness({ rpc: rpcWith(() => ({ data: { agent_key: "sales" }, error: null })) });
  const mixed = await call(handler, [
    rpcRequest("ping", undefined, "a"),
    { jsonrpc: "2.0", method: "notifications/initialized" },
    rpcRequest("tools/call", { name: "get_my_settings", arguments: {} }, 7),
    rpcRequest("nope", undefined, 9),
  ]);
  assert.equal(mixed.response.status, 200);
  assert.deepEqual(mixed.json.map((entry) => entry.id), ["a", 7, 9]);
  assert.deepEqual(mixed.json[0].result, {});
  assert.equal(mixed.json[2].error.code, -32601);

  const silent = await call(handler, [{ jsonrpc: "2.0", method: "notifications/initialized" }]);
  assert.equal(silent.response.status, 202);

  const empty = await call(handler, []);
  assert.equal(empty.json.error.code, -32600);
  const oversized = await call(handler, Array.from({ length: 21 }, (_, index) => rpcRequest("ping", undefined, index)));
  assert.equal(oversized.json.error.code, -32600);
});

test("protocol errors are JSON-RPC errors with HTTP 200", async () => {
  const { handler } = harness();
  const broken = await call(handler, "{not json", { raw: true });
  assert.equal(broken.response.status, 200);
  assert.deepEqual(broken.json, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });

  const shape = await call(handler, { id: 5, method: "ping" });
  assert.equal(shape.json.error.code, -32600);
  const badId = await call(handler, { jsonrpc: "2.0", id: { nested: true }, method: "ping" });
  assert.equal(badId.json.error.code, -32600);
  const scalar = await call(handler, "5", { raw: true });
  assert.equal(scalar.json.error.code, -32600);

  for (const method of ["resources/list", "prompts/list", "completion/complete", "logging/setLevel", "tools/unknown"]) {
    const { response, json } = await call(handler, rpcRequest(method));
    assert.equal(response.status, 200);
    assert.equal(json.error.code, -32601, method);
    assert.equal(json.id, 1);
  }

  const noParams = await call(handler, rpcRequest("tools/call"));
  assert.equal(noParams.json.error.code, -32602);
  const unknownTool = await call(handler, rpcRequest("tools/call", { name: "delete_everything", arguments: {} }));
  assert.equal(unknownTool.json.error.code, -32602);
  const numericName = await call(handler, rpcRequest("tools/call", { name: 5 }));
  assert.equal(numericName.json.error.code, -32602);
});

/* ------------------------------------------------------------------- валидатор */

function schemaOf(name) {
  return AI_AGENT_TOOLS.find((tool) => tool.name === name).inputSchema;
}

test("argument validator: unknown keys, bounds, enums, types, patterns and required fields", () => {
  const leads = schemaOf("list_leads");
  assert.deepEqual(validateToolArguments(leads, {}).value, { state: "open", limit: 20 }, "defaults are filled");
  assert.deepEqual(validateToolArguments(leads, undefined).value, { state: "open", limit: 20 });
  assert.deepEqual(validateToolArguments(leads, { limit: 5, stage: null }).value, { limit: 5, state: "open" }, "null for an optional field means absent");

  const issues = (schema, value) => {
    const result = validateToolArguments(schema, value);
    assert.equal(result.ok, false, JSON.stringify(value));
    return result.issues;
  };
  assert.deepEqual(issues(leads, { surprise: 1 }), [{ path: "surprise", problem: "unknown_property" }]);
  assert.deepEqual(issues(leads, { limit: 101 }), [{ path: "limit", problem: "maximum" }]);
  assert.deepEqual(issues(leads, { limit: 0 }), [{ path: "limit", problem: "minimum" }]);
  assert.deepEqual(issues(leads, { limit: 2.5 }), [{ path: "limit", problem: "type_integer" }]);
  assert.deepEqual(issues(leads, { limit: "5" }), [{ path: "limit", problem: "type_integer" }]);
  assert.deepEqual(issues(leads, { state: "weird" }), [{ path: "state", problem: "enum" }]);
  assert.deepEqual(issues(leads, { created_from: "yesterday" }), [{ path: "created_from", problem: "pattern" }]);
  assert.deepEqual(issues(leads, { owner_id: "not-a-uuid" }), [{ path: "owner_id", problem: "pattern" }]);
  assert.deepEqual(issues(leads, "text"), [{ path: "", problem: "type_object" }]);
  assert.deepEqual(issues(leads, [1]), [{ path: "", problem: "type_object" }]);

  const lead = schemaOf("get_lead");
  assert.deepEqual(issues(lead, {}), [{ path: "lead_id", problem: "required" }]);
  assert.deepEqual(issues(lead, { lead_id: null }), [{ path: "lead_id", problem: "type_string" }]);

  const search = schemaOf("search_clients");
  assert.deepEqual(issues(search, { query: "a" }), [{ path: "query", problem: "min_length" }]);
  assert.deepEqual(issues(search, { query: "ok".repeat(41) }), [{ path: "query", problem: "max_length" }]);
  assert.deepEqual(issues(search, { query: "ab\u0000cd" }), [{ path: "query", problem: "invalid_char" }]);

  const getCase = schemaOf("get_case");
  const caseId = "77300000-0000-4000-8000-0000000000f1";
  assert.equal(validateToolArguments(getCase, { case_id: caseId, include: ["documents", "tasks"] }).ok, true);
  assert.deepEqual(issues(getCase, { case_id: caseId, include: ["documents", "secrets"] }), [{ path: "include.1", problem: "enum" }]);
  assert.deepEqual(issues(getCase, { case_id: caseId, include: [] }), [{ path: "include", problem: "min_items" }]);
  assert.deepEqual(issues(getCase, { case_id: caseId, include: "documents" }), [{ path: "include", problem: "type_array" }]);

  const digest = schemaOf("post_digest");
  assert.equal(validateToolArguments(digest, { kind: "weekly", title: "t", body_md: "b", metrics: { kpis: [{ label: "x", value: 1 }] } }).ok, true);
  assert.deepEqual(issues(digest, { kind: "weekly", title: "t", body_md: "b", metrics: "no" }), [{ path: "metrics", problem: "type_object" }]);
  assert.deepEqual(issues(digest, { kind: "weekly", title: "t", body_md: "b", metrics: { deep: "a\u0000b" } }), [{ path: "metrics", problem: "invalid_content" }]);

  // Code points are counted, not UTF-16 units: 2 emoji fit a 2-character limit.
  assert.equal(validateToolArguments(search, { query: "😀😀" }).ok, true);
});

test("the validator never echoes values into its issues", () => {
  const result = validateToolArguments(schemaOf("search_clients"), { query: SECRET_QUERY.repeat(10), extra: SECRET_QUERY });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result.issues).includes(SECRET_QUERY), false);
});

test("a polluting __proto__ key does not change the prototype of the validated arguments", () => {
  const payload = JSON.parse('{"__proto__": {"polluted": true}}');
  const result = validateToolArguments(schemaOf("get_my_settings"), payload);
  assert.equal(result.ok, false);
  assert.equal({}.polluted, undefined);
});

/* ---------------------------------------------------------------- tools/call */

test("tools/call: success returns the database value as JSON text and logs the action", async () => {
  const data = { items: [{ client_id: AGENT_USER, name: "Тест Клиент" }], next_cursor: null };
  const { handler, toolCalls, logCalls } = harness({ rpc: rpcWith(() => ({ data, error: null })) });
  const { result, body } = await toolCall(handler, "search_clients", { query: SECRET_QUERY });
  assert.equal(result.isError, false);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  assert.deepEqual(body, data);

  assert.equal(toolCalls().length, 1);
  assert.equal(toolCalls()[0].functionName, "ai_agent_tool_search_clients_v1");
  assert.deepEqual(toolCalls()[0].args, {
    p_organization_id: ORG,
    p_agent_key: "sales",
    p_args: { query: SECRET_QUERY, limit: 20 },
  });
  assert.equal(logCalls().length, 1);
  const logged = logCalls()[0].args;
  assert.equal(logged.p_tool, "search_clients");
  assert.equal(logged.p_status, "ok");
  assert.equal(logged.p_error_code, null);
  assert.equal(logged.p_agent_key, "sales");
  assert.equal(Number.isInteger(logged.p_duration_ms), true);
});

test("tools/call: invalid arguments never reach the tool and list fields without values", async () => {
  const { handler, toolCalls, logCalls } = harness();
  const { result, body } = await toolCall(handler, "search_clients", { query: SECRET_QUERY, limit: 1000, rogue: SECRET_QUERY });
  assert.equal(result.isError, true);
  assert.equal(body.error_code, "invalid_arguments");
  assert.deepEqual(
    body.fields.map((field) => field.path).sort(),
    ["limit", "rogue"],
  );
  assert.equal(JSON.stringify(body).includes(SECRET_QUERY), false);
  assert.equal(toolCalls().length, 0);
  // The log row keeps the keys but no values from invalid input.
  assert.deepEqual(logCalls()[0].args.p_args, { query: null, limit: null, rogue: null });
  assert.equal(logCalls()[0].args.p_error_code, "invalid_arguments");
  assert.equal(logCalls()[0].args.p_status, "error");
});

test("tools/call: Postgres and PostgREST errors map to tool error codes (contract table B.4)", async () => {
  const cases = [
    [{ code: "55000", message: "agent_disabled" }, "agent_disabled"],
    [{ code: "55000", message: "whatsapp_unavailable" }, "whatsapp_unavailable"],
    [{ code: "55000", message: "conversation_moved_on" }, "conversation_moved_on"],
    [{ code: "55000", message: "no_inbound_message" }, "no_inbound_message"],
    [{ code: "P0002", message: "target_not_found" }, "target_not_found"],
    [{ code: "22023", message: "invalid_arguments" }, "invalid_arguments"],
    [{ code: "22023", message: "something odd" }, "invalid_arguments"],
    [{ code: "42501", message: "forbidden" }, "forbidden"],
    [{ code: "42501", message: "permission denied for table x" }, "forbidden"],
    [{ code: "P0002", message: "no data found" }, "not_found"],
    [{ code: "55000", message: "ai_agent_responsible_missing" }, "conflict"],
    [{ code: "54000", message: "limit" }, "rate_limited"],
    [{ code: "54001", message: "big" }, "too_large"],
    [{ code: "40001", message: "serialization" }, "unavailable"],
    [{ code: "40P01", message: "deadlock" }, "unavailable"],
    [{ code: "", message: "TypeError: fetch failed" }, "unavailable"],
    [{ code: "PGRST000", message: "no connection" }, "unavailable"],
    [{ code: "57014", message: "canceling statement due to statement timeout" }, "unavailable"],
    [{ code: "XX000", message: "relation \"secret_table\" is broken" }, "internal_error"],
  ];
  for (const [error, expected] of cases) {
    const { handler } = harness({ rpc: rpcWith(() => ({ data: null, error })) });
    const { result, body } = await toolCall(handler, "list_staff", {});
    assert.equal(result.isError, true, JSON.stringify(error));
    assert.equal(body.error_code, expected, JSON.stringify(error));
    assert.ok(AI_AGENT_TOOL_ERROR_CODES.includes(body.error_code));
    assert.equal(typeof body.message, "string");
    assert.equal(JSON.stringify(body).includes("secret_table"), false, "internal details are not leaked");
  }
  assert.deepEqual(classifyRpcError({ code: "55000", message: "ai_agent_responsible_missing" }), {
    code: "conflict",
    detail: "ai_agent_responsible_missing",
  });
  assert.equal(classifyRpcError(null).code, "unavailable");
});

test("tools/call: a status line is 'denied' for forbidden and 'error' for the rest", async () => {
  const forbidden = harness({ rpc: rpcWith(() => ({ data: null, error: { code: "42501", message: "forbidden" } })) });
  await toolCall(forbidden.handler, "list_staff", {});
  assert.equal(forbidden.logCalls()[0].args.p_status, "denied");
  const broken = harness({ rpc: rpcWith(() => ({ data: null, error: { code: "XX000", message: "x" } })) });
  await toolCall(broken.handler, "list_staff", {});
  assert.equal(broken.logCalls()[0].args.p_status, "error");
  assert.equal(broken.logCalls()[0].args.p_error_code, "internal_error");
});

test("tools/call: a hung or throwing database call becomes 'unavailable'", async () => {
  const hung = harness({ rpc: rpcWith(() => new Promise(() => undefined)), toolDeadlineMs: 25 });
  const { body } = await toolCall(hung.handler, "list_staff", {});
  assert.equal(body.error_code, "unavailable");

  const throwing = harness({ rpc: rpcWith(() => { throw new Error("network down"); }) });
  const second = await toolCall(throwing.handler, "list_staff", {});
  assert.equal(second.body.error_code, "unavailable");
});

test("tools/call: a null result from the database is an internal error", async () => {
  const { handler } = harness({ rpc: rpcWith(() => ({ data: null, error: null })) });
  const { body } = await toolCall(handler, "list_staff", {});
  assert.equal(body.error_code, "internal_error");
});

test("tools/call: a disabled agent gets agent_disabled except for get_my_settings", async () => {
  const principal = { ...PRINCIPAL, enabled: false };
  const { handler, toolCalls, logCalls } = harness({ principal, rpc: rpcWith(() => ({ data: { agent_key: "sales", enabled: false }, error: null }), { principal }) });
  const refused = await toolCall(handler, "search_clients", { query: "ab" });
  assert.equal(refused.result.isError, true);
  assert.equal(refused.body.error_code, "agent_disabled");
  assert.equal(toolCalls().length, 0, "the tool function is not called for a disabled agent");
  assert.equal(logCalls().at(-1).args.p_status, "denied");

  const settings = await toolCall(handler, "get_my_settings", {});
  assert.equal(settings.result.isError, false);
  assert.equal(toolCalls()[0].functionName, "ai_agent_tool_get_my_settings_v1");
});

test("tools/call: a big answer is cut at the longest root array, never mid-string, and the cursor is dropped", async () => {
  const items = Array.from({ length: 100 }, (_, index) => ({ id: index, note: "я".repeat(2_000) }));
  const { handler } = harness({ rpc: rpcWith(() => ({ data: { items, next_cursor: "abc", total: 100 }, error: null })) });
  const { result, body } = await toolCall(handler, "list_leads", {});
  assert.equal(result.isError, false);
  assert.ok(result.content[0].text.length <= 80_000);
  assert.equal(body.truncated, true);
  assert.ok(body.items.length > 0 && body.items.length < 100);
  assert.equal(body.returned_items, body.items.length);
  assert.equal(body.dropped_items, 100 - body.items.length);
  assert.equal(body.next_cursor, null, "a cursor past dropped rows would skip them");
  assert.equal(body.total, 100);
  assert.equal(typeof body.hint, "string");
  assert.deepEqual(body.items, items.slice(0, body.items.length));
});

test("fitToolOutput: small values pass through; root arrays are wrapped; hopeless ones are refused", () => {
  const small = { items: [1, 2], next_cursor: "x" };
  assert.deepEqual(fitToolOutput(small, 1000), { text: JSON.stringify(small), truncated: false });

  const wrapped = fitToolOutput(Array.from({ length: 50 }, (_, index) => ({ index, text: "x".repeat(100) })), 1500);
  assert.ok(wrapped !== null && wrapped.truncated);
  assert.ok(wrapped.text.length <= 1500);
  assert.ok(Array.isArray(JSON.parse(wrapped.text).items));

  assert.equal(fitToolOutput({ blob: "z".repeat(5000) }, 1000), null, "no array to cut");
  assert.equal(fitToolOutput({ items: [{ a: "z".repeat(5000) }] }, 100), null, "even an empty list does not fit");
  assert.equal(fitToolOutput("z".repeat(5000), 1000), null);
});

test("tools/call: an answer that cannot be shortened is a too_large error", async () => {
  const { handler } = harness({ rpc: rpcWith(() => ({ data: { description: "z".repeat(90_000) }, error: null })) });
  const { result, body } = await toolCall(handler, "get_lead", { lead_id: AGENT_USER });
  assert.equal(result.isError, true);
  assert.equal(body.error_code, "too_large");
});

test("tools/call: the action log failing does not change the answer", async () => {
  const { handler, state } = harness({
    rpc: (name) => {
      if (name === "ai_agent_mcp_auth_v1") return { data: PRINCIPAL, error: null };
      if (name === "ai_agent_mcp_log_v1") return { data: null, error: { code: "XX000", message: "log is down" } };
      return { data: { items: [] }, error: null };
    },
  });
  const { result, body } = await toolCall(handler, "list_staff", {});
  assert.equal(result.isError, false);
  assert.deepEqual(body, { items: [] });
  assert.ok(state.logs.some((entry) => entry.reason === "action_log_failed" && entry.tool === "list_staff"));
});

test("tools/call: the authority code reaches the tool but never the action log", async () => {
  const code = "authority-code-value";
  const { handler, toolCalls, logCalls } = harness({
    rpc: rpcWith(() => ({ data: { status: "draft_created", mode: "draft", draft_id: DRAFT }, error: null })),
  });
  await toolCall(handler, "send_message", { channel: "whatsapp", conversation_id: CONVERSATION, text: "Здравствуйте", authority_code: code });
  assert.equal(toolCalls()[0].args.p_args.authority_code, code);
  assert.equal(JSON.stringify(logCalls()[0].args).includes(code), false);
  assert.equal(logCalls()[0].args.p_args.authority_code, "<redacted>");
});

/* --------------------------------------------------------------- send_message */

const SEND_ARGS = { channel: "whatsapp", conversation_id: CONVERSATION, text: "Здравствуйте, это EVO." };
const NEEDS_DISPATCH = { status: "needs_dispatch", mode: "direct", draft_id: DRAFT, sender_membership_id: SENDER };

test("send_message: draft_created and sent from the database pass through untouched", async () => {
  for (const data of [
    { status: "draft_created", mode: "draft", draft_id: DRAFT, hint: "Ждёт одобрения сотрудника в CRM" },
    { status: "sent", mode: "direct", draft_id: DRAFT, message_id: "m-1" },
  ]) {
    const { handler, state } = harness({ rpc: rpcWith(() => ({ data, error: null })) });
    const { result, body } = await toolCall(handler, "send_message", SEND_ARGS);
    assert.equal(result.isError, false);
    assert.deepEqual(body, data);
    assert.equal(state.dispatches.length, 0);
  }
});

test("send_message: needs_dispatch → WhatsApp send → sent", async () => {
  const { handler, state, logCalls } = harness({ rpc: rpcWith(() => ({ data: NEEDS_DISPATCH, error: null })), sendResult: { status: "sent", failureCode: null } });
  const { result, body } = await toolCall(handler, "send_message", SEND_ARGS);
  assert.equal(result.isError, false);
  assert.deepEqual(body, { status: "sent", mode: "direct", draft_id: DRAFT });
  assert.equal(state.dispatches.length, 1);
  assert.deepEqual(
    { ...state.dispatches[0], requestId: "<id>" },
    { organizationId: ORG, draftId: DRAFT, senderMembershipId: SENDER, requestId: "<id>" },
  );
  assert.match(state.dispatches[0].requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(state.dispatches[0].requestId, deterministicRequestId(`${ORG}:${DRAFT}`));
  assert.equal(logCalls()[0].args.p_status, "ok", "the action is logged after orchestration");

  // A repeated tool call dispatches with the same request id (the database replays).
  await toolCall(handler, "send_message", SEND_ARGS);
  assert.equal(state.dispatches[1].requestId, state.dispatches[0].requestId);
});

test("send_message: an unknown send outcome is queued_unknown and not an error", async () => {
  const { handler } = harness({ rpc: rpcWith(() => ({ data: NEEDS_DISPATCH, error: null })), sendResult: { status: "unknown", failureCode: "unknown_result" } });
  const { result, body } = await toolCall(handler, "send_message", SEND_ARGS);
  assert.equal(result.isError, false);
  assert.equal(body.status, "queued_unknown");
  assert.equal(body.draft_id, DRAFT);
  assert.equal(body.hint, "Итог отправки неизвестен — сотрудник проверит чат");
});

test("send_message: whatsapp_unavailable, rate_limited and staff_active leave a draft for staff", async () => {
  for (const failureCode of ["whatsapp_unavailable", "rate_limited", "staff_active"]) {
    const { handler } = harness({ rpc: rpcWith(() => ({ data: NEEDS_DISPATCH, error: null })), sendResult: { status: "failed", failureCode } });
    const { result, body } = await toolCall(handler, "send_message", SEND_ARGS);
    assert.equal(result.isError, false, failureCode);
    assert.equal(body.status, "draft_created");
    assert.equal(body.mode, "draft");
    assert.equal(body.draft_id, DRAFT);
    assert.equal(body.failure_code, failureCode);
    assert.equal(typeof body.hint, "string");
  }
});

test("send_message: moved_on and closed become tool errors with that code; anything else is unavailable", async () => {
  for (const [failureCode, expected] of [
    ["conversation_moved_on", "conversation_moved_on"],
    ["conversation_closed", "conversation_closed"],
    ["provider_error", "unavailable"],
    ["unavailable", "unavailable"],
    ["unknown_result", "unavailable"],
  ]) {
    const { handler, logCalls } = harness({ rpc: rpcWith(() => ({ data: NEEDS_DISPATCH, error: null })), sendResult: { status: "failed", failureCode } });
    const { result, body } = await toolCall(handler, "send_message", SEND_ARGS);
    assert.equal(result.isError, true, failureCode);
    assert.equal(body.error_code, expected, failureCode);
    assert.equal(logCalls()[0].args.p_status, "error");
  }
  const throwing = harness({ rpc: rpcWith(() => ({ data: NEEDS_DISPATCH, error: null })), sendThrows: true });
  const { body } = await toolCall(throwing.handler, "send_message", SEND_ARGS);
  assert.equal(body.error_code, "unavailable");

  const malformed = harness({ rpc: rpcWith(() => ({ data: { status: "needs_dispatch", draft_id: "x" }, error: null })) });
  assert.equal((await toolCall(malformed.handler, "send_message", SEND_ARGS)).body.error_code, "internal_error");
});

/* --------------------------------------------------------- get_document_file */

test("get_document_file: builds a one-time link on the MCP origin and returns no file bytes", async () => {
  const fileToken = randomBytes(32).toString("base64url");
  const data = { token: fileToken, file_name: "scan.pdf", mime_type: "application/pdf", byte_size: 12345, expires_in_seconds: 600 };
  const { handler, toolCalls } = harness({ rpc: rpcWith(() => ({ data, error: null })) });
  const versionId = "77300000-0000-4000-8000-0000000000b1";
  const { result, body } = await toolCall(handler, "get_document_file", { document_version_id: versionId });
  assert.equal(result.isError, false);
  const url = `https://crm.example.test/api/mcp/v1/files/${fileToken}`;
  assert.equal(body.url, url);
  assert.equal(body.file_name, "scan.pdf");
  assert.equal(body.mime_type, "application/pdf");
  assert.equal(body.byte_size, 12345);
  assert.equal(body.expires_in_seconds, 600);
  assert.equal(body.how, `curl -sS -o file '${url}' в песочнице, затем читайте файл`);
  assert.equal("token" in body, false);
  assert.deepEqual(toolCalls()[0].args.p_args, { document_version_id: versionId });
});

test("get_document_file: a malformed token is an internal error and an unusable origin is 'unavailable'", async () => {
  const bad = harness({ rpc: rpcWith(() => ({ data: { token: "short" }, error: null })) });
  const versionId = "77300000-0000-4000-8000-0000000000b1";
  assert.equal((await toolCall(bad.handler, "get_document_file", { document_version_id: versionId })).body.error_code, "internal_error");

  const fileToken = randomBytes(32).toString("base64url");
  const noOrigin = harness({
    rpc: rpcWith(() => ({ data: { token: fileToken, file_name: "a.pdf", mime_type: "application/pdf", byte_size: 1 }, error: null })),
    mcpOrigin: () => { throw new Error("ai_agents_mcp_url_invalid"); },
  });
  assert.equal((await toolCall(noOrigin.handler, "get_document_file", { document_version_id: versionId })).body.error_code, "unavailable");
});

/* ------------------------------------------------------------- ограничители */

test("failed requests from one address are limited to 20 a minute, then 429 with no database call", async () => {
  let clock = 1_000_000;
  const failureLimiter = new AiAgentsMcpFailureLimiter({ now: () => clock });
  const { handler, state } = harness({ failureLimiter, now: () => clock, rpc: rpcWith(() => ({ data: {}, error: null })) });
  const statuses = [];
  for (let attempt = 0; attempt < 22; attempt += 1) {
    const response = await handler(post(rpcRequest("ping"), { token: OTHER_TOKEN, ip: "198.51.100.9" }));
    statuses.push(response.status);
  }
  assert.deepEqual(new Set(statuses.slice(0, 20)), new Set([401]));
  assert.deepEqual(statuses.slice(20), [429, 429]);
  const lookupCount = () => state.calls.filter((entry) => entry.functionName === "ai_agent_mcp_auth_v1").length;
  assert.equal(lookupCount(), 21, "the 21st failure is what blocks the address");

  const limited = await handler(post(rpcRequest("ping"), { token: OTHER_TOKEN, ip: "198.51.100.9" }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal(lookupCount(), 21, "a blocked address with a never-valid token does not touch the database");

  clock += 61_000;
  assert.equal((await handler(post(rpcRequest("ping"), { token: OTHER_TOKEN, ip: "198.51.100.9" }))).status, 401, "the block lasts a minute");
});

test("a token that was valid keeps working from an address that is blocked by other people's failures", async () => {
  let clock = 1_000_000;
  const failureLimiter = new AiAgentsMcpFailureLimiter({ now: () => clock });
  const { handler } = harness({ failureLimiter, now: () => clock, rpc: rpcWith(() => ({ data: {}, error: null })) });
  assert.equal((await handler(post(rpcRequest("ping"), { ip: SDK_IP }))).status, 200);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await handler(post(rpcRequest("ping"), { token: OTHER_TOKEN, ip: SDK_IP }));
  }
  assert.equal(failureLimiter.isBlocked(SDK_IP), true);
  assert.equal((await handler(post(rpcRequest("ping"), { token: OTHER_TOKEN, ip: SDK_IP }))).status, 429);
  assert.equal((await handler(post(rpcRequest("ping"), { ip: SDK_IP }))).status, 200, "the real agent is not shut out");
});

test("a foreign IP with a valid token counts as a failure for the limiter", async () => {
  const failureLimiter = new AiAgentsMcpFailureLimiter({ limit: 2 });
  const { handler } = harness({ failureLimiter, rpc: rpcWith(() => ({ data: {}, error: null })) });
  const statuses = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    statuses.push((await handler(post(rpcRequest("ping"), { ip: "198.51.100.77" }))).status);
  }
  assert.deepEqual(statuses, [403, 403, 429, 429]);
});

test("tools/call is limited per agent; the refused call is not written to the action log", async () => {
  const callLimiter = new AiAgentsMcpCallLimiter({ limit: 3 });
  const { handler, logCalls } = harness({ callLimiter, rpc: rpcWith(() => ({ data: { items: [] }, error: null })) });
  const outcomes = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { result, body } = await toolCall(handler, "list_staff", {});
    outcomes.push(result.isError ? body.error_code : "ok");
  }
  assert.deepEqual(outcomes, ["ok", "ok", "ok", "rate_limited", "rate_limited"]);
  assert.equal(logCalls().length, 3);

  let clock = 0;
  const windowed = new AiAgentsMcpCallLimiter({ limit: 1, windowMs: 1000, now: () => clock });
  assert.equal(windowed.take("a"), true);
  assert.equal(windowed.take("a"), false);
  assert.equal(windowed.take("b"), true, "agents are counted separately");
  clock = 1001;
  assert.equal(windowed.take("a"), true, "the window rolls over");
});

/* ------------------------------------------------------------------- журнал */

test("the application log has counters only: no token, arguments, address or tool data", async () => {
  const { handler, state } = harness({
    rpc: rpcWith(() => ({ data: { items: [{ name: "Секретное Имя" }], next_cursor: null }, error: null })),
  });
  await call(handler, rpcRequest("initialize", { protocolVersion: "2025-06-18" }));
  await toolCall(handler, "search_clients", { query: SECRET_QUERY });
  await toolCall(handler, "search_clients", { query: SECRET_QUERY, rogue: 1 });
  await call(handler, rpcRequest("ping"), { token: OTHER_TOKEN, ip: "198.51.100.5" });
  await call(handler, rpcRequest("ping"), { ip: "8.8.8.8" });
  await handler(new Request(URL_, { method: "GET" }));

  assert.ok(state.logs.length >= 6);
  const serialized = JSON.stringify(state.logs);
  for (const secret of [TOKEN, OTHER_TOKEN, SECRET_QUERY, "Секретное Имя", "198.51.100.5", "8.8.8.8", SDK_IP, ORG]) {
    assert.equal(serialized.includes(secret), false, `the log must not contain ${secret.slice(0, 12)}…`);
  }
  for (const entry of state.logs) {
    assert.equal(entry.event, "ai_agents_mcp");
    assert.equal(typeof entry.status, "number");
    assert.equal(typeof entry.reason, "string");
    assert.equal(typeof entry.duration_ms, "number");
  }
  const toolEntry = state.logs.find((entry) => entry.method === "tools/call" && entry.reason === "ok");
  assert.equal(toolEntry.tool, "search_clients");
  assert.equal(toolEntry.agent, "sales");
  const failed = state.logs.find((entry) => entry.reason === "tool_error");
  assert.equal(failed.error_code, "invalid_arguments");
});

test("a throwing logger or an unexpected failure never breaks the answer", async () => {
  const handler = createAiAgentsMcpHandler({
    environment: environment(),
    log: () => { throw new Error("log sink down"); },
    createServiceClient: () => ({
      schema: () => ({ rpc: (name) => Promise.resolve(name === "ai_agent_mcp_auth_v1" ? { data: PRINCIPAL, error: null } : { data: {}, error: null }) }),
    }),
  });
  const response = await handler(post(rpcRequest("ping")));
  assert.equal(response.status, 200);

  const exploding = createAiAgentsMcpHandler({
    environment: environment(),
    log: () => undefined,
    createServiceClient: () => { throw new Error("client factory exploded"); },
  });
  const failed = await exploding(post(rpcRequest("ping")));
  assert.equal(failed.status, 500);
  assert.equal((await failed.json()).error.code, -32603);
});

/* ------------------------------------------------------------------- edge */

test("the edge Caddyfile overwrites X-Evo-Mcp-Ip for the CRM host and keeps the MCP path public", () => {
  const caddyfile = readFileSync(new URL("../agent-lead2-inbox/deploy/Caddyfile.evo-edge", import.meta.url), "utf8");
  const block = caddyfile.slice(caddyfile.indexOf("crm.evoadmissions.com, app.evoadmissions.com {"));
  const crmBlock = block.slice(0, block.indexOf("\n}\n") + 3);
  assert.match(crmBlock, /reverse_proxy evo-crm-app:3000 \{\s*header_up X-Evo-Mcp-Ip \{remote_host\}\s*\}/u);
  assert.equal(/api\/mcp/u.test(caddyfile), false, "the MCP path must not be listed as private (404)");
});

/* ------------------------------------------- аудит 24.10.2026, пункт 4: версии протокола */

test("версии протокола: 2025-11-25 — новейшая, остальные прежние; initialize на неизвестную версию отвечает новейшей", async () => {
  assert.deepEqual([...AI_AGENTS_MCP_PROTOCOL_VERSIONS], ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
  const { handler } = harness();
  const newest = await call(handler, rpcRequest("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } }));
  assert.equal(newest.json.result.protocolVersion, "2025-11-25");
  const unknown = await call(handler, rpcRequest("initialize", { protocolVersion: "2026-07-28" }));
  assert.equal(unknown.json.result.protocolVersion, "2025-11-25", "2026-07-28 не поддерживается: клиент получает нашу новейшую версию");
});

test("MCP-Protocol-Version: известная версия или отсутствие заголовка — запрос обслуживается", async () => {
  const { handler } = harness({ rpc: rpcWith(() => ({ data: {}, error: null })) });
  for (const version of AI_AGENTS_MCP_PROTOCOL_VERSIONS) {
    const { response, json } = await call(handler, rpcRequest("tools/list"), { headers: { "mcp-protocol-version": version } });
    assert.equal(response.status, 200, version);
    assert.equal(json.result.tools.length, 24);
  }
  const absent = await call(handler, rpcRequest("tools/list"));
  assert.equal(absent.response.status, 200, "без заголовка — совместимость со старыми клиентами");
  const padded = await call(handler, rpcRequest("ping"), { headers: { "mcp-protocol-version": " 2025-11-25 " } });
  assert.equal(padded.response.status, 200);
});

test("MCP-Protocol-Version: неизвестная версия — HTTP 400 с ошибкой JSON-RPC без id, работа не начинается", async () => {
  const { handler, state, toolCalls } = harness({ rpc: rpcWith(() => ({ data: { items: [], next_cursor: null }, error: null })) });
  for (const bad of ["2099-01-01", "2026-07-28", "latest", "", "2025-11-25; evil"]) {
    const { response, json } = await call(handler, rpcRequest("tools/call", { name: "search_clients", arguments: { query: "ab" } }), { headers: { "mcp-protocol-version": bad } });
    assert.equal(response.status, 400, JSON.stringify(bad));
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(json.jsonrpc, "2.0");
    assert.equal(json.id, null);
    assert.equal(json.error.code, -32600);
    assert.match(json.error.message, /MCP-Protocol-Version/u);
    assert.deepEqual(json.error.data.supported, ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
  }
  assert.equal(toolCalls().length, 0, "инструмент не вызывался");
  assert.equal(state.calls.some((entry) => entry.functionName === "ai_agent_mcp_log_v1"), false, "журнал действий агента не пишется");
  assert.equal(state.logs.at(-1).reason, "unsupported_protocol_version");
  assert.equal(JSON.stringify(state.logs).includes("evil"), false, "значение заголовка в журнал не попадает");
});

test("MCP-Protocol-Version: initialize заголовок не проверяет (версия ещё не согласована); уведомление и пакет проверяются", async () => {
  const { handler } = harness({ rpc: rpcWith(() => ({ data: {}, error: null })) });
  const init = await call(handler, rpcRequest("initialize", { protocolVersion: "2025-11-25" }), { headers: { "mcp-protocol-version": "2099-01-01" } });
  assert.equal(init.response.status, 200, "зонд хранилища Claude (initialize) работает при любом заголовке");
  assert.equal(init.json.result.protocolVersion, "2025-11-25");

  const notification = await call(handler, { jsonrpc: "2.0", method: "notifications/initialized" }, { headers: { "mcp-protocol-version": "2099-01-01" } });
  assert.equal(notification.response.status, 400);
  const accepted = await call(handler, { jsonrpc: "2.0", method: "notifications/initialized" }, { headers: { "mcp-protocol-version": "2025-11-25" } });
  assert.equal(accepted.response.status, 202);

  const batch = await call(handler, [rpcRequest("ping", undefined, 1), rpcRequest("ping", undefined, 2)], { headers: { "mcp-protocol-version": "2099-01-01" } });
  assert.equal(batch.response.status, 400);
});

test("MCP-Protocol-Version: зонд server/discover (2026-07-28) получает -32601, а не 400 — клиент Anthropic переходит на initialize", async () => {
  const { handler } = harness({ rpc: rpcWith(() => ({ data: {}, error: null })) });
  for (const headers of [{ "mcp-protocol-version": "2026-07-28" }, {}]) {
    const { response, json } = await call(handler, rpcRequest("server/discover"), { headers });
    assert.equal(response.status, 200, JSON.stringify(headers));
    assert.equal(json.error.code, -32601);
  }
});

test("MCP-Protocol-Version: порядок отказов — токен, затем тело, затем версия; Origin не проверяется", async () => {
  const { handler } = harness({ rpc: rpcWith(() => ({ data: {}, error: null })) });
  const noToken = await call(handler, rpcRequest("ping"), { token: OTHER_TOKEN, headers: { "mcp-protocol-version": "2099-01-01" } });
  assert.equal(noToken.response.status, 401, "неверный токен — раньше версии");
  const wrongType = await handler(post("{}", { contentType: "text/plain", raw: true, headers: { "mcp-protocol-version": "2099-01-01" } }));
  assert.equal(wrongType.status, 415);
  const origin = await call(handler, rpcRequest("ping"), { headers: { origin: "https://evil.example.test", "mcp-protocol-version": "2025-11-25" } });
  assert.equal(origin.response.status, 200, "проверку Origin сознательно не вводим (решение владельца)");
});
