import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createPlatformAuditExportHandler,
  GET,
  HEAD,
  OPTIONS,
  PUT,
} from "../src/app/api/platform-audit/export/route.ts";

const routeSource = readFileSync(
  new URL("../src/app/api/platform-audit/export/route.ts", import.meta.url),
  "utf8",
);

const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

function formBody(extra = "") {
  return [
    `request_id=${REQUEST_ID}`,
    "start_at=2026-08-01T00%3A00%3A00Z",
    "end_at=2026-08-14T00%3A00%3A00Z",
    "actions=audit.export",
    "resource_types=audit_export",
    extra,
  ].filter(Boolean).join("&");
}

function request({
  method = "POST",
  origin = "http://localhost",
  url = "http://localhost/api/platform-audit/export",
  host = new URL(url).host,
  forwardedHost,
  forwardedProto,
  contentType = "application/x-www-form-urlencoded",
  body = formBody(),
} = {}) {
  const headers = {
    origin,
    host,
    "content-type": contentType,
  };
  if (forwardedHost !== undefined) headers["x-forwarded-host"] = forwardedHost;
  if (forwardedProto !== undefined) headers["x-forwarded-proto"] = forwardedProto;
  return new Request(url, {
    method,
    headers,
    body: method === "POST" ? body : undefined,
  });
}

function exportResult() {
  return {
    requestId: REQUEST_ID,
    filters: {
      startAt: "2026-08-01T00:00:00.000Z",
      endAt: "2026-08-14T00:00:00.000Z",
      actions: ["audit.export"],
      resourceTypes: ["audit_export"],
      resourceId: null,
    },
    snapshotCreatedAt: null,
    snapshotId: null,
    rowCount: 0,
    rowSetSha256: "0".repeat(64),
    rows: [],
  };
}

function dependencies(overrides = {}) {
  let exports = 0;
  return {
    value: {
      env: { EVO_PLATFORM_P7A_AUDIT_ENABLED: "1" },
      async loadActor() {
        return { status: "authenticated", actor: { platformRole: "admin" } };
      },
      async exportAudit(input) {
        exports += 1;
        assert.equal(input.requestId, REQUEST_ID);
        return exportResult();
      },
      ...overrides,
    },
    exportCount() {
      return exports;
    },
  };
}

test("successful POST returns one private deterministic CSV attachment", async () => {
  const deps = dependencies();
  const handler = createPlatformAuditExportHandler(async () => deps.value);
  const response = await handler(request());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="evo-platform-audit.csv"',
  );
  assert.match(await response.text(), /^"audit_event_id",/);
  assert.equal(deps.exportCount(), 1);
});

test("same-origin POST follows the external Host instead of Next's internal request URL", async () => {
  const deps = dependencies();
  const handler = createPlatformAuditExportHandler(async () => deps.value);
  const response = await handler(request({
    origin: "https://crm.example",
    host: "crm.example",
    forwardedProto: "https",
    url: "http://127.0.0.1:3000/api/platform-audit/export",
  }));

  assert.equal(response.status, 200);
  assert.equal(deps.exportCount(), 1);
});

test("same-origin POST rejects spoofed forwarded hosts and protocol mismatches", async () => {
  const deps = dependencies();
  const handler = createPlatformAuditExportHandler(async () => deps.value);
  for (const value of [
    request({
      origin: "https://evil.example",
      host: "crm.example",
      forwardedHost: "evil.example",
      forwardedProto: "https",
      url: "http://127.0.0.1:3000/api/platform-audit/export",
    }),
    request({
      origin: "https://crm.example",
      host: "crm.example",
      url: "http://127.0.0.1:3000/api/platform-audit/export",
    }),
    request({
      origin: "https://crm.example",
      host: "crm.example",
      forwardedProto: "https,http",
      url: "http://127.0.0.1:3000/api/platform-audit/export",
    }),
  ]) {
    assert.equal((await handler(value)).status, 403);
  }
  assert.equal(deps.exportCount(), 0);
});

