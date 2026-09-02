import assert from "node:assert/strict";
import test from "node:test";

import {
  platformWahaHealthDisplayStatus,
  readPlatformGeminiProviderAvailability,
} from "../src/lib/server/platform-provider-readiness.ts";

test("Gemini readiness uses only the one server-side platform key", () => {
  assert.deepEqual(readPlatformGeminiProviderAvailability({}), {
    status: "blocked",
    reason: "configuration_missing",
  });
  assert.deepEqual(
    readPlatformGeminiProviderAvailability({
      EVO_PLATFORM_GEMINI_API_KEY: " short-or-padded-secret ",
      EVO_V2_GEMINI_API_KEY: "legacy-key-that-must-not-count",
    }),
    { status: "blocked", reason: "configuration_invalid" },
  );
  assert.deepEqual(
    readPlatformGeminiProviderAvailability({
      EVO_PLATFORM_GEMINI_API_KEY: "platform-test-key-1234567890",
    }),
    { status: "configured" },
  );
});

test("WhatsApp readiness comes from the exact Supabase session health", () => {
  const nowMs = Date.parse("2026-09-02T10:00:00Z");
  assert.equal(platformWahaHealthDisplayStatus(null), "not_configured");
  assert.equal(
    platformWahaHealthDisplayStatus({
      sessionName: "evo-inbox",
      status: "WORKING",
      observedAt: "2026-09-02T10:00:00Z",
    }, nowMs),
    "ready",
  );
  assert.equal(
    platformWahaHealthDisplayStatus({
      sessionName: "evo-inbox",
      status: "STOPPED",
      observedAt: "2026-09-02T10:00:00Z",
    }, nowMs),
    "blocked",
  );
  assert.equal(
    platformWahaHealthDisplayStatus({
      sessionName: "evo-inbox",
      status: "WORKING",
      observedAt: "2026-09-02T09:54:59Z",
    }, nowMs),
    "blocked",
  );
  assert.equal(
    platformWahaHealthDisplayStatus({
      sessionName: "evo-inbox",
      status: "WORKING",
      observedAt: "2026-09-02T10:01:01Z",
    }, nowMs),
    "blocked",
  );
});
