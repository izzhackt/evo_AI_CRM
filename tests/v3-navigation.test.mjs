import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  canAdminSelectEffectiveRole,
  fixedRoleCanAccessRoute,
} from "../src/lib/fixed-role-policy.ts";
import { buildV3Navigation, v3SectionTitle } from "../src/lib/v3/navigation.ts";
import { admissionsDirectoryHref, withDocsSection } from "../src/components/v3/profile/admissions-view.ts";

function navigation(role, href = "/v3/main") {
  const url = new URL(href, "https://navigation.test");
  return buildV3Navigation({ systemRole: "admin", presentationRole: role === "admin" ? null : role, platformAccessVersion: 1, assignments: [], permissionKeys: [] }, url.pathname, url.searchParams);
}

function links(model) {
  return [
    ...(model.home ? [model.home] : []),
    ...model.groups.flatMap((group) => group.links),
    ...model.common,
    ...(model.settings ? [model.settings] : []),
  ];
}

// «Заявки» (unified-workflow S1) is sales.read-gated, so it joins admin/sales
// at the FRONT of the Продажи group (plan §3 order: Заявки, WhatsApp,
// Воронка продаж, Отчёт продаж) and never reaches the admissions preview,
// which lacks sales.read entirely — its list is unchanged from before this slice.
// OTH-1: «Воронка поступления» (id admissions-pipeline, /v3/admissions-pipeline) is the
// FIRST item of the Поступление group (owner plan) — inserted right after
// "home"/"sales-report" and before "admissions-worklist" for admin and
// admissions; Sales never sees it (no admissions.read, matching the group's
// existing admissions-worklist/universities-only visibility for that role).
// OTH-5: «Сообщения» (id messages, /v3/messages) follows that board right
// after it — same admissions.read-only gate, so Sales never sees it either.
const expectedRoleLinks = {
  admin: ["home", "requests", "inbox", "pipeline", "sales-report", "admissions-pipeline", "messages", "admissions-worklist", "evo-docs", "universities", "tasks", "team-chat", "calendar", "knowledge", "settings"],
  sales: ["home", "requests", "inbox", "pipeline", "sales-report", "admissions-worklist", "universities", "tasks", "team-chat", "reply-snippets"],
  admissions: ["home", "admissions-pipeline", "messages", "admissions-worklist", "evo-docs", "universities", "tasks", "team-chat", "inbox", "calendar", "documents", "reply-snippets"],
};

for (const role of ["admin", "sales", "admissions"]) {
  test(`${role} preview sees its presentation destinations`, () => {
    const model = navigation(role);
    assert.deepEqual(links(model).map((link) => link.id), expectedRoleLinks[role]);
    assert.ok(links(model).every((link) => fixedRoleCanAccessRoute(role, link.route)));
    assert.ok(model.groups.every((group) => group.links.length > 0));
    // S6 (plan §3/§14) retired «Клиентские сообщения»; UX quick win 2
    // (2026-09-24) names the WAHA-only inbox «WhatsApp» everywhere, sidebar
    // included, instead of «Inbox».
    assert.deepEqual(model.common.map((link) => link.label), role === "sales"
      ? ["Задачи", "Командный чат", "Шаблоны ответов"]
      : role === "admin" ? ["Задачи", "Командный чат", "Календарь", "База знаний"]
      : ["Задачи", "Командный чат", "WhatsApp", "Календарь", "Документы", "Шаблоны ответов"]);
  });

  test(`Admin presentation preview of ${role} follows that role, not Admin authority`, () => {
    assert.equal(canAdminSelectEffectiveRole("admin", role), true);
    const model = navigation(role, "/v3/profile?section=summary");
    assert.deepEqual(links(model).map((link) => link.id), expectedRoleLinks[role]);
    assert.equal(Boolean(model.settings), role === "admin");
    // «Сводка по направлениям» merged into «Студенты» (2026-09-24): no role
    // has a separate summary item any more.
    assert.equal(links(model).some((link) => link.id === "admissions-summary"), false);
  });
}

