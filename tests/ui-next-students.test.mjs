// «Новый вид» (решение владельца 27.10.2026), поток «students»: «Студенты», «EVO Docs» и «Университеты» из набора виджетов.
// Данные — синтетические (tests/e2e/students-next-fixtures.cjs, отдельный node-процесс: те же сценарии, что у прежнего вида и у стенда
// Chromium). Вёрстку, адаптив, фокус, 44 px, панели и доступность на деле меряет tests/e2e/students-next-static-render.cjs; здесь —
// правила, которые не зависят от браузера: чистые модели, СТРАНИЦЫ `/v3/profile` (очередь и EVO Docs), `/v3/universities`, карточка вуза
// и «Управление каталогом» целиком (настоящие файлы, границы сервера подменены) в четырёх режимах переключателя и границы файлов.
// Прежний вид проверяют прежние тесты и сравнение страниц с их прежними файлами (см. отчёт).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import ts from "typescript";

import { searchHref } from "../src/components/v3/list-next/link-filters-model.ts";

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Границы сервера и браузера подменяются по ИМЕНИ ФАЙЛА (а не по тому, как его назвали при импорте); остальное — настоящий код. */
function loader(stubs = {}) {
  const cache = new Map();
  const files = (base) => [`${base}.ts`, `${base}.tsx`, base, `${base}/index.ts`, `${base}/index.tsx`];
  const resolveFile = (base) => files(base).find((file) => existsSync(new URL(`../${file}`, import.meta.url)) && /\.tsx?$/.test(file));
  function load(path) {
    if (path in stubs) return stubs[path];
    if (cache.has(path)) return cache.get(path).exports;
    const code = ts.transpileModule(read(path), { fileName: path, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const compiled = { exports: {} };
    cache.set(path, compiled);
    new Function("require", "module", "exports", code)((id) => {
      if (id in stubs) return stubs[id];
      if (id === "server-only") return {};
      if (id.endsWith(".css")) return new Proxy({}, { get: (_target, key) => (typeof key === "string" && key !== "__esModule" ? key : undefined) });
      if (id.endsWith(".json")) return JSON.parse(read(id.startsWith(".") ? join(dirname(path), id) : join("src", id.slice(2))));
      if (id.endsWith(".png")) return { src: "/logo.png", width: 1843, height: 842 };
      const file = id.startsWith("@/") ? resolveFile(join("src", id.slice(2))) : id.startsWith(".") ? resolveFile(join(dirname(path), id)) : null;
      if (file) return file in stubs ? stubs[file] : load(file);
      if (id.startsWith("@/") || id.startsWith(".")) assert.fail(`${path}: ${id}`);
      return require(id);
    }, compiled, compiled.exports);
    return compiled.exports;
  }
  return load;
}

const link = { __esModule: true, default: ({ href, children, ...props }) => {
  for (const key of ["scroll", "prefetch", "replace", "onNavigate"]) delete props[key];
  return createElement("a", { href, ...props }, children);
} };
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const navigation = { useRouter: () => router, usePathname: () => "/v3/profile", useSearchParams: () => new URLSearchParams(),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, redirect: (href) => { throw new Error(`NEXT_REDIRECT ${href}`); }, unstable_rethrow: (error) => { throw error; } };
const serverActions = new Proxy({}, { get: (_target, name) => (name === "__esModule" ? false : async () => ({ status: "unavailable" })) });
// `next/dynamic` вне сборки Next — версия для pages router (рисует пустоту); сборка подставляет версию для App Router, её и берём.
const browserStubs = { "next/link": link, "next/navigation": navigation, "next/image": { __esModule: true, default: () => null }, "next/dynamic": require("next/dist/shared/lib/app-dynamic") };
const { renderSettled } = require("./e2e/render-settled.cjs");
const { assertFlightProps } = require("./e2e/flight-props.cjs");

const fixtures = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("./e2e/students-next-fixtures.cjs", import.meta.url)), "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");

const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const actorOf = (over = {}) => ({
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002", membershipId: ME, organizationId: ORG,
  displayName: "Администратор (синтетический)", systemRole: "admin", platformAccessVersion: 1, assignments: [], permissionKeys: [], email: "synthetic@example.invalid", presentationRole: null, ...over,
});
const ADMIN = actorOf();
const STAFF = actorOf({ systemRole: "staff", presentationRole: null, assignments: [{ label: "Сотрудник поступления", scope: { kind: "own", key: null, resourceKind: null } }],
  permissionKeys: ["case.read.full", "profile.read.full", "admissions.read", "catalog.read", "task.create", "staff.task.read"] });
const PREVIEW = actorOf({ presentationRole: "admissions" });
const cookiesOf = (value) => ({ cookies: async () => ({ get: (name) => (name === "evo_ui" && value !== undefined ? { name, value } : undefined) }) });

/* ---------------------------------------------------------------- общие правила списков */

