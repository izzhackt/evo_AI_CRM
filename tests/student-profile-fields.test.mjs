import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  PROFILE_CANONICAL_FIELDS,
  PROFILE_FIELDS,
  PROFILE_FIELD_BY_KEY,
  PROFILE_FIELD_INPUT_MAX_LENGTH,
  PROFILE_FIELD_KEYS,
  PROFILE_GROUP_LABELS,
  PROFILE_GROUPS,
  PROFILE_REQUIRED_FIELD_KEYS,
  ProfileExportNotReadyError,
  fieldFormatIssue,
  getProfileExportValues,
  getProfileReadiness,
  isProfileFieldKey,
  normalizeDate,
  normalizePhone,
  normalizeProfileField,
} from "../src/lib/student-profile-fields.ts";

const OPTIONS = { today: "2026-09-13" };
const REQUIRED_KEYS = [
  "student_first_name", "student_last_name", "date_of_birth", "nationality", "passport_number",
  "permanent_address", "mobile_phone", "student_email", "field_major",
];

function completeFields() {
  const values = {
    student_first_name: "Synthetic",
    student_last_name: "Student",
    date_of_birth: "2008-02-29",
    nationality: "Synthetic country",
    passport_number: "TEST00001",
    permanent_address: "Synthetic address",
    mobile_phone: "+12025550100",
    student_email: "student@example.test",
    field_major: "Computer Science",
  };
  return Object.entries(values).map(([key, value]) => ({ key, value, state: "confirmed" }));
}

test("registry retains every original template key, group, requirement and character limit", () => {
  assert.equal(PROFILE_FIELDS.length, 61);
  assert.equal(new Set(PROFILE_FIELD_KEYS).size, 61);
  assert.deepEqual(PROFILE_REQUIRED_FIELD_KEYS, REQUIRED_KEYS);
  assert.deepEqual(PROFILE_GROUPS, ["personal", "education", "study_goal", "father", "mother", "emergency"]);
  assert.deepEqual(PROFILE_GROUPS.map((group) => PROFILE_FIELDS.filter((field) => field.group === group).length),
    [13, 18, 8, 7, 7, 8]);
  // Baseline computed from the actual standalone profile.ts at 6e7cf741,
  // excluding labels intentionally translated into Russian. No external checkout is needed at test time.
  const originalDescriptors = PROFILE_FIELDS.map(({ key, group, maxLength, required }) => ({ key, group, maxLength, required }));
  assert.equal(createHash("sha256").update(JSON.stringify(originalDescriptors)).digest("hex"),
    "3466e4c98f277eb53786c1a23608fce6db24807f274c72a1f21f0da27cada7f5");
  for (const definition of PROFILE_FIELDS) {
    assert.equal(PROFILE_FIELD_BY_KEY.get(definition.key), definition);
    assert.ok(/[А-Яа-яЁё]/u.test(definition.label) || definition.key === "whatsapp_telegram");
  }
  for (const group of PROFILE_GROUPS) assert.match(PROFILE_GROUP_LABELS[group], /[А-Яа-яЁё]/u);
});

test("only the three shared facts map to existing canonical columns", () => {
  assert.deepEqual(PROFILE_CANONICAL_FIELDS, {
    date_of_birth: "date_of_birth",
    nationality: "citizenship_country",
    country_of_residence: "residency_country",
  });
  assert.equal(PROFILE_FIELD_KEYS.filter((key) => !Object.hasOwn(PROFILE_CANONICAL_FIELDS, key)).length, 58);
  assert.equal(isProfileFieldKey("nationality"), true);
  for (const value of ["citizenship_country", "__proto__", "constructor", "made_up_field", null, 1]) {
    assert.equal(isProfileFieldKey(value), false);
  }
});

test("normalization handles Unicode, whitespace and source formats without inventing values", () => {
  assert.deepEqual(normalizeProfileField("student_email", "  ＳＴＵＤＥＮＴ@ＥＸＡＭＰＬＥ.ＴＥＳＴ  ", OPTIONS), {
    key: "student_email", value: "student@example.test", warnings: [], valid: true,
  });
  assert.equal(normalizeProfileField("passport_number", " test 000 01 ", OPTIONS).value, "TEST00001");
  assert.equal(normalizeProfileField("passport_number", "X".repeat(30), OPTIONS).valid, true);
  assert.equal(normalizeProfileField("passport_number", "X".repeat(31), OPTIONS).valid, false);
  assert.equal(normalizeProfileField("permanent_address", "  Synthetic\u0000 address\n line  ", OPTIONS).value, "Synthetic address line");
  for (const raw of ["да", "YES", "y", "oui", "true"]) {
    assert.equal(normalizeProfileField("scholarship_interest", raw, OPTIONS).value, "Yes");
  }
  for (const raw of ["нет", "NO", "n", "non", "false"]) {
    assert.equal(normalizeProfileField("previous_visa_refusals", raw, OPTIONS).value, "No");
  }
  assert.deepEqual(normalizeProfileField("nationality", null, OPTIONS), {
    key: "nationality", value: "", warnings: [], valid: true,
  });
  assert.equal(normalizeProfileField("chronic_conditions_allergies", "perhaps", OPTIONS).valid, false);
});

