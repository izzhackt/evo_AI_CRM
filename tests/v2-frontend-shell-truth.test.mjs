import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const routeFiles = [
  "src/app/login/page.tsx",
  "src/app/(staff)/sales/(queue)/page.tsx",
  "src/app/(staff)/sales/[id]/page.tsx",
  "src/app/(staff)/clients/(queue)/page.tsx",
  "src/app/(staff)/clients/[id]/page.tsx",
  "src/app/(staff)/applications/page.tsx",
  "src/app/(staff)/documents/(queue)/page.tsx",
  "src/app/(staff)/visa/page.tsx",
  "src/app/(staff)/finance/page.tsx",
  "src/app/(staff)/tasks/page.tsx",
  "src/app/(staff)/whatsapp/page.tsx",
  "src/app/(staff)/whatsapp/[id]/page.tsx",
  "src/app/(staff)/settings/page.tsx",
];

test("each active V2 staff route exposes descriptive metadata", () => {
  for (const path of routeFiles) {
    assert.match(source(path), /generateMetadata/, path);
  }

  const rootLayout = source("src/app/layout.tsx");
  assert.match(rootLayout, /default: "EVO Admissions CRM"/);
  assert.match(rootLayout, /template: "%s \| EVO Admissions CRM"/);
});

test("active shell copy describes PostgreSQL V2 without stale delivery slices", () => {
  const activeCopy = [
    source("src/app/(staff)/sales/SalesWorkspace.tsx"),
    source("src/components/platform/communications/CanonicalStaffWhatsApp.tsx"),
    source("src/components/platform/core/CanonicalRecordsPresentation.tsx"),
  ].join("\n");

  assert.match(activeCopy, /PostgreSQL V2/);
  assert.doesNotMatch(
    activeCopy,
    /Supabase|\bU2\b|Этот PR|This PR|intake-композит|intake composite|fallback/i,
  );
});
