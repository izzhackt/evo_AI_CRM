import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  canAdminSelectEffectiveRole,
  fixedRoleCanAccessRoute,
} from "../src/lib/fixed-role-policy.ts";
import { buildV3Navigation, v3SectionTitle } from "../src/lib/v3/navigation.ts";
import { admissionsDirectoryHref, withDocsSection } from "../src/components/staff/profile/admissions-view.ts";

function navigation(role, href = "/main") {
  const url = new URL(href, "https://navigation.test");
  return buildV3Navigation({ systemRole: "admin", presentationRole: role === "admin" ? null : role, platformAccessVersion: 1, assignments: [], permissionKeys: [] }, url.pathname, url.searchParams);
}

function links(model) {
  return [
    ...(model.home ? [model.home] : []),
    ...model.groups.flatMap((group) => group.links),
    ...model.sections,
    ...model.common,
    ...(model.settings ? [model.settings] : []),
  ];
}

// «Заявки» (unified-workflow S1) is sales.read-gated, so it joins admin/sales
// at the FRONT of the Продажи group (plan §3 order: Заявки, WhatsApp,
// Воронка продаж, Отчёт продаж) and never reaches the admissions preview,
// which lacks sales.read entirely — its list is unchanged from before this slice.
// OTH-1: «Воронка поступления» (id admissions-pipeline, /admissions-pipeline) is the
// FIRST item of the Поступление group (owner plan) — inserted right after
// "home"/"sales-report" and before "admissions-worklist" for admin and
// admissions; Sales never sees it (no admissions.read, matching the group's
// existing admissions-worklist/universities-only visibility for that role).
// Owner decision 27.09.2026 (replaces the one common «Переписки» item of Э5):
// «WhatsApp» (id inbox, /inbox, messaging.read) is the sales WhatsApp where
// leads arrive and stands in «Продажи» right after the sales board;
// «Переписка» (id messages, /messages, admissions.read; «Переписка со
// студентами» until the owner decision 28.09.2026 shortened it to one menu
// line) is the cabinet chat with existing students and stands in
// «Поступление» right after the admissions board. Each page stands alone.
// Э6 (27.09.2026): every destination has one place for all roles — roles only
// hide items. Owner decision 28.09.2026 («Переносить «Заявки» из «Общего» в
// «Продажи»? Да»): «Заявки» lead «Продажи» for every role that may open them
// (they stood first in «Общее» from Э6 until then); WhatsApp still follows the
// board (owner decision 27.09.2026). Rights are unchanged: the item is shown
// exactly when /requests is open.
// Owner decision 06.10.2026 («нет, все могут»: every employee answers WhatsApp
// from the CRM) supersedes the 27.09 rule that the admissions role has no
// WhatsApp item: «WhatsApp» is shown exactly when /inbox is open
// (messaging.read), so the admissions preview now lists it right after «Сегодня»
// as the only item of «Продажи» it has.
// «ИИ-агент» (plan of the AI agent §12.2, owner Q9 «нет, все могут»): one item
// in «Общее» for every role, after «База знаний» — the route needs ai.agent.use,
// which every staff role gets (268); a preview shows it for every fixed role.
// Owner decision 26.10.2026: «Маркетинг» and «Финансы» are top-level sections of
// their own (id `marketing`/`finance`, `model.sections`) right after
// «Поступление» and before «Общее»; real Admin only, never a role preview.
const expectedRoleLinks = {
  admin: ["home", "requests", "pipeline", "inbox", "admissions-pipeline", "messages", "admissions-worklist", "evo-docs", "universities", "marketing", "finance", "tasks", "team-chat", "calendar", "knowledge", "ai-agents", "settings"],
  sales: ["home", "requests", "pipeline", "inbox", "sales-dynamics", "admissions-worklist", "universities", "tasks", "team-chat", "reply-snippets", "ai-agents"],
  admissions: ["home", "inbox", "admissions-pipeline", "messages", "admissions-worklist", "evo-docs", "universities", "tasks", "team-chat", "calendar", "documents", "reply-snippets", "ai-agents"],
};

