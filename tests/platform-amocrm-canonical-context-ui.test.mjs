import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/app/(staff)/whatsapp/[id]/page.tsx", import.meta.url),
  "utf8",
);
const componentSource = readFileSync(
  new URL(
    "../src/components/platform/communications/CanonicalStaffWhatsApp.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("active WhatsApp detail no longer imports amoCRM context into the V2-9A read surface", () => {
  assert.doesNotMatch(
    pageSource,
    /getPlatformAmoCrmCanonicalContext|PlatformAmoCrmContextCard|platform-amocrm-canonical-context-service/,
  );
  assert.match(pageSource, /getCanonicalStaffConversationThread/);
  assert.match(componentSource, /data-testid="canonical-staff-whatsapp-thread"/);
  assert.doesNotMatch(
    componentSource,
    /PlatformAmoCrmContextCard|amocrmCanonicalContext|platform-messaging-workflow/,
  );
});
