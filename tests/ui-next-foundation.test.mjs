// «Новый вид» (решение владельца 27.10.2026), фундамент F: правило переключателя, cookie, layout, права страницы
// набора виджетов, виджеты набора и граница «новый вид только администратору». Данные — синтетические. Живые
// снимки, фокус и доступность виджетов меряет tests/e2e/ui-kit-static-render.cjs; разметку прежней оболочки —
// tests/v3-shell.test.mjs (оболочка без переключателя байт в байт та же, что до этого изменения).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { FIXED_ROLE_ROUTES, fixedRoleCanAccessRoute } from "../src/lib/fixed-role-policy.ts";
import { staffCanAccessRoute } from "../src/lib/platform-access.ts";
import { isConnectedPlatformPage } from "../src/lib/platform-route-contract.ts";
import { v3SectionTitle } from "../src/lib/v3/navigation.ts";
import {
  canUseNextUi, isNextUiFor, nextUiReturnPath, NEXT_UI_COOKIE, NEXT_UI_COOKIE_MAX_AGE_SECONDS, NEXT_UI_COOKIE_VALUE,
} from "../src/lib/ui-next-contract.ts";

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Мини-загрузчик TS/TSX: границы сервера подменяются явно, остальное — настоящий код. */
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
      if (id.endsWith(".css")) return {};
      if (id.startsWith("@/")) return load(resolveFile(join("src", id.slice(2))) ?? assert.fail(id));
      if (id.startsWith(".")) return load(resolveFile(join(dirname(path), id)) ?? assert.fail(`${path}: ${id}`));
      return require(id);
    }, compiled, compiled.exports);
    return compiled.exports;
  }
  return load;
}

const ORG = "10000000-0000-4000-8000-000000000001";
const actor = (over = {}) => ({ organizationId: ORG, systemRole: "admin", presentationRole: null, permissionKeys: [], platformAccessVersion: 1, assignments: [], displayName: "Админ Синтетический", ...over });
const ADMIN = actor();
const STAFF = actor({ systemRole: "staff", permissionKeys: ["lead.read"] });
const PREVIEW = actor({ presentationRole: "sales" });

/* ---------------------------------------------------------------- правило переключателя */

test("«Новый вид» видит только настоящий администратор вне просмотра роли, и только с cookie evo_ui=next", () => {
  assert.equal(NEXT_UI_COOKIE, "evo_ui");
  assert.equal(NEXT_UI_COOKIE_VALUE, "next");
  assert.equal(canUseNextUi(ADMIN), true);
  assert.equal(canUseNextUi(PREVIEW), false, "просмотр роли — не настоящий администратор");
  assert.equal(canUseNextUi(STAFF), false);
  assert.equal(isNextUiFor(ADMIN, "next"), true);
  for (const value of [undefined, null, "", "on", "NEXT", "next ", "1", "legacy"]) assert.equal(isNextUiFor(ADMIN, value), false, String(value));
  for (const cookie of ["next", undefined]) {
    assert.equal(isNextUiFor(PREVIEW, cookie), false, `preview ${cookie}`);
    assert.equal(isNextUiFor(STAFF, cookie), false, `staff ${cookie}`);
  }
  for (const presentationRole of ["sales", "admissions"]) assert.equal(isNextUiFor(actor({ presentationRole }), "next"), false, presentationRole);
  assert.ok(NEXT_UI_COOKIE_MAX_AGE_SECONDS > 0 && NEXT_UI_COOKIE_MAX_AGE_SECONDS <= 60 * 60 * 24 * 365);
});

test("адрес возврата после переключения — только внутри /v3, иначе «Сегодня»", () => {
  for (const ok of ["/v3/main", "/v3/tasks?view=mine&page=2", "/v3/profile?id=20000000-0000-4000-8000-000000000001", "/v3", "/v3/ui-kit?tab=history"]) assert.equal(nextUiReturnPath(ok), ok);
  for (const bad of ["https://evil.example/v3/main", "//evil.example", "/v3//evil", "/v3/../login", "/login", "v3/main", "/v3/main\nSet-Cookie: x=1", "javascript:alert(1)", "", null, undefined, 5, "/v3/" + "a".repeat(700)]) assert.equal(nextUiReturnPath(bad), "/v3/main", String(bad).slice(0, 30));
});

test("isNextUi читает cookie запроса и повторяет правило (настоящая функция, граница next/headers подменена)", async () => {
  const run = (cookie) => loader({ "next/headers": { cookies: async () => ({ get: (name) => (name === NEXT_UI_COOKIE && cookie !== undefined ? { name, value: cookie } : undefined) }) } })("src/lib/ui-next.ts").isNextUi;
  assert.equal(await run("next")(ADMIN), true);
  assert.equal(await run(undefined)(ADMIN), false);
  assert.equal(await run("other")(ADMIN), false);
  assert.equal(await run("next")(PREVIEW), false, "в просмотре роли cookie не работает");
  assert.equal(await run("next")(STAFF), false, "сотрудник с чужой cookie не получает новый вид");
});

/* ---------------------------------------------------------------- действие переключателя */

function actionHarness(result) {
  const cookiesSet = [];
  const cookiesDeleted = [];
  const store = { set: (...args) => cookiesSet.push(args), delete: (name) => cookiesDeleted.push(name) };
  const redirects = [];
  const actions = loader({
    "next/headers": { cookies: async () => store },
    "next/navigation": { redirect: (destination) => { redirects.push(destination); throw Object.assign(new Error("NEXT_REDIRECT"), { destination }); } },
    "./platform-auth": { resolvePlatformActor: async () => result },
  })("src/lib/ui-next-actions.ts");
  const call = async (...args) => { try { await actions.setNextUiAction(...args); } catch (error) { if (error.message !== "NEXT_REDIRECT") throw error; } };
  return { call, cookiesSet, cookiesDeleted, redirects };
}

