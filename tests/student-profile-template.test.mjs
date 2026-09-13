import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { PROFILE_FIELDS, PROFILE_FIELD_BY_KEY } from "../src/lib/student-profile-fields.ts";
import { renderStudentProfileTemplate, STUDENT_PROFILE_TEMPLATE_SHA256,
  STUDENT_PROFILE_DRAFT_WARNING, StudentProfileTemplateError } from "../src/lib/server/student-profile-template.ts";

const template = readFileSync(new URL("../assets/templates/student-profile.docx", import.meta.url));
const originalZip = new PizZip(template);
const bodyOf = (bytes) => new DOMParser().parseFromString(new PizZip(bytes).file("word/document.xml").asText(),
  "application/xml").getElementsByTagName("w:body").item(0);
const children = (node, tag) => Array.from(node.childNodes).filter((child) => child.nodeName === tag);
const text = (node) => Array.from(node.getElementsByTagName("w:t")).map((item) => item.textContent).join("");
const ordinarySlots = [
  ["student_first_name", "student_last_name"],
  ["date_of_birth", "nationality", "passport_number"],
  ["passport_expiry_date", "country_of_residence"],
  ["mobile_phone", "whatsapp_telegram", "student_email"],
  ["chinese_level_hsk", "english_level"],
  null,
  ["current_study_status", "expected_graduation_year"],
  ["desired_country_of_study", "desired_university"],
  ["field_major", "program_level", "desired_start_date"],
  ["budget_per_year", "scholarship_interest"],
  ["father_first_name", "father_last_name"],
  ["father_employer", "father_job_title", "father_mobile_phone"],
  ["father_work_email", "father_personal_email"],
  ["mother_first_name", "mother_last_name"],
  ["mother_employer", "mother_job_title", "mother_mobile_phone"],
  ["mother_work_email", "mother_personal_email"],
  ["emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone_email"],
  ["previous_visa_refusals", "visa_refusal_country"],
  ["chronic_conditions_allergies", "conditions_details"],
];
const paragraphSlots = [[8, "permanent_address"], [17, "extracurricular_achievements"],
  [24, "why_this_field"], [43, "lead_source"]];
const educationColumns = ["school_name", "country_city", "year_from", "year_to", "degree_certificate"];
function slotRuns(body) {
  const slots = new Map(), tables = children(body, "w:tbl"), paragraphs = children(body, "w:p");
  ordinarySlots.forEach((keys, table) => keys?.forEach((key, cell) => {
    const p = children(children(children(tables[table], "w:tr")[0], "w:tc")[cell], "w:p")[0];
    slots.set(key, children(p, "w:r")[1]);
  }));
  for (let row = 1; row <= 3; row++) educationColumns.forEach((suffix, index) => {
    const cell = children(children(tables[5], "w:tr")[row], "w:tc")[index + 1];
    slots.set(`education_${row}_${suffix}`, children(children(cell, "w:p")[0], "w:r")[0]);
  });
  for (const [index, key] of paragraphSlots) slots.set(key, children(paragraphs[index], "w:r")[1]);
  return slots;
}

test("retained reference has the approved hash and exactly61 distinct mapped fields", () => {
  assert.equal(createHash("sha256").update(template).digest("hex"), STUDENT_PROFILE_TEMPLATE_SHA256);
  assert.equal(children(bodyOf(template), "w:tbl").length, 19);
  assert.equal(children(bodyOf(template), "w:p").length, 48);
  assert.equal(slotRuns(bodyOf(template)).size, 61);
  assert.deepEqual([...slotRuns(bodyOf(template)).keys()].sort(), PROFILE_FIELDS.map((field) => field.key).sort());
});

test("all61 values reach their own original slot without changing any other package part", () => {
  const values = Object.fromEntries(PROFILE_FIELDS.map((field, index) => [field.key, String(index + 1).padStart(3, "0")]));
  const output = renderStudentProfileTemplate(template, values, "final");
  const outputZip = new PizZip(output), body = bodyOf(output), originalBody = bodyOf(template);
  for (const [key, run] of slotRuns(body)) assert.equal(text(run), values[key], key);
  assert.deepEqual(Object.keys(outputZip.files).sort(), Object.keys(originalZip.files).sort());
  for (const [name, file] of Object.entries(originalZip.files)) {
    if (name !== "word/document.xml") assert.deepEqual(outputZip.files[name].asNodeBuffer(), file.asNodeBuffer(), name);
  }
  assert.equal(children(body, "w:tbl").length, 19);
  assert.equal(children(body, "w:sectPr")[0].toString(), children(originalBody, "w:sectPr")[0].toString());
  const tables = children(body, "w:tbl"), originals = children(originalBody, "w:tbl");
  tables.forEach((table, index) => {
    assert.equal(children(table, "w:tblPr")[0].toString(), children(originals[index], "w:tblPr")[0].toString());
    assert.equal(children(table, "w:tblGrid")[0].toString(), children(originals[index], "w:tblGrid")[0].toString());
  });
  for (const index of [0, 1, 2, 45, 46, 47]) {
    assert.equal(children(body, "w:p")[index].toString(), children(originalBody, "w:p")[index].toString());
  }
  assert.ok(!text(body).includes(STUDENT_PROFILE_DRAFT_WARNING));
});

