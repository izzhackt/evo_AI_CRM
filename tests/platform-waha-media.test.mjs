import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isConnectedPlatformPrivateApi } from "../src/lib/platform-route-contract.ts";
import {
  createPlatformWahaMediaProvider,
  PlatformWahaMediaProviderError,
  requirePrivateWahaMediaUrl,
} from "../src/lib/server/platform-waha-media-client.ts";
import {
  loadPlatformWahaMediaConfig,
  PLATFORM_WAHA_MEDIA_MAX_BYTES,
  PlatformWahaMediaConfigurationError,
} from "../src/lib/server/platform-waha-media-config.ts";
import {
  classifyPlatformWahaMedia,
  createPlatformWahaMediaHandler,
  createPlatformWahaMediaRepository,
  createPlatformWahaMediaStorage,
  PlatformWahaMediaRepositoryError,
  PlatformWahaMediaStorageError,
} from "../src/lib/server/platform-waha-media-processor.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const WORK_ID = "22222222-2222-4222-8222-222222222222";
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";
const MEDIA_ID = "44444444-4444-4444-8444-444444444444";
const COMMUNICATION_MESSAGE_ID = "55555555-5555-4555-8555-555555555555";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";
const NOW_MS = 1_786_079_400_000;
const RAW_CHAT_ID = "996555123456@c.us";
const RAW_MESSAGE_ID = "false_996555123456@c.us_SYNTHETIC";
const OBJECT_NAME = `ab/${"c".repeat(62)}`;
const TRIGGER_SECRET = "synthetic-media-trigger-secret-value";
const WAHA_API_KEY = "synthetic-media-waha-api-key-value";
const SUPABASE_SECRET = ["sb", "secret", "synthetic_server_test_key_only"].join("_");
const ROUTE_URL =
  "http://localhost/api/internal/platform-messaging/waha/media";

const ENABLED_CONFIG = Object.freeze({
  enabled: true,
  organizationId: ORGANIZATION_ID,
  supabaseUrl: "http://127.0.0.1:54321",
  supabaseSecretKey: SUPABASE_SECRET,
  sessionName: "evo-inbox",
  wahaBaseUrl: "http://evo-inbox-waha:3000",
  wahaApiKey: WAHA_API_KEY,
  triggerSecret: TRIGGER_SECRET,
  workerRef: "nextjs:p5d-waha-media",
  bucket: "platform-whatsapp-media",
  maxBytes: 32,
  metadataMaxBytes: 4096,
  requestTimeoutMs: 5_000,
  visibilityTimeoutSeconds: 120,
  maxClockSkewMs: 5 * 60 * 1000,
});

function enabledEnvironment(overrides = {}) {
  return {
    EVO_PLATFORM_WAHA_MEDIA_ENABLED: "1",
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SUPABASE_SECRET,
    EVO_PLATFORM_WAHA_MEDIA_BASE_URL: "http://evo-inbox-waha:3000",
    EVO_PLATFORM_WAHA_MEDIA_API_KEY: WAHA_API_KEY,
    EVO_PLATFORM_WAHA_MEDIA_TRIGGER_SECRET: TRIGGER_SECRET,
    ...overrides,
  };
}

function configurationError(environment, code) {
  assert.throws(
    () => loadPlatformWahaMediaConfig(environment),
    (error) =>
      error instanceof PlatformWahaMediaConfigurationError &&
      error.code === code,
  );
}

function authorizedRequest(options = {}) {
  const requestId = options.requestId ?? REQUEST_ID;
  const timestamp = String(options.timestamp ?? NOW_MS);
  const headers = new Headers(options.headers);
  headers.set("x-evo-media-request-id", requestId);
  headers.set("x-evo-media-timestamp", timestamp);
  headers.set("x-evo-media-hmac-algorithm", "sha256");
  headers.set(
    "x-evo-media-hmac",
    createHmac("sha256", options.signingKey ?? TRIGGER_SECRET)
      .update(`${requestId}.${timestamp}`)
      .digest("hex"),
  );
  return new Request(ROUTE_URL, {
    method: options.method ?? "POST",
    headers,
    body: options.body,
  });
}

