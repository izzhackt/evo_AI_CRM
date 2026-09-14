import assert from "node:assert/strict";
import test from "node:test";
import { readUniversityTemplateStream, uploadUniversityTemplateSource, readUniversityTemplateSource, awaitUniversityTemplateOperation } from "../src/lib/server/university-template-source-storage.ts";

test("template stream enforces the byte limit even without a Content-Length header", async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); controller.close(); } });
  await assert.rejects(readUniversityTemplateStream(stream, 4, new AbortController().signal), { code: "source_mismatch" });
});

test("private template upload sends one create-only request and never follows a redirect", async () => {
  let calls = 0;
  const source = { bucket_id: "platform-document-templates", object_name: "72000000-0000-4000-8000-000000000001/72000000-0000-4000-8000-000000000002/72000000-0000-4000-8000-000000000003.pdf", mime_type: "application/pdf" };
  // HTTP transport fixture only: a 307 is not accepted as a successful Storage write.
  await assert.rejects(uploadUniversityTemplateSource(source, Buffer.from("synthetic"),
    { supabaseUrl: "http://127.0.0.1:54321", supabaseSecretKey: "synthetic-transport-only" },
    new AbortController().signal, async (url, init) => {
      calls++; assert.equal(init.method, "POST"); assert.equal(init.redirect, "error");
      assert.equal(init.headers["x-upsert"], "false"); assert.equal(init.cache, "no-store");
      assert.equal(url, `http://127.0.0.1:54321/storage/v1/object/${source.bucket_id}/${source.object_name}`);
      return new Response(null, { status: 307 });
    }), { code: "storage_unavailable" });
  assert.equal(calls, 1);
});

test("stored bytes require exact MIME and bounded size before any receipt can use them", async () => {
  const source = { bucket_id: "platform-document-templates", object_name: "72000000-0000-4000-8000-000000000001/72000000-0000-4000-8000-000000000002/72000000-0000-4000-8000-000000000003.pdf", mime_type: "application/pdf", byte_size: 4 };
  await assert.rejects(readUniversityTemplateSource(source,
    { supabaseUrl: "http://127.0.0.1:54321", supabaseSecretKey: "synthetic-transport-only" },
    new AbortController().signal, async () => new Response("test", { headers: { "content-type": "text/plain" } })),
  { code: "integrity_failed" });
});

test("new opaque secret keys travel only as apikey, never as a JWT bearer", async () => {
  const source = { bucket_id: "platform-document-templates", object_name: "72000000-0000-4000-8000-000000000001/72000000-0000-4000-8000-000000000002/72000000-0000-4000-8000-000000000003.pdf", mime_type: "application/pdf" };
  const key = "sb_secret_synthetic_transport_only_123";
  let headers;
  await assert.rejects(uploadUniversityTemplateSource(source, Buffer.from("synthetic"), { supabaseUrl: "http://127.0.0.1:54321", supabaseSecretKey: key },
    new AbortController().signal, async (_url, init) => { headers = init.headers; return new Response(null, { status: 403 }); }));
  assert.equal(headers.apikey, key); assert.equal(headers.authorization, undefined);
});

test("abort between scheduling and dispatch prevents starting the external operation", async () => {
  const stop = new AbortController(); let calls = 0;
  const pending = awaitUniversityTemplateOperation(() => { calls++; return Promise.resolve(); }, stop.signal);
  stop.abort(); await assert.rejects(pending, { code: "expired" }); assert.equal(calls, 0);
});

test("body lifetime stays bounded when both stream pull and cancellation ignore abort", async () => {
  const stop = new AbortController();
  const stream = new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } });
  const result = readUniversityTemplateStream(stream, 10, stop.signal);
  stop.abort(); await assert.rejects(result, { code: "expired" });
});

test("tiny-chunk floods cannot allocate an unbounded chunk index", async () => {
  let n = 0;
  const stream = new ReadableStream({ pull(controller) { if (n++ < 4097) controller.enqueue(new Uint8Array(1)); else controller.close(); } });
  await assert.rejects(readUniversityTemplateStream(stream, 5000, new AbortController().signal), { code: "source_mismatch" });
});

for (const [code, missing] of [["NoSuchKey", true], ["NoSuchBucket", false], ["AccessDenied", false]]) {
  test(`private object absence requires object-specific ${code} classification`, async () => {
    const source = { bucket_id: "platform-document-templates", object_name: "72000000-0000-4000-8000-000000000001/72000000-0000-4000-8000-000000000002/72000000-0000-4000-8000-000000000003.pdf", mime_type: "application/pdf", byte_size: 4 };
    const result = readUniversityTemplateSource(source, { supabaseUrl: "http://127.0.0.1:54321", supabaseSecretKey: "synthetic" },
      new AbortController().signal, async () => Response.json({ code, message: "private unlogged response" }, { status: 404 }));
    if (missing) assert.equal(await result, null); else await assert.rejects(result, { code: "storage_unavailable" });
  });
}

test("stored byte stream is bounded even with absent Content-Length", async () => {
  const source = { bucket_id: "platform-document-templates", object_name: "72000000-0000-4000-8000-000000000001/72000000-0000-4000-8000-000000000002/72000000-0000-4000-8000-000000000003.pdf", mime_type: "application/pdf", byte_size: 4 };
  await assert.rejects(readUniversityTemplateSource(source, { supabaseUrl: "http://127.0.0.1:54321", supabaseSecretKey: "synthetic" },
    new AbortController().signal, async () => new Response("oversize", { headers: { "content-type": "application/pdf" } })), { code: "source_mismatch" });
});
