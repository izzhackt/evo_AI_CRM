import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import * as timing from "../src/lib/request-timing.ts";
import { installRequestTiming } from "../src/lib/server/request-timing-node.ts";

// Замер A0 (docs/PLAN_CHANGES.md 19.10.2026): подсчёт RPC и глубины, вид
// запроса, класс маршрута, отсутствие данных пользователей в строке, заголовок
// Server-Timing только вне production, а также настоящий http-сервер с
// перехватом `request` и обёрткой fetch.

const UUID = "7c1b0f3e-91a2-4d0b-8a55-0123456789ab";
const REVISION = "0123456789abcdef0123456789abcdef01234567";

function fresh(headers = {}) {
  return timing.startRequestTiming(headers, 0, Date.UTC(2026, 9, 19, 8, 30, 15, 900));
}

test("depth: parallel calls share a level, a call started after another finished is the next level", () => {
  const sequential = fresh();
  const first = timing.beginRpc(sequential, 0);
  timing.endRpc(sequential, first, 100);
  const second = timing.beginRpc(sequential, 110);
  timing.endRpc(sequential, second, 300);
  assert.deepEqual([sequential.rpcCount, sequential.depth, sequential.rpcMs, sequential.rpcWallMs], [2, 2, 290, 290]);

  const parallel = fresh();
  const a = timing.beginRpc(parallel, 0);
  const b = timing.beginRpc(parallel, 5);
  timing.endRpc(parallel, a, 100);
  timing.endRpc(parallel, b, 120);
  assert.equal(parallel.depth, 1, "started before anything finished: one wave");
  assert.equal(parallel.rpcMs, 215, "sum of durations");
  assert.equal(parallel.rpcWallMs, 120, "union of the intervals");

  // A и B стартуют вместе; A закончился -> C на уровне 2; B закончился -> D тоже на уровне 2.
  const mixed = fresh();
  const mixedA = timing.beginRpc(mixed, 0);
  const mixedB = timing.beginRpc(mixed, 0);
  timing.endRpc(mixed, mixedA, 50);
  const mixedC = timing.beginRpc(mixed, 60);
  timing.endRpc(mixed, mixedB, 80);
  const mixedD = timing.beginRpc(mixed, 90);
  timing.endRpc(mixed, mixedC, 150);
  timing.endRpc(mixed, mixedD, 160);
  assert.deepEqual([mixed.rpcCount, mixed.depth], [4, 2]);

  // Цепочка из трёх: уровень растёт по окончанию последнего.
  const chain = fresh();
  for (let index = 0; index < 3; index += 1) {
    const call = timing.beginRpc(chain, index * 100);
    timing.endRpc(chain, call, index * 100 + 50);
  }
  assert.equal(chain.depth, 3);
});

test("calls after the response closed are ignored and other Supabase calls only count", () => {
  const request = fresh();
  timing.countOtherSupabaseCall(request);
  request.finished = true;
  assert.equal(timing.beginRpc(request, 1), null);
  timing.countOtherSupabaseCall(request);
  assert.deepEqual([request.rpcCount, request.otherCount], [0, 1]);
});

test("kind comes from the raw request headers, in the order action > prefetch > nav", () => {
  assert.equal(timing.kindFromHeaders({ "next-action": "40ab", rsc: "1" }), "action");
  assert.equal(timing.kindFromHeaders({ "next-router-prefetch": "1", rsc: "1" }), "prefetch");
  assert.equal(timing.kindFromHeaders({ "next-router-segment-prefetch": "/_tree", rsc: "1" }), "prefetch");
  assert.equal(timing.kindFromHeaders({ rsc: "1", "next-router-state-tree": "x" }), "nav");
  assert.equal(timing.kindFromHeaders({ accept: "text/html" }), null);
  assert.equal(timing.kindFromHeaders({ rsc: "0" }), null);
});