function claim(overrides = {}) {
  return Object.freeze({
    claimed: true,
    organizationId: ORGANIZATION_ID,
    workId: WORK_ID,
    attemptId: ATTEMPT_ID,
    mediaId: MEDIA_ID,
    communicationMessageId: COMMUNICATION_MESSAGE_ID,
    rawChatId: RAW_CHAT_ID,
    rawMessageId: RAW_MESSAGE_ID,
    direction: "inbound",
    objectName: OBJECT_NAME,
    leaseExpiresAt: new Date(NOW_MS + 60_000).toISOString(),
    leaseExpiresAtMs: NOW_MS + 60_000,
    attemptNumber: 1,
    maxAttempts: 5,
    ...overrides,
  });
}

function createRepository(options = {}) {
  const calls = [];
  let claimCount = 0;
  return {
    calls,
    async claim(input) {
      calls.push(["claim", input]);
      if (options.claimError) throw new Error("synthetic claim failure");
      claimCount += 1;
      if (options.replayEmpty && claimCount > 1) {
        return { claimed: false, queue: "platform_waha_media_v1" };
      }
      return options.claim ?? claim();
    },
    async finish(input) {
      calls.push(["finish", input]);
      if (options.finishError) throw new Error("synthetic finish failure");
      return {
        organizationId: input.organizationId,
        workId: input.workId,
        attemptId: input.attemptId,
        mediaId: options.finishMediaId ?? MEDIA_ID,
        state: options.finishState ?? input.outcome,
        outcome: options.finishOutcome ?? input.outcome,
      };
    },
  };
}

function createStorage(options = {}) {
  const calls = [];
  return {
    calls,
    async upload(input) {
      calls.push(input);
      if (options.error) throw new PlatformWahaMediaStorageError();
    },
  };
}

function createProvider(options = {}) {
  const calls = [];
  return {
    calls,
    async download(input) {
      calls.push(input);
      if (options.error) throw options.error;
      return {
        bytes: options.bytes ?? new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
        providerFileName: options.providerFileName ?? "customer photo.svg",
      };
    },
  };
}

