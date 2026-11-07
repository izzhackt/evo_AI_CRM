// «Похоже, этот студент уже есть» (07.11.2026): поиск похожих перед кабинетом «с нуля» и одобрением анкеты.
// Синтетические люди и номера; чтения подставлены, без Supabase.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { findPossibleDuplicates, POSSIBLE_DUPLICATE_LIMIT, samePersonName } from "../src/lib/v3/possible-duplicates.ts";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

const ME = "70000000-0000-4000-8000-000000000001";
const admin = { systemRole: "admin", presentationRole: null, membershipId: ME, assignments: [], permissionKeys: [] };
const sales = { systemRole: "staff", presentationRole: null, membershipId: ME, assignments: [], permissionKeys: ["lead.read"] };
const CASE = (n) => `90000000-0000-4000-8000-00000000000${n}`;
const LEAD = (n) => `a0000000-0000-4000-8000-00000000000${n}`;

function readers(log, { students, leads } = {}) {
  return {
    students: async (_actor, query, limit) => {
      log.push(["students", query, limit]);
      if (students) return students();
      return { rows: [
        { access: "full", studentCaseId: CASE(1), studentDisplayName: "Абдурахман Сатыбалдиев", targetCountry: "MY", targetDegree: null, state: "active" },
        { access: "sales_summary", studentCaseId: CASE(2), studentDisplayName: "Сатыбалдиев Абдурахман", targetCountry: null, targetDegree: null, state: "pending" },
        { access: "full", studentCaseId: CASE(3), studentDisplayName: "Бакыт Сатыбалдиев", targetCountry: "CN", targetDegree: null, state: "active" },
      ], hasNext: false };
    },
    leads: async (_actor, query, limit) => {
      log.push(["leads", query, limit]);
      if (leads) return leads();
      return { rows: [
        { leadId: LEAD(1), clientDisplayName: "Абдурахман Сатыбалдиев" },
        { leadId: LEAD(2), clientDisplayName: null },
        { leadId: LEAD(3), clientDisplayName: "Айдана Сатыбалдиева" },
      ], hasNext: false };
    },
  };
}

test("the same person by name: the surname as a whole word and a first name from the same two letters", () => {
  const person = { firstName: "Абурахман", lastName: "Сатыбалдиев" };
  assert.equal(samePersonName("Абдурахман Сатыбалдиев", person), true, "a spelling of the first name");
  assert.equal(samePersonName("САТЫБАЛДИЕВ  абдурахман", person), true, "any order and case");
  assert.equal(samePersonName("Бакыт Сатыбалдиев", person), false, "a namesake with another first name");
  assert.equal(samePersonName("Айдана Сатыбалдиева", person), false, "another surname form is another surname");
  assert.equal(samePersonName("Абурахман Сатыбалдиевa", person), false);
  assert.equal(samePersonName("Алёна Сёмина", { firstName: "Алена", lastName: "Семина" }), true, "ё reads as е");
  assert.equal(samePersonName("Сатыбалдиев", person), false, "a surname alone is not enough");
  assert.equal(samePersonName("Абдурахман Сатыбалдиев", { firstName: "", lastName: "Сатыбалдиев" }), false);
});

test("cases and leads with links: the student's own lead and case are skipped, the list is capped", async () => {
  const log = [];
  const found = await findPossibleDuplicates(admin, { firstName: "Абдурахман", lastName: "Сатыбалдиев" }, readers(log),
    { leadId: LEAD(9), studentCaseId: CASE(2) });
  assert.deepEqual(log, [["students", "Сатыбалдиев", 20], ["leads", "Сатыбалдиев", 20]], "one read per group, by the surname");
  assert.deepEqual(found, [
    { kind: "case", id: CASE(1), label: "Абдурахман Сатыбалдиев", meta: "MY", href: `/profile?case=${CASE(1)}` },
    { kind: "lead", id: LEAD(1), label: "Абдурахман Сатыбалдиев", meta: null, href: `/profile?id=${LEAD(1)}` },
  ]);
  const own = await findPossibleDuplicates(admin, { firstName: "Абдурахман", lastName: "Сатыбалдиев" }, readers([]), { leadId: LEAD(1) });
  assert.deepEqual(own.map((row) => row.id), [CASE(1), CASE(2)], "a summary-only case is still the same person; the own lead is not");
  const many = await findPossibleDuplicates(admin, { firstName: "Айдай", lastName: "Чынарова" }, readers([], {
    students: async () => ({ rows: Array.from({ length: 8 }, (_, n) => ({ access: "full", studentCaseId: CASE(n), studentDisplayName: "Айдай Чынарова",
      targetCountry: null, targetDegree: null, state: "active" })), hasNext: false }),
    leads: async () => ({ rows: [], hasNext: false }),
  }));
  assert.equal(many.length, POSSIBLE_DUPLICATE_LIMIT);
});

test("a role reads only its groups; a short surname or a failed read never stops the work", async () => {
  const log = [];
  const forSales = await findPossibleDuplicates(sales, { firstName: "Абдурахман", lastName: "Сатыбалдиев" }, readers(log));
  assert.deepEqual(log.map(([group]) => group), ["leads"], "Sales never reads cases");
  assert.deepEqual(forSales.map((row) => row.kind), ["lead"]);
  const quiet = [];
  assert.deepEqual(await findPossibleDuplicates(admin, { firstName: "Абдурахман", lastName: "Т" }, readers(quiet)), []);
  assert.equal(quiet.length, 0, "a one-letter surname reads nothing");
  const down = readers([], { students: async () => { throw new Error("down"); }, leads: async () => { throw new Error("down"); } });
  assert.deepEqual(await findPossibleDuplicates(admin, { firstName: "Абдурахман", lastName: "Сатыбалдиев" }, down), []);
});

test("both places that make a new student ask first and pass on «anyway»; the case cabinet does not ask", () => {
  const accounts = read("src/lib/student-account-actions.ts");
  assert.match(accounts, /\["request_id", "first_name", "last_name", "email", "confirm_duplicate"\]/u);
  assert.match(accounts, /\["request_id", "student_case_id", "first_name", "last_name", "email"\]/u, "the case form keeps its fields");
  assert.match(accounts, /provision\(previous, form, false, stopOnPossibleDuplicate\)/u);
  assert.match(accounts, /provision\(previous, form, true\) as/u);
  const decision = read("src/lib/student-application-actions.ts");
  assert.match(decision, /decision === "approve" && fields\.get\("confirm_duplicate"\) !== "1"/u);
  assert.match(decision, /leadId: application\.canonicalLeadId, studentCaseId: application\.studentCaseId/u);
  for (const [path, label] of [["src/components/staff/settings-next/StudentAccountsNext.tsx", "Всё равно создать"],
    ["src/components/staff/admissions/StudentApplications.tsx", "Всё равно одобрить"]]) {
    const screen = read(path);
    assert.match(screen, /name="confirm_duplicate" defaultValue=""/u, `${path}: the mark is empty until «anyway»`);
    assert.match(screen, new RegExp(`confirmLabel="${label}"`, "u"), path);
  }
  // Ctrl+K and the warning read the same way, with the staff member's rights.
  assert.match(read("src/lib/v3/command-palette-actions.ts"), /searchCommandPalette\(actor, query, STUDENT_SEARCH_READERS\)/u);
});
