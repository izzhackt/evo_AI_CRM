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

test("brand shell retains native disclosure, visible preview status and reduced motion", () => {
  const shell = read("src/components/v3/AppShell.tsx");
  assert.match(shell, /<details open=\{previewing\}>/u);
  assert.match(shell, /<\/details>[\s\S]*?data-testid="preview-active"/u);
  assert.match(css, /@media\s*\(prefers-reduced-motion: reduce\)/u);
  assert.match(css, /scroll-behavior: auto !important/u);
  assert.match(read("src/app/globals.css"), /--text-base:\s*16px/u);
});

test("directory filters reset native form state when applied URL filters change", () => {
  const directory = read("src/components/v3/profile/ProfileCaseDirectory.tsx");
  assert.match(directory, /<form\s+key=\{JSON\.stringify\(params\)\}/u);
  assert.match(directory, /defaultValue=\{params\.query\}/u);
  assert.match(directory, /defaultValue=\{params\.state \?\? ""\}/u);
  assert.match(directory, /<a\s[^>]*href="\/v3\/profile"\s*>\s*Сбросить\s*<\/a>/u);
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
