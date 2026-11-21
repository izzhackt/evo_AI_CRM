// Скорость «Сегодня» и «Финансов» (миграция 367): лиды задач-перезвонов одним чтением и начатым заранее; одинаковые чтения доски
// и ссылки отчёта один раз за запрос; «Финансы» читает независимое вместе; страница не шлёт очередь дважды.
// Все данные синтетические. Права по-прежнему решает база: SQL-границу доказывает supabase/tests/platform_today_finance_speed.sql.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Мини-загрузчик TS/TSX: границы сервера подменяются по тексту импорта. */
function loader(overrides = {}) {
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const code = ts.transpileModule(read(path), { fileName: path, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const compiled = { exports: {} };
    cache.set(path, compiled);
    const resolveFile = (base) => [`${base}.ts`, `${base}.tsx`, base, `${base}/index.ts`, `${base}/index.tsx`].find((file) => existsSync(new URL(`../${file}`, import.meta.url)) && /\.tsx?$/.test(file));
    new Function("require", "module", "exports", code)((id) => {
      if (id in overrides) return overrides[id];
      if (id === "server-only") return {};
      if (id.endsWith(".json") && id.startsWith("@/")) return JSON.parse(read(join("src", id.slice(2))));
      if (id.endsWith(".json") && id.startsWith(".")) return JSON.parse(read(join(dirname(path), id)));
      if (id.startsWith("@/")) return load(resolveFile(join("src", id.slice(2))) ?? assert.fail(id));
      if (id.startsWith(".")) return load(resolveFile(join(dirname(path), id)) ?? assert.fail(`${path}: ${id}`));
      return require(id);
    }, compiled, compiled.exports);
    return compiled.exports;
  }
  return load;
}

/**
 * `cache` из React на время одного «запроса»: по значению для примитивов и по ссылке для объектов, как у React в запросе
 * сервера (вне запроса React зовёт функцию напрямую — поэтому остальные тесты файла считают чтения без памяти).
 */
function requestScopedReact() {
  return { ...require("react"), cache: (fn) => {
    const memo = new Map();
    return (...args) => {
      let node = memo;
      for (const arg of args) {
        if (!node.has(arg)) node.set(arg, new Map());
        node = node.get(arg);
      }
      if (!node.has(fn)) node.set(fn, fn(...args));
      return node.get(fn);
    };
  } };
}
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((done) => setImmediate(done)); };

