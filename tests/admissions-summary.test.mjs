// Unified workflow S4: the route/playbook/message-template UI and the
// visa-case CRUD form are retired (tests/admissions-playbook.test.mjs is
// deleted along with them). This file keeps the handful of assertions that
// targeted code S4 does NOT delete: the pruned admissions-summary
// normalizer, the general-purpose calendar-month helper, and the
// «Студенты» directory RPC-argument builder — none of which are
// route/playbook-specific.
import assert from "node:assert/strict";
import test from "node:test";
import { ADMISSIONS_DIRECTIONS } from "../src/lib/platform-admissions-playbook-contract.ts";
import { admissionsReportPeriod } from "../src/lib/admissions-report-period.ts";
import { normalizeAdmissionsSummary } from "../src/lib/v3/admissions-source.ts";
import { buildPlatformStudentCasePageRpcArguments, normalizePlatformStudentCaseQueueRow } from "../src/lib/platform-admissions.ts";

const ID = "33333333-3333-4333-8333-333333333333";

test("summary keeps only tracked counts (active/overdue/awaiting_ack/needs_curator) and rejects invalid or duplicate rows", () => {
  // S4 (plan §12): awaiting_partner/submitted/decisions/visas/arrivals/
  // cancelled/arrived and the whole periodArrivals metric are gone —
  // migration 183 narrows admissions_direction_summary_v1 to match.
  const stock = ADMISSIONS_DIRECTIONS.map((direction) => ({ direction, active: 0, overdue: 0, awaiting_ack: 0, needs_curator: 0 }));
  const row = { stock };
  assert.deepEqual(normalizeAdmissionsSummary(row).stock, stock);
  assert.throws(() => normalizeAdmissionsSummary({ stock: [{ ...stock[0], active: -1 }] }));
  assert.throws(() => normalizeAdmissionsSummary({ stock: [stock[0], stock[0]] }));
  // Legacy keys on an input row are simply ignored, not resurrected.
  assert.equal(normalizeAdmissionsSummary({ stock, awaiting_partner: 99, periodArrivals: [{ direction: "CN", count: 3 }] }).periodArrivals, undefined);
});

test("calendar month handling uses real inclusive dates, including leap years", () => {
  assert.deepEqual(admissionsReportPeriod("2028-02"), { month: "2028-02", from: "2028-02-01", to: "2028-02-29" });
  assert.equal(admissionsReportPeriod("2026-02").to, "2026-02-28");
  assert.equal(admissionsReportPeriod(undefined, new Date("2026-08-31T20:00:00Z")).month, "2026-09");
  for (const value of ["", "2026-13", "2026-2", "2026-02-01", "1900-01"]) assert.equal(admissionsReportPeriod(value), null);
});

test("directory passes typed filters to server before paging, not browser post-filter", () => {
  assert.deepEqual(buildPlatformStudentCasePageRpcArguments({ pageSize: 25, direction: "MY", curatorMembershipId: ID, attention: "needs_curator" }), { p_limit: 26, p_direction: "MY", p_curator_membership_id: ID, p_attention: "needs_curator" });
  assert.equal(buildPlatformStudentCasePageRpcArguments({ direction: "unknown" }).p_direction, "unknown");
  for (const options of [{ direction: "else" }, { attention: "done" }, { curatorMembershipId: "arbitrary" }]) assert.throws(() => buildPlatformStudentCasePageRpcArguments(options));
  assert.equal(typeof normalizePlatformStudentCaseQueueRow, "function");
});
