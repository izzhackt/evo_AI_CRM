import "server-only";

import { createHash } from "node:crypto";
import { DOMParser, XMLSerializer, type Element, type Node } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { PROFILE_FIELD_BY_KEY, type ProfileFieldKey } from "../student-profile-fields.ts";

export const STUDENT_PROFILE_TEMPLATE_SHA256 = "2fdbacc33511b05f4d130a5882589afe3698bc1b7665a5f746aef6f4281a04c0";
export const STUDENT_PROFILE_DRAFT_WARNING = "ЧЕРНОВИК — данные требуют проверки; не для подачи";
const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const DOCUMENT_PART = "word/document.xml";

type TemplateErrorCode = "template_hash_mismatch" | "template_structure_mismatch"
  | "field_unknown" | "field_invalid" | "field_too_long" | "mode_invalid";

export class StudentProfileTemplateError extends Error {
  readonly code: TemplateErrorCode;
  constructor(code: TemplateErrorCode) {
    super(code);
    this.name = "StudentProfileTemplateError";
    this.code = code;
  }
}

type TableSlot = Readonly<{ table: number; cell: number; guard: string }>;
const TABLE_SLOTS: Readonly<Record<string, TableSlot>> = {
  student_first_name: { table: 0, cell: 0, guard: "First Name" },
  student_last_name: { table: 0, cell: 1, guard: "Last Name" },
  date_of_birth: { table: 1, cell: 0, guard: "Date of Birth" },
  nationality: { table: 1, cell: 1, guard: "Nationality" },
  passport_number: { table: 1, cell: 2, guard: "Passport Number" },
  passport_expiry_date: { table: 2, cell: 0, guard: "Passport Expiry" },
  country_of_residence: { table: 2, cell: 1, guard: "Country of Residence" },
  mobile_phone: { table: 3, cell: 0, guard: "Mobile Phone" },
  whatsapp_telegram: { table: 3, cell: 1, guard: "WhatsApp" },
  student_email: { table: 3, cell: 2, guard: "Student Email" },
  chinese_level_hsk: { table: 4, cell: 0, guard: "Chinese Level" },
  english_level: { table: 4, cell: 1, guard: "English Level" },
  current_study_status: { table: 6, cell: 0, guard: "Current Study Status" },
  expected_graduation_year: { table: 6, cell: 1, guard: "Expected Graduation" },
  desired_country_of_study: { table: 7, cell: 0, guard: "Desired Country" },
  desired_university: { table: 7, cell: 1, guard: "Desired University" },
  field_major: { table: 8, cell: 0, guard: "Field" },
  program_level: { table: 8, cell: 1, guard: "Program Level" },
  desired_start_date: { table: 8, cell: 2, guard: "Desired Start" },
  budget_per_year: { table: 9, cell: 0, guard: "Budget" },
  scholarship_interest: { table: 9, cell: 1, guard: "Scholarship" },
  father_first_name: { table: 10, cell: 0, guard: "First Name" },
  father_last_name: { table: 10, cell: 1, guard: "Last Name" },
  father_employer: { table: 11, cell: 0, guard: "Employer" },
  father_job_title: { table: 11, cell: 1, guard: "Job Title" },
  father_mobile_phone: { table: 11, cell: 2, guard: "Mobile Phone" },
  father_work_email: { table: 12, cell: 0, guard: "Work Email" },
  father_personal_email: { table: 12, cell: 1, guard: "Personal Email" },
  mother_first_name: { table: 13, cell: 0, guard: "First Name" },
  mother_last_name: { table: 13, cell: 1, guard: "Last Name" },
  mother_employer: { table: 14, cell: 0, guard: "Employer" },
  mother_job_title: { table: 14, cell: 1, guard: "Job Title" },
  mother_mobile_phone: { table: 14, cell: 2, guard: "Mobile Phone" },
  mother_work_email: { table: 15, cell: 0, guard: "Work Email" },
  mother_personal_email: { table: 15, cell: 1, guard: "Personal Email" },
  emergency_contact_name: { table: 16, cell: 0, guard: "Emergency Contact Name" },
  emergency_contact_relationship: { table: 16, cell: 1, guard: "Relationship" },
  emergency_contact_phone_email: { table: 16, cell: 2, guard: "Phone" },
  previous_visa_refusals: { table: 17, cell: 0, guard: "Visa Refusals" },
  visa_refusal_country: { table: 17, cell: 1, guard: "Country" },
  chronic_conditions_allergies: { table: 18, cell: 0, guard: "Chronic" },
  conditions_details: { table: 18, cell: 1, guard: "please specify" },
};
const PARAGRAPH_SLOTS: Readonly<Record<string, Readonly<{ paragraph: number; guard: string }>>> = {
  permanent_address: { paragraph: 8, guard: "Permanent Address" },
  extracurricular_achievements: { paragraph: 17, guard: "Extracurricular" },
  why_this_field: { paragraph: 24, guard: "Why" },
  lead_source: { paragraph: 43, guard: "How did you hear" },
};
const EDUCATION_COLUMNS: Readonly<Record<string, number>> = {
  school_name: 1, country_city: 2, year_from: 3, year_to: 4, degree_certificate: 5,
};
const SECTION_TITLE = /^[1-6]\.\s+(?:PERSONAL INFORMATION|EDUCATION HISTORY|STUDY GOAL|FATHER['’]S INFORMATION|MOTHER['’]S INFORMATION|EMERGENCY CONTACT & ADDITIONAL INFORMATION)$/;