test("identical replay produces byte-identical CSV bytes", async () => {
  const deps = dependencies();
  const handler = createPlatformAuditExportHandler(async () => deps.value);
  const first = new Uint8Array(await (await handler(request())).arrayBuffer());
  const second = new Uint8Array(await (await handler(request())).arrayBuffer());
  assert.deepEqual(second, first);
  assert.equal(deps.exportCount(), 2);
});

test("cross-origin and missing-origin POSTs fail before auth or RPC", async () => {
  let actorLoads = 0;
  const deps = dependencies({
    async loadActor() {
      actorLoads += 1;
      return { status: "authenticated", actor: { platformRole: "admin" } };
    },
  });
  const handler = createPlatformAuditExportHandler(async () => deps.value);
  for (const value of [
    request({ origin: "https://evil.example" }),
    new Request("http://localhost/api/platform-audit/export", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody(),
    }),
  ]) {
    const response = await handler(value);
    assert.equal(response.status, 403);
  }
  assert.equal(actorLoads, 0);
  assert.equal(deps.exportCount(), 0);
});

test("malformed content type, oversized body, duplicate and extra fields fail before RPC", async () => {
  const deps = dependencies();
  const handler = createPlatformAuditExportHandler(async () => deps.value);
  for (const value of [
    request({ contentType: "application/json" }),
    request({ body: `request_id=${"a".repeat(20_000)}` }),
    request({ body: `${formBody()}&request_id=${REQUEST_ID}` }),
    request({ body: formBody("organization_id=11111111-1111-4111-8111-111111111111") }),
    request({ body: `${formBody()}&` }),
  ]) {
    const response = await handler(value);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(deps.exportCount(), 0);
});

test("chunked bodies are bounded by bytes and invalid UTF-8 is rejected before RPC", async () => {
  const deps = dependencies();
  const handler = createPlatformAuditExportHandler(async () => deps.value);
  const chunked = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(10_000).fill(97));
      controller.enqueue(new Uint8Array(10_000).fill(97));
      controller.close();
    },
  });
  const oversized = new Request("http://localhost/api/platform-audit/export", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      host: "localhost",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: chunked,
    duplex: "half",
  });
  const invalidUtf8 = new Request("http://localhost/api/platform-audit/export", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      host: "localhost",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new Uint8Array([0xc3, 0x28]),
  });

  assert.equal((await handler(oversized)).status, 400);
  assert.equal((await handler(invalidUtf8)).status, 400);
  assert.equal(deps.exportCount(), 0);
});

test("anonymous, non-Admin and disabled export fail closed without RPC", async () => {
  for (const overrides of [
    { async loadActor() { return { status: "anonymous", actor: null }; } },
    { async loadActor() { return { status: "authenticated", actor: { platformRole: "sales" } }; } },
    { env: {} },
  ]) {
    const deps = dependencies(overrides);
    const response = await createPlatformAuditExportHandler(async () => deps.value)(request());
    assert.equal(response.status, overrides.env ? 503 : 403);
    assert.equal(deps.exportCount(), 0);
  }
});

test("the route separates the development actor from the temporary anonymous repository client", () => {
  assert.match(
    routeSource,
    /const context = await createSupabaseServerContext\(\);/,
  );
  assert.match(
    routeSource,
    /loadActor: resolvePlatformActor/,
  );
  assert.match(
    routeSource,
    /createPlatformAuditRepository\([\s\S]*?context\.client as unknown as PlatformAuditRpcClient/,
  );
  assert.doesNotMatch(
    routeSource,
    /createAuthenticatedPlatformAuditRepository\(\)/,
  );
});

test("every admitted non-POST method is an explicit 405 and cannot call the export RPC", async () => {
  assert.equal((await GET(request({ method: "GET" }))).status, 405);
  assert.equal((await HEAD(request({ method: "HEAD" }))).status, 405);
  assert.equal((await OPTIONS(request({ method: "OPTIONS" }))).status, 405);
  assert.equal((await PUT(request({ method: "PUT" }))).status, 405);
  assert.equal((await HEAD(request({ method: "HEAD" }))).headers.get("allow"), "POST");
});
