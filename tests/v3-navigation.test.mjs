import assert from "node:assert/strict";
import test from "node:test";

import {
  canAdminSelectEffectiveRole,
  fixedRoleCanAccessRoute,
} from "../src/lib/fixed-role-policy.ts";
import { buildV3Navigation } from "../src/lib/v3/navigation.ts";

function navigation(role, href = "/v3/main") {
  const url = new URL(href, "https://navigation.test");
  return buildV3Navigation(role, url.pathname, url.searchParams);
}

function links(model) {
  return [
    ...(model.home ? [model.home] : []),
    ...model.groups.flatMap((group) => group.links),
    ...model.common,
    ...(model.settings ? [model.settings] : []),
  ];
}

const expectedRoleLinks = {
  admin: ["home", "pipeline", "sales-report", "admissions-worklist", "admissions-summary", "inbox", "calendar", "knowledge", "settings"],
  sales: ["home", "pipeline", "sales-report", "admissions-worklist", "inbox", "knowledge"],
  admissions: ["admissions-worklist", "admissions-summary", "inbox", "calendar", "knowledge"],
};

for (const role of ["admin", "sales", "admissions"]) {
  test(`${role} sees exactly the navigation destinations permitted by the fixed-role policy`, () => {
    const model = navigation(role);
    assert.deepEqual(links(model).map((link) => link.id), expectedRoleLinks[role]);
    assert.ok(links(model).every((link) => fixedRoleCanAccessRoute(role, link.route)));
    assert.ok(model.groups.every((group) => group.links.length > 0));
    assert.deepEqual(model.common.map((link) => link.label), role === "sales"
      ? ["Входящие", "База знаний"]
      : ["Входящие", "Календарь", "База знаний"]);
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
  assert.deepEqual(model.groups.map((group) => [group.label, group.links.map((link) => [link.label, link.href])]), [
    ["Продажи", [["Воронка", "/v3/pipeline"], ["Отчёт продаж", "/v3/main?view=sales"]]],
    ["Поступление", [["Рабочий список", "/v3/profile"], ["Сводка по направлениям", "/v3/profile?section=summary#admissions-summary"]]],
  ]);
  assert.deepEqual(navigation("sales").groups[1].links.map((link) => link.id), ["admissions-worklist"]);
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
  for (const href of ["/v3/main", "/v3/main?view=sales", "/v3/pipeline", "/v3/settings"]) {
    assert.equal(navigation("admissions", href).activeId, null, href);
  }
  for (const href of ["/v3/settings", "/v3/calendar"]) {
    assert.equal(navigation("sales", href).activeId, null, href);
  }
  for (const role of ["admin", "sales", "admissions"]) {
    assert.equal(navigation(role, "/v3/unknown").activeId, null);
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