for (const role of ["admin", "sales", "admissions"]) {
  test(`${role} preview sees its presentation destinations`, () => {
    const model = navigation(role);
    assert.deepEqual(links(model).map((link) => link.id), expectedRoleLinks[role]);
    assert.ok(links(model).every((link) => fixedRoleCanAccessRoute(role, link.route)));
    assert.ok(model.groups.every((group) => group.links.length > 0));
    // S6 (plan §3/§14) retired «Клиентские сообщения»; since 27.09.2026 no
    // conversation stands in «Общее»: each lives in its department. Since
    // 28.09.2026 «Заявки» are not there either: they lead «Продажи».
    assert.deepEqual(model.common.map((link) => link.label), role === "sales"
      ? ["Задачи", "Командный чат", "Шаблоны ответов", "ИИ-агенты"]
      : role === "admin" ? ["Задачи", "Командный чат", "Календарь", "База знаний", "ИИ-агенты"]
      : ["Задачи", "Командный чат", "Календарь", "Документы", "Шаблоны ответов", "ИИ-агенты"]);
    const every = links(model);
    assert.equal(every.find((link) => link.id === "inbox")?.href, "/inbox", `${role}: WhatsApp (06.10.2026)`);
    assert.equal(every.find((link) => link.id === "messages")?.href, role === "sales" ? undefined : "/messages");
  });

  test(`Admin presentation preview of ${role} follows that role, not Admin authority`, () => {
    assert.equal(canAdminSelectEffectiveRole("admin", role), true);
    const model = navigation(role, "/profile?section=summary");
    assert.deepEqual(links(model).map((link) => link.id), expectedRoleLinks[role]);
    assert.equal(Boolean(model.settings), role === "admin");
    // «Сводка по направлениям» merged into «Студенты» (2026-09-24): no role
    // has a separate summary item any more.
    assert.equal(links(model).some((link) => link.id === "admissions-summary"), false);
  });
}

test("the two disclosure groups use the approved destinations and worklist remains available to Sales", () => {
  const model = navigation("admin");
  // «Сегодня» (Э3, 26.09.2026): the start page of every role, same id and address.
  assert.equal(model.home?.label, "Сегодня");
  // «Заявки» lead «Продажи» (owner decision 28.09.2026; «Общее» since Э6
  // until then): incoming requests are triaged before a lead joins the board.
  // Each department then holds its board and its own conversations (owner
  // decision 27.09.2026): «Продажи» — WhatsApp, «Поступление» — «Переписка»
  // (short name, owner decision 28.09.2026: the long «Переписка со
  // студентами» wrapped to two lines). The two boards carry their department
  // in the label (UX quick win 2, 2026-09-24): an Admin sees both groups, and
  // two identical «Воронка» items were ambiguous.
  assert.deepEqual(model.groups.map((group) => [group.label, group.links.map((link) => [link.label, link.href])]), [
    ["Продажи", [["Заявки", "/requests"], ["Воронка продаж", "/pipeline"], ["WhatsApp", "/inbox"]]],
    ["Поступление", [["Воронка поступления", "/admissions-pipeline"], ["Переписка", "/messages"], ["Студенты", "/profile"], ["EVO Docs", "/profile?section=docs"], ["Университеты", "/universities"]]],
  ]);
  assert.deepEqual(navigation("sales").groups[1].links.map((link) => link.id), ["admissions-worklist", "universities"]);
  assert.deepEqual(navigation("admissions").groups.map((group) => group.id), ["sales", "admissions"]);
  assert.deepEqual(navigation("admissions").groups[0].links.map((link) => link.id), ["inbox"], "06.10.2026: WhatsApp is the admissions role's only «Продажи» item");
  assert.equal(model.settings?.href, "/settings");
});

/** Where a destination stands: a department group, a top-level section, «Общее», or the top/bottom of the menu. */
function placeOf(model, id) {
  if (model.home?.id === id) return "top";
  if (model.settings?.id === id) return "bottom";
  const group = model.groups.find((entry) => entry.links.some((link) => link.id === id));
  if (group) return group.id;
  if (model.sections.some((link) => link.id === id)) return "section";
  return model.common.some((link) => link.id === id) ? "common" : null;
}

test("Э6: every destination has one fixed place for all roles, and no role sees it twice", () => {
  const places = new Map();
  for (const role of ["admin", "sales", "admissions"]) {
    const model = navigation(role);
    const ids = links(model).map((link) => link.id);
    assert.equal(new Set(ids).size, ids.length, `${role}: no duplicate entries`);
    for (const id of ids) {
      const place = placeOf(model, id);
      if (places.has(id)) assert.equal(place, places.get(id), `${id}: ${role} moves it`);
      else places.set(id, place);
    }
  }
  // Owner decision 28.09.2026: «Заявки» moved from «Общее» to «Продажи».
  assert.equal(places.get("requests"), "sales");
  assert.equal(places.get("inbox"), "sales");
  assert.equal(places.get("messages"), "admissions");
  // «Продажи» and «Общее» keep one order for everyone: roles only drop items.
  const salesOrder = ["requests", "pipeline", "inbox", "sales-dynamics"];
  const order = ["tasks", "team-chat", "calendar", "documents", "reply-snippets", "knowledge", "ai-agents"];
  for (const role of ["admin", "sales", "admissions"]) {
    const model = navigation(role);
    const common = model.common.map((link) => link.id);
    assert.deepEqual(common, order.filter((id) => common.includes(id)), role);
    const sales = model.groups.find((group) => group.id === "sales")?.links.map((link) => link.id) ?? [];
    assert.deepEqual(sales, salesOrder.filter((id) => sales.includes(id)), role);
  }
});

