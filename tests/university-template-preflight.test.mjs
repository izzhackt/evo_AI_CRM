import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectUniversityTemplate } from "../src/lib/server/university-template-preflight.ts";

const options = () => ({ signal: new AbortController().signal });
const rejected = code => ({ status: "rejected", code });
const bytes = Buffer.from("ordinary synthetic input");
const input = () => ({ bytes, mimeType: "application/pdf", expectedSha256: createHash("sha256").update(bytes).digest("hex") });
test("template seam rejects non-template MIME, empty/oversized input and invalid hash before dispatch", async () => {
  for (const change of [{ bytes: new Uint8Array() }, { bytes: new Uint8Array(20 * 1024 * 1024 + 1) },
    { bytes: "not-bytes" }, { mimeType: "image/png" }, { expectedSha256: "not-a-hash" }]) {
    assert.deepEqual(await inspectUniversityTemplate({ ...input(), ...change }, options()), rejected("template_not_eligible"));
  }
});
test("exact SHA mismatch is ineligible before a native parser is dispatched", async () => {
  assert.deepEqual(await inspectUniversityTemplate({ ...input(), expectedSha256: "0".repeat(64) }, options()), rejected("template_not_eligible"));
});
test("already aborted or missing cancellation boundary never returns a verified template", async () => {
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await inspectUniversityTemplate(input(), { signal: controller.signal }), rejected("source_unavailable"));
  assert.deepEqual(await inspectUniversityTemplate(input(), {}), rejected("source_unavailable"));
});
