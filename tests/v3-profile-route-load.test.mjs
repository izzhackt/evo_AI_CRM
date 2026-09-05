import assert from "node:assert/strict";
import test from "node:test";

import { loadV3ProfileRoute } from "../src/lib/v3/profile-route-load.ts";

test("an exact profile does not depend on the Student 360 directory reader", async () => {
  let directoryReads = 0;
  const result = await loadV3ProfileRoute(
    { kind: "target", target: { leadId: "lead-1" } },
    {
      readDirectory: async () => {
        directoryReads += 1;
        throw new Error("directory unavailable");
      },
      readTarget: async (target) => ({ target }),
    },
  );

  assert.equal(directoryReads, 0);
  assert.deepEqual(result, {
    directory: null,
    view: { target: { leadId: "lead-1" } },
  });
});

test("directory and invalid modes never call the exact-target reader", async () => {
  let targetReads = 0;
  const readers = {
    readDirectory: async (params) => ({ params }),
    readTarget: async () => {
      targetReads += 1;
      throw new Error("unexpected target read");
    },
  };

  assert.deepEqual(
    await loadV3ProfileRoute({ kind: "directory", params: { active: true } }, readers),
    { directory: { params: { active: true } }, view: null },
  );
  assert.deepEqual(
    await loadV3ProfileRoute({ kind: "invalid" }, readers),
    { directory: null, view: null },
  );
  assert.equal(targetReads, 0);
});
