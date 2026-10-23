import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";

import { AI_AGENT_LIMITS } from "../src/lib/ai-agents/contract.ts";
import { AiAgentsMcpFailureLimiter } from "../src/lib/server/ai-agents/mcp-auth.ts";
import { attachmentDisposition, createAiAgentsMcpFileHandler } from "../src/lib/server/ai-agents/mcp-files.ts";

// Synthetic only: the token, the bucket, the path and the bytes are made up.
const FILE_TOKEN = randomBytes(32).toString("base64url");
const BASE = "http://localhost/api/mcp/v1/files/";
const BYTES = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x00, 0xff]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

// The network check is off by default in this file so the older scenarios stay about the link itself; the
// address binding has its own tests at the end (a link is accepted only from the Anthropic allow-list).
function environment(overrides = {}) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_mcp_test_key_000000001",
    EVO_AI_AGENTS_MCP_IP_ALLOWLIST: "off",
    ...overrides,
  };
}

const ANTHROPIC_IP = "160.79.104.17";

const RESOLVED = {
  bucket: "student-documents",
  path: "org/case/version.pdf",
  mimeType: "application/pdf",
  byteSize: BYTES.byteLength,
  fileName: "Паспорт скан.pdf",
};

function harness({ resolve, download, env = environment(), failureLimiter, rpcDeadlineMs, storageDeadlineMs, maxUses } = {}) {
  const state = { rpc: [], downloads: [], logs: [], uses: 0, maxUses: maxUses ?? AI_AGENT_LIMITS.fileGrantMaxUses };
  const defaultResolve = (_name, args) => {
    if (args.p_token_sha256 === sha256(FILE_TOKEN)) state.uses += 1;
    if (args.p_token_sha256 !== sha256(FILE_TOKEN) || state.uses > state.maxUses) {
      return { data: null, error: { code: "P0002", message: "not_found" } };
    }
    return { data: RESOLVED, error: null };
  };
  const defaultDownload = () => ({ data: new Blob([BYTES], { type: "application/pdf" }), error: null });
  const handler = createAiAgentsMcpFileHandler({
    environment: env,
    log: (entry) => state.logs.push(entry),
    ...(failureLimiter === undefined ? {} : { failureLimiter }),
    ...(rpcDeadlineMs === undefined ? {} : { rpcDeadlineMs }),
    ...(storageDeadlineMs === undefined ? {} : { storageDeadlineMs }),
    createServiceClient: () => ({
      schema(name) {
        assert.equal(name, "platform");
        return {
          rpc: (functionName, args) => {
            state.rpc.push({ functionName, args });
            return Promise.resolve((resolve ?? defaultResolve)(functionName, args));
          },
        };
      },
      storage: {
        from: (bucket) => ({
          download: (path) => {
            state.downloads.push({ bucket, path });
            return Promise.resolve((download ?? defaultDownload)(bucket, path));
          },
        }),
      },
    }),
  });
  return { handler, state };
}

function get(token = FILE_TOKEN, { headers = {}, method = "GET" } = {}) {
  return new Request(`${BASE}${token}`, { method, headers });
}

test("a valid link serves the stored bytes with attachment headers, with no login check", async () => {
  const { handler, state } = harness();
  const response = await handler(get());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("content-length"), String(BYTES.byteLength));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const disposition = response.headers.get("content-disposition");
  assert.match(disposition, /^attachment; filename="[A-Za-z0-9._-]+"; filename\*=UTF-8''/u);
  assert.ok(disposition.includes(encodeURIComponent("Паспорт скан.pdf")));
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), BYTES);

  assert.deepEqual(state.rpc.map((entry) => entry.functionName), ["ai_agent_mcp_file_resolve_v1"]);
  assert.deepEqual(state.rpc[0].args, { p_token_sha256: sha256(FILE_TOKEN) });
  assert.equal(JSON.stringify(state.rpc).includes(FILE_TOKEN), false, "only the hash reaches the database");
  assert.deepEqual(state.downloads, [{ bucket: RESOLVED.bucket, path: RESOLVED.path }]);
});

test("the token is read from the route parameters (promise or plain object) as well as the path", async () => {
  const { handler } = harness();
  const request = new Request("http://localhost/somewhere/else");
  assert.equal((await handler(request, { params: Promise.resolve({ token: FILE_TOKEN }) })).status, 200);
  const second = harness();
  assert.equal((await second.handler(request, { params: { token: FILE_TOKEN } })).status, 200);
  const third = harness();
  assert.equal((await third.handler(get())).status, 200);
  const fourth = harness();
  assert.equal((await fourth.handler(request)).status, 404, "no token anywhere");
});