test("«Заявки» highlight themselves and open «Продажи» with their filters (owner decision 28.09.2026)", () => {
  for (const role of ["admin", "sales"]) {
    for (const href of ["/requests", "/requests?status=all", "/requests?source=website&lead=record"]) {
      const model = navigation(role, href);
      assert.equal(model.activeId, "requests", `${role} ${href}`);
      assert.deepEqual(model.groups.filter((group) => group.active).map((group) => group.id), ["sales"], `${role} ${href}`);
      assert.equal(model.destinationKey, navigation(role, "/requests").destinationKey, `${role} ${href}`);
    }
  }
});

test("«Сегодня» and «Финансы» (with the sales report tab) are mutually exclusive, query-aware current links", () => {
  for (const role of ["admin", "sales"]) {
    // The old sales report address is gone from the menu: `/main` is «Сегодня» whatever its query says (the page redirects `?view=sales`).
    for (const href of ["/main", "/main?period=month", "/main?view=unknown", "/main?view=", "/main?view=sales", "/main?period=month&view=sales"]) {
      const model = navigation(role, href);
      // The «Dynamics» item exists only for a role without report records (a sales preview here); the Admin is redirected to «Финансы».
      const dynamics = role === "sales" && href.includes("view=sales");
      assert.equal(model.activeId, dynamics ? "sales-dynamics" : "home", href);
      if (dynamics) continue;
      assert.equal(model.groups.find((group) => group.id === "sales").active, false);
    }
    // «Финансы» is for the real Admin; a role preview never shows it (06.11.2026), so only the Admin has it here.
    for (const href of ["/finance", "/finance?tab=sales", "/finance?tab=sales&year=2026&month=9"]) {
      assert.equal(navigation(role, href).activeId, role === "admin" ? "finance" : null, `${role} ${href}`);
    }
  }
});

test("the former summary address lands on «Студенты» for every role", () => {
  // «Сводка по направлениям» is the facet column of «Студенты» since
  // 2026-09-24; old bookmarks keep working and highlight that page. Unusual
  // shapes (repeated or empty values, profile targets, directory filters)
  // stay on the same destination: none of them opens a separate summary.
  for (const role of ["admin", "sales", "admissions"]) {
    for (const href of [
      "/profile?section=summary", "/profile?section=summary&period=month#admissions-summary",
      "/profile", "/profile?section=", "/profile?section=unknown",
      "/profile?section=summary&section=summary", "/profile?section=summary&section=other",
      "/profile?case=record&section=summary",
      "/profile?case=&section=summary", "/profile?id=&section=summary",
      "/profile?case=record&tab=history", "/profile?query=test&state=closed",
    ]) {
      const model = navigation(role, href);
      assert.equal(model.activeId, "admissions-worklist", `${role} ${href}`);
      assert.equal(links(model).some((link) => link.label === "Сводка по направлениям"), false, `${role} ${href}`);
      assert.equal(model.destinationKey, navigation(role, "/profile").destinationKey, `${role} ${href}`);
      assert.equal(sectionTitle(href), "Студенты", `${role} ${href}`);
    }
  }
  assert.equal(v3SectionTitle("/profile", { section: "summary" }), "Студенты");
});

test("a lead card lives under «Воронка продаж» and names itself «Лид» in the tab", () => {
  // Audit 26.09: Lead 360 highlighted Поступление › Студенты and the tab read
  // «Студенты — EVO CRM». A case (`?case=`) stays «Студенты».
  for (const href of ["/profile?id=record", "/profile?id=record&tab=history", "/profile?id=record&section=summary",
    "/profile?id=record&returnTo=%2Fpipeline%3Fdue%3Dunscheduled"]) {
    for (const role of ["admin", "sales"]) {
      const model = navigation(role, href);
      assert.equal(model.activeId, "pipeline", `${role} ${href}`);
      assert.equal(model.groups.find((group) => group.id === "sales")?.active, true, `${role} ${href}`);
    }
    // Admissions has no sales board: it keeps its own section, never nothing.
    assert.equal(navigation("admissions", href).activeId, "admissions-worklist", href);
    assert.equal(sectionTitle(href), "Лид", href);
  }
  for (const href of ["/profile?case=record", "/profile?id=record&case=record", "/profile?id=&tab=overview",
    "/profile?id=a&id=b"]) {
    assert.equal(navigation("admin", href).activeId, "admissions-worklist", href);
    assert.equal(sectionTitle(href), "Студенты", href);
  }
  assert.equal(sectionTitle("/profile?id=record&section=docs"), "EVO Docs");
});