test("поиск и фильтры: адрес поиска хранит вид и фильтры, пустое не пишет, страницу и открытую запись сбрасывает", () => {
  assert.equal(searchHref("/v3/profile", "q", "Айд", { view: "active", direction: "CN", curator: null, stage: "" }), "/v3/profile?view=active&direction=CN&q=%D0%90%D0%B9%D0%B4");
  assert.equal(searchHref("/v3/universities", "q", "  ", { country: null, level: null }), "/v3/universities", "пустой поиск и пустые поля — адрес без параметров");
  assert.equal(searchHref("/v3/universities/manage", "q", "Fudan", {}), "/v3/universities/manage?q=Fudan");
});

/* ---------------------------------------------------------------- модели «Студентов» */

const queueFix = fixtures.students.queue.inputs["view=active"];
const load = loader(browserStubs);
const model = load("src/components/v3/students-next/students-next-model.ts");
const docsModel = load("src/components/v3/students-next/docs-next-model.ts");
const view = load("src/components/v3/students/students-queue-view.ts");

test("строки таблицы «Студентов»: те же дела и порядок, что у чтения; сортировка по сроку: с датой, потом без даты, потом без шага", () => {
  const rows = model.studentRows(queueFix.read.page.rows);
  assert.deepEqual(rows.map((row) => row.id), queueFix.read.page.rows.map((row) => row.studentCaseId), "порядок чтения 241 не меняется");
  assert.equal(rows.length, 20);
  const byDue = [...rows].sort((a, b) => a.dueSort - b.dueSort);
  const rank = (row) => (row.row.nextAction === null ? 2 : row.row.nextActionDueOn === null ? 1 : 0);
  assert.deepEqual(byDue.map(rank), [...byDue.map(rank)].sort(), "ранг срока не нарушается сортировкой");
  assert.equal(rank(byDue.at(-1)), 2, "без шага — в конце");
  assert.ok(rows.every((row) => row.meta.length > 0 && row.name.length > 0));
  assert.equal(rows.find((row) => row.row.targetCountry === "Южная Корея").meta, "Южная Корея", "направления нет — страна из дела");
  assert.equal(rows.find((row) => row.name === "Айдана Сыдыкова").meta, "Китай · Бакалавриат");
});

test("плитки сроков: числа только из чтения чисел и только там, где ведётся шаг; пустые группы не рисуются; красное — просроченное", () => {
  const params = view.parseStudentsQueueParams({ view: "active" }, "queue", { admin: true, coverage: true }).params;
  const tiles = model.studentTiles(params, queueFix.read.counts);
  assert.deepEqual(tiles.map((tile) => tile.key), ["overdue", "today", "this_week", "no_step"]);
  assert.equal(tiles[0].tone, "danger");
  assert.equal(tiles[0].value, queueFix.read.counts.bands.overdue);
  assert.deepEqual(model.studentTiles(params, null), [], "нет чтения чисел — нет плиток (не нули)");
  const updated = view.parseStudentsQueueParams({ view: "active", sort: "updated" }, "queue", { admin: true, coverage: true }).params;
  assert.deepEqual(model.studentTiles(updated, queueFix.read.counts), [], "по обновлению групп по сроку нет");
  const closed = view.parseStudentsQueueParams({ view: "closed" }, "queue", { admin: true, coverage: true }).params;
  assert.deepEqual(model.studentTiles(closed, queueFix.read.counts), [], "у закрытых шаг не ведётся");
});

test("меню фильтров: «Направление», «Куратор», «Этап», «Сортировка» с теми же адресами и числами, что у прежней строки инструментов; в EVO Docs без этапа и сортировки", () => {
  const params = view.parseStudentsQueueParams({ view: "active", direction: "CN" }, "queue", { admin: true, coverage: true }).params;
  const bar = model.studentsFilterBar(params, queueFix.read.counts, queueFix.curatorNames, true);
  assert.deepEqual(bar.menus.map((menu) => menu.key), ["direction", "curator", "stage", "sort"]);
  const direction = bar.menus[0];
  assert.equal(direction.valueLabel, "Китай");
  assert.equal(direction.options[0].href, "/v3/profile?view=active", "«Все направления» снимает фильтр и остаётся в виде");
  assert.equal(direction.options.find((option) => option.key === "MY").href, "/v3/profile?view=active&direction=MY");
  assert.ok(direction.options.slice(1).every((option) => typeof option.count === "number"), "числа — из чтения чисел");
  assert.equal(bar.resetHref, "/v3/profile?view=active", "«Сбросить» убирает фильтры, вид остаётся");
  assert.equal(bar.menus[3].options.find((option) => option.key === "updated").href, "/v3/profile?view=active&direction=CN&sort=updated");
  const noCounts = model.studentsFilterBar(params, null, [], false);
  assert.deepEqual(noCounts.menus.map((menu) => menu.key), ["direction", "stage", "sort"], "«Куратор» — только с правом назначать");
  assert.ok(noCounts.menus[0].options.every((option) => option.count === null || option.count === undefined), "нет чтения чисел — нет чисел");
  const docs = view.parseStudentsQueueParams({ section: "docs", view: "review" }, "docs", { admin: true, coverage: true }).params;
  assert.deepEqual(model.studentsFilterBar(docs, queueFix.read.counts, queueFix.curatorNames, true).menus.map((menu) => menu.key), ["direction", "curator"]);
  assert.deepEqual(model.studentsSearchHidden(docs), { section: "docs", view: "review", direction: null, curator: null, stage: null, sort: null });
  assert.deepEqual(model.studentsSearchHidden(params), { section: null, view: "active", direction: "CN", curator: null, stage: null, sort: null });
});

