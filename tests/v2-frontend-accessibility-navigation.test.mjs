import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

/**
 * WCAG 2.x relative luminance and contrast ratio. One implementation for every
 * contrast contract in this file, so the tests cannot drift apart.
 */
function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((value) =>
      value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
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

test("dark muted text stays readable on every tinted surface", () => {
  const styles = source("src/app/globals.css");
  const darkBlock = styles.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(darkBlock, "the dark theme block must be readable");

  function token(name) {
    const match = darkBlock.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"));
    assert.ok(match, `dark --${name} must be a hex token`);
    return match[1];
  }

  const mutedText = token("text-3");
  const surfaces = [
    "bg",
    "surface",
    "surface-2",
    "surface-3",
    "accent-weak",
    "ok-weak",
    "warn-weak",
    "danger-weak",
    "info-weak",
    "violet-weak",
  ];

  for (const surface of surfaces) {
    const ratio = contrastRatio(mutedText, token(surface));
    assert.ok(
      ratio >= 4.5,
      `dark --text-3 on --${surface} is ${ratio.toFixed(2)}:1, below 4.5:1`,
    );
  }
});

test("dark accent text is pinned to the surfaces it is used on", () => {
  const styles = source("src/app/globals.css");
  const darkBlock = styles.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(darkBlock, "the dark theme block must be readable");

  function token(name) {
    const match = darkBlock.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"));
    assert.ok(match, `dark --${name} must be a hex token`);
    return match[1];
  }

  // --accent-text clears 4.5:1 on these and only these; it fails on the other
  // tinted surfaces (ok/warn/info/violet-weak, surface-3). This pins the token
  // so a change to it cannot silently drop one of the surfaces it is used on.
  // It does not police pairings: those are cross-element (tint on a parent,
  // text on a nested child) and a class-string check cannot see them.
  const accentText = token("accent-text");
  for (const surface of ["bg", "surface", "surface-2", "accent-weak"]) {
    const ratio = contrastRatio(accentText, token(surface));
    assert.ok(
      ratio >= 4.5,
      `dark --accent-text on --${surface} is ${ratio.toFixed(2)}:1, below 4.5:1`,
    );
  }
});

test("every core staff route renders exactly one page-level h1", () => {
  const routeHeadingSources = [
    ["/sales", "src/app/(staff)/sales/SalesWorkspace.tsx"],
    ["/sales/[id]", "src/components/platform/core/LeadHero.tsx"],
    ["/clients", "src/app/(staff)/clients/StudentQueue.tsx"],
    [
      "/clients/[id]",
      "src/app/(staff)/clients/[id]/CanonicalStudentCaseWorkspace.tsx",
    ],
    ["/applications", "src/app/(staff)/applications/page.tsx"],
    ["/documents", "src/app/(staff)/documents/(queue)/page.tsx"],
    ["/visa", "src/app/(staff)/visa/page.tsx"],
    ["/finance", "src/app/(staff)/finance/page.tsx"],
    ["/tasks", "src/app/(staff)/tasks/page.tsx"],
    [
      "/whatsapp",
      "src/components/platform/communications/CanonicalStaffWhatsApp.tsx",
    ],
  ];

  for (const [route, path] of routeHeadingSources) {
    const moduleSource = source(path);
    const literalHeadings = moduleSource.match(/<h1[\s>]/g) ?? [];
    const sharedHeaders = moduleSource.match(/<PageHeader[\s>]/g) ?? [];
    assert.equal(
      literalHeadings.length + sharedHeaders.length,
      1,
      `${route} must own exactly one page-level h1 (${path})`,
    );
  }
});

test("the shared task panel heading stays subordinate to the page h1", () => {
  const panel = source(
    "src/components/platform/admissions/CanonicalAdmissionsTaskPanel.tsx",
  );
  const tasksRoute = source("src/app/(staff)/tasks/page.tsx");

  assert.equal(panel.match(/<h1[\s>]/g), null);
  assert.match(panel, /id="canonical-admissions-task-panel-title"/);
  assert.match(tasksRoute, /<h1/);
});
