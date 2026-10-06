import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { staffCanAccessRoute } from "../src/lib/platform-access.ts";
import { buildV3Navigation } from "../src/lib/v3/navigation.ts";
import {
  GROUP_ICONS,
  LINK_ICONS,
  SHELL_TAB_SLOTS,
  shellTabLabel,
  shellTabs,
  toggleMenuGroup,
  trapFocusIndex,
  visibleNavigationLinks,
} from "../src/lib/v3/shell-tabs.ts";

/**
 * Э1.2 плана редизайна (25.09.2026): оболочка staff CRM — меню без верхней
 * панели, нижняя панель телефона и лист «Ещё» (AppShell.tsx); с Э1.5
 * (решение владельца 27.09) — единственная оболочка для всех. Живые снимки,
 * фокус листа, поле ответа над панелью и «Выйти» на 1280×800 меряет
 * tests/e2e/shell-static-render.cjs --screenshots; здесь — правила мест,
 * разметка оболочки и семантика листа.
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

test("tab slots per role follow the owner's order: admissions and Admin — Студенты · Задачи · Переписка, sales — Воронка · Заявки · Задачи", () => {
  // 27.09.2026 (owner decision): «Переписка» (its short name since 28.09.2026)
  // stands where «Переписки» of Э5 stood; the sales WhatsApp takes no slot of its own.
  // Slots follow destinations, not groups: «Заявки» moving from «Общее» to
  // «Продажи» (owner decision 28.09.2026) changes no slot.
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
  assert.deepEqual(shellTabs(nav("admin")).links.map((link) => link.label), ["Сегодня", "Студенты", "Задачи", "Переписка"]);
  assert.deepEqual(shellTabs(nav("sales-staff")).links.map((link) => link.label), ["Сегодня", "Воронка продаж", "Заявки", "Задачи"]);
  // WhatsApp does not make a sales role an admissions one; its four slots are
  // taken, so WhatsApp lives in «Ещё», which lights up on its page.
  assert.equal(shellTabs(nav("sales-staff")).kind, "sales");
  for (const who of ["sales-staff", "admin-preview-sales", "admin"]) {
    const onWhatsApp = shellTabs(nav(who, "/v3/inbox"));
    assert.equal(nav(who, "/v3/inbox").activeId, "inbox", who);
    assert.equal(onWhatsApp.currentInMore, true, `${who}: WhatsApp is in «Ещё»`);
  }
  // The student chat highlights its own tab.
  assert.equal(shellTabs(nav("admissions-staff", "/v3/messages?queue=all")).currentInMore, false);
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

test("every menu item has an icon from the existing set", () => {
  const icons = read("src/components/icons.tsx");
  for (const name of [...Object.values(LINK_ICONS), ...Object.values(GROUP_ICONS)]) {
    assert.match(icons, new RegExp(`\\| "${name}"`, "u"), name);
  }
  for (const who of Object.keys(ACTORS)) {
    for (const link of visibleNavigationLinks(nav(who))) assert.ok(LINK_ICONS[link.id], link.id);
    for (const group of nav(who).groups) assert.ok(GROUP_ICONS[group.id], group.id);
  }
  // «Сегодня» (Э3) — «солнце»; меню, вкладки и Ctrl+K берут знаки из одной таблицы.
  assert.equal(LINK_ICONS.home, "sun");
  assert.match(read("src/components/v3/AppShell.tsx"), /<Icon name=\{LINK_ICONS\[link\.id\]\} size=\{20\}/u);
  assert.match(read("src/components/v3/palette/CommandPalette.tsx"), /icon: LINK_ICONS\[destination\.id as V3NavigationLinkId\]/u);
});

test("icons tell the rail items apart: one glyph per meaning, three conversation items with three glyphs", () => {
  // Обе воронки — один смысл, один знак; всё остальное — свой знак у каждого пункта.
  const byIcon = new Map();
  for (const [id, icon] of Object.entries(LINK_ICONS)) byIcon.set(icon, [...(byIcon.get(icon) ?? []), id]);
  for (const [icon, ids] of byIcon) {
    if (icon === "funnel") assert.deepEqual(ids, ["pipeline", "admissions-pipeline"]);
    else assert.equal(ids.length, 1, `${icon} is shared by ${ids.join(", ")}`);
  }
  // 27.09.2026: «Переписка» поступления — квадратный пузырь, WhatsApp — круглый
  // (его собственная форма), «Командный чат» — два пузыря.
  assert.equal(LINK_ICONS.messages, "message-square");
  assert.equal(LINK_ICONS.inbox, "message-circle");
  assert.notEqual(LINK_ICONS.inbox, "phone", "conversations, not a call");
  assert.notEqual(LINK_ICONS["reply-snippets"], "send", "templates are text, not a send action");
  assert.deepEqual(new Set([LINK_ICONS.messages, LINK_ICONS.inbox, LINK_ICONS["team-chat"]]).size, 3);
  // Групп и «Ещё» это тоже касается: их знаки не совпадают с пунктами.
  for (const icon of [...Object.values(GROUP_ICONS), "menu"]) assert.ok(!byIcon.has(icon), icon);
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
  assert.deepEqual(shellTabs(nav("sales-staff")).links.map((link) => shellTabLabel(link).text), ["Сегодня", "Воронка", "Заявки", "Задачи"]);
  assert.deepEqual(shellTabs(nav("admin")).links.map((link) => shellTabLabel(link).text), ["Сегодня", "Студенты", "Задачи", "Переписка"]);
  assert.equal(shellTabLabel({ id: "pipeline", label: "Воронка продаж" }).name, "Воронка продаж");
  // Owner decision 28.09.2026: the menu item itself is «Переписка» — the tab
  // needs no short label and no separate accessible name.
  assert.deepEqual(shellTabLabel({ id: "messages", label: "Переписка" }), { text: "Переписка", name: undefined });
  assert.deepEqual(shellTabLabel({ id: "inbox", label: "WhatsApp" }), { text: "WhatsApp", name: undefined });
});

test("menu groups open one at a time, except the group that holds the current page", () => {
  assert.deepEqual(toggleMenuGroup([], "sales", []), ["sales"]);
  assert.deepEqual(toggleMenuGroup(["sales"], "admissions", []), ["admissions"], "opening one closes the other");
  assert.deepEqual(toggleMenuGroup(["admissions"], "sales", ["admissions"]), ["admissions", "sales"], "the current page's group stays open");
  assert.deepEqual(toggleMenuGroup(["admissions", "sales"], "sales", ["admissions"]), ["admissions"], "a second press closes it");
  assert.deepEqual(toggleMenuGroup(["admissions"], "admissions", ["admissions"]), [], "the current group can be closed by hand");
  const shell = read("src/components/v3/AppShell.tsx");
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

// --- разметка оболочки (tests/e2e/shell-static-render.cjs --json) --------------
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
  admin: ["Сегодня", "Студенты", "Задачи", "Переписка"],
  admissions: ["Сегодня", "Студенты", "Задачи", "Переписка"],
  "admissions-staff": ["Сегодня", "Студенты", "Задачи", "Переписка"],
  sales: ["Сегодня", "Воронка", "Заявки", "Задачи"],
};
function tabbar(html) {
  const start = html.indexOf('<nav aria-label="Быстрые разделы"');
  assert.ok(start >= 0, "tab bar");
  return html.slice(start, html.indexOf("</nav>", start));
}

test("one shell: no top bar; menu holds create, bell, preview exit and account; phone tab bar per role with «Ещё»", () => {
  assert.equal(surfaces.length, 20);
  for (const { name, role, pathname, html } of surfaces) {
    assert.doesNotMatch(html, /data-shell-look|data-look/u, `${name}: no look switch`);
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
    else {
      // «Переписка» (28.09.2026): the label is the full name, so no aria-label.
      assert.match(bar, /<a [^>]*data-shell-tab="messages"[^>]*>(?:(?!<\/a>).)*<span class="t-caption whitespace-nowrap">Переписка<\/span><\/a>/u, `${name}: «Переписка» tab`);
      assert.doesNotMatch(bar, /<a (?=[^>]*data-shell-tab="messages")[^>]*aria-label=/u, `${name}: the visible label is the accessible name`);
    }
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
  // Рейка на досках до 1536 px (решение владельца 25.09).
  assert.match(surface("board-admin"), /data-shell-layout="board"/u);
  assert.match(surface("board-admin"), /md:w-16 2xl:w-\[260px\]/u);
  assert.match(surface("home-admin"), /md:w-\[260px\]/u);
});

// Решение владельца 28.09.2026: «Заявки» — первыми в «Продажах», а не в
// «Общем». Меню компьютера и лист «Ещё» — одна разметка (MenuLists), поэтому
// её проверка — проверка обоих. Места нижней панели выбираются по разделам и
// не меняются (EXPECTED_TABS выше).
const MENU_BY_ROLE = {
  admin: { sales: ["/v3/requests", "/v3/pipeline", "/v3/inbox", "/v3/main?view=sales"], common: ["/v3/tasks", "/v3/team-chat", "/v3/calendar", "/v3/knowledge"] },
  // Просмотр «Приёмной»: у фиксированной роли нет sales.read — ни доски, ни «Заявок», как и раньше;
  // WhatsApp у неё с 06.10.2026 («нет, все могут»): единственный пункт «Продаж».
  admissions: { sales: ["/v3/inbox"], common: ["/v3/tasks", "/v3/team-chat", "/v3/calendar", "/v3/documents", "/v3/reply-snippets"] },
  // Куратор с lead.read: правило D скрывает доску, «Заявки» и «Отчёт продаж» остаются, а WhatsApp с 06.10.2026 виден (communication.read.full).
  "admissions-staff": { sales: ["/v3/requests", "/v3/inbox", "/v3/main?view=sales"], common: ["/v3/tasks", "/v3/team-chat", "/v3/calendar", "/v3/documents", "/v3/reply-snippets"] },
  sales: { sales: ["/v3/requests", "/v3/pipeline", "/v3/inbox", "/v3/main?view=sales"], common: ["/v3/tasks", "/v3/team-chat", "/v3/calendar", "/v3/reply-snippets"] },
};
function menuOf(html) {
  const list = html.slice(html.indexOf('<ul aria-label="Навигация по разделам"'), html.indexOf('<section aria-label="Общее"'));
  const hrefs = (part) => [...part.matchAll(/href="(\/v3\/[^"]*)"/gu)].map((match) => match[1]);
  // Раскрывающийся список отдела; в рейке досок те же пункты ещё и в списке верхнего слоя.
  const group = (label) => {
    const start = list.indexOf(`<span class="min-w-0 flex-1">${label}</span>`);
    if (start < 0) return null;
    const items = list.slice(start).match(/<ul id="[^"]+"[^>]*class="ms-3[^"]*">([\s\S]*?)<\/ul>/u)?.[1] ?? assert.fail(label);
    const rail = list.slice(start).match(new RegExp(`^[\\s\\S]*?</button>(?:<button [^>]*>[\\s\\S]*?</button><div [^>]*role="group" aria-label="${label}"[^>]*>[\\s\\S]*?<ul [^>]*>([\\s\\S]*?)</ul>)?`, "u"))?.[1];
    if (rail !== undefined) assert.deepEqual(hrefs(rail), hrefs(items), `${label}: rail list`);
    return hrefs(items);
  };
  const common = html.match(/<section aria-label="Общее"[\s\S]*?<\/section>/u)?.[0] ?? "";
  return { sales: group("Продажи"), common: hrefs(common), rail: /role="group" aria-label="Продажи"/u.test(list) };
}

test("menu per role: «Заявки» lead «Продажи» wherever the role may open them, «Общее» starts with «Задачи»", () => {
  for (const { name, role, html } of surfaces) {
    const { rail, ...menu } = menuOf(html);
    assert.deepEqual(menu, MENU_BY_ROLE[role], name);
    const everyMenuLink = html.slice(html.indexOf('<ul aria-label="Навигация по разделам"'), html.indexOf("</section>", html.indexOf('<section aria-label="Общее"')));
    const lists = rail ? 2 : 1;
    assert.equal(count(everyMenuLink, /href="\/v3\/requests"/gu), menu.sales?.includes("/v3/requests") ? lists : 0, `${name}: «Заявки» stand once in the menu`);
  }
  // Рейка досок ниже 1536 px показывает те же пункты отдела в верхнем слое.
  assert.ok(menuOf(surface("board-admin")).rail, "board surfaces render the rail list");
});

test("the sheet is a modal dialog while open: inert page, Escape and «Закрыть» return focus to «Ещё», focus trapped", () => {
  const shell = read("src/components/v3/AppShell.tsx");
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
  assert.match(css, /@media \(width < 48rem\) \{\s*\.v3-world\[data-surface="staff"\] \{\s*--shell-top: 3\.5rem;\s*--shell-tabbar: 3\.5rem;\s*--shell-safe-bottom: env\(safe-area-inset-bottom, 0px\);/u);
  assert.match(css, /\.v3-world\[data-surface="staff"\] \[data-shell-content\] main:is\(\.h-dvh, \[class\*="100dvh"\]\) \{\s*height: calc\(100dvh - var\(--shell-top\) - var\(--shell-tabbar\) - var\(--shell-safe-bottom\)\);/u);
  const shell = read("src/components/v3/AppShell.tsx");
  assert.match(shell, /flex h-\[var\(--shell-top\)\] shrink-0/u, "top row height is the variable");
  assert.match(shell, /grid h-\[var\(--shell-tabbar\)\]/u, "tab bar height is the variable");
  assert.match(shell, /max-md:pb-\[calc\(var\(--shell-tabbar\)\+var\(--shell-safe-bottom\)\)\]/u, "content clears the tab bar");
  // «Переписка» и «Командный чат» — страницы «на окно» под правилом.
  const conversations = read("src/components/v3/ConversationsMain.tsx");
  assert.match(conversations, /className="[^"]*h-\[calc\(100dvh-150px\)\] md:h-\[calc\(100dvh-64px\)\]"/u);
  assert.match(read("src/app/(v3)/v3/messages/page.tsx"), /<ConversationsMain title=\{TITLE\} threadOpen=\{rawCase !== null\}>/u);
  assert.match(read("src/app/(v3)/v3/team-chat/page.tsx"), /<main className="[^"]*100dvh[^"]*" aria-label="Командный чат">/u);
  // WhatsApp (PartShell `fill`, отдельная страница «Продаж») своей высоты не
  // задаёт: от 768 px её даёт колонка оболочки по `isFillRoute`.
  assert.match(read("src/components/v3/PartShell.tsx"), /fill \? "flex flex-col py-6 md:min-h-0 md:flex-1"/u);
  assert.match(read("src/app/(v3)/v3/inbox/page.tsx"), /<PartShell title="WhatsApp" count=\{notConnected \? null : view\.conversations\.length\} fill>/u);
  assert.match(shell, /const fill = isFillRoute\(pathname\);/u);
  assert.match(shell, /fill && "md:flex md:h-dvh md:flex-col"/u, "the content column is window-high on fill routes");
  assert.match(shell, /fill && "md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto"/u);
  assert.doesNotMatch(shell, /board && "md:flex md:h-dvh/u, "not only boards");
  // Движение листа выключает prefers-reduced-motion; строка и панель вкладок листа стоят на месте.
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.v3-world\[data-surface="staff"\] \[data-shell-menu\]\[data-sheet-open\] > \[data-shell-menu-body\] \{\s*animation: v3-shell-sheet-in 180ms/u);
});

test("without a top bar every page title starts at one height, level with the logo row", () => {
  const css = read("src/app/(v3)/v3.css");
  assert.match(css, /\.v3-world\[data-surface="staff"\] \{[^}]*--shell-page-top: 1\.5rem;/u);
  assert.match(css, /@media \(width < 48rem\) \{\s*\.v3-world\[data-surface="staff"\] \{[^}]*--shell-page-top: 1\.25rem;/u);
  // PageHeader страниц (PartShell, доски, «Переписка»): Э5 вынес
  // заголовок переписки по делу из шапки списка в PageHeader страницы, и
  // отдельный сдвиг заголовка «Сообщений» не нужен.
  assert.match(css, /\[data-shell-content\] main:has\(> div:first-child > div:first-child > h1\.t-page-title\) \{\s*padding-top: var\(--shell-page-top\);/u);
  assert.doesNotMatch(css, /main\[aria-label="Сообщения"\]/u);
  assert.match(read("src/components/ui.tsx"), /<div className=\{cn\("flex flex-wrap items-start justify-between gap-4", className\)\}>\s*<div className="min-w-0">\s*<h1 className="t-page-title/u, "PageHeader keeps the structure the rule reads");
  // «Переписка»: PageHeader — первый ребёнок `main` (правило выше его находит).
  assert.match(read("src/components/v3/ConversationsMain.tsx"), /md:h-\[calc\(100dvh-64px\)\]"\s*>\s*<PageHeader title=\{title\} className=/u);
  assert.doesNotMatch(read("src/components/v3/case-chat/CaseChatThread.tsx"), /<h1\b/u);
  // Логотип: `pt-3.5` + 51 px высоты — центр на 40 px, как у заголовка 24 + 32/2.
  assert.match(read("src/components/v3/AppShell.tsx"), /"hidden shrink-0 px-5 pb-4 pt-3\.5 md:flex"/u);
});

test("a menu list longer than the window shows a cue at the clipped edge", () => {
  const css = read("src/app/(v3)/v3.css");
  // Э6 (27.09.2026): below — the last visible items fade into the menu and the
  // account row carries a shadow; above — the inset shadow as before.
  assert.match(css, /\.v3-world \[data-shell-scroll\]\[data-more-below\]::after \{[^}]*position: sticky;[^}]*bottom: 0;[^}]*background: linear-gradient\(to bottom, transparent, color-mix\(in srgb, var\(--surface\) 75%, transparent\)\);[^}]*pointer-events: none;/u);
  assert.match(css, /\[data-shell-scroll\]\[data-more-below\] \+ \[data-shell-account\] \{[^}]*box-shadow: 0 -6px 10px -6px/u);
  assert.match(css, /\[data-shell-scroll\]\[data-more-above\] \{\s*box-shadow: inset 0 8px 8px -6px/u);
  const shell = read("src/components/v3/AppShell.tsx");
  assert.match(shell, /data-more-above=\{edges\.above \? "" : undefined\}\s*data-more-below=\{edges\.below \? "" : undefined\}/u);
  assert.match(shell, /const below = scroller\.scrollTop \+ scroller\.clientHeight < scroller\.scrollHeight - 1;/u);
  assert.match(shell, /observer\.observe\(scroller\);\s*observer\.observe\(content\);/u, "recomputed when a group opens or the window changes");
  assert.match(shell, /const edges = useScrollEdges\(scrollRef, listRef\);/u);
});

test("one shell for every staff member: the layout has no look switch, the old shell and the bar bell are gone", () => {
  const layout = read("src/app/(v3)/layout.tsx");
  assert.match(layout, /<div className="v3-world" data-surface="staff">\s*<AppShell actor=\{actor\} initialNotifications=\{notifications\}>/u);
  assert.doesNotMatch(layout, /look/iu, "no look is read or passed");
  assert.equal(existsSync(new URL("../src/components/v3/AppShellNext.tsx", import.meta.url)), false, "one shell file");
  const appShell = read("src/components/v3/AppShell.tsx");
  assert.match(appShell, /export function AppShell\(\{\s*children,\s*actor,\s*initialNotifications,\s*\}/u);
  assert.doesNotMatch(appShell, /CurrentAppShell|AppShellNext|look|md:min-h-16|Открыть навигацию/u, "no second shell and no top bar");
  // Колокольчик — один вид: кнопка меню с панелью в верхнем слое.
  const notifications = read("src/components/v3/StaffNotifications.tsx");
  assert.doesNotMatch(notifications, /variant|"bar"/u);
  assert.match(notifications, /ref=\{panelRef\} popover="manual"/u);
});