function wahaMessage(overrides = {}) {
  return {
    session: "evo-inbox",
    id: RAW_MESSAGE_ID,
    from: RAW_CHAT_ID,
    to: "996555999999@c.us",
    fromMe: false,
    source: "app",
    hasMedia: true,
    media: {
      url: "http://evo-inbox-waha:3000/api/files/SYNTHETIC",
      filename: "invoice.svg",
    },
    ...overrides,
  };
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

async function body(response) {
  return response.json();
}

test("media configuration is disabled by default without reading any secret", () => {
  assert.deepEqual(
    loadPlatformWahaMediaConfig({
      EVO_PLATFORM_WAHA_MEDIA_API_KEY: "unsafe",
      EVO_PLATFORM_WAHA_MEDIA_TRIGGER_SECRET: "unsafe",
    }),
    { enabled: false },
  );
});

test("media configuration reuses only generic Platform backend and separate secrets", () => {
  const config = loadPlatformWahaMediaConfig(enabledEnvironment());
  assert.equal(config.enabled, true);
  assert.equal(config.sessionName, "evo-inbox");
  assert.equal(config.bucket, "platform-whatsapp-media");
  assert.equal(config.maxBytes, PLATFORM_WAHA_MEDIA_MAX_BYTES);
  assert.equal(config.wahaApiKey, WAHA_API_KEY);
  assert.equal(config.triggerSecret, TRIGGER_SECRET);
});

test("enabled media configuration fails closed for flags, backend, URL and secrets", () => {
  configurationError(
    enabledEnvironment({ EVO_PLATFORM_WAHA_MEDIA_ENABLED: "yes" }),
    "invalid_enabled_flag",
  );
  configurationError(
    enabledEnvironment({ EVO_PLATFORM_ORGANIZATION_ID: "" }),
    "platform_backend_not_configured",
  );
  for (const url of [
    "https://public.example",
    "http://user:password@evo-inbox-waha:3000",
    "http://evo-inbox-waha:3000/api",
    " http://evo-inbox-waha:3000",
  ]) {
    configurationError(
      enabledEnvironment({ EVO_PLATFORM_WAHA_MEDIA_BASE_URL: url }),
      url.startsWith(" ") ? "invalid_waha_base_url" : "unsafe_waha_base_url",
    );
  }
  for (const [key, code] of [
    ["EVO_PLATFORM_WAHA_MEDIA_BASE_URL", "missing_waha_base_url"],
    ["EVO_PLATFORM_WAHA_MEDIA_API_KEY", "missing_waha_api_key"],
    ["EVO_PLATFORM_WAHA_MEDIA_TRIGGER_SECRET", "missing_trigger_secret"],
  ]) {
    configurationError(enabledEnvironment({ [key]: "" }), code);
  }
  configurationError(
    enabledEnvironment({ EVO_PLATFORM_WAHA_MEDIA_API_KEY: "too-short" }),
    "unsafe_waha_api_key",
  );
  configurationError(
    enabledEnvironment({ EVO_PLATFORM_WAHA_MEDIA_TRIGGER_SECRET: ` ${TRIGGER_SECRET}` }),
    "unsafe_trigger_secret",
  );
});

test("private media URL accepts only exact configured origin and /api/files path", () => {
  const accepted = requirePrivateWahaMediaUrl(
    "http://evo-inbox-waha:3000/api/files/media.bin?token=opaque",
    "http://evo-inbox-waha:3000",
  );
  assert.equal(accepted.pathname, "/api/files/media.bin");
  for (const value of [
    "https://public.example/api/files/media.bin",
    "http://evo-inbox-waha:3001/api/files/media.bin",
    "http://evo-inbox-waha:3000/api/sessions",
    "http://evo-inbox-waha:3000/api/files/../sessions",
    "http://user:pass@evo-inbox-waha:3000/api/files/media.bin",
    "http://evo-inbox-waha:3000/api/files/",
    "http://evo-inbox-waha:3000/api/files/media.bin#secret",
  ]) {
    assert.throws(
      () => requirePrivateWahaMediaUrl(value, ENABLED_CONFIG.wahaBaseUrl),
      (error) =>
        error instanceof PlatformWahaMediaProviderError &&
        error.code === "unsafe_media_url" &&
        error.disposition === "terminal_error",
    );
  }
});

test("magic-byte classifier detects only the approved inline formats", () => {
  const fixtures = [
    [[0xff, 0xd8, 0xff], "image", "image/jpeg", "jpg"],
    [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image", "image/png", "png"],
    [[...Buffer.from("RIFF0000WEBP")], "image", "image/webp", "webp"],
    [[...Buffer.from("GIF89a")], "image", "image/gif", "gif"],
    [[0, 0, 0, 0, ...Buffer.from("ftypisom")], "video", "video/mp4", "mp4"],
    [[...Buffer.from("OggS")], "audio", "audio/ogg", "ogg"],
    [[...Buffer.from("ID3")], "audio", "audio/mpeg", "mp3"],
    [[0xff, 0xfb], "audio", "audio/mpeg", "mp3"],
    [[...Buffer.from("RIFF0000WAVE")], "audio", "audio/wav", "wav"],
  ];
  for (const [signature, mediaKind, mimeType, extension] of fixtures) {
    const metadata = classifyPlatformWahaMedia(
      new Uint8Array(signature),
      "../unsafe customer.svg",
    );
    assert.equal(metadata.mediaKind, mediaKind);
    assert.equal(metadata.mimeType, mimeType);
    assert.equal(metadata.inlineSafe, true);
    assert.match(metadata.fileName, new RegExp(`\\.${extension}$`));
    assert.doesNotMatch(metadata.fileName, /[\\/<>]/);
  }

  const pdf = classifyPlatformWahaMedia(
    Buffer.from("%PDF-1.7"),
    "unsafe.svg",
  );
  assert.deepEqual(pdf, {
    mediaKind: "pdf",
    mimeType: "application/pdf",
    fileName: "unsafe.pdf",
    inlineSafe: false,
  });
});

test("HTML, SVG, HEIC and unknown bytes stay octet-stream and download-only", () => {
  for (const bytes of [
    Buffer.from("<html><script>alert(1)</script></html>"),
    Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
    Buffer.from([0, 0, 0, 0, ...Buffer.from("ftypheic")]),
    Buffer.from([0, 1, 2, 3]),
  ]) {
    const metadata = classifyPlatformWahaMedia(bytes, ".payload.html");
    assert.deepEqual(metadata, {
      mediaKind: "file",
      mimeType: "application/octet-stream",
      fileName: "payload.bin",
      inlineSafe: false,
    });
  }
});

test("provider performs only exact read-only lookup and private file GET", async () => {
  const calls = [];
  const provider = createPlatformWahaMediaProvider(ENABLED_CONFIG, {
    async fetch(url, init) {
      calls.push([String(url), init]);
      if (calls.length === 1) return jsonResponse(wahaMessage());
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]));
    },
  });
  const result = await provider.download({
    rawChatId: RAW_CHAT_ID,
    rawMessageId: RAW_MESSAGE_ID,
    direction: "inbound",
  });
  assert.equal(result.providerFileName, "invoice.svg");
  assert.deepEqual([...result.bytes], [0xff, 0xd8, 0xff, 0]);
  assert.equal(
    calls[0][0],
    `http://evo-inbox-waha:3000/api/evo-inbox/chats/${encodeURIComponent(RAW_CHAT_ID)}/messages/${encodeURIComponent(RAW_MESSAGE_ID)}?downloadMedia=true`,
  );
  assert.equal(calls[1][0], "http://evo-inbox-waha:3000/api/files/SYNTHETIC");
  for (const [url, init] of calls) {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("x-api-key"), WAHA_API_KEY);
    assert.doesNotMatch(url, /send|read|logout|restart/i);
  }
});

