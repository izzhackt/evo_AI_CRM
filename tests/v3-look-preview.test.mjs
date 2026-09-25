import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LOOK_PREVIEW_COOKIE, LOOK_PREVIEW_VALUE, lookPreviewAllowed } from "../src/lib/v3/look-preview-contract.ts";

/**
 * Э1.1 плана редизайна (25.09.2026): новый облик за переключателем
 * предпросмотра Admin — временное сосуществование до решения владельца (Э1.5).
 * Облик — те же имена токенов в одном блоке `.v3-world[data-look="next"]`;
 * каждое значение проверено расчётом контраста (CLAUDE.md).
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("src/app/(v3)/v3.css");

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, selector);
  return css.slice(start, css.indexOf("}", start));
}
const hexTokens = (text) => Object.fromEntries([...text.matchAll(/--([a-z0-9-]+):\s*(#[a-f0-9]{6});/gu)].map((match) => [match[1], match[2]]));
const base = hexTokens(block(".v3-world"));
const nextLook = { ...base, ...hexTokens(block('.v3-world[data-look="next"]')) };

function luminance(hex) {
  const [r, g, b] = hex.slice(1).match(/../gu).map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
function contrast(fg, bg) {
  const values = [luminance(nextLook[fg]), luminance(nextLook[bg])].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("only an Admin outside role preview can see the new look", () => {
  assert.equal(lookPreviewAllowed({ systemRole: "admin", presentationRole: null }), true);
  assert.equal(lookPreviewAllowed({ systemRole: "admin", presentationRole: "sales" }), false, "not while previewing a role");
  assert.equal(lookPreviewAllowed({ systemRole: "staff", presentationRole: null }), false);
  assert.equal(LOOK_PREVIEW_COOKIE, "evo_look_preview");
  assert.equal(LOOK_PREVIEW_VALUE, "next");
});

test("the new look overrides the same token names in one place and every value meets contrast", () => {
  assert.doesNotMatch(css, /--v3-[a-z]/u, "no parallel --v3-* token set");
  assert.equal(nextLook.accent, "#d70217", "solid red stays for the main action");
  assert.equal(nextLook["accent-text"], nextLook.text, "red text only for problems: the small accent is plain dark text");
  const [r, g] = nextLook["accent-weak"].slice(1).match(/../gu).map((part) => parseInt(part, 16));
  assert.ok(r - g <= 5, "«выбрано» is neutral, not pale red");
  for (const surface of ["surface", "bg", "surface-2", "surface-3", "accent-weak"]) {
    for (const text of ["text", "text-2", "text-3", "accent-text", "danger", "warn", "ok", "info"]) {
      assert.ok(contrast(text, surface) >= 4.5, `${text} on ${surface}`);
    }
    assert.ok(contrast("control-edge", surface) >= 3, `control edge on ${surface}`);
    assert.ok(contrast("focus-ring", surface) >= 3, `focus ring on ${surface}`);
  }
  for (const [upper, lower] of [["surface", "bg"], ["bg", "surface-2"], ["surface-2", "surface-3"], ["surface", "accent-weak"], ["bg", "accent-weak"]]) {
    assert.ok(contrast(upper, lower) >= 1.08, `${upper} and ${lower} stay distinguishable`);
  }
  assert.ok(contrast("on-accent", "accent") >= 4.5);
});

test("links keep an underline without red, and only buttons and board cards are raised", () => {
  assert.match(css, /\.v3-world\[data-look="next"\] a:is\(\.text-accent, \.text-accent-text\) \{\s*text-decoration-line: underline;/u);
  assert.match(css, /\.v3-world\[data-look="next"\] \.v3-raised:not\(:disabled\) \{\s*box-shadow: var\(--shadow-raised\);/u);
  const raisedRules = [...css.matchAll(/^([^\n*]*\.v3-raised[^\n]*)\{$/gmu)].map((match) => match[1]);
  assert.deepEqual(raisedRules, ['.v3-world[data-look="next"] .v3-raised:not(:disabled) '], "no raised rule outside the new look");
  const ui = read("src/components/ui.tsx");
  for (const name of ["btnCls", "btnGhostCls", "btnDangerGhostCls"]) assert.match(ui, new RegExp(`export const ${name} =\\s*"v3-raised `, "u"), name);
  const queue = read("src/components/v3/queue/queue-buttons.ts");
  for (const name of ["QUEUE_CONFIRM", "QUEUE_SECONDARY"]) assert.match(queue, new RegExp(`export const ${name} = \`v3-raised `, "u"), name);
  assert.match(read("src/components/v3/board/Board.tsx"), /export const BOARD_CARD_CLASS =\s*"v3-raised /u);
});

test("the switch is Admin-only, kept per browser, and the shell sets the look once", () => {
  const layout = read("src/app/(v3)/layout.tsx");
  assert.match(layout, /<div className="v3-world" data-look=\{lookPreview \? "next" : undefined\}>/u);
  assert.match(layout, /readLookPreview\(actor\)/u);
  assert.match(read("src/lib/v3/look-preview.ts"), /if \(!lookPreviewAllowed\(actor\)\) return false;/u);
  const action = read("src/lib/v3/look-preview-actions.ts");
  assert.match(action, /^"use server";/u);
  assert.match(action, /if \(!lookPreviewAllowed\(actor\)\) redirect\(/u);
  assert.match(action, /httpOnly: true,\s*sameSite: "strict",/u);
  const sections = read("src/components/v3/settings/sections.tsx");
  assert.match(sections, /<form action=\{setLookPreviewAction\}/u);
  // The switch lives in «Платформа», a section only an Admin sees.
  assert.match(read("src/components/v3/settings/types.ts"), /\{ key: "platform", title: "Платформа", admin: true \}/u);
});