test("a token of the wrong shape is 404 with an empty body and never reaches the database", async () => {
  const { handler, state } = harness();
  for (const token of ["short", `${FILE_TOKEN}x`, FILE_TOKEN.slice(1), "A".repeat(42) + "!", "%20".repeat(15)]) {
    const response = await handler(get(token));
    assert.equal(response.status, 404, token);
    assert.equal(await response.text(), "");
  }
  const viaParams = await handler(get(), { params: Promise.resolve({ token: "short" }) });
  assert.equal(viaParams.status, 404);
  assert.equal(state.rpc.length, 0);
});

test("unknown, expired and exhausted links are 404 with an empty body", async () => {
  const unknown = harness();
  const missing = await unknown.handler(get(randomBytes(32).toString("base64url")));
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), "");
  assert.equal(unknown.state.downloads.length, 0);

  const odd = harness({ resolve: () => ({ data: null, error: { code: "XX000", message: "not_found" } }) });
  assert.equal((await odd.handler(get())).status, 404);

  const unusable = harness({ resolve: () => ({ data: { bucket: "", path: "" }, error: null }) });
  assert.equal((await unusable.handler(get())).status, 404);
  const empty = harness({ resolve: () => ({ data: null, error: null }) });
  assert.equal((await empty.handler(get())).status, 404);
});

test("a link works three times and the fourth use is 404", async () => {
  const { handler, state } = harness();
  const statuses = [];
  for (let attempt = 0; attempt < 4; attempt += 1) statuses.push((await handler(get())).status);
  assert.deepEqual(statuses, [200, 200, 200, 404]);
  assert.equal(state.downloads.length, 3, "an exhausted link never touches Storage");
});

test("only GET is served: other methods are 405 with Allow: GET", async () => {
  const { handler, state } = harness();
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    const response = await handler(get(FILE_TOKEN, { method }));
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("allow"), "GET");
  }
  assert.equal(state.rpc.length, 0);
});

test("a missing Storage object is 404; other Storage failures are 503; hung Storage is 503", async () => {
  const missing = harness({ download: () => ({ data: null, error: { message: "Object not found" } }) });
  assert.equal((await missing.handler(get())).status, 404);

  const broken = harness({ download: () => ({ data: null, error: { message: "upstream exploded" } }) });
  const response = await broken.handler(get());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "unavailable" });

  const thrown = harness({ download: () => { throw new Error("socket closed"); } });
  assert.equal((await thrown.handler(get())).status, 503);

  const hung = harness({ download: () => new Promise(() => undefined), storageDeadlineMs: 25 });
  assert.equal((await hung.handler(get())).status, 503);
});

test("database trouble is 503: not configured, schema missing, unavailable, hung", async () => {
  const notConfigured = harness({ env: { EVO_AI_AGENTS_MCP_IP_ALLOWLIST: "off" } });
  assert.deepEqual(await (await notConfigured.handler(get())).json(), { error: "not_configured" });
  assert.equal(notConfigured.state.rpc.length, 0);

  const schema = harness({ resolve: () => ({ data: null, error: { code: "PGRST202", message: "no function" } }) });
  const schemaResponse = await schema.handler(get());
  assert.equal(schemaResponse.status, 503);
  assert.deepEqual(await schemaResponse.json(), { error: "not_configured" });

  const down = harness({ resolve: () => ({ data: null, error: { code: "08006", message: "connection failure" } }) });
  assert.equal((await down.handler(get())).status, 503);

  const hung = harness({ resolve: () => new Promise(() => undefined), rpcDeadlineMs: 25 });
  assert.equal((await hung.handler(get())).status, 503);
});

test("an oversized object is refused with 413 and an unsafe media type is served as octet-stream", async () => {
  const big = harness({
    download: () => ({ data: { size: AI_AGENT_LIMITS.fileMaxBytes + 1, type: "application/pdf" }, error: null }),
  });
  assert.equal((await big.handler(get())).status, 413);

  const odd = harness({
    resolve: () => ({ data: { ...RESOLVED, mimeType: "text/html; <script>" }, error: null }),
  });
  const response = await odd.handler(get());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
});

