import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { readJsonObject, readMultipartFormData } from "../src/lib/request.ts";

function jsonRequest(content) {
  return new NextRequest("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: content,
  });
}

function multipartRequest(content) {
  const form = new FormData();
  form.set("file", new File([content], "call.mp3", { type: "audio/mpeg" }));
  return new NextRequest("http://localhost/api/transcription/jobs", {
    method: "POST",
    body: form,
  });
}

test("JSON reader rejects a body after the application byte ceiling", async () => {
  const result = await readJsonObject(jsonRequest('{"value":"too large"}'), 8);
  assert.equal(result, null);
});

test("JSON reader parses an object that stays within the application byte ceiling", async () => {
  const result = await readJsonObject(jsonRequest('{"value":"ok"}'), 4096);
  assert.deepEqual(result, { value: "ok" });
});

test("small legacy multipart reader rejects a body after its byte ceiling", async () => {
  const result = await readMultipartFormData(multipartRequest("body exceeds cap"), 8);
  assert.deepEqual(result, { error: "request_too_large" });
});

test("oversized multipart reader cancels intake without surfacing late close rejection", async (t) => {
  let cancelCalls = 0;
  let cancelReason;
  const unhandledRejections = [];
  const onUnhandledRejection = (error) => {
    unhandledRejections.push(error);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  t.after(() => {
    process.off("unhandledRejection", onUnhandledRejection);
  });
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(9));
    },
    cancel(reason) {
      cancelCalls += 1;
      cancelReason = reason;
      return Promise.reject(new Error("late stream close"));
    },
  });
  const request = new Request("http://localhost/api/transcription/jobs", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=test" },
    body,
    duplex: "half",
  });

  const result = await readMultipartFormData(request, 8);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(result, { error: "request_too_large" });
  assert.equal(cancelCalls, 1);
  assert.equal(cancelReason, "request_too_large");
  assert.deepEqual(unhandledRejections, []);
});

test("small legacy multipart reader parses a body within its byte ceiling", async () => {
  const result = await readMultipartFormData(multipartRequest("ID3"), 4096);
  assert.ok("formData" in result);
  assert.equal(result.formData.getAll("file").length, 1);
});
