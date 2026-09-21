import assert from "node:assert/strict";
import test from "node:test";
import { universityIntakeLabel } from "../src/lib/platform-university-catalog.ts";
import { staffUniversityDeadline } from "../src/lib/university-staff-deadline.ts";

// Pure temporal cases only; these are not published records or actual UI proof.
const now = new Date("2026-09-21T12:00:00Z");
const intake = (overrides = {}) => ({
  label: "Осенний набор", startDate: null, startMonth: "2026-10",
  applicationDeadline: "2026-09-22", deadlineTime: null, timezone: "UTC",
  status: "open", note: "", sourceUrl: "https://www.apu.edu.my/admissions",
  verifiedOn: "2026-09-20", ...overrides,
});
const program = (id, intakes, level = "bachelor") => ({
  id, title: id, level, duration: null, language: null, summary: "",
  sourceUrl: "https://www.apu.edu.my/admissions", intakes,
});
const choose = (value, instant = now) => staffUniversityDeadline([program("degree", [value])], "", instant);

test("selection preserves the exact programme, intake and provenance within the selected level", () => {
  const bachelor = program("bachelor", [intake()]);
  const master = program("master", [intake({ applicationDeadline: "2026-09-23" })], "master");
  const programs = [master, bachelor];
  assert.strictEqual(staffUniversityDeadline(programs, "", now).program, bachelor);
  const selected = staffUniversityDeadline(programs, "master", now);
  assert.strictEqual(selected.program, master);
  assert.strictEqual(selected.intake, master.intakes[0]);
  assert.equal(selected.applicationDeadline, "2026-09-23");
  assert.equal(staffUniversityDeadline(programs, "language", now), null);
});

test("only open or announced deadlines are candidates; a start date is never a deadline", () => {
  for (const status of ["closed", "unknown", "needs_reconfirmation", "confirmed"]) {
    assert.equal(choose(intake({ status })), null, status);
  }
  for (const status of ["open", "announced"]) assert.ok(choose(intake({ status })));
  assert.equal(choose(intake({ applicationDeadline: null, startDate: "2026-12-01", startMonth: "2026-12" })), null);
});

test("missing or unsupported zone and non-contract aliases/offsets never fall back", () => {
  for (const timezone of [null, "", "Europe/NotAZone", "CET", "+03:00", "utc", "posix/Europe/Paris", "right/Europe/Paris"]) {
    assert.equal(choose(intake({ timezone })), null, String(timezone));
  }
  for (const timezone of ["UTC", "GMT", "Asia/Bishkek", "Etc/GMT+8"]) {
    assert.ok(choose(intake({ timezone })), timezone);
  }
});

test("date and source validation fail closed, without accepting a future verification", () => {
  for (const applicationDeadline of ["2026-02-30", "2026-9-22", "", null]) {
    assert.equal(choose(intake({ applicationDeadline })), null);
  }
  for (const sourceUrl of ["http://www.apu.edu.my/admissions", "https://localhost/path", "https://www.apu.edu.my/?token=secret", ""]) {
    assert.equal(choose(intake({ sourceUrl })), null);
  }
  for (const verifiedOn of ["2026-09-22", "2026-02-30", "", null]) {
    assert.equal(choose(intake({ verifiedOn })), null);
  }
  assert.ok(choose(intake({ verifiedOn: "2026-09-21" })));
  assert.ok(choose(intake({ verifiedOn: "2020-01-01" })), "no invented verification expiry policy");
  assert.equal(choose(intake(), new Date(NaN)), null);
});

test("one instant can be different local calendar days; expiry and verification use the intake zone", () => {
  const instant = new Date("2026-09-21T23:30:00Z");
  const value = intake({ applicationDeadline: "2026-09-21" });
  assert.ok(choose({ ...value, timezone: "America/Los_Angeles" }, instant));
  assert.equal(choose({ ...value, timezone: "Asia/Tokyo" }, instant), null);
  const early = new Date("2026-09-21T00:30:00Z");
  assert.equal(choose(intake({ timezone: "America/Los_Angeles", verifiedOn: "2026-09-21" }), early), null);
  assert.ok(choose(intake({ timezone: "Asia/Tokyo", verifiedOn: "2026-09-21" }), early));
});