const ORG = "10000000-0000-4000-8000-000000000367";
const base = { organizationId: ORG, presentationRole: null, platformAccessVersion: 1, assignments: [], membershipId: "m-1" };
const admin = { ...base, systemRole: "admin", permissionKeys: [] };
const id = (n) => `36700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CALLBACK = "Перезвонить клиенту";

/** Строка «Сегодня» с рабочей задачей (ключ `staff:<id>`). */
const taskItem = (n, title = CALLBACK) => ({
  key: `staff:${id(n)}`, source: "tasks", band: "today", title, who: null, reason: "", due: null, since: null, waitingDays: null, openHref: "/tasks",
  task: { kind: "staff", key: `staff:${id(n)}`, id: id(n), title },
});

/* ------------------------------------------------------------------ лиды задач-перезвонов: одно чтение */

function leadsSource(refsImpl) {
  const calls = { refs: [], leadContext: 0 };
  const load = loader({
    "../server/platform-staff-task-repository.ts": {
      STAFF_TASK_LEAD_REFS_LIMIT: 50,
      readStaffTaskLeadRefs: async (_actor, ids) => { calls.refs.push([...ids]); return refsImpl(ids); },
      readStaffTaskLeadContext: async () => { calls.leadContext += 1; throw new Error("not used"); },
    },
  });
  return { ...load("src/lib/v3/telephony-task-leads-source.ts"), calls };
}
const refsFor = (ids) => ids.map((taskId, index) => ({ taskId, leadId: id(5000 + index), clientDisplayName: `Клиент ${index + 1}` }));
const bandOf = (items) => ({ bands: [{ band: "today", label: "Сегодня", count: items.length, danger: false, note: null, items }] });

test("«Сегодня»: лиды видимых задач-перезвонов — ОДНО чтение базы вместо двух на задачу; прочие задачи не читаются", async () => {
  const { readTodayTaskLeads, calls } = leadsSource(refsFor);
  const callbacks = [1, 2, 3].map((n) => taskItem(n));
  const result = await readTodayTaskLeads(admin, bandOf([...callbacks, taskItem(4, "Подготовить документы"), taskItem(5, "Перезвонить родителям")]));
  assert.deepEqual(calls.refs, [[id(1), id(2), id(3)]], "один вызов, только задачи самой телефонии");
  assert.equal(calls.leadContext, 0, "второго чтения на лид нет");
  assert.deepEqual(Object.keys(result), callbacks.map((item) => item.key));
  assert.equal(result[callbacks[0].key].name, "Клиент 1");
  assert.equal(result[callbacks[0].key].href, `/profile?id=${encodeURIComponent(id(5000))}`);
});

test("«Сегодня»: предел 15 строк сохранён, задача без записи ответа (лид закрыт или недоступен) остаётся без клиента", async () => {
  const { readTodayTaskLeads, calls } = leadsSource((ids) => refsFor(ids).filter((_ref, index) => index !== 1));
  const items = Array.from({ length: 20 }, (_, index) => taskItem(index + 1));
  // Две группы по десять строк: каждая видна целиком (окно группы), вместе их больше предела.
  const result = await readTodayTaskLeads(admin, { bands: [bandOf(items.slice(0, 10)).bands[0], bandOf(items.slice(10)).bands[0]] });
  assert.equal(calls.refs.length, 1);
  assert.equal(calls.refs[0].length, 15, "не больше TODAY_TASK_LEAD_CAP за один вызов базы");
  assert.equal(Object.keys(result).length, 14);
  assert.equal(items[1].key in result, false, "строка, которой база имя не отдала, без клиента");
});

test("«Сегодня»: сбой чтения лидов — пустой ответ, страница не падает", async () => {
  const { readTodayTaskLeads } = leadsSource(() => { throw new Error("rpc failed"); });
  assert.deepEqual({ ...(await readTodayTaskLeads(admin, bandOf([taskItem(1)]))) }, {});
});

test("лиды начинаются заранее: недостающие задачи дочитываются вторым вызовом, а лишние не попадают в ответ", async () => {
  const { prefetchTodayTaskLeads, readTodayTaskLeads, calls, TODAY_TASK_LEAD_PREFETCH_CAP } = leadsSource(refsFor);
  const tasks = Array.from({ length: 4 }, (_, index) => taskItem(index + 1));
  const prefetch = prefetchTodayTaskLeads(admin, tasks);
  assert.equal(calls.refs.length, 1, "чтение уже начато до сборки групп");
  // Все видимые задачи уже в предзагрузке: больше ни одного вызова.
  const first = await readTodayTaskLeads(admin, bandOf(tasks.slice(0, 2)), prefetch);
  assert.deepEqual(Object.keys(first), [tasks[0].key, tasks[1].key], "в ответе только видимые строки, как раньше");
  assert.equal(calls.refs.length, 1, "одно чтение на страницу");
  // Видимая строка, которой не было в предзагрузке (например, из другого источника группы), дочитывается одним вызовом.
  const late = taskItem(9);
  const second = await readTodayTaskLeads(admin, bandOf([tasks[0], late]), prefetch);
  assert.deepEqual(calls.refs.at(-1), [id(9)], "второй вызов — только недостающие");
  assert.deepEqual(Object.keys(second), [tasks[0].key, late.key]);
  assert.equal(TODAY_TASK_LEAD_PREFETCH_CAP >= 15, true, "предзагрузка не уже предела видимых строк");
});

test("список «Задач»: задачи-перезвоны одним чтением, не больше предела", async () => {
  const { readQueueTaskLeads, calls } = leadsSource(refsFor);
  const tasks = Array.from({ length: 18 }, (_, index) => ({ kind: "staff", key: `staff:${id(index + 1)}`, id: id(index + 1), title: CALLBACK }));
  const result = await readQueueTaskLeads(admin, [{ kind: "case", key: "case:x", id: id(99), title: CALLBACK }, ...tasks]);
  assert.equal(calls.refs.length, 1);
  assert.equal(calls.refs[0].length, 15);
  assert.equal(Object.keys(result).length, 15);
});

/* ------------------------------------------------------------------ страница «Сегодня»: чтение лидов стартует рано */

test("`/main`: лиды перезвонов начинаются, как только прочитан источник задач, а не после всей очереди; чтение одно", async () => {
  const gate = deferred();
  const refs = [];
  const dial = { status: "ready", mapped: true };
  const leads = loader({
    "../server/platform-staff-task-repository.ts": {
      STAFF_TASK_LEAD_REFS_LIMIT: 50,
      readStaffTaskLeadRefs: async (_actor, ids) => { refs.push([...ids]); return refsFor(ids); },
      readStaffTaskLeadContext: async () => { throw new Error("not used"); },
    },
  })("src/lib/v3/telephony-task-leads-source.ts");
  const item = taskItem(1);
  const view = { section: "sales", title: "Продажи", queue: bandOf([item]) };
  const load = loader({
    "@/lib/platform-guards": { requireV3PageActor: async () => admin },
    "@/lib/v3/telephony-dial-source": { readDialOptions: async () => dial },
    "@/lib/v3/telephony-task-leads-source": leads,
    "@/lib/v3/today-source": {
      todayLinks: () => ({ mainAction: null }),
      // Источник задач готов сразу; остальные («доска продаж») ещё читаются: очередь ждёт ворота.
      readTodayQueue: async (_actor, options) => {
        options.onSourceRead({ source: "tasks", state: "complete", items: [item] });
        await gate.promise;
        return { access: { role: { sales: true, admissions: false } }, reads: [] };
      },
    },
    "@/lib/v3/today-queue": {
      buildTodaySections: () => ({ queue: { bands: [], notices: [], today: "2026-11-21" }, sections: [view], headed: false }),
      todayQueueSummary: (queue) => queue,
    },
    "@/components/staff/today-next/TodayNextLazy": { TodayNextLazy: () => null },
    "@/components/staff/sales-next/SalesTabView": { SalesTabView: () => null },
  });
  const pending = load("src/app/(staff)/main/page.tsx").default({ searchParams: Promise.resolve({}) });
  await flush();
  assert.deepEqual(refs, [[id(1)]], "чтение лидов началось, хотя очередь ещё не дочитана");
  gate.resolve();
  const element = await pending;
  assert.deepEqual(refs, [[id(1)]], "после очереди новых чтений нет");
  assert.equal(element.props.taskLeads[item.key].name, "Клиент 1");
});

test("`/main`: набор закрыт этому сотруднику — лиды не читаются вовсе", async () => {
  const refs = [];
  const leads = loader({
    "../server/platform-staff-task-repository.ts": {
      STAFF_TASK_LEAD_REFS_LIMIT: 50,
      readStaffTaskLeadRefs: async (_actor, ids) => { refs.push(ids); return []; },
      readStaffTaskLeadContext: async () => null,
    },
  })("src/lib/v3/telephony-task-leads-source.ts");
  const item = taskItem(1);
  const load = loader({
    "@/lib/platform-guards": { requireV3PageActor: async () => admin },
    "@/lib/v3/telephony-dial-source": { readDialOptions: async () => ({ status: "off" }) },
    "@/lib/v3/telephony-task-leads-source": leads,
    "@/lib/v3/today-source": {
      todayLinks: () => ({ mainAction: null }),
      readTodayQueue: async (_actor, options) => {
        options.onSourceRead({ source: "tasks", state: "complete", items: [item] });
        return { access: { role: { sales: true, admissions: false } }, reads: [] };
      },
    },
    "@/lib/v3/today-queue": {
      buildTodaySections: () => ({ queue: { bands: [] }, sections: [{ queue: bandOf([item]) }], headed: false }),
      todayQueueSummary: (queue) => queue,
    },
    "@/components/staff/today-next/TodayNextLazy": { TodayNextLazy: () => null },
    "@/components/staff/sales-next/SalesTabView": { SalesTabView: () => null },
  });
  const element = await load("src/app/(staff)/main/page.tsx").default({ searchParams: Promise.resolve({}) });
  assert.deepEqual(refs, []);
  assert.equal(element.props.taskLeads, null);
});

test("`readTodayQueue`: `onSourceRead` зовётся по мере готовности источника; сбой обработчика чтение не ломает", async () => {
  const { readTodayQueue } = loader({})("src/lib/v3/today-source.ts");
  const seen = [];
  const readers = {
    listStaffTasks: async () => ({ rows: [], nextCursor: null }),
    listCaseTasks: async () => ({ rows: [], nextCursor: null }),
    readStudentCaseQueue: async () => ({ rows: [], nextCursor: null, today: "2026-11-21" }),
    readLeads: async () => { await flush(); return { leads: [], truncated: false }; },
    readChats: async () => ({ rows: [], truncated: false }),
  };
  const actor = { ...admin, permissionKeys: ["staff.task.read", "lead.read", "lead.sales.workflow.manage", "case.read.full"] };
  const result = await readTodayQueue(actor, { now: new Date("2026-11-21T06:00:00Z"), readers, onSourceRead: (read) => { seen.push(read.source); throw new Error("handler"); } });
  assert.ok(seen.indexOf("tasks") >= 0 && seen.indexOf("tasks") < seen.indexOf("leads"), "источник задач сообщён до медленной доски");
  assert.equal(seen.length, result.reads.length, "каждый источник сообщён один раз");
  assert.ok(result.reads.every((read) => read.state !== "error"), "сбой обработчика не стал сбоем источника");
});

/* ------------------------------------------------------------------ одинаковые чтения за один запрос */

function pipelineWith(react, pages) {
  const calls = [];
  const load = loader({
    react,
    "@/lib/platform-sales": {
      listPlatformSalesLeads: async (_actor, options) => { calls.push(options); return pages(options); },
      listPlatformSalesOwnerOptions: async () => ({ rows: [] }),
      readPlatformSalesPipeline: async () => ({}),
    },
    "@/lib/v3/sales-handoff-source": { readCompletedSalesHandoffs: async () => new Set() },
  });
  return { ...load("src/lib/v3/pipeline-source.ts"), calls };
}
const onePage = () => ({ rows: [{ leadId: id(1) }], hasNext: false, nextCursor: null });

test("доска продаж: одинаковые (сотрудник, фильтр) в одном запросе читают лиды один раз, разные — каждый свой раз", async () => {
  const { readAllCanonicalSalesLeads, PIPELINE_BOARD_NO_FILTERS, calls } = pipelineWith(requestScopedReact(), onePage);
  const same = { ...PIPELINE_BOARD_NO_FILTERS };
  const [first, second, third] = await Promise.all([
    readAllCanonicalSalesLeads(admin),
    readAllCanonicalSalesLeads(admin, same),
    readAllCanonicalSalesLeads(admin, PIPELINE_BOARD_NO_FILTERS),
  ]);
  assert.equal(calls.length, 1, "когорта периода и воронка доски делят одно чтение страниц");
  assert.equal(first, second);
  assert.equal(second, third);
  await readAllCanonicalSalesLeads(admin, { ...PIPELINE_BOARD_NO_FILTERS, assignment: "mine" });
  await readAllCanonicalSalesLeads(admin, { ...PIPELINE_BOARD_NO_FILTERS, assignment: "unassigned" });
  assert.equal(calls.length, 3, "«мои» и «без ответственного» — разные чтения, общего ответа у них нет");
  assert.deepEqual(calls.map((call) => call.assignmentFilter), ["all", "mine", "unassigned"]);
  // Другой сотрудник — другое чтение: чужой ответ ему не отдаётся.
  await readAllCanonicalSalesLeads({ ...admin, membershipId: "m-2" });
  assert.equal(calls.length, 4);
});

test("доска продаж: память держится в запросе, а не между запросами", async () => {
  const request1 = pipelineWith(requestScopedReact(), onePage);
  const request2 = pipelineWith(requestScopedReact(), onePage);
  await request1.readAllCanonicalSalesLeads(admin);
  await request2.readAllCanonicalSalesLeads(admin);
  assert.equal(request1.calls.length + request2.calls.length, 2);
  const src = read("src/lib/v3/pipeline-source.ts");
  assert.match(src, /import \{ cache \} from "react";/u, "память — React `cache`: её сбрасывает сам React между запросами");
  assert.doesNotMatch(src, /new Map\(\)\s*;\s*\n\s*export/u, "никакой общей для процесса памяти");
});

function reportLinksWith(react) {
  const rpcs = [];
  const client = { schema: () => ({ rpc: async (fn, args) => { rpcs.push([fn, args.p_report_key]); return { data: null, error: { code: "42501" } }; } }) };
  const load = loader({ react, "../supabase/server.ts": { createSupabaseServerClient: async () => client } });
  return { ...load("src/lib/v3/report-links-source.ts"), rpcs };
}

test("ссылка финансового отчёта: меню (layout) и страница делят одно чтение за запрос", async () => {
  const accountant = { ...base, systemRole: "staff", permissionKeys: ["finance.read.full"] };
  const { readReportLink, readFinanceSectionAccess, rpcs } = reportLinksWith(requestScopedReact());
  await Promise.all([readFinanceSectionAccess(accountant), readReportLink(accountant, "finance"), readReportLink(accountant, "finance")]);
  assert.deepEqual(rpcs, [["organization_report_link_v1", "finance"]]);
  await readReportLink(admin, "finance");
  await readReportLink(admin, "marketing");
  assert.equal(rpcs.length, 3, "другой сотрудник и другой отчёт читаются отдельно");
});

/* ------------------------------------------------------------------ «Финансы»: независимое читается вместе */

test("`/finance`: ссылка отчёта и очередь чеков стартуют вместе, а не друг за другом", async () => {
  const link = deferred();
  const receipts = deferred();
  const started = [];
  const SalesTabView = () => null;
  const load = loader({
    "@/lib/platform-guards": { requireV3PageActor: async () => admin },
    "@/lib/v3/report-links-source": { readReportLink: () => { started.push("link"); return link.promise; } },
    "@/lib/v3/student-receipts-source": { readStudentReceiptQueue: () => { started.push("receipts"); return receipts.promise; } },
    "@/lib/v3/student-debts-source": { readStudentDebts: async () => ({ status: "denied" }) },
    "@/components/staff/sales-next/SalesTabView": { SalesTabView },
    "@/components/staff/finance-next/FinanceNextLazy": { FinanceNextLazy: () => null },
  });
  const pending = load("src/app/(staff)/finance/page.tsx").default({ searchParams: Promise.resolve({}) });
  await flush();
  assert.deepEqual(started, ["link", "receipts"], "оба чтения начаты, хотя первое ещё не ответило");
  link.resolve({ status: "denied" });
  receipts.resolve({ status: "forbidden" });
  await pending;
});

test("`/finance`: роль без финансовых вкладок не читает ни ссылку, ни чеки", async () => {
  const started = [];
  const salesperson = { ...base, systemRole: "staff", permissionKeys: ["lead.read", "lead.sales.workflow.manage", "sales.register.read"] };
  const SalesTabView = () => null;
  const load = loader({
    "@/lib/platform-guards": { requireV3PageActor: async () => salesperson },
    "@/lib/v3/report-links-source": { readReportLink: async () => { started.push("link"); return { status: "denied" }; } },
    "@/lib/v3/student-receipts-source": { readStudentReceiptQueue: async () => { started.push("receipts"); return null; } },
    "@/lib/v3/student-debts-source": { readStudentDebts: async () => ({ status: "denied" }) },
    "@/components/staff/sales-next/SalesTabView": { SalesTabView },
    "@/components/staff/finance-next/FinanceNextLazy": { FinanceNextLazy: () => null },
  });
  await load("src/app/(staff)/finance/page.tsx").default({ searchParams: Promise.resolve({}) });
  assert.deepEqual(started, []);
});

/* ------------------------------------------------------------------ данные страницы «Сегодня» идут один раз */

test("очередь для клиента без строк: строки только в разделах, поля пустого дня и предупреждения остаются", () => {
  const { todayQueueSummary } = loader({})("src/lib/v3/today-queue.ts");
  const queue = { today: "2026-11-21", bands: bandOf([taskItem(1)]).bands, emptyNote: null, notices: [], applicable: true, complete: true, actionEmpty: false, nearest: null };
  const summary = todayQueueSummary(queue);
  assert.equal("bands" in summary, false);
  assert.deepEqual({ ...summary }, { today: "2026-11-21", emptyNote: null, notices: [], applicable: true, complete: true, actionEmpty: false, nearest: null });
  assert.ok(JSON.stringify(summary).length < JSON.stringify(queue).length);
  assert.match(read("src/app/(staff)/main/page.tsx"), /queue=\{todayQueueSummary\(queue\)\} sections=\{sections\}/u);
});
