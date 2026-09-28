import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Э1.5 плана редизайна (решение владельца 27.09.2026): облик плана — единственный
 * облик staff CRM. Его значения — те же имена токенов на корне staff CRM
 * (`.v3-world[data-surface="staff"]`, атрибут ставит layout `(v3)`), без
 * параллельного набора `--v3-*`; каждое значение проверено расчётом контраста
 * (CLAUDE.md). Кабинет студента тоже рисует экраны в `.v3-world` и подключает
 * v3.css, но без этого атрибута — он живёт базовыми значениями и не меняется.
 * Переключатель предпросмотра (cookie, атрибут облика на корне, карточка в
 * «Настройки → Платформа») удалён (izzhackt/evo_AI_CRM#1061).
 */

const ROOT = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const css = read("src/app/(v3)/v3.css");
const STAFF = '.v3-world[data-surface="staff"]';

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, selector);
  return css.slice(start, css.indexOf("}", start));
}
const hexTokens = (text) => Object.fromEntries([...text.matchAll(/--([a-z0-9-]+):\s*(#[a-f0-9]{6});/gu)].map((match) => [match[1], match[2]]));
const base = hexTokens(block(".v3-world"));
const staff = { ...base, ...hexTokens(block(STAFF)) };

function luminance(hex) {
  const [r, g, b] = hex.slice(1).match(/../gu).map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
function contrast(tokens, fg, bg) {
  const values = [luminance(tokens[fg]), luminance(tokens[bg])].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(tsx?|css)$/u.test(name) ? [path] : [];
  });
}

test("the staff look overrides the same token names in one place and every value meets contrast", () => {
  assert.doesNotMatch(css, /--v3-[a-z]/u, "no parallel --v3-* token set");
  assert.equal(staff.bg, "#f3f1ec", "work is a white sheet on a warm grey desk");
  assert.equal(staff.accent, "#d70217", "solid red stays for the main action");
  assert.equal(staff["accent-text"], staff.text, "red text only for problems: the small accent is plain dark text");
  const [r, g] = staff["accent-weak"].slice(1).match(/../gu).map((part) => parseInt(part, 16));
  assert.ok(r - g <= 5, "«выбрано» is neutral, not pale red");
  assert.equal(staff["focus-ring"], "#202020");
  for (const phase of ["phase-sales", "phase-admission", "phase-visa"]) assert.ok(staff[phase], phase);
  for (const surface of ["surface", "bg", "surface-2", "surface-3", "accent-weak"]) {
    for (const text of ["text", "text-2", "text-3", "accent-text", "danger", "warn", "ok", "info"]) {
      assert.ok(contrast(staff, text, surface) >= 4.5, `${text} on ${surface}`);
    }
    assert.ok(contrast(staff, "control-edge", surface) >= 3, `control edge on ${surface}`);
    assert.ok(contrast(staff, "focus-ring", surface) >= 3, `focus ring on ${surface}`);
    for (const phase of ["phase-sales", "phase-admission", "phase-visa"]) assert.ok(contrast(staff, phase, surface) >= 4.2, `${phase} on ${surface}`);
  }
  // «Выбрано» стоит и рядом с наведением (`hover:bg-surface-2`) — отличается и от него.
  for (const [upper, lower] of [["surface", "bg"], ["bg", "surface-2"], ["surface-2", "surface-3"], ["surface", "accent-weak"], ["bg", "accent-weak"], ["surface-2", "accent-weak"]]) {
    assert.ok(contrast(staff, upper, lower) >= 1.08, `${upper} and ${lower} stay distinguishable`);
  }
  assert.ok(contrast(staff, "on-accent", "accent") >= 4.5);
});

test("links keep an underline without red, and only buttons and board cards are raised", () => {
  assert.match(css, /\.v3-world\[data-surface="staff"\] :is\(a, button\):is\(\.text-accent, \.text-accent-text\):not\(\[aria-current\], \[aria-pressed="true"\], \.bg-accent-weak\) \{\s*text-decoration-line: underline;/u);
  // The active rail group is a button with the selected fill — not underlined (AppShell).
  assert.match(read("src/components/v3/AppShell.tsx"), /group\.active \? "bg-accent-weak text-accent-text"/u);
  // The raised shadow never replaces the keyboard focus halo of globals.css.
  assert.match(css, /\.v3-world\[data-surface="staff"\] \.v3-raised:not\(:disabled\):not\(:focus-visible\) \{\s*box-shadow: var\(--shadow-raised\);/u);
  const raisedRules = [...css.matchAll(/^([^\n*]*\.v3-raised[^\n]*)\{$/gmu)].map((match) => match[1]);
  assert.deepEqual(raisedRules, ['.v3-world[data-surface="staff"] .v3-raised:not(:disabled):not(:focus-visible) '], "the raised shadow is staff-only");
  const ui = read("src/components/ui.tsx");
  for (const name of ["btnCls", "btnGhostCls", "btnDangerGhostCls"]) assert.match(ui, new RegExp(`export const ${name} =\\s*"v3-raised `, "u"), name);
  const queue = read("src/components/v3/queue/queue-buttons.ts");
  for (const name of ["QUEUE_CONFIRM", "QUEUE_SECONDARY"]) assert.match(queue, new RegExp(`export const ${name} = \`v3-raised `, "u"), name);
  assert.match(read("src/components/v3/board/Board.tsx"), /export const BOARD_CARD_CLASS =\s*"v3-raised /u);
});

test("one look for every staff member: the staff layout marks its root, and the preview is gone", () => {
  const layout = read("src/app/(v3)/layout.tsx");
  assert.match(layout, /<div className="v3-world" data-surface="staff">/u);
  for (const path of ["src/lib/v3/look-preview.ts", "src/lib/v3/look-preview-contract.ts", "src/lib/v3/look-preview-actions.ts", "src/components/v3/blocks/look.ts"]) {
    assert.equal(existsSync(new URL(path, ROOT)), false, `${path} is removed`);
  }
  for (const file of sourceFiles(new URL("src", ROOT).pathname)) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /data-look|evo_look_preview|readLookPreview|setLookPreviewAction|isNextLook|V3Look|data-shell-look/u, file);
  }
  // Карточки предпросмотра в «Настройки → Платформа» нет.
  const sections = read("src/components/v3/settings/sections.tsx");
  assert.doesNotMatch(sections, /v3-look-preview|предпросмотр/iu);
  // «Платформа»: перенос данных и «Менеджеры в отчёте» (Э8.6) — ссылки, без предпросмотра облика.
  assert.match(sections, /export function PlatformSection\(\{ platform, salesImportHref, salesManagersHref \}: \{ platform: string; salesImportHref\?: string; salesManagersHref\?: string \}\)/u);
});

test("the student portal keeps its look: it renders in .v3-world without the staff mark, on the unchanged base values", () => {
  // Кабинет подключает v3.css и рисует прежние экраны в `.v3-world` — без атрибута staff CRM.
  const portalLayout = read("src/app/(portal)/layout.tsx");
  assert.match(portalLayout, /import "\.\.\/\(v3\)\/v3\.css";\s*import "\.\/portal\.css";/u);
  assert.match(read("src/components/portal/Shell.tsx"), /<div id="portal-content" tabIndex=\{-1\} className="pt-content v3-world">/u);
  for (const dir of ["src/app/(portal)", "src/components/portal"]) {
    for (const file of sourceFiles(new URL(dir, ROOT).pathname)) assert.doesNotMatch(readFileSync(file, "utf8"), /data-surface/u, file);
  }
  // Базовые значения `.v3-world`, которыми живёт кабинет, — прежние (09.09 и 24.09).
  assert.deepEqual(
    { bg: base.bg, accentText: base["accent-text"], accentWeak: base["accent-weak"], focusRing: base["focus-ring"] },
    { bg: "#f3f3f3", accentText: "#b50013", accentWeak: "#fff0f1", focusRing: "#b50013" },
  );
  assert.doesNotMatch(block(".v3-world"), /--shadow-raised|--phase-|--shell-/u, "staff-only tokens are not on the shared base");
  // Всё, что меняет вид, — только под корнем staff CRM: общие блоки, тень, подчёркивание, оболочка.
  for (const marker of [".v3-chip", ".v3-stage", ".v3-due", ".v3-initials", ".v3-progress", ".v3-track", ".v3-toast", ".v3-card-meta", ".v3-raised", "[data-shell-menu]", "[data-shell-content]"]) {
    const rules = [...css.matchAll(/^([^\n{}]*)\{$/gmu)].map((match) => match[1]).filter((selector) => selector.includes(marker));
    assert.ok(rules.length > 0, marker);
    for (const selector of rules) assert.ok(selector.trim().startsWith(STAFF), `${selector.trim()} is staff-only`);
  }
});
