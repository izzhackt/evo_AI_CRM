import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMISSIONS_CSV_COLUMNS,
  ADMISSIONS_NO_CURATOR,
  admissionsCsvOrder,
  admissionsCuratorOptions,
  admissionsFilterQuery,
  filterAdmissionsCases,
  isEmptyAdmissionsFilter,
  parseAdmissionsFilter,
  serializeAdmissionsCsv,
} from "../src/lib/platform-admissions-filters.ts";

function row(overrides = {}) {
  return {
    studentCaseId: "11111111-1111-4111-8111-111111111111",
    studentDisplayName: "Айжан",
    targetCountry: "Малайзия",
    operationalStage: "documents",
    state: "active",
    currentCuratorDisplayName: "Нурлан",
    intake: "2026 сентябрь",
    createdAt: "2026-03-15T10:00:00+00:00",
    overdueTaskCount: 0,
    overdueObligationCount: 0,
    rejectedDocumentCount: 0,
    ...overrides,
  };
}

test("parseAdmissionsFilter accepts a well-formed range and owner", () => {
  assert.deepEqual(
    parseAdmissionsFilter({
      from: "2026-01-01",
      to: "2026-12-31",
      curator: " Нурлан ",
    }),
    { from: "2026-01-01", to: "2026-12-31", curator: "Нурлан" },
  );
});

test("parseAdmissionsFilter drops a malformed or impossible date", () => {
  for (const value of ["2026-13-01", "2026-02-31", "15.03.2026", "2026-3-1", ""]) {
    assert.equal(parseAdmissionsFilter({ from: value }).from, null, value);
  }
});

test("parseAdmissionsFilter drops an inverted range rather than showing nothing", () => {
  const filter = parseAdmissionsFilter({
    from: "2026-12-31",
    to: "2026-01-01",
    curator: "Нурлан",
  });
  assert.equal(filter.from, null);
  assert.equal(filter.to, null);
  assert.equal(filter.curator, "Нурлан");
});

test("parseAdmissionsFilter ignores a repeated parameter", () => {
  assert.equal(
    parseAdmissionsFilter({ from: ["2026-01-01", "2026-02-01"] }).from,
    null,
  );
});

test("an empty filter returns the same rows", () => {
  const rows = [row()];
  const filter = parseAdmissionsFilter({});
  assert.equal(isEmptyAdmissionsFilter(filter), true);
  assert.equal(filterAdmissionsCases(rows, filter), rows);
});

test("the date filter is inclusive on both ends", () => {
  const rows = [
    row({ studentCaseId: "a", createdAt: "2026-03-01T00:00:00+00:00" }),
    row({ studentCaseId: "b", createdAt: "2026-03-15T00:00:00+00:00" }),
    row({ studentCaseId: "c", createdAt: "2026-03-31T23:59:00+00:00" }),
  ];
  const matched = filterAdmissionsCases(
    rows,
    parseAdmissionsFilter({ from: "2026-03-01", to: "2026-03-31" }),
  );
  assert.deepEqual(matched.map((item) => item.studentCaseId), ["a", "b", "c"]);
});

test("the date filter excludes rows outside the range", () => {
  const rows = [
    row({ studentCaseId: "early", createdAt: "2026-02-28T00:00:00+00:00" }),
    row({ studentCaseId: "inside", createdAt: "2026-03-10T00:00:00+00:00" }),
    row({ studentCaseId: "late", createdAt: "2026-04-01T00:00:00+00:00" }),
  ];
  const matched = filterAdmissionsCases(
    rows,
    parseAdmissionsFilter({ from: "2026-03-01", to: "2026-03-31" }),
  );
  assert.deepEqual(matched.map((item) => item.studentCaseId), ["inside"]);
});

test("a row without a creation date cannot satisfy a date range", () => {
  const matched = filterAdmissionsCases(
    [row({ createdAt: null })],
    parseAdmissionsFilter({ from: "2026-03-01" }),
  );
  assert.deepEqual(matched, []);
});

