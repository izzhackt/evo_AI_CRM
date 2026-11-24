import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { caseCountry, caseDegree, caseIntake, caseProgram, websiteCountry } from "../src/lib/v3/wording.ts";
import { paletteStudentRow } from "../src/lib/v3/command-palette.ts";
import { parseStudentDebts } from "../src/lib/student-debts-contract.ts";

const ROOT = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");

// Страна, ступень, программа и набор дела — свободный TEXT, и в нём бывают коды и ключи
// (`CN`, `China`, `bachelor`, `2027-09`). Ключ из базы на экран не попадает (CLAUDE.md): слово — из wording.ts.

test("страна дела: код и значение формы сайта — словом, русское слово остаётся, остальное не рисуется", () => {
  for (const value of ["CN", "China", "Китай", " CN "]) assert.equal(caseCountry(value), "Китай", value);
  assert.equal(caseCountry("MY"), "Малайзия");
  assert.equal(caseCountry("Malaysia"), "Малайзия");
  assert.equal(caseCountry("IT"), "Италия");
  assert.equal(caseCountry("Germany"), "Германия", "прежнее значение формы сайта");
  assert.equal(caseCountry("Undecided"), "Пока не решил");
  // Одобрение анкеты (177) писало и такие названия: страна не должна пропасть с экрана.
  assert.equal(caseCountry("Czech Republic"), "Чехия");
  assert.equal(caseCountry("Spain"), "Испания");
  assert.equal(caseCountry("Hungary"), "Венгрия");
  assert.equal(caseCountry("United Arab Emirates"), "ОАЭ");
  assert.equal(caseCountry("Turkey"), "Турция");
  assert.equal(caseCountry("Южная Корея"), "Южная Корея", "страна, записанная по-русски, как есть");
  for (const value of ["KR", "Korea", "EUROPE", "unknown", "", "   ", null, undefined]) assert.equal(caseCountry(value), null, String(value));
});

test("ступень дела: ключ — словом, записанное слово остаётся, другой ключ не рисуется", () => {
  assert.equal(caseDegree("bachelor"), "Бакалавриат");
  assert.equal(caseDegree("Bachelor"), "Бакалавриат");
  assert.equal(caseDegree("master"), "Магистратура");
  assert.equal(caseDegree("Бакалавриат"), "Бакалавриат");
  assert.equal(caseDegree("Колледж / диплом"), "Колледж / диплом");
  assert.equal(caseDegree("MBA"), "MBA", "аббревиатура — слово человека, а не ключ");
  for (const value of ["foundation_year", "undergrad", "", null]) assert.equal(caseDegree(value), null, String(value));
});

test("программа дела: свободный текст как есть, код направления не рисуется", () => {
  assert.equal(caseProgram("Computer Science"), "Computer Science");
  assert.equal(caseProgram("IT"), "IT", "IT — программа, а не направление сотрудников");
  for (const value of ["CN", "MY", "EUROPE", "AE", "TR", "unknown", " ", null]) assert.equal(caseProgram(value), null, String(value));
});

test("набор дела: машинный месяц — словом, свободный текст как записан", () => {
  assert.equal(caseIntake("2027-09"), "сентябрь 2027");
  assert.equal(caseIntake("2027-02-01"), "февраль 2027");
  assert.equal(caseIntake("сентябрь 2027"), "сентябрь 2027");
  assert.equal(caseIntake("Осень 2027"), "Осень 2027");
  assert.equal(caseIntake(""), null);
  assert.equal(caseIntake(null), null);
});

test("страна из формы сайта: один словарь в wording.ts, неизвестное значение не рисуется", () => {
  assert.equal(websiteCountry("China"), "Китай");
  assert.equal(websiteCountry("United Kingdom"), "Великобритания");
  assert.equal(websiteCountry("Mars"), null);
  // Второго словаря прежних стран сайта в компонентах нет.
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/u.test(name)) files.push(path);
    }
  };
  walk(new URL("src/components/staff", ROOT).pathname);
  const copies = files.filter((file) => readFileSync(file, "utf8").includes("\"United Kingdom\": \"Великобритания\""));
  assert.deepEqual(copies, []);
});