test("provider accepts the printable upstream P5C message-id contract", async () => {
  const printableMessageId = "false_996555123456@c.us_A+B/C=D";
  const calls = [];
  const provider = createPlatformWahaMediaProvider(ENABLED_CONFIG, {
    async fetch(url) {
      calls.push(String(url));
      if (calls.length === 1) {
        return jsonResponse(wahaMessage({ id: printableMessageId }));
      }
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]));
    },
  });

  await assert.doesNotReject(() =>
    provider.download({
      rawChatId: RAW_CHAT_ID,
      rawMessageId: printableMessageId,
      direction: "inbound",
    }),
  );
  assert.match(calls[0], new RegExp(encodeURIComponent(printableMessageId)));
});

test("provider rejects malformed claim identities before any network call", async () => {
  let calls = 0;
  const provider = createPlatformWahaMediaProvider(ENABLED_CONFIG, {
    fetch: async () => {
      calls += 1;
      throw new Error("must not run");
    },
  });
  for (const input of [
    { rawChatId: "group@g.us", rawMessageId: RAW_MESSAGE_ID, direction: "inbound" },
    { rawChatId: RAW_CHAT_ID, rawMessageId: "bad id", direction: "inbound" },
  ]) {
    await assert.rejects(
      () => provider.download(input),
      (error) =>
        error instanceof PlatformWahaMediaProviderError &&
        error.code === "provider_identity_mismatch" &&
        error.disposition === "terminal_error",
    );
  }
  assert.equal(calls, 0);
});

test("provider requires exact session, direct chat, message, direction and source", async () => {
  const invalid = [
    { session: "other" },
    { id: "other" },
    { from: "996555000000@c.us" },
    { fromMe: true },
    { hasMedia: false },
    { source: "API" },
  ];
  for (const override of invalid) {
    const provider = createPlatformWahaMediaProvider(ENABLED_CONFIG, {
      fetch: async () => jsonResponse(wahaMessage(override)),
    });
    await assert.rejects(
      () => provider.download({ rawChatId: RAW_CHAT_ID, rawMessageId: RAW_MESSAGE_ID, direction: "inbound" }),
      (error) =>
        error instanceof PlatformWahaMediaProviderError &&
        error.code === "provider_identity_mismatch" &&
        error.disposition === "terminal_error",
    );
  }
});

test("provider accepts exact outbound history and rejects direction mismatches", async () => {
  let calls = 0;
  const outbound = createPlatformWahaMediaProvider(ENABLED_CONFIG, {
    async fetch() {
      calls += 1;
      return calls === 1
        ? jsonResponse(wahaMessage({
            from: "996555999999@c.us",
            to: RAW_CHAT_ID,
            fromMe: true,
            source: "api",
          }))
        : new Response(new Uint8Array([0xff, 0xd8, 0xff]));
    },
  });
  await assert.doesNotReject(() =>
    outbound.download({
      rawChatId: RAW_CHAT_ID,
      rawMessageId: RAW_MESSAGE_ID,
      direction: "outbound",
    }),
  );

  for (const override of [
    { fromMe: false, to: RAW_CHAT_ID },
    { fromMe: true, to: "996555000000@c.us" },
  ]) {
    const provider = createPlatformWahaMediaProvider(ENABLED_CONFIG, {
      fetch: async () => jsonResponse(wahaMessage(override)),
    });
    await assert.rejects(
      () => provider.download({
        rawChatId: RAW_CHAT_ID,
        rawMessageId: RAW_MESSAGE_ID,
        direction: "outbound",
      }),
      (error) =>
        error instanceof PlatformWahaMediaProviderError &&
        error.code === "provider_identity_mismatch",
    );
  }
});

