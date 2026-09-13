import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectDocumentSource } from "../src/lib/server/document-source-preflight.ts";

const options = () => ({ signal: new AbortController().signal });
const rejected = code => ({ status: "rejected", code });
const bytes = Buffer.from("ordinary synthetic input");
const input = () => ({ bytes, mimeType: "application/pdf", expectedSha256: createHash("sha256").update(bytes).digest("hex") });

test("public source seam rejects unsupported MIME, empty/oversized bytes and malformed hash before dispatch", async () => {
  for (const change of [{ bytes: new Uint8Array() }, { bytes: new Uint8Array(25 * 1024 * 1024 + 1) },
    { bytes: "not-bytes" }, { mimeType: "image/svg+xml" }, { expectedSha256: "not-a-hash" }]) {
    assert.deepEqual(await inspectDocumentSource({ ...input(), ...change }, options()), rejected("document_not_eligible"));
  }
});

test("public source seam rejects exact byte/hash mismatch without a parser or provider", async () => {
  assert.deepEqual(await inspectDocumentSource({ ...input(), expectedSha256: "0".repeat(64) }, options()), rejected("document_not_eligible"));
});

test("an already cancelled source inspection is unavailable and never a verified receipt", async () => {
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await inspectDocumentSource(input(), { signal: controller.signal }), rejected("source_unavailable"));
});
