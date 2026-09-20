import assert from "node:assert/strict";
import test from "node:test";
import { knowledgeStorageConflict, knowledgeStorageRetryDelay } from "../src/lib/server/knowledge-library/storage-retry.ts";

test("temporary Storage statuses receive three bounded exponential delays", () => {
  for (const status of [408, 429, 500, 502, 503, 504, 544]) {
    assert.deepEqual([0, 1, 2, 3].map(attempt => knowledgeStorageRetryDelay({ status }, attempt)), [500, 1000, 2000, null]);
  }
  assert.equal(knowledgeStorageRetryDelay({ status: 400, statusCode: "503" }, 0), 500);
});
test("access, missing objects, conflicts and integrity failures never retry", () => {
  for (const error of [{ status: 400 }, { status: 401 }, { status: 403 }, { status: 404 }, { status: 409 }, { status: 413 },
    { status: 403, statusCode: "503" }, { status: 404, statusCode: "500" }, { code: "knowledge_integrity_failed" }, new Error("unknown")]) {
    assert.equal(knowledgeStorageRetryDelay(error, 0), null);
  }
  assert.equal(knowledgeStorageRetryDelay({ status: 503 }, -1), null);
});
test("known transport failures work through the SDK original-error wrapper", () => {
  assert.equal(knowledgeStorageRetryDelay({ originalError: { cause: { code: "ECONNRESET" } } }, 0), 500);
  assert.equal(knowledgeStorageRetryDelay({ originalError: { name: "TimeoutError" } }, 0), 500);
  assert.equal(knowledgeStorageRetryDelay({ name: "AbortError" }, 0), null);
  assert.equal(knowledgeStorageRetryDelay({ originalError: { cause: { code: "CERT_HAS_EXPIRED" } } }, 0), null);
});
test("only an existing immutable object qualifies for upload readback", () => {
  for (const error of [{ status: 409 }, { status: 400, statusCode: "409" }, { status: 400, statusCode: "Duplicate" }]) assert.equal(knowledgeStorageConflict(error), true);
  for (const error of [{ status: 400 }, { status: 401 }, { status: 403 }, { status: 500 }, { status: 403, statusCode: "Duplicate" }]) assert.equal(knowledgeStorageConflict(error), false);
});