test("missing provider media URL and reported download errors are retryable", async () => {
  for (const media of [{}, { url: "", error: null }, { url: "x", error: "not downloaded" }]) {
    const provider = createPlatformWahaMediaProvider(ENABLED_CONFIG, {
      fetch: async () => jsonResponse(wahaMessage({ media })),
    });
    await assert.rejects(
      () => provider.download({ rawChatId: RAW_CHAT_ID, rawMessageId: RAW_MESSAGE_ID, direction: "inbound" }),
      (error) =>
        error instanceof PlatformWahaMediaProviderError &&
        error.code === "provider_media_unavailable" &&
        error.disposition === "retryable_error",
    );
  }
});

test("provider and file transport failures are retryable and redirects are rejected", async () => {
  const network = createPlatformWahaMediaProvider(ENABLED_CONFIG, {
    fetch: async () => { throw new Error("network"); },
  });
  await assert.rejects(
    () => network.download({ rawChatId: RAW_CHAT_ID, rawMessageId: RAW_MESSAGE_ID, direction: "inbound" }),
    (error) =>
      error instanceof PlatformWahaMediaProviderError &&
      error.code === "provider_message_unavailable" &&
      error.disposition === "retryable_error",
  );

  for (const redirectAt of [1, 2]) {
    let calls = 0;
    const provider = createPlatformWahaMediaProvider(ENABLED_CONFIG, {
      async fetch() {
        calls += 1;
        const response =
          calls === 1
            ? jsonResponse(wahaMessage())
            : new Response(new Uint8Array([1]));
        if (calls === redirectAt) {
          Object.defineProperty(response, "redirected", { value: true });
        }
        return response;
      },
    });
    await assert.rejects(
      () => provider.download({ rawChatId: RAW_CHAT_ID, rawMessageId: RAW_MESSAGE_ID, direction: "inbound" }),
      PlatformWahaMediaProviderError,
    );
  }
});

test("provider rejects declared and streamed oversize media, malformed length and empty bodies", async () => {
  for (const responseFactory of [
    () => new Response(new Uint8Array([1]), { headers: { "content-length": "33" } }),
    () => new Response(new Uint8Array(33)),
  ]) {
    let calls = 0;
    const provider = createPlatformWahaMediaProvider(ENABLED_CONFIG, {
      async fetch() {
        calls += 1;
        return calls === 1 ? jsonResponse(wahaMessage()) : responseFactory();
      },
    });
    await assert.rejects(
      () => provider.download({ rawChatId: RAW_CHAT_ID, rawMessageId: RAW_MESSAGE_ID, direction: "inbound" }),
      (error) =>
        error instanceof PlatformWahaMediaProviderError &&
        error.code === "media_too_large" &&
        error.disposition === "terminal_error",
    );
  }

  for (const responseFactory of [
    () => new Response(new Uint8Array([1]), { headers: { "content-length": "NaN" } }),
    () => new Response(null),
  ]) {
    let calls = 0;
    const provider = createPlatformWahaMediaProvider(ENABLED_CONFIG, {
      async fetch() {
        calls += 1;
        return calls === 1 ? jsonResponse(wahaMessage()) : responseFactory();
      },
    });
    await assert.rejects(
      () => provider.download({ rawChatId: RAW_CHAT_ID, rawMessageId: RAW_MESSAGE_ID, direction: "inbound" }),
      PlatformWahaMediaProviderError,
    );
  }
});

test("handler authenticates a bodyless HMAC request before claiming work", async () => {
  const repository = createRepository();
  const handler = createPlatformWahaMediaHandler({
    config: ENABLED_CONFIG,
    repository,
    storage: createStorage(),
    provider: createProvider(),
    nowMs: () => NOW_MS,
  });
  for (const request of [
    new Request(ROUTE_URL, { method: "POST" }),
    authorizedRequest({ signingKey: "wrong-media-trigger-secret-value" }),
    authorizedRequest({ timestamp: NOW_MS - ENABLED_CONFIG.maxClockSkewMs - 1 }),
    authorizedRequest({ method: "PUT" }),
    authorizedRequest({ body: "{}" }),
  ]) {
    const response = await handler(request);
    assert.equal(response.status, request.method === "PUT" || request.body ? 400 : 401);
  }
  assert.equal(repository.calls.length, 0);
});

test("disabled handler fails closed", async () => {
  const response = await createPlatformWahaMediaHandler({ config: { enabled: false } })(
    authorizedRequest(),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await body(response), { ok: false, error: "media_disabled" });
});

