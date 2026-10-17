import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createPlatformTelephonyInboundHandler,
  TelephonyFailureLimiter,
} from "../src/lib/server/platform-telephony-ingress.ts";
import {
  isPlatformTelephonyEnabled,
  readPlatformTelephonyCrmTokens,
} from "../src/lib/server/platform-telephony-ingress-config.ts";

// Everything here is synthetic: the organization, the keys, the numbers. No
// real PBX key, number or recording link appears in this file.
const ORGANIZATION_ID = "77300000-0000-4000-8000-000000000001";
const CRM_TOKEN = "3f1c9a52-7d44-4c0e-9b1a-5e2d8f6a7c10";
const NEXT_TOKEN = "c8e0b7f4-1a2d-4f63-8a95-0d7e4b3c6a21";
const URL_ = "http://localhost/api/v2/telephony/beeline/inbound";
const FORM = "application/x-www-form-urlencoded";
const MAX_BODY = 32 * 1024;
// A wrong key used to prove the log never echoes what a client sends.
const LOG_PROBE_VALUE = ["not", "the", "key", "probe", "0001"].join("-");
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function environment(overrides = {}) {
  return {
    EVO_PLATFORM_TELEPHONY_ENABLED: "1",
    EVO_PLATFORM_TELEPHONY_CRM_TOKEN: CRM_TOKEN,
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_telephony_test_key_0001",
    ...overrides,
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

// A handler wired to a recording fake of the platform RPC client.
function harness({ env = environment(), rpc, limiter, databaseDeadlineMs } = {}) {
  const state = { calls: [], clients: 0, logs: [], schemas: [] };
  const defaultRpc = async () => ({
    data: { status: "stored", validation_state: "ok", projection: "disabled" },
    error: null,
  });
  const handler = createPlatformTelephonyInboundHandler({
    environment: env,
    limiter: limiter ?? new TelephonyFailureLimiter(),
    log: (entry) => state.logs.push(entry),
    ...(databaseDeadlineMs === undefined ? {} : { databaseDeadlineMs }),
    createServiceClient: () => {
      state.clients += 1;
      return {
        schema(name) {
          state.schemas.push(name);
          return {
            rpc: (functionName, args) => {
              state.calls.push({ functionName, args });
              return (rpc ?? defaultRpc)(functionName, args);
            },
          };
        },
      };
    },
  });
  return { handler, state };
}

function formBody(fields) {
  return new URLSearchParams(fields).toString();
}

function request(fields, { token = CRM_TOKEN, headers = {}, method = "POST" } = {}) {
  const body = formBody(token === null ? fields : { ...fields, crm_token: token });
  return new Request(URL_, {
    method,
    headers: { "content-type": FORM, ...headers },
    body,
  });
}

const EVENT_FIELDS = {
  cmd: "event",
  type: "INCOMING",
  phone: "996555000111",
  diversion: "996312000222",
  user: "synthetic.manager",
  callid: "synthetic-call-1",
  direction: "in",
};
const HISTORY_FIELDS = {
  cmd: "history",
  type: "in",
  status: "Success",
  phone: "996555000111",
  user: "synthetic.manager",
  diversion: "996312000222",
  start: "20261017T101010Z",
  duration: "124",
  wait: "7",
  callid: "synthetic-call-1",
};

async function json(response) {
  return JSON.parse(await response.text());
}

function forbiddenClient() {
  return {
    createServiceClient: () => {
      throw new Error("the database must not be reached");
    },
  };
}

// A request whose body is a stream the test controls; `state` shows how much was
// really pulled.
function streamedRequest(nextChunk, headers = {}) {
  const state = { pulls: 0, bytes: 0, cancelled: false };
  const stream = new ReadableStream(
    {
      pull(controller) {
        state.pulls += 1;
        const chunk = nextChunk();
        if (chunk === null) {
          controller.close();
          return;
        }
        state.bytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const streamed = new Request(URL_, {
    method: "POST",
    headers: { "content-type": FORM, ...headers },
    body: stream,
    duplex: "half",
  });
  return { request: streamed, state };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------- config

test("config: the switch is exactly 1 and the key is 32-64 characters of [A-Za-z0-9-]", () => {
  for (const [value, expected] of [
    ["1", true],
    ["0", false],
    ["", false],
    [undefined, false],
    ["true", false],
    ["01", false],
    [" 1", false],
    ["1 ", false],
  ]) {
    assert.equal(
      isPlatformTelephonyEnabled({ EVO_PLATFORM_TELEPHONY_ENABLED: value }),
      expected,
      String(value),
    );
  }
  assert.deepEqual(
    readPlatformTelephonyCrmTokens({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN: CRM_TOKEN }),
    { current: CRM_TOKEN, next: null },
  );
  assert.deepEqual(
    readPlatformTelephonyCrmTokens({
      EVO_PLATFORM_TELEPHONY_CRM_TOKEN: CRM_TOKEN,
      EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT: NEXT_TOKEN,
    }),
    { current: CRM_TOKEN, next: NEXT_TOKEN },
  );
  for (const bad of [
    undefined,
    "",
    "a".repeat(31),
    "a".repeat(65),
    `${CRM_TOKEN} `,
    ` ${CRM_TOKEN}`,
    `${CRM_TOKEN}\n`,
    `${CRM_TOKEN.slice(0, 20)}\u0007${CRM_TOKEN.slice(21)}`,
    `${CRM_TOKEN.slice(0, 35)}_`,
    `${CRM_TOKEN.slice(0, 35)}.`,
    `${CRM_TOKEN.slice(0, 35)}я`,
  ]) {
    assert.equal(
      readPlatformTelephonyCrmTokens({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN: bad }),
      null,
      JSON.stringify(bad),
    );
  }
  // A bad or duplicate NEXT never blocks a good current key.
  for (const next of ["short", CRM_TOKEN, "", undefined]) {
    assert.deepEqual(
      readPlatformTelephonyCrmTokens({
        EVO_PLATFORM_TELEPHONY_CRM_TOKEN: CRM_TOKEN,
        EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT: next,
      }),
      { current: CRM_TOKEN, next: null },
    );
  }
  // NEXT alone is not a key.
  assert.equal(
    readPlatformTelephonyCrmTokens({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT: NEXT_TOKEN }),
    null,
  );
});

// ---------------------------------------------------------------- method / config

test("any method but POST is 405 with Allow: POST and reaches nothing", async () => {
  const { handler, state } = harness();
  for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await handler(new Request(URL_, { method }));
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("allow"), "POST", method);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(state.clients, 0);
  assert.equal(state.calls.length, 0);
});

test("a missing or malformed intake key is 503 before the body is read", async () => {
  for (const env of [
    environment({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN: undefined }),
    environment({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN: "" }),
    environment({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN: "x".repeat(31) }),
    environment({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN: `${CRM_TOKEN} ` }),
    environment({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN: undefined, EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT: NEXT_TOKEN }),
  ]) {
    const { handler, state } = harness({ env });
    const { request: streamed, state: stream } = streamedRequest(() => {
      throw new Error("the body must not be read");
    });
    const response = await handler(streamed);
    assert.equal(response.status, 503);
    assert.deepEqual(await json(response), { error: "telephony_unavailable" });
    assert.equal(stream.pulls, 0);
    assert.equal(streamed.bodyUsed, false);
    assert.equal(state.clients, 0);
  }
});

// ---------------------------------------------------------------- size and type

test("a Content-Length above 32 KiB is 413 before a byte of the body is read", async () => {
  const { handler, state } = harness();
  for (const declared of [String(MAX_BODY + 1), ` ${MAX_BODY + 1} `, "99999999999999999999"]) {
    const { request: streamed, state: stream } = streamedRequest(
      () => {
        throw new Error("the body must not be read");
      },
      { "content-length": declared },
    );
    const response = await handler(streamed);
    assert.equal(response.status, 413, declared);
    assert.deepEqual(await json(response), { error: "payload_too_large" });
    assert.equal(stream.pulls, 0);
  }
  assert.equal(state.clients, 0);
});

test("a body with no or a false Content-Length is bounded while it is read and the upload cancelled", async () => {
  const chunk = new Uint8Array(16 * 1024).fill(0x61);
  for (const headers of [{}, { "content-length": "10" }, { "content-length": "not-a-number" }]) {
    const { handler, state } = harness();
    const { request: streamed, state: stream } = streamedRequest(() => chunk, headers);
    const response = await handler(streamed);
    await settle();
    assert.equal(response.status, 413, JSON.stringify(headers));
    assert.equal(stream.cancelled, true);
    assert.ok(stream.pulls <= 4, `pulled ${stream.pulls} chunks of an endless body`);
    assert.equal(state.clients, 0);
  }
});

test("a body of exactly 32 KiB is read and one byte more is refused", async () => {
  // Fields over 2048 characters are refused by the parser, so build the size
  // from many ordinary fields.
  const manyFields = (target) => {
    const parts = [`cmd=contact`, `crm_token=${CRM_TOKEN}`];
    let size = parts.join("&").length;
    for (let i = 0; size < target && i < 30; i += 1) {
      const room = Math.min(2000, target - size - 8);
      if (room <= 0) break;
      parts.push(`f${i}=${"a".repeat(room)}`);
      size = parts.join("&").length;
    }
    return parts.join("&");
  };
  const exact = manyFields(MAX_BODY);
  assert.ok(exact.length <= MAX_BODY && exact.length > MAX_BODY - 16, `size ${exact.length}`);
  const { handler } = harness({ env: environment({ EVO_PLATFORM_TELEPHONY_ENABLED: "0" }) });
  const ok = await handler(
    new Request(URL_, { method: "POST", headers: { "content-type": FORM }, body: exact }),
  );
  assert.equal(ok.status, 200, "a body at the cap is read and, with the key proven, contact answers");
  const bytes = Buffer.from(exact);
  let offset = 0;
  const over = streamedRequest(() => {
    if (offset >= MAX_BODY + 1) return null;
    const next = bytes.subarray(offset % bytes.length, (offset % bytes.length) + 1000);
    offset += next.byteLength;
    return new Uint8Array(next);
  });
  const refused = await handler(over.request);
  assert.equal(refused.status, 413);
});

test("an unsupported or missing media type is 415; parameters are ignored for the four accepted types", async () => {
  const { handler, state } = harness();
  for (const contentType of ["text/html", "application/xml", "application/octet-stream", "text/csv"]) {
    const response = await handler(
      new Request(URL_, {
        method: "POST",
        headers: { "content-type": contentType },
        body: formBody({ ...EVENT_FIELDS, crm_token: CRM_TOKEN }),
      }),
    );
    assert.equal(response.status, 415, contentType);
    assert.deepEqual(await json(response), { error: "unsupported_media_type" });
  }
  const missing = await handler(
    new Request(URL_, { method: "POST", body: new Uint8Array([0x78]) }),
  );
  assert.equal(missing.status, 415);
  assert.equal(state.clients, 0);

  for (const contentType of [
    "application/x-www-form-urlencoded; charset=UTF-8",
    "Application/X-WWW-Form-Urlencoded;charset=utf-8",
  ]) {
    const response = await handler(
      new Request(URL_, {
        method: "POST",
        headers: { "content-type": contentType },
        body: formBody({ ...EVENT_FIELDS, crm_token: CRM_TOKEN }),
      }),
    );
    assert.equal(response.status, 200, contentType);
  }
});

test("JSON, multipart and text/plain are accepted as insurance and reach the same function", async () => {
  const withToken = { ...EVENT_FIELDS, crm_token: CRM_TOKEN };
  const multipart = new FormData();
  for (const [name, value] of Object.entries(withToken)) multipart.append(name, value);
  const cases = [
    new Request(URL_, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(withToken),
    }),
    new Request(URL_, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ...withToken, duration: 4, extra: null, flag: true }),
    }),
    new Request(URL_, { method: "POST", body: multipart }),
    new Request(URL_, {
      method: "POST",
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: JSON.stringify(withToken),
    }),
    new Request(URL_, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: formBody(withToken),
    }),
  ];
  for (const incoming of cases) {
    const { handler, state } = harness();
    const response = await handler(incoming);
    assert.equal(response.status, 200, incoming.headers.get("content-type") ?? "multipart");
    assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0].args.p_fields.callid, "synthetic-call-1");
    assert.equal(state.calls[0].args.p_fields.crm_token, undefined);
  }
});