test("the two disclosure groups use the approved destinations and worklist remains available to Sales", () => {
  const model = navigation("admin");
  assert.equal(model.home?.label, "Главная");
  // Order follows plan §3: Заявки, WhatsApp (ex-«Inbox»), Воронка продаж,
  // Отчёт продаж. The two boards carry their department in the label (UX
  // quick win 2, 2026-09-24): an Admin sees both groups, and two identical
  // «Воронка» items were ambiguous.
  assert.deepEqual(model.groups.map((group) => [group.label, group.links.map((link) => [link.label, link.href])]), [
    ["Продажи", [["Заявки", "/v3/requests"], ["WhatsApp", "/v3/inbox"], ["Воронка продаж", "/v3/pipeline"], ["Отчёт продаж", "/v3/main?view=sales"]]],
    ["Поступление", [["Воронка поступления", "/v3/admissions-pipeline"], ["Сообщения", "/v3/messages"], ["Студенты", "/v3/profile"], ["EVO Docs", "/v3/profile?section=docs"], ["Университеты", "/v3/universities"]]],
  ]);
  assert.deepEqual(navigation("sales").groups[1].links.map((link) => link.id), ["admissions-worklist", "universities"]);
  assert.deepEqual(navigation("admissions").groups.map((group) => group.id), ["admissions"]);
  assert.equal(model.settings?.href, "/v3/settings");
});

test("main and sales report have mutually exclusive, query-aware current links", () => {
  for (const role of ["admin", "sales"]) {
    for (const href of ["/v3/main", "/v3/main?period=month", "/v3/main?view=unknown", "/v3/main?view=", "/v3/main?view=sales&view=sales"]) {
      const model = navigation(role, href);
      assert.equal(model.activeId, "home", href);
      assert.equal(model.groups.find((group) => group.id === "sales").active, false);
    }
    for (const href of ["/v3/main?view=sales", "/v3/main?period=month&view=sales"]) {
      const model = navigation(role, href);
      assert.equal(model.activeId, "sales-report", href);
      assert.equal(model.groups.find((group) => group.id === "sales").active, true);
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
      "/v3/profile?section=summary", "/v3/profile?section=summary&period=month#admissions-summary",
      "/v3/profile", "/v3/profile?section=", "/v3/profile?section=unknown",
      "/v3/profile?section=summary&section=summary", "/v3/profile?section=summary&section=other",
      "/v3/profile?case=record&section=summary",
      "/v3/profile?case=&section=summary", "/v3/profile?id=&section=summary",
      "/v3/profile?case=record&tab=history", "/v3/profile?query=test&state=closed",
    ]) {
      const model = navigation(role, href);
      assert.equal(model.activeId, "admissions-worklist", `${role} ${href}`);
      assert.equal(links(model).some((link) => link.label === "Сводка по направлениям"), false, `${role} ${href}`);
      assert.equal(model.destinationKey, navigation(role, "/v3/profile").destinationKey, `${role} ${href}`);
      assert.equal(sectionTitle(href), "Студенты", `${role} ${href}`);
    }
  }
  assert.equal(v3SectionTitle("/v3/profile", { section: "summary" }), "Студенты");
});

test("a lead card lives under «Воронка продаж» and names itself «Лид» in the tab", () => {
  // Audit 26.09: Lead 360 highlighted Поступление › Студенты and the tab read
  // «Студенты — EVO CRM». A case (`?case=`) stays «Студенты».
  for (const href of ["/v3/profile?id=record", "/v3/profile?id=record&tab=history", "/v3/profile?id=record&section=summary",
    "/v3/profile?id=record&returnTo=%2Fv3%2Fpipeline%3Fdue%3Dunscheduled"]) {
    for (const role of ["admin", "sales"]) {
      const model = navigation(role, href);
      assert.equal(model.activeId, "pipeline", `${role} ${href}`);
      assert.equal(model.groups.find((group) => group.id === "sales")?.active, true, `${role} ${href}`);
    }
    // Admissions has no sales board: it keeps its own section, never nothing.
    assert.equal(navigation("admissions", href).activeId, "admissions-worklist", href);
    assert.equal(sectionTitle(href), "Лид", href);
  }
  for (const href of ["/v3/profile?case=record", "/v3/profile?id=record&case=record", "/v3/profile?id=&tab=overview",
    "/v3/profile?id=a&id=b"]) {
    assert.equal(navigation("admin", href).activeId, "admissions-worklist", href);
    assert.equal(sectionTitle(href), "Студенты", href);
  }
  assert.equal(sectionTitle("/v3/profile?id=record&section=docs"), "EVO Docs");
});

