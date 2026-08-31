import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function staffSurfaceFiles() {
  const roots = ["src/app", "src/components"];
  const files = new Set();
  for (const root of roots) {
    const base = new URL(`../${root}/`, import.meta.url);
    for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue;
      const dir = entry.parentPath ?? entry.path;
      files.add(`${root}/${relative(fileURLToPath(base), join(dir, entry.name))}`);
    }
  }
  return [...files].sort();
}

const routeFiles = [
  "src/app/login/page.tsx",
  "src/app/(staff)/sales/page.tsx",
  "src/app/(staff)/sales/[id]/page.tsx",
  "src/app/(staff)/clients/page.tsx",
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

  const surfaces = staffSurfaceFiles();
  assert.ok(surfaces.length > 100, `expected the whole staff surface set, got ${surfaces.length}`);

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