// ---------------------------------------------------------------- parse failures

test("bodies the narrow flat parser cannot read are 400 and reach nothing", async () => {
  const json400 = (body) =>
    new Request(URL_, { method: "POST", headers: { "content-type": "application/json" }, body });
  const form400 = (body) =>
    new Request(URL_, { method: "POST", headers: { "content-type": FORM }, body });
  const thirtyThree = Array.from({ length: 33 }, (_, i) => `f${i}=1`).join("&");
  const cases = {
    "empty form": form400(""),
    "only separators": form400("&&&"),
    "repeated key": form400(`cmd=event&cmd=history&crm_token=${CRM_TOKEN}`),
    "__proto__ key": form400(`__proto__=x&cmd=event&crm_token=${CRM_TOKEN}`),
    "empty key": form400(`=x&cmd=event&crm_token=${CRM_TOKEN}`),
    "key over 64": form400(`${"k".repeat(65)}=1&crm_token=${CRM_TOKEN}`),
    "value over 2048": form400(`cmd=event&x=${"v".repeat(2049)}&crm_token=${CRM_TOKEN}`),
    "link over 1024": form400(`cmd=history&link=${"l".repeat(1025)}&crm_token=${CRM_TOKEN}`),
    "33 fields": form400(`${thirtyThree}&crm_token=${CRM_TOKEN}`),
    "empty JSON": json400(""),
    "empty object": json400("{}"),
    "JSON array": json400("[1]"),
    "JSON scalar": json400('"x"'),
    "nested object": json400(`{"cmd":"event","a":{"b":1},"crm_token":"${CRM_TOKEN}"}`),
    "nested array": json400(`{"cmd":"event","a":[1],"crm_token":"${CRM_TOKEN}"}`),
    "repeated JSON key": json400(`{"cmd":"event","cmd":"history","crm_token":"${CRM_TOKEN}"}`),
    "repeated JSON key (null first)": json400(`{"cmd":null,"cmd":"event","crm_token":"${CRM_TOKEN}"}`),
    "JSON __proto__": json400(`{"__proto__":"x","crm_token":"${CRM_TOKEN}"}`),
    "trailing JSON": json400(`{"cmd":"event","crm_token":"${CRM_TOKEN}"} x`),
    "unterminated JSON": json400(`{"cmd":"event","crm_token":"${CRM_TOKEN}"`),
    "JSON trailing comma": json400(`{"cmd":"event",}`),
    "the portal's comma-less example": json400(`{"cmd":"event"\n"type":"INCOMING"}`),
    "bad multipart": new Request(URL_, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=zz" },
      body: "not a multipart body",
    }),
    "multipart without a boundary": new Request(URL_, {
      method: "POST",
      headers: { "content-type": "multipart/form-data" },
      body: "--a\r\n\r\n",
    }),
  };
  const { handler, state } = harness({ limiter: new TelephonyFailureLimiter({ limit: 1000 }) });
  for (const [name, incoming] of Object.entries(cases)) {
    const response = await handler(incoming);
    assert.equal(response.status, 400, name);
    assert.deepEqual(await json(response), { error: "Invalid parameters" }, name);
  }
  assert.equal(state.clients, 0);
  assert.equal(state.calls.length, 0);
  assert.ok(state.logs.every((entry) => entry.parse_failed === true && entry.reason === "parse_failed"));
});

