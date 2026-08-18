import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import { validateP8VV1CoreResult } from "../scripts/p8v-v1-core-result.mjs";

const schemaUrl = new URL(
  "../docs/schemas/p8v-v1-core-result.schema.json",
  import.meta.url,
);
const SHA = "a".repeat(64);
const SEAMS = [
  "lead_agent_ingress",
  "manual_send_claim",
  "waha_dispatch",
  "audit_reconciliation",
  "operator_state",
];

function result(overrides = {}) {
  return {
    version: "p8v-v1-core-result/v1",
    generated_at: "2026-08-18T02:00:00.000Z",
    result_code: "core_verified",
    failed_seam: null,
    source: {
      commit: "1".repeat(40),
      tree: "2".repeat(40),
      ci_run_id: 123456,
    },
    seams: SEAMS.map((name) => ({
      name,
      status: "verified",
      evidence_sha256: SHA,
    })),
    ...overrides,
  };
}

test("closed schema and runtime accept only the exact verified seam order", async () => {
  const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
  const validateSchema = new Ajv2020({ strict: false }).compile(schema);
  const canonical = result();
  assert.equal(validateSchema(canonical), true, JSON.stringify(validateSchema.errors));
  assert.deepEqual(validateP8VV1CoreResult(canonical), canonical);

  for (const invalid of [
    result({ seams: [] }),
    result({ seams: result().seams.toReversed() }),
    result({ generated_at: "2026-08-18T08:00:00+06:00" }),
    result({ extra: true }),
    result({ seams: result().seams.map((item, index) =>
      index === 3 ? { ...item, status: "not_run", evidence_sha256: null } : item),
    }),
  ]) {
    assert.equal(validateSchema(invalid), false);
    assert.throws(() => validateP8VV1CoreResult(invalid));
  }
});

test("a core failure is a truthful prefix and forbids later verified work", async () => {
  const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
  const validateSchema = new Ajv2020({ strict: false }).compile(schema);
  const failed = result({
    result_code: "core_failed",
    failed_seam: "waha_dispatch",
    seams: result().seams.map((item, index) =>
      index < 2
        ? item
        : index === 2
          ? { ...item, status: "failed" }
          : { ...item, status: "not_run", evidence_sha256: null }),
  });
  assert.equal(validateSchema(failed), true, JSON.stringify(validateSchema.errors));
  assert.deepEqual(validateP8VV1CoreResult(failed), failed);

  const contradictory = structuredClone(failed);
  contradictory.seams[4] = {
    ...contradictory.seams[4],
    status: "verified",
    evidence_sha256: SHA,
  };
  assert.equal(validateSchema(contradictory), false);
  assert.throws(() => validateP8VV1CoreResult(contradictory));
});