test("handler reports an empty durable queue without provider or Storage work", async () => {
  const repository = createRepository({
    claim: { claimed: false, queue: "platform_waha_media_v1" },
  });
  const provider = createProvider();
  const storage = createStorage();
  const response = await createPlatformWahaMediaHandler({
    config: ENABLED_CONFIG,
    repository,
    provider,
    storage,
    nowMs: () => NOW_MS,
  })(authorizedRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), { ok: true, claimed: false });
  assert.equal(provider.calls.length, 0);
  assert.equal(storage.calls.length, 0);
});

test("handler archives under the exclusive lease with safe metadata and digest", async () => {
  const repository = createRepository();
  const provider = createProvider();
  const storage = createStorage();
  const response = await createPlatformWahaMediaHandler({
    config: ENABLED_CONFIG,
    repository,
    provider,
    storage,
    nowMs: () => NOW_MS,
  })(authorizedRequest());
  assert.equal(response.status, 200);
  const responseBody = await body(response);
  assert.deepEqual(responseBody, {
    ok: true,
    claimed: true,
    outcome: "archived",
    state: "archived",
  });
  assert.deepEqual(provider.calls, [{
    rawChatId: RAW_CHAT_ID,
    rawMessageId: RAW_MESSAGE_ID,
    direction: "inbound",
  }]);
  assert.equal(storage.calls.length, 1);
  assert.equal(storage.calls[0].bucket, "platform-whatsapp-media");
  assert.equal(storage.calls[0].objectName, OBJECT_NAME);
  assert.equal(storage.calls[0].mimeType, "image/jpeg");
  const finish = repository.calls.find(([name]) => name === "finish")[1];
  assert.equal(finish.mediaKind, "image");
  assert.equal(finish.mimeType, "image/jpeg");
  assert.equal(finish.fileName, "customer-photo.jpg");
  assert.equal(finish.sizeBytes, 4);
  assert.match(finish.sha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(responseBody), new RegExp(RAW_CHAT_ID));
  assert.doesNotMatch(JSON.stringify(responseBody), new RegExp(RAW_MESSAGE_ID));
});

test("expired lease is retryable and prevents Storage upload", async () => {
  const repository = createRepository({
    claim: claim({
      leaseExpiresAt: new Date(NOW_MS).toISOString(),
      leaseExpiresAtMs: NOW_MS,
    }),
  });
  const storage = createStorage();
  const response = await createPlatformWahaMediaHandler({
    config: ENABLED_CONFIG,
    repository,
    provider: createProvider(),
    storage,
    nowMs: () => NOW_MS,
  })(authorizedRequest());
  assert.equal(response.status, 200);
  assert.equal(storage.calls.length, 0);
  const finish = repository.calls.find(([name]) => name === "finish")[1];
  assert.equal(finish.outcome, "retryable_error");
  assert.equal(finish.errorCode, "lease_expired");
  assert.equal(finish.sha256, null);
});

test("provider failures persist their exact retryable or terminal disposition", async () => {
  for (const error of [
    new PlatformWahaMediaProviderError("retryable_error", "provider_media_unavailable"),
    new PlatformWahaMediaProviderError("terminal_error", "provider_identity_mismatch"),
  ]) {
    const repository = createRepository();
    const response = await createPlatformWahaMediaHandler({
      config: ENABLED_CONFIG,
      repository,
      provider: createProvider({ error }),
      storage: createStorage(),
      nowMs: () => NOW_MS,
    })(authorizedRequest());
    assert.equal(response.status, 200);
    const finish = repository.calls.find(([name]) => name === "finish")[1];
    assert.equal(finish.outcome, error.disposition);
    assert.equal(finish.errorCode, error.code);
    assert.equal(finish.mediaKind, null);
  }
});

test("final retryable attempt may be resolved terminal only when the retry budget is exhausted", async () => {
  const failure = new PlatformWahaMediaProviderError(
    "retryable_error",
    "provider_media_unavailable",
  );
  for (const [attemptNumber, expectedStatus] of [[5, 200], [4, 503]]) {
    const repository = createRepository({
      claim: claim({ attemptNumber, maxAttempts: 5 }),
      finishState: "terminal_error",
      finishOutcome: "terminal_error",
    });
    const response = await createPlatformWahaMediaHandler({
      config: ENABLED_CONFIG,
      repository,
      provider: createProvider({ error: failure }),
      storage: createStorage(),
      nowMs: () => NOW_MS,
    })(authorizedRequest());
    assert.equal(response.status, expectedStatus);
  }
});

