import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("src/app/(v3)/v3.css");
const tokens = Object.fromEntries([...css.matchAll(/--([a-z0-9-]+):\s*(#[a-f0-9]{6});/gu)]
  .map((match) => [match[1], match[2]]));

function luminance(hex) {
  const [r, g, b] = hex.slice(1).match(/../gu).map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function contrast(fg, bg) {
  const values = [luminance(tokens[fg]), luminance(tokens[bg])].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("actual workbench text and control boundaries meet contrast thresholds", () => {
  for (const surface of ["surface", "bg", "surface-2", "surface-3"]) {
    for (const text of ["text", "text-2", "text-3", "accent-text"]) {
      assert.ok(contrast(text, surface) >= 4.5, `${text} on ${surface}`);
    }
    assert.ok(contrast("control-edge", surface) >= 3, `control edge on ${surface}`);
    assert.ok(contrast("focus-ring", surface) >= 3, `focus ring on ${surface}`);
  }
  for (const status of ["ok", "warn", "danger", "info"]) {
    assert.ok(contrast(status, `${status}-weak`) >= 4.5, `${status} label`);
  }
  assert.ok(contrast("on-accent", "accent") >= 4.5);
  assert.ok(contrast("on-accent", "accent-2") >= 4.5);
  assert.ok(contrast("accent-text", "accent-weak") >= 4.5);
  assert.equal(tokens.accent, "#d70217");
});

test("original logo bytes are preserved and statically imported outside auth routes", () => {
  const logo = readFileSync(new URL("../public/brand/evo-logo.png", import.meta.url));
  assert.equal(createHash("sha256").update(logo).digest("hex"),
    "a0cab0e419cefc7df84cfdb1ebee5b554f0794fab579fd098247968af3a8c094");
  assert.equal(logo.readUInt32BE(16), 1843);
  assert.equal(logo.readUInt32BE(20), 842);
  const component = read("src/components/platform/brand/EvoLogo.tsx");
  assert.match(component, /import evoLogo from "\.\.\/\.\.\/\.\.\/\.\.\/public\/brand\/evo-logo\.png"/u);
  assert.match(component, /src=\{evoLogo\}/u);
  assert.match(component, /alt="EVO Admissions"/u);
  assert.match(component, /height: "auto"/u);
});

test("role settings retain native disclosure and shell retains visible preview exit", () => {
  const shell = read("src/components/v3/AppShell.tsx");
  const roleSettings = read("src/components/v3/settings/StaffRolesSection.tsx");
  assert.match(roleSettings, /<details[^>]*data-testid="staff-role-preview"/u);
  assert.doesNotMatch(shell, /data-testid="staff-role-preview"/u);
  assert.match(shell, /data-testid="preview-active"[\s\S]*data-testid="preview-role-admin"/u);
  assert.match(css, /@media\s*\(prefers-reduced-motion: reduce\)/u);
  assert.match(css, /scroll-behavior: auto !important/u);
  assert.match(read("src/app/globals.css"), /--text-base:\s*16px/u);
});

test("directory filters reset native form state when applied URL filters change", () => {
  // «Студенты» facets (2026-09-24): status/curator/attention are facet links;
  // the search form carries them as hidden fields so a new query keeps them.
  const directory = read("src/components/v3/profile/StudentsWorkspace.tsx");
  assert.match(directory, /<form\s+key=\{JSON\.stringify\(params\)\}/u);
  assert.match(directory, /defaultValue=\{params\.query\}/u);
  assert.match(directory, /<input type="hidden" name="case_status" value=\{params\.state\} \/>/u);
  // Since #836 the reset link preserves the chosen section (docs vs worklist).
  assert.match(directory, /const directoryHref = withDocsSection\("\/v3\/profile", docsMode\);/u);
  assert.match(directory, /<Link href=\{directoryHref\}[^>]*>\s*Сбросить\s*<\/Link>/u);
});

test("sales table scroll regions contain absolutely positioned screen-reader labels", () => {
  const sales = read("src/components/v3/SalesRegisterView.tsx");
  for (const label of ["Денежные итоги по валютам", "Записи продаж"]) {
    const region = sales.match(new RegExp(`<div role="region" aria-label="${label}"[^>]*className="([^"]+)"`, "u"));
    assert.ok(region, `named scroll region: ${label}`);
    const classes = region[1].split(/\s+/u);
    assert.ok(classes.includes("overflow-x-auto"), `horizontal scrolling: ${label}`);
    assert.ok(classes.includes("relative"), `positioned containing block: ${label}`);
  }
});

test("solid red stays for the main action and every selection shares one accent-weak style", () => {
  const rule = css.match(/\.v3-world \.v3-choice:is\(\[aria-current\]:not\(\[aria-current="false"\]\), \[aria-pressed="true"\], \[aria-expanded="true"\]\) \{([^}]+)\}/u);
  assert.ok(rule, "one selected rule keyed on the announced state");
  assert.match(rule[1], /background-color: var\(--accent-weak\);/u);
  assert.match(rule[1], /color: var\(--accent-text\);/u);
  assert.doesNotMatch(rule[1], /var\(--accent\)|--on-accent/u);
  assert.ok(contrast("text-2", "accent-weak") >= 4.5, "secondary text inside a selected calendar card");
  assert.ok(contrast("surface", "text") >= 4.5, "dark neutral badge, solid pill and today marker");

  const selectable = [
    "src/components/v3/settings/Settings.tsx",
    "src/components/v3/settings/sections.tsx",
    "src/components/v3/settings/StaffSection.tsx",
    "src/components/v3/calendar/Calendar.tsx",
    "src/components/v3/calendar/grids.tsx",
    "src/components/v3/AdmissionsPipelineBoard.tsx",
    "src/app/(v3)/v3/admissions-pipeline/page.tsx",
    "src/app/(v3)/v3/tasks/page.tsx",
    "src/app/(v3)/v3/pipeline/page.tsx",
    "src/components/v3/PipelineStageViewport.tsx",
    "src/components/v3/MainHeader.tsx",
    "src/components/v3/SalesReportNavigation.tsx",
    "src/components/v3/profile/Profile.tsx",
    "src/components/v3/reply-snippets/KnowledgeWorkspaceTabs.tsx",
    "src/app/(v3)/v3/requests/page.tsx",
    "src/components/v3/profile/StudentsWorkspace.tsx",
  ];
  for (const path of selectable) {
    const source = read(path);
    assert.match(source, /v3-choice/u, `${path} uses the shared selected style`);
    assert.doesNotMatch(source, /\?\s*"[^"]*\bbg-accent\b[^"]*\btext-on-accent\b/u, `${path} has no solid red selection`);
    assert.doesNotMatch(source, /border-b-2 border-accent/u, `${path} has no red underline selection`);
  }
  // The audit filter chips used to show selection by colour alone.
  assert.match(read("src/components/v3/settings/sections.tsx"), /aria-current=\{active\.objectType === type\.key \? "page" : undefined\}/u);
  // A selected form template keeps a non-colour cue: the edge v3-choice recolours
  // and the 600 weight reaching the title (no weight fixed on the title itself).
  const forms = read("src/app/(v3)/v3/universities/[id]/forms/page.tsx");
  assert.match(forms, /className="v3-choice [^"]*\bborder-l-2 border-transparent\b[^"]*"/u, "selected template has an edge, not only a tint");
  assert.doesNotMatch(forms, /text-sm font-medium">\{item\.title\}/u, "the title does not pin its own weight over v3-choice");

  const filterSubmits = [
    "src/components/v3/Inbox.tsx",
    "src/components/v3/MainHeader.tsx",
    "src/app/(v3)/v3/pipeline/page.tsx",
    "src/app/(v3)/v3/admissions-pipeline/page.tsx",
    "src/components/v3/universities/UniversityCatalogue.tsx",
    "src/components/v3/profile/StudentsWorkspace.tsx",
  ];
  for (const path of filterSubmits) {
    const source = read(path);
    const labels = [...source.matchAll(/(?:Найти|Показать)\s*<\/button>/gu)];
    assert.ok(labels.length > 0, `${path} keeps its filter submit`);
    for (const label of labels) {
      const button = source.slice(source.lastIndexOf("<button", label.index), label.index);
      assert.doesNotMatch(button, /\bbg-accent\b/u, `${path}: filter submit is secondary`);
    }
  }

  const directory = read("src/components/v3/profile/StudentCaseTable.tsx");
  assert.match(directory, /className=\{btnGhostCls\}>Анкета и формы<\/Link>/u);
  const notifications = read("src/components/v3/StaffNotifications.tsx");
  assert.doesNotMatch(notifications, /\bbg-accent\b/u);
  assert.match(notifications, /aria-label=\{count && count !== "0" \? `Уведомления: \$\{count\} непрочитанных` : "Уведомления"\}/u);
  assert.match(read("src/components/v3/Pill.tsx"), /solid: "bg-fg text-surface",/u);
});
