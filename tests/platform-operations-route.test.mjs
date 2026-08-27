import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isConnectedPlatformOperationsSettingsRequest,
  isConnectedPlatformSettingsRequest,
} from "../src/lib/platform-route-contract.ts";

const settingsPageSource = readFileSync(
  new URL("../src/app/(staff)/settings/page.tsx", import.meta.url),
  "utf8",
);

test("only the exact Admin operations settings route enters the connected Platform", () => {
  const exact = new URLSearchParams("tab=operations");
  assert.equal(
    isConnectedPlatformOperationsSettingsRequest("/settings", exact),
    true,
  );
  assert.equal(
    isConnectedPlatformSettingsRequest("/settings", exact, {
      auditEnabled: false,
    }),
    true,
  );

  for (const [path, query] of [
    ["/settings/", "tab=operations"],
    ["/settings/operations", "tab=operations"],
    ["/settings", "tab=operations&tab=operations"],
    ["/settings", "tab=operations&organization_id=11111111-1111-4111-8111-111111111111"],
    ["/settings", "tab=unknown"],
  ]) {
    assert.equal(
      isConnectedPlatformOperationsSettingsRequest(
        path,
        new URLSearchParams(query),
      ),
      false,
      `${path}?${query} must remain disconnected`,
    );
  }
});

test("the exact operations query loads the dedicated server page before optional audit routing", () => {
  assert.match(
    settingsPageSource,
    /isConnectedPlatformOperationsSettingsRequest\("\/settings", exactQuery\)[\s\S]*await import\([\s\S]*"\.\/PlatformOperationsSettingsPage"[\s\S]*return <PlatformOperationsSettingsPage/,
  );
  assert.match(
    settingsPageSource,
    /PlatformOperationsSettingsPage[\s\S]*!isPlatformP7AAuditEnabled\(\)/,
  );
});