test("действие переключателя пишет cookie только настоящему администратору и возвращает на ту же страницу", async () => {
  const on = actionHarness({ status: "authenticated", actor: ADMIN });
  await on.call(true, "/v3/tasks?view=mine");
  assert.equal(on.cookiesSet.length, 1);
  const [name, value, options] = on.cookiesSet[0];
  assert.deepEqual([name, value], ["evo_ui", "next"]);
  assert.deepEqual(options, { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: NEXT_UI_COOKIE_MAX_AGE_SECONDS });
  assert.deepEqual(on.redirects, ["/v3/tasks?view=mine"]);

  const off = actionHarness({ status: "authenticated", actor: ADMIN });
  await off.call(false, "/v3/main");
  assert.deepEqual(off.cookiesDeleted, ["evo_ui"]);
  assert.equal(off.cookiesSet.length, 0);
  assert.deepEqual(off.redirects, ["/v3/main"]);

  const odd = actionHarness({ status: "authenticated", actor: ADMIN });
  await odd.call("true", "https://evil.example/");
  assert.equal(odd.cookiesSet.length, 0, "только настоящее true включает");
  assert.deepEqual(odd.cookiesDeleted, ["evo_ui"]);
  assert.deepEqual(odd.redirects, ["/v3/main"], "внешний адрес возврата заменён");

  for (const [label, result, destination] of [
    ["staff", { status: "authenticated", actor: STAFF }, "/access-denied?from=%2Fv3%2Fui-kit"],
    ["admin preview", { status: "authenticated", actor: PREVIEW }, "/access-denied?from=%2Fv3%2Fui-kit"],
    ["anonymous", { status: "anonymous", actor: null }, "/login"],
    ["invalid session", { status: "invalid", actor: null, reason: "supabase_session_invalid" }, "/login"],
  ]) {
    const denied = actionHarness(result);
    await denied.call(true, "/v3/main");
    assert.equal(denied.cookiesSet.length + denied.cookiesDeleted.length, 0, `${label}: cookie не тронута`);
    assert.deepEqual(denied.redirects, [destination], label);
  }
});

/* ---------------------------------------------------------------- layout: режим и переключатель */

function renderLayout(who, cookie) {
  const seen = { nextUi: "unset" };
  const load = loader({
    "next/headers": { cookies: async () => ({ get: (name) => (name === NEXT_UI_COOKIE && cookie !== undefined ? { name, value: cookie } : undefined) }) },
    "@/lib/platform-guards": { requirePlatformStaffActor: async () => who },
    "@/lib/release-metadata": { readReleaseMetadata: () => ({ status: "unavailable" }) },
    "@/lib/v3/account-deletion-source": { readOpenAccountDeletionCount: async () => null },
    "@/lib/v3/staff-notification-source": { readStaffNotificationsForActor: async () => null },
    "@/components/ServerReleaseMark": { ServerReleaseMark: () => null },
    "@/components/v3/AppShell": { AppShell: (props) => { seen.nextUi = props.nextUi; return createElement("div", { "data-shell": "" }, props.children); } },
  });
  return load("src/app/(v3)/layout.tsx").default({ children: createElement("main", null, "страница") }).then((tree) => ({ html: renderToStaticMarkup(tree), seen }));
}

test("layout ставит data-ui=next и отдаёт переключатель только настоящему администратору; всем остальным разметка прежняя", async () => {
  const legacyRoot = '<div class="v3-world" data-surface="staff"><div data-shell="">';
  const adminOn = await renderLayout(ADMIN, "next");
  assert.match(adminOn.html, /^<div class="v3-world" data-surface="staff" data-ui="next">/);
  assert.deepEqual(adminOn.seen.nextUi, { enabled: true });

  const adminOff = await renderLayout(ADMIN, undefined);
  assert.ok(adminOff.html.startsWith(legacyRoot), "выключено: корень без data-ui");
  assert.deepEqual(adminOff.seen.nextUi, { enabled: false }, "переключатель виден, чтобы включить");

  for (const [label, who] of [["staff", STAFF], ["admin preview", PREVIEW]]) {
    for (const cookie of ["next", undefined]) {
      const rendered = await renderLayout(who, cookie);
      assert.ok(rendered.html.startsWith(legacyRoot), `${label} cookie=${cookie}: корень прежний`);
      assert.equal(rendered.seen.nextUi, null, `${label} cookie=${cookie}: переключателя нет`);
    }
  }
});

