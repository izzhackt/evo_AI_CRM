import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MIN_ALL_SURFACES, allSurfaceFiles } from "./helpers/staff-surfaces.mjs";

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

test("active shell copy names each current authority without stale delivery slices", () => {
  const salesCopy = source("src/app/(staff)/sales/SalesWorkspace.tsx");
  const notYetReplacedCopy = [
    source("src/components/platform/communications/PlatformStaffWhatsApp.tsx"),
    source("src/components/platform/core/CanonicalRecordsPresentation.tsx"),
  ].join("\n");
  const activeCopy = `${salesCopy}\n${notYetReplacedCopy}`;

  assert.match(salesCopy, /Supabase Platform/);
  assert.doesNotMatch(salesCopy, /PostgreSQL V2/);
  assert.match(notYetReplacedCopy, /PostgreSQL V2/);
  assert.doesNotMatch(
    activeCopy,
    /\bU2\b|Этот PR|This PR|intake-композит|intake composite|fallback/i,
  );
});

test("staff surfaces only use utilities the theme actually defines", () => {
  const theme = source("src/app/globals.css");
  const themeBlock = theme.slice(theme.indexOf("@theme inline"));
  const set = (pattern) =>
    new Set([...themeBlock.matchAll(pattern)].map((match) => match[1]));
  const colors = set(/--color-([a-z0-9-]+):/g);
  const radii = set(/--radius-([a-z0-9-]+):/g);
  const shadows = set(/--shadow-([a-z0-9-]+):/g);

  const PALETTE = new Set([
    "slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber",
    "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue",
    "indigo", "violet", "purple", "fuchsia", "pink", "rose",
  ]);
  const BUILTIN_COLOR = new Set(["white", "black", "transparent", "current", "inherit"]);
  const BUILTIN_RADIUS = new Set([
    "none", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "full",
  ]);
  // rounded-t / rounded-br are the bare side forms (default radius);
  // rounded-t-lg is a side plus a scale.
  const RADIUS_SIDE_ONLY = /^(t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee)$/;
  const RADIUS_SIDE = /^(t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee)-/;
  const BUILTIN_SHADOW = new Set(["none", "xs", "sm", "md", "lg", "xl", "2xl", "inner"]);

  // Whole same-prefix utilities that carry no theme colour. Matched exactly:
  // a prefix-only match is how an undefined "bg-topbar" slips through.
  const NON_COLOUR = new Set([
    // text-*
    "text-left", "text-center", "text-right", "text-justify", "text-start",
    "text-end", "text-wrap", "text-nowrap", "text-balance", "text-pretty",
    "text-clip", "text-ellipsis",
    // bg-* (position, repeat, attachment, sizing, clip, origin, blend, gradients)
    "bg-fixed", "bg-local", "bg-scroll", "bg-auto", "bg-cover", "bg-contain",
    "bg-center", "bg-top", "bg-bottom", "bg-left", "bg-right", "bg-none",
    "bg-repeat", "bg-no-repeat", "bg-repeat-x", "bg-repeat-y", "bg-repeat-round",
    "bg-repeat-space", "bg-clip-border", "bg-clip-padding", "bg-clip-content",
    "bg-clip-text", "bg-origin-border", "bg-origin-padding", "bg-origin-content",
    "bg-radial", "bg-conic",
    // border-* (sides, styles, collapse)
    "border-x", "border-y", "border-t", "border-r", "border-b", "border-l",
    "border-s", "border-e", "border-solid", "border-dashed", "border-dotted",
    "border-double", "border-hidden", "border-none", "border-collapse",
    "border-separate",
    // divide-*
    "divide-x", "divide-y", "divide-solid", "divide-dashed", "divide-dotted",
    "divide-double", "divide-none", "divide-x-reverse", "divide-y-reverse",
    // ring / outline
    "ring-inset", "outline-none", "outline-hidden", "outline-solid",
    "outline-dashed", "outline-dotted", "outline-double",
    // decoration / stroke / fill
    "decoration-solid", "decoration-dashed", "decoration-dotted",
    "decoration-double", "decoration-wavy", "decoration-auto",
    "decoration-from-font", "decoration-slice", "decoration-clone",
    "fill-none", "stroke-none",
  ]);
  // Prefixes whose remainder is a length/percentage/scale rather than a colour.
  // Gradient direction utilities: v3 bg-gradient-to-*, v4 bg-linear-to-*.
  const GRADIENT_DIRECTION =
    /^bg-(gradient|linear)-to-(t|tr|r|br|b|bl|l|tl)$/;

  const SIZED =
    /^(text|border|divide|ring|outline|stroke|decoration|from|via|to|bg-linear|text-shadow|bg-blend|ring-offset|bg-size|bg-position|border-spacing|border-spacing-x|border-spacing-y)-(\d+(?:\.\d+)?%?|xs|sm|base|md|lg|xl|[2-9]xl|full|px|auto|none|normal|multiply|screen|overlay|darken|lighten|to-r|to-l|to-t|to-b|to-tr|to-tl|to-br|to-bl)$/;

  // border-b-0, divide-x-2, ring-offset-2: a side/axis plus a width.
  const SIDED_WIDTH =
    /^(border|divide)-(x|y|t|r|b|l|s|e)-(\d+)$/;

  function stripVariants(token) {
    // hover:, sm:, dark:, group-hover:, peer-focus:, motion-reduce:, aria-*:
    return token.replace(/^(?:[a-z0-9-]+(?:\[[^\]]*\])?:)+/, "");
  }

  // Every string literal, tokenised on whitespace and matched WHOLE, so an id
  // like "contract-template-text-hint" cannot masquerade as text-hint, and a
  // shared class constant or a template literal is still covered.
  function classTokens(moduleSource) {
    const withoutArbitrary = moduleSource.replaceAll(/\[[^\]\n]*\]/g, "[]");
    const literals = [
      ...withoutArbitrary.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g),
    ].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
    return literals
      .flatMap((literal) => literal.split(/[\s]+/))
      .map(stripVariants)
      .filter(Boolean);
  }

  const surfaces = allSurfaceFiles();
  assert.ok(surfaces.length >= MIN_ALL_SURFACES, `expected the whole staff surface set, got ${surfaces.length}`);

  for (const surface of surfaces) {
    for (const token of classTokens(source(surface))) {
      if (
        NON_COLOUR.has(token) ||
        SIZED.test(token) ||
        SIDED_WIDTH.test(token) ||
        GRADIENT_DIRECTION.test(token)
      ) {
        continue;
      }

      const colour = /^(text|bg|border|ring|fill|stroke|divide|outline|placeholder|caret|decoration|from|via|to)-([a-z][a-z0-9-]*)$/.exec(token);
      if (colour) {
        const name = colour[2];
        if (BUILTIN_COLOR.has(name) || colors.has(name)) continue;
        if (PALETTE.has(name.split("-")[0])) continue;
        assert.fail(`${surface} uses ${token}, which the EVO theme does not define`);
      }

      const radius = /^rounded-([a-z][a-z0-9-]*)$/.exec(token);
      if (radius) {
        if (RADIUS_SIDE_ONLY.test(radius[1])) continue;
        const scale = radius[1].replace(RADIUS_SIDE, "");
        if (BUILTIN_RADIUS.has(scale) || radii.has(scale)) continue;
        assert.fail(`${surface} uses ${token}, which the EVO theme does not define`);
      }

      const shadow = /^shadow-([a-z][a-z0-9-]*)$/.exec(token);
      if (shadow) {
        if (BUILTIN_SHADOW.has(shadow[1]) || shadows.has(shadow[1])) continue;
        assert.fail(`${surface} uses ${token}, which the EVO theme does not define`);
      }
    }
  }
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

  assert.match(queue, /import \{ fixedRoleCanAccessRoute \}/);
  assert.match(
    queue,
    /const canOpenLead = fixedRoleCanAccessRoute\(\s*actor\.presentationRole,\s*"\/sales",\s*\)/,
  );
  assert.match(queue, /listPlatformStudentCaseLeadLinks\(\s*actor,/);
  // The link must sit behind the server-derived presentation-role guard.
  assert.match(
    queue,
    /\{canOpenLead && leadId \? \(\s*<Link\s+href=\{`\/sales\/\$\{leadId\}`\}/,
    "the canonical lead link must render only when the effective role may open /sales",
  );
});

test("the active Sales detail does not reactivate the deferred Drizzle controls", () => {
  const workspace = source("src/app/(staff)/sales/[id]/SalesLeadWorkspace.tsx");

  assert.match(workspace, /PlatformSalesWorkflowForm/);
  assert.doesNotMatch(
    workspace,
    /CanonicalSalesGateCard|CanonicalSalesHandoffCard|CanonicalAmoCrmCommandPanel|fixedRoleCanAccessRoute/,
  );
});

test("the frontend contract suite is wired into the CI entry point", () => {
  // These four files guard route states, mobile access, shell truth and the
  // type scale. They were added to `pretest:unit` in #529 and silently
  // reverted by #527, which merged later from a branch cut before it -- so
  // for a while every guard in them passed locally and ran nowhere. The npm
  // wiring is therefore itself under test.
  const manifest = JSON.parse(source("package.json"));
  const scripts = manifest.scripts;

  assert.ok(scripts["test:frontend"], "test:frontend must exist");
  assert.ok(
    scripts["pretest:unit"].includes("npm run test:frontend"),
    "pretest:unit must run test:frontend, or CI never executes the frontend contracts",
  );

  // ...and it must actually cover these files, not just exist.
  for (const file of [
    "tests/v2-frontend-shell-truth.test.mjs",
    "tests/v2-frontend-mobile-access.test.mjs",
    "tests/v2-frontend-route-states.test.mjs",
    "tests/v2-frontend-accessibility-navigation.test.mjs",
  ]) {
    assert.ok(
      scripts["test:frontend"].includes(file),
      `${file} is not covered by test:frontend`,
    );
  }
});