test("failed lookups are limited per address; a blocked address gets 429 before the database", async () => {
  let clock = 1_000_000;
  const failureLimiter = new AiAgentsMcpFailureLimiter({ now: () => clock });
  const { handler, state } = harness({ failureLimiter });
  const headers = { "x-evo-mcp-ip": "198.51.100.20" };
  const statuses = [];
  for (let attempt = 0; attempt < 22; attempt += 1) {
    statuses.push((await handler(get(randomBytes(32).toString("base64url"), { headers }))).status);
  }
  assert.deepEqual(new Set(statuses.slice(0, 20)), new Set([404]));
  assert.deepEqual(statuses.slice(20), [429, 429]);

  const rpcBefore = state.rpc.length;
  const blocked = await handler(get(FILE_TOKEN, { headers }));
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "60");
  assert.equal(state.rpc.length, rpcBefore);

  // Another address is unaffected, and the block lasts a minute.
  assert.equal((await handler(get(FILE_TOKEN, { headers: { "x-evo-mcp-ip": "198.51.100.21" } }))).status, 200);
  clock += 61_000;
  assert.equal((await handler(get(FILE_TOKEN, { headers }))).status, 200);
});

test("the application log has counters only: no token, path, file name or address", async () => {
  const { handler, state } = harness();
  await handler(get(FILE_TOKEN, { headers: { "x-evo-mcp-ip": "198.51.100.30" } }));
  await handler(get(randomBytes(32).toString("base64url")));
  await handler(get("short"));
  await handler(get(FILE_TOKEN, { method: "POST" }));

  assert.equal(state.logs.length, 4);
  const serialized = JSON.stringify(state.logs);
  for (const secret of [FILE_TOKEN, RESOLVED.path, RESOLVED.fileName, RESOLVED.bucket, "198.51.100.30"]) {
    assert.equal(serialized.includes(secret), false, `the log must not contain ${secret}`);
  }
  assert.deepEqual(state.logs.map((entry) => entry.reason), ["served", "not_found", "bad_token", "method_not_allowed"]);
  for (const entry of state.logs) {
    assert.equal(entry.event, "ai_agents_mcp_file");
    assert.equal(typeof entry.status, "number");
    assert.equal(typeof entry.duration_ms, "number");
  }
});

test("an unexpected failure is a JSON 503, never a framework error page", async () => {
  const handler = createAiAgentsMcpFileHandler({
    environment: environment(),
    log: () => undefined,
    createServiceClient: () => { throw new Error("factory exploded"); },
  });
  const response = await handler(get());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "unavailable" });
});

test("attachmentDisposition: safe ASCII fallback, UTF-8 name, no header injection or path parts", () => {
  assert.equal(attachmentDisposition("report.pdf"), `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`);
  const cyrillic = attachmentDisposition("Паспорт.pdf");
  assert.match(cyrillic, /^attachment; filename="[A-Za-z0-9._-]+"; filename\*=UTF-8''%D0%9F/u);
  const hostile = attachmentDisposition('a"b\r\nSet-Cookie: x=1;/../..\\evil name.pdf');
  assert.equal(/[\r\n]/u.test(hostile), false);
  assert.equal(hostile.includes('"b'), false);
  assert.match(hostile, /filename="[A-Za-z0-9._-]+"/u);
  assert.equal(attachmentDisposition(""), 'attachment; filename="document"');
  assert.equal(attachmentDisposition("...").startsWith('attachment; filename="document"'), true);
  assert.ok(attachmentDisposition("x'(y)*.pdf").includes("%27%28y%29%2A.pdf"));
});

/* ------------------------------------------------ the link is bound to the requester (review #1290) */

test("by default a link works only from the Anthropic allow-list; the first request from it is served", async () => {
  const env = environment();
  delete env.EVO_AI_AGENTS_MCP_IP_ALLOWLIST;
  const { handler, state } = harness({ env });
  const served = await handler(get(FILE_TOKEN, { headers: { "x-evo-mcp-ip": ANTHROPIC_IP } }));
  assert.equal(served.status, 200);
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), BYTES);
  assert.equal(state.rpc.length, 1);
  // The same address through X-Forwarded-For (last element), as the edge rewrites it.
  const viaForwarded = await handler(get(FILE_TOKEN, { headers: { "x-forwarded-for": `203.0.113.9, ${ANTHROPIC_IP}` } }));
  assert.equal(viaForwarded.status, 200);
});