test("оболочка рисует строку переключателя только по `nextUi`, а в исходниках нет других путей к нему", () => {
  const shell = read("src/components/v3/AppShell.tsx");
  assert.match(shell, /\{nextUi \? \(/);
  assert.match(shell, /<NextUiToggle enabled=\{nextUi\.enabled\}/);
  assert.match(shell, /nextUi = null,/, "по умолчанию строки нет");
  const toggle = read("src/components/v3/NextUiToggle.tsx");
  assert.match(toggle, /role="switch"/);
  assert.match(toggle, /aria-checked=\{enabled\}/);
  assert.match(toggle, /setNextUiAction\(!enabled, returnTo\)/);
  assert.doesNotMatch(toggle, /@\/components\/ui\/(?:switch|button)/, "строка в оболочке не зависит от токенов нового вида");
  const action = read("src/lib/ui-next-actions.ts");
  assert.match(action, /resolvePlatformActor\(\)/);
  assert.match(action, /canUseNextUi\(result\.actor\)/);
  assert.match(read("src/lib/ui-next.ts"), /isNextUiFor\(actor, \(await cookies\(\)\)\.get\(NEXT_UI_COOKIE\)\?\.value\)/);
});

/* ---------------------------------------------------------------- страница набора виджетов */

test("«/v3/ui-kit» — маршрут политики ролей только для настоящего администратора, как «Финансы»", () => {
  assert.ok(FIXED_ROLE_ROUTES.includes("/v3/ui-kit"));
  assert.equal(fixedRoleCanAccessRoute("admin", "/v3/ui-kit"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/v3/ui-kit"), false);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/v3/ui-kit"), false);
  assert.equal(isConnectedPlatformPage("/v3/ui-kit"), true, "прокси пропускает страницу");
  assert.equal(isConnectedPlatformPage("/v3/ui-kit/extra"), false);
  assert.equal(staffCanAccessRoute(ADMIN, "/v3/ui-kit"), true);
  for (const presentationRole of ["sales", "admissions"]) assert.equal(staffCanAccessRoute({ ...ADMIN, presentationRole }, "/v3/ui-kit"), false, `preview ${presentationRole}`);
  assert.equal(staffCanAccessRoute(STAFF, "/v3/ui-kit"), false);
  assert.equal(staffCanAccessRoute({ ...STAFF, permissionKeys: ["admin.preview", "lead.read", "case.read.full"] }, "/v3/ui-kit"), false, "права не заменяют роль администратора");
  assert.match(read("src/app/(v3)/access-denied/page.tsx"), /"\/v3\/ui-kit": "Набор виджетов"/);
  assert.equal(v3SectionTitle("/v3/ui-kit"), "Набор виджетов", "вкладка браузера называет страницу, пункта меню у неё нет");
});

test("страница набора: гвард маршрута, при выключенном переключателе — строка, при включённом — набор", async () => {
  const guards = [];
  const render = async (cookie, who = ADMIN) => {
    const load = loader({
      "next/headers": { cookies: async () => ({ get: (name) => (name === NEXT_UI_COOKIE && cookie !== undefined ? { name, value: cookie } : undefined) }) },
      "@/lib/platform-guards": { requireV3PageActor: async (route) => { guards.push(route); return who; } },
    });
    const page = load("src/app/(v3)/v3/ui-kit/page.tsx").default;
    return renderToStaticMarkup(await page({ searchParams: Promise.resolve({ tab: "history" }) }));
  };
  const off = await render(undefined);
  assert.match(off, /data-testid="v3-ui-kit-off"/);
  assert.doesNotMatch(off, /data-testid="v3-ui-kit"/);
  const on = await render("next");
  assert.match(on, /data-testid="v3-ui-kit"/);
  assert.match(on, /aria-current="page"[^>]*>История/, "?tab=history выбирает вкладку-ссылку");
  assert.deepEqual(guards, ["/v3/ui-kit", "/v3/ui-kit"]);
  assert.match(read("src/app/(v3)/v3/ui-kit/page.tsx"), /requireV3PageActor\("\/v3\/ui-kit"\)/);
});

/* ---------------------------------------------------------------- виджеты набора */

const kit = () => loader({
  "next/link": { __esModule: true, default: ({ href, children, ...props }) => {
    for (const key of ["prefetch", "scroll", "replace", "onNavigate"]) delete props[key];
    return createElement("a", { href, ...props }, children);
  } },
})("src/components/kit/index.ts");

test("PageHeader: h1 — прямой потомок первого потомка корня, как в прежней шапке (на это опирается v3.css), число и «?» — по данным", () => {
  const { PageHeader } = kit();
  const html = renderToStaticMarkup(createElement(PageHeader, { title: "Заявки", count: 12, meta: "Сегодня", help: "Пояснение страницы", actions: createElement("button", null, "Создать") }));
  // корень > div > h1 (прежний `PageHeader` из ui.tsx: корень > div.min-w-0 > h1); на глубину `main:has(> div:first-child > div:first-child > h1.t-page-title)` в v3.css опираются отступ сверху и телефонные правила
  assert.match(html, /^<div data-slot="page-header"[^>]*><div class="[^"]*"><h1 class="t-page-title text-fg">Заявки<span[^>]*>12<\/span><\/h1>/);
  assert.doesNotMatch(html, /^<div data-slot="page-header"[^>]*><div class="[^"]*"><div/, "ряда между блоком и h1 нет");
  assert.match(html, /<\/h1><button[^>]*aria-label="Пояснение: Заявки"/, "«?» рядом с h1, имя кнопки — по заголовку");
  assert.match(html, /<p class="t-meta basis-full text-fg-3">Сегодня<\/p>/, "вторичная строка — в том же блоке, на своей строке");
  assert.match(html, /<button>Создать<\/button>/);
  assert.match(renderToStaticMarkup(createElement(PageHeader, { title: "Заявки", help: "x", helpLabel: "О заявках" })), /aria-label="О заявках"/);
  const bare = renderToStaticMarkup(createElement(PageHeader, { title: "Задачи", count: null }));
  assert.doesNotMatch(bare, /aria-label="Пояснение|tabular-nums/, "нет числа и пояснения — их нет и на экране");
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
});

test("PageShell: слот `back` стоит над шапкой в той же рамке 1240 px; без него рамка прежняя", () => {
  const { PageShell } = kit();
  const html = renderToStaticMarkup(createElement(PageShell, { title: "Агент", testId: "page", back: createElement("a", { href: "/v3/list" }, "Назад") }, createElement("p", null, "Тело")));
  assert.match(html, /^<main data-testid="page" class="mx-auto w-full px-4 py-8 sm:px-6 max-w-\[1240px\]"><a href="\/v3\/list">Назад<\/a><div data-slot="page-header"/);
  assert.match(html, /<div class="mt-6 grid min-w-0 gap-4"><p>Тело<\/p><\/div><\/main>$/);
  const plain = renderToStaticMarkup(createElement(PageShell, { title: "Список", testId: "page" }, createElement("p", null, "Тело")));
  assert.match(plain, /^<main data-testid="page" class="[^"]*"><div data-slot="page-header"/, "без `back` шапка — первый потомок, как раньше");
});

test("KeyFacts: не больше четырёх колонок, пустые значения не рисуются, ряд без фактов не рисуется", () => {
  const { KeyFacts } = kit();
  const facts = [{ label: "Страна", value: "Китай" }, { label: "Бюджет", value: null }, { label: "Заметка", value: "" }, { label: "Этап", value: "Новая" }];
  const html = renderToStaticMarkup(createElement(KeyFacts, { facts, columns: 9 }));
  assert.match(html, /@xl:grid-cols-4/);
  assert.doesNotMatch(html, /grid-cols-5|grid-cols-6|@xl:grid-cols-[5-9]/);
  assert.equal((html.match(/<dt/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Бюджет|Заметка/);
  assert.equal(renderToStaticMarkup(createElement(KeyFacts, { facts: [{ label: "Нет", value: null }] })), "");
  assert.match(renderToStaticMarkup(createElement(KeyFacts, { facts, columns: 1 })), /grid-cols-1/);
});

test("StatTile: нет значения — «—» без выдуманных чисел; красное число только по тону; ссылка — только с href", () => {
  const { StatTile } = kit();
  const empty = renderToStaticMarkup(createElement(StatTile, { label: "Оплаты", value: null }));
  assert.match(empty, /—<\/span><span class="sr-only">нет данных/);
  const danger = renderToStaticMarkup(createElement(StatTile, { label: "Просрочено", value: 3, tone: "danger", hint: "нужно сегодня" }));
  assert.match(danger, /t-figure px-4 text-danger">3</);
  assert.match(danger, /нужно сегодня/);
  assert.doesNotMatch(danger, /<a /);
  assert.match(renderToStaticMarkup(createElement(StatTile, { label: "Новые", value: 12, href: "/v3/requests" })), /<a [^>]*href="\/v3\/requests"/);
  assert.doesNotMatch(empty, /text-danger|%|↑|↓/);
  assert.match(danger, /data-\[size=sm\]:gap-1/, "промежуток плитки того же варианта, что у Card (data-[size=sm]:gap-2), иначе twMerge оставляет оба");
  assert.doesNotMatch(danger, /data-\[size=sm\]:gap-2/);
});

test("StatusBadge: слово обязательно, тона — те же имена, что у StatusChip, красный только danger", () => {
  const { StatusBadge } = kit();
  assert.equal(renderToStaticMarkup(createElement(StatusBadge, { label: "  " })), "");
  for (const [tone, tokens] of [["ok", "bg-ok-weak text-ok"], ["warn", "bg-warn-weak text-warn"], ["danger", "bg-danger-weak text-danger"], ["info", "bg-info-weak text-info"], ["neutral", "bg-surface text-fg-2"]]) {
    assert.ok(renderToStaticMarkup(createElement(StatusBadge, { label: "Слово", tone })).includes(tokens), tone);
  }
  assert.doesNotMatch(renderToStaticMarkup(createElement(StatusBadge, { label: "Слово" })), /danger|accent/);
});

test("WidgetCard и SectionTabs: заголовок h2, «?» только при пояснении; вкладки-ссылки с aria-current, без ролей tab", () => {
  const { WidgetCard, SectionTabs } = kit();
  const card = renderToStaticMarkup(createElement(WidgetCard, { title: "Задачи", help: "Пояснение", actions: createElement("a", { href: "#" }, "Все") }, "Тело"));
  assert.match(card, /<h2 data-slot="card-title"[^>]*>Задачи<\/h2>/);
  assert.match(card, /aria-label="Пояснение: Задачи"/, "имя «?» — по заголовку карточки, не десяток одинаковых «Пояснение»");
  assert.doesNotMatch(renderToStaticMarkup(createElement(WidgetCard, { title: "Без подсказки" }, "Тело")), /aria-label="Пояснение/);
  assert.match(renderToStaticMarkup(createElement(WidgetCard, { help: "Нет заголовка", actions: createElement("a", { href: "#" }, "Все") }, "Тело")), /aria-label="Пояснение"/, "без заголовка — общее имя");
  const links = renderToStaticMarkup(createElement(SectionTabs, { label: "Разделы", value: "b", tabs: [{ key: "a", label: "А", href: "?tab=a" }, { key: "b", label: "Б", count: 3, href: "?tab=b" }, { key: "c", label: "В", count: null, href: "?tab=c" }] }));
  assert.match(links, /aria-current="page"[^>]*>Б/);
  assert.equal((links.match(/aria-current/g) ?? []).length, 1);
  assert.doesNotMatch(links, /role="tab"/);
  const spaced = renderToStaticMarkup(createElement(SectionTabs, { label: "Разделы", className: "mt-4", value: "a", tabs: [{ key: "a", label: "А", href: "?tab=a" }] }));
  assert.match(spaced, /^<div class="[^"]*\bmt-4\b[^"]*">/, "className применяется и у вкладок-ссылок");
  // Вкладки на месте — Radix Tabs: страница получает их лениво (`SectionTabsInPlace`), настоящие вкладки — в `SectionTabsInPlaceImpl`.
  const { SectionTabsInPlaceImpl } = loader()("src/components/kit/SectionTabsInPlaceImpl.tsx");
  const inPlace = renderToStaticMarkup(createElement(SectionTabsInPlaceImpl, { label: "На месте", tabs: [{ key: "a", label: "А", content: "один" }, { key: "b", label: "Б", content: "два" }] }));
  assert.match(inPlace, /role="tablist"[^>]*aria-label="На месте"/);
  assert.match(inPlace, /один/);
  assert.doesNotMatch(read("src/components/kit/SectionTabs.tsx"), /ui\/tabs/, "SectionTabs не подключает Radix Tabs статически: он не идёт в первую загрузку страниц со вкладками-ссылками");
});

test("DataTable: страницы, прилипшая шапка, карточки на телефоне, пустое и загрузка (настоящая таблица TanStack; сортировку, поиск и колонки на деле меряет ui-kit-static-render)", () => {
  const { DataTable, StatusBadge } = kit();
  const rows = Array.from({ length: 27 }, (_, i) => ({ id: `r${i + 1}`, name: `Тест Синтетический ${i + 1}`, stage: i % 2 ? "Новая" : "В работе", budget: i % 3 ? 1000 + i : null }));
  const columns = [
    { accessorKey: "name", header: "Имя", meta: { mobile: "title" }, enableHiding: false },
    { accessorKey: "stage", header: "Этап", cell: ({ row }) => createElement(StatusBadge, { label: row.original.stage }) },
    { accessorKey: "budget", header: "Бюджет", meta: { align: "end" }, cell: ({ row }) => (row.original.budget === null ? "—" : String(row.original.budget)) },
  ];
  const html = renderToStaticMarkup(createElement(DataTable, { label: "Заявки", data: rows, columns, getRowId: (row) => row.id, onRowClick: () => {} }));
  assert.match(html, /role="region" aria-label="Заявки" tabindex="0"/, "прокручиваемая область с именем и фокусом");
  assert.equal((html.match(/<tbody[\s\S]*<\/tbody>/)[0].match(/<tr/g) ?? []).length, 10, "десять строк на странице");
  assert.match(html, /1–10 из 27/);
  assert.match(html, /aria-sort="none"/);
  assert.match(html, /sticky top-0/, "шапка прилипает");
  assert.match(html, /data-slot="data-table-cards"/);
  assert.match(html, /<button type="button" data-card-open="" aria-label="Открыть: Тест Синтетический 1" class="absolute inset-0[^"]*"><\/button>/, "карточка телефона открывается пустой кнопкой поверх карточки: ячейки в неё не вложены; имя — «Открыть: <название>»");
  assert.doesNotMatch(html, /aria-labelledby/, "имя кнопки карточки не берётся из всей ячейки-заголовка (в ней бывают и другие кнопки)");
  const cards = html.match(/<ul class="grid grid-cols-1 gap-2 md:hidden" data-slot="data-table-cards">[\s\S]*?<\/ul>/)[0];
  assert.doesNotMatch(cards, /<button[^>]*>(?:(?!<\/button>)[\s\S])+<\/button>/, "в карточках нет кнопки с содержимым — нет вложенных интерактивных элементов");
  assert.match(cards, /pointer-events-none relative/);
  assert.match(cards, /pointer-events-auto/, "ссылки и кнопки в ячейках ловят нажатия сами");
  assert.match(html, /aria-label="Поиск"/);
  // Список, который сервер уже ограничил («последние 30»): `paginate={false}` — все строки, ни «из N», ни полосы страниц.
  const whole = renderToStaticMarkup(createElement(DataTable, { label: "Заявки", data: rows, columns, getRowId: (row) => row.id, paginate: false }));
  assert.equal((whole.match(/<tbody[\s\S]*<\/tbody>/)[0].match(/<tr/g) ?? []).length, 27, "все 27 строк сразу");
  assert.doesNotMatch(whole, /data-slot="data-table-pagination"|\d+–\d+ из \d+/);
  assert.equal((whole.match(/<ul class="grid grid-cols-1 gap-2 md:hidden" data-slot="data-table-cards">[\s\S]*?<\/ul>/)[0].match(/<li/g) ?? []).length, 27, "и на телефоне — все карточки");
  const empty = renderToStaticMarkup(createElement(DataTable, { label: "Пусто", data: [], columns }));
  assert.match(empty, /Пока пусто/);
  assert.doesNotMatch(empty, /<table/);
  const custom = renderToStaticMarkup(createElement(DataTable, { label: "Пусто", data: [], columns, empty: createElement("p", null, "Заявок нет") }));
  assert.match(custom, /Заявок нет/);
  const loading = renderToStaticMarkup(createElement(DataTable, { label: "Загрузка", data: rows, columns, loading: true }));
  assert.match(loading, /aria-busy="true"/);
  assert.doesNotMatch(loading, /1–10 из/, "пока грузится, страниц нет");
  assert.ok((loading.match(/animate-pulse/g) ?? []).length >= 4);
});

test("DataTable: строка не остановка клавиатуры; запись открывает кнопка «Открыть: …» в ячейке-заголовке, у колонки с opensRow — её собственная ссылка", () => {
  const { DataTable } = kit();
  const rows = [{ id: "a", name: "Эльмира Формова", who: "Вы" }, { id: "b", name: "Тимур Демонстров", who: "Бекболот" }];
  const base = [
    { accessorKey: "name", header: "Имя", meta: { mobile: "title" }, enableHiding: false },
    { accessorKey: "who", header: "Кто", meta: { wide: true } },
  ];
  const html = renderToStaticMarkup(createElement(DataTable, { label: "Заявки", data: rows, columns: base, getRowId: (row) => row.id, onRowClick: () => {}, getRowLabel: (row) => `${row.name} (заявка)` }));
  const body = html.match(/<tbody[\s\S]*<\/tbody>/)[0];
  assert.doesNotMatch(body, /<tr[^>]*tabindex/, "строка таблицы не принимает фокус: безымянной остановки с клавиатуры нет");
  assert.doesNotMatch(body, /<tr[^>]*role=/, "и не получает свою роль");
  const buttons = [...body.matchAll(/<button type="button" data-row-open="" aria-label="([^"]+)" class="([^"]*)"><\/button>/gu)];
  assert.deepEqual(buttons.map((match) => match[1]), ["Открыть: Эльмира Формова (заявка)", "Открыть: Тимур Демонстров (заявка)"], "по кнопке на строку, имя из getRowLabel");
  assert.match(buttons[0][2], /pointer-events-none absolute inset-0/, "кнопка прозрачна и не ловит мышь: текст выделяется, ссылки в ячейке работают");
  assert.match(buttons[0][2], /focus-visible:-outline-offset-2!/, "рамка фокуса внутри ячейки, а не снаружи (её срезали бы прокрутка и прилипшая шапка)");
  assert.match(body, /has-\[:is\(\[data-row-open\],\[data-queue-open\]\):focus-visible\]:bg-surface-2/, "строка подсвечивается, когда кнопка в фокусе");
  assert.match(body, /<td[^>]*relative"><button type="button" data-row-open=""/, "кнопка стоит в ячейке-заголовке (mobile: title), её рамка — по ячейке");
  assert.equal((body.match(/data-row-open=""/g) ?? []).length, 2, "в остальных ячейках кнопок нет");
  // Без getRowLabel имя — значение колонки-заголовка.
  const unnamed = renderToStaticMarkup(createElement(DataTable, { label: "Заявки", data: rows, columns: base, getRowId: (row) => row.id, onRowClick: () => {} }));
  assert.match(unnamed, /aria-label="Открыть: Эльмира Формова"/);
  assert.match(unnamed, /<button type="button" data-card-open="" aria-label="Открыть: Эльмира Формова" class="absolute inset-0/, "кнопка карточки телефона названа так же");
  // Колонка второго плана рисуется только от 64rem блока таблицы; у корня таблицы — контейнер для этого.
  assert.match(html, /<div class="@container flex min-w-0 flex-col gap-3" data-slot="data-table">/);
  assert.match(html, /<th[^>]*hidden @5xl:table-cell"[^>]*>[\s\S]*?Кто/, "заголовок колонки wide");
  assert.equal((body.match(/hidden @5xl:table-cell/g) ?? []).length, 2, "и её ячейки");
  // Своя ссылка в ячейке-заголовке (`Задачи`): второй кнопки таблица не добавляет.
  const own = renderToStaticMarkup(createElement(DataTable, {
    label: "Задачи", data: rows, getRowId: (row) => row.id, onRowClick: () => {}, getRowLabel: (row) => row.name,
    columns: [{ accessorKey: "name", header: "Задача", meta: { mobile: "title", opensRow: true }, enableHiding: false, cell: ({ row }) => createElement("a", { href: `#${row.original.id}`, "data-queue-open": "" }, row.original.name) }],
  }));
  assert.doesNotMatch(own.match(/<tbody[\s\S]*<\/tbody>/)[0], /data-row-open=""/, "opensRow: в таблице нет второго перехода");
  // Карточка телефона: ссылка-название уже ведёт в запись, поэтому накладка на всю карточку — площадь касания, а не вторая кнопка:
  // не кнопка, вне дерева доступности, без имени (иначе у записи два одноимённых пути клавиатуры и читалки, как в таблице).
  const ownCards = own.match(/<ul class="grid grid-cols-1 gap-2 md:hidden" data-slot="data-table-cards">[\s\S]*?<\/ul>/)[0];
  assert.match(ownCards, /<span aria-hidden="true" data-card-open="" class="absolute inset-0 rounded-card"><\/span>/, "накладка карточки opensRow — скрытый от читалки span");
  assert.doesNotMatch(ownCards, /<button[^>]*aria-label="Открыть|aria-labelledby/, "второй кнопки «Открыть: …» в карточке нет");
  assert.equal((ownCards.match(/<a [^>]*data-queue-open/g) ?? []).length, 2, "единственный путь в запись — ссылка-название");
  // Без onRowClick строки не нажимаются и кнопок нет.
  const plain = renderToStaticMarkup(createElement(DataTable, { label: "Только чтение", data: rows, columns: base, getRowId: (row) => row.id }));
  assert.doesNotMatch(plain, /data-row-open=""|cursor-pointer/);
  assert.equal((plain.match(/aria-label="Открыть/g) ?? []).length, 0);
});

test("мышь по строке ставит фокус на кнопку записи до открытия панели (иначе Esc вернул бы его на область всей таблицы)", () => {
  const { focusRecordOpener } = loader()("src/components/kit/DataTableParts.tsx");
  const seen = [];
  const scope = { querySelector: (selector) => ({ focus: (options) => seen.push([selector, options]) }) };
  focusRecordOpener(scope);
  assert.deepEqual(seen, [["[data-row-open],[data-queue-open]", { preventScroll: true }]], "кнопка «Открыть: …» или ссылка-название; страница не прокручивается");
  assert.doesNotThrow(() => focusRecordOpener(null));
  assert.doesNotThrow(() => focusRecordOpener({ querySelector: () => null }), "в записи нет кнопки — ничего не делаем");
  // Строка таблицы зовёт это перед `onOpen`, но не для нажатия на ссылку, кнопку или поле внутри неё.
  assert.match(read("src/components/kit/DataTableParts.tsx"), /if \(\(event\.target as HTMLElement\)\.closest\(INTERACTIVE\)\) return;\s*focusRecordOpener\(event\.currentTarget\);\s*onOpen\(\);/);
  assert.match(read("src/components/kit/DataTableCards.tsx"), /focusRecordOpener\(event\.currentTarget\.parentElement\); row\.onOpen\?\.\(\);/);
});

test("DetailSheet: Shift+Tab с названия панели идёт на последний управляемый элемент панели (Radix круг от названия не замыкает)", () => {
  const { wrapShiftTabFromTitle } = loader()("src/components/kit/detail-sheet-focus.ts");
  const focused = [];
  const stop = (name, shown = true) => ({ name, getClientRects: () => (shown ? [{}] : []), focus: () => focused.push(name) });
  const panel = (stops) => ({ closest: (selector) => (selector === '[role="dialog"]' ? { querySelectorAll: () => stops } : null) });
  globalThis.getComputedStyle = (element) => ({ visibility: element.hidden ? "hidden" : "visible" });
  try {
    const event = (over = {}) => { const e = { key: "Tab", shiftKey: true, altKey: false, ctrlKey: false, metaKey: false, prevented: false, currentTarget: panel([stop("пояснение"), stop("тело"), stop("действие"), stop("закрыть"), stop("скрытая", false)]), preventDefault() { e.prevented = true; }, ...over }; return e; };
    const wrapped = event();
    wrapShiftTabFromTitle(wrapped);
    assert.deepEqual(focused, ["закрыть"], "последний видимый элемент панели");
    assert.equal(wrapped.prevented, true, "браузер сам фокус не двигает");
    for (const over of [{ shiftKey: false }, { key: "Enter" }, { ctrlKey: true }, { currentTarget: panel([]) }, { currentTarget: { closest: () => null } }]) {
      const quiet = event(over);
      wrapShiftTabFromTitle(quiet);
      assert.equal(quiet.prevented, false, JSON.stringify(Object.keys(over)));
    }
    assert.equal(focused.length, 1, "остальные нажатия фокуса не трогают");
  } finally {
    delete globalThis.getComputedStyle;
  }
  assert.match(read("src/components/kit/DetailSheet.tsx"), /<SheetTitle ref=\{heading\} tabIndex=\{-1\} onKeyDown=\{wrapShiftTabFromTitle\}/);
});

test("меню «Колонки»: колонки `meta.wide` не перечисляются, пока блок таблицы уже 64rem (их на экране нет); настоящую ширину меряет ui-kit/ai-agents стенд", () => {
  const hook = read("src/components/kit/useColumnMenu.ts");
  assert.match(hook, /const WIDE_REM = 64;/, "порог — `@5xl` контейнера Tailwind");
  assert.match(hook, /new ResizeObserver\(/);
  assert.match(hook, /columns\.filter\(\(column\) => wideFits !== false \|\| !column\.columnDef\.meta\?\.wide\)/, "пока ширина неизвестна, список полный; в узком блоке wide-колонок нет");
  const table = read("src/components/kit/DataTable.tsx");
  assert.match(table, /const \{ watchBlock, columns: menuColumns \} = useColumnMenu\(table\.getAllLeafColumns\(\)\);/);
  assert.match(table, /<div ref=\{watchBlock\} className=\{cn\("@container/, "меряется тот же блок, у которого контейнерный запрос");
  assert.match(table, /columns=\{columnMenu \? menuColumns : undefined\}/);
  assert.match(read("DESIGN.md"), /меню «Колонки» её не перечисляет/);
});

test("StatTile: корень плитки — containing block для скрытой подписи «нет данных» (иначе на телефоне страница ползёт вбок)", () => {
  const { StatTile } = kit();
  for (const props of [{ label: "Оплаты", value: null }, { label: "Оплаты", value: null, href: "#x" }]) {
    const html = renderToStaticMarkup(createElement(StatTile, props));
    assert.match(html, /^<(?:div|a) [^>]*class="[^"]*\brelative\b[^"]*"[^>]*data-slot="stat-tile"|^<(?:div|a) data-slot="stat-tile"[^>]*class="[^"]*\brelative\b/u, "корень data-slot=stat-tile — relative");
    assert.match(html, /sr-only">нет данных/);
  }
});

test("DetailSheet: фокус при открытии — на название, рамка области внутри; DESIGN.md называет итоговые свойства набора", () => {
  const sheet = read("src/components/kit/DetailSheet.tsx");
  assert.match(sheet, /onOpenAutoFocus=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?heading\.current\?\.focus\(\{ preventScroll: true \}\)/, "фокус уходит на название, а не на область с tabIndex=0");
  assert.match(sheet, /<SheetTitle ref=\{heading\} tabIndex=\{-1\}[^>]*focus-visible:outline-none!/, "название принимает фокус скриптом и рамки не рисует");
  assert.match(sheet, /className: "focus-visible:-outline-offset-2! focus-visible:shadow-none!"/, "рамка прокручиваемой области — внутри панели");
  assert.match(sheet, /panel\.contains\(document\.activeElement\)\) return;/, "кто уже поставил фокус внутрь панели, того не трогаем");
  const design = read("DESIGN.md");
  assert.match(design, /DetailSheet\(\{[^\n]*onOpenChange\?, onCloseAutoFocus\?, footer\?/, "DESIGN.md: onCloseAutoFocus у DetailSheet");
  assert.match(design, /`event\.preventDefault\(\)` оставляет фокус и прокрутку на месте/);
  assert.match(design, /SectionTabs\(\{[^\n]*className\?, focusable\? \}\)/, "DESIGN.md: focusable у SectionTabs");
  assert.match(design, /`focusable` \(только для ряда ссылок\)/);
  assert.match(design, /DataTable<T>\(\{[^\n]*onRowClick\?, getRowLabel\?,/, "DESIGN.md: getRowLabel у DataTable");
  assert.match(design, /`meta\.opensRow: true`/);
  assert.match(design, /`meta\.wide`/);
});

test("прежние строки очередей: каждый класс — целое слово, а не обрывок шаблона вплотную к ${…} (Tailwind читает только целые слова)", () => {
  const { Scanner } = createRequire(import.meta.url)("@tailwindcss/oxide");
  const candidates = (file) => {
    const base = new URL(`../${dirname(file)}`, import.meta.url).pathname;
    return new Set(new Scanner({ sources: [{ base, pattern: file.split("/").pop(), negated: false }] }).scan());
  };
  for (const file of ["src/components/v3/today/TodayRow.tsx", "src/components/v3/tasks/TaskQueueRow.tsx"]) {
    assert.doesNotMatch(read(file), /[A-Za-z0-9_\]\)-]\$\{\s*(?:w|wide)\(/u, `${file}: класс вплотную к интерполяции`);
    assert.match(read(file), /joinClasses\(/u, `${file}: классы собирает joinClasses`);
  }
  // `.basis-0` была только здесь: без неё у «кто» прежней строки «Сегодня» flex-basis считался бы 0%, а не 0px.
  assert.ok(candidates("src/components/v3/today/TodayRow.tsx").has("basis-0"), "TodayRow: basis-0 читается сборщиком");
  assert.ok(candidates("src/components/v3/today/TodayRow.tsx").has("@min-[32rem]:order-1"));
  // У прежней строки задач класс `gap-x-1` для широкого варианта никогда не попадал в CSS (он был приклеен к `${metaHidden}`): зазор строки —
  // Tailwind v4 читает весь репозиторий (код, тесты, документы), и комментарии тоже: правило для широкого варианта этого `gap-x-1`
  // не должно появиться нигде. Сам класс здесь собран из частей: написанный целиком, он породил бы правило из этого файла.
  const wide = ["@min-[32rem]", "gap-x-1"].join(":");
  const repo = new URL("..", import.meta.url).pathname;
  const sources = ["src", "tests", "docs", "scripts"].map((dir) => ({ base: join(repo, dir), pattern: "**/*", negated: false }))
    .concat({ base: repo, pattern: "*.md", negated: false });
  assert.ok(!new Set(new Scanner({ sources }).scan()).has(wide), "широкая строка задач сохраняет gap-x-2, как на main: в CSS нет правила для широкого gap-x-1");
  assert.doesNotMatch(read("src/components/v3/tasks/TaskQueueRow.tsx"), /gap-x-1\b/);
});

test("DetailSheet, HelpTip и примитивы: портал внутри корня нового вида, подписи и размеры целей", () => {
  for (const file of ["dialog", "sheet", "popover", "tooltip", "dropdown-menu", "select"]) {
    const source = read(`src/components/ui/${file}.tsx`);
    assert.match(source, /useUiPortalContainer\(\)/, file);
    assert.doesNotMatch(source, /\bdark:/, `${file}: тёмной темы нет`);
  }
  assert.match(read("src/components/ui/portal.ts"), /\.v3-world\[data-ui="next"\]/);
  assert.match(read("src/components/ui/button.tsx"), /h-11 min-w-11/);
  assert.match(read("src/components/ui/tooltip.tsx"), /<TooltipProvider>/, "Tooltip уже включает провайдер Radix");
  const sheet = read("src/components/kit/DetailSheet.tsx");
  assert.match(sheet, /"aria-label": title/, "прокручиваемая область панели имеет имя");
  assert.match(sheet, /tabIndex: 0/);
  assert.match(sheet, /onCloseAutoFocus/, "без trigger фокус возвращается на запомненный элемент, а не в начало страницы");
  assert.match(sheet, /side === "right" && "data-\[side=right\]:sm:max-w-lg"/, "ширина — того же варианта, что у SheetContent, и не для нижней панели");
  assert.doesNotMatch(sheet, /"gap-0 sm:max-w-lg"/);
});

test("прежний набор `@/components/ui` остаётся файлом ui.tsx, новые примитивы — в каталоге ui/", () => {
  assert.ok(existsSync(new URL("../src/components/ui.tsx", import.meta.url)));
  assert.ok(!existsSync(new URL("../src/components/ui/index.ts", import.meta.url)), "индекса в каталоге нет: `@/components/ui` не должен менять смысл");
  assert.ok(!existsSync(new URL("../src/components/ui/index.tsx", import.meta.url)));
  assert.match(read("src/components/ui.tsx"), /export function EmptyState/);
});

test("токены нового вида заданы только под data-ui=next, а прежние имена EVO (--accent, --border) не переопределены", () => {
  const css = read("src/app/ui-next.css");
  const rule = css.match(/\.v3-world\[data-surface="staff"\]\[data-ui="next"\] \{[\s\S]*?\n\}/)[0];
  for (const name of ["background", "foreground", "card", "popover", "primary", "primary-foreground", "secondary", "muted", "muted-foreground", "destructive", "input", "ring", "radius", "chart-1", "chart-5"]) {
    assert.match(rule, new RegExp(`--${name}:`), name);
  }
  assert.doesNotMatch(rule, /--accent:|--border:|--accent-foreground:/);
  assert.match(rule, /--primary: var\(--accent\)/, "primary = красный EVO");
  const outside = css.replace(rule, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(outside, /\.v3-world|:root|^\s*--(?:primary|card|input|ring)\s*:/m, "вне блока переменных значений нет");
  assert.match(read("src/app/globals.css"), /^@import "tailwindcss";\n[^\n]*\n@import "\.\/ui-next\.css";/);
});