test("forbidden and unknown paths never mark an unrelated link current", () => {
  // /v3/main is the admissions «Мой день» home now; only the sales report view
  // and sales-only routes stay outside that role's navigation.
  assert.equal(navigation("admissions", "/v3/main").activeId, "home");
  // «Заявки» is sales.read-gated (unified workflow S1); admissions lacks that
  // capability entirely, so it never becomes this preview's active link.
  for (const href of ["/v3/main?view=sales", "/v3/pipeline", "/v3/settings", "/v3/requests"]) {
    assert.equal(navigation("admissions", href).activeId, null, href);
  }
  for (const href of ["/v3/settings", "/v3/calendar"]) {
    assert.equal(navigation("sales", href).activeId, null, href);
  }
  for (const role of ["admin", "sales", "admissions"]) {
    assert.equal(navigation(role, "/v3/unknown").activeId, null);
  }
});

test("Docs keeps its own navigation context for directory and case routes", () => {
  for (const role of ["admin", "admissions"]) {
    for (const href of ["/v3/profile?section=docs", "/v3/profile?section=docs&direction=MY", "/v3/profile?case=record&tab=anketa&section=docs", "/v3/profile?case=record&tab=route&panel=packets&section=docs#partner-packets"]) {
      assert.equal(navigation(role, href).activeId, "evo-docs", href);
    }
    assert.equal(navigation(role, "/v3/profile?section=docs&section=docs").activeId, "admissions-worklist");
  }
  assert.equal(navigation("sales", "/v3/profile?section=docs").activeId, "admissions-worklist");
});

test("Docs presentation requires profile read authority and does not expose it to summary-only staff", () => {
  const actor = { systemRole: "staff", presentationRole: null, platformAccessVersion: 1, assignments: [], permissionKeys: ["lead.read", "case.read.summary"] };
  const url = new URL("https://navigation.test/v3/profile?section=docs");
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
  const zip = new URL(withDocsSection("/v3/profile?case=case&tab=route&panel=packets#partner-packets", true), "https://navigation.test");
  assert.equal(zip.searchParams.get("case"), "case");
  assert.equal(zip.searchParams.get("tab"), "route");
  assert.equal(zip.searchParams.get("panel"), "packets");
  assert.equal(zip.searchParams.get("section"), "docs");
  assert.equal(zip.hash, "#partner-packets");
  assert.equal(withDocsSection("/v3/profile?tab=anketa", false), "/v3/profile?tab=anketa");
});

