import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { filterLicenses, loadLicenses, safeProjectUrl, type LicenseData } from "@/features/profile/licenses";

const core = path.resolve(__dirname, "../../../../scripts/licenses-core.mjs");

/** Генератор — ESM-скрипт Node; запускаем его как есть на выдуманном node_modules. */
function build(files: Record<string, string>, extras: unknown[] = []) {
  const root = mkdtempSync(path.join(tmpdir(), "evo-lic-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  }
  const script = `import { buildLicenses } from ${JSON.stringify(core)};
    const r = buildLicenses({ root: ${JSON.stringify(root)}, extras: ${JSON.stringify(extras)}, extrasDir: ${JSON.stringify(root)} });
    process.stdout.write(JSON.stringify(r));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout) as { missing: string[]; data: LicenseData };
}

const pkg = (name: string, extra: Record<string, unknown> = {}) => JSON.stringify({ name, version: "1.2.3", ...extra });

describe("генератор лицензий", () => {
  const fixture = {
    "package.json": pkg("app", { dependencies: { a: "1", b: "1", "@s/c": "1" } }),
    "node_modules/a/package.json": pkg("a", { license: "MIT", repository: { url: "git+https://github.com/x/a.git" }, dependencies: { d: "1" } }),
    "node_modules/a/LICENSE": "MIT License\r\n\r\nCopyright (c) A\r\n",
    "node_modules/b/package.json": pkg("b", { licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] }),
    "node_modules/b/LICENSE.md": "B licence text",
    "node_modules/b/NOTICE": "B notice",
    "node_modules/@s/c/package.json": pkg("@s/c", { license: { type: "ISC" } }),
    "node_modules/d/package.json": pkg("d", { license: "MIT" }),
    "node_modules/d/license": "MIT License\n\nCopyright (c) A",
    "node_modules/unused/package.json": pkg("unused", { license: "GPL-3.0" }),
    "node_modules/unused/LICENSE": "must not appear",
    "assets/OFL.txt": "OFL text",
  };

  it("обходит продакшен-зависимости и их зависимости, лишние пакеты не берёт", () => {
    const { data, missing } = build(fixture);
    expect(missing).toEqual([]);
    expect(data.packages.map((p) => p.name)).toEqual(["@s/c", "a", "b", "d"]);
  });

  it("читает license в трёх формах и адрес репозитория без git+ и .git", () => {
    const { data } = build(fixture);
    const by = Object.fromEntries(data.packages.map((p) => [p.name, p]));
    expect(by.a?.license).toBe("MIT");
    expect(by.a?.url).toBe("https://github.com/x/a");
    expect(by.b?.license).toBe("(MIT OR Apache-2.0)");
    expect(by["@s/c"]?.license).toBe("ISC");
  });

  it("склеивает LICENSE и NOTICE, одинаковые тексты хранит один раз, пакет без файла получает text null", () => {
    const { data } = build(fixture);
    const by = Object.fromEntries(data.packages.map((p) => [p.name, p]));
    expect(by.a?.text).toBe(by.d?.text); // CRLF и регистр имени файла не создают дубль
    expect(data.texts[by.a?.text ?? ""]).toBe("MIT License\n\nCopyright (c) A");
    expect(data.texts[by.b?.text ?? ""]).toBe("B licence text\n\n---\n\nB notice");
    expect(by["@s/c"]?.text).toBeNull();
    expect(Object.values(data.texts)).not.toContain("must not appear");
  });

  it("добавляет записи вне npm (шрифты, карта) с текстом из файла", () => {
    const { data } = build(fixture, [{ name: "Golos (шрифт)", license: "OFL-1.1", url: "https://example.test", textFile: "assets/OFL.txt" }]);
    const font = data.packages.find((p) => p.name === "Golos (шрифт)");
    expect(font).toMatchObject({ kind: "asset", license: "OFL-1.1" });
    expect(data.texts[font?.text ?? ""]).toBe("OFL text");
  });

  it("вывод детерминирован", () => {
    expect(build(fixture).data).toEqual(build(fixture).data);
  });

  it("зависимость, которой нет в node_modules, попадает в missing", () => {
    const { missing } = build({ "package.json": pkg("app", { dependencies: { ghost: "1" } }) });
    expect(missing).toEqual(["ghost"]);
  });
});

describe("сгенерированный licenses.generated.json в репозитории", () => {
  const data = loadLicenses();
  const names = data.packages.map((p) => p.name);

  it("содержит продакшен-зависимости приложения и обязательные записи плана", () => {
    for (const name of ["react", "react-native", "expo", "@supabase/supabase-js", "aes-js", "lucide-react-native"]) expect(names).toContain(name);
    for (const part of ["Golos Text", "JetBrains Mono", "MapLibre Native", "OpenFreeMap", "OpenMapTiles", "OpenStreetMap", "MathJax"]) {
      expect(names.some((n) => n.includes(part))).toBe(true);
    }
  });

  it("OpenStreetMap — ODbL, MathJax — Apache-2.0, шрифты — OFL, и у них есть текст", () => {
    const get = (part: string) => data.packages.find((p) => p.name.includes(part));
    expect(get("OpenStreetMap")?.license).toBe("ODbL-1.0");
    expect(get("MathJax")?.license).toBe("Apache-2.0");
    expect(get("Golos")?.license).toBe("OFL-1.1");
    for (const part of ["OpenStreetMap", "MathJax", "Golos", "JetBrains", "MapLibre", "OpenMapTiles", "OpenFreeMap"]) {
      const text = data.texts[get(part)?.text ?? ""] ?? "";
      expect(text.length).toBeGreaterThan(50);
    }
    expect(data.texts[get("MathJax")?.text ?? ""]).toContain("Apache License");
  });

  it("каждая ссылка на текст указывает на существующий текст", () => {
    for (const p of data.packages) if (p.text !== null) expect(data.texts[p.text]).toBeTruthy();
  });
});

describe("поиск и ссылки", () => {
  const data = loadLicenses();
  it("пустой запрос — все записи, записи вне npm первыми", () => {
    const all = filterLicenses(data, "");
    expect(all).toHaveLength(data.packages.length);
    expect(all[0]?.kind).toBe("asset");
  });
  it("ищет по названию и по лицензии без учёта регистра", () => {
    expect(filterLicenses(data, "  REACT-NATIVE ").every((p) => p.name.toLowerCase().includes("react-native"))).toBe(true);
    expect(filterLicenses(data, "odbl").map((p) => p.name)).toEqual(expect.arrayContaining([expect.stringContaining("OpenStreetMap")]));
    expect(filterLicenses(data, "zzzz-нет-такого")).toEqual([]);
  });
  it("в браузер уходят только http(s)-ссылки", () => {
    expect(safeProjectUrl("https://github.com/x")).toBe("https://github.com/x");
    expect(safeProjectUrl("javascript:alert(1)")).toBeNull();
    expect(safeProjectUrl("")).toBeNull();
  });
});
