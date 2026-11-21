import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

/**
 * «Студенты» · карточка дела (`/profile?case=`): независимые чтения стартуют вместе.
 *
 * Настоящий `profile-source.ts` (и настоящие `case-access-contract.ts`, `profile-route-load.ts`) собираются esbuild;
 * подменены только чтения базы: каждое чтение записывается в журнал и ждёт, пока тест его не завершит. Так видно не
 * время, а порядок: что уже начато, пока цепочка «лид, передача, условия» ещё ждёт ответа. Это проверка порядка
 * запуска чтений на сервере страницы, а не ответа базы: права по-прежнему решает SQL.
 */
const ENTRY = fileURLToPath(new URL("../src/lib/v3/profile-source.ts", import.meta.url));
const REAL = new Map([
  ["./case-access-contract", fileURLToPath(new URL("../src/lib/v3/case-access-contract.ts", import.meta.url))],
  ["./profile-route-load", fileURLToPath(new URL("../src/lib/v3/profile-route-load.ts", import.meta.url))],
]);

/** Имена, которые файл берёт из модуля: `import { a, b as c, type D } from "path"`. */
function importedNames(source, path) {
  const names = new Set();
  const pattern = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/gu;
  for (const match of source.matchAll(pattern)) {
    if (match[1] || match[3] !== path) continue;
    for (const part of match[2].split(",")) {
      const item = part.trim();
      if (!item || item.startsWith("type ")) continue;
      names.add(item.split(/\s+as\s+/u)[0].trim());
    }
  }
  return [...names];
}

const stubFor = (names) => names.map((name) => /^[A-Z0-9_]+$/u.test(name)
  ? `export const ${name} = Object.freeze([]);`
  : `export const ${name} = (...args) => globalThis.__pc.call(${JSON.stringify(name)}, args);`).join("\n");

const bundle = await build({
  entryPoints: [ENTRY], bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{
    name: "profile-reads",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return undefined;
        if (REAL.has(args.path)) return { path: REAL.get(args.path) };
        if (args.path === "../platform-student-handoff.ts") return { path: args.path, namespace: "stub", pluginData: { importer: args.importer } };
        return { path: args.path, namespace: "stub", pluginData: { importer: args.importer } };
      });
      b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => {
        if (args.path === "../platform-student-handoff.ts") {
          return { loader: "js", contents: "export class PlatformStudentHandoffRepositoryError extends Error { constructor(reason) { super(reason); this.reason = reason; } }" };
        }
        const importer = readFileSync(args.pluginData.importer, "utf8");
        return { loader: "js", contents: stubFor(importedNames(importer, args.path)) };
      });
    },
  }],
});
const { readProfileTarget } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const CASE = "30000000-0000-4000-8000-000000000001";
const LEAD = "20000000-0000-4000-8000-000000000002";
const ORG = "10000000-0000-4000-8000-000000000003";

