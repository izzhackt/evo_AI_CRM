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

test("dark accent text keeps normal-text contrast without changing brand fills", () => {
  const styles = source("src/app/globals.css");
  const darkTheme = styles.match(/\[data-theme="dark"\]\s*\{(?<body>[\s\S]*?)\n\}/)
    ?.groups?.body;

  assert.ok(darkTheme);
  const token = darkTheme.match(/--accent-text:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(token);
  assert.match(
    styles,
    /\[data-theme\] \.text-accent\s*\{\s*color:\s*var\(--accent-text\)/,
  );

  const luminance = (hex) => {
    const channels = hex
      .slice(1)
      .match(/.{2}/g)
      .map((part) => Number.parseInt(part, 16) / 255)
      .map((value) =>
        value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrast = (foreground, background) => {
    const lighter = Math.max(luminance(foreground), luminance(background));
    const darker = Math.min(luminance(foreground), luminance(background));
    return (lighter + 0.05) / (darker + 0.05);
  };

  assert.ok(contrast(token, "#15171b") >= 4.5);
  assert.ok(contrast(token, "#3b1117") >= 4.5);
  assert.match(darkTheme, /--accent:\s*#d70217/);
});

test("scrollable inbox regions are reachable by keyboard", () => {
  const whatsapp = source(
    "src/components/platform/communications/CanonicalStaffWhatsApp.tsx",
  );

  // Every element that owns its own scroll container must be focusable:
  // WCAG 2.1.1 fails when a short viewport makes a region scroll while it
  // holds no focusable child (an empty queue, or no selected conversation).
  const scrollRegions = [...whatsapp.matchAll(/overflow-y-auto/g)];
  assert.ok(scrollRegions.length >= 2, "expected the queue and thread panes");

  assert.match(
    whatsapp,
    /className="max-h-\[320px\] overflow-y-auto lg:max-h-full"[\s\S]{0,400}?tabIndex=\{0\}/,
    "the conversation queue scroll region must be focusable",
  );
  assert.match(
    whatsapp,
    /className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6"[\s\S]{0,400}?tabIndex=\{0\}/,
    "the conversation thread scroll region must be focusable",
  );
  assert.match(
    whatsapp,
    /data-testid="canonical-staff-whatsapp-thread-region"/,
    "the thread scroll region must be addressable",
  );
  assert.match(
    whatsapp,
    /aria-label=\{thread \? thread\.conversation\.displayName : copy\.emptyThreadTitle\}/,
    "the thread scroll region must carry an accessible name",
  );
});
