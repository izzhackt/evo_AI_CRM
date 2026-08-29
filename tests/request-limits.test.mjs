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

test("small legacy multipart reader parses a body within its byte ceiling", async () => {
  const result = await readMultipartFormData(multipartRequest("ID3"), 4096);
  assert.ok("formData" in result);
  assert.equal(result.formData.getAll("file").length, 1);
});