/** Чтение, которое стартует сразу и отвечает, когда тест скажет. */
function gate() {
  let resolve;
  let reject;
  const promise = new Promise((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}
const settle = () => new Promise((done) => setImmediate(done));

function setup({ salesRead, state = "pending" }) {
  const started = [];
  const pending = new Map();
  const reads = (name) => { started.push(name); const g = gate(); (pending.get(name) ?? pending.set(name, []).get(name)).push(g); return g.promise; };
  const handlers = {
    // Права решает актор-заглушка: «Продажи» читает лид, «Приём» открывает дело.
    staffPresentationCan: (_actor, key) => key === "admissions.read" || (key === "sales.read" && salesRead),
    staffHasPermission: () => false,
    isStaffPreview: () => false,
    staffCan: () => false,
    getPlatformStudentCaseView: () => reads("view"),
    listPlatformStudentCaseLeadLinks: () => reads("links"),
    readCaseNotes: () => reads("notes"),
    getPlatformSalesLead: () => reads("lead"),
    readLeadHandoffStrip: () => reads("strip"),
    readLeadSaleConditions: () => reads("saleConditions"),
    withWhatsAppTitles: () => reads("conversations"),
    getPlatformLeadAdmissionsHandoff: () => reads("handoff"),
    getPlatformLeadAdmissionsGate: () => reads("gate"),
    readStudentCaseCabinetOrigin: () => reads("cabinetOrigin"),
    readCaseSaleConditions: () => reads("caseSaleConditions"),
    readStudentCaseClientEmail: () => reads("clientEmail"),
    portalInviteEmailFor: (_actor, read) => read(),
    createSupabaseServerClient: async () => ({ schema: () => ({ rpc: (name) => reads(`rpc:${name}`) }) }),
  };
  globalThis.__pc = { call: (name, args) => handlers[name]?.(...args) };
  const actor = { organizationId: ORG };
  const run = readProfileTarget(actor, { leadId: null, studentCaseId: CASE });
  // Остальное собирается настоящими чистыми функциями на заглушках и может упасть: проверяется порядок запуска.
  run.catch(() => {});
  const answer = async (name, value) => { for (const g of pending.get(name) ?? []) g.resolve(value); pending.delete(name); await settle(); };
  const view = { access: "full", studentCase: { studentCaseId: CASE, state, studentDisplayName: "Test" } };
  const pendingOf = (name) => pending.get(name) ?? [];
  return { started, answer, view, run, pendingOf };
}

test("a linked case starts its sections and cabinet origin with the lead read, and never reads the case twice", async () => {
  const t = setup({ salesRead: true });
  await settle();
  assert.deepEqual(t.started.sort(), ["links", "notes", "view"], "the case view, its lead link and the notes start together");

  await t.answer("view", t.view);
  assert.ok(!t.started.includes("lead"), "the lead waits for its link");
  await t.answer("links", [{ studentCaseId: CASE, leadId: LEAD }]);
  // Лид, снимок разделов дела и происхождение кабинета - одним заходом; передача и условия ждут лида.
  for (const name of ["lead", "rpc:staff_case_access_snapshot", "cabinetOrigin"]) {
    assert.ok(t.started.includes(name), `${name} starts before the lead answers`);
  }
  assert.ok(!t.started.includes("handoff") && !t.started.includes("gate"), "the Sales chain still waits for the lead");

  await t.answer("lead", { leadId: LEAD, linkedConversations: [] });
  assert.ok(t.started.includes("handoff"), "the handoff read follows the lead (a true dependency)");
  assert.ok(!t.started.includes("gate"), "the gate still follows the handoff: a forbidden handoff never reads it");
  await t.answer("handoff", { caseId: CASE, handedOffAt: null, caseState: "pending" });
  assert.ok(t.started.includes("gate"));
  await t.answer("gate", { contractConfirmed: false, firstPaymentConfirmedAt: null, gateState: "open" });
  assert.equal(t.started.filter((name) => name === "view").length, 1, "the case view read by the route is reused, not read a second time");
  assert.equal(t.started.filter((name) => name === "rpc:staff_case_access_snapshot").length, 1, "the sections start once");
  assert.equal(t.started.filter((name) => name === "cabinetOrigin").length, 1, "the cabinet origin is read once");
});

test("a case without the Sales presentation starts the sections right after the case read, once", async () => {
  const t = setup({ salesRead: false, state: "active" });
  await t.answer("view", t.view);
  assert.ok(t.started.includes("rpc:staff_case_access_snapshot"), "the sections start without waiting for the lead link");
  assert.ok(!t.started.includes("cabinetOrigin"), "only a pending case asks for the cabinet origin");
  assert.ok(!t.started.includes("lead"), "no lead read without sales.read");
  await t.answer("links", []);
  assert.equal(t.started.filter((name) => name === "rpc:staff_case_access_snapshot").length, 1);
});

test("a failing Sales branch leaves no unhandled rejection from the sections it did not wait for", async () => {
  const t = setup({ salesRead: true });
  const unhandled = [];
  const listener = (error) => unhandled.push(error);
  process.on("unhandledRejection", listener);
  try {
    await t.answer("view", t.view);
    await t.answer("links", [{ studentCaseId: CASE, leadId: LEAD }]);
    await t.answer("lead", { leadId: LEAD, linkedConversations: [] });
    // Передача падает (не отказ права), а разделы дела тем временем уже начаты и тоже падают.
    for (const g of t.pendingOf("handoff")) g.reject(new Error("handoff unavailable"));
    for (const g of t.pendingOf("rpc:staff_case_access_snapshot")) g.reject(new Error("sections unavailable"));
    await settle();
    await assert.rejects(t.run, /handoff unavailable/u, "the page fails on the Sales read, as before");
    await settle();
  } finally {
    process.off("unhandledRejection", listener);
  }
  assert.deepEqual(unhandled, []);
});