test("Storage failure is retryable and never claims success", async () => {
  const repository = createRepository();
  const response = await createPlatformWahaMediaHandler({
    config: ENABLED_CONFIG,
    repository,
    provider: createProvider(),
    storage: createStorage({ error: true }),
    nowMs: () => NOW_MS,
  })(authorizedRequest());
  assert.equal(response.status, 200);
  const finish = repository.calls.find(([name]) => name === "finish")[1];
  assert.equal(finish.outcome, "retryable_error");
  assert.equal(finish.errorCode, "storage_unavailable");
});

test("unknown finish result after upload fails closed without deleting a potentially committed object", async () => {
  const repository = createRepository({ finishMediaId: WORK_ID });
  const storage = createStorage();
  const response = await createPlatformWahaMediaHandler({
    config: ENABLED_CONFIG,
    repository,
    provider: createProvider(),
    storage,
    nowMs: () => NOW_MS,
  })(authorizedRequest());
  assert.equal(response.status, 503);
  assert.equal(storage.calls.length, 1);
  assert.equal("remove" in storage, false);
});

test("replayed trigger keeps deterministic claim id and does not repeat provider work", async () => {
  const repository = createRepository({ replayEmpty: true });
  const provider = createProvider();
  const handler = createPlatformWahaMediaHandler({
    config: ENABLED_CONFIG,
    repository,
    provider,
    storage: createStorage(),
    nowMs: () => NOW_MS,
  });
  assert.equal((await handler(authorizedRequest())).status, 200);
  assert.equal((await handler(authorizedRequest())).status, 200);
  const claims = repository.calls.filter(([name]) => name === "claim");
  assert.equal(claims.length, 2);
  assert.equal(claims[0][1].requestId, claims[1][1].requestId);
  assert.equal(provider.calls.length, 1);
});

test("Supabase repository uses only exact media claim and finish RPC shapes", async () => {
  const calls = [];
  const client = {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name, parameters) {
          calls.push([name, parameters]);
          if (name === "claim_waha_media_archive") {
            return {
              error: null,
              data: {
                claimed: true,
                organization_id: ORGANIZATION_ID,
                work_id: WORK_ID,
                attempt_id: ATTEMPT_ID,
                media_id: MEDIA_ID,
                communication_message_id: COMMUNICATION_MESSAGE_ID,
                raw_chat_id: RAW_CHAT_ID,
                raw_message_id: RAW_MESSAGE_ID,
                direction: "inbound",
                object_name: OBJECT_NAME,
                lease_expires_at: new Date(NOW_MS + 60_000).toISOString(),
                attempt_number: 1,
                max_attempts: 5,
              },
            };
          }
          return {
            error: null,
            data: {
              organization_id: ORGANIZATION_ID,
              work_id: WORK_ID,
              attempt_id: ATTEMPT_ID,
              media_id: MEDIA_ID,
              state: "archived",
              outcome: "archived",
            },
          };
        },
      };
    },
  };
  const repository = createPlatformWahaMediaRepository(client);
  const claimed = await repository.claim({
    organizationId: ORGANIZATION_ID,
    workerRef: "nextjs:p5d-waha-media",
    visibilityTimeoutSeconds: 120,
    requestId: REQUEST_ID,
  });
  assert.equal(claimed.claimed, true);
  await repository.finish({
    organizationId: ORGANIZATION_ID,
    workId: WORK_ID,
    attemptId: ATTEMPT_ID,
    outcome: "archived",
    errorCode: null,
    mediaKind: "pdf",
    mimeType: "application/pdf",
    fileName: "document.pdf",
    sizeBytes: 4,
    sha256: "a".repeat(64),
    requestId: REQUEST_ID,
  });
  assert.deepEqual(calls.map(([name]) => name), [
    "claim_waha_media_archive",
    "finish_waha_media_archive",
  ]);
  assert.deepEqual(calls[1][1], {
    p_organization_id: ORGANIZATION_ID,
    p_work_id: WORK_ID,
    p_attempt_id: ATTEMPT_ID,
    p_outcome: "archived",
    p_error_code: null,
    p_media_kind: "pdf",
    p_mime_type: "application/pdf",
    p_file_name: "document.pdf",
    p_size_bytes: 4,
    p_sha256: "a".repeat(64),
    p_request_id: REQUEST_ID,
  });
});