test("a multipart file part is refused", async () => {
  const body = new FormData();
  body.append("cmd", "event");
  body.append("crm_token", CRM_TOKEN);
  body.append("attachment", new Blob(["x"]), "x.txt");
  const { handler, state } = harness();
  const response = await handler(new Request(URL_, { method: "POST", body }));
  assert.equal(response.status, 400);
  assert.equal(state.clients, 0);
});

// ---------------------------------------------------------------- the key

test("a missing, wrong, truncated, extended or re-cased key is 401 and the database is never reached", async () => {
  const { handler, state } = harness({ limiter: new TelephonyFailureLimiter({ limit: 1000 }) });
  const wrong = [
    null,
    "",
    "wrong",
    CRM_TOKEN.toUpperCase(),
    CRM_TOKEN.slice(0, -1),
    `${CRM_TOKEN}0`,
    ` ${CRM_TOKEN}`,
    NEXT_TOKEN,
  ];
  for (const token of wrong) {
    const response = await handler(request(EVENT_FIELDS, { token }));
    assert.equal(response.status, 401, String(token));
    assert.deepEqual(await json(response), { error: "Invalid token" });
  }
  // Unknown and contact commands do not need a different key.
  for (const cmd of ["contact", "bogus", "history"]) {
    const response = await handler(request({ ...EVENT_FIELDS, cmd }, { token: "wrong" }));
    assert.equal(response.status, 401, cmd);
  }
  assert.equal(state.clients, 0);
  assert.equal(state.calls.length, 0);
});