test("route class is the Next template, never a raw path, and rejects anything that looks like an id", () => {
  assert.equal(timing.routeClassFromTemplate("/v3/profile/[caseId]"), "v3/profile/[caseId]");
  assert.equal(timing.routeClassFromTemplate("/portal/universities/[id]"), "portal/universities/[id]");
  assert.equal(timing.routeClassFromTemplate("/portal/home"), "portal/home");
  assert.equal(timing.routeClassFromTemplate("/api/v3/knowledge/[...slug]"), "api/v3/knowledge/[...slug]");
  assert.equal(timing.routeClassFromTemplate("/"), "/");
  for (const value of [
    `/v3/profile/${UUID}`,
    "/portal/universities/12345678",
    "/v3/profile?case=1",
    "/v3/profile/a b",
    "/a@b.test",
    "",
    null,
    undefined,
    42,
    `/${"x".repeat(200)}`,
  ]) {
    assert.equal(timing.routeClassFromTemplate(value), value === "" ? "/" : null, String(value));
  }
});

test("the matched route is read from Next's request meta; no match is null", () => {
  const meta = Symbol.for("NextInternalRequestMeta");
  const page = { [meta]: { match: { definition: { kind: "APP_PAGE", pathname: "/v3/profile/[caseId]" } } } };
  assert.deepEqual(timing.matchedRouteOf(page), { kind: "APP_PAGE", template: "/v3/profile/[caseId]" });
  const route = { [meta]: { match: { definition: { kind: "APP_ROUTE", pathname: "/api/portal/updates" } } } };
  assert.equal(timing.matchedRouteOf(route).kind, "APP_ROUTE");
  assert.equal(timing.matchedRouteOf({}), null);
  assert.equal(timing.matchedRouteOf(null), null);
  assert.equal(timing.matchedRouteOf({ [meta]: { match: { definition: { pathname: 7 } } } }), null);
});

test("a record has a closed set of fields and no user data", () => {
  const request = fresh({ "next-action": "40ab" });
  const call = timing.beginRpc(request, 10);
  timing.endRpc(request, call, 40);
  request.ttfbMs = 12.34;
  const record = timing.buildTimingRecord(
    request,
    { status: 200, aborted: false, route: { kind: "APP_PAGE", template: "/portal/home" } },
    "r199+01234567",
    55.55,
  );
  assert.deepEqual(Object.keys(record).sort(), [
    "class", "depth", "event", "kind", "ms", "other", "rel", "rpc", "rpc_ms", "rpc_wall_ms", "status", "ts", "ttfb_ms", "v",
  ]);
  assert.deepEqual(
    { ...record },
    {
      event: "evo_timing", v: 1, ts: "2026-10-19T08:30:15Z", rel: "r199+01234567", class: "portal/home", kind: "action",
      status: 200, ms: 55.6, ttfb_ms: 12.3, rpc: 1, depth: 1, rpc_ms: 30, rpc_wall_ms: 30, other: 0,
    },
  );
  const aborted = timing.buildTimingRecord(fresh(), { status: 200, aborted: true, route: null }, "bad label", 1);
  assert.equal(aborted.aborted, true);
  assert.equal(aborted.class, "unmatched");
  assert.equal(aborted.kind, "page");
  assert.equal(aborted.rel, "dev", "a label that is not a release label is replaced");
  assert.equal(aborted.ttfb_ms, null);
  const route = timing.buildTimingRecord(fresh(), { status: 503, aborted: false, route: { kind: "APP_ROUTE", template: "/api/portal/updates" } }, "dev", 1);
  assert.equal(route.kind, "route");
  assert.equal(timing.buildTimingRecord(fresh(), { status: 99_999, aborted: false, route: null }, "dev", 1).status, 0);
  // Класс с идентификатором в статическом сегменте не попадает в строку.
  assert.equal(
    timing.buildTimingRecord(fresh(), { status: 200, aborted: false, route: { kind: "APP_PAGE", template: `/v3/${UUID}` } }, "dev", 1).class,
    "unmatched",
  );
});

