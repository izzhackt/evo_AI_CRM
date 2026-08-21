import assert from "node:assert/strict";
import test from "node:test";

import {
  formatReleaseLabel,
  readReleaseMetadata,
} from "../src/lib/release-metadata.ts";

const REVISION = "90ab8b1b0c1dd6a92c931e9793c052f984f19fc4";

test("release metadata accepts only a full normalized SHA and safe version", () => {
  assert.deepEqual(
    readReleaseMetadata({
      EVO_RELEASE_REVISION: REVISION.toUpperCase(),
      EVO_RELEASE_VERSION: "2026-08-22.1",
    }),
    {
      status: "available",
      version: "2026-08-22.1",
      revision: REVISION,
      shortRevision: "90ab8b1b",
    },
  );
});

test("release metadata fails closed without inventing a version", () => {
  for (const environment of [
    {},
    { EVO_RELEASE_REVISION: "main", EVO_RELEASE_VERSION: "latest" },
    { EVO_RELEASE_REVISION: REVISION, EVO_RELEASE_VERSION: "bad version" },
    { EVO_RELEASE_REVISION: `${REVISION};echo`, EVO_RELEASE_VERSION: "v1" },
  ]) {
    assert.deepEqual(readReleaseMetadata(environment), { status: "unavailable" });
  }
  assert.equal(formatReleaseLabel({ status: "unavailable" }), "Release unavailable");
});

test("release label exposes only the safe version and abbreviated revision", () => {
  const metadata = readReleaseMetadata({
    EVO_RELEASE_REVISION: REVISION,
    EVO_RELEASE_VERSION: "v1.4.2",
  });
  assert.equal(formatReleaseLabel(metadata), "v1.4.2 · 90ab8b1b");
});