test("EVO Docs: первая непустая вкладка открывается сама, пустая называет следующую, неполное чтение — без чисел и порядка «сначала дольше всех»", () => {
  const base = fixtures.students.docs.review.inputs["section=docs"];
  const auto = docsModel.docsPlan(base);
  assert.equal(auto.view, "review", "без `view` в адресе — первая вкладка с известным числом больше нуля");
  assert.deepEqual(auto.tabs.map((tab) => tab.key), ["review", "program", "packages", "fix", "missing", "all"]);
  assert.deepEqual(auto.tabs.map((tab) => tab.count), [16, 3, 2, 4, 18, 20]);
  const rows = base.read.page.rows.map((row) => (row.documents ? { ...row, documents: { ...row.documents, missing: row.documents.missing + row.documents.submitted, submitted: 0 } } : row));
  const noReview = docsModel.docsPlan({ ...base, read: { ...base.read, page: { ...base.read.page, rows } } });
  assert.equal(noReview.view, "program", "проверять нечего — открывается следующая непустая вкладка (очередь программ: 3)");
  assert.equal(noReview.params.autoView, false);
  const empty = docsModel.docsPlan({ ...base, params: { ...base.params, view: "review", autoView: false }, read: { ...base.read, page: { ...base.read.page, rows } } });
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.emptyTitle, "Проверять нечего.");
  assert.deepEqual([empty.emptyNext.view, empty.emptyNext.count], ["program", 3], "пустая вкладка называет следующую непустую с её числом");
  const review = docsModel.docsPlan(fixtures.students.docs.incomplete.inputs["section=docs&view=review"]);
  assert.equal(review.view, "review");
  assert.equal(review.complete, false);
  assert.equal(review.order, "partial", "прочитано не всё — порядок сервера, а не «по ожиданию»");
  assert.ok(review.tabs.find((tab) => tab.key === "review").count === null, "число вкладки дел неполного чтения неизвестно");
  const full = docsModel.docsPlan(fixtures.students.docs.fix.inputs["section=docs&view=fix"]);
  assert.equal(full.view, "fix");
  assert.ok(full.rows.every((row) => row.documents.correctionRequired + row.documents.rejected > 0), "вкладка «Исправить» отбирает по чек-листу");
  const none = docsModel.docsPlan(fixtures.students.docs.noAccess.inputs["section=docs"]);
  assert.match(none.emptyTitle, /Нет доступа к документам дел/u);
  assert.equal(docsModel.docsEmptyTitle("review", false, true, true), "Проверять нечего.");
  assert.equal(docsModel.docsEmptyTitle("all", true, true, true), "Ничего не найдено");
  assert.equal(docsModel.docsEmptyTitle("missing", false, false, true), "В прочитанной части списка ничего не найдено");
});

/* ---------------------------------------------------------------- страница «Студентов» и EVO Docs: переключатель */