test("release label is version plus the short revision, dev when unknown", () => {
  assert.equal(timing.releaseLabel({ EVO_RELEASE_REVISION: REVISION, EVO_RELEASE_VERSION: "r198.1" }), "r198.1+01234567");
  assert.equal(timing.releaseLabel({}), "dev");
  assert.equal(timing.releaseLabel({ EVO_RELEASE_REVISION: "short", EVO_RELEASE_VERSION: "r1" }), "dev");
});

test("Server-Timing exists only in development and test; production and an unset NODE_ENV get nothing", () => {
  const request = fresh();
  const call = timing.beginRpc(request, 0);
  timing.endRpc(request, call, 20);
  const value = timing.serverTimingHeader(request, { NODE_ENV: "development" }, 30);
  assert.match(value, /^rpc;dur=20;desc="n=1 depth=1", app;dur=30$/);
  assert.equal(typeof timing.serverTimingHeader(request, { NODE_ENV: "test" }, 30), "string");
  assert.equal(timing.serverTimingHeader(request, { NODE_ENV: "production" }, 30), null);
  assert.equal(timing.serverTimingHeader(request, {}, 30), null);
  assert.equal(timing.serverTimingHeader(request, { NODE_ENV: "staging" }, 30), null);
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function send(port, { path, method = "GET", headers = {} }) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path, method, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.on("error", reject);
    request.end();
  });
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function withInstalledTiming(environment, run) {
  const realFetch = globalThis.fetch;
  const log = [];
  // «Supabase»: каждый вызов отвечает после небольшой паузы.
  globalThis.fetch = async () => { await wait(15); return new Response("{}", { status: 200 }); };
  const uninstall = installRequestTiming({ sink: (record) => log.push(record), environment });
  try {
    await run(log);
  } finally {
    uninstall();
    globalThis.fetch = realFetch;
  }
}

