import test from "node:test";
import assert from "node:assert/strict";
import { parseSalesRegisterSearchQuery } from "../src/lib/sales-register-search.ts";
import { parseSalesRegisterRow, parseSalesRegisterWorkspace } from "../src/lib/platform-sales-register-contract.ts";
import { parseSalesManagerLabels, salesManagerLabelName } from "../src/lib/sales-manager-labels.ts";

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
// read_sales_register_v4 (253): the query echo, the manager key and its options are part of one exact-key DTO.
const without = (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
const workspace = () => ({ query: null, manager_key: null, organization_id: organizationId, year: 2026, month: null,
  total_count: 0, rows: [], selected: null, offset: 0, has_more: false, totals: [],
  unresolved_cost_count: 0, unresolved_paid_count: 0, targets: [], manager_options: [], owner_options: [] });

test("v4 decoder echoes exactly one normalized query and one manager key", () => {
  assert.deepEqual(parseSalesRegisterWorkspace(workspace(), organizationId).query, null);
  assert.deepEqual(parseSalesRegisterWorkspace({ ...workspace(), query: "Асан%_" }, organizationId).query, "Асан%_");
  const chosen = parseSalesRegisterWorkspace({ ...workspace(), manager_key: "санжар эскизов",
    manager_options: [{ key: "санжар эскизов", name: "Санжар Эскизов", count: 3 }] }, organizationId);
  assert.equal(chosen.managerKey, "санжар эскизов");
  assert.deepEqual(chosen.managerOptions, [{ key: "санжар эскизов", name: "Санжар Эскизов", count: 3 }]);
});

test("v4 decoder rejects missing, malformed and noncanonical echoes and the retired v1–v3 keys", () => {
  assert.throws(() => parseSalesRegisterWorkspace(without(workspace(), "query"), organizationId), /unavailable/);
  for (const query of [undefined, "", " padded ", "a\nb", "x".repeat(201), 1, [], {}]) {
    assert.throws(() => parseSalesRegisterWorkspace({ ...workspace(), query }, organizationId), /unavailable/);
  }
  for (const managerKey of [undefined, "", 1, "x".repeat(301)]) {
    assert.throws(() => parseSalesRegisterWorkspace({ ...workspace(), manager_key: managerKey }, organizationId), /unavailable/);
  }
  assert.throws(() => parseSalesRegisterWorkspace({ ...without(workspace(), "manager_options"), manager_labels: [] }, organizationId), /unavailable/, "v2/v3 manager_labels");
  assert.throws(() => parseSalesRegisterWorkspace({ ...workspace(), unexpected: true }, organizationId), /unavailable/);
  for (const options of [[{ key: "", name: "x", count: 0 }], [{ key: "a", name: "x" }], [{ key: "a", name: "x", count: -1 }],
    [{ key: "a", name: "x", count: 1 }, { key: "a", name: "y", count: 2 }]]) {
    assert.throws(() => parseSalesRegisterWorkspace({ ...workspace(), manager_options: options }, organizationId), /unavailable/);
  }
});

test("v4 decoder retains tenant, row and currency validation", () => {
  for (const mutation of [{ organization_id: "22222222-2222-4222-8222-222222222222" },
    { rows: [{}] }, { totals: [{ currency: "USD", cost_minor: "unknown", paid_minor: "0" }] }]) {
    assert.throws(() => parseSalesRegisterWorkspace({ ...workspace(), query: "x", ...mutation }, organizationId), /unavailable/);
  }
});

// sales_register_row_v2 (253): the v1 row plus exactly four keys; flags are strings only, never the source snapshot.
const rowV2 = (fields = {}) => ({
  id: "33333333-3333-4333-8333-333333333333", version: "2", report_month: "2026-09-01", signing_date: "2026-09-03",
  applicant_name: "Синтетический студент", phone: "", country: "", university: "", program: "", direction: "", intake: "",
  contract_number: "", manager_label: "Санжар  Эскизов.", status_raw: "", owner_membership_id: null, service_cost_raw: "1800",
  service_cost_minor: "180000", service_cost_currency: "USD", paid_raw: "45000", paid_minor: "4500000", paid_currency: "KGS",
  needs_review: true, notes: "", archived: false, source_kind: "import", lead_id: null, client_id: null, source_key: "synthetic:1",
  source_sha256: "ab".repeat(32), source_sheet: "Лист", source_row: 3, updated_at: "2026-09-28T05:00:00.000Z",
  paid_contract: null, review_reasons: ["contract_amount_missing", "import:status_unspecified"],
  import_flags: ["cost_paid_currency_mismatch", "status_unspecified"], manager_key: "санжар эскизов", ...fields,
});

test("row v2 decoder: contract amount, reasons, import flag strings and the manager key", () => {
  const row = parseSalesRegisterRow(rowV2());
  assert.deepEqual([row.paidContractMinor, row.paidContractCurrency, row.reviewReasons, row.importFlags, row.managerKey],
    [null, null, ["contract_amount_missing", "import:status_unspecified"], ["cost_paid_currency_mismatch", "status_unspecified"], "санжар эскизов"]);
  const paid = parseSalesRegisterRow(rowV2({ paid_contract: { minor: "52000", currency: "USD" }, review_reasons: [], needs_review: false }));
  assert.deepEqual([paid.paidContractMinor, paid.paidContractCurrency], [52000, "USD"]);
  for (const bad of [without(rowV2(), "paid_contract"), { ...rowV2(), source_snapshot: {} }, rowV2({ paid_contract: { minor: "1" } }),
    rowV2({ paid_contract: { minor: "1", currency: "RUB" } }), rowV2({ review_reasons: ["guess"] }),
    rowV2({ review_reasons: ["paid_missing", "paid_missing"] }), rowV2({ needs_review: false }),
    rowV2({ import_flags: ["Status Unspecified"] }), rowV2({ source_kind: "manual", source_key: null, import_flags: ["phone_missing"] })]) {
    assert.throws(() => parseSalesRegisterRow(bad), /unavailable/);
  }
});

// read_sales_manager_labels_v1 (253): keys with raw spellings, counts and the owner's mapping.
test("manager labels decoder: exact keys, a name without a CRM account, a cleared mapping", () => {
  const label = (fields = {}) => ({ key: "нурлан ж", tidy: "Нурлан Ж.", record_count: "3",
    spellings: [{ spelling: "Нурлан Ж.", count: 2 }, { spelling: "Нурлан Ж", count: 1 }],
    mapping: { display_name: "Нурлан (без аккаунта)", membership_id: null, version: "2", updated_at: "2026-09-28T05:10:00.000Z" }, ...fields });
  const read = (labels, staff = []) => parseSalesManagerLabels({ organization_id: organizationId, labels, staff_options: staff }, organizationId);
  const parsed = read([label(), label({ key: "эльмира", tidy: "Эльмира", mapping: { display_name: null, membership_id: null, version: "3",
    updated_at: "2026-09-28T05:20:00.000Z" } }), label({ key: "айдана", tidy: "Айдана", mapping: null })]);
  assert.deepEqual(parsed.labels.map(salesManagerLabelName), ["Нурлан (без аккаунта)", "Эльмира", "Айдана"]);
  assert.equal(parsed.labels[0].recordCount, 3);
  assert.deepEqual(parsed.labels[1].mapping, { displayName: null, membershipId: null, version: 3, updatedAt: "2026-09-28T05:20:00.000Z" });
  for (const bad of [[label({ key: "" })], [label(), label()], [label({ extra: 1 })],
    [label({ mapping: { display_name: null, membership_id: "44444444-4444-4444-8444-444444444444", version: "1", updated_at: "2026-09-28T05:00:00.000Z" } })],
    [label({ mapping: { display_name: "x", membership_id: null, version: "0", updated_at: "2026-09-28T05:00:00.000Z" } })]]) {
    assert.throws(() => read(bad), /unavailable/);
  }
  assert.throws(() => parseSalesManagerLabels({ organization_id: organizationId, labels: [] }, organizationId), /unavailable/);
  assert.throws(() => parseSalesManagerLabels({ organization_id: "22222222-2222-4222-8222-222222222222", labels: [], staff_options: [] }, organizationId), /unavailable/);
});
