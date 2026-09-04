import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isPlatformP6BPortalNotificationsEnabled } from "../src/lib/server/platform-p6b-portal-notifications.ts";

test("P6B portal notifications stay disabled unless the exact runtime flag is 1", () => {
  for (const value of [undefined, "", "0", "true", "yes", " 1 "]) {
    assert.equal(
      isPlatformP6BPortalNotificationsEnabled({
        EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED: value,
      }),
      false,
    );
  }

  assert.equal(
    isPlatformP6BPortalNotificationsEnabled({
      EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED: "1",
    }),
    true,
  );

  const exampleEnvironment = readFileSync(
    new URL("../.env.example", import.meta.url),
    "utf8",
  );
  assert.match(
    exampleEnvironment,
    /^EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED=0$/m,
  );
});
