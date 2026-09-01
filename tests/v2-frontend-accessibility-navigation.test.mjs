import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MIN_STAFF_SURFACES,
  staffOperatingSurfaces,
} from "./helpers/staff-surfaces.mjs";

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

test("hand-written accent text uses the theme-aware accent token", () => {
  const styles = source("src/app/globals.css");

  // Anchored to the `color` property itself: the previous pattern also
  // matched the tail of `caret-color: var(--accent);`, which is not a text
  // colour, so it would have failed on a correct change.
  assert.equal(
    styles.match(/(?:^|[\s;{])color: var\(--accent\);/gm),
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
  // tinted surfaces (ok/warn/info-weak, surface-3). This pins the token
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

test("staff type sizes come from the scale, not ad-hoc pixel values", () => {
  const theme = source("src/app/globals.css");
  const themeStart = theme.indexOf("@theme inline");
  const themeBlock = theme.slice(themeStart);
  const steps = [...themeBlock.matchAll(/--text-([a-z0-9]+):\s*(\d+)px/g)].map(
    (match) => ({ name: match[1], px: Number(match[2]) }),
  );

  assert.ok(steps.length >= 8, `a usable scale needs at least 8 steps, got ${steps.length}`);
  const sizes = steps.map((step) => step.px).sort((a, b) => a - b);
  assert.equal(sizes[0], 11, "functional floor is 11px");
  assert.ok(sizes.includes(12), "body floor is 12px");
  assert.equal(new Set(sizes).size, sizes.length, "two steps must not share a size");

  // A dense Operate surface carries many type elements at once; exaggerated
  // contrast between adjacent steps reads as noise rather than hierarchy.
  for (let index = 1; index < sizes.length; index += 1) {
    const ratio = sizes[index] / sizes[index - 1];
    assert.ok(
      ratio >= 1.05 && ratio <= 1.25,
      `step ${sizes[index - 1]}px -> ${sizes[index]}px is ${ratio.toFixed(3)}, outside 1.05-1.25`,
    );
  }

  // Every text- utility a surface names must resolve to a declared step.
  // Tailwind ships text-4xl and up; using one silently steps off this scale.
  const declared = new Set(steps.map((step) => step.name));
  for (const surface of staffOperatingSurfaces()) {
    for (const [, name] of source(surface).matchAll(
      /(?<![\w-])(?:[a-z0-9]+:)*text-(2xs|xs|sm|base|md|lg|xl|\d?xl)(?![\w-])/g,
    )) {
      assert.ok(
        declared.has(name),
        `${surface} uses text-${name}, which is not a step in the scale`,
      );
    }
    // Ad-hoc text-[13.5px] is how twenty different sizes accumulated.
    // px is not the only way to write an ad-hoc size.
    const literals =
      source(surface).match(
        /text-\[(?:length:)?\d+(?:\.\d+)?(?:px|rem|em|pt|%)\]|fontSize:\s*["'`]?\d/g,
      ) ?? [];
    assert.deepEqual(
      literals,
      [],
      `${surface} uses ad-hoc ${literals[0]} instead of the type scale`,
    );
  }

  // The stylesheet's own rules were converted to the scale by hand; nothing
  // stopped one from being left as a raw pixel value.
  // Comments are stripped first: prose about font sizes is not a font size,
  // and the `scale-exempt:` marker is re-attached per declaration below.
  const withComments = theme.slice(0, themeStart) + themeBlock.slice(themeBlock.indexOf("}"));
  const rules = withComments.replace(
    /\/\*[\s\S]*?\*\//g,
    (comment) => (comment.includes("scale-exempt:") ? "/*scale-exempt:*/" : " "),
  );
  // A literal size is allowed only when the comment attached to that very
  // declaration carries an explicit `scale-exempt:` marker -- e.g. the 16px
  // iOS touch floor, which is a floor rather than a step. Anything else is
  // drift. The marker must sit between the previous declaration and this one,
  // so a marker elsewhere in the file cannot license it.
  // Both `font-size: 13px` and the `font:` shorthand's size slot.
  const rawSizes = [...rules.matchAll(/font-size:\s*\d+(?:\.\d+)?(?:px|rem|em|pt)|[^-\w]font:\s*[^;{}]*?\d+(?:\.\d+)?(?:px|rem|em|pt)/gi)]
    .filter((match) => {
      const preceding = rules.slice(0, match.index);
      const boundary = Math.max(
        preceding.lastIndexOf(";"),
        preceding.lastIndexOf("{"),
        preceding.lastIndexOf("}"),
      );
      return !preceding.slice(boundary + 1).includes("scale-exempt:");
    })
    .map((match) => match[0]);
  assert.deepEqual(
    rawSizes,
    [],
    `globals.css sets ${rawSizes[0]} directly instead of var(--text-*)`,
  );
});

test("no staff surface reintroduces a kicker above its heading", () => {
  // The eyebrow label is a page-scaffold habit: the heading carries its own
  // weight, and the label above it is a tell rather than information.
  // Matched by composition rather than by literal class order, because class
  // order is arbitrary and an ordered regex is evaded by rearranging it.
  for (const surface of staffOperatingSurfaces()) {
    const moduleSource = source(surface);
    // Every string literal in the module, not just a static className="...".
    // cn(...) is this codebase's dominant idiom, and a kicker written through
    // it, through a template literal, or through a hoisted constant would
    // otherwise pass. Any tracking utility counts, and the accent can be
    // named directly, via its text token, or as a bare CSS variable.
    for (const [, classes] of moduleSource.matchAll(/["'`]([^"'`\n]*)["'`]/g)) {
      if (!classes.includes("uppercase")) continue;
      const names = classes.split(/\s+/);
      const has = (test) => names.some((name) => test.test(name));
      const kicker =
        has(/^(?:[a-z0-9-]+:)?uppercase$/) &&
        has(/^(?:[a-z0-9-]+:)?tracking-(?:\[[^\]]+\]|wide|wider|widest)$/) &&
        has(/^(?:[a-z0-9-]+:)?text-(?:accent(?:-text)?|\[var\(--accent[^)]*\)\])$/);
      assert.ok(!kicker, `${surface} reintroduces an accent kicker: "${classes}"`);
    }
    assert.ok(
      !/\beyebrow\b/i.test(moduleSource),
      `${surface} reintroduces an eyebrow`,
    );
  }

  assert.ok(
    staffOperatingSurfaces().length >= MIN_STAFF_SURFACES,
    "the surface walk returned too few files to be a real guard",
  );
});

/**
 * Read one palette block by selector, so a test can name the theme it means.
 * Every contrast test in this file used to open the dark block only, which is
 * why deepening the light ground could invert the surface ladder and blank out
 * every loading skeleton with all suites green.
 */
function palette(selector) {
  const styles = source("src/app/globals.css");
  const block = styles.match(
    new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`),
  )?.[1];
  assert.ok(block, `${selector} palette block must be readable`);
  return (name) => {
    const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"));
    assert.ok(match, `${selector} --${name} must be a hex token`);
    return match[1];
  };
}

const PALETTES = [
  ["light", ":root,\\n\\[data-theme=\"light\"\\]"],
  ["dark", "\\[data-theme=\"dark\"\\]"],
];

test("the surface ladder keeps a visible step in both themes", () => {
  // A skeleton block, a switch track and a badge are delimited by nothing but
  // their fill against the ground. When --bg moved onto --surface-2 the step
  // fell to 1.02:1 and the loading states went blank -- with axe, the frontend
  // suite and the unit suite all still green, because none of them renders a
  // loading.tsx or measures fill-against-fill.
  for (const [name, selector] of PALETTES) {
    const token = palette(selector);
    const ground = token("bg");
    const rungs = ["surface", "surface-2", "surface-3"];

    for (const rung of rungs) {
      const ratio = contrastRatio(token(rung), ground);
      assert.ok(
        ratio >= 1.04,
        `${name}: --${rung} sits at ${ratio.toFixed(3)}:1 against --bg; a fill that is the only thing delimiting an element needs a visible step`,
      );
    }

    // ...and the rungs stay ordered among themselves, or a fill designed as
    // one step deeper starts reading as one step shallower. The ground itself
    // legitimately sits between them: in light the white plane is raised above
    // it while the muted fills are recessed below, and in dark both directions
    // collapse upward because the ground is already near black.
    const order = rungs.map((rung) => relativeLuminance(token(rung)));
    const ascending = order.every(
      (value, index) => index === 0 || value > order[index - 1],
    );
    const descending = order.every(
      (value, index) => index === 0 || value < order[index - 1],
    );
    assert.ok(
      ascending || descending,
      `${name}: the surface ladder is not monotonic, so the fills no longer read as one system`,
    );
  }
});

test("muted text stays readable on every surface in both themes", () => {
  for (const [name, selector] of PALETTES) {
    const token = palette(selector);
    for (const surface of ["bg", "surface", "surface-2", "surface-3"]) {
      for (const ink of ["text-2", "text-3"]) {
        const ratio = contrastRatio(token(ink), token(surface));
        assert.ok(
          ratio >= 4.5,
          `${name}: --${ink} on --${surface} is ${ratio.toFixed(2)}:1, below the 4.5:1 floor`,
        );
      }
    }
    // Accent text has to clear the floor on every surface it can land on, not
    // just the ground. Checking --bg alone is what let #d70217 ship at 4.44:1
    // on the recessed fills.
    for (const surface of ["bg", "surface", "surface-2", "surface-3", "accent-weak"]) {
      const accent = contrastRatio(token("accent-text"), token(surface));
      assert.ok(
        accent >= 4.5,
        `${name}: --accent-text on --${surface} is ${accent.toFixed(2)}:1, below the 4.5:1 floor`,
      );
    }
  }
});

test("interactive controls carry a boundary that meets WCAG 1.4.11", () => {
  // axe ships no automated rule for 1.4.11, so an input whose only boundary is
  // a decorative hairline passes every gate while being hard to locate.
  for (const [name, selector] of PALETTES) {
    const token = palette(selector);
    for (const surface of ["bg", "surface", "surface-2", "surface-3"]) {
      const ratio = contrastRatio(token("control-edge"), token(surface));
      assert.ok(
        ratio >= 3,
        `${name}: --control-edge on --${surface} is ${ratio.toFixed(2)}:1, below the 3:1 non-text floor`,
      );
    }
  }

  // And the controls must actually use it.
  const ui = source("src/components/ui.tsx");
  assert.match(ui, /inputCls[\s\S]*?border-control-edge/);
  assert.doesNotMatch(
    ui,
    /border-border-strong/,
    "control boundaries must not fall back to the decorative border token",
  );
});
