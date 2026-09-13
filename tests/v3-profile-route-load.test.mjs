import assert from "node:assert/strict";
import test from "node:test";

import { loadProfileSalesContext, loadV3ProfileRoute } from "../src/lib/v3/profile-route-load.ts";
import { PlatformStudentHandoffRepositoryError } from "../src/lib/platform-student-handoff.ts";

test("an authorized case does not require the separately forbidden Sales handoff", async () => {
  let gateReads = 0;
  const result = await loadProfileSalesContext("case", {
    readGate: async () => { gateReads += 1; return { confirmed: true }; },
    readHandoff: async () => { throw new PlatformStudentHandoffRepositoryError("forbidden"); },
  });
  assert.equal(result, null);
  assert.equal(gateReads, 0);
});

test("an authorized linked Sales context retains the real reader results", async () => {
  const gate = Object.freeze({ confirmed: true });
  const handoff = Object.freeze({ caseId: "case-1" });
  for (const mode of ["lead", "case"]) {
    const result = await loadProfileSalesContext(mode, {
      readGate: async () => gate,
      readHandoff: async () => handoff,
    });
    assert.equal(result.gate, gate);
    assert.equal(result.handoff, handoff);
  }
});

test("a required lead handoff denial remains a denial", async () => {
  const denial = new PlatformStudentHandoffRepositoryError("forbidden");
  await assert.rejects(loadProfileSalesContext("lead", {
    readGate: async () => ({}),
    readHandoff: async () => { throw denial; },
  }), error => error === denial);
});

test("a case never hides unavailable, malformed or unrelated handoff failures", async () => {
  for (const failure of [
    new PlatformStudentHandoffRepositoryError("unavailable"),
    new PlatformStudentHandoffRepositoryError("invalid"),
    Object.assign(new Error("not a repository denial"), { reason: "forbidden" }),
  ]) {
    await assert.rejects(loadProfileSalesContext("case", {
      readGate: async () => ({}),
      readHandoff: async () => { throw failure; },
    }), error => error === failure);
  }
});

test("an authorized handoff never turns a gate read failure into an absent section", async () => {
  for (const reason of ["forbidden", "unavailable"]) {
    const failure = new PlatformStudentHandoffRepositoryError(reason);
    await assert.rejects(loadProfileSalesContext("case", {
      readGate: async () => { throw failure; },
      readHandoff: async () => ({}),
    }), error => error === failure);
  }
});

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
