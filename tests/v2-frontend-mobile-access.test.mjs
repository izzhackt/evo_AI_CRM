import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Sales queue uses bounded cursor pages for practical mobile access", () => {
  const sales = source("src/app/(staff)/sales/SalesWorkspace.tsx");

  assert.match(sales, /listCanonicalSalesLeads\(\{[\s\S]*pageSize: 15,/);
  assert.match(sales, /page\.hasNext && page\.nextCursor/);
  assert.match(sales, /rel="next"/);
  assert.doesNotMatch(sales, /listCanonicalSalesLeads\(\{[\s\S]*pageSize: 50,/);
});

test("selected WhatsApp work opens independently of the long mobile queue", () => {
  const whatsapp = source(
    "src/components/platform/communications/CanonicalStaffWhatsApp.tsx",
  );

  assert.match(whatsapp, /thread && "hidden"/);
  assert.match(whatsapp, /lg:block lg:w-\[360px\]/);
  assert.match(whatsapp, /data-testid="canonical-staff-whatsapp-mobile-back"/);
  assert.match(whatsapp, /href="\/whatsapp"/);
  assert.match(whatsapp, /lg:hidden/);
  assert.match(whatsapp, /data-testid="canonical-staff-whatsapp-thread"/);
});