test("omitted fields stay blank while an explicitly confirmed empty clears only its response", () => {
  const body = bodyOf(renderStudentProfileTemplate(template, { father_first_name: "" }, "final"));
  const slots = slotRuns(body), originalSlots = slotRuns(bodyOf(template));
  assert.equal(text(slots.get("father_first_name")), "");
  for (const [key, run] of slots) if (key !== "father_first_name") assert.equal(text(run), text(originalSlots.get(key)), key);
  assert.match(text(children(body, "w:tbl")[10]), /First Name/);
});

test("draft has exactly one explicit Russian warning and preserves all six section headings", () => {
  const body = bodyOf(renderStudentProfileTemplate(template, { student_first_name: "Айжан" }, "draft"));
  const paragraphs = children(body, "w:p");
  assert.equal(paragraphs.length, 49);
  assert.equal(text(paragraphs[0]), STUDENT_PROFILE_DRAFT_WARNING);
  assert.equal(paragraphs.filter((p) => text(p).includes("ЧЕРНОВИК")).length, 1);
  assert.equal(paragraphs.filter((p) => /^\s*[1-6]\.\s/.test(text(p))).length, 6);
  assert.match(text(body), /Айжан/);
});

test("every section heading and its intervening subheading stay with the first table", () => {
  const body = bodyOf(renderStudentProfileTemplate(template, {}, "final"));
  let checked = 0;
  for (const paragraph of children(body, "w:p")) {
    if (!/^\s*[1-6]\.\s/.test(text(paragraph))) continue;
    checked++;
    for (let next = paragraph; next && next.nodeName !== "w:tbl"; next = next.nextSibling) {
      if (next.nodeName === "w:p") assert.equal(next.getElementsByTagName("w:keepNext").length, 1);
    }
  }
  assert.equal(checked, 6);
});

test("existing table rows move intact instead of splitting one field across pages", () => {
  const body = bodyOf(renderStudentProfileTemplate(template, { mother_employer: "Example School" }, "final"));
  let count = 0;
  for (const table of children(body, "w:tbl")) for (const row of children(table, "w:tr")) {
    assert.equal(row.getElementsByTagName("w:cantSplit").length, 1);
    count++;
  }
  assert.equal(count, 22);
  assert.equal(children(children(body, "w:tbl")[5], "w:tr")[0].getElementsByTagName("w:tblHeader").length, 1);
});

test("names containing XML punctuation and Unicode remain text and respect code-point limits", () => {
  const value = 'Айжан & 李 <тест> "имя"';
  const output = renderStudentProfileTemplate(template, { student_first_name: value }, "final");
  assert.equal(text(slotRuns(bodyOf(output)).get("student_first_name")), value);
  assert.match(new PizZip(output).file("word/document.xml").asText(), /&amp;/);
  const limit = PROFILE_FIELD_BY_KEY.get("student_first_name").maxLength;
  const supplementary = "𠮷".repeat(limit);
  assert.equal(text(slotRuns(bodyOf(renderStudentProfileTemplate(template, { student_first_name: supplementary }, "final"))).get("student_first_name")), supplementary);
  assert.throws(() => renderStudentProfileTemplate(template, { student_first_name: `${supplementary}李` }, "final"),
    { code: "field_too_long" });
});

test("renderer rejects unknown or malformed inputs without accepting a caller template path", () => {
  for (const [values, code] of [[{ misspelled_field: "" }, "field_unknown"], [{ student_first_name: null }, "field_invalid"],
    [{ student_first_name: "a\u0001b" }, "field_invalid"], [{ student_first_name: "\ud800" }, "field_invalid"]]) {
    assert.throws(() => renderStudentProfileTemplate(template, values, "final"), (error) => error instanceof StudentProfileTemplateError && error.code === code);
  }
  assert.throws(() => renderStudentProfileTemplate("assets/templates/student-profile.docx", {}, "final"), { code: "template_hash_mismatch" });
  assert.throws(() => renderStudentProfileTemplate(Buffer.from("different reference"), {}, "final"), { code: "template_hash_mismatch" });
  assert.throws(() => renderStudentProfileTemplate(template, {}, "unrecognised"), { code: "mode_invalid" });
});