test("forbidden and unknown paths never mark an unrelated link current", () => {
  // /main is «Сегодня» for admissions too (Э3, 26.09.2026); only the sales
  // report view and sales-only routes stay outside that role's navigation.
  assert.equal(navigation("admissions", "/main").activeId, "home");
  // «Заявки» is sales.read-gated (unified workflow S1); admissions lacks that
  // capability entirely, so it never becomes this preview's active link.
  for (const href of ["/finance?tab=sales", "/pipeline", "/settings", "/requests"]) {
    assert.equal(navigation("admissions", href).activeId, null, href);
  }
  for (const href of ["/settings", "/calendar"]) {
    assert.equal(navigation("sales", href).activeId, null, href);
  }
  for (const role of ["admin", "sales", "admissions"]) {
    assert.equal(navigation(role, "/unknown").activeId, null);
  }
});

test("Docs keeps its own navigation context for directory and case routes", () => {
  for (const role of ["admin", "admissions"]) {
    for (const href of ["/profile?section=docs", "/profile?section=docs&direction=MY", "/profile?case=record&tab=anketa&section=docs", "/profile?case=record&tab=route&panel=packets&section=docs#partner-packets"]) {
      assert.equal(navigation(role, href).activeId, "evo-docs", href);
    }
    assert.equal(navigation(role, "/profile?section=docs&section=docs").activeId, "admissions-worklist");
  }
  assert.equal(navigation("sales", "/profile?section=docs").activeId, "admissions-worklist");
});

test("Docs presentation requires profile read authority and does not expose it to summary-only staff", () => {
  const actor = { systemRole: "staff", presentationRole: null, platformAccessVersion: 1, assignments: [], permissionKeys: ["lead.read", "case.read.summary"] };
  const url = new URL("https://navigation.test/profile?section=docs");
  assert.equal(links(buildV3Navigation(actor, url.pathname, url.searchParams)).some(link => link.id === "evo-docs"), false);
  assert.equal(links(buildV3Navigation({ ...actor, permissionKeys: ["case.read.full"] }, url.pathname, url.searchParams)).some(link => link.id === "evo-docs"), false);
  assert.equal(links(buildV3Navigation({ ...actor, permissionKeys: ["case.read.full", "profile.read.full"] }, url.pathname, url.searchParams)).some(link => link.id === "evo-docs"), true);
});

test("Docs links preserve filters, cursor, selected case, tab and ZIP anchor", () => {
  const params = { query: "Student", direction: "MY", state: "active", curatorMembershipId: "curator", attention: "awaiting_ack" };
  const cursor = { sortAt: "2026-09-18T00:00:00Z", id: "case" };
  const directory = new URL(admissionsDirectoryHref(params, cursor, true), "https://navigation.test");
  assert.equal(directory.searchParams.get("section"), "docs");
  assert.equal(directory.searchParams.get("case_q"), "Student");
  assert.equal(directory.searchParams.get("direction"), "MY");
  assert.equal(directory.searchParams.get("case_before_id"), "case");
  const zip = new URL(withDocsSection("/profile?case=case&tab=route&panel=packets#partner-packets", true), "https://navigation.test");
  assert.equal(zip.searchParams.get("case"), "case");
  assert.equal(zip.searchParams.get("tab"), "route");
  assert.equal(zip.searchParams.get("panel"), "packets");
  assert.equal(zip.searchParams.get("section"), "docs");
  assert.equal(zip.hash, "#partner-packets");
  assert.equal(withDocsSection("/profile?tab=anketa", false), "/profile?tab=anketa");
});

test("university details keep the catalogue and Admissions section active", () => {
  for (const role of ["admin", "sales", "admissions"]) {
    const model = navigation(role, "/universities/57ce9b97-43fb-4563-9c61-b8c6cf901a7b");
    assert.equal(model.activeId, "universities");
    assert.equal(model.groups.find((group) => group.id === "admissions").active, true);
  }
});