test("real calendar dates and UTC birth-date boundaries are checked", () => {
  for (const raw of ["29.02.2008", "2008/2/29", "29 2 2008"]) {
    assert.equal(normalizeDate(raw), "2008-02-29");
    assert.equal(normalizeProfileField("date_of_birth", raw, OPTIONS).valid, true);
  }
  for (const raw of ["31.04.2026", "29.02.1900", "29.02.2100", "2026-13-01", "2026-00-01", "2026-01-00", "1899-12-31", "2201-01-01", "2026", "not a date"]) {
    assert.equal(normalizeDate(raw), null, raw);
    assert.equal(normalizeProfileField("date_of_birth", raw, OPTIONS).valid, false, raw);
  }
  assert.equal(normalizeDate("29.02.2000"), "2000-02-29");
  assert.equal(fieldFormatIssue("date_of_birth", "2026-09-13", OPTIONS), null);
  assert.match(fieldFormatIssue("date_of_birth", "2026-09-14", OPTIONS), /будущем/);
  assert.equal(fieldFormatIssue("passport_expiry_date", "2036-09-14", OPTIONS), null);
  assert.equal(fieldFormatIssue("desired_start_date", "2027-09-01", OPTIONS), null);
  assert.equal(fieldFormatIssue("date_of_birth", "", OPTIONS), null);
  assert.throws(() => getProfileReadiness({ fields: [] }, { today: "2026-02-30" }), /invalid_today/);
});

test("phone cleanup preserves meaning and does not turn Telegram handles into phone numbers", () => {
  assert.equal(normalizePhone("+1 (202) 555-0100"), "+12025550100");
  assert.equal(normalizePhone("1234567"), "1234567");
  assert.equal(normalizePhone("123456789012345"), "123456789012345");
  for (const raw of ["123456", "1234567890123456", "call1234567", "+12+34567", "1234567 ext 1"]) {
    assert.equal(normalizePhone(raw), null);
    assert.equal(normalizeProfileField("mobile_phone", raw, OPTIONS).valid, false);
  }
  assert.equal(normalizeProfileField("whatsapp_telegram", "@contact1234567", OPTIONS).value, "@contact1234567");
  assert.equal(normalizeProfileField("whatsapp_telegram", "+1 (202) 555-0100", OPTIONS).value, "+12025550100");
  assert.equal(fieldFormatIssue("emergency_contact_phone_email", "contact@example.test / +1 202 555 0100", OPTIONS), null);
  assert.match(fieldFormatIssue("father_work_email", "invalid-email", OPTIONS), /почты/);
  assert.match(fieldFormatIssue("mother_mobile_phone", "1234", OPTIONS), /телефон/);
});

test("canonical countries over the template limit are retained and block either export", () => {
  for (const key of ["nationality", "country_of_residence"]) {
    assert.equal(normalizeProfileField(key, "X".repeat(60), OPTIONS).valid, true);
    const raw = "X".repeat(120);
    const normalized = normalizeProfileField(key, raw, OPTIONS);
    assert.equal(normalized.value, raw);
    assert.equal(normalized.valid, false);
    assert.match(normalized.warnings.join(" "), /60.*не обрезано/);
    const fields = completeFields().filter((field) => field.key !== key);
    fields.push({ key, value: raw, state: "confirmed" });
    const snapshot = { fields };
    assert.ok(getProfileReadiness(snapshot, OPTIONS).invalid.some((issue) => issue.key === key));
    assert.throws(() => getProfileExportValues(snapshot, "draft", OPTIONS), ProfileExportNotReadyError);
    assert.throws(() => getProfileExportValues(snapshot, "final", OPTIONS), ProfileExportNotReadyError);
    assert.equal(fields.at(-1).value, raw);
  }
  assert.equal(normalizeProfileField("why_this_field", "X".repeat(500), OPTIONS).valid, true);
  assert.equal(normalizeProfileField("why_this_field", "X".repeat(501), OPTIONS).valid, false);
});