/** Страница `/v3/profile` с чтениями из сценария (`input`); границы сервера подменены, `isNextUi` и права — настоящие. */
const profilePage = (cookie, who, params, input, overrides = {}) => {
  const seen = { guards: [], queue: [], tasks: [], coverage: 0 };
  const stubs = {
    ...browserStubs,
    "next/headers": cookiesOf(cookie),
    "src/lib/platform-guards.ts": { requireV3PageActor: async (route) => { seen.guards.push(route); return who; } },
    "src/lib/v3/students-queue-source.ts": {
      readStudentsQueue: async (_actor, params) => { seen.queue.push(params); return input.read; },
      readStudentsOpenTasks: async (_actor, id) => { seen.tasks.push(id); return input.openTasks; },
      readStudentsHandoff: async () => input.handoff ?? null,
      readDocsPackages: async () => input.packages ?? { kind: "hidden" },
      readDocsProgramDocuments: async () => input.program ?? { kind: "hidden" },
    },
    "src/lib/v3/students-coverage-source.ts": { loadStudentsCoverage: async () => { seen.coverage += 1; return input.coverage; } },
    "src/lib/platform-closure.ts": { readCaseClosure: async () => input.closure ?? null, readClosedLeads: async () => ({ rows: [] }) },
    "src/lib/server/student-portal-curator-options.ts": { listStudentPortalActiveCurators: async () => input.curatorNames.map((name) => ({ ...name })) },
    "src/lib/v3/profile-source.ts": {
      parseV3ProfileCaseDirectoryParams: () => ({ active: false }), readProfileTarget: async () => { throw new Error("not used"); }, readV3ProfileCaseDirectory: async () => { throw new Error("not used"); },
    },
    "src/lib/v3/case-agreement-source.ts": { readCaseAgreement: async () => null },
    "src/lib/v3/case-work-source.ts": { readCaseWork: async () => null },
    "src/lib/v3/pipeline-source.ts": { readPipelineOwnerOptions: async () => null, readPipelineStages: () => [] },
    "src/lib/v3/telephony-lead-calls-source.ts": { readLeadCalls: async () => null },
    "src/lib/v3/telephony-dial-source.ts": { readDialOptions: async () => ({ status: "off" }) },
    "src/lib/server/platform-staff-task-repository.ts": { readLeadTaskLinks: async () => ({ rows: [] }) },
    "src/lib/server/student-portal-command-ids.ts": { studentPortalProvisioningRequestId: () => "00000000-0000-4000-8000-000000000000" },
    "src/components/v3/profile/next/CaseHelpCardWorkspace.tsx": { CaseHelpCardWorkspace: () => null },
    "src/components/v3/profile/CaseHelpWorkspace.tsx": { CaseHelpWorkspace: () => null },
    "src/components/v3/profile/LeadChannelFact.tsx": { LeadChannelFact: () => null },
    "src/components/v3/profile/LeadInterestFact.tsx": { LeadInterestFact: () => null },
    "src/components/v3/profile/WebsiteLeadSubmissions.tsx": { WebsiteLeadSubmissions: () => null },
    "src/components/v3/profile/ParentPhoneLookalikes.tsx": { ParentPhoneLookalikes: () => null },
    ...overrides,
  };
  const loadPage = loader(stubs);
  const element = () => loadPage("src/app/(v3)/v3/profile/page.tsx").default({ searchParams: Promise.resolve(params) });
  // Новый вид страница подгружает лениво (`StudentsNextLazy`): рисуем, пока разметка не устоится.
  const run = async () => renderSettled(await element());
  return { run, seen, element };
};
const sceneOf = (group, key) => { const entry = group[key]; return { search: entry.search, input: entry.inputs[entry.search] }; };
const paramsOf = (search) => Object.fromEntries(new URLSearchParams(search));
const NEXT_MARKS = /data-testid="v3-students-next"|data-slot="data-table"/u;