test("each visible destination marks exactly one link and only its own disclosure active", () => {
  for (const role of ["admin", "sales", "admissions"]) {
    for (const link of links(navigation(role))) {
      const model = navigation(role, link.href);
      assert.equal(model.activeId, link.id);
      assert.equal(links(model).filter((item) => item.id === model.activeId).length, 1);
      assert.deepEqual(model.groups.filter((group) => group.active).map((group) => group.id),
        model.groups.filter((group) => group.links.some((item) => item.id === link.id)).map((group) => group.id));
    }
  }
});

test("destination keys preserve disclosure identity through filters and client detail transitions", () => {
  const destinations = [
    ["finance", ["/finance", "/finance?tab=sales", "/finance?tab=sales&year=2026&month=9&q=Name&offset=30&review=true", "/finance?tab=debts"]],
    ["calendar", ["/calendar", "/calendar?view=month&date=2026-09-01", "/calendar?date=2026-10-01&view=week"]],
    ["admissions-worklist", ["/profile", "/profile?case=record&tab=route", "/profile?section=summary&case=", "/profile?section=summary&id="]],
    // The board and a lead card opened from it keep the same sidebar identity.
    ["pipeline", ["/pipeline", "/pipeline?due=unscheduled&lead=record", "/profile?id=record&query=updated"]],
    ["evo-docs", ["/profile?section=docs", "/profile?case=record&section=docs&tab=anketa"]],
    ["universities", ["/universities", "/universities?country=MY&level=bachelor", "/universities/57ce9b97-43fb-4563-9c61-b8c6cf901a7b"]],
  ];
  for (const [activeId, hrefs] of destinations) {
    const first = navigation("admin", hrefs[0]);
    for (const href of hrefs) {
      const current = navigation("admin", href);
      assert.equal(current.activeId, activeId, href);
      assert.equal(current.destinationKey, first.destinationKey, href);
    }
  }
});

test("different authorized destinations reset identity and malformed queries retain existing classification", () => {
  const destinations = ["/main", "/finance?tab=sales", "/profile", "/profile?section=docs", "/pipeline"];
  assert.equal(new Set(destinations.map((href) => navigation("admin", href).destinationKey)).size, destinations.length);
  for (const href of ["/main?view=unknown", "/main?view=sales"]) {
    assert.equal(navigation("admin", href).destinationKey, navigation("admin", "/main").destinationKey);
  }
  assert.equal(navigation("admin", "/profile?section=docs&section=docs").destinationKey, navigation("admin", "/profile").destinationKey);
});

test("unknown destinations keep pathname identity without activating an unavailable link", () => {
  const first = navigation("admin", "/unknown");
  assert.equal(first.activeId, null);
  assert.equal(navigation("admin", "/unknown?q=changed").destinationKey, first.destinationKey);
  assert.notEqual(navigation("admin", "/another-unknown").destinationKey, first.destinationKey);

  const actor = { systemRole: "staff", presentationRole: null, platformAccessVersion: 1, assignments: [], permissionKeys: ["sales.register.read"] };
  const staffNavigation = (href) => {
    const url = new URL(href, "https://navigation.test");
    return buildV3Navigation(actor, url.pathname, url.searchParams);
  };
  const report = staffNavigation("/finance?tab=sales");
  assert.equal(report.activeId, "finance", "the sales report is a tab of «Финансы» (06.11.2026)");
  assert.equal(staffNavigation("/finance?tab=sales&month=9").destinationKey, report.destinationKey);
  assert.deepEqual(links(report).map((link) => link.id), ["home", "finance"]);
  const denied = staffNavigation("/profile?section=summary");
  assert.equal(denied.activeId, null);
  assert.equal(staffNavigation("/profile?section=docs").destinationKey, denied.destinationKey);
  assert.notEqual(staffNavigation("/universities").destinationKey, denied.destinationKey);
  assert.notEqual(denied.destinationKey, report.destinationKey);
});

test("presentation role and access version changes reset the same destination", () => {
  const actor = { systemRole: "admin", presentationRole: null, platformAccessVersion: 1, assignments: [], permissionKeys: [] };
  const query = new URLSearchParams("period=month");
  const current = buildV3Navigation(actor, "/main", query);
  for (const changed of [{ ...actor, presentationRole: "sales" }, { ...actor, platformAccessVersion: 2 }]) {
    const next = buildV3Navigation(changed, "/main", query);
    assert.equal(next.activeId, current.activeId);
    assert.notEqual(next.destinationKey, current.destinationKey);
  }
  assert.equal(buildV3Navigation(actor, "/main", query).destinationKey, current.destinationKey);
});

