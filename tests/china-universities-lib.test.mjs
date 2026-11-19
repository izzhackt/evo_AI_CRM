import assert from "node:assert/strict";
import test from "node:test";
import {
  ACADEMIC_YEAR, MERGE_NOTE, autoFillRows, WORKSHEET_DATE, buildIntakes, buildSummary, cleanedTitleIsFaithful, editDistance, mergeIntoExisting,
  cleanDeadlineText, languageClass, normalizeLanguage, parseAge, parseDurationYears, parseIntake, programmesSentence, scrubOverview, slugify, uniqueProgramId,
} from "../scripts/catalog/china-2026-11-lib.mjs";
import { isAdditiveUpdate } from "../scripts/catalog/china-universities-sql.mjs";

test("China 2026-11 lib: ids are valid slugs and stay unique inside a card", () => {
  assert.equal(slugify("Computer Science & Technology"), "computer-science-and-technology");
  assert.match(slugify("  Électrique (Teacher Training) "), /^[a-z0-9][a-z0-9-]{0,63}$/u);
  assert.ok(slugify("A".repeat(200)).length <= 56);
  const taken = new Set(["civil-engineering"]);
  assert.equal(uniqueProgramId("Civil Engineering", "zh", taken), "civil-engineering-zh");
  taken.add("civil-engineering-zh");
  assert.equal(uniqueProgramId("Civil Engineering", "zh", taken), "civil-engineering-2");
  assert.equal(uniqueProgramId("Law", "en", taken), "law");
});

test("China 2026-11 lib: teaching language and intake months are read from the messy table cells", () => {
  assert.deepEqual(normalizeLanguage("Chinese"), { ru: "Китайский", iso: "zh" });
  assert.deepEqual(normalizeLanguage("english"), { ru: "Английский", iso: "en" });
  assert.deepEqual(normalizeLanguage("English &\n Chinese"), { ru: "Английский или китайский", iso: "both" });
  assert.deepEqual(normalizeLanguage(""), { ru: null, iso: null });
  assert.deepEqual(parseIntake("Sep, 2026 intake").months, [9]);
  assert.deepEqual(parseIntake("Mar/Sep ,").months, [3, 9]);
  assert.deepEqual(parseIntake("Mar,2026 / Sep,\n2026 intake").months, [3, 9]);
  assert.deepEqual(parseIntake("Oct").months, [10]);
  assert.deepEqual(parseIntake("anytime"), { months: [], rolling: true });
});

test("China 2026-11 lib: a deadline stays words, only when it is made of deadline words (process notes are dropped)", () => {
  assert.equal(cleanDeadlineText("Deadline: July 15"), "Deadline: July 15");
  assert.equal(cleanDeadlineText("Deadline\uff1aJune\uff0c30"), "Deadline:June,30");
  assert.equal(cleanDeadlineText("31 th August"), "31 th August");
  assert.equal(cleanDeadlineText("until full"), "until full");
  assert.equal(cleanDeadlineText("Deadline: June 30, Until full \u6216\u987a\u5ef6\u5230\u62db\u6ee1\u4e3a\u6b62"), "Deadline: June 30, Until full", "a Chinese remark is cut off");
  assert.equal(cleanDeadlineText("\u622a\u6b62\u65e5\u671f June 30"), null);
  assert.equal(cleanDeadlineText("  March 1 - June 30,\n 2026 (Fall entry) \u00a0 October 1 - December 31, 2026 (Spring entry) "),
    "March 1 - June 30, 2026 (Fall entry) October 1 - December 31, 2026 (Spring entry)");
  assert.equal(cleanDeadlineText("Scholarship Deadline:May 20 Self-supporting student deadline: June 30"), "Scholarship Deadline:May 20 Self-supporting student deadline: June 30");
  assert.equal(cleanDeadlineText("Apply by June, the university issues the JW202 form after admission"), null);
  assert.equal(cleanDeadlineText("1st year Excellent Students will get Extra Scholarship from Nanjing Government (10,000 RMB/Year)"), null);
  assert.equal(cleanDeadlineText("Deadline: anytime Students apply now and can enroll in the spring class"), null);
  assert.equal(cleanDeadlineText(""), null);
  assert.equal(cleanDeadlineText(null), null);
  assert.equal(cleanDeadlineText(`${"Deadline: May 1 ".repeat(30)}`).length, 200);
});