test("repository rejects malformed, cross-organization and unknown results", async () => {
  for (const data of [
    { claimed: false, queue: "wrong" },
    { claimed: true },
    {
      claimed: true,
      organization_id: ORGANIZATION_ID,
      work_id: WORK_ID,
      attempt_id: ATTEMPT_ID,
      media_id: MEDIA_ID,
      communication_message_id: COMMUNICATION_MESSAGE_ID,
      raw_chat_id: RAW_CHAT_ID,
      raw_message_id: RAW_MESSAGE_ID,
      direction: "inbound",
      object_name: "../escape",
      lease_expires_at: "invalid",
      attempt_number: 6,
      max_attempts: 5,
    },
  ]) {
    const repository = createPlatformWahaMediaRepository({
      schema: () => ({ rpc: async () => ({ error: null, data }) }),
    });
    await assert.rejects(
      () => repository.claim({
        organizationId: ORGANIZATION_ID,
        workerRef: "nextjs:p5d-waha-media",
        visibilityTimeoutSeconds: 120,
        requestId: REQUEST_ID,
      }),
      PlatformWahaMediaRepositoryError,
    );
  }
});

test("Storage adapter creates one append-only private object without overwrite", async () => {
  const calls = [];
  const client = {
    storage: {
      from(bucket) {
        calls.push(["from", bucket]);
        return {
          async upload(objectName, bytes, options) {
            calls.push(["upload", objectName, [...bytes], options]);
            return { error: null };
          },
        };
      },
    },
  };
  await createPlatformWahaMediaStorage(client).upload({
    bucket: "platform-whatsapp-media",
    objectName: OBJECT_NAME,
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "application/octet-stream",
    sha256: "a".repeat(64),
  });
  assert.deepEqual(calls, [
    ["from", "platform-whatsapp-media"],
    [
      "upload",
      OBJECT_NAME,
      [1, 2, 3],
      {
        contentType: "application/octet-stream",
        cacheControl: "0",
        upsert: false,
        metadata: { sha256: "a".repeat(64) },
      },
    ],
  ]);
});

test("Storage conflict is idempotent only when existing private bytes and metadata match", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const sha256 = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
  function client(existingBytes, metadataSha = sha256) {
    return {
      storage: {
        from() {
          return {
            upload: async () => ({ error: { message: "already exists" } }),
            info: async () => ({
              error: null,
              data: {
                size: existingBytes.byteLength,
                contentType: "application/octet-stream",
                metadata: { sha256: metadataSha },
              },
            }),
            download: async () => ({
              error: null,
              data: new Blob([existingBytes]),
            }),
          };
        },
      },
    };
  }
  await assert.doesNotReject(() =>
    createPlatformWahaMediaStorage(client(bytes)).upload({
      bucket: "platform-whatsapp-media",
      objectName: OBJECT_NAME,
      bytes,
      mimeType: "application/octet-stream",
      sha256,
    }),
  );
  await assert.rejects(
    () => createPlatformWahaMediaStorage(
      client(new Uint8Array([1, 2, 4]), "b".repeat(64)),
    ).upload({
      bucket: "platform-whatsapp-media",
      objectName: OBJECT_NAME,
      bytes,
      mimeType: "application/octet-stream",
      sha256,
    }),
    (error) =>
      error instanceof PlatformWahaMediaStorageError &&
      error.disposition === "terminal_error" &&
      error.code === "storage_conflict",
  );
});

test("route and example env keep the capability server-only and disabled", async () => {
  const [route, proxy, environment] = await Promise.all([
    readFile("src/app/api/internal/platform-messaging/waha/media/route.ts", "utf8"),
    readFile("src/proxy.ts", "utf8"),
    readFile(".env.example", "utf8"),
  ]);
  assert.match(route, /runtime = "nodejs"/);
  assert.match(route, /createPlatformWahaMediaHandler/);
  assert.equal(
    isConnectedPlatformPrivateApi(
      "/api/internal/platform-messaging/waha/media",
    ),
    true,
  );
  assert.equal(
    isConnectedPlatformPrivateApi(
      "/api/internal/platform-messaging/waha/media/extra",
    ),
    false,
  );
  assert.match(proxy, /isConnectedPlatformPrivateApi\(path\)/);
  assert.match(environment, /EVO_PLATFORM_WAHA_MEDIA_ENABLED=0/);
  assert.match(environment, /EVO_PLATFORM_WAHA_MEDIA_BASE_URL=/);
  assert.match(environment, /EVO_PLATFORM_WAHA_MEDIA_API_KEY=/);
  assert.match(environment, /EVO_PLATFORM_WAHA_MEDIA_TRIGGER_SECRET=/);
  assert.doesNotMatch(environment, /NEXT_PUBLIC_.*WAHA_MEDIA/);
});
