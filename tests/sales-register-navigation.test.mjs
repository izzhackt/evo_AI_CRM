import assert from "node:assert/strict";
import test from "node:test";
import { isSalesImportQuery, salesReportContext } from "../src/lib/sales-register-navigation.ts";

const current = { year: 2026, month: 9 };
const resolve = query => salesReportContext(query, current);
const params = href => new URL(href, "https://example.invalid").searchParams;

test("report to import and back preserves the selected period, page and normalized filters", () => {
  const query = { year: "2025", month: "2", offset: "50", q: "  Анна  ", manager: "Иван & Co",
    direction: "Китай / магистратура", review: "false", archived: "true" };
  const context = resolve(query);
  assert.equal(context.valid, true);
  assert.deepEqual(Object.fromEntries(params(context.importHref)), { view: "sales", year: "2025", month: "2",
    q: "Анна", archived: "true", manager: "Иван & Co", direction: "Китай / магистратура", review: "false", offset: "50", mode: "import" });
  const back = resolve(Object.fromEntries(params(context.importHref))).reportHref;
  assert.equal(back, context.reportHref);
  assert.equal(context.clearFiltersHref, "/v3/main?view=sales&year=2025&month=2");
});

test("settings entry receives an explicit organization period and annual context remains annual", () => {
  assert.equal(resolve({ mode: "import" }).reportHref, "/v3/main?view=sales&year=2026&month=9");
  const annual = resolve({ year: "2024", month: "all", offset: "25" });
  assert.equal(annual.valid, true);
  assert.equal(annual.month, undefined);
  assert.equal(params(annual.reportHref).get("month"), "all");
  assert.equal(params(annual.importHref).get("offset"), "25");
});

test("only the exact import mode selects management and explicit record/editor/results take precedence", () => {
  assert.equal(isSalesImportQuery({ mode: "import" }), true);
  for (const mode of [undefined, "", "IMPORT", "unknown", ["import"], null]) {
    assert.equal(isSalesImportQuery({ mode }), false);
  }
  for (const key of ["record", "new", "edit", "saved"]) {
    for (const value of ["", "true", "false", "record-id", ["x"]]) {
      assert.equal(isSalesImportQuery({ mode: "import", [key]: value }), false);
    }
  }
});

test("links remain on the report route and discard unrelated destinations and editor state", () => {
  const context = resolve({ mode: "import", returnTo: "https://untrusted.invalid/", host: "untrusted.invalid",
    record: "record-id", new: "true", edit: "true", saved: "saved-id", q: "https://untrusted.invalid/?mode=import" });
  const back = new URL(context.reportHref, "https://crm.example.invalid");
  assert.equal(back.origin, "https://crm.example.invalid");
  assert.equal(back.pathname, "/v3/main");
  assert.deepEqual([...back.searchParams.keys()], ["view", "year", "month", "q"]);
  assert.equal(back.searchParams.get("q"), "https://untrusted.invalid/?mode=import");
  assert.equal(params(context.importHref).getAll("mode").length, 1);
});

test("malformed periods and filters do not admit the import read or silently correct the Back link", () => {
  for (const query of [{ year: "1899" }, { year: "2101" }, { year: "026" }, { month: "13" }, { month: "0" },
    { offset: "-1" }, { offset: "1000001" }, { review: "yes" }, { q: "a".repeat(201) },
    { manager: "x".repeat(301) }, { direction: "line\nbreak" }]) {
    const context = resolve(query);
    assert.equal(context.valid, false);
    for (const [key, value] of Object.entries(query)) assert.equal(params(context.reportHref).get(key), value);
    assert.equal(params(context.reportHref).has("mode"), false);
  }
});

test("duplicate and non-string context values fail without coercion or exceptions", () => {
  for (const key of ["year", "month", "offset", "q", "manager", "direction", "review", "archived"]) {
    for (const value of [["2026"], [], null, 1, true, {}, Symbol("invalid")]) {
      const context = resolve({ [key]: value });
      assert.equal(context.valid, false);
      assert.equal(params(context.reportHref).has(key), false);
    }
  }
});

test("existing report bounds, empty filters and internal row links remain supported", () => {
  for (const year of ["1900", "2100"]) {
    const context = resolve({ year, month: "12", offset: "1000000", manager: "", direction: "", review: "", q: "  " });
    assert.equal(context.valid, true);
    assert.equal(context.reportMonth, `${year}-12-01`);
    assert.equal(context.searchQuery, "");
    assert.equal(params(context.href({ record: "record-id", edit: "true" })).get("record"), "record-id");
    assert.equal(params(context.href({ offset: "25" })).get("offset"), "25");
  }
});