test("China 2026-11 lib: Excel drag-fill runs (a number growing by 1 on three or more rows) are detected and nothing else", () => {
  const rows = (texts) => texts.map((text, index) => ({ row: index + 2, text }));
  assert.deepEqual([...autoFillRows(rows(["Age: 18-28", "Age: 18-29", "Age: 18-30", "Age: 18-25", "Age: 18-25"]))], [2, 3, 4]);
  assert.deepEqual([...autoFillRows(rows(["Deadline: June 30", "Deadline: June 31", "Deadline: June 32", "Deadline: June 33"]))], [2, 3, 4, 5]);
  assert.deepEqual([...autoFillRows(rows(["Age: 18-28", "Age: 18-29"]))], [], "two rows are not a run");
  assert.deepEqual([...autoFillRows(rows(["Age: 18-25", "Age: 18-25", "Age: 18-25"]))], []);
  assert.deepEqual([...autoFillRows(rows(["", "Deadline: May 1", "", "June 2"]))], []);
});

test("China 2026-11 lib: only a plain age limit is taken from the requirements; quotas and notes are dropped", () => {
  assert.equal(parseAge("Age: 18-25"), "18-25 лет");
  assert.equal(parseAge("Age：under 35"), "до 35 лет");
  assert.equal(parseAge("under 40"), "до 40 лет");
  assert.equal(parseAge("Age: under 35 for Scholarship only Age: under 40 for Self-funded only"), null);
  assert.equal(parseAge("Ghana and Zimbabwe are full"), null);
  assert.equal(parseAge(""), null);
  assert.equal(parseDurationYears("建筑学5年Architecture"), 5);
  assert.equal(parseDurationYears("Architecture"), null);
});

test("China 2026-11 lib: an intake is a month label with unknown status and no dates, the deadline stays in the note", () => {
  const url = "https://www.example.edu.cn/admissions";
  const single = buildIntakes({ intakeRaw: "Sep, 2026 intake", deadlineRaw: "Deadline: July 15", sourceUrl: url });
  assert.equal(single.length, 1);
  assert.deepEqual({ ...single[0], note: undefined }, {
    label: "Сентябрь (по таблице EVO)", startDate: null, startMonth: null, applicationDeadline: null, deadlineTime: null,
    timezone: null, status: "unknown", note: undefined, sourceUrl: url, verifiedOn: WORKSHEET_DATE,
  });
  assert.match(single[0].note, /Срок по таблице: Deadline: July 15\./u);
  assert.match(single[0].note, /подтверждает менеджер у университета/u);
  const dual = buildIntakes({ intakeRaw: "Mar/Sep", deadlineRaw: "", sourceUrl: url });
  assert.deepEqual(dual.map((intake) => intake.label), ["Март (по таблице EVO)", "Сентябрь (по таблице EVO)"]);
  assert.ok(dual.every((intake) => intake.status === "unknown" && intake.startMonth === null && !/Срок по таблице/u.test(intake.note)));
  const rolling = buildIntakes({ intakeRaw: "anytime", deadlineRaw: "", sourceUrl: url });
  assert.equal(rolling[0].label, "В течение года (по таблице EVO)");
  assert.deepEqual(buildIntakes({ intakeRaw: "", deadlineRaw: "", sourceUrl: url }), []);
  assert.equal(ACADEMIC_YEAR, "2026/27");
});

