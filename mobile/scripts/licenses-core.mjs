// Сборка списка лицензий сторонних библиотек (экран «Лицензии сторонних библиотек»).
// Читает package.json и файлы LICENSE пакетов из node_modules на этапе сборки; в приложении файловой
// системы нет, оно показывает готовый JSON. Состав: продакшен-зависимости приложения и всё, что они тянут
// (dependencies/optionalDependencies, как их разрешает Node), плюс записи вне npm (шрифты, карта, данные).
// Список намеренно с запасом: в него попадают и зависимости инструментов сборки, которые тянет expo
// (лишняя строка безвредна, пропущенная лицензия поставляемого пакета нет).
// Вывод детерминирован (сортировка, без дат), поэтому diff показывает реальные изменения состава.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const LICENSE_FILE = /^(licen[sc]e|copying|notice)(\.|-|_|$)/i;
const MAX_TEXT = 200_000;

/** SPDX-строка из поля license / licenses пакета. */
export function licenseId(pkg) {
  const l = pkg.license;
  if (typeof l === "string" && l.trim()) return l.trim();
  if (l && typeof l === "object" && typeof l.type === "string") return l.type.trim();
  if (Array.isArray(pkg.licenses)) {
    const ids = pkg.licenses.map((x) => (typeof x === "string" ? x : x?.type)).filter(Boolean);
    if (ids.length) return `(${ids.join(" OR ")})`;
  }
  return "UNKNOWN";
}

/** Адрес репозитория без git+ и .git. */
export function repositoryUrl(pkg) {
  const r = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const raw = (typeof r === "string" && r) || (typeof pkg.homepage === "string" && pkg.homepage) || "";
  return raw.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/\.git$/, "").replace(/^github:/, "https://github.com/");
}

/** Текст лицензии из каталога пакета: все файлы LICENSE/COPYING/NOTICE, склеенные. */
export function readLicenseText(dir, fs = { readdirSync, readFileSync, statSync }) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => LICENSE_FILE.test(n)).sort();
  } catch {
    return null;
  }
  const parts = [];
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      if (!fs.statSync(full).isFile()) continue;
      parts.push(fs.readFileSync(full, "utf8").replace(/\r\n/g, "\n").trim());
    } catch {
      // нечитаемый файл пропускается
    }
  }
  const text = parts.filter(Boolean).join("\n\n---\n\n");
  return text ? text.slice(0, MAX_TEXT) : null;
}

/** package.json пакета `name`, как его разрешает Node из каталога `from` (поиск вверх по node_modules). */
function resolvePackageDir(name, from, root) {
  let dir = from;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    if (dir === root || path.dirname(dir) === dir) return null;
    dir = path.dirname(dir);
  }
}

/** Обход зависимостей от корня; возвращает пакеты, отсортированные по имени и версии. */
export function collectPackages(root) {
  const rootPkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const seen = new Map();
  const queue = [];
  const enqueue = (names, from, optional) => {
    for (const name of Object.keys(names ?? {})) {
      const dir = resolvePackageDir(name, from, root);
      if (!dir) {
        if (!optional) queue.push({ missing: name });
        continue;
      }
      queue.push({ dir });
    }
  };
  enqueue(rootPkg.dependencies, root, false);
  const missing = [];
  while (queue.length) {
    const item = queue.pop();
    if (item.missing) {
      missing.push(item.missing);
      continue;
    }
    if (seen.has(item.dir)) continue;
    const pkg = JSON.parse(readFileSync(path.join(item.dir, "package.json"), "utf8"));
    seen.set(item.dir, pkg);
    enqueue(pkg.dependencies, item.dir, false);
    enqueue(pkg.optionalDependencies, item.dir, true);
  }
  const list = [...seen].map(([dir, pkg]) => ({ dir, pkg }));
  list.sort((a, b) => (a.pkg.name ?? "").localeCompare(b.pkg.name ?? "") || String(a.pkg.version).localeCompare(String(b.pkg.version)));
  return { list, missing };
}

const textId = (text) => `t${createHash("sha256").update(text).digest("hex").slice(0, 10)}`;

/**
 * Собрать JSON. `extras`: записи вне npm `{ name, version?, license, url?, textFile? | text? }`;
 * `extrasDir` — где лежат файлы текстов.
 */
export function buildLicenses({ root, extras = [], extrasDir = root }) {
  const { list, missing } = collectPackages(root);
  const texts = {};
  const packages = [];
  const put = (entry, text) => {
    let id = null;
    if (text) {
      id = textId(text);
      texts[id] = text;
    }
    packages.push({ ...entry, text: id });
  };
  const own = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).name;
  const listed = new Set();
  for (const { dir, pkg } of list) {
    if (!pkg.name || pkg.name === own) continue;
    // Одна и та же версия в нескольких каталогах node_modules показывается один раз.
    const id = `${pkg.name}@${pkg.version}`;
    if (listed.has(id)) continue;
    listed.add(id);
    put(
      { name: pkg.name, version: String(pkg.version ?? ""), license: licenseId(pkg), url: repositoryUrl(pkg), kind: "npm" },
      readLicenseText(dir),
    );
  }
  for (const extra of extras) {
    const text = extra.text ?? (extra.textFile ? readFileSync(path.join(extrasDir, extra.textFile), "utf8").replace(/\r\n/g, "\n").trim() : null);
    put({ name: extra.name, version: extra.version ?? "", license: extra.license, url: extra.url ?? "", kind: "asset" }, text);
  }
  return { missing, data: { packages, texts: Object.fromEntries(Object.entries(texts).sort(([a], [b]) => a.localeCompare(b))) } };
}

/** Записи вне npm, которые приложение показывает по решению плана (PLAN.md M6). */
export const EXTRA_ENTRIES = [
  { name: "Golos Text (шрифт)", license: "OFL-1.1", url: "https://github.com/googlefonts/golos-text", textFile: "assets/fonts/OFL-GolosText.txt" },
  { name: "JetBrains Mono (шрифт)", license: "OFL-1.1", url: "https://github.com/JetBrains/JetBrainsMono", textFile: "assets/fonts/OFL-JetBrainsMono.txt" },
  { name: "MapLibre Native", license: "BSD-2-Clause", url: "https://github.com/maplibre/maplibre-native", textFile: "scripts/licenses-extra/maplibre-native-BSD-2-Clause.txt" },
  { name: "OpenFreeMap (тайлы карты)", license: "MIT", url: "https://openfreemap.org", textFile: "scripts/licenses-extra/openfreemap-notice.txt" },
  { name: "OpenMapTiles (схема тайлов)", license: "BSD-3-Clause; CC-BY-4.0", url: "https://openmaptiles.org", textFile: "scripts/licenses-extra/openmaptiles-LICENSE.txt" },
  { name: "OpenStreetMap (данные карты)", license: "ODbL-1.0", url: "https://www.openstreetmap.org/copyright", textFile: "scripts/licenses-extra/openstreetmap-ODbL-notice.txt" },
  { name: "MathJax", license: "Apache-2.0", url: "https://github.com/mathjax/MathJax", textFile: "scripts/licenses-extra/mathjax-Apache-2.0.txt" },
];