test("timed deadline expires at its local minute; date-only today remains a date", () => {
  const value = intake({ applicationDeadline: "2026-09-21" });
  assert.ok(choose({ ...value, deadlineTime: "12:01" }));
  assert.equal(choose({ ...value, deadlineTime: "12:00" }), null);
  assert.equal(choose({ ...value, deadlineTime: "11:59" }), null);
  assert.ok(choose(value, new Date("2026-09-21T23:59:59Z")));
  assert.equal(choose(value, new Date("2026-09-22T00:00:00Z")), null);
  for (const deadlineTime of ["24:00", "9:00", "12:60", ""]) assert.equal(choose({ ...value, deadlineTime }), null);
});

test("expiry matches existing labels across local midnight and DST minute boundaries", () => {
  const cases = [
    ["Asia/Shanghai", "2026-09-21", null, "2026-09-21T15:59:59Z", true],
    ["Asia/Shanghai", "2026-09-21", null, "2026-09-21T16:00:00Z", false],
    ["America/New_York", "2026-11-01", "01:31", "2026-11-01T05:30:00Z", true],
    ["America/New_York", "2026-11-01", "01:30", "2026-11-01T05:30:00Z", false],
    ["America/New_York", "2026-11-01", "01:31", "2026-11-01T06:30:00Z", true],
    ["America/New_York", "2026-11-01", "01:30", "2026-11-01T06:30:00Z", false],
  ];
  for (const [timezone, applicationDeadline, deadlineTime, iso, expected] of cases) {
    const value = intake({ timezone, applicationDeadline, deadlineTime });
    const instant = new Date(iso);
    assert.equal(choose(value, instant) !== null, expected, `${timezone}/${iso}`);
    assert.equal(universityIntakeLabel(value, instant), expected ? "Приём открыт по данным источника" : "Опубликованный срок приёма прошёл");
  }
});

test("rank published calendar dates, not timezone-free hours or an alleged absolute instant", () => {
  const laterInstant = program("a", [intake({ timezone: "Pacific/Honolulu", applicationDeadline: "2026-09-22", deadlineTime: "23:00" })]);
  const earlierInstant = program("z", [intake({ timezone: "Asia/Tokyo", applicationDeadline: "2026-09-23", deadlineTime: "00:01" })]);
  assert.strictEqual(staffUniversityDeadline([earlierInstant, laterInstant], "", now).program, laterInstant);
  const sameDayEarlierTime = program("z", [intake({ timezone: "Asia/Tokyo", applicationDeadline: "2026-09-22", deadlineTime: "00:01" })]);
  const selected = staffUniversityDeadline([sameDayEarlierTime, laterInstant], "", now);
  assert.strictEqual(selected.program, laterInstant, "same date ties use program id, not local HH:mm");
  assert.equal(selected.sameDateCount, 1);
});

test("ties are stable by program id and original intake index, with no invented legacy identity", () => {
  const first = intake({ label: "Первый опубликованный набор" });
  const second = intake({ label: "Второй набор", id: "59948000-0000-4000-8000-000000000001" });
  const a = program("a", [first, second]);
  const z = program("z", [intake()]);
  const selected = staffUniversityDeadline([z, a], "", now);
  assert.strictEqual(selected.program, a);
  assert.strictEqual(selected.intake, first);
  assert.equal(selected.sameDateCount, 2);
  assert.equal(Object.hasOwn(first, "id"), false);
  assert.strictEqual(staffUniversityDeadline([a, z], "", now).intake, first);
});

test("selection does not mutate input order, programmes or intakes", () => {
  const programs = [program("z", [intake({ applicationDeadline: "2026-10-01" }), intake()]), program("a", [intake()])];
  const before = structuredClone(programs);
  for (const item of programs) {
    item.intakes.forEach(Object.freeze);
    Object.freeze(item.intakes); Object.freeze(item);
  }
  Object.freeze(programs);
  assert.equal(staffUniversityDeadline(programs, "", now).program.id, "a");
  assert.deepEqual(programs, before);
  assert.equal(staffUniversityDeadline([], "", now), null);
});
