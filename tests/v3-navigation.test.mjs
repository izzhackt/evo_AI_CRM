import assert from "node:assert/strict";
import test from "node:test";

import {
  canAdminSelectEffectiveRole,
  fixedRoleCanAccessRoute,
} from "../src/lib/fixed-role-policy.ts";
import { buildV3Navigation } from "../src/lib/v3/navigation.ts";
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
// at the FRONT of the Продажи group (plan §3 order: Заявки, Inbox, Воронка,
// Отчёт продаж) and never reaches the admissions preview, which lacks
// sales.read entirely — its list is unchanged from before this slice.
// OTH-1: «Воронка» (id admissions-pipeline, /v3/admissions-pipeline) is the
// FIRST item of the Поступление group (owner plan) — inserted right after
// "home"/"sales-report" and before "admissions-worklist" for admin and
// admissions; Sales never sees it (no admissions.read, matching the group's
// existing admissions-worklist/universities-only visibility for that role).
const expectedRoleLinks = {
  admin: ["home", "requests", "inbox", "pipeline", "sales-report", "admissions-pipeline", "admissions-worklist", "evo-docs", "universities", "admissions-summary", "tasks", "team-chat", "calendar", "knowledge", "settings"],
  sales: ["home", "requests", "inbox", "pipeline", "sales-report", "admissions-worklist", "universities", "tasks", "team-chat", "knowledge"],
  admissions: ["home", "admissions-pipeline", "admissions-worklist", "evo-docs", "universities", "admissions-summary", "tasks", "team-chat", "inbox", "calendar", "knowledge"],
};

for (const role of ["admin", "sales", "admissions"]) {
  test(`${role} preview sees its presentation destinations`, () => {
    const model = navigation(role);
    assert.deepEqual(links(model).map((link) => link.id), expectedRoleLinks[role]);
    assert.ok(links(model).every((link) => fixedRoleCanAccessRoute(role, link.route)));
    assert.ok(model.groups.every((group) => group.links.length > 0));
    // S6 (plan §3/§14): the inbox link label is «Inbox» everywhere, sidebar
    // included — «Клиентские сообщения» is retired.
    assert.deepEqual(model.common.map((link) => link.label), role === "sales"
      ? ["Задачи", "Командный чат", "База знаний"]
      : role === "admin" ? ["Задачи", "Командный чат", "Календарь", "База знаний"]
      : ["Задачи", "Командный чат", "Inbox", "Календарь", "База знаний"]);
  });

  test(`Admin presentation preview of ${role} follows that role, not Admin authority`, () => {
    assert.equal(canAdminSelectEffectiveRole("admin", role), true);
    const model = navigation(role, "/v3/profile?section=summary");
    assert.deepEqual(links(model).map((link) => link.id), expectedRoleLinks[role]);
    assert.equal(Boolean(model.settings), role === "admin");
    assert.equal(links(model).some((link) => link.id === "admissions-summary"), role !== "sales");
  });
}

test("the two disclosure groups use the approved destinations and worklist remains available to Sales", () => {
  const model = navigation("admin");
  assert.equal(model.home?.label, "Главная");
  // Order follows plan §3: Заявки, Inbox, Воронка, Отчёт продаж. Label is
  // «Inbox» (S6, plan §3/§14) — «Клиентские сообщения» is retired.
  assert.deepEqual(model.groups.map((group) => [group.label, group.links.map((link) => [link.label, link.href])]), [
    ["Продажи", [["Заявки", "/v3/requests"], ["Inbox", "/v3/inbox"], ["Воронка", "/v3/pipeline"], ["Отчёт продаж", "/v3/main?view=sales"]]],
    // «Воронка» (curator kanban, OTH-1) duplicates the Продажи group's own
    // «Воронка» label by design — two different boards for two different
    // roles; see navigation.ts's own comment on this entry.
    ["Поступление", [["Воронка", "/v3/admissions-pipeline"], ["Студенты", "/v3/profile"], ["EVO Docs", "/v3/profile?section=docs"], ["Университеты", "/v3/universities"], ["Сводка по направлениям", "/v3/profile?section=summary#admissions-summary"]]],
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

test("summary is active only for one explicit summary value with no profile target", () => {
  for (const role of ["admin", "admissions"]) {
    for (const href of ["/v3/profile?section=summary", "/v3/profile?section=summary&period=month#admissions-summary"]) {
      const model = navigation(role, href);
      assert.equal(model.activeId, "admissions-summary", href);
      assert.equal(model.groups.find((group) => group.id === "admissions").active, true);
    }
    for (const href of [
      "/v3/profile", "/v3/profile?section=", "/v3/profile?section=unknown",
      "/v3/profile?section=summary&section=summary", "/v3/profile?section=summary&section=other",
      "/v3/profile?case=record&section=summary", "/v3/profile?id=record&section=summary",
      "/v3/profile?case=&section=summary", "/v3/profile?id=&section=summary",
      "/v3/profile?case=record&tab=history", "/v3/profile?query=test&state=closed",
    ]) {
      assert.equal(navigation(role, href).activeId, "admissions-worklist", href);
    }
  }
  assert.equal(navigation("sales", "/v3/profile?section=summary").activeId, "admissions-worklist");
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

test("destination key changes on route, query or preview changes and stays stable on a rerender", () => {
  const current = navigation("admin", "/v3/profile");
  assert.equal(navigation("admin", "/v3/profile").destinationKey, current.destinationKey);
  for (const next of [
    navigation("admin", "/v3/profile?section=summary"),
    navigation("admin", "/v3/profile?query=updated"),
    navigation("admin", "/v3/pipeline"),
    navigation("sales", "/v3/profile"),
  ]) {
    assert.notEqual(next.destinationKey, current.destinationKey);
  }
});