test("China 2026-11 lib: the programme summary states table facts and promises nothing", () => {
  const text = buildSummary({ languageRu: "Китайский", ageRu: "18-25 лет", scholarship: true });
  assert.match(text, /Язык обучения: китайский\./u);
  assert.match(text, /Возраст по таблице EVO: 18-25 лет\./u);
  assert.match(text, /подтверждает менеджер/u);
  assert.doesNotMatch(text, /гарант|бесплат|полная стипенд|full/iu);
  assert.equal(buildSummary({ languageRu: null, ageRu: null, scholarship: false }), "Программа взята из рабочей таблицы EVO (набор 2026).");
});

test("China 2026-11 lib: title cleaning is faithful only while the letters stay (guard against invented words)", () => {
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.ok(cleanedTitleIsFaithful("Chemical Engineeing and Techonology", ["Chemical Engineering and Technology"]));
  assert.ok(cleanedTitleIsFaithful("Electronic and Information EngineeringComputer Science and Technology", ["Electronic and Information Engineering", "Computer Science and Technology"]));
  assert.ok(!cleanedTitleIsFaithful("Civil Engineering", ["Mechanical Engineering"]));
});

test("China 2026-11 lib: the overview sentence counts programmes by language with correct Russian plurals", () => {
  const make = (languages) => languages.map((language) => ({ language }));
  assert.equal(programmesSentence(make(["Английский"])), "В каталоге 1 программа бакалавриата: 1 на английском.");
  assert.equal(programmesSentence(make(["Китайский", "Китайский", "Английский"])), "В каталоге 3 программы бакалавриата: 1 на английском, 2 на китайском.");
  assert.match(programmesSentence(make(Array(5).fill("Китайский"))), /^В каталоге 5 программ бакалавриата: 5 на китайском\.$/u);
  assert.match(programmesSentence(make(Array(21).fill(null))), /^В каталоге 21 программа бакалавриата\.$/u);
});

const existingCard = () => ({
  name: "Example University", country: "CN", city: "Ханчжоу", overview: "Обзор.", websiteUrl: "https://www.example.edu.cn", sourceUrl: "https://www.example.edu.cn/en",
  verifiedOn: "2026-09-10", notes: "Старая заметка.", photoKey: null,
  programs: [{ id: "computer-science", level: "bachelor", title: "Computer Science and Technology", intakes: [], summary: "S", duration: null, language: "Английский", sourceUrl: "https://www.example.edu.cn/en" }],
});

test("China 2026-11 lib: merging keeps every earlier programme and field and adds only genuinely new programmes", () => {
  const existing = existingCard();
  const addition = (title, id, language = "Китайский", languageIso = "zh") => ({ id, level: "bachelor", title, intakes: [], summary: "S", duration: null, language, sourceUrl: "https://www.example.edu.cn/en", languageIso });
  const { content, added } = mergeIntoExisting(existing, [
    addition("COMPUTER SCIENCE and technology", "computer-science", "Английский", "en"),
    addition("Civil Engineering", "civil-engineering"),
    addition("Civil Engineering", "civil-engineering-2"),
    addition("Computer Science and Technology", "computer-science-and-technology"),
    addition("Computer Science and Technology", "computer-science-and-technology-2", "Английский или китайский", "both"),
  ]);
  assert.equal(added, 2, "the same-language duplicate, the repeated title and a mixed-language repeat are skipped; the Chinese-taught twin of an English programme is kept");
  assert.deepEqual(content.programs[0], existing.programs[0]);
  assert.deepEqual(content.programs.slice(1).map((program) => program.id), ["civil-engineering", "computer-science-and-technology"]);
  assert.ok(!("languageIso" in content.programs[1]));
  assert.equal(content.notes, `Старая заметка. ${MERGE_NOTE}`);
  assert.equal(content.name, existing.name);
  assert.ok(isAdditiveUpdate(existing, content));
  assert.equal(mergeIntoExisting(content, []).content.notes, content.notes, "the merge note is not repeated");
});

