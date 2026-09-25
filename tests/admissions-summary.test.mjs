// Unified workflow S4: the route/playbook/message-template UI and the
// visa-case CRUD form are retired (tests/admissions-playbook.test.mjs is
// deleted along with them). This file keeps the assertions that target code
// S4 does NOT delete: the general-purpose calendar-month helper and the
// «Студенты» directory RPC-argument builder. The admissions-summary
// normalizer went with its last reader (the «Студенты» facets, 25.09).
import assert from "node:assert/strict";
import test from "node:test";
import { admissionsReportPeriod } from "../src/lib/admissions-report-period.ts";
import { buildPlatformStudentCasePageRpcArguments, normalizePlatformStudentCaseQueueRow } from "../src/lib/platform-admissions.ts";

const ID = "33333333-3333-4333-8333-333333333333";

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
