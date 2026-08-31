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

test("hand-written accent text uses the theme-aware accent token", () => {
  const styles = source("src/app/globals.css");

  assert.equal(
    styles.match(/color: var\(--accent\);/g),
    null,
    "raw --accent must never be used as a text colour; it fails 4.5:1 on dark surfaces",
  );
  assert.ok(
    (styles.match(/color: var\(--accent-text\);/g) ?? []).length >= 5,
    "themed accent text token must cover the shell, mobile nav and status rules",
  );
  assert.match(styles, /\.mobile-staff-nav__item--active \{\n  color: var\(--accent-text\);/);
  assert.match(styles, /\.staff-menu-sheet__link--active \{\n  background: var\(--accent-weak\);\n  color: var\(--accent-text\);/);
});