test("China 2026-11 SQL guard: an update that edits or drops an earlier programme or an identity field is not additive", () => {
  const existing = existingCard();
  const plus = { ...existing, programs: [...existing.programs, { ...existing.programs[0], id: "law", title: "Law" }] };
  assert.ok(isAdditiveUpdate(existing, plus));
  assert.ok(isAdditiveUpdate(existing, { ...plus, notes: `${existing.notes} ${MERGE_NOTE}` }), "the note may grow by exactly the merge note");
  assert.ok(!isAdditiveUpdate(existing, { ...plus, notes: "Другая заметка." }), "an Admin edit of the note is never overwritten");
  assert.ok(!isAdditiveUpdate(existing, { ...plus, notes: `${existing.notes} Своя приписка.` }));
  assert.ok(!isAdditiveUpdate(existing, { ...plus, verifiedOn: "2026-11-19" }), "the verification date is protected too");
  assert.ok(!isAdditiveUpdate(existing, { ...plus, city: "Шанхай" }));
  assert.ok(!isAdditiveUpdate(existing, { ...plus, overview: "Новый обзор." }));
  assert.ok(!isAdditiveUpdate(existing, { ...plus, programs: [{ ...plus.programs[0], summary: "Изменено." }, plus.programs[1]] }));
  assert.ok(!isAdditiveUpdate(existing, { ...plus, programs: [plus.programs[1]] }));
});

import { acceptCostItems, basicMajorClean, buildCostRows, collapseFeeAutoFill, validateCostItem } from "../scripts/catalog/china-2026-11-lib.mjs";

test("China 2026-11 lib: the title pre-clean removes numbering, bullets, Chinese runs and glued CamelCase `and`", () => {
  assert.equal(basicMajorClean("4.Computer Science and Technology"), "Computer Science and Technology");
  assert.equal(basicMajorClean("lMechanical Engineering"), "Mechanical Engineering");
  assert.equal(basicMajorClean("建筑学5年Architecture"), "Architecture");
  assert.equal(basicMajorClean("Computer Scienceand Technology"), "Computer Scienceand Technology");
  assert.equal(basicMajorClean("Mechanical Engineering and Automation"), "Mechanical Engineering and Automation");
  assert.equal(basicMajorClean("International Economics and Trade"), "International Economics and Trade");
});

const TEXT = "University Scholarship:Tuition free Tuition fees:15000CNY/Y Accommodation fee:4960CNY/year Registration Fee: 500 CNY";
const item = (over) => ({ kind: "tuition", basis: "standard", scope: "all", min: 15000, max: null, period: "year", room: null, evidence: "Tuition fees:15000CNY/Y", ...over });

test("China 2026-11 costs: an item must be proven by the source text and named by its own label", () => {
  assert.deepEqual(validateCostItem(TEXT, item({})), []);
  assert.deepEqual(validateCostItem(TEXT, item({ kind: "accommodation", evidence: "Accommodation fee:4960CNY/year", min: 4960 })), []);
  assert.ok(validateCostItem(TEXT, item({ evidence: "Tuition fees:16000CNY/Y" })).includes("evidence_not_in_text"));
  assert.ok(validateCostItem(TEXT, item({ min: 15001 })).includes("amount_not_in_evidence"));
  assert.ok(validateCostItem(TEXT, item({ kind: "insurance" })).includes("kind_not_named_near_evidence"));
  assert.ok(validateCostItem(TEXT, item({ kind: "accommodation", evidence: "Registration Fee: 500 CNY", min: 500 })).includes("kind_not_named_near_evidence"));
  assert.ok(validateCostItem(TEXT, item({ max: 14000 })).includes("max"));
});