test("the current and the next key are both accepted and the slot is reported", async () => {
  const env = environment({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT: NEXT_TOKEN });
  const { handler, state } = harness({ env });
  assert.equal((await handler(request(EVENT_FIELDS, { token: CRM_TOKEN }))).status, 200);
  assert.equal((await handler(request({ ...EVENT_FIELDS, callid: "c2" }, { token: NEXT_TOKEN }))).status, 200);
  assert.deepEqual(
    state.calls.map((call) => call.args.p_token_slot),
    ["current", "next"],
  );
  // Without a configured next key it is simply wrong.
  const single = harness();
  assert.equal((await single.handler(request(EVENT_FIELDS, { token: NEXT_TOKEN }))).status, 401);
});

// ---------------------------------------------------------------- contact

test("contact is 200 {} with no database access, whatever the switch or the backend state", async () => {
  const sample = {
    cmd: "contact",
    phone: "996555000111",
    diversion: "996312000222",
    callid: "synthetic-call-1",
  };
  for (const env of [
    environment(),
    environment({ EVO_PLATFORM_TELEPHONY_ENABLED: "0" }),
    environment({ EVO_PLATFORM_TELEPHONY_ENABLED: undefined }),
    environment({ EVO_PLATFORM_TELEPHONY_ENABLED: "true" }),
    environment({ EVO_PLATFORM_ORGANIZATION_ID: undefined }),
    environment({ EVO_PLATFORM_SUPABASE_SECRET_KEY: undefined, NEXT_PUBLIC_SUPABASE_URL: undefined }),
  ]) {
    const handler = createPlatformTelephonyInboundHandler({
      environment: env,
      log: () => undefined,
      ...forbiddenClient(),
    });
    const started = performance.now();
    const response = await handler(request(sample));
    const elapsed = performance.now() - started;
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(await response.text(), "{}");
    assert.ok(elapsed < 200, `contact took ${elapsed} ms`);
  }
  // Case and padding of the command do not turn it into something stored.
  const handler = createPlatformTelephonyInboundHandler({ environment: environment(), log: () => undefined, ...forbiddenClient() });
  assert.equal((await handler(request({ ...sample, cmd: " Contact " }))).status, 200);
});

test("contact with a wrong key is still 401, and with the key but no usable key configured 503", async () => {
  const { handler } = harness();
  assert.equal((await handler(request({ cmd: "contact" }, { token: "wrong" }))).status, 401);
  const unconfigured = harness({ env: environment({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN: undefined }) });
  assert.equal((await unconfigured.handler(request({ cmd: "contact" }))).status, 503);
});

// ---------------------------------------------------------------- the switch