test("поиск ⌘K и подсказка о дублях: страна и ступень дела словами", () => {
  const row = paletteStudentRow({
    access: "full", studentCaseId: "33500000-0000-4000-8000-000000000001", studentDisplayName: "Тестовый Студент",
    targetCountry: "CN", targetDegree: "bachelor", state: "pending",
  });
  assert.equal(row.meta, "Китай · Бакалавриат · ожидает начала");
});

test("«Долги студентов»: дело без страны не роняет вкладку, страна — словом, код направления не рисуется", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const CASE = "33500000-0000-4000-8000-000000000002";
  const debts = parseStudentDebts({
    schema_version: 1, organization_id: ORG, case_row_count: 1, truncated: false,
    rows: [{ case_id: CASE, student_name: "Тестовый Студент", country: null, direction: null, curator: null, currency: "USD",
      cost_minor: 100000, paid_minor: 40000, debt_minor: 60000, has_other_currency_payments: false }],
    totals: [{ currency: "USD", cost_minor: 100000, paid_minor: 40000, debt_minor: 60000, case_count: 1 }],
  }, ORG);
  assert.equal(debts.rows[0].country, null);
  const cell = source("src/components/staff/finance-next/StudentDebtsNext.tsx");
  assert.match(cell, /const placeOf = \(row: StudentDebtRow\) => \[caseCountry\(row\.country\), caseProgram\(row\.direction\)\]/u);
  assert.match(cell, /accessorFn: placeOf/u, "поиск и сортировка — по тем же словам, что на экране");
});

test("экраны дела берут страну, ступень, программу и набор из wording.ts, а не из базы как есть", () => {
  const facts = source("src/lib/v3/profile-source.ts");
  assert.match(facts, /\{ label: "Целевая страна", value: caseCountry\(studentCase\.targetCountry\) \}/u);
  assert.match(facts, /\{ label: "Ступень", value: caseDegree\(studentCase\.targetDegree\) \}/u);
  assert.match(facts, /\{ label: "Направление", value: caseProgram\(studentCase\.programDirection\) \}/u);
  assert.match(facts, /\{ label: "Интейк", value: caseIntake\(studentCase\.intake\) \}/u);
  assert.match(source("src/components/staff/knowledge/KnowledgeDossiers.tsx"),
    /\[caseCountry\(item\.targetCountry\), caseDegree\(item\.targetDegree\), caseIntake\(item\.intake\)\]/u);
  assert.match(source("src/components/staff/knowledge/KnowledgeAssignCase.tsx"),
    /item\.targetCountry\?\.trim\(\) \? caseCountry\(item\.targetCountry\) : "Страна не указана", caseIntake\(item\.intake\) \?\? "Набор не указан"/u);
  assert.match(source("src/components/staff/students/StudentsQueueTable.tsx"), /\[direction, caseDegree\(row\.targetDegree\)\]/u);
  const documents = source("src/components/staff/profile/Documents.tsx");
  assert.match(documents, /\[caseCountry\(option\.targetCountry\), caseDegree\(option\.targetDegree\), caseProgram\(option\.programDirection\)\]/u);
  assert.match(documents, /\[route \|\| null, `версия \$\{option\.checklistVersion\}`\]\.filter\(Boolean\)\.join\(" · "\)/u,
    "без переводимых частей подпись начинается с «версия», а не с висящего « · »");
  // Доска «Воронки поступления» — та же страна дела, та же функция; длинное название не роняет доску.
  assert.match(source("src/components/staff/admissions-pipeline-next/AdmissionsCardNext.tsx"), /\[caseCountry\(row\.targetCountry\), row\.primaryInstitutionName\]/u);
  assert.match(source("src/lib/platform-admissions-pipeline.ts"), /targetCountry: optionalText\(value\.target_country, 200\)/u);
});

test("связь документа с заявкой и визой: набор, статус и срок словами, а не ключами и ISO-датами", () => {
  const facts = source("src/lib/v3/profile-source.ts");
  assert.match(facts, /caseIntake\(application\.intake\) \?\? "интейк не указан",\n\s+applicationStatus\(application\.status\),/u);
  assert.match(facts, /const deadline = allDayDate\(application\.universityDeadlineOn\);/u);
  assert.match(facts, /label: \["Визовое дело", visaStatus\(visa\.status\)\]\.filter\(Boolean\)\.join\(" · "\)/u);
  assert.doesNotMatch(facts, /`Визовое дело · \$\{visa\.status\}`|`дедлайн \$\{application\.universityDeadlineOn\}`/u);
});