test("China 2026-11 costs: only items confirmed by both independent passes are accepted", () => {
  const registration = { kind: "application_fee", basis: "standard", scope: "all", min: 500, max: null, period: "once", room: null, evidence: "Registration Fee: 500 CNY" };
  const { accepted, rejected } = acceptCostItems(TEXT, [item({}), registration, item({ kind: "other", evidence: "Tuition free" })], [item({}), { ...registration, period: "unknown" }]);
  assert.deepEqual(accepted.map((entry) => entry.kind), ["tuition"]);
  assert.equal(rejected.length >= 2, true);
  assert.deepEqual(acceptCostItems(TEXT, [], [item({})]).accepted, []);
});

test("China 2026-11 costs: rows are bachelor-level evo_document rows, per language, never from an after-scholarship fee", () => {
  const groups = [{ feeId: "f1", accepted: [
    item({ scope: "english_taught", min: 26000, evidence: "x" }),
    item({ scope: "chinese_taught", min: 20000, max: 24000, evidence: "x" }),
    { kind: "accommodation", basis: "standard", scope: "all", min: 3000, max: null, period: "year", room: "double", evidence: "x" },
    { kind: "accommodation", basis: "standard", scope: "all", min: 5000, max: null, period: "year", room: "single", evidence: "x" },
    { kind: "application_fee", basis: "standard", scope: "all", min: 400, max: null, period: "unknown", room: null, evidence: "x" },
    { kind: "application_fee", basis: "standard", scope: "all", min: 600, max: null, period: "year", room: null, evidence: "x" },
    { kind: "insurance", basis: "standard", scope: "all", min: 800, max: null, period: "month", room: null, evidence: "x" },
    { kind: "tuition", basis: "after_scholarship", scope: "all", min: 8000, max: null, period: "year", room: null, evidence: "x" },
  ] }];
  const { rows, dropped } = buildCostRows({ cardKey: "example-university", institutionName: "Example University", programmeLanguages: new Set(["en", "zh"]), groups });
  const byKey = Object.fromEntries(rows.map((row) => [row.importKey, row]));
  assert.deepEqual(Object.keys(byKey).sort(), [
    "cn26:example-university:accommodation:all", "cn26:example-university:application_fee:all",
    "cn26:example-university:tuition:en", "cn26:example-university:tuition:zh"]);
  assert.equal(byKey["cn26:example-university:tuition:zh"].amountMax, "24000");
  assert.equal(byKey["cn26:example-university:accommodation:all"].amountMin, "3000");
  assert.equal(byKey["cn26:example-university:accommodation:all"].amountMax, "5000");
  assert.equal(byKey["cn26:example-university:application_fee:all"].period, "once");
  for (const row of rows) {
    assert.equal(row.sourceKind, "evo_document");
    assert.equal(row.publish, true);
    assert.equal(row.academicYear, "2026/27");
    assert.equal(row.currency, "CNY");
    assert.ok(!("sourceUrl" in row) && !("noteRu" in row));
  }
  assert.ok(dropped.some((entry) => /insurance period/u.test(entry.why)), "a monthly insurance amount is not guessed into a yearly one");
  assert.ok(dropped.some((entry) => /not the standard fee/u.test(entry.why)));
  assert.ok(dropped.some((entry) => /application fee with a periodic unit/u.test(entry.why)), "a yearly «application fee» is not turned into a one-time fee");
  // A university with Chinese programmes only gets no English tuition row; an existing published row blocks a duplicate kind.
  const zhOnly = buildCostRows({ cardKey: "example-university", institutionName: "Example University", programmeLanguages: new Set(["zh"]), groups,
    existingPublished: [{ kind: "accommodation", level: null }] });
  assert.deepEqual(zhOnly.rows.map((row) => row.importKey).sort(), ["cn26:example-university:application_fee:all", "cn26:example-university:tuition:zh"]);
});

