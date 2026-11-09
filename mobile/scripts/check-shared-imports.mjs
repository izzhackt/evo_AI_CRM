#!/usr/bin/env node
// Страж общих импортов (ADR 0038, п. 2). Приложение может брать из <repo>/src только
// чистые модули. Скрипт обходит импорты каждого файла mobile/src и падает, если
// файл веба (прямо или через цепочку импортов):
//   - импортирует next, next/*, server-only, react-dom, react-dom/*;
//   - подключает пакет, которого нет в mobile/package.json;
//   - тянет CSS или файл вне <repo>/src;
//   - содержит директиву "use server" или обращается к DOM (document, window, localStorage,
//     globalThis/self/global...);
//   - вызывает import()/require() не со строковым литералом (в т.ч. шаблонной строкой):
//     такую ссылку нельзя проверить статически.
// Импорты `import type` / `export type` стираются при сборке и не обходятся.
//   node scripts/check-shared-imports.mjs [--root <repo>]
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"];
const FORBIDDEN_PACKAGES = [/^next($|\/)/, /^server-only$/, /^react-dom($|\/)/];
const DOM_PATTERN = /(^|[^\w.$])(document|window|localStorage|sessionStorage|navigator|HTMLElement|globalThis|self|global)\b(?!\s*:)/;

const here = path.dirname(fileURLToPath(import.meta.url));
const rootArg = process.argv.indexOf("--root");
const repoRoot = path.resolve(rootArg >= 0 ? process.argv[rootArg + 1] : path.join(here, "../.."));
const mobileRoot = path.join(repoRoot, "mobile");
const webSrc = path.join(repoRoot, "src");

const mobilePackage = JSON.parse(readFileSync(path.join(mobileRoot, "package.json"), "utf8"));
const mobileDeps = new Set([...Object.keys(mobilePackage.dependencies ?? {}), ...Object.keys(mobilePackage.devDependencies ?? {})]);
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

const rel = (p) => path.relative(repoRoot, p);

function stripNoise(code) {
  // комментарии, затем содержимое строковых литералов
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""');
}

/** Модульные ссылки файла без type-only. */
export function moduleSpecifiers(code) {
  const text = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const found = [];
  const stmt = /(?:^|[\n;])\s*(import|export)\s+(type\s+)?(?:[^'"`;]*?\sfrom\s+)?(['"])([^'"\n]+)\3/g;
  for (const m of text.matchAll(stmt)) {
    if (!m[2]) found.push(m[4]);
  }
  for (const m of text.matchAll(/\b(?:require|import)\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g)) found.push(m[2]);
  return found;
}

/** import(...)/require(...), где аргумент не простой строковый литерал. */
export function hasNonLiteralLoad(code) {
  const text = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  return /(?<![\w$.])(?:require|import)\s*\(\s*(?!(['"])[^'"\n]+\1\s*\))/.test(text);
}

function listFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function resolveFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTENSIONS) {
    const idx = path.join(base, `index${ext}`);
    if (existsSync(idx)) return idx;
  }
  // импорт "./x.ts" там, где лежит x.ts, найден выше; "./x.js" -> x.ts
  const noExt = base.replace(/\.(m?js|jsx)$/, "");
  if (noExt !== base) return resolveFile(noExt);
  return null;
}

const problems = [];
const visited = new Set();

function bare(spec) {
  return !spec.startsWith(".") && !spec.startsWith("/") && !spec.startsWith("@web/") && !(spec.startsWith("@/"));
}

function packageName(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** Каталог, относительно которого разрешается `@/`: у mobile это mobile/src, у веба <repo>/src. */
function resolveSpec(fromFile, spec) {
  const inMobile = fromFile.startsWith(mobileRoot + path.sep);
  if (spec.startsWith("@web/")) return resolveFile(path.join(webSrc, spec.slice(5)));
  if (spec.startsWith("@/")) return resolveFile(path.join(inMobile ? path.join(mobileRoot, "src") : webSrc, spec.slice(2)));
  return resolveFile(path.resolve(path.dirname(fromFile), spec));
}

function checkWebFile(file, chain) {
  if (visited.has(file)) return;
  visited.add(file);
  const at = [...chain, rel(file)].join(" -> ");
  if (!file.startsWith(webSrc + path.sep)) {
    problems.push(`${at}\n    файл вне ${rel(webSrc)}: общий код берётся только из src/ веба`);
    return;
  }
  if (file.endsWith(".json")) return;
  if (/\.(css|scss)$/.test(file)) {
    problems.push(`${at}\n    CSS нельзя подключать из общего кода`);
    return;
  }
  const code = readFileSync(file, "utf8");
  if (/^\s*["']use (server|client)["']/m.test(code.replace(/\/\*[\s\S]*?\*\//g, ""))) {
    problems.push(`${at}\n    директива "use server"/"use client": это код Next, не чистый модуль`);
  }
  if (DOM_PATTERN.test(stripNoise(code))) {
    problems.push(`${at}\n    обращение к DOM (document/window/localStorage/navigator)`);
  }
  if (hasNonLiteralLoad(code)) {
    problems.push(`${at}\n    import()/require() не со строковым литералом: ссылку нельзя проверить статически`);
  }
  for (const spec of moduleSpecifiers(code)) visitSpec(file, spec, [...chain, rel(file)]);
}

function visitSpec(fromFile, spec, chain) {
  const at = [...chain, spec].join(" -> ");
  if (bare(spec)) {
    const name = packageName(spec);
    if (FORBIDDEN_PACKAGES.some((re) => re.test(spec))) {
      problems.push(`${at}\n    запрещённый пакет ${name} (next, server-only, react-dom)`);
    } else if (!nodeBuiltins.has(spec) && !mobileDeps.has(name)) {
      problems.push(`${at}\n    пакета ${name} нет в mobile/package.json`);
    }
    return;
  }
  const target = resolveSpec(fromFile, spec);
  if (!target) {
    problems.push(`${at}\n    импорт не найден`);
    return;
  }
  if (target.startsWith(mobileRoot + path.sep)) {
    // файл самого приложения: его импорты проверяются отдельно
    return;
  }
  checkWebFile(target, chain);
}

const files = listFiles(path.join(mobileRoot, "src"));
for (const file of files) {
  const code = readFileSync(file, "utf8");
  for (const spec of moduleSpecifiers(code)) {
    const mobileFile = file;
    if (bare(spec)) continue; // пакеты приложения проверяет expo-doctor
    const target = resolveSpec(mobileFile, spec);
    if (target && !target.startsWith(mobileRoot + path.sep)) visitSpec(mobileFile, spec, [rel(mobileFile)]);
    else if (!target) problems.push(`${rel(file)} -> ${spec}\n    импорт не найден`);
  }
}

if (problems.length) {
  console.error(`Страж общих импортов: найдено нарушений ${problems.length}\n`);
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}
console.log(`Страж общих импортов: ${files.length} файлов приложения, ${visited.size} общих файлов, нарушений нет.`);
