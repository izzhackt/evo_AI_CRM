import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPECTED_SERVICES,
  checkContainer,
  parseRevision,
  summarize,
} from "../scripts/verify-deployment.mjs";

const REVISION = "a".repeat(40);

function container(overrides = {}) {
  return {
    name: "evo-crm-app-1",
    state: "running",
    health: "healthy",
    restarts: 0,
    revision: REVISION,
    ...overrides,
  };
}

test("a revision must be an exact 40-character commit SHA", () => {
  assert.equal(parseRevision(REVISION), REVISION);
  assert.equal(parseRevision(REVISION.toUpperCase()), REVISION);
  assert.equal(parseRevision(""), null);
  assert.equal(parseRevision("a".repeat(39)), null);
  assert.equal(parseRevision("z".repeat(40)), null);
  assert.equal(parseRevision(undefined), null);
});

test("a healthy container at the expected revision produces no finding", () => {
  assert.deepEqual(checkContainer(container(), REVISION), []);
});

test("a container that was never observed is reported, not skipped", () => {
  assert.deepEqual(checkContainer(undefined, REVISION), [
    "container was not observed",
  ]);
});

test("an older deployed revision is reported as a mismatch", () => {
  const findings = checkContainer(
    container({ revision: "b".repeat(40) }),
    REVISION,
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^revision is b{40}, expected a{40}$/u);
});

test("a missing revision label is a mismatch rather than a pass", () => {
  const findings = checkContainer(container({ revision: null }), REVISION);
  assert.deepEqual(findings, [`revision is absent, expected ${REVISION}`]);
});

test("restarts and unhealthy state are reported", () => {
  assert.deepEqual(checkContainer(container({ restarts: 3 }), REVISION), [
    "restart count is 3, expected 0",
  ]);
  assert.deepEqual(checkContainer(container({ health: "unhealthy" }), REVISION), [
    "health is unhealthy",
  ]);
  assert.deepEqual(checkContainer(container({ state: "exited" }), REVISION), [
    "state is exited, expected running",
  ]);
});

test("a container without a health check is not failed for that alone", () => {
  // WAHA and similar services may report no health status. Absence of a check
  // is not evidence of ill health.
  assert.deepEqual(checkContainer(container({ health: "none" }), REVISION), []);
});

test("preserved WAHA images are not required to carry an EVO revision", () => {
  // Their images are a preservation boundary; demanding a revision would
  // report a mismatch on a correctly untouched container.
  for (const name of ["evo-crm-waha-1", "evo-inbox-waha"]) {
    assert.deepEqual(
      checkContainer(container({ name, revision: null }), REVISION),
      [],
      name,
    );
  }
  // They are still required to be running and stable.
  assert.deepEqual(
    checkContainer(
      container({ name: "evo-inbox-waha", revision: null, restarts: 2 }),
      REVISION,
    ),
    ["restart count is 2, expected 0"],
  );
});

test("the summary covers every expected service and fails closed", () => {
  const observed = {};
  for (const name of EXPECTED_SERVICES) observed[name] = container({ name });
  const good = summarize(observed, REVISION);
  assert.equal(good.ok, true);
  assert.equal(good.services.length, EXPECTED_SERVICES.length);

  // One stale service is enough to fail the whole run: a partially updated
  // deployment must never read as success.
  const partial = { ...observed };
  partial["evo-crm-app-1"] = container({ revision: "c".repeat(40) });
  const bad = summarize(partial, REVISION);
  assert.equal(bad.ok, false);
  assert.equal(bad.failing.length, 1);
  assert.equal(bad.failing[0].name, "evo-crm-app-1");
});

test("an entirely unobserved host fails rather than passing vacuously", () => {
  const empty = summarize({}, REVISION);
  assert.equal(empty.ok, false);
  assert.equal(empty.failing.length, EXPECTED_SERVICES.length);
});