test("a real server: one record per proxied request, RPC and depth counted by the fetch wrapper", async () => {
  await withInstalledTiming(
    { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://supabase.test", EVO_RELEASE_REVISION: REVISION, EVO_RELEASE_VERSION: "r199" },
    async (log) => {
      const server = http.createServer(async (request, response) => {
        if (request.url.startsWith("/static")) { response.end("file"); return; }
        timing.markProxied();
        request[Symbol.for("NextInternalRequestMeta")] = {
          match: { definition: { kind: "APP_PAGE", pathname: "/v3/profile/[caseId]" } },
        };
        // Две волны: два вызова вместе, затем третий; плюс обращение к Auth.
        await Promise.all([
          fetch("https://supabase.test/rest/v1/rpc/first?p_x=1"),
          fetch("https://supabase.test/rest/v1/rpc/second"),
        ]);
        await fetch("https://supabase.test/rest/v1/rpc/third", { method: "POST" });
        await fetch("https://supabase.test/auth/v1/user");
        await fetch("https://elsewhere.test/rest/v1/table");
        response.statusCode = 201;
        response.end("ok");
      });
      const port = await listen(server);
      try {
        assert.equal((await send(port, { path: "/static/chunk.js" })).status, 200);
        const reply = await send(port, {
          path: `/v3/profile/${UUID}?email=person%40example.test&token=secret-value`,
          headers: { cookie: "sb-project-auth-token=cookie-secret", "x-forwarded-for": "203.0.113.9", "next-router-prefetch": "1" },
        });
        assert.equal(reply.status, 201);
        assert.equal(reply.headers["server-timing"], undefined, "no Server-Timing in production");
        await wait(30);
        assert.equal(log.length, 1, "the static file is not logged, the page is");
        const [record] = log;
        assert.equal(record.class, "v3/profile/[caseId]");
        assert.equal(record.kind, "prefetch");
        assert.equal(record.status, 201);
        assert.equal(record.rel, "r199+01234567");
        assert.deepEqual([record.rpc, record.depth, record.other], [3, 2, 1]);
        assert.ok(record.rpc_ms >= 30 && record.ms >= record.rpc_wall_ms, JSON.stringify(record));
        assert.ok(record.ttfb_ms !== null && record.ttfb_ms <= record.ms);
        const line = JSON.stringify(record);
        for (const secret of [UUID, "person", "example.test", "secret-value", "cookie-secret", "203.0.113.9", "127.0.0.1", "token", "email", "p_x"]) {
          assert.equal(line.includes(secret), false, `the line must not contain ${secret}: ${line}`);
        }
      } finally {
        server.close();
      }
    },
  );
});

test("Server-Timing is set on responses in development only", async () => {
  await withInstalledTiming({ NODE_ENV: "development" }, async () => {
    const server = http.createServer(async (request, response) => {
      timing.markProxied();
      await fetch("https://supabase.test/rest/v1/rpc/only");
      response.end("ok");
    });
    const port = await listen(server);
    try {
      const reply = await send(port, { path: "/" });
      assert.match(reply.headers["server-timing"], /^rpc;dur=\d+(?:\.\d)?;desc="n=1 depth=1", app;dur=\d+(?:\.\d)?$/);
    } finally {
      server.close();
    }
  });
});

test("an aborted response is logged as aborted; a failed RPC still ends its wave", async () => {
  const realFetch = globalThis.fetch;
  const log = [];
  globalThis.fetch = async () => { await wait(5); throw new TypeError("network"); };
  const uninstall = installRequestTiming({ sink: (record) => log.push(record), environment: { NODE_ENV: "production" } });
  try {
    const server = http.createServer(async (request, response) => {
      timing.markProxied();
      await fetch("https://supabase.test/rest/v1/rpc/broken").catch(() => undefined);
      await fetch("https://supabase.test/rest/v1/rpc/broken").catch(() => undefined);
      response.write("part");
      await wait(300);
      response.end("never seen");
    });
    const port = await listen(server);
    try {
      await new Promise((resolve) => {
        const request = http.request({ host: "127.0.0.1", port, path: "/" }, (response) => {
          response.once("data", () => { request.destroy(); resolve(undefined); });
        });
        request.on("error", () => undefined);
        request.end();
      });
      await wait(450);
      assert.equal(log.length, 1);
      assert.equal(log[0].aborted, true);
      assert.deepEqual([log[0].rpc, log[0].depth], [2, 2]);
    } finally {
      server.close();
    }
  } finally {
    uninstall();
    globalThis.fetch = realFetch;
  }
});

test("a request the client cancelled before any route or RPC is not logged at all", async () => {
  await withInstalledTiming({ NODE_ENV: "production" }, async (log) => {
    const server = http.createServer(async (request, response) => {
      timing.markProxied();
      await wait(200);
      response.end("late");
    });
    const port = await listen(server);
    try {
      await new Promise((resolve) => {
        const request = http.request({ host: "127.0.0.1", port, path: "/" }, () => undefined);
        request.on("error", () => resolve(undefined));
        request.end();
        setTimeout(() => request.destroy(), 30);
      });
      await wait(350);
      assert.equal(log.length, 0, JSON.stringify(log));
    } finally {
      server.close();
    }
  });
});

test("fetch outside a request is untouched; install is idempotent and uninstall restores the originals", async () => {
  const originalFetch = globalThis.fetch;
  const emitBefore = http.Server.prototype.emit;
  const log = [];
  const uninstall = installRequestTiming({ sink: (record) => log.push(record), environment: {} });
  try {
    assert.notEqual(globalThis.fetch, originalFetch);
    const wrapped = globalThis.fetch;
    assert.equal(installRequestTiming({ sink: () => assert.fail("second install must not apply") }), uninstall);
    assert.equal(globalThis.fetch, wrapped, "the second call did not wrap again");
    assert.equal(timing.currentTiming(), undefined);
    await assert.rejects(() => fetch("http://127.0.0.1:9/rest/v1/rpc/x"), "outside a request the call goes straight to the original fetch");
    assert.equal(log.length, 0);
  } finally {
    uninstall();
  }
  assert.equal(globalThis.fetch, originalFetch);
  assert.equal(http.Server.prototype.emit, emitBefore);
});
