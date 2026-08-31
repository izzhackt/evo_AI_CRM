import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Student 360 exposes localized links to every core workflow section", () => {
  const workspace = source(
    "src/app/(staff)/clients/[id]/CanonicalStudentCaseWorkspace.tsx",
  );

  assert.match(workspace, /aria-label=\{copy\.sectionNavigation\}/);
  assert.match(workspace, /canonical-student-case-section-navigation/);
  const targets = [
    ["case-summary", "summaryNavigation"],
    ["case-handoff", "handoffNavigation"],
    ["case-tasks", "tasksNavigation"],
    ["case-documents", "documentsNavigation"],
    ["case-amocrm", "amocrmNavigation"],
    ["case-operations", "operationsNavigation"],
  ];
  for (const [target, label] of targets) {
    assert.match(
      workspace,
      new RegExp(`\\["${target}", copy\\.${label}\\]`),
      target,
    );
    assert.match(workspace, new RegExp(`id="${target}"`));
  }
  assert.match(workspace, /href=\{`#\$\{target\}`\}/);
  assert.equal(workspace.match(/sectionNavigation:/g)?.length, 3);
  assert.match(workspace, /scroll-mt-24/);
  assert.match(workspace, /btnGhostCls/);
  assert.match(workspace, /shrink-0 whitespace-nowrap/);
});

test("critical confirmation and inline case links use practical targets", () => {
  const composer = source(
    "src/components/platform/communications/CanonicalWhatsAppOutboundComposer.tsx",
  );
  const whatsapp = source(
    "src/components/platform/communications/CanonicalStaffWhatsApp.tsx",
  );
  const tasks = source(
    "src/components/platform/admissions/CanonicalAdmissionsTaskPanel.tsx",
  );

  assert.match(composer, /min-h-11 cursor-pointer/);
  assert.match(composer, /h-5 w-5 shrink-0/);
  assert.match(whatsapp, /inline-flex min-h-11 items-center/);
  assert.match(tasks, /inline-flex min-h-11 items-center/);
});

test("the shared staff focus indicator remains globally visible", () => {
  const styles = source("src/app/globals.css");

  assert.match(styles, /:focus-visible\s*\{/);
  assert.match(styles, /outline:\s*2px solid var\(--focus-ring\)/);
  assert.match(styles, /box-shadow:\s*0 0 0 3px var\(--focus-halo\)/);
});