test("with the switch off every other command is 503 and nothing is written", async () => {
  for (const value of ["0", "", undefined, "true", "yes", "01", " 1", "1 ", "2"]) {
    const { handler, state } = harness({
      env: environment({ EVO_PLATFORM_TELEPHONY_ENABLED: value }),
    });
    for (const fields of [EVENT_FIELDS, HISTORY_FIELDS, { cmd: "rating", rating: "5" }, { cmd: "bogus" }]) {
      const response = await handler(request(fields));
      assert.equal(response.status, 503, `${String(value)} ${fields.cmd}`);
      assert.deepEqual(await json(response), { error: "telephony_unavailable" });
    }
    assert.equal(state.clients, 0, String(value));
    assert.equal(state.calls.length, 0, String(value));
  }
});

test("an unconfigured backend is 503 for a documented command and 400 for an unknown one", async () => {
  const { handler, state } = harness({ env: environment({ EVO_PLATFORM_ORGANIZATION_ID: undefined }) });
  const event = await handler(request(EVENT_FIELDS));
  assert.equal(event.status, 503);
  assert.deepEqual(await json(event), { error: "telephony_unavailable" });
  const unknown = await handler(request({ cmd: "bogus" }));
  assert.equal(unknown.status, 400);
  assert.equal(state.clients, 0);
});

// ---------------------------------------------------------------- storing

test("event is stored by telephony_receive_v1 with cleaned fields, the slot and the SHA-256 of the raw body", async () => {
  const { handler, state } = harness();
  const incoming = request({ ...EVENT_FIELDS, type: "ACCEPTED" });
  const raw = await incoming.clone().text();
  const response = await handler(incoming);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "{}");
  assert.deepEqual(state.schemas, ["platform"]);
  assert.equal(state.calls.length, 1);
  const { functionName, args } = state.calls[0];
  assert.equal(functionName, "telephony_receive_v1");
  assert.deepEqual(Object.keys(args).sort(), [
    "p_body_sha256",
    "p_cmd",
    "p_fields",
    "p_form_shape",
    "p_organization_id",
    "p_recording_link",
    "p_request_id",
    "p_token_slot",
  ]);
  assert.equal(args.p_organization_id, ORGANIZATION_ID);
  assert.match(args.p_request_id, UUID_PATTERN);
  assert.equal(args.p_cmd, "event");
  assert.equal(args.p_token_slot, "current");
  assert.equal(args.p_body_sha256, sha256(raw));
  assert.deepEqual(args.p_fields, { ...EVENT_FIELDS, type: "ACCEPTED" });
  assert.equal(args.p_recording_link, null);
  assert.equal(args.p_form_shape, null);
  assert.equal(JSON.stringify(state.calls).includes(CRM_TOKEN), false);
  assert.equal(state.logs.at(-1).reason, "stored");
});

test("each request gets its own request id", async () => {
  const { handler, state } = harness();
  await handler(request(EVENT_FIELDS));
  await handler(request({ ...EVENT_FIELDS, callid: "c2" }));
  assert.notEqual(state.calls[0].args.p_request_id, state.calls[1].args.p_request_id);
});

test("history keeps the recording link out of the fields and passes it as its own argument", async () => {
  const link = "https://synthetic.example.test/records/0001.mp3";
  const { handler, state } = harness();
  const response = await handler(request({ ...HISTORY_FIELDS, link }));
  assert.equal(response.status, 200);
  const { args } = state.calls[0];
  assert.equal(args.p_recording_link, link);
  assert.deepEqual(args.p_fields, HISTORY_FIELDS);
  assert.equal(JSON.stringify(args.p_fields).includes("synthetic.example.test"), false);
  assert.equal(JSON.stringify(state.logs).includes("synthetic.example.test"), false);
  // An empty link is no link.
  await handler(request({ ...HISTORY_FIELDS, callid: "c2", link: "" }));
  assert.equal(state.calls[1].args.p_recording_link, null);
});

test("a link on event or rating is dropped, not stored", async () => {
  const { handler, state } = harness();
  await handler(request({ ...EVENT_FIELDS, link: "https://synthetic.example.test/a.mp3" }));
  await handler(request({ cmd: "rating", rating: "5", phone: "996555000111", callid: "c3", user: "u", link: "https://synthetic.example.test/b.mp3" }));
  for (const call of state.calls) {
    assert.equal(call.args.p_recording_link, null);
    assert.equal("link" in call.args.p_fields, false);
  }
});