// UX quick win 2 (2026-09-24, Impeccable clarify): one name per destination —
// sidebar item, page h1 and browser tab «<Раздел> — EVO CRM».
function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function searchRecord(url) {
  const record = {};
  for (const name of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(name);
    record[name] = values.length === 1 ? values[0] : values;
  }
  return record;
}

function sectionTitle(href) {
  const url = new URL(href, "https://navigation.test");
  return v3SectionTitle(url.pathname, searchRecord(url));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

test("every role sees each sidebar label once and both boards name their department", () => {
  for (const role of ["admin", "sales", "admissions"]) {
    const labels = links(navigation(role)).map((link) => link.label);
    assert.equal(new Set(labels).size, labels.length, `${role}: ${labels.join(", ")}`);
    for (const retired of ["Воронка", "Inbox", "Входящие", "Сообщения", "Переписки"]) assert.ok(!labels.includes(retired), `${role}: ${retired}`);
  }
  const admin = links(navigation("admin"));
  assert.equal(admin.find((link) => link.id === "pipeline")?.label, "Воронка продаж");
  assert.equal(admin.find((link) => link.id === "admissions-pipeline")?.label, "Воронка поступления");
  assert.equal(admin.find((link) => link.id === "inbox")?.label, "WhatsApp");
  assert.equal(admin.find((link) => link.id === "messages")?.label, "Переписка");
});

test("the browser tab names the sidebar item that the same address highlights", () => {
  for (const role of ["admin", "sales", "admissions"]) {
    for (const link of links(navigation(role))) assert.equal(sectionTitle(link.href), link.label, `${role} ${link.href}`);
  }
  for (const [href, title] of [
    ["/main?period=month", "Сегодня"],
    ["/finance?tab=sales&year=2026&month=9", "Финансы"],
    ["/profile?case=record&tab=route", "Студенты"],
    ["/profile?section=docs&section=docs", "Студенты"],
    ["/profile?case=record&tab=anketa&section=docs", "EVO Docs"],
    ["/profile?section=summary&period=month", "Студенты"],
    ["/universities/57ce9b97-43fb-4563-9c61-b8c6cf901a7b", "Университеты"],
    // The former board subpages redirect to EVO Docs; the address itself still names the board.
    ["/admissions-pipeline?view=documents", "Воронка поступления"],
    // 27.09.2026: each conversation page highlights its own item and names its own tab.
    ["/inbox", "WhatsApp"],
    ["/inbox?waiting=1", "WhatsApp"],
    ["/messages?queue=all", "Переписка"],
    ["/messages?case=record", "Переписка"],
  ]) {
    assert.equal(sectionTitle(href), title, href);
    const model = navigation("admin", href);
    assert.equal(links(model).find((link) => link.id === model.activeId)?.label, title, href);
  }
  // 06.11.2026: `/main?view=sales` is the «Динамика по дням» of a role without report records; for everyone else the page redirects to «Финансы».
  assert.equal(v3SectionTitle("/main", { view: "sales" }), "Динамика продаж");
  assert.equal(navigation("sales", "/main?view=sales").activeId, "sales-dynamics");
  assert.equal(navigation("admin", "/main?view=sales").activeId, "home", "the Admin has no such item");
  assert.equal(v3SectionTitle("/unknown"), undefined);
});

test("every staff page uses the one «<Раздел> — EVO CRM» tab pattern", () => {
  assert.match(source("src/app/(staff)/layout.tsx"), /title: \{ absolute: "EVO CRM", template: "%s — EVO CRM" \}/u);
  const redirectOnly = new Set(["src/app/(staff)/admissions-requests/page.tsx"]);
  const pages = readdirSync(new URL("../src/app/(staff)", import.meta.url), { recursive: true })
    .filter((file) => file.endsWith("page.tsx") || file === "not-found.tsx")
    .map((file) => `src/app/(staff)/${file}`);
  assert.ok(pages.length >= 20, pages.join(", "));
  for (const file of pages) {
    const page = source(file);
    if (redirectOnly.has(file)) {
      assert.match(page, /redirect\(/u, file);
      assert.doesNotMatch(page, /<PartShell|<main/u, file);
      continue;
    }
    const title = page.match(/export const metadata = \{ title: "([^"]+)" \};/u)?.[1];
    if (title === undefined) {
      // Страница агента называет в вкладке самого агента, но слово раздела берёт у меню, как карточка лида.
      const agentTab = /export async function generateMetadata\([\s\S]*?v3SectionTitle\(`\/ai-agents\/\$\{key\}`\)[\s\S]*?title: title \? `\$\{title\} — \$\{section\}` : section/u;
      assert.ok(
        /export async function generateMetadata\([\s\S]*?title: v3SectionTitle\("\/(?:main|profile)", await searchParams\)/u.test(page) || agentTab.test(page),
        file,
      );
      continue;
    }
    assert.doesNotMatch(title, /V3|EVO|·|\|/u, file);
    const route = file.match(/^src\/app\/\(staff\)(\/[^/]+)\//u)?.[1];
    // `access-denied` is not a menu section: its tab says «Нет доступа».
    if (route && route !== "/access-denied") assert.equal(title, v3SectionTitle(route), file);
  }
  assert.equal(v3SectionTitle("/ai-agents/director"), "ИИ-агенты", "the agent tab's section word is the sidebar item");
  const denied = source("src/app/(staff)/access-denied/page.tsx");
  for (const [, route, label] of denied.matchAll(/^  "(\/[^"]+)": "([^"]+)",$/gmu)) {
    assert.equal(label, v3SectionTitle(route), route);
  }
});

test("each sidebar destination opens under a heading with the same words", () => {
  const V3 = "src/app/(staff)";
  // [link id, file, every literal PartShell title in the file is that label] — «Университеты» ставят рамку `UniversityShell`
  // (та же `PartShell` у прежнего вида, рамка набора у «Нового вида»), тот же заголовок.
  const headings = [
    ["home", `${V3}/main/page.tsx`, true], ["home", `${V3}/main/loading.tsx`, true],
    ["requests", `${V3}/requests/page.tsx`, true], ["requests", `${V3}/requests/loading.tsx`, true],
    ["inbox", `${V3}/inbox/page.tsx`, true], ["inbox", `${V3}/inbox/loading.tsx`, true],
    ["pipeline", `${V3}/pipeline/page.tsx`, true], ["pipeline", `${V3}/pipeline/loading.tsx`, true],
    ["sales-dynamics", "src/components/staff/sales-next/SalesFramesNext.tsx", false],
    // Э8.5 (28.09): the board's review subpages are EVO Docs tabs — one heading again.
    ["admissions-pipeline", `${V3}/admissions-pipeline/page.tsx`, true],
    ["messages", `${V3}/messages/page.tsx`, true],
    ["admissions-worklist", `${V3}/profile/page.tsx`, false], ["admissions-worklist", `${V3}/profile/loading.tsx`, true],
    ["evo-docs", `${V3}/profile/page.tsx`, false],
    ["universities", `${V3}/universities/page.tsx`, true], ["universities", `${V3}/universities/loading.tsx`, true],
    ["tasks", `${V3}/tasks/page.tsx`, true], ["tasks", `${V3}/tasks/loading.tsx`, true],
    ["team-chat", `${V3}/team-chat/page.tsx`, true], ["team-chat", "src/components/staff/team-chat/TeamChat.tsx", false],
    ["calendar", `${V3}/calendar/page.tsx`, true], ["calendar", `${V3}/calendar/loading.tsx`, true],
    ["documents", `${V3}/documents/page.tsx`, true],
    ["reply-snippets", `${V3}/reply-snippets/page.tsx`, true],
    ["knowledge", `${V3}/knowledge/page.tsx`, true],
    ["marketing", `${V3}/marketing/page.tsx`, true],
    ["finance", `${V3}/finance/page.tsx`, true],
    ["ai-agents", `${V3}/ai-agents/page.tsx`, true],
    ["settings", `${V3}/settings/page.tsx`, true],
  ];
  const nextSources = () => {
    const walk = (dir) => readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((entry) => (
      entry.isDirectory() ? walk(`${dir}/${entry.name}`) : /\.(?:ts|tsx)$/u.test(entry.name) && /next/u.test(`${dir}/${entry.name}`) ? [`${dir}/${entry.name}`] : []));
    return walk("src/components/staff").map((file) => source(file)).join("\n");
  };
  const visible = new Map(["admin", "sales", "admissions"].flatMap((role) => links(navigation(role)).map((link) => [link.id, link.label])));
  assert.deepEqual([...new Set(headings.map(([id]) => id))].sort(), [...visible.keys()].sort());
  for (const [id, file, strict] of headings) {
    const label = escapeRegExp(visible.get(id));
    const page = source(file);
    const literal = new RegExp(`<(?:PartShell|PageShell|UniversityShell)\\b[^>]*?\\btitle=(?:"${label}"|\\{[^}]*"${label}"[^}]*\\})|<h1\\b[^>]*>${label}</h1>|const TITLE = "${label}";|const title = [^;]*"${label}"`, "u");
    // С #1327 страницы отдают заголовок «Новому виду»: слово ищем в его файлах (`PageShell`/`PageHeader` с этим `title`).
    if (!literal.test(page)) assert.match(nextSources(), new RegExp(`\\btitle[=:] ?\\{?"${label}"|\\btitle="${label}"|<h1\\b[^>]*>${label}</h1>`, "u"), `${id}: ${file}`);
    if (strict) {
      for (const [, title] of page.matchAll(/<(?:PartShell|UniversityShell)\b[^>]*?\btitle="([^"]+)"/gu)) assert.equal(title, visible.get(id), file);
    }
  }
  // «Сегодня | Отчёт продаж» tabs are gone (Э3, 26.09.2026): the report keeps its own menu item.
  assert.equal(existsSync(new URL("../src/components/staff/SalesReportNavigation.tsx", import.meta.url)), false);
  assert.doesNotMatch(source("src/components/staff/SalesRegisterView.tsx"), /SalesReportNavigation|Раздел главной/u);
  // Э8.5 (28.09): no «Разделы поступления» nav and no subpage titles on the board page.
  assert.doesNotMatch(source(`${V3}/admissions-pipeline/page.tsx`), /Разделы поступления|title="(?:Документы|Комплекты) на проверку"/u);
});

// «Маркетинг» (М1, 06.10.2026) и «Финансы» (26.10.2026): только настоящий администратор — как «База знаний», но
// без чтения документов: ни просмотр роли (в том числе «Admin»), ни сотрудник без роли admin пункта не видят.
// С 26.10.2026 (решение владельца) оба — разделы верхнего уровня после «Поступления», а не пункты «Общего».
test("«Маркетинг» and «Финансы» stand as top-level sections after the two departments for the real Admin only, never in role preview or for staff", () => {
  const model = (actor, href = "/main") => buildV3Navigation(actor, new URL(href, "https://navigation.test").pathname, new URL(href, "https://navigation.test").searchParams);
  const ids = (actor) => links(model(actor)).map((link) => link.id);
  const admin = { systemRole: "admin", presentationRole: null, platformAccessVersion: 1, assignments: [], permissionKeys: [] };
  const full = model(admin);
  // Before: «Маркетинг» was the last item of «Общее»; now both are sections, in this order, and «Общее» holds neither.
  assert.deepEqual(full.sections.map((link) => [link.id, link.label, link.href]), [["marketing", "Маркетинг", "/marketing"], ["finance", "Финансы", "/finance"]]);
  assert.equal(full.common.some((link) => link.id === "marketing" || link.id === "finance"), false);
  // Menu order: Сегодня · Продажи · Поступление · Маркетинг · Финансы · Общее · Настройки.
  const order = ids(admin);
  assert.ok(order.indexOf("universities") < order.indexOf("marketing") && order.indexOf("marketing") + 1 === order.indexOf("finance") && order.indexOf("finance") + 1 === order.indexOf("tasks"));
  for (const id of ["marketing", "finance"]) {
    assert.ok(order.includes(id));
    for (const presentationRole of ["admin", "sales", "admissions"]) {
      assert.equal(ids({ ...admin, presentationRole }).includes(id), false, `preview ${presentationRole}: ${id}`);
      assert.deepEqual(model({ ...admin, presentationRole }).sections, [], `preview ${presentationRole}`);
    }
    for (const systemRole of ["sales", "admissions", null]) {
      // 06.11.2026: «Финансы» also opens for readers of the sales report (the «Отчёт продаж» tab); «Маркетинг» stays Admin-only.
      assert.equal(ids({ ...admin, systemRole, presentationRole: null, permissionKeys: ["lead.read", "sales.register.read", "knowledge.read.approved"] }).includes(id), id === "finance", `${String(systemRole)}: ${id}`);
      assert.equal(ids({ ...admin, systemRole, presentationRole: null, permissionKeys: ["knowledge.read.approved"] }).includes(id), false, `${String(systemRole)} without sales/finance rights: ${id}`);
    }
  }
  // Вкладка браузера называет раздел теми же словами.
  assert.equal(v3SectionTitle("/marketing"), "Маркетинг");
  assert.equal(v3SectionTitle("/finance"), "Финансы");
  // Адрес раздела с видом — тот же пункт, выбранный; ни один отдел при этом не раскрывается.
  const marketing = model(admin, "/marketing?view=leads");
  assert.equal(marketing.activeId, "marketing");
  assert.deepEqual(marketing.groups.filter((group) => group.active), []);
  const finance = model(admin, "/finance");
  assert.equal(finance.activeId, "finance");
  assert.deepEqual(finance.groups.filter((group) => group.active), []);
});
