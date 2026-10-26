#!/usr/bin/env node
/**
 * Приводит файлы, записанные `npx shadcn@4.22.1 add …` или скопированные из реестров блоков
 * (21st.dev, Origin UI, shadcn blocks), к соглашениям «Нового вида» (DESIGN.md, «Новый вид: набор виджетов»).
 *
 *   node scripts/ui/adapt-shadcn.mjs [--check] [файл-или-папка ...]   (по умолчанию src/components/ui)
 *
 * Делает механически и повторяемо (второй запуск ничего не меняет):
 *  1. `from "cn"` → `from "@/lib/utils"` (CLI 4.x тянет пакет `cn`; у нас свой `cn` на clsx + tailwind-merge);
 *  2. убирает `dark:`-варианты (у staff CRM тёмной темы нет);
 *  3. роль shadcn `accent` → токены EVO (`bg-accent` в EVO — красный): `bg-accent` → `bg-surface-2`,
 *     `text-accent-foreground` → `text-fg`.
 * Руками остаётся: радиусы (`rounded-card` / `rounded-ctl` / `rounded-nav`), высоты 44 px, роли шрифта
 * `t-*`, фокус (его рисует globals.css, ring-классы shadcn убирают), `opacity-*` на тексте. Скрипт перечисляет
 * такие строки как замечания (на готовых примитивах `src/components/ui` часть замечаний ожидаема: чип 20 px
 * не нажимается); с `--check` ничего не записывает и завершается кодом 1, только если остались механические правки.
 * После `shadcn add` выполните и `npm uninstall cn`, если CLI добавил этот пакет.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const check = args.includes("--check");
const targets = args.filter((arg) => !arg.startsWith("--"));
if (targets.length === 0) targets.push("src/components/ui");

const TOKEN_END = String.raw`(?![\w-])`;
const PREFIX = String.raw`(?<![\w-])`;
const REWRITES = [
  [/from "cn"/g, 'from "@/lib/utils"'],
  [/\s+(?:[^\s"'`]*:)?dark:[^\s"'`]+/g, ""],
  [new RegExp(`${PREFIX}text-accent-foreground${TOKEN_END}`, "g"), "text-fg"],
  [new RegExp(`${PREFIX}bg-accent${TOKEN_END}`, "g"), "bg-surface-2"],
];
const REVIEW = [
  [/(?<![\w-])rounded-(?:xs|sm|md|lg|xl|2xl|3xl|4xl)(?![\w-])/, "радиус: rounded-card / rounded-ctl / rounded-nav"],
  [/(?<![\w-])(?:min-)?h-(?:[1-9]|10)(?![\w-])/, "высота меньше 44 px (h-11 у нажимаемого)"],
  [/(?:focus-visible|focus):(?:ring|border-ring|outline-ring)/, "фокус рисует globals.css: ring-классы shadcn убрать"],
  [/(?<![\w-])opacity-\d+/, "прозрачность на тексте запрещена: сплошной токен"],
  [/(?<![\w-])(?:text-xs|text-sm|font-medium|font-heading)(?![\w-])/, "роль шрифта: t-label / t-body-compact / t-caption"],
];

function files(path) {
  if (statSync(path).isDirectory()) {
    return readdirSync(path).flatMap((name) => files(join(path, name)));
  }
  return /\.(tsx|ts)$/.test(path) ? [path] : [];
}

let changed = 0;
let notes = 0;
for (const target of targets) {
  for (const file of files(target)) {
    const before = readFileSync(file, "utf8");
    let after = before;
    for (const [pattern, replacement] of REWRITES) after = after.replace(pattern, replacement);
    if (after !== before) {
      changed += 1;
      console.log(`${check ? "нужна правка" : "исправлено"}: ${file}`);
      if (!check) writeFileSync(file, after);
    }
    after.split("\n").forEach((line, index) => {
      for (const [pattern, hint] of REVIEW) {
        if (pattern.test(line)) {
          notes += 1;
          console.log(`  ${file}:${index + 1}: ${hint}`);
        }
      }
    });
  }
}
console.log(`файлов с правкой: ${changed}; замечаний для ручной правки: ${notes}`);
if (check && changed > 0) process.exit(1);