/**
 * The caller loads the server-owned template and supplies human-confirmed values.
 * This pure renderer has no filesystem, identity, provider or readiness authority.
 * APIs: https://github.com/xmldom/xmldom and
 * https://open-xml-templating.github.io/pizzip/documentation/api_pizzip/generate.html
 */
export function renderStudentProfileTemplate(
  template: Buffer,
  values: Readonly<Partial<Record<ProfileFieldKey, string>>>,
  mode: "draft" | "final",
): Buffer {
  if (!Buffer.isBuffer(template) || createHash("sha256").update(template).digest("hex") !== STUDENT_PROFILE_TEMPLATE_SHA256) {
    throw new StudentProfileTemplateError("template_hash_mismatch");
  }
  if (mode !== "draft" && mode !== "final") throw new StudentProfileTemplateError("mode_invalid");
  validateValues(values);
  const zip = new PizZip(template);
  const xml = zip.file(DOCUMENT_PART)?.asText();
  if (!xml) throw new StudentProfileTemplateError("template_structure_mismatch");
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const body = document.getElementsByTagName("w:body").item(0);
  if (!body) throw new StudentProfileTemplateError("template_structure_mismatch");
  const tables = directChildren(body, "w:tbl");
  const paragraphs = directChildren(body, "w:p");
  if (tables.length !== 19 || paragraphs.length !== 48) throw new StudentProfileTemplateError("template_structure_mismatch");

  for (const [key, value] of Object.entries(values)) {
    const slot = TABLE_SLOTS[key];
    if (slot) {
      const row = directChildren(tables[slot.table], "w:tr")[0];
      const cell = directChildren(row, "w:tc")[slot.cell];
      const paragraph = directChildren(cell, "w:p")[0];
      guardText(paragraph, slot.guard);
      replaceRunText(directChildren(paragraph, "w:r")[1], value);
      continue;
    }
    const paragraphSlot = PARAGRAPH_SLOTS[key];
    if (paragraphSlot) {
      const paragraph = paragraphs[paragraphSlot.paragraph];
      guardText(paragraph, paragraphSlot.guard);
      replaceRunText(directChildren(paragraph, "w:r")[1], value);
      continue;
    }
    const education = /^education_([1-3])_(school_name|country_city|year_from|year_to|degree_certificate)$/.exec(key);
    if (!education) throw new StudentProfileTemplateError("field_unknown");
    const table = tables[5];
    guardText(table, "School / University Name");
    const row = directChildren(table, "w:tr")[Number(education[1])];
    const cell = directChildren(row, "w:tc")[EDUCATION_COLUMNS[education[2]]];
    const paragraph = directChildren(cell, "w:p")[0] ?? appendElement(cell, "w:p");
    const run = directChildren(paragraph, "w:r")[0] ?? appendElement(paragraph, "w:r");
    replaceRunText(run, value);
  }

  keepSectionHeadingsWithFields(body);
  keepTableRowsTogether(tables);
  if (mode === "draft") {
    const warning = document.createElementNS(WORD_NS, "w:p");
    const properties = appendElement(warning, "w:pPr");
    appendElement(properties, "w:spacing").setAttributeNS(WORD_NS, "w:after", "80");
    const run = appendElement(warning, "w:r");
    const runProperties = appendElement(run, "w:rPr");
    const fonts = appendElement(runProperties, "w:rFonts");
    for (const font of ["ascii", "hAnsi", "cs", "eastAsia"]) fonts.setAttributeNS(WORD_NS, `w:${font}`, "Calibri");
    appendElement(runProperties, "w:b");
    appendElement(runProperties, "w:color").setAttributeNS(WORD_NS, "w:val", "9C243C");
    appendElement(runProperties, "w:sz").setAttributeNS(WORD_NS, "w:val", "18");
    replaceRunText(run, STUDENT_PROFILE_DRAFT_WARNING);
    body.insertBefore(warning, body.firstChild);
  }
  zip.file(DOCUMENT_PART, new XMLSerializer().serializeToString(document));
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

function validateValues(values: Readonly<Partial<Record<ProfileFieldKey, string>>>): void {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new StudentProfileTemplateError("field_invalid");
  for (const [key, value] of Object.entries(values)) {
    const definition = PROFILE_FIELD_BY_KEY.get(key);
    if (!definition) throw new StudentProfileTemplateError("field_unknown");
    if (typeof value !== "string") throw new StudentProfileTemplateError("field_invalid");
    if (value.length > definition.maxLength * 2) throw new StudentProfileTemplateError("field_too_long");
    const points = [...value];
    if (points.length > definition.maxLength) throw new StudentProfileTemplateError("field_too_long");
    // XML 1.0 text characters only; never coerce or silently discard a field value.
    for (const point of points) {
      const code = point.codePointAt(0)!;
      if (!(code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff)
        || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff))) {
        throw new StudentProfileTemplateError("field_invalid");
      }
    }
  }
}

