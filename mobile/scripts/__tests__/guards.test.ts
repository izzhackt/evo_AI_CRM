import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const mobile = path.resolve(__dirname, "../..");
const run = (script: string, ...args: string[]) =>
  spawnSync(process.execPath, [path.join(mobile, "scripts", script), ...args], { encoding: "utf8" });

describe("токены", () => {
  it("tokens.generated.ts соответствует portal.css", () => {
    const result = run("sync-tokens.mjs", "--check");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});

describe("страж общих импортов", () => {
  it("на реальном репозитории нарушений нет", () => {
    const result = run("check-shared-imports.mjs");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  function fixture(files: Record<string, string>) {
    const root = mkdtempSync(path.join(tmpdir(), "evo-guard-"));
    const all: Record<string, string> = { "mobile/package.json": JSON.stringify({ dependencies: { react: "1" } }), ...files };
    for (const [name, content] of Object.entries(all)) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), content);
    }
    return root;
  }

  it.each([
    ["next", 'import { headers } from "next/headers";\nexport const x = headers;'],
    ["server-only", 'import "server-only";\nexport const x = 1;'],
    ["react-dom", 'import { createPortal } from "react-dom";\nexport const x = createPortal;'],
    ["DOM", "export const w = window.innerWidth;"],
    ["use server", '"use server";\nexport async function a() {}'],
    ["globalThis", "export const w = globalThis.localStorage;"],
    ["self", "export const w = self.location;"],
    ["global", "export const w = global.process;"],
    ["require с переменной", "const n = 'next/headers';\nexport const x = require(n);"],
    ["import() с шаблонной строкой", "const n = 'a';\nexport const x = () => import(`./${n}`);"],
    ["import() с выражением", "export const x = (n: string) => import(n);"],
  ])("падает на %s", (_name, body) => {
    const root = fixture({ "src/lib/bad.ts": body, "mobile/src/a.ts": 'import { x } from "@web/lib/bad";\nexport default x;' });
    try {
      const result = run("check-shared-imports.mjs", "--root", root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("src/lib/bad.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("находит нарушение в цепочке импортов и показывает путь", () => {
    const root = fixture({
      "src/lib/ok.ts": 'import { y } from "./deep";\nexport const x = y;',
      "src/lib/deep.ts": 'import { cookies } from "next/headers";\nexport const y = cookies;',
      "mobile/src/a.ts": 'import { x } from "../../src/lib/ok";\nexport default x;',
    });
    try {
      const result = run("check-shared-imports.mjs", "--root", root);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/ok\.ts -> src\/lib\/deep\.ts/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("не путает свойства и литералы с динамической загрузкой", () => {
    const root = fixture({
      "src/lib/pure.ts": 'export const a = obj.import(x);\nexport const b = () => import("./other");\nexport const c = "self"; // global\nexport const d = this.self2;',
      "src/lib/other.ts": "export const o = 1;",
      "mobile/src/a.ts": 'import { a } from "@web/lib/pure";\nexport default a;',
    });
    try {
      const result = run("check-shared-imports.mjs", "--root", root);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("пропускает чистый модуль, JSON и import type", () => {
    const root = fixture({
      "src/lib/pure.ts": 'import type { Foo } from "next/server";\nimport data from "./d.json";\nexport const x: Foo | null = null as never; export { data };',
      "src/lib/d.json": "{}",
      "mobile/src/a.ts": 'import { x } from "@web/lib/pure";\nexport default x;',
    });
    try {
      const result = run("check-shared-imports.mjs", "--root", root);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