test("university details keep the catalogue and Admissions section active", () => {
  for (const role of ["admin", "sales", "admissions"]) {
    const model = navigation(role, "/v3/universities/57ce9b97-43fb-4563-9c61-b8c6cf901a7b");
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
    ["sales-report", ["/v3/main?view=sales", "/v3/main?view=sales&year=2026&month=9&q=Name&offset=30&review=true", "/v3/main?archived=true&month=10&view=sales&year=2026"]],
    ["calendar", ["/v3/calendar", "/v3/calendar?view=month&date=2026-09-01", "/v3/calendar?date=2026-10-01&view=week"]],
    ["admissions-worklist", ["/v3/profile", "/v3/profile?case=record&tab=route", "/v3/profile?section=summary&case=", "/v3/profile?section=summary&id="]],
    // The board and a lead card opened from it keep the same sidebar identity.
    ["pipeline", ["/v3/pipeline", "/v3/pipeline?due=unscheduled&lead=record", "/v3/profile?id=record&query=updated"]],
    ["evo-docs", ["/v3/profile?section=docs", "/v3/profile?case=record&section=docs&tab=anketa"]],
    ["universities", ["/v3/universities", "/v3/universities?country=MY&level=bachelor", "/v3/universities/57ce9b97-43fb-4563-9c61-b8c6cf901a7b"]],
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
  const destinations = ["/v3/main", "/v3/main?view=sales", "/v3/profile", "/v3/profile?section=docs", "/v3/pipeline"];
  assert.equal(new Set(destinations.map((href) => navigation("admin", href).destinationKey)).size, destinations.length);
  for (const href of ["/v3/main?view=unknown", "/v3/main?view=sales&view=sales"]) {
    assert.equal(navigation("admin", href).destinationKey, navigation("admin", "/v3/main").destinationKey);
  }
  assert.equal(navigation("admin", "/v3/profile?section=docs&section=docs").destinationKey, navigation("admin", "/v3/profile").destinationKey);
});

test("unknown destinations keep pathname identity without activating an unavailable link", () => {
  const first = navigation("admin", "/v3/unknown");
  assert.equal(first.activeId, null);
  assert.equal(navigation("admin", "/v3/unknown?q=changed").destinationKey, first.destinationKey);
  assert.notEqual(navigation("admin", "/v3/another-unknown").destinationKey, first.destinationKey);

  const actor = { systemRole: "staff", presentationRole: null, platformAccessVersion: 1, assignments: [], permissionKeys: ["sales.register.read"] };
  const staffNavigation = (href) => {
    const url = new URL(href, "https://navigation.test");
    return buildV3Navigation(actor, url.pathname, url.searchParams);
  };
  const report = staffNavigation("/v3/main?view=sales");
  assert.equal(report.activeId, "sales-report");
  assert.equal(staffNavigation("/v3/main?view=sales&month=9").destinationKey, report.destinationKey);
  assert.deepEqual(links(report).map((link) => link.id), ["home", "sales-report"]);
  const denied = staffNavigation("/v3/profile?section=summary");
  assert.equal(denied.activeId, null);
  assert.equal(staffNavigation("/v3/profile?section=docs").destinationKey, denied.destinationKey);
  assert.notEqual(staffNavigation("/v3/universities").destinationKey, denied.destinationKey);
  assert.notEqual(denied.destinationKey, report.destinationKey);
});

test("presentation role and access version changes reset the same destination", () => {
  const actor = { systemRole: "admin", presentationRole: null, platformAccessVersion: 1, assignments: [], permissionKeys: [] };
  const query = new URLSearchParams("view=sales");
  const current = buildV3Navigation(actor, "/v3/main", query);
  for (const changed of [{ ...actor, presentationRole: "sales" }, { ...actor, platformAccessVersion: 2 }]) {
    const next = buildV3Navigation(changed, "/v3/main", query);
    assert.equal(next.activeId, current.activeId);
    assert.notEqual(next.destinationKey, current.destinationKey);
  }
  assert.equal(buildV3Navigation(actor, "/v3/main", query).destinationKey, current.destinationKey);
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
    for (const retired of ["Воронка", "Inbox", "Входящие"]) assert.ok(!labels.includes(retired), `${role}: ${retired}`);
  }
  const admin = links(navigation("admin"));
  assert.equal(admin.find((link) => link.id === "pipeline")?.label, "Воронка продаж");
  assert.equal(admin.find((link) => link.id === "admissions-pipeline")?.label, "Воронка поступления");
  assert.equal(admin.find((link) => link.id === "inbox")?.label, "WhatsApp");
});

test("the browser tab names the sidebar item that the same address highlights", () => {
  for (const role of ["admin", "sales", "admissions"]) {
    for (const link of links(navigation(role))) assert.equal(sectionTitle(link.href), link.label, `${role} ${link.href}`);
  }
  for (const [href, title] of [
    ["/v3/main?period=month", "Главная"],
    ["/v3/main?view=sales&view=sales", "Главная"],
    ["/v3/main?view=sales&year=2026&month=9", "Отчёт продаж"],
    ["/v3/profile?case=record&tab=route", "Студенты"],
    ["/v3/profile?section=docs&section=docs", "Студенты"],
    ["/v3/profile?case=record&tab=anketa&section=docs", "EVO Docs"],
    ["/v3/profile?section=summary&period=month", "Студенты"],
    ["/v3/universities/57ce9b97-43fb-4563-9c61-b8c6cf901a7b", "Университеты"],
    ["/v3/admissions-pipeline?view=documents", "Воронка поступления"],
  ]) {
    assert.equal(sectionTitle(href), title, href);
    const model = navigation("admin", href);
    assert.equal(links(model).find((link) => link.id === model.activeId)?.label, title, href);
  }
  assert.equal(v3SectionTitle("/v3/unknown"), undefined);
});