function keepSectionHeadingsWithFields(body: Element): void {
  for (const paragraph of directChildren(body, "w:p")) {
    if (!SECTION_TITLE.test(nodeText(paragraph).trim())) continue;
    // Preserve the existing fix for headings separated from their first table.
    for (let next: Node | null = paragraph; next && next.nodeName !== "w:tbl"; next = next.nextSibling) {
      if (next.nodeName !== "w:p") continue;
      let properties = directChildren(next, "w:pPr")[0];
      if (!properties) {
        properties = next.ownerDocument!.createElementNS(WORD_NS, "w:pPr");
        next.insertBefore(properties, next.firstChild);
      }
      if (!directChildren(properties, "w:keepNext").length) {
        properties.insertBefore(next.ownerDocument!.createElementNS(WORD_NS, "w:keepNext"), properties.firstChild);
      }
    }
  }
}

function keepTableRowsTogether(tables: readonly Element[]): void {
  for (const table of tables) for (const row of directChildren(table, "w:tr")) {
    let properties = directChildren(row, "w:trPr")[0];
    if (!properties) {
      properties = row.ownerDocument!.createElementNS(WORD_NS, "w:trPr");
      row.insertBefore(properties, row.firstChild);
    }
    if (!directChildren(properties, "w:cantSplit").length) appendElement(properties, "w:cantSplit");
  }
}

function appendElement(parent: Node, name: string): Element {
  const element = parent.ownerDocument!.createElementNS(WORD_NS, name);
  parent.appendChild(element);
  return element;
}

function replaceRunText(run: Element | undefined, value: string): void {
  if (!run) throw new StudentProfileTemplateError("template_structure_mismatch");
  const texts = directChildren(run, "w:t");
  const target = texts[0] ?? appendElement(run, "w:t");
  while (target.firstChild) target.removeChild(target.firstChild);
  target.appendChild(run.ownerDocument!.createTextNode(value));
  target.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
  for (const extra of texts.slice(1)) while (extra.firstChild) extra.removeChild(extra.firstChild);
}

function guardText(node: Element | undefined, expected: string): void {
  if (!node || !nodeText(node).replace(/\s+/g, " ").toLowerCase().includes(expected.toLowerCase())) {
    throw new StudentProfileTemplateError("template_structure_mismatch");
  }
}

function nodeText(node: Element): string {
  return Array.from(node.getElementsByTagName("w:t")).map((text) => text.textContent ?? "").join("");
}

function directChildren(node: Node | undefined, name: string): Element[] {
  if (!node) throw new StudentProfileTemplateError("template_structure_mismatch");
  const result: Element[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && child.nodeName === name) result.push(child as Element);
  }
  return result;
}
