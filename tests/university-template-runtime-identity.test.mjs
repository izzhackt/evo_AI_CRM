import assert from "node:assert/strict";
import test from "node:test";
import { readUniversityTemplateRuntimeIdentity } from "../src/lib/server/university-template-runtime-identity.ts";

test("template ingress has no identity authority when the controller binding is absent", () => {
  const before = process.env.EVO_RUNTIME_IMAGE_ID;
  delete process.env.EVO_RUNTIME_IMAGE_ID;
  try {
    assert.throws(() => readUniversityTemplateRuntimeIdentity(), { message: "template_runtime_unavailable" });
  } finally {
    if (before === undefined) delete process.env.EVO_RUNTIME_IMAGE_ID;
    else process.env.EVO_RUNTIME_IMAGE_ID = before;
  }
});

for (const [imageId, revision] of [["a".repeat(64), "b".repeat(40)], [`sha256:${"A".repeat(64)}`, "b".repeat(40)],
  [`sha256:${"a".repeat(64)}`, "b".repeat(39)], [`sha256:${"a".repeat(64)}`, "B".repeat(40)], ["", ""]]) {
  test("runtime identity rejects missing/malformed or relabelled image provenance", () => {
    const before = { image: process.env.EVO_RUNTIME_IMAGE_ID, revision: process.env.EVO_RELEASE_REVISION };
    process.env.EVO_RUNTIME_IMAGE_ID = imageId; process.env.EVO_RELEASE_REVISION = revision;
    try { assert.throws(readUniversityTemplateRuntimeIdentity, { message: "template_runtime_unavailable" }); }
    finally {
      for (const [name, value] of [["EVO_RUNTIME_IMAGE_ID", before.image], ["EVO_RELEASE_REVISION", before.revision]]) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });
}