test("every staff page uses the one «<Раздел> — EVO CRM» tab pattern", () => {
  assert.match(source("src/app/(v3)/layout.tsx"), /title: \{ absolute: "EVO CRM", template: "%s — EVO CRM" \}/u);
  const redirectOnly = new Set(["src/app/(v3)/v3/page.tsx", "src/app/(v3)/v3/admissions-requests/page.tsx"]);
  const pages = readdirSync(new URL("../src/app/(v3)", import.meta.url), { recursive: true })
    .filter((file) => file.endsWith("page.tsx") || file === "not-found.tsx")
    .map((file) => `src/app/(v3)/${file}`);
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
      assert.match(page, /export async function generateMetadata\([\s\S]*?title: v3SectionTitle\("\/v3\/(?:main|profile)", await searchParams\)/u, file);
      continue;
    }
    assert.doesNotMatch(title, /V3|EVO|·|\|/u, file);
    const route = file.match(/^src\/app\/\(v3\)(\/v3\/[^/]+)\//u)?.[1];
    if (route) assert.equal(title, v3SectionTitle(route), file);
  }
  const denied = source("src/app/(v3)/access-denied/page.tsx");
  for (const [, route, label] of denied.matchAll(/^  "(\/v3\/[^"]+)": "([^"]+)",$/gmu)) {
    assert.equal(label, v3SectionTitle(route), route);
  }
});

test("each sidebar destination opens under a heading with the same words", () => {
  const V3 = "src/app/(v3)/v3";
  // [link id, file, every literal PartShell title in the file is that label]
  const headings = [
    ["home", `${V3}/main/page.tsx`, true], ["home", `${V3}/main/loading.tsx`, true],
    ["requests", `${V3}/requests/page.tsx`, true], ["requests", `${V3}/requests/loading.tsx`, true],
    ["inbox", `${V3}/inbox/page.tsx`, true], ["inbox", `${V3}/inbox/loading.tsx`, true],
    ["pipeline", `${V3}/pipeline/page.tsx`, true], ["pipeline", `${V3}/pipeline/loading.tsx`, true],
    ["sales-report", "src/components/v3/SalesRegisterView.tsx", false],
    ["admissions-pipeline", `${V3}/admissions-pipeline/page.tsx`, false],
    ["messages", `${V3}/messages/page.tsx`, true], ["messages", "src/components/v3/case-chat/CaseChatThread.tsx", false],
    ["admissions-worklist", `${V3}/profile/page.tsx`, false], ["admissions-worklist", `${V3}/profile/loading.tsx`, true],
    ["evo-docs", `${V3}/profile/page.tsx`, false],
    ["universities", `${V3}/universities/page.tsx`, true], ["universities", `${V3}/universities/loading.tsx`, true],
    ["tasks", `${V3}/tasks/page.tsx`, true], ["tasks", `${V3}/tasks/loading.tsx`, true],
    ["team-chat", `${V3}/team-chat/page.tsx`, true], ["team-chat", "src/components/v3/team-chat/TeamChat.tsx", false],
    ["calendar", `${V3}/calendar/page.tsx`, true], ["calendar", `${V3}/calendar/loading.tsx`, true],
    ["documents", `${V3}/documents/page.tsx`, true],
    ["reply-snippets", `${V3}/reply-snippets/page.tsx`, true],
    ["knowledge", `${V3}/knowledge/page.tsx`, true],
    ["settings", `${V3}/settings/page.tsx`, true],
  ];
  const visible = new Map(["admin", "sales", "admissions"].flatMap((role) => links(navigation(role)).map((link) => [link.id, link.label])));
  assert.deepEqual([...new Set(headings.map(([id]) => id))].sort(), [...visible.keys()].sort());
  for (const [id, file, strict] of headings) {
    const label = escapeRegExp(visible.get(id));
    const page = source(file);
    assert.match(page, new RegExp(`<PartShell\\b[^>]*?\\btitle=(?:"${label}"|\\{[^}]*"${label}"[^}]*\\})|<h1\\b[^>]*>${label}</h1>|const TITLE = "${label}";`, "u"), `${id}: ${file}`);
    if (strict) {
      for (const [, title] of page.matchAll(/<PartShell\b[^>]*?\btitle="([^"]+)"/gu)) assert.equal(title, visible.get(id), file);
    }
  }
  // Local section tabs reuse the sidebar words for the same addresses.
  assert.match(source("src/components/v3/SalesReportNavigation.tsx"), /\{ title: "Главная", href: "\/v3\/main"[\s\S]*\{ title: "Отчёт продаж", href: "\/v3\/main\?view=sales"/u);
  assert.match(source(`${V3}/admissions-pipeline/page.tsx`), />Воронка поступления<\/Link>/u);
});
