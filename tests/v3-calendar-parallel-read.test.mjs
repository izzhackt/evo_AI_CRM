// «Календарь»: недатированная страница читается рядом с датированными, а не после них (скорость, миграция 369).
// Датированные страницы остаются последовательными: курсор следующей берётся из предыдущей. Все данные синтетические.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Мини-загрузчик TS: границы сервера подменяются явно (`overrides` — по тексту импорта). */
function loader(overrides = {}) {
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const code = ts.transpileModule(read(path), { fileName: path, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    const compiled = { exports: {} };
    cache.set(path, compiled);
    const resolveFile = (base) => [`${base}.ts`, `${base}.tsx`, base].find((file) => existsSync(new URL(`../${file}`, import.meta.url)) && /\.tsx?$/.test(file));
    new Function("require", "module", "exports", code)((id) => {
      if (id in overrides) return overrides[id];
      if (id === "server-only") return {};
      if (id.startsWith("@/")) return load(resolveFile(join("src", id.slice(2))) ?? assert.fail(id));
      if (id.startsWith(".")) return load(resolveFile(join(dirname(path), id)) ?? assert.fail(`${path}: ${id}`));
      return require(id);
    }, compiled, compiled.exports);
    return compiled.exports;
  }
  return load;
}

const task = (key) => ({ key });
const cursor = (taskId) => ({ sortAt: "2026-09-10T00:00:00+00:00", kind: "case", taskId });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function adapterWith(readPage) {
  const unused = () => { throw new Error("not used"); };
  return loader({
    "@/lib/platform-admissions-workspace": { getPlatformAdmissionsTaskTarget: unused },
    "@/lib/platform-admissions": { listPlatformStudentCases: unused },
    "@/lib/platform-access": { staffPresentationCan: () => false },
    "@/lib/v3/personal-calendar-contract": { personalCalendarAccess: () => ({ tasks: true }), readPersonalCalendarPage: readPage, readPersonalCalendarTarget: unused },
  })("src/lib/v3/calendar-source.ts");
}

test("the undated call starts before the first dated page returns; dated pages stay sequential", async () => {
  const calls = [];
  const gates = { dated1: deferred(), dated2: deferred(), undated: deferred() };
  const adapter = adapterWith((_actor, options) => {
    calls.push(options.mode === "undated" ? "undated" : `dated:${options.cursor?.taskId ?? "first"}`);
    if (options.mode === "undated") return gates.undated.promise;
    return (options.cursor ? gates.dated2 : gates.dated1).promise;
  });
  const result = adapter.readCalendarTasks({}, "2026-09-07", "2026-09-13", null);
  await new Promise((resolve) => setImmediate(resolve));
  // Both reads are in flight while the first dated page is still pending; the second dated page waits for its cursor.
  assert.deepEqual(calls, ["dated:first", "undated"]);
  gates.undated.resolve({ tasks: [task("staff:u1")], nextCursor: cursor("next-u") });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["dated:first", "undated"]);
  gates.dated1.resolve({ tasks: [task("case:d1")], nextCursor: cursor("d1") });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["dated:first", "undated", "dated:d1"]);
  gates.dated2.resolve({ tasks: [task("case:d2")], nextCursor: null });
  const { tasks, undatedNextCursor } = await result;
  assert.deepEqual(tasks.map((item) => item.key), ["case:d1", "case:d2", "staff:u1"]);
  assert.deepEqual(undatedNextCursor, cursor("next-u"));
  assert.ok(Object.isFrozen(tasks));
});

test("the undated cursor reaches only the undated call", async () => {
  const seen = [];
  const adapter = adapterWith(async (_actor, options) => {
    seen.push([options.mode, options.cursor]);
    return { tasks: [], nextCursor: null };
  });
  const undatedCursor = cursor("u-cursor");
  await adapter.readCalendarTasks({}, "2026-09-07", "2026-09-13", undatedCursor);
  assert.deepEqual(seen.find(([mode]) => mode === "dated"), ["dated", null]);
  assert.deepEqual(seen.find(([mode]) => mode === "undated"), ["undated", undatedCursor]);
});

test("a duplicate between the dated and undated reads still fails, and a failed read rejects the whole read", async () => {
  const duplicate = adapterWith(async (_actor, options) => ({ tasks: [task("case:same")], nextCursor: null, mode: options.mode }));
  await assert.rejects(() => duplicate.readCalendarTasks({}, "2026-09-07", "2026-09-13"), /duplicate task/u);
  const failing = adapterWith(async (_actor, options) => {
    if (options.mode === "undated") throw new Error("undated read failed");
    return { tasks: [], nextCursor: null };
  });
  await assert.rejects(() => failing.readCalendarTasks({}, "2026-09-07", "2026-09-13"), /undated read failed/u);
});

test("when both reads fail the dated error surfaces first, whatever the timing", async () => {
  for (const undatedFirst of [false, true]) {
    const gates = { dated: deferred(), undated: deferred() };
    const adapter = adapterWith((_actor, options) => (options.mode === "undated" ? gates.undated : gates.dated).promise);
    const result = adapter.readCalendarTasks({}, "2026-09-07", "2026-09-13");
    const outcome = assert.rejects(() => result, /dated read failed/u);
    await new Promise((resolve) => setImmediate(resolve));
    const failDated = () => gates.dated.reject(new Error("dated read failed"));
    const failUndated = () => gates.undated.reject(new Error("undated read failed"));
    if (undatedFirst) { failUndated(); await new Promise((resolve) => setImmediate(resolve)); failDated(); } else { failDated(); failUndated(); }
    await outcome;
  }
});
