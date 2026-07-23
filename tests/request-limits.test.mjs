import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { readMultipartFormData } from "../src/lib/request.ts";

function multipartRequest(content) {
  const form = new FormData();
  form.set("file", new File([content], "call.mp3", { type: "audio/mpeg" }));
  return new NextRequest("http://localhost/api/transcription/jobs", {
    method: "POST",
    body: form,
  });
}

test("multipart reader rejects a streamed body after the application byte ceiling", async () => {
  const result = await readMultipartFormData(multipartRequest("body exceeds cap"), 8);
  assert.deepEqual(result, { error: "request_too_large" });
});

test("multipart reader parses a body that stays within the application byte ceiling", async () => {
  const result = await readMultipartFormData(multipartRequest("ID3"), 4096);
  assert.ok("formData" in result);
  assert.equal(result.formData.getAll("file").length, 1);
});
