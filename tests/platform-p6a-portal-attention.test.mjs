import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isPlatformP6APortalAttentionEnabled,
  shouldShowPortalNextActionForP6A,
} from "../src/lib/server/platform-p6a-portal-attention.ts";

const environmentSource = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const helperSource = readFileSync(
  new URL("../src/lib/server/platform-p6a-portal-attention.ts", import.meta.url),
  "utf8",
);
test("P6A Portal attention requires the exact server-only flag value 1", () => {
  for (const value of [undefined, "", "0", "true", "yes", "01", " 1", "1 "]) {
    assert.equal(
      isPlatformP6APortalAttentionEnabled({
        EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED: value,
      }),
      false,
      String(value),
    );
  }

  assert.equal(
    isPlatformP6APortalAttentionEnabled({
      EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED: "1",
    }),
    true,
  );
  assert.match(environmentSource, /^EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED=0$/m);
  assert.doesNotMatch(environmentSource, /^NEXT_PUBLIC_.*P6A_PORTAL_ATTENTION/m);
  assert.match(helperSource, /^import "server-only";/m);
});

test("P6A action gate preserves the accepted disabled UI and filters enabled attention", () => {
  const disabledActions = [
    { labelKey: "nextAction", severity: "normal" },
    { labelKey: "portalNextDocument", severity: "warning" },
    { labelKey: "portalNextPayment", severity: "normal" },
  ];
  for (const action of disabledActions) {
    assert.equal(shouldShowPortalNextActionForP6A(action, false), true);
  }

  assert.equal(
    shouldShowPortalNextActionForP6A(
      { labelKey: "portalNextTask", severity: "warning" },
      true,
    ),
    true,
  );
  assert.equal(
    shouldShowPortalNextActionForP6A(
      { labelKey: "portalNextTask", severity: "urgent" },
      true,
    ),
    true,
  );
  assert.equal(
    shouldShowPortalNextActionForP6A(
      { labelKey: "portalNextDocument", severity: "urgent" },
      true,
    ),
    true,
  );
  assert.equal(
    shouldShowPortalNextActionForP6A(
      { labelKey: "portalNextOverduePayment", severity: "urgent" },
      true,
    ),
    true,
  );
  assert.equal(
    shouldShowPortalNextActionForP6A(
      { labelKey: "portalNextDocument", severity: "warning" },
      true,
    ),
    false,
    "required documents remain outside the P6A attention region",
  );
  assert.equal(
    shouldShowPortalNextActionForP6A(
      { labelKey: "portalNextPayment", severity: "urgent" },
      true,
    ),
    false,
  );
  assert.equal(
    shouldShowPortalNextActionForP6A(
      { labelKey: "nextAction", severity: "urgent" },
      true,
    ),
    false,
  );
});
