// Общий разбор своей анкеты: голова (статус и даты) совпадает с `decodeStudentApplication` веба, который здесь выполняется
// по-настоящему (файл веба `server-only`, из приложения его не подключить: функции вырезаются из его текста).
import { decodeApplicationHead, isApplicationStatus, isTimestamp } from "@/domain/own-application";
import { decodeHomeApplication } from "@/api/portal-reads";
import { PortalDecodeError } from "@/domain/portal-source";
import { decodeFullApplication } from "@/features/registration/own-application";
import { decodeOwnApplication } from "@/session/deps";
import { extractWebFunctions } from "@/test-fixtures/web-oracle";
import { validDraft } from "@/test-fixtures/registration";

// requireActual: тип веб-модуля не подключаем (tsc приложения не должен обходить серверный код).
const contract = jest.requireActual("@web/lib/student-application-contract") as Record<string, unknown>;

class StudentApplicationSourceError extends Error {}
const web = extractWebFunctions(
  "lib/v3/student-application-source.ts",
  ["fail", "date", "direction", "decodeStudentApplication"],
  {
    StudentApplicationSourceError,
    isStudentApplicationRecord: contract.isStudentApplicationRecord,
    isStudentApplicationUuid: contract.isStudentApplicationUuid,
    validateStudentApplicationDraft: contract.validateStudentApplicationDraft,
    STUDENT_APPLICATION_DIRECTIONS: contract.STUDENT_APPLICATION_DIRECTIONS,
  },
) as { decodeStudentApplication: (value: unknown) => unknown };
const webAccepts = (row: unknown) => {
  try {
    web.decodeStudentApplication(row);
    return true;
  } catch {
    return false;
  }
};

const CASE_ID = "44444444-4444-4444-8444-444444444444";
const SUBMITTED = "2026-11-10T04:00:00+00:00";
const DECIDED = "2026-11-18T09:00:00+00:00";

/** Строка в форме веба: всё, кроме головы, верно (согласованность `approved` и дела - за статусом). */
function row(overrides: Record<string, unknown> = {}) {
  const status = (overrides.status as string | undefined) ?? "approved";
  return {
    id: "33333333-3333-4333-8333-333333333333",
    status,
    revision: 2,
    email: "me@example.test",
    questionnaire: validDraft(),
    submitted_at: SUBMITTED,
    decided_at: status === "pending" ? null : DECIDED,
    decision_reason: null,
    student_case_id: status === "approved" ? CASE_ID : null,
    admissions_direction: null,
    canonical_lead_id: null,
    ...overrides,
  };
}

describe("голова анкеты: те же правила, что у decodeStudentApplication веба", () => {
  it("настоящая веб-функция принимает строку-образец (проверка самой проверки)", () => {
    expect(webAccepts(row())).toBe(true);
    expect(webAccepts(row({ status: "pending" }))).toBe(true);
    expect(webAccepts(row({ status: "rejected" }))).toBe(true);
    expect(webAccepts(row({ email: "no-at-sign" }))).toBe(false);
  });

  const statuses = ["pending", "approved", "rejected", "unknown", "", null, 3];
  const submitted = [SUBMITTED, "2026-11-10", "вчера", "", null, 5];
  const decided = [null, DECIDED, "не дата", "", 7];
  const combos = statuses.flatMap((status) => submitted.flatMap((submittedAt) => decided.map((decidedAt) => ({ status, submittedAt, decidedAt }))));

  it.each(combos.map((combo) => [JSON.stringify(combo), combo] as const))("%s: приложение принимает ровно то, что принимает веб", (_name, combo) => {
    const candidate = row({ status: combo.status, submitted_at: combo.submittedAt, decided_at: combo.decidedAt, student_case_id: combo.status === "approved" ? CASE_ID : null });
    const accepted = webAccepts(candidate);
    expect(decodeApplicationHead(candidate) !== null).toBe(accepted);
    // «Главная» принимает то же, а чужую форму называет ошибкой данных
    if (accepted) expect(decodeHomeApplication(candidate)).toEqual({ status: combo.status, submittedAt: combo.submittedAt, decidedAt: combo.decidedAt });
    else expect(() => decodeHomeApplication(candidate)).toThrow(PortalDecodeError);
  });
});

describe("общие проверки", () => {
  it("статусы: три слова и ничего другого", () => {
    for (const status of ["pending", "approved", "rejected"]) expect(isApplicationStatus(status)).toBe(true);
    for (const status of ["Pending", "decided", "", null, undefined, 1, {}]) expect(isApplicationStatus(status)).toBe(false);
  });

  it("момент времени: строка, которая разбирается", () => {
    expect(isTimestamp("2026-11-10T04:00:00+00:00")).toBe(true);
    for (const value of ["вчера", "", null, undefined, 5, {}]) expect(isTimestamp(value)).toBe(false);
  });

  it("анкета без даты решения у решённой и с датой у рассматриваемой - не голова", () => {
    expect(decodeApplicationHead({ status: "approved", submitted_at: SUBMITTED, decided_at: null })).toBeNull();
    expect(decodeApplicationHead({ status: "pending", submitted_at: SUBMITTED, decided_at: DECIDED })).toBeNull();
    expect(decodeApplicationHead({ status: "pending", submitted_at: SUBMITTED })).toEqual({ status: "pending", submittedAt: SUBMITTED, decidedAt: null });
  });
});

describe("три места, которые читают анкету, называют статус одинаково", () => {
  it.each(["pending", "approved", "rejected", "unknown", 1])("статус %j", (status) => {
    const candidate = row({ status, student_case_id: status === "approved" ? CASE_ID : null });
    const full = (() => {
      try {
        return decodeFullApplication(candidate)?.status ?? null;
      } catch {
        return "ошибка";
      }
    })();
    const gate = (() => {
      try {
        return decodeOwnApplication(candidate)?.status ?? null;
      } catch {
        return "ошибка";
      }
    })();
    const valid = isApplicationStatus(status);
    expect(full).toBe(valid ? status : "ошибка");
    expect(gate).toBe(valid ? status : "ошибка");
  });
});