test("confirmed supplementary-CJK values stay exportable at the template character limit", () => {
  for (const [key, maximum] of [["student_first_name", 60], ["permanent_address", 180], ["nationality", 60]]) {
    const value = "𠮷".repeat(maximum);
    assert.equal(normalizeProfileField(key, value, OPTIONS).valid, true);
    const fields = completeFields().map((field) => field.key === key ? { ...field, value } : field);
    const snapshot = { fields };
    assert.equal(getProfileReadiness(snapshot, OPTIONS).ready, true);
    assert.equal(getProfileExportValues(snapshot, "draft", OPTIONS)[key], value);
    assert.equal(getProfileExportValues(snapshot, "final", OPTIONS)[key], value);

    const overLimit = `${value}𠮷`;
    const normalized = normalizeProfileField(key, overLimit, OPTIONS);
    assert.equal(normalized.valid, false);
    assert.equal(normalized.value, overLimit);
  }
});

test("all nine required fields must be present, nonempty, valid and confirmed for a final profile", () => {
  const empty = getProfileReadiness({ fields: [] }, OPTIONS);
  assert.equal(empty.ready, false);
  assert.deepEqual(empty.missingRequired.map(({ key }) => key), REQUIRED_KEYS);
  const complete = { fields: completeFields() };
  assert.equal(getProfileReadiness(complete, OPTIONS).ready, true);
  assert.equal(Object.keys(getProfileExportValues(complete, "final", OPTIONS)).length, 9);
  for (const key of REQUIRED_KEYS) {
    const missing = { fields: completeFields().filter((field) => field.key !== key) };
    assert.deepEqual(getProfileReadiness(missing, OPTIONS).missingRequired.map((issue) => issue.key), [key]);
    for (const value of [null, "", "   "]) {
      const fields = completeFields().map((field) => field.key === key ? { ...field, value } : field);
      assert.deepEqual(getProfileReadiness({ fields }, OPTIONS).missingRequired.map((issue) => issue.key), [key]);
      assert.throws(() => getProfileExportValues({ fields }, "final", OPTIONS), ProfileExportNotReadyError);
    }
    for (const state of ["extracted", "needs_review", "conflict"]) {
      const fields = completeFields().map((field) => field.key === key ? { ...field, state } : field);
      assert.equal(getProfileReadiness({ fields }, OPTIONS).ready, false);
      assert.throws(() => getProfileExportValues({ fields }, "final", OPTIONS), ProfileExportNotReadyError);
    }
  }
});

test("confirmed optional empty values remain explicit decisions distinct from absent or unreviewed values", () => {
  const fields = completeFields();
  fields.push({ key: "father_first_name", value: null, state: "confirmed" });
  fields.push({ key: "mother_first_name", value: "  ", state: "confirmed" });
  fields.push({ key: "lead_source", value: "", state: "extracted" });
  const readiness = getProfileReadiness({ fields }, OPTIONS);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.confirmedEmpty, ["father_first_name", "mother_first_name"]);
  const values = getProfileExportValues({ fields }, "final", OPTIONS);
  assert.equal(values.father_first_name, "");
  assert.equal(values.mother_first_name, "");
  assert.equal(Object.hasOwn(values, "father_last_name"), false);
  assert.equal(Object.hasOwn(values, "lead_source"), false);
});

test("optional conflicts block final export even with null, empty or whitespace values", () => {
  for (const value of [null, "", " \n ", "Synthetic"]) {
    const fields = [...completeFields(), { key: "father_first_name", value, state: "conflict" }];
    const readiness = getProfileReadiness({ fields }, OPTIONS);
    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.conflicts.map(({ key }) => key), ["father_first_name"]);
    assert.equal(readiness.missingRequired.length, 0);
    assert.equal(Object.hasOwn(getProfileExportValues({ fields }, "draft", OPTIONS), "father_first_name"), false);
    assert.throws(() => getProfileExportValues({ fields }, "final", OPTIONS), (error) => {
      assert.ok(error instanceof ProfileExportNotReadyError);
      assert.equal(error.issues[0].kind, "conflict");
      return true;
    });
  }
});

test("draft export uses only confirmed valid values without promoting suggestions or conflicts", () => {
  const fields = [
    { key: "student_first_name", value: "Synthetic", state: "confirmed" },
    { key: "mother_work_email", value: "mother@example.test", state: "extracted" },
    { key: "father_work_email", value: "father@example.test", state: "needs_review" },
    { key: "lead_source", value: "Synthetic", state: "conflict" },
    { key: "education_1_school_name", value: "", state: "confirmed" },
  ];
  const original = structuredClone(fields);
  fields.forEach(Object.freeze);
  Object.freeze(fields);
  const snapshot = Object.freeze({ fields });
  assert.deepEqual(getProfileExportValues(snapshot, "draft", OPTIONS), { student_first_name: "Synthetic", education_1_school_name: "" });
  const readiness = getProfileReadiness(snapshot, OPTIONS);
  assert.equal(readiness.unconfirmed.length, 2);
  assert.equal(readiness.invalid.length, 0);
  assert.equal(readiness.conflicts.length, 1);
  assert.throws(() => getProfileExportValues(snapshot, "final", OPTIONS), ProfileExportNotReadyError);
  assert.deepEqual(fields, original);
});

