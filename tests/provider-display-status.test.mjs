import assert from "node:assert/strict";
import test from "node:test";

import { providerDisplayStatus } from "../src/lib/provider-display-status.ts";

test("provider display status separates configuration from provider proof", () => {
  assert.equal(providerDisplayStatus({ status: "ready" }), "configured_not_verified");
  assert.equal(
    providerDisplayStatus({ status: "configured" }),
    "configured_not_verified",
  );
  assert.equal(
    providerDisplayStatus({ status: "blocked", reason: "feature_disabled" }),
    "not_configured",
  );
  assert.equal(
    providerDisplayStatus({ status: "blocked", reason: "configuration_missing" }),
    "not_configured",
  );
  assert.equal(
    providerDisplayStatus({ status: "blocked", reason: "provider_not_authorized" }),
    "blocked",
  );
  assert.equal(
    providerDisplayStatus({ status: "blocked", reason: "configuration_invalid" }),
    "blocked",
  );
});