test("a row without a creation date survives an owner-only filter", () => {
  const matched = filterAdmissionsCases(
    [row({ createdAt: null })],
    parseAdmissionsFilter({ curator: "Нурлан" }),
  );
  assert.equal(matched.length, 1);
});

test("the owner filter matches an exact display name", () => {
  const rows = [row(), row({ studentCaseId: "b", currentCuratorDisplayName: "Айгуль" })];
  const matched = filterAdmissionsCases(
    rows,
    parseAdmissionsFilter({ curator: "Айгуль" }),
  );
  assert.deepEqual(matched.map((item) => item.studentCaseId), ["b"]);
});

test("the owner filter can select cases with no curator", () => {
  const rows = [
    row(),
    row({ studentCaseId: "b", currentCuratorDisplayName: null }),
  ];
  const matched = filterAdmissionsCases(
    rows,
    parseAdmissionsFilter({ curator: ADMISSIONS_NO_CURATOR }),
  );
  assert.deepEqual(matched.map((item) => item.studentCaseId), ["b"]);
});

test("admissionsCuratorOptions lists each assigned curator once", () => {
  assert.deepEqual(
    admissionsCuratorOptions([
      row(),
      row({ studentCaseId: "b" }),
      row({ studentCaseId: "c", currentCuratorDisplayName: "Айгуль" }),
      row({ studentCaseId: "d", currentCuratorDisplayName: null }),
    ]),
    ["Айгуль", "Нурлан"],
  );
});

test("admissionsFilterQuery round-trips through parseAdmissionsFilter", () => {
  const filter = parseAdmissionsFilter({
    from: "2026-01-01",
    to: "2026-06-30",
    curator: "Нурлан",
  });
  const query = admissionsFilterQuery(filter);
  const params = Object.fromEntries(new URLSearchParams(query.slice(1)));
  assert.deepEqual(parseAdmissionsFilter(params), filter);
});

test("admissionsFilterQuery is empty for an empty filter", () => {
  assert.equal(admissionsFilterQuery(parseAdmissionsFilter({})), "");
});

test("the CSV header matches the declared columns", () => {
  const [header] = serializeAdmissionsCsv([]).split("\r\n");
  assert.equal(header, ADMISSIONS_CSV_COLUMNS.map((c) => `"${c}"`).join(","));
});

test("the CSV reports the funnel step, including the out-of-funnel answers", () => {
  const csv = serializeAdmissionsCsv([
    row({ studentCaseId: "in", operationalStage: "visa" }),
    row({ studentCaseId: "before", operationalStage: "intake" }),
    row({ studentCaseId: "unknown", operationalStage: "invented_stage" }),
    row({ studentCaseId: "closed", state: "closed" }),
  ]);
  const steps = csv
    .split("\r\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split(",")[3]);
  assert.deepEqual(steps, [
    '"visa"',
    '"before_delivery"',
    '"unknown"',
    '"closed"',
  ]);
});

test("the CSV neutralizes a spreadsheet formula and flattens line breaks", () => {
  const csv = serializeAdmissionsCsv([
    row({ studentDisplayName: " =1+1", targetCountry: "Ма\nлайзия" }),
  ]);
  const cells = csv.split("\r\n")[1].split(",");
  assert.equal(cells[1], `"' =1+1"`);
  assert.equal(cells[2], '"Ма лайзия"');
});

test("the CSV escapes an embedded quote", () => {
  const csv = serializeAdmissionsCsv([row({ studentDisplayName: 'А"й' })]);
  assert.ok(csv.includes('"А""й"'));
});

test("admissionsCsvOrder groups by country, then by funnel step", () => {
  const ordered = admissionsCsvOrder([
    row({ studentCaseId: "1", targetCountry: "Малайзия", operationalStage: "visa" }),
    row({ studentCaseId: "2", targetCountry: "Малайзия", operationalStage: "documents" }),
    row({ studentCaseId: "3", targetCountry: "Кыргызстан", operationalStage: "enrolled" }),
  ]);
  assert.deepEqual(ordered.map((item) => item.studentCaseId), ["3", "2", "1"]);
});
