import test from "node:test";
import assert from "node:assert/strict";
import { parseSalesRegisterSearchQuery, parseSalesRegisterSearchWorkspace } from "../src/lib/sales-register-search.ts";
import { parseSalesRegisterWorkspace } from "../src/lib/platform-sales-register-contract.ts";

// Scalar/decoder boundaries only; this is not a substitute for real Auth/RPC QA.
test("search preserves literal punctuation and Unicode while bounding original input", () => {
  assert.equal(parseSalesRegisterSearchQuery(undefined), "");
  assert.equal(parseSalesRegisterSearchQuery("   "), "");
  assert.equal(parseSalesRegisterSearchQuery("  Асан %_№42  "), "Асан %_№42");
  assert.equal(parseSalesRegisterSearchQuery("+996 (555) 12-34-56"), "+996 (555) 12-34-56");
  assert.equal(parseSalesRegisterSearchQuery("я".repeat(200)), "я".repeat(200));
  assert.equal(parseSalesRegisterSearchQuery("😀".repeat(200)), "😀".repeat(200));
  for (const value of ["я".repeat(201), "😀".repeat(201), " ".repeat(201), "a\nb", "a\tb", "a\0b", "a\x7fb", [], {}, 1]) {
    assert.equal(parseSalesRegisterSearchQuery(value), null);
  }
});

const organizationId = "11111111-1111-4111-8111-111111111111";
const legacy = () => ({ organization_id: organizationId, year: 2026, month: null,
  total_count: 0, rows: [], selected: null, offset: 0, has_more: false, totals: [],
  unresolved_cost_count: 0, unresolved_paid_count: 0, targets: [], manager_labels: [], owner_options: [] });

test("search decoder adds exactly one normalized query without changing legacy DTO", () => {
  const previous = parseSalesRegisterWorkspace(legacy(), organizationId);
  assert.deepEqual(parseSalesRegisterSearchWorkspace({ ...legacy(), query: null }, organizationId), { ...previous, query: null });
  assert.deepEqual(parseSalesRegisterSearchWorkspace({ ...legacy(), query: "Асан%_" }, organizationId), { ...previous, query: "Асан%_" });
  assert.throws(() => parseSalesRegisterWorkspace({ ...legacy(), query: null }, organizationId), /unavailable/);
});

test("search decoder rejects missing, malformed and noncanonical query echoes", () => {
  assert.throws(() => parseSalesRegisterSearchWorkspace(legacy(), organizationId), /unavailable/);
  for (const query of [undefined, "", "   ", " padded ", "a\nb", "x".repeat(201), 1, [], {}]) {
    assert.throws(() => parseSalesRegisterSearchWorkspace({ ...legacy(), query }, organizationId), /unavailable/);
  }
  assert.throws(() => parseSalesRegisterSearchWorkspace({ ...legacy(), query: null, unexpected: true }, organizationId), /unavailable/);
});

test("search projection retains tenant, row and currency validation from v1", () => {
  for (const mutation of [{ organization_id: "22222222-2222-4222-8222-222222222222" },
    { rows: [{}] }, { totals: [{ currency: "USD", cost_minor: "unknown", paid_minor: "0" }] }]) {
    assert.throws(() => parseSalesRegisterSearchWorkspace({ ...legacy(), query: "x", ...mutation }, organizationId), /unavailable/);
  }
});