test("China 2026-11 lib: a language class separates English from Chinese programmes and treats mixed or unknown as compatible", () => {
  assert.equal(languageClass("Английский"), "en");
  assert.equal(languageClass("Китайский"), "zh");
  assert.equal(languageClass("Китайский или английский — по потоку"), "both");
  assert.equal(languageClass(null), null);
});

test("China 2026-11 lib: a deadline with an impossible date or a reversed range is not shown", () => {
  assert.equal(cleanDeadlineText("Deadline:June 31"), null);
  assert.equal(cleanDeadlineText("Deadline: Feb 30"), null);
  assert.equal(cleanDeadlineText("Application time: November 2026 to Feb 15,2026"), null);
  assert.equal(cleanDeadlineText("Application time: November 1 to Feb 15"), "Application time: November 1 to Feb 15", "a range that wraps over the new year has no years and stays");
  assert.equal(cleanDeadlineText("Deadline: Aug 1, 2026 Scholarship deadline: July 1.2026"), "Deadline: Aug 1, 2026 Scholarship deadline: July 1.2026");
  assert.equal(cleanDeadlineText("March 1 - June 30, 2026 (Fall entry) October 1 - December 31, 2026 (Spring entry)"), "March 1 - June 30, 2026 (Fall entry) October 1 - December 31, 2026 (Spring entry)");
});

test("China 2026-11 lib: the rows of one repeated programme are united (March on one row, September on another)", () => {
  const url = "https://www.example.edu.cn/admissions";
  const united = buildIntakes({ intakeRaw: ["Mar", "Sep", "Sep"], deadlineRaw: ["Deadline: May 1", "Deadline: May 1", "Deadline: June 30"], sourceUrl: url });
  assert.deepEqual(united.map((intake) => intake.label), ["Март (по таблице EVO)", "Сентябрь (по таблице EVO)"]);
  assert.match(united[0].note, /Срок по таблице: Deadline: May 1; Deadline: June 30\./u);
});

test("China 2026-11 lib: status labels (211, 985, Double First-Class) are cut out of an overview, other numbers stay", () => {
  assert.equal(scrubOverview("Университет в Пекине. С 2017 года вуз входит в программу Double First-Class. Основан в 1952 году."), "Университет в Пекине. Основан в 1952 году.");
  assert.equal(scrubOverview("Входит в проект 211 и 985. Учатся 12113 студентов."), "Учатся 12113 студентов.");
});

test("China 2026-11 costs: a faculty list under one tuition label is read as one range, and an unconfirmed second price blocks the tuition row", () => {
  const text = "University Scholarship: Tuition free Tuition: Liberal Arts: 14000CNY/Y Science: 16000CNY/Y Accommodation: 3600CNY/Y double room Insurance: 600CNY/Y";
  const arts = { kind: "tuition", basis: "standard", scope: "arts", min: 14000, max: null, period: "year", room: null, evidence: "Liberal Arts: 14000CNY/Y" };
  const science = { kind: "tuition", basis: "standard", scope: "science_engineering", min: 16000, max: null, period: "year", room: null, evidence: "Science: 16000CNY/Y" };
  assert.deepEqual(validateCostItem(text, science), [], "the tuition label before the list applies to the second price");
  const stay = { kind: "accommodation", basis: "standard", scope: "all", min: 3600, max: null, period: "year", room: "double", evidence: "3600CNY/Y double room" };
  assert.deepEqual(validateCostItem(text, stay), [], "the accommodation label stands right before the amount");
  assert.ok(validateCostItem(text, { ...stay, kind: "tuition" }).includes("kind_not_named_near_evidence"), "an accommodation amount is not a tuition amount");
  const both = acceptCostItems(text, [arts, science], [arts, science]);
  assert.equal(both.accepted.length, 2);
  const range = buildCostRows({ cardKey: "u", institutionName: "U", programmeLanguages: new Set(["en"]), groups: [{ feeId: "f", accepted: both.accepted, rejected: both.rejected }] });
  assert.equal(range.rows[0].amountMin, "14000");
  assert.equal(range.rows[0].amountMax, "16000");
  // Only one pass found the second price: a single 14000 would be wrong for science programmes, so there is no tuition row.
  const half = acceptCostItems(text, [arts, science], [arts]);
  assert.equal(half.accepted.length, 1);
  const blocked = buildCostRows({ cardKey: "u", institutionName: "U", programmeLanguages: new Set(["en"]), groups: [{ feeId: "f", accepted: half.accepted, rejected: half.rejected }] });
  assert.ok(!blocked.rows.some((row) => row.costKind === "tuition"));
  assert.ok(blocked.dropped.some((entry) => /not confirmed by both passes/u.test(entry.why)));
});