test("страница «Студенты»: «Новый вид» только настоящему администратору с переключателем; всем остальным — прежняя очередь и прежняя разметка", async () => {
  const { search, input } = sceneOf(fixtures.students, "queue");
  const on = await profilePage("next", ADMIN, paramsOf(search), input).run();
  assert.match(on, /data-testid="v3-students-next"/);
  assert.match(on, /data-slot="data-table"/);
  assert.match(on, /<h1 [^>]*>Студенты/u);
  assert.equal([...on.matchAll(/<h1 /gu)].length, 1);
  assert.doesNotMatch(on, /data-testid="v3-student-case-table"|v3-queue-row/u, "прежней таблицы нет");
  assert.match(on, /Айдана Сыдыкова/u, "строки очереди — те же дела");
  // Свойства, которые страница отдаёт ленивому входу, проходят границу сервер → клиент: данные, не функции и не объекты классов.
  assertFlightProps((await profilePage("next", ADMIN, paramsOf(search), input).element()).props, "StudentsNextLazy");

  const off = await profilePage(undefined, ADMIN, paramsOf(search), input).run();
  assert.match(off, /data-testid="v3-student-case-table"/, "переключатель выключен — прежний вид");
  assert.doesNotMatch(off, NEXT_MARKS);
  assert.match(off, /<h1 class="t-page-title[^>]*>Студенты/u);

  const STAFF_SEARCH = "";
  for (const [label, who] of [["сотрудник", STAFF], ["администратор в просмотре роли", PREVIEW]]) {
    for (const cookie of ["next", undefined]) {
      const html = await profilePage(cookie, who, paramsOf(STAFF_SEARCH), sceneOf(fixtures.students, "mine").input).run();
      assert.match(html, /data-testid="v3-student-case-(table|directory)"/u, `${label}, cookie=${cookie}: прежний вид`);
      assert.doesNotMatch(html, NEXT_MARKS, `${label}, cookie=${cookie}: нового вида нет`);
    }
  }
});

test("страница «Студенты»: чтения те же в обоих видах (маршрут, параметры очереди, задачи открытого дела), а состояния — отказ, ошибка, адрес — называются в новом виде", async () => {
  const { search } = sceneOf(fixtures.students, "queue");
  const withTasks = `${search}&open=cccccccc-2222-4222-8222-000000000001`;
  const openInput = fixtures.students.queue.inputs[withTasks];
  const seenBy = {};
  for (const cookie of ["next", undefined]) {
    const run = profilePage(cookie, ADMIN, paramsOf(withTasks), openInput);
    await run.run();
    seenBy[cookie ?? "off"] = run.seen;
    assert.deepEqual(run.seen.guards, ["/v3/profile"], `cookie=${cookie}: тот же маршрут`);
    assert.equal(run.seen.queue.length, 1, `cookie=${cookie}: одно чтение очереди`);
    assert.deepEqual(run.seen.tasks, ["cccccccc-2222-4222-8222-000000000001"], `cookie=${cookie}: задачи открытого дела читаются`);
  }
  assert.deepEqual(seenBy.next.queue, seenBy.off.queue, "параметры очереди одни и те же");
  assert.ok(seenBy.next.queue[0].open === "cccccccc-2222-4222-8222-000000000001" && seenBy.next.queue[0].view === "active");
  const states = [
    ["forbidden", /Список студентов для вашей учётной записи недоступен\./u, /Обратитесь к администратору: повторная попытка не поможет\./u],
    ["page-error", /Не удалось загрузить список студентов\./u, /Повторить/u],
    ["invalid", /Не удалось применить фильтры\./u, /Сбросить фильтры/u],
    ["empty-mine", /Дел, требующих действия, нет/u, /Все в работе · 20/u],
  ];
  for (const [name, title, more] of states) {
    const scene = sceneOf({ s: fixtures.students.states[name] }, "s");
    // Адрес, который разбирает сама страница: «invalid» — несуществующее направление.
    const params = name === "invalid" ? { view: "active", direction: "ZZ" } : paramsOf(scene.search);
    const html = text(await profilePage("next", ADMIN, params, scene.input).run());
    assert.match(html, title, `${name}: что случилось — на виду`);
    assert.match(html, more, `${name}: что делать`);
    const legacy = text(await profilePage(undefined, ADMIN, params, scene.input).run());
    assert.doesNotMatch(legacy, /v3-students-next/u);
  }
  const noCounts = sceneOf({ s: fixtures.students.states["counts-unavailable"] }, "s");
  assert.match(text(await profilePage("next", ADMIN, paramsOf(noCounts.search), noCounts.input).run()), /Счётчики недоступны, список работает\. Повторить/u, "числа не выдуманы: «недоступны» названо");
});

test("страница EVO Docs: те же вкладки и очереди в новом виде; прежний вид — без изменений; нагрузка кураторов читается теми же чтениями", async () => {
  const docs = sceneOf(fixtures.students.docs, "review");
  const on = await profilePage("next", ADMIN, paramsOf(docs.search), docs.input).run();
  assert.match(on, /<h1 [^>]*>EVO Docs/u);
  assert.match(on, /data-testid="v3-students-next"/u);
  assert.match(on, /<a [^>]*href="\/v3\/universities"[^>]*>Университеты и бланки/u, "право на каталог — кнопка в шапке");
  assertFlightProps((await profilePage("next", ADMIN, paramsOf(docs.search), docs.input).element()).props, "StudentsNextLazy");
  const tabs = on.match(/<nav aria-label="Виды списка студентов"[\s\S]*?<\/nav>/u)[0];
  assert.deepEqual([...tabs.matchAll(/<a [^>]*>([^<]+)<span[^>]*>(\d+)<\/span>/gu)].map((match) => `${match[1].trim()} ${match[2]}`),
    ["Документы дела 16", "Документы программ 3", "Комплекты 2", "Исправить 4", "Не хватает 18", "Все 20"]);
  const off = await profilePage(undefined, ADMIN, paramsOf(docs.search), docs.input).run();
  assert.match(off, /data-testid="v3-student-case-table"/u);
  assert.doesNotMatch(off, NEXT_MARKS);
  for (const view of ["program", "packages"]) {
    const scene = sceneOf(fixtures.students.docs, view);
    const html = await profilePage("next", ADMIN, paramsOf(scene.search), scene.input).run();
    assert.match(html, view === "program" ? /aria-label="Документы программ на проверку"/u : /aria-label="Комплекты на проверку"/u, `${view}: таблица очереди`);
    assert.match(html, /Айдана Сыдыкова|Тимур Абдылдаев/u);
  }
  const curators = sceneOf({ c: fixtures.students.curators }, "c");
  const run = profilePage("next", ADMIN, paramsOf(curators.search), curators.input);
  const html = await run.run();
  assert.equal(run.seen.coverage, 1, "нагрузка кураторов читается один раз, тем же чтением");
  assert.match(html, /aria-label="Нагрузка кураторов"/u);
  assert.match(text(html), /Айгүл Осмонова/u);
});

/* ---------------------------------------------------------------- «Университеты»: список, карточка, управление, рамка вложенных страниц */

const CATALOGUE = ["malaysia", "china", "turkey"]
  .flatMap((name) => JSON.parse(read(`src/lib/server/university-catalog-reviewed-${name}.json`)))
  .map((entry, index) => ({ id: `57ce9b97-43fb-4563-9c61-${String(index + 1).padStart(12, "0")}`, version: 1, publishedAt: "2026-09-10T00:00:00+00:00", content: entry.content, key: entry.key }));
const published = CATALOGUE.map(({ id, version, publishedAt, content }) => ({ id, version, publishedAt, content }));
const MANAGER = actorOf({ systemRole: "staff", assignments: [{ label: "Сотрудник поступления", scope: { kind: "own", key: null, resourceKind: null } }], permissionKeys: ["catalog.read", "catalog.import.manage", "case.read.full", "admissions.read"] });
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://iosckaqtovbbnssqcpde.supabase.co";

const universityStubs = (cookie, who, overrides = {}) => ({
  ...browserStubs,
  "next/headers": cookiesOf(cookie),
  "src/lib/platform-guards.ts": { requireV3PageActor: async () => who },
  "src/lib/v3/university-source.ts": {
    readStaffUniversityCatalogue: async () => ({ kind: "complete", items: published }),
    readStaffUniversityCountries: async () => ({ countries: [...new Set(published.map((item) => item.content.country))].sort() }),
    readStaffUniversities: async (_actor, _filters, id) => ({ items: published.filter((item) => item.id === id), nextOffset: null }),
    readUniversityDrafts: async () => [], readUniversityBatchSnapshot: async () => [], reviewedUniversityTemplates: () => CATALOGUE.slice(0, 6).map(({ key, content }) => ({ key, content })),
    readUniversityManageDraftPage: async () => ({ items: [{ id: "dddddddd-7777-4777-8777-000000000001", baseVersion: 2, content: published[0].content }], nextCursor: null }),
  },
  "src/lib/v3/catalog-geography-source.ts": {
    canManageCatalogGeography: (actor) => actor.systemRole === "admin" && actor.presentationRole === null, canConfirmAgencyCosts: () => true,
    readStaffCatalogGeography: async () => ({ cities: [], countries: [], rates: [] }), geographyPhotoBase: () => null,
  },
  "src/components/v3/universities/geography/UniversityGeographyPanel.tsx": { UniversityGeographyPanel: () => createElement("section", { "data-testid": "geography-panel" }, "Город и стоимость") },
  "src/components/v3/universities/geography/FxRates.tsx": { FxRates: () => createElement("section", { "data-testid": "fx-rates" }, "Курсы") },
  "src/lib/server/university-catalog-batch.ts": { universityBatchRows: () => [] },
  "src/lib/platform-university-form-actions.ts": serverActions, "src/lib/platform-university-form-management-actions.ts": serverActions,
  "src/lib/platform-university-catalog-actions.ts": serverActions, "src/lib/platform-catalog-geography-actions.ts": serverActions,
  ...overrides,
});
const universityPage = (path, cookie, who, params = {}, extra = {}) => {
  const load = loader(universityStubs(cookie, who, extra));
  const element = () => load(`src/app/(v3)/v3/universities/${path}`).default({ searchParams: Promise.resolve(params), params: Promise.resolve({ id: params.__id }) });
  return { element, run: async () => renderSettled(await element()) };
};
const MODES = [["администратор с переключателем", "next", ADMIN, true], ["администратор без переключателя", undefined, ADMIN, false],
  ["сотрудник с cookie", "next", MANAGER, false], ["администратор в просмотре роли с cookie", "next", PREVIEW, false]];

test("«Университеты»: каталог в новом виде — только настоящему администратору с переключателем; во всех остальных режимах прежняя таблица", async () => {
  for (const [label, cookie, who, isNext] of MODES) {
    const run = universityPage("page.tsx", cookie, who);
    const html = await run.run();
    assert.equal(/data-testid="v3-universities-next"/u.test(html), isNext, `${label}: новый вид ${isNext ? "есть" : "нет"}`);
    assert.equal(/data-testid="v3-university-table"/u.test(html), !isNext, `${label}: прежняя таблица ${isNext ? "нет" : "есть"}`);
    assert.equal(/data-slot="data-table"/u.test(html), isNext);
    if (isNext) {
      assertFlightProps((await run.element()).props, "UniversitiesListNextLazy");
      assert.match(html, /<a [^>]*href="\/v3\/universities\/57ce9b97-43fb-4563-9c61-\d{12}"[^>]*>/u, "название — ссылка на карточку");
      assert.match(html, /aria-label="Поиск университетов"/u);
      assert.match(html, /<a [^>]*href="\/v3\/universities\/manage"[^>]*>[\s\S]*Управлять каталогом/u, "управление каталогом — тому, у кого есть право");
      const ids = new Set([...html.matchAll(/data-university-row="([^"]+)"/gu)].map((match) => match[1]));
      assert.ok(ids.size > 0 && ids.size <= 30, "не больше страницы сервера");
    }
  }
  const filtered = text(await universityPage("page.tsx", "next", ADMIN, { country: "MY", level: "bachelor" }).run());
  assert.match(filtered, /Страна: Малайзия/u);
  assert.match(filtered, /Уровень: Бакалавриат/u);
  assert.match(filtered, /Сбросить/u);
  const failing = universityStubs("next", ADMIN, { "src/lib/v3/university-source.ts": { readStaffUniversityCatalogue: async () => { throw new Error("db"); }, readStaffUniversityCountries: async () => ({ countries: [] }) } });
  const broken = text(await renderSettled(await loader(failing)("src/app/(v3)/v3/universities/page.tsx").default({ searchParams: Promise.resolve({}) })));
  assert.match(broken, /Не удалось загрузить каталог\. Обновите страницу\. Это не означает, что опубликованных университетов нет\./u, "ошибка чтения — на виду и в новом виде");
});

test("«Университеты»: карточка вуза — программы и наборы, сроки посчитаны сервером; права на управление и панель города — те же", async () => {
  const id = CATALOGUE.find((item) => item.key === "utm").id;
  for (const [label, cookie, who, isNext] of MODES) {
    const run = universityPage("[id]/page.tsx", cookie, who, { __id: id });
    const html = await run.run();
    assert.equal(/data-testid="v3-university-next"/u.test(html), isNext, label);
    assert.equal(/<article[^>]*data-program/u.test(html), !isNext, `${label}: прежние программы — article`);
    if (isNext) {
      assertFlightProps((await run.element()).props, "UniversityDetailNextLazy");
      assert.equal([...html.matchAll(/<h1 /gu)].length, 1);
      assert.match(html, /<section[^>]*data-program=/u, "программа — раздел со своей таблицей наборов");
      assert.match(html, /aria-label="Наборы: /u);
      assert.match(html, /data-testid="geography-panel"/u, "панель города и стоимости — прежняя, под карточкой");
      assert.match(html, /Бланки университета/u);
      assert.doesNotMatch(html, /<a [^>]*target="_blank"(?![^>]*rel="noopener noreferrer")/u, "внешние ссылки — в новой вкладке и безопасно");
    }
  }
  const staff = text(await universityPage("[id]/page.tsx", "next", STAFF, { __id: id }).run());
  assert.doesNotMatch(staff, /Предложить обновление|Бланки университета/u, "без права управлять — без кнопок управления");
  await assert.rejects(universityPage("[id]/page.tsx", "next", ADMIN, { __id: "not-a-uuid" }).run(), /NEXT_NOT_FOUND/u);
});

test("«Управление каталогом» и вложенные страницы: индекс и рамка — в новом виде; редакторы и формы внутри прежние", async () => {
  for (const [label, cookie, who, isNext] of MODES.slice(0, 2)) {
    const html = await universityPage("manage/page.tsx", cookie, who).run();
    assert.equal(/data-testid="manage-template-groups"/u.test(html), true, label);
    assert.equal(/data-testid="v3-universities-next"/u.test(html), isNext, label);
    assert.equal(/id="manage-pending-heading"/u.test(html), !isNext, `${label}: прежний индекс — секции с заголовком`);
    if (isNext) assert.match(html, /На проверке[\s\S]*Проверить[\s\S]*Подготовленные сведения из открытых источников/u);
  }
  const draft = await universityPage("manage/page.tsx", "next", ADMIN, { draft: "dddddddd-7777-4777-8777-000000000001" }, {
    "src/lib/v3/university-source.ts": { ...universityStubs("next", ADMIN)["src/lib/v3/university-source.ts"],
      readUniversityDrafts: async () => [{ id: "dddddddd-7777-4777-8777-000000000001", content: published[0].content, baseVersion: 2, reviewKind: "content", reason: "Проверка" }] },
  }).run();
  assert.match(draft, /data-testid="v3-universities-next"/u, "проверка черновика — в рамке нового вида");
  assert.match(draft, /Проверка: /u);
  const rates = await universityPage("rates/page.tsx", "next", ADMIN).run();
  assert.match(rates, /data-testid="v3-universities-next"[\s\S]*data-testid="fx-rates"/u, "курсы валют — прежняя форма в новой рамке");
  assert.doesNotMatch(await universityPage("rates/page.tsx", undefined, ADMIN).run(), /v3-universities-next/u);
  // Права страницы управления не зависят от переключателя: сотрудник с правом и cookie видит прежний индекс, просмотр роли отказан.
  const manager = await universityPage("manage/page.tsx", "next", MANAGER).run();
  assert.match(manager, /id="manage-pending-heading"/u);
  assert.doesNotMatch(manager, /v3-universities-next/u);
  await assert.rejects(universityPage("manage/page.tsx", "next", PREVIEW).run(), /NEXT_REDIRECT \/access-denied/u);
  await assert.rejects(universityPage("manage/page.tsx", "next", STAFF).run(), /NEXT_REDIRECT \/access-denied/u);
});

/* ---------------------------------------------------------------- границы файлов */

const NEXT_DIRS = ["src/components/v3/students-next", "src/components/v3/universities-next", "src/components/v3/list-next"];
const nextFiles = () => NEXT_DIRS.flatMap((dir) => readdirSync(new URL(`../${dir}`, import.meta.url)).map((name) => `${dir}/${name}`));

test("файлы нового вида: каждый до 150 строк, без собственных серверных действий, тёмной темы и импорта действий; набор виджетов — не больше 150", () => {
  const files = nextFiles();
  assert.ok(files.length >= 40, `файлов: ${files.length}`);
  for (const file of files) {
    const source = read(file);
    assert.ok(source.split("\n").length <= 150, `${file}: ${source.split("\n").length} строк`);
    assert.doesNotMatch(source, /["']use server["']/u, `${file}: серверных действий нет`);
    assert.doesNotMatch(source, /\bdark:/u, `${file}: тёмной темы нет`);
    assert.doesNotMatch(source, /from "@\/lib\/[^"]*actions"/u, `${file}: команд страниц сам не зовёт — только прежние части`);
  }
  for (const file of ["src/components/kit/DataTable.tsx", "src/components/kit/DataTableToolbar.tsx"]) assert.ok(read(file).split("\n").length <= 150, file);
  for (const file of ["tests/e2e/students-next-static-render.cjs", "tests/e2e/students-next-fixtures.cjs"]) assert.ok(existsSync(new URL(`../${file}`, import.meta.url)));
});

test("первая загрузка: страницы не импортируют новый вид статически, входы — ленивые `next/dynamic` с `onScreenLoadFailed`", () => {
  const profile = read("src/app/(v3)/v3/profile/page.tsx");
  assert.match(profile, /import \{ StudentsNextLazy \} from "@\/components\/v3\/students-next\/StudentsNextLazy";/u);
  assert.match(profile, /if \(nextUi && queueInput\) return <StudentsNextLazy input=\{queueInput\} manageUniversities=\{manageUniversities\} \/>;/u);
  assert.match(profile, /const queuePage = queueInput \? buildStudentsQueueScreen\(queueInput\) : null;/u, "прежний вид строит экран из тех же данных");
  const lazy = read("src/components/v3/students-next/StudentsNextLazy.tsx");
  assert.match(lazy, /^"use client";/u);
  assert.match(lazy, /dynamic\(\(\) => import\("\.\/StudentsNextPage"\)\.then\(\(module\) => module\.StudentsNextPage\)\.catch\(onScreenLoadFailed\)\)/u);
  const lazies = read("src/components/v3/universities-next/UniversitiesNextLazy.tsx");
  assert.match(lazies, /^"use client";/u);
  assert.equal([...lazies.matchAll(/\.catch\(onScreenLoadFailed\)/gu)].length, 4, "четыре входа: список, карточка, рамка, индекс управления");
  for (const page of ["page.tsx", "[id]/page.tsx", "manage/page.tsx", "rates/page.tsx", "cities/page.tsx", "[id]/forms/page.tsx"]) {
    const source = read(`src/app/(v3)/v3/universities/${page}`);
    assert.doesNotMatch(source, /from "@\/components\/kit/u, `${page}: набор виджетов статически не подключается`);
    assert.doesNotMatch(source, /from "@\/components\/v3\/universities-next\/(UniversitiesListNext|UniversityDetailNext|UniversityFrame|ManageIndexNext)"/u, `${page}: вход — только ленивый`);
    assert.match(source, /isNextUi/u, `${page}: выбор вида — по isNextUi`);
  }
  const shell = read("src/components/v3/universities-next/UniversityShell.tsx");
  assert.match(shell, /if \(!nextUi\) return <PartShell \{\.\.\.props\} \/>;/u, "без переключателя — прежняя рамка с теми же свойствами");
  assert.doesNotMatch(read("src/components/v3/students-next/StudentsNextLazy.tsx") + shell, /@\/components\/kit"/u);
});

test("отказ ленивого куска: у обоих маршрутов есть `loading.tsx` (граница Suspense), как у экранов первой волны", () => {
  assert.ok(existsSync(new URL("../src/app/(v3)/v3/profile/loading.tsx", import.meta.url)));
  assert.ok(existsSync(new URL("../src/app/(v3)/v3/universities/loading.tsx", import.meta.url)));
  for (const file of ["StudentsNextLazy", "UniversitiesNextLazy"]) {
    const source = read(`src/components/v3/${file.startsWith("Students") ? "students-next" : "universities-next"}/${file}.tsx`);
    assert.match(source, /import \{ onScreenLoadFailed \} from "@\/components\/kit\/LoadFailed";/u, `${file}: отказ загрузки куска — «Обновить страницу», а не молчаливая пустота`);
  }
});

test("«?» и текст: пояснения за «?», предупреждения о чтении и рисках остаются на виду; новый текст не повторяет прежние абзацы", () => {
  const page = read("src/components/v3/students-next/StudentsNextPage.tsx");
  assert.match(page, /help=\{docs \? HELP_DOCS : HELP_QUEUE\}/u, "пояснение страницы — в «?» шапки");
  assert.match(page, /Обратитесь к администратору: повторная попытка не поможет\./u);
  assert.match(page, /Не удалось применить фильтры\./u);
  assert.match(read("src/components/v3/students-next/StudentsQueueNext.tsx"), /Счётчики недоступны, список работает\./u);
  assert.match(read("src/components/v3/students-next/DocsQueues.tsx"), /Не удалось загрузить документы программ на проверку\./u);
  assert.match(read("src/components/v3/students-next/DocsQueues.tsx"), /Очередь комплектов вашей учётной записи недоступна/u);
  assert.match(read("src/components/v3/students-next/CuratorsNext.tsx"), /Нагрузка сейчас недоступна\. Это не означает, что дел или задач нет\./u);
  assert.match(read("src/components/v3/universities-next/ManageIndexNext.tsx"), /Не удалось загрузить черновики\./u);
  assert.match(read("src/components/v3/universities-next/ManageIndexNext.tsx"), /help="Исходные материалы для проверки, не опубликованные записи;/u, "пояснение о подготовленных сведениях — за «?»");
  assert.match(read("src/components/v3/universities-next/UniversitiesListNext.tsx"), /Каталог длиннее предела полного чтения: порядок — по названию/u);
});
