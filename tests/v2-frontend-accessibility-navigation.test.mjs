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

test("shell navigation group labels never outrank the page heading", () => {
  const nav = source("src/components/StaffNav.tsx");

  assert.equal(nav.match(/<h1[\s>]/g), null);

  // The desktop sidebar renders alongside <main>, so its group headings used
  // to open the outline ahead of the page h1 on every staff route. They are
  // labels now, with the same aria-labelledby association.
  assert.match(nav, /<p id=\{headingId\} className="staff-nav-group__label">/);
  assert.match(nav, /aria-labelledby=\{headingId\}/);
  assert.equal(
    nav.match(/<h2[\s>]/g)?.length,
    1,
    "only the mobile menu dialog title may be an h2",
  );
  assert.match(nav, /id="mobile-staff-menu-title"/);

  // The mobile sheet is a modal <dialog> that is display:none at >=768px, so
  // its group headings never competed with the page h1 and stay headings:
  // they are how a 14-item, two-column menu is traversed.
  assert.match(nav, /<h3 id=\{headingId\} className="staff-menu-sheet__group-label">/);

  const styles = source("src/app/globals.css");
  assert.match(styles, /\.staff-menu-sheet__group-label \{/);
  assert.doesNotMatch(styles, /\.staff-menu-sheet__group h3 \{/);
});