test("collapseFeeAutoFill: a last number that grows by 1 over neighbouring rows is an Excel autofill and collapses to the first value", () => {
  const dorm = (n) => `Original Fee: Tuition (per academic year): CNY 20,000 Dorms (per academic year): CNY ${n.toLocaleString("en-US")} (four-bed room)`;
  const groups = [1200, 1201, 1202, 1203].map((value, index) => ({ feeId: `f${index}`, uid: "u1", text: dorm(value), rows: [1085 + index], teachingLanguages: ["English"] }));
  const other = { feeId: "g1", uid: "u2", text: "Tuition fee: 15000CNY/year", rows: [2000], teachingLanguages: ["English"] };
  const { groups: kept, collapsed } = collapseFeeAutoFill([...groups, other]);
  assert.deepEqual(kept.map((group) => group.feeId), ["f0", "g1"], "later groups of the run are gone");
  assert.deepEqual(kept[0].rows, [1085, 1086, 1087, 1088], "their rows move to the first group");
  assert.match(kept[0].text, /1,200/u);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].firstValue, 1200);
  // A long run (single room 6,000 ... 6,017) collapses the same way.
  const long = Array.from({ length: 18 }, (_, index) => ({ feeId: `s${index}`, uid: "u3", text: `Residence: 1500CNY/year (quad room);6,${String(index).padStart(3, "0")}CNY/year(Single room)`, rows: [1089 + index] }));
  assert.equal(collapseFeeAutoFill(long).groups.length, 1);
});

test("collapseFeeAutoFill: only three or more neighbouring rows, one growing last number, identical rest", () => {
  const make = (texts, firstRow = 10) => texts.map((text, index) => ({ feeId: `x${index}`, uid: "u1", text, rows: [firstRow + index] }));
  assert.equal(collapseFeeAutoFill(make(["Dorm 1200", "Dorm 1201"])).groups.length, 2, "two rows are not a run");
  assert.equal(collapseFeeAutoFill(make(["Dorm 1200", "Dorm 1201", "Dorm 1203"])).groups.length, 3, "a step other than 1 breaks the run");
  assert.equal(collapseFeeAutoFill(make(["Tuition 15000 Dorm 1200", "Tuition 16000 Dorm 1201", "Tuition 17000 Dorm 1202"])).groups.length, 3, "another number differs");
  assert.equal(collapseFeeAutoFill(make(["Dorm 1200 single", "Dorm 1201 double", "Dorm 1202 single"])).groups.length, 3, "the text around the number differs");
  const gap = make(["Dorm 1200", "Dorm 1201", "Dorm 1202"]);
  gap[2].rows = [99];
  assert.equal(collapseFeeAutoFill(gap).groups.length, 3, "rows must be neighbours");
  const grouped = collapseFeeAutoFill([...make(["Dorm 1200", "Dorm 1201", "Dorm 1202"]), { feeId: "y", uid: "u2", text: "Dorm 1203", rows: [13] }]);
  assert.equal(grouped.groups.length, 2, "another university never joins the run");
  assert.equal(collapseFeeAutoFill(make(["no digits", "no digits", "no digits"])).groups.length, 3);
});
