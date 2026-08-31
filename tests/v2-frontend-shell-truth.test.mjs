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

test("the locale switcher never drags a legacy action module into a live route", () => {
  const localeActions = source("src/lib/locale-actions.ts");
  assert.match(localeActions, /^"use server";/);
  assert.match(localeActions, /export async function setLocaleAction/);
  assert.equal(
    localeActions.match(/^export async function/gm)?.length,
    1,
    "the locale action module must export exactly one action",
  );
  for (const forbidden of ["./db", "./actions", "supabase", "better-sqlite3"]) {
    assert.ok(
      !localeActions.includes(forbidden),
      `locale-actions must not import ${forbidden}`,
    );
  }

  for (const switcher of [
    "src/components/LangSwitcher.tsx",
    "src/components/platform/PlatformLangSwitcher.tsx",
    "src/components/platform/portal/PortalLanguageSwitcher.tsx",
    "src/components/platform/portal/PortalShell.tsx",
  ]) {
    const moduleSource = source(switcher);
    assert.match(
      moduleSource,
      /from "@\/lib\/locale-actions"/,
      `${switcher} must use the isolated locale action`,
    );
    assert.ok(
      !moduleSource.includes('from "@/lib/actions"'),
      `${switcher} must not import the legacy SQLite action module`,
    );
    assert.ok(
      !moduleSource.includes("platform-admissions-actions"),
      `${switcher} must not import the Supabase action module`,
    );
  }
});

test("cross-role case links are only rendered for a role the server allows", () => {
  const queue = source("src/app/(staff)/clients/StudentQueue.tsx");
  const handoff = source(
    "src/components/platform/sales/CanonicalSalesHandoffCard.tsx",
  );

  assert.match(queue, /import \{\s*fixedRoleCanAccessRoute,/);
  assert.match(queue, /const canOpenLead = fixedRoleCanAccessRoute\(actorRole, "\/sales"\)/);
  // The link must sit in the TRUE branch: an inverted ternary would offer the
  // denied route to exactly the role that cannot open it.
  assert.match(
    queue,
    /\{canOpenLead \? \(\s*<Link\s+href=\{`\/sales\/\$\{studentCase\.leadId\}`\}/,
    "the lead link must render only when the role may open /sales",
  );
  assert.match(
    queue,
    /\) : \(\s*<CanonicalUuid value=\{studentCase\.leadId\} \/>\s*\)\}/,
    "the denied role must get plain text, not a link",
  );
  assert.match(queue, /actorRole=\{actor\.platformRole\}/);

  // The role check must happen on the server: this card is a client component,
  // and a value import of the policy module pulls node:crypto into the browser
  // graph through development-gate-core.
  assert.match(handoff, /^"use client";/);
  assert.match(handoff, /import type \{ FixedRole \} from "@\/lib\/fixed-role-policy";/);
  assert.ok(
    !/import \{[^}]*fixedRoleCanAccessRoute/.test(handoff),
    "the client handoff card must not value-import the fixed-role policy",
  );
  assert.match(handoff, /canOpenAdmissionsCase: boolean;/);
  // Bind the link to the TRUE branch: swapping the branches would hand the
  // denied route to exactly the role that cannot open it, which is the bug.
  assert.match(
    handoff,
    /canOpenAdmissionsCase \? \(\s*<Link\s+href=\{`\/clients\/\$\{completedCaseId\}`\}/,
    "the Admissions case link must render only when the role may open /clients",
  );
  assert.match(
    handoff,
    /\) : \(\s*<p[\s\S]{0,200}?data-testid="canonical-admissions-case-reference"/,
    "the denied role must get the plain case reference, not a link",
  );

  const workspace = source("src/app/(staff)/sales/[id]/SalesLeadWorkspace.tsx");
  assert.match(
    workspace,
    /canOpenAdmissionsCase=\{fixedRoleCanAccessRoute\(\s*actor\.platformRole,\s*"\/clients",\s*\)\}/,
    "the server component must compute the role check",
  );

  for (const locale of ["ru", "ky", "en"]) {
    assert.ok(
      handoff.includes("caseRecorded:"),
      `${locale} handoff fallback copy must exist`,
    );
  }
  assert.equal(
    handoff.match(/caseRecorded:/g)?.length,
    3,
    "the handoff fallback copy must cover ru, ky and en",
  );
});
