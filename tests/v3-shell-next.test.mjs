import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { staffCanAccessRoute } from "../src/lib/platform-access.ts";
import { buildV3Navigation } from "../src/lib/v3/navigation.ts";
import {
  NEXT_GROUP_ICONS,
  NEXT_LINK_ICONS,
  SHELL_TAB_SLOTS,
  shellTabLabel,
  shellTabs,
  toggleMenuGroup,
  trapFocusIndex,
  visibleNavigationLinks,
} from "../src/lib/v3/shell-tabs.ts";

/**
 * Э1.2 плана редизайна (25.09.2026): оболочка нового облика — меню без
 * верхней панели, нижняя панель телефона и лист «Ещё» (AppShellNext.tsx).
 * Временное сосуществование до решения владельца (Э1.5,
 * izzhackt/evo_AI_CRM#1061): прежняя оболочка не меняется. Живые снимки,
 * фокус листа, поле ответа над панелью и «Выйти» на 1280×800 меряет
 * tests/e2e/shell-static-render.cjs --screenshots; здесь — правила мест,
 * разметка обоих обликов и семантика листа.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Названия прав ролей (аудит доступа 26.09), без людей.
const SALES_KEYS = ["lead.read", "lead.sales.workflow.manage", "lead.sales.owner.assign", "sales.register.read", "sales.register.manage",
  "case.read.summary", "communication.read.full", "communication.manual.send", "staff.task.read", "staff.task.create", "task.create",
  "team.chat.general", "team.chat.sales", "reply.snippet.sales", "reply.snippet.all", "catalog.read", "knowledge.read.approved"];
const ADMISSIONS_KEYS = ["case.read.full", "case.read.summary", "case.route.manage", "case.update.append", "profile.read.full", "profile.manage",
  "document.read.full", "document.manage", "communication.read.full", "communication.manual.send", "lead.read", "task.create", "task.manage",
  "staff.task.read", "staff.task.create", "team.chat.admissions", "team.chat.general", "company.file.read", "reply.snippet.admissions", "catalog.read"];

const actor = (fields) => ({ systemRole: "staff", presentationRole: null, platformAccessVersion: 1, assignments: [], permissionKeys: [], ...fields });
const ACTORS = {
  admin: actor({ systemRole: "admin" }),
  "admin-preview-admissions": actor({ systemRole: "admin", presentationRole: "admissions" }),
  "admin-preview-sales": actor({ systemRole: "admin", presentationRole: "sales" }),
  "sales-staff": actor({ permissionKeys: SALES_KEYS }),
  "admissions-staff": actor({ permissionKeys: ADMISSIONS_KEYS }),
  "team-only": actor({ permissionKeys: ["staff.task.read", "staff.task.create", "team.chat.general"] }),
  "no-rights": actor({}),
};
const nav = (who, href = "/v3/main") => {
  const url = new URL(href, "https://shell.test");
  return buildV3Navigation(ACTORS[who], url.pathname, url.searchParams);
};
const ids = (links) => links.map((link) => link.id);

test("tab slots per role follow the owner's order: admissions and Admin — Студенты · Задачи · Сообщения, sales — Воронка · Заявки · Задачи", () => {
  const admissions = ["home", "admissions-worklist", "tasks", "messages"];
  const sales = ["home", "pipeline", "requests", "tasks"];
  for (const [who, kind, expected] of [
    ["admin", "admissions", admissions],
    ["admin-preview-admissions", "admissions", admissions],
    ["admissions-staff", "admissions", admissions],
    ["admin-preview-sales", "sales", sales],
    ["sales-staff", "sales", sales],
  ]) {
    const tabs = shellTabs(nav(who));
    assert.equal(tabs.kind, kind, who);
    assert.deepEqual(ids(tabs.links), expected, who);
  }
  assert.deepEqual(shellTabs(nav("admin")).links.map((link) => link.label), ["Главная", "Студенты", "Задачи", "Сообщения"]);
  assert.deepEqual(shellTabs(nav("sales-staff")).links.map((link) => link.label), ["Главная", "Воронка продаж", "Заявки", "Задачи"]);
});

test("tabs come only from the role's visible navigation: never an item it cannot open, never more than four plus «Ещё»", () => {
  for (const who of Object.keys(ACTORS)) {
    for (const href of ["/v3/main", "/v3/tasks", "/v3/calendar", "/v3/profile?section=docs", "/v3/pipeline"]) {
      const model = nav(who, href);
      const visible = visibleNavigationLinks(model);
      const tabs = shellTabs(model);
      assert.ok(tabs.links.length <= SHELL_TAB_SLOTS && SHELL_TAB_SLOTS + 1 === 5, `${who}: at most five slots with «Ещё»`);
      for (const link of tabs.links) {
        // Тот же объект навигации: адрес, подпись и маршрут не выдумываются.
        assert.ok(visible.includes(link), `${who} ${href}: ${link.id} is a visible menu item`);
        assert.ok(staffCanAccessRoute(ACTORS[who], link.route), `${who}: ${link.id} passes the route guard`);
        assert.notEqual(link.id, "settings", "«Настройки» stay in «Ещё»");
      }
      assert.equal(new Set(ids(tabs.links)).size, tabs.links.length, "no duplicate tab");
      assert.equal(tabs.currentInMore, model.activeId !== null && !ids(tabs.links).includes(model.activeId), `${who} ${href}`);
    }
  }
  // Роль без набора — первые видимые разделы по порядку меню.
  const team = shellTabs(nav("team-only", "/v3/tasks"));
  assert.equal(team.kind, "other");
  assert.deepEqual(ids(team.links), ids(visibleNavigationLinks(nav("team-only", "/v3/tasks"))).filter((id) => id !== "settings").slice(0, 4));
  assert.deepEqual(ids(shellTabs(nav("no-rights")).links), []);
  // Открытый раздел вне вкладок подсвечивает «Ещё».
  assert.equal(shellTabs(nav("admin", "/v3/calendar")).currentInMore, true);
  assert.equal(shellTabs(nav("admin", "/v3/tasks")).currentInMore, false);
});

test("every menu item of the new look has an icon from the existing set", () => {
  const icons = read("src/components/icons.tsx");
  for (const name of [...Object.values(NEXT_LINK_ICONS), ...Object.values(NEXT_GROUP_ICONS)]) {
    assert.match(icons, new RegExp(`\\| "${name}"`, "u"), name);
  }
  for (const who of Object.keys(ACTORS)) {
    for (const link of visibleNavigationLinks(nav(who))) assert.ok(NEXT_LINK_ICONS[link.id], link.id);
    for (const group of nav(who).groups) assert.ok(NEXT_GROUP_ICONS[group.id], group.id);
  }
});

test("icons tell the rail items apart: one glyph per meaning, three conversations with three glyphs", () => {
  // Обе воронки — один смысл, один знак; всё остальное — свой знак у каждого пункта.
  const byIcon = new Map();
  for (const [id, icon] of Object.entries(NEXT_LINK_ICONS)) byIcon.set(icon, [...(byIcon.get(icon) ?? []), id]);
  for (const [icon, ids] of byIcon) {
    if (icon === "funnel") assert.deepEqual(ids, ["pipeline", "admissions-pipeline"]);
    else assert.equal(ids.length, 1, `${icon} is shared by ${ids.join(", ")}`);
  }
  assert.notEqual(NEXT_LINK_ICONS.inbox, "phone", "WhatsApp is a conversation, not a call");
  assert.notEqual(NEXT_LINK_ICONS["reply-snippets"], "send", "templates are text, not a send action");
  assert.deepEqual(new Set([NEXT_LINK_ICONS.messages, NEXT_LINK_ICONS.inbox, NEXT_LINK_ICONS["team-chat"]]).size, 3);
  // Групп и «Ещё» это тоже касается: их знаки не совпадают с пунктами.
  for (const icon of [...Object.values(NEXT_GROUP_ICONS), "menu"]) assert.ok(!byIcon.has(icon), icon);
});

test("tab labels fit one line: short label only where the full one does not, and the visible label stays inside the accessible name", () => {
  const links = visibleNavigationLinks(nav("admin"));
  for (const link of links) {
    const label = shellTabLabel(link);
    if (label.name === undefined) {
      assert.equal(label.text, link.label, link.id);
    } else {
      assert.equal(label.name, link.label, link.id);
      assert.ok(label.name.toLowerCase().includes(label.text.toLowerCase()), `${link.id}: «${label.text}» is inside «${label.name}» (WCAG 2.5.3)`);
      assert.ok(label.text.length < label.name.length, link.id);
    }
  }
  assert.deepEqual(shellTabs(nav("sales-staff")).links.map((link) => shellTabLabel(link).text), ["Главная", "Воронка", "Заявки", "Задачи"]);
  assert.deepEqual(shellTabs(nav("admin")).links.map((link) => shellTabLabel(link).text), ["Главная", "Студенты", "Задачи", "Сообщения"]);
  assert.equal(shellTabLabel({ id: "pipeline", label: "Воронка продаж" }).name, "Воронка продаж");
});

test("menu groups open one at a time, except the group that holds the current page", () => {
  assert.deepEqual(toggleMenuGroup([], "sales", []), ["sales"]);
  assert.deepEqual(toggleMenuGroup(["sales"], "admissions", []), ["admissions"], "opening one closes the other");
  assert.deepEqual(toggleMenuGroup(["admissions"], "sales", ["admissions"]), ["admissions", "sales"], "the current page's group stays open");
  assert.deepEqual(toggleMenuGroup(["admissions", "sales"], "sales", ["admissions"]), ["admissions"], "a second press closes it");
  assert.deepEqual(toggleMenuGroup(["admissions"], "admissions", ["admissions"]), [], "the current group can be closed by hand");
  const shell = read("src/components/v3/AppShellNext.tsx");
  assert.match(shell, /useState<readonly V3NavigationGroup\["id"\]\[\]>\(activeGroups\)/u, "starts with the current page's group open");
  assert.match(shell, /onToggle=\{\(\) => setOpenGroups\(\(previous\) => toggleMenuGroup\(previous, group\.id, activeGroups\)\)\}/u);
});

test("Tab inside the «Ещё» sheet cycles and never leaves it", () => {
  assert.equal(trapFocusIndex(3, 0, false), 1);
  assert.equal(trapFocusIndex(3, 2, false), 0, "past the last item — back to the first");
  assert.equal(trapFocusIndex(3, 0, true), 2, "Shift+Tab on the first item — the last one");
  assert.equal(trapFocusIndex(3, 1, true), 0);
  assert.equal(trapFocusIndex(3, -1, false), 0, "focus outside the sheet comes back in");
  assert.equal(trapFocusIndex(3, -1, true), 2);
  assert.equal(trapFocusIndex(0, 0, false), -1);
});

// --- разметка обоих обликов (tests/e2e/shell-static-render.cjs --json) ---------
const surfaces = JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/shell-static-render.cjs", import.meta.url)), "--json"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
));
const surface = (name) => {
  const item = surfaces.find((entry) => entry.name === name);
  assert.ok(item, name);
  return item.html;
};
const count = (html, pattern) => [...html.matchAll(pattern)].length;
const EXPECTED_TABS = {
  admin: ["Главная", "Студенты", "Задачи", "Сообщения"],
  admissions: ["Главная", "Студенты", "Задачи", "Сообщения"],
  "admissions-staff": ["Главная", "Студенты", "Задачи", "Сообщения"],
  sales: ["Главная", "Воронка", "Заявки", "Задачи"],
};
function tabbar(html) {
  const start = html.indexOf('<nav aria-label="Быстрые разделы"');
  assert.ok(start >= 0, "tab bar");
  return html.slice(start, html.indexOf("</nav>", start));
}

test("current look is unchanged: top bar, mobile menu toggle, no tab bar, no sheet", () => {
  const current = surfaces.filter((entry) => entry.look === "current");
  assert.equal(current.length, 20);
  for (const { name, role, html } of current) {
    assert.doesNotMatch(html, /data-shell-look|data-shell-menu|v3-shell-tabbar|v3-shell-topbar|Быстрые разделы/u, name);
    assert.match(html, /<div class="flex min-h-14 shrink-0 flex-wrap items-center justify-end gap-3 border-b border-border bg-surface px-4 py-1 md:min-h-16 md:px-6 md:py-2">/u, `${name}: top bar`);
    assert.match(html, /aria-label="Открыть навигацию" aria-expanded="false"/u, `${name}: mobile toggle`);
    assert.equal(count(html, /data-testid="staff-logout"/gu), 1, name);
    assert.equal(count(html, /data-testid="active-role"/gu), 1, name);
    assert.doesNotMatch(html, /popover="manual"/u, `${name}: notifications stay in the bar`);
    if (role === "admissions") {
      assert.match(html, /data-testid="preview-active"[\s\S]*Интерфейс: Приёмная[\s\S]*data-testid="preview-role-admin"[^>]*>Вернуться к Администратору</u, name);
    } else {
      assert.match(html, /<span class="hidden sm:inline">Уведомления<\/span>/u, `${name}: bar bell`);
      assert.match(html, /<a class="inline-flex min-h-11 items-center gap-2 rounded-ctl border border-control-edge bg-surface px-3 text-sm font-medium text-fg-2[^"]*" href="\/v3\/tasks\?create=staff">/u, `${name}: bar «Создать задачу»`);
    }
  }
});

test("new look: no top bar; menu holds create, bell, preview exit and account; phone tab bar per role with «Ещё»", () => {
  const next = surfaces.filter((entry) => entry.look === "next");
  assert.equal(next.length, 20);
  for (const { name, role, pathname, html } of next) {
    assert.match(html, /data-shell-look="next"/u, name);
    assert.doesNotMatch(html, /md:min-h-16|Открыть навигацию/u, `${name}: no top bar, no old mobile toggle`);
    assert.equal(count(html, /data-testid="staff-logout"/gu), 1, `${name}: one account block`);
    assert.equal(count(html, /data-testid="active-role"/gu), 1, name);
    assert.match(html, /data-testid="v3-shell"/u);
    const bar = tabbar(html);
    const labels = [...bar.matchAll(/<a [^>]*data-shell-tab="[^"]+"[^>]*>.*?<span class="t-caption whitespace-nowrap">([^<]+)<\/span><\/a>/gu)].map((match) => match[1]);
    assert.deepEqual(labels, EXPECTED_TABS[role], `${name}: tab labels`);
    assert.equal(count(bar, /<li>/gu), labels.length + 1, `${name}: tabs plus «Ещё»`);
    assert.ok(labels.length + 1 <= 5);
    // Подпись в одну строку: колонка не уже своей подписи.
    assert.match(bar, new RegExp(`grid-template-columns:repeat\\(${labels.length + 1}, minmax\\(auto, 1fr\\)\\)`, "u"), `${name}: columns never narrower than their label`);
    if (role === "sales") assert.match(bar, /aria-label="Воронка продаж"[^>]*data-shell-tab="pipeline"/u, `${name}: the full name stays the accessible name`);
    assert.match(bar, /<button type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="([^"]+)"/u, `${name}: «Ещё» controls the sheet`);
    const sheetId = bar.match(/aria-controls="([^"]+)"/u)[1];
    // Закрытый лист — не диалог; открытый получает role="dialog" и aria-modal, свою
    // строку с логотипом и панель вкладок с «Закрыть» на месте «Ещё» (снимки).
    assert.match(html, new RegExp(`<div id="${sheetId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}" data-shell-menu="" class="[^"]*\\bhidden\\b`, "u"), `${name}: sheet closed by default`);
    assert.doesNotMatch(html, /Закрыть меню|v3-shell-sheet-tabbar/u, `${name}: the sheet's own bar renders only while open`);
    // Аккаунт: имя и роль в одну строку с подсказкой, «Выйти» — тихая кнопка без рамки и тени.
    assert.match(html, /<span class="t-meta mt-0\.5 block truncate text-fg-3" title="[^"]+" data-testid="active-role"/u, `${name}: role caption on one line`);
    assert.match(html, /<button type="submit" data-testid="staff-logout" class="inline-flex min-h-11 min-w-11 [^"]*"/u, `${name}: quiet sign-out`);
    assert.doesNotMatch(html, /<button type="submit" data-testid="staff-logout" class="[^"]*(v3-raised|border-control-edge)/u, `${name}: sign-out is not a raised button`);
    // Текущий раздел во вкладке — aria-current; иначе подсвечено «Ещё».
    const current = [...bar.matchAll(/<a [^>]*aria-current="page"[^>]*data-shell-tab="([^"]+)"/gu)].map((match) => match[1]);
    const inMore = /data-shell-tab="more" data-current-inside=""/u.test(bar);
    assert.ok(current.length + Number(inMore) <= 1, `${name}: one current place`);
    if (pathname === "/v3/main") assert.deepEqual(current, ["home"], name);
    if (pathname === "/v3/calendar" && role !== "sales") assert.ok(inMore, `${name}: «Календарь» lives in «Ещё»`);
    if (role === "admissions") {
      assert.match(html, /data-testid="preview-active"[\s\S]*Приёмная[\s\S]*data-testid="preview-role-admin"[\s\S]*Выйти из просмотра/u, `${name}: preview exit in the menu`);
      assert.match(html, /Просмотр: Приёмная/u, `${name}: phone top row names the previewed role`);
      assert.doesNotMatch(html, /Создать задачу|aria-label="Уведомления/u, `${name}: preview has no create or bell, as today`);
    } else {
      assert.doesNotMatch(html, /data-testid="preview-active"/u, name);
      assert.match(html, /aria-label="Уведомления: 3 непрочитанных"/u, `${name}: bell with count`);
      assert.match(html, /aria-label="Ещё: меню, непрочитанных уведомлений — 3"/u, `${name}: count reaches «Ещё»`);
      assert.match(html, /<a class="v3-raised [^"]*text-fg-2[^"]*" href="\/v3\/tasks\?create=staff">/u, `${name}: neutral «Создать задачу»`);
      assert.doesNotMatch(html, /<a class="[^"]*bg-accent[^"]*" href="\/v3\/tasks\?create=staff">/u, `${name}: never red`);
    }
  }
  // Рейка на досках до 1536 px — то же правило, что в прежнем облике.
  assert.match(surface("board-admin-next"), /data-shell-layout="board"/u);
  assert.match(surface("board-admin-next"), /md:w-16 2xl:w-\[260px\]/u);
  assert.match(surface("home-admin-next"), /md:w-\[260px\]/u);
});

test("the sheet is a modal dialog while open: inert page, Escape and «Закрыть» return focus to «Ещё», focus trapped", () => {
  const shell = read("src/components/v3/AppShellNext.tsx");
  assert.match(shell, /role=\{sheetOpen \? "dialog" : undefined\}\s*aria-modal=\{sheetOpen \? true : undefined\}\s*aria-labelledby=\{sheetOpen \? headingId : undefined\}/u);
  assert.equal(count(shell, /inert=\{sheetOpen\}/gu), 4, "skip link, phone top row, content and tab bar are inert under the sheet");
  assert.match(shell, /if \(event\.key === "Escape"\) \{\s*event\.preventDefault\(\);\s*closeSheet\(true\);/u);
  assert.match(shell, /trapFocusIndex\(focusables\.length, focusables\.indexOf\(document\.activeElement as HTMLElement\), event\.shiftKey\)/u);
  assert.match(shell, /closeRef\.current\?\.focus\(\);/u, "focus moves into the sheet");
  assert.match(shell, /returnFocus\.current = false;\s*moreRef\.current\?\.focus\(\);/u, "focus returns to «Ещё»");
  assert.match(shell, /onClick=\{\(\) => closeSheet\(true\)\}/u, "«Закрыть» returns focus too");
  // Любой переход закрывает лист; «Назад» на тот же адрес его не открывает.
  assert.match(shell, /if \(sheetAt !== null && sheetAt !== address\) setSheetAt\(null\);/u);
  // Лист и меню — одна разметка: уведомления опрашиваются один раз.
  assert.equal(count(shell, /<StaffNotifications /gu), 1);
});

test("phone chrome and window-height pages share rem units, so the composer stays above the tab bar", () => {
  const css = read("src/app/(v3)/v3.css");
  assert.match(css, /@media \(width < 48rem\) \{\s*\.v3-world\[data-look="next"\] \{\s*--shell-top: 3\.5rem;\s*--shell-tabbar: 3\.5rem;\s*--shell-safe-bottom: env\(safe-area-inset-bottom, 0px\);/u);
  assert.match(css, /\.v3-world\[data-look="next"\] \[data-shell-content\] main:is\(\.h-dvh, \[class\*="100dvh"\]\) \{\s*height: calc\(100dvh - var\(--shell-top\) - var\(--shell-tabbar\) - var\(--shell-safe-bottom\)\);/u);
  const shell = read("src/components/v3/AppShellNext.tsx");
  assert.match(shell, /flex h-\[var\(--shell-top\)\] shrink-0/u, "top row height is the variable");
  assert.match(shell, /grid h-\[var\(--shell-tabbar\)\]/u, "tab bar height is the variable");
  assert.match(shell, /max-md:pb-\[calc\(var\(--shell-tabbar\)\+var\(--shell-safe-bottom\)\)\]/u, "content clears the tab bar");
  // Все три страницы «на окно» попадают под правило.
  assert.match(read("src/app/(v3)/v3/messages/page.tsx"), /<main className="[^"]*100dvh[^"]*" aria-label="Сообщения">/u);
  assert.match(read("src/app/(v3)/v3/team-chat/page.tsx"), /<main className="[^"]*100dvh[^"]*" aria-label="Командный чат">/u);
  assert.match(read("src/components/v3/PartShell.tsx"), /fill \? "flex h-dvh flex-col py-6"/u);
  assert.match(read("src/app/(v3)/v3/inbox/page.tsx"), /<PartShell title="WhatsApp" count=\{view\.conversations\.length\} fill>/u);
  // Движение листа выключает prefers-reduced-motion; строка и панель вкладок листа стоят на месте.
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.v3-world\[data-look="next"\] \[data-shell-menu\]\[data-sheet-open\] > \[data-shell-menu-body\] \{\s*animation: v3-shell-sheet-in 180ms/u);
});

test("without a top bar every page title starts at one height, level with the logo row", () => {
  const css = read("src/app/(v3)/v3.css");
  assert.match(css, /\.v3-world\[data-look="next"\] \{[^}]*--shell-page-top: 1\.5rem;/u);
  assert.match(css, /@media \(width < 48rem\) \{\s*\.v3-world\[data-look="next"\] \{[^}]*--shell-page-top: 1\.25rem;/u);
  // PageHeader страниц (PartShell, доски, WhatsApp) и заголовок «Сообщений» в шапке списка.
  assert.match(css, /\[data-shell-content\] main:has\(> div:first-child > div:first-child > h1\.t-page-title\) \{\s*padding-top: var\(--shell-page-top\);/u);
  assert.match(css, /main\[aria-label="Сообщения"\] h1\.t-page-title \{\s*margin-top: calc\(var\(--shell-page-top\) - 0\.8125rem\);/u);
  assert.match(read("src/components/ui.tsx"), /<div className="flex flex-wrap items-start justify-between gap-4">\s*<div className="min-w-0">\s*<h1 className="t-page-title/u, "PageHeader keeps the structure the rule reads");
  assert.match(read("src/components/v3/case-chat/CaseChatThread.tsx"), /<div className="border-b border-border p-3">\s*<h1 className="t-page-title mb-2 text-fg">Сообщения<\/h1>/u);
  // Логотип: `pt-3.5` + 51 px высоты — центр на 40 px, как у заголовка 24 + 32/2.
  assert.match(read("src/components/v3/AppShellNext.tsx"), /"hidden shrink-0 px-5 pb-4 pt-3\.5 md:flex"/u);
});

test("a menu list longer than the window shows a shadow at the clipped edge", () => {
  const css = read("src/app/(v3)/v3.css");
  assert.match(css, /\[data-shell-scroll\]\[data-more-below\] \{\s*box-shadow: inset 0 -8px 8px -6px/u);
  assert.match(css, /\[data-shell-scroll\]\[data-more-above\] \{\s*box-shadow: inset 0 8px 8px -6px/u);
  const shell = read("src/components/v3/AppShellNext.tsx");
  assert.match(shell, /data-more-above=\{edges\.above \? "" : undefined\}\s*data-more-below=\{edges\.below \? "" : undefined\}/u);
  assert.match(shell, /const below = scroller\.scrollTop \+ scroller\.clientHeight < scroller\.scrollHeight - 1;/u);
  assert.match(shell, /observer\.observe\(scroller\);\s*observer\.observe\(content\);/u, "recomputed when a group opens or the window changes");
});

test("the new look is chosen once by the layout and the current AppShell stays the default", () => {
  const layout = read("src/app/(v3)/layout.tsx");
  assert.match(layout, /look=\{lookPreview \? "next" : undefined\}/u);
  const appShell = read("src/components/v3/AppShell.tsx");
  assert.match(appShell, /return look === "next" \? <AppShellNext \{\.\.\.props\} \/> : <CurrentAppShell \{\.\.\.props\} \/>;/u);
  // Колокольчик прежнего облика остаётся в панели, без верхнего слоя.
  const notifications = read("src/components/v3/StaffNotifications.tsx");
  assert.match(notifications, /variant = "bar"/u);
  assert.match(notifications, /popover=\{menu \? "manual" : undefined\}/u);
});
