import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

// Реальный модуль чтения, собранный как есть; только `server-only` и клиент базы заменены пустышками: список шаблонов их не зовёт.
async function loadReader() {
  const stub = { name: "stub", setup(b) {
    b.onResolve({ filter: /^server-only$|\/supabase\/(server|config)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const createSupabaseServerClient = () => { throw new Error('unused'); }; export const getSupabasePublicConfig = () => ({});", loader: "js" }));
  } };
  const out = await build({
    stdin: { contents: `export { reviewedUniversityTemplates } from "./src/lib/v3/university-source.ts";`, resolveDir: root, sourcefile: "reader.ts", loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", target: "node22", plugins: [stub], external: ["next/*", "react"],
  });
  const cjs = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(cjs, cjs.exports, require);
  return cjs.exports;
}

test("шаблоны разбираются один раз на процесс, и результат тот же, что у прямого чтения шести пакетов", async () => {
  const { reviewedUniversityTemplates } = await loadReader();
  const first = reviewedUniversityTemplates();
  assert.equal(reviewedUniversityTemplates(), first, "повторный вызов отдаёт тот же разобранный список");
  const expected = ["china", "malaysia", "europe", "turkey", "international", "other"]
    .flatMap((name) => JSON.parse(readFileSync(new URL(`../src/lib/server/university-catalog-reviewed-${name}.json`, import.meta.url), "utf8")));
  assert.deepEqual(first.map((item) => item.key), expected.map((entry) => entry.key), "порядок и ключи прежние");
  assert.deepEqual(first.map((item) => item.content), expected.map((entry) => entry.content), "разбор не меняет карточки");
  assert.ok(Object.isFrozen(first), "общий список нельзя менять между запросами");
});