test("invalid optional confirmed values block final and draft instead of being silently omitted", () => {
  for (const [key, value] of [["passport_expiry_date", "31.04.2030"], ["mother_work_email", "invalid"], ["scholarship_interest", "maybe"], ["conditions_details", "X".repeat(241)]]) {
    const snapshot = { fields: [...completeFields(), { key, value, state: "confirmed" }] };
    const readiness = getProfileReadiness(snapshot, OPTIONS);
    assert.equal(readiness.missingRequired.length, 0);
    assert.deepEqual(readiness.invalid.map((issue) => issue.key), [key]);
    assert.throws(() => getProfileExportValues(snapshot, "final", OPTIONS), ProfileExportNotReadyError);
    assert.throws(() => getProfileExportValues(snapshot, "draft", OPTIONS), (error) => {
      assert.ok(error instanceof ProfileExportNotReadyError);
      assert.deepEqual(error.issues.map(({ key, kind }) => ({ key, kind })), [{ key, kind: "invalid" }]);
      return true;
    });
  }
});

test("draft ignores invalid unconfirmed suggestions but rejects invalid confirmed facts", () => {
  for (const [key, value] of [["student_email", "not an email"], ["date_of_birth", "2026-09-14"]]) {
    for (const state of ["extracted", "needs_review", "conflict"]) {
      assert.deepEqual(getProfileExportValues({ fields: [{ key, value, state }] }, "draft", OPTIONS), {});
    }
    assert.throws(() => getProfileExportValues({ fields: [{ key, value, state: "confirmed" }] }, "draft", OPTIONS), (error) => {
      assert.ok(error instanceof ProfileExportNotReadyError);
      assert.deepEqual(error.issues.map(({ key, kind }) => ({ key, kind })), [{ key, kind: "invalid" }]);
      return true;
    });
  }
});

test("optional nonempty suggestions require confirmation even after every required field is ready", () => {
  for (const state of ["extracted", "needs_review"]) {
    const snapshot = { fields: [...completeFields(), { key: "lead_source", value: "Synthetic", state }] };
    const readiness = getProfileReadiness(snapshot, OPTIONS);
    assert.equal(readiness.missingRequired.length, 0);
    assert.equal(readiness.invalid.length, 0);
    assert.deepEqual(readiness.unconfirmed.map(({ key }) => key), ["lead_source"]);
    assert.throws(() => getProfileExportValues(snapshot, "final", OPTIONS), ProfileExportNotReadyError);
  }
});

test("the input bound counts supplementary-CJK characters like the database and DTO", () => {
  const value = "𠮷".repeat(4096);
  const normalized = normalizeProfileField("permanent_address", value, OPTIONS);
  assert.equal(normalized.value, value);
  assert.equal(normalized.valid, false);
  assert.match(normalized.warnings[0], /180/);
  assert.throws(() => normalizeProfileField("permanent_address", `${value}𠮷`, OPTIONS), /input_too_long/);
});

test("bounded input validation rejects ambiguous or malformed snapshots without echoing values", () => {
  for (const snapshot of [null, {}, { fields: {} }, { fields: Array(62).fill(null) },
    { fields: [null] }, { fields: [{ key: "__proto__", value: "synthetic-private-value", state: "confirmed" }] },
    { fields: [{ key: "student_first_name", value: "synthetic-private-value", state: "approved" }] },
    { fields: [{ key: "student_first_name", value: 42, state: "confirmed" }] }]) {
    assert.throws(() => getProfileReadiness(snapshot, OPTIONS), (error) => {
      assert.ok(error instanceof TypeError);
      assert.doesNotMatch(error.message, /synthetic-private-value/);
      return true;
    });
  }
  const duplicate = { fields: [...completeFields(), { key: "student_email", value: "other@example.test", state: "confirmed" }] };
  assert.throws(() => getProfileExportValues(duplicate, "draft", OPTIONS), /duplicate_key/);
  assert.throws(() => getProfileExportValues(duplicate, "final", OPTIONS), /duplicate_key/);
  assert.throws(() => normalizeProfileField("student_first_name", "X".repeat(PROFILE_FIELD_INPUT_MAX_LENGTH + 1), OPTIONS), /input_too_long/);
  assert.equal(normalizeDate(" ".repeat(PROFILE_FIELD_INPUT_MAX_LENGTH) + "2000-01-01"), null);
  assert.equal(normalizePhone(" ".repeat(PROFILE_FIELD_INPUT_MAX_LENGTH) + "1234567"), null);
  assert.throws(() => normalizeProfileField("unknown_field", "Synthetic", OPTIONS), /unknown_key/);
  assert.throws(() => getProfileExportValues({ fields: completeFields() }, "other", OPTIONS), /invalid_export_mode/);
});