test("a foreign or unknown address gets an empty 404 before the database: the link is not spent and its existence is not revealed", async () => {
  const env = environment();
  delete env.EVO_AI_AGENTS_MCP_IP_ALLOWLIST;
  const { handler, state } = harness({ env });
  for (const headers of [{ "x-evo-mcp-ip": "198.51.100.77" }, { "x-forwarded-for": "198.51.100.77" }, { "x-evo-mcp-ip": "160.79.112.1" }, {}]) {
    const response = await handler(get(FILE_TOKEN, { headers }));
    assert.equal(response.status, 404, JSON.stringify(headers));
    assert.equal(await response.text(), "");
  }
  assert.equal(state.rpc.length, 0, "the database is never asked and the 3 uses are untouched");
  assert.equal(state.downloads.length, 0);
  // An unknown token from a foreign address looks the same as a real one.
  const unknown = await handler(get(randomBytes(32).toString("base64url"), { headers: { "x-evo-mcp-ip": "198.51.100.77" } }));
  assert.equal(unknown.status, 404);
  assert.equal(await unknown.text(), "");
  // The allowed address still gets all three uses afterwards.
  const statuses = [];
  for (let attempt = 0; attempt < 4; attempt += 1) statuses.push((await handler(get(FILE_TOKEN, { headers: { "x-evo-mcp-ip": ANTHROPIC_IP } }))).status);
  assert.deepEqual(statuses, [200, 200, 200, 404], "10 minutes and 3 uses are unchanged");
});

test("EVO_AI_AGENTS_MCP_IP_ALLOWLIST: a custom list replaces the default, a bad list refuses everyone, off switches the check off", async () => {
  const custom = harness({ env: environment({ EVO_AI_AGENTS_MCP_IP_ALLOWLIST: "198.51.100.0/24, 203.0.113.5" }) });
  assert.equal((await custom.handler(get(FILE_TOKEN, { headers: { "x-evo-mcp-ip": "198.51.100.20" } }))).status, 200);
  assert.equal((await custom.handler(get(FILE_TOKEN, { headers: { "x-evo-mcp-ip": "203.0.113.5" } }))).status, 200);
  assert.equal((await custom.handler(get(FILE_TOKEN, { headers: { "x-evo-mcp-ip": ANTHROPIC_IP } }))).status, 404, "the default network is not added to a custom list");

  const broken = harness({ env: environment({ EVO_AI_AGENTS_MCP_IP_ALLOWLIST: "not-an-address, 999.1.1.1/8" }) });
  assert.equal((await broken.handler(get(FILE_TOKEN, { headers: { "x-evo-mcp-ip": ANTHROPIC_IP } }))).status, 404, "no usable entry: refuse everyone");
  assert.equal(broken.state.rpc.length, 0);

  const off = harness({ env: environment({ EVO_AI_AGENTS_MCP_IP_ALLOWLIST: "off" }) });
  assert.equal((await off.handler(get(FILE_TOKEN, { headers: { "x-evo-mcp-ip": "198.51.100.77" } }))).status, 200);
  assert.equal((await off.handler(get(FILE_TOKEN))).status, 200, "off needs no address at all");
});

test("foreign-address attempts count toward the failure limiter (429 after the limit) and the log has the reason only", async () => {
  let clock = 5_000_000;
  const failureLimiter = new AiAgentsMcpFailureLimiter({ now: () => clock });
  const env = environment();
  delete env.EVO_AI_AGENTS_MCP_IP_ALLOWLIST;
  const { handler, state } = harness({ env, failureLimiter });
  const headers = { "x-evo-mcp-ip": "198.51.100.88" };
  const statuses = [];
  for (let attempt = 0; attempt < 22; attempt += 1) statuses.push((await handler(get(FILE_TOKEN, { headers }))).status);
  assert.deepEqual(new Set(statuses.slice(0, 20)), new Set([404]));
  assert.deepEqual(statuses.slice(20), [429, 429]);
  assert.equal(state.rpc.length, 0);
  assert.equal(state.logs.filter((entry) => entry.reason === "ip_denied").length, 20);
  const serialized = JSON.stringify(state.logs);
  for (const secret of [FILE_TOKEN, "198.51.100.88"]) assert.equal(serialized.includes(secret), false, `the log must not contain ${secret}`);

  // An unknown address (no header at all) is refused and logged as ip_unknown.
  const noAddress = harness({ env });
  assert.equal((await noAddress.handler(get(FILE_TOKEN))).status, 404);
  assert.deepEqual(noAddress.state.logs.map((entry) => entry.reason), ["ip_unknown"]);
  clock += 61_000;
  assert.equal((await handler(get(FILE_TOKEN, { headers: { "x-evo-mcp-ip": ANTHROPIC_IP } }))).status, 200, "the allowed address is unaffected after the block");
});