test("only the nineteen documented fields travel; the rest is dropped and counted", async () => {
  const { handler, state } = harness();
  const response = await handler(
    request({
      ...EVENT_FIELDS,
      ext: "701",
      groupRealName: "Synthetic group",
      telnum: "996312000333",
      telnum_name: "Main",
      second_callid: "synthetic-call-2",
      record: "x",
      url: "y",
      Authorization: "z",
      secret: "w",
      CMD: "event",
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(state.calls[0].args.p_fields, {
    ...EVENT_FIELDS,
    ext: "701",
    groupRealName: "Synthetic group",
    telnum: "996312000333",
    telnum_name: "Main",
    second_callid: "synthetic-call-2",
  });
  assert.equal(state.logs.at(-1).dropped_fields, 5);
});

test("a free-text value that looks like a link is dropped before the writer", async () => {
  const { handler, state } = harness();
  await handler(
    request({
      ...EVENT_FIELDS,
      groupRealName: "see https://synthetic.example.test/x",
      telnum_name: "ftp:something",
      ext: "rec.MP3",
      telnum: "996312000333",
    }),
  );
  const fields = state.calls[0].args.p_fields;
  assert.equal("groupRealName" in fields, false);
  assert.equal("telnum_name" in fields, false);
  assert.equal("ext" in fields, false);
  assert.equal(fields.telnum, "996312000333");
  assert.equal(state.logs.at(-1).dropped_fields, 3);
});

test("rating is stored like event and history", async () => {
  const { handler, state } = harness();
  const response = await handler(
    request({ cmd: "rating", phone: "996555000111", rating: "4", user: "u", ext: "701", callid: "c9" }),
  );
  assert.equal(response.status, 200);
  assert.equal(state.calls[0].args.p_cmd, "rating");
});

test("the command is case and padding tolerant", async () => {
  const { handler, state } = harness();
  assert.equal((await handler(request({ ...EVENT_FIELDS, cmd: " Event " }))).status, 200);
  assert.equal(state.calls[0].args.p_cmd, "event");
});

test("the database answers decide the PBX answer", async () => {
  const answers = [
    [{ status: "stored", validation_state: "incomplete" }, 200, {}],
    [{ status: "deduplicated", event_id: "x" }, 200, { deduplicated: true }],
    [{ status: "replayed" }, 200, { deduplicated: true }],
    // The database kept only the form shape: acknowledged, never 5xx or 4xx.
    [{ status: "rejected", reason: "fields_check", reason_code: "e23514_x" }, 200, {}],
  ];
  for (const [data, status, body] of answers) {
    const { handler } = harness({ rpc: async () => ({ data, error: null }) });
    const response = await handler(request(EVENT_FIELDS));
    assert.equal(response.status, status, JSON.stringify(data));
    assert.deepEqual(await json(response), body);
  }
});

test("a failed or odd database answer is 503; a throw or a hang is 503 too", async () => {
  const failing = [
    async () => ({ data: null, error: { code: "PT503", message: "telephony_receive_failed:exx001" } }),
    async () => ({ data: null, error: { code: "42501" } }),
    async () => ({ data: null, error: null }),
    async () => ({ data: { status: "something_new" }, error: null }),
    async () => ({ data: ["stored"], error: null }),
    async () => {
      throw new Error("network");
    },
  ];
  for (const rpc of failing) {
    const { handler } = harness({ rpc });
    const response = await handler(request(EVENT_FIELDS));
    assert.equal(response.status, 503);
    assert.deepEqual(await json(response), { error: "telephony_unavailable" });
  }
  const hanging = harness({ rpc: () => new Promise(() => undefined), databaseDeadlineMs: 20 });
  const started = performance.now();
  const response = await hanging.handler(request(EVENT_FIELDS));
  assert.equal(response.status, 503);
  assert.ok(performance.now() - started < 1000);
});

// ---------------------------------------------------------------- unknown command

test("an unknown command stores only the form shape and is answered 400", async () => {
  const { handler, state } = harness();
  const link = "https://synthetic.example.test/z.mp3";
  const response = await handler(
    request({ cmd: "bogus", phone: "996555000111", note: "private words", link }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await json(response), { error: "Invalid parameters" });
  assert.equal(state.calls.length, 1);
  const { args } = state.calls[0];
  assert.equal(args.p_cmd, "bogus");
  assert.deepEqual(args.p_fields, {});
  assert.equal(args.p_recording_link, null);
  // Names and lengths only; the key is not part of the shape.
  assert.deepEqual(args.p_form_shape, { cmd: 5, phone: 12, note: 13, link: link.length });
  const sent = JSON.stringify(args);
  for (const secret of ["996555000111", "private words", "synthetic.example.test", CRM_TOKEN]) {
    assert.equal(sent.includes(secret), false, secret);
  }
});

test("a missing command is unknown too, and a failing store does not change the 400", async () => {
  const { handler, state } = harness({ rpc: async () => ({ data: null, error: { code: "PT503" } }) });
  const missing = await handler(request({ phone: "996555000111" }));
  assert.equal(missing.status, 400);
  assert.equal(state.calls[0].args.p_cmd, "");
  const throwing = harness({
    rpc: async () => {
      throw new Error("down");
    },
  });
  assert.equal((await throwing.handler(request({ cmd: "bogus" }))).status, 400);
});

// ---------------------------------------------------------------- limiter

test("more than 20 failures a minute from one address are 429 for a minute; a valid key is never stopped", async () => {
  let now = 1_000_000;
  const limiter = new TelephonyFailureLimiter({ now: () => now });
  const { handler, state } = harness({ limiter });
  const from = (address) => ({ "x-evo-telephony-ip": address });
  const statuses = [];
  for (let i = 0; i < 24; i += 1) {
    const response = await handler(request(EVENT_FIELDS, { token: "wrong", headers: from("203.0.113.9") }));
    statuses.push(response.status);
    if (response.status === 429) {
      assert.equal(response.headers.get("retry-after"), "60");
      assert.deepEqual(await json(response), { error: "rate_limited" });
    }
  }
  assert.deepEqual(statuses, [...Array(20).fill(401), ...Array(4).fill(429)]);

  // The blocked address still gets through with a valid key ...
  const stored = await handler(request(EVENT_FIELDS, { headers: from("203.0.113.9") }));
  assert.equal(stored.status, 200);
  assert.equal(state.calls.length, 1);
  // ... a parse failure from it is limited too, ...
  const unparsable = await handler(
    new Request(URL_, { method: "POST", headers: { "content-type": FORM, ...from("203.0.113.9") }, body: "" }),
  );
  assert.equal(unparsable.status, 429);
  // ... and another address is untouched.
  const other = await handler(request(EVENT_FIELDS, { token: "wrong", headers: from("203.0.113.10") }));
  assert.equal(other.status, 401);

  // A minute later the block has lapsed and counting starts again.
  now += 61_000;
  const later = await handler(request(EVENT_FIELDS, { token: "wrong", headers: from("203.0.113.9") }));
  assert.equal(later.status, 401);
});

test("the failure counter uses only the edge header; X-Forwarded-For and junk values do not move it", async () => {
  const limiter = new TelephonyFailureLimiter({ now: () => 1 });
  const { handler } = harness({ limiter });
  // Varying X-Forwarded-For cannot dodge the limit: no edge header, one bucket.
  const spoofed = [];
  for (let i = 0; i < 22; i += 1) {
    spoofed.push(
      (
        await handler(
          request(EVENT_FIELDS, { token: "wrong", headers: { "x-forwarded-for": `198.51.100.${i}` } }),
        )
      ).status,
    );
  }
  assert.deepEqual(spoofed.slice(20), [429, 429]);
  // A non-IP edge header falls into the same shared bucket.
  const junk = await handler(
    request(EVENT_FIELDS, { token: "wrong", headers: { "x-evo-telephony-ip": "not an ip" } }),
  );
  assert.equal(junk.status, 429);
  // IPv6 and case are normalised.
  const v6 = new TelephonyFailureLimiter({ now: () => 1, limit: 1 });
  assert.equal(v6.recordFailure("2001:db8::1"), false);
  assert.equal(v6.recordFailure("2001:db8::1"), true);
});

test("the limiter map is a bounded LRU", () => {
  const limiter = new TelephonyFailureLimiter({ now: () => 1, maxEntries: 3 });
  for (const address of ["a", "b", "c", "d", "e"]) limiter.recordFailure(address);
  assert.equal(limiter.size, 3);
  // Touching an entry keeps it; the oldest untouched one is evicted.
  const lru = new TelephonyFailureLimiter({ now: () => 1, maxEntries: 2, limit: 1 });
  lru.recordFailure("a");
  lru.recordFailure("b");
  lru.recordFailure("a"); // a is now over the limit and most recent
  lru.recordFailure("c"); // evicts b
  assert.equal(lru.recordFailure("a"), true, "a is still tracked and blocked");
  assert.equal(lru.recordFailure("b"), false, "b was evicted and starts again");
});

test("methods, a missing key configuration and a valid contact are not counted as failures", async () => {
  const limiter = new TelephonyFailureLimiter({ now: () => 1, limit: 1 });
  const { handler } = harness({ limiter });
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await handler(new Request(URL_, { method: "GET" }))).status, 405);
    assert.equal((await handler(request({ cmd: "contact" }))).status, 200);
    assert.equal((await handler(request({ cmd: "bogus" }))).status, 400);
  }
  assert.equal(limiter.size, 0);
});

// ---------------------------------------------------------------- logging

test("the application log carries counters only: no body, value, key, address or link", async () => {
  const link = "https://synthetic.example.test/records/secret-link.mp3";
  const { handler, state } = harness({ limiter: new TelephonyFailureLimiter({ limit: 1000 }) });
  await handler(request({ ...HISTORY_FIELDS, link }, { headers: { "x-evo-telephony-ip": "203.0.113.77" } }));
  await handler(request(EVENT_FIELDS, { token: LOG_PROBE_VALUE, headers: { "x-evo-telephony-ip": "203.0.113.77" } }));
  await handler(request({ cmd: "contact", phone: "996555000111" }));
  await handler(request({ cmd: "bogus", note: "private words" }));
  await handler(new Request(URL_, { method: "GET" }));
  await handler(
    new Request(URL_, {
      method: "POST",
      headers: { "content-type": "text/html; charset=utf-8; x=996555000111" },
      body: "x",
    }),
  );
  const allowedKeys = new Set([
    "event",
    "service",
    "status",
    "reason",
    "content_type",
    "body_bucket",
    "parse_failed",
    "cmd",
    "dropped_fields",
    "validation_state",
    "projection",
  ]);
  assert.ok(state.logs.length >= 6);
  for (const entry of state.logs) {
    assert.equal(entry.event, "telephony_inbound");
    for (const key of Object.keys(entry)) assert.ok(allowedKeys.has(key), key);
    assert.ok(String(entry.content_type).length <= 64);
    assert.match(String(entry.body_bucket), /^(none|le_1k|le_4k|le_32k|gt_32k)$/u);
  }
  const text = JSON.stringify(state.logs);
  for (const secret of [
    CRM_TOKEN,
    LOG_PROBE_VALUE,
    "996555000111",
    "synthetic.example.test",
    "secret-link",
    "private words",
    "203.0.113.77",
    "synthetic.manager",
  ]) {
    assert.equal(text.includes(secret), false, secret);
  }
  assert.deepEqual(
    state.logs.map((entry) => entry.reason),
    ["stored", "invalid_token", "contact", "unknown_cmd", "method_not_allowed", "unsupported_media_type"],
  );
});

test("an unexpected failure is a JSON 503 with a counter, never a framework error page", async () => {
  const logs = [];
  const handler = createPlatformTelephonyInboundHandler({
    environment: environment(),
    limiter: {
      recordFailure() {
        throw new Error("unexpected");
      },
    },
    log: (entry) => logs.push(entry),
    ...forbiddenClient(),
  });
  const response = await handler(request(EVENT_FIELDS, { token: "wrong" }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(await json(response), { error: "telephony_unavailable" });
  assert.deepEqual(logs, [
    { event: "telephony_inbound", service: "evo-crm", status: 503, reason: "internal_error" },
  ]);
  // The key still opens contact in the same handler.
  assert.equal((await handler(request({ cmd: "contact" }))).status, 200);
});

test("a throwing log sink never changes the answer", async () => {
  const handler = createPlatformTelephonyInboundHandler({
    environment: environment({ EVO_PLATFORM_TELEPHONY_ENABLED: "0" }),
    log: () => {
      throw new Error("log down");
    },
    ...forbiddenClient(),
  });
  assert.equal((await handler(request({ cmd: "contact" }))).status, 200);
});

// ---------------------------------------------------------------- route module

test("the route module serves every method through one handler with the default dependencies", async () => {
  const route = await import("../src/app/api/v2/telephony/beeline/inbound/route.ts");
  assert.equal(route.runtime, "nodejs");
  assert.equal(route.dynamic, "force-dynamic");
  for (const method of ["POST", "GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    assert.equal(typeof route[method], "function", method);
  }
  assert.deepEqual(
    Object.keys(route).sort(),
    ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "dynamic", "runtime"],
  );

  const names = [
    "EVO_PLATFORM_TELEPHONY_ENABLED",
    "EVO_PLATFORM_TELEPHONY_CRM_TOKEN",
    "EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT",
  ];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    delete process.env.EVO_PLATFORM_TELEPHONY_CRM_TOKEN;
    delete process.env.EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT;
    delete process.env.EVO_PLATFORM_TELEPHONY_ENABLED;
    const get = await route.GET(new Request(URL_, { method: "GET" }));
    assert.equal(get.status, 405);
    assert.equal(get.headers.get("allow"), "POST");
    // No key configured: 503 before anything is read.
    assert.equal((await route.POST(request({ cmd: "contact" }))).status, 503);

    // Production default: intake off, key present. contact answers; the rest does not.
    process.env.EVO_PLATFORM_TELEPHONY_CRM_TOKEN = CRM_TOKEN;
    process.env.EVO_PLATFORM_TELEPHONY_ENABLED = "0";
    const contact = await route.POST(request({ cmd: "contact", phone: "996555000111", callid: "c1" }));
    assert.equal(contact.status, 200);
    assert.equal(await contact.text(), "{}");
    assert.equal((await route.POST(request(EVENT_FIELDS))).status, 503);
    assert.equal((await route.POST(request(HISTORY_FIELDS))).status, 503);
    assert.equal((await route.POST(request(EVENT_FIELDS, { token: "wrong" }))).status, 401);
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test("the shipped examples keep the intake off and document every telephony name, empty", () => {
  const production = readFileSync(new URL("../deploy/env.production.example", import.meta.url), "utf8");
  const local = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  for (const example of [production, local]) {
    assert.match(example, /^EVO_PLATFORM_TELEPHONY_ENABLED=0$/mu);
    for (const name of [
      "EVO_PLATFORM_TELEPHONY_CRM_TOKEN",
      "EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT",
      "EVO_PLATFORM_TELEPHONY_PBX_TOKEN",
      "EVO_PLATFORM_TELEPHONY_PBX_URL",
      "EVO_PLATFORM_TELEPHONY_PBX_HOST",
    ]) {
      assert.match(example, new RegExp(`^${name}=$`, "mu"), name);
    }
    assert.doesNotMatch(example, /^NEXT_PUBLIC_.*TELEPHONY/mu);
  }
  // The hard precondition is stated next to the switch.
  assert.match(production, /HARD precondition[\s\S]*phone-erasure/u);
});
