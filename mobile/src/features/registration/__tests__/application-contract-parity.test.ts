// Порт контракта анкеты обязан совпадать с модулем веба (см. шапку application-contract.ts).
import * as port from "@/features/registration/application-contract";
import { validDraft } from "@/test-fixtures/registration";

type Web = typeof port;
// requireActual: тип веб-модуля не подключаем (tsc приложения не должен обходить серверный код).
const web = jest.requireActual("@web/lib/student-application-contract") as Web;
const webPresentation = jest.requireActual("@web/lib/student-application-presentation") as Pick<Web, "ENGLISH_EXAMS" | "STUDY_FIELD_OPTIONS" | "NATIONALITY_COUNTRIES"> & { localizedCountryLabel: Web["localizedCountryLabel"] };

describe("константы совпадают с вебом", () => {
  it.each([
    "STUDENT_APPLICATION_METADATA_KEY",
    "STUDENT_APPLICATION_NATIONALITIES",
    "STUDENT_APPLICATION_CONSENT_VERSION",
    "STUDENT_APPLICATION_LEGACY_CONSENT_VERSIONS",
    "STUDENT_AI_CONSENT_METADATA_KEY",
    "STUDENT_APPLICATION_COUNTRIES",
    "STUDENT_APPLICATION_LEGACY_COUNTRIES",
    "STUDENT_APPLICATION_INTAKE_SEASONS",
    "STUDENT_APPLICATION_EDUCATION_LEVELS",
    "STUDENT_APPLICATION_STUDY_LEVELS",
    "STUDENT_APPLICATION_GRADE_SCALES",
    "STUDENT_APPLICATION_TUITION_BUDGETS",
    "STUDENT_APPLICATION_FUNDING_SOURCES",
  ] as const)("%s", (name) => {
    expect((port as Record<string, unknown>)[name]).toEqual((web as Record<string, unknown>)[name]);
  });

  it("презентация: экзамены, направления, гражданство, подписи стран", () => {
    expect(port.ENGLISH_EXAMS).toEqual(webPresentation.ENGLISH_EXAMS);
    expect([...port.STUDY_FIELD_OPTIONS]).toEqual([...webPresentation.STUDY_FIELD_OPTIONS]);
    expect(port.NATIONALITY_COUNTRIES).toEqual(webPresentation.NATIONALITY_COUNTRIES);
    for (const code of ["KG", "CN", "MY", "undecided", "DE", "US"]) {
      for (const locale of ["ru", "ky"]) expect(port.localizedCountryLabel(code, locale)).toBe(webPresentation.localizedCountryLabel(code, locale));
    }
  });

  it("версия согласия — текущая 2026-11-07", () => {
    expect(port.STUDENT_APPLICATION_CONSENT_VERSION).toBe("2026-11-07");
  });
});

// Набор мутаций анкеты: валидатор порта и веба должны отвечать одинаково на каждую.
const mutations: [string, (d: Record<string, unknown>) => void][] = [
  ["без изменений", () => undefined],
  ["лишний ключ", (d) => void (d.extra = 1)],
  ["нет ключа", (d) => void delete d.phone],
  ["requestId не UUID", (d) => void (d.requestId = "nope")],
  ["пустое имя", (d) => void (d.firstName = "")],
  ["имя с пробелами по краям", (d) => void (d.firstName = " Тест")],
  ["имя 61 знак", (d) => void (d.firstName = "я".repeat(61))],
  ["телефон 6 цифр", (d) => void (d.phone = "+99655512")],
  ["телефон с буквами", (d) => void (d.phone = "+996abc5551112")],
  ["телефон 16 цифр", (d) => void (d.phone = "+9965550001112223")],
  ["страна вне списка", (d) => void (d.destinationCountries = ["ZZ"])],
  ["старая страна", (d) => void (d.destinationCountries = ["DE"])],
  ["undecided с другой", (d) => void (d.destinationCountries = ["undecided", "CN"])],
  ["undecided один", (d) => void (d.destinationCountries = ["undecided"])],
  ["повтор страны", (d) => void (d.destinationCountries = ["CN", "CN"])],
  ["год 2025", (d) => void (d.intakeYear = 2025)],
  ["год 2037", (d) => void (d.intakeYear = 2037)],
  ["год дробный", (d) => void (d.intakeYear = 2027.5)],
  ["балл выше шкалы", (d) => void (d.averageGrade = 5.1)],
  ["балл NaN", (d) => void (d.averageGrade = Number.NaN)],
  ["шкала 7", (d) => void (d.gradeScale = "7")],
  ["нет направлений", (d) => void (d.studyFields = [])],
  ["11 направлений", (d) => void (d.studyFields = Array.from({ length: 11 }, (_, i) => `Поле ${i}`))],
  ["ступень чужая", (d) => void (d.studyLevels = ["school"])],
  ["гражданство чужое", (d) => void (d.nationality = "XX")],
  ["английский self", (d) => void (d.english = { mode: "self", level: "fluent" })],
  ["английский self плохой", (d) => void (d.english = { mode: "self", level: "god" })],
  ["ielts 6.3", (d) => void (d.english = { mode: "exam", exam: "ielts", score: 6.3 })],
  ["ielts 9", (d) => void (d.english = { mode: "exam", exam: "ielts", score: 9 })],
  ["toefl 7", (d) => void (d.english = { mode: "exam", exam: "toefl", score: 7 })],
  ["duolingo 105", (d) => void (d.english = { mode: "exam", exam: "duolingo", score: 105 })],
  ["duolingo 103", (d) => void (d.english = { mode: "exam", exam: "duolingo", score: 103 })],
  ["английский лишний ключ", (d) => void (d.english = { mode: "self", level: "fluent", x: 1 })],
  ["бюджет чужой", (d) => void (d.tuitionBudget = "free")],
  ["согласие false", (d) => void (d.consent = false)],
  ["старая версия согласия", (d) => void (d.consentVersion = "2026-09-18")],
  ["неизвестная версия", (d) => void (d.consentVersion = "2030-01-01")],
  ["schemaVersion 2", (d) => void (d.schemaVersion = 2)],
];

describe("валидатор анкеты: порт = веб", () => {
  it.each(mutations)("%s", (_name, mutate) => {
    const draft = JSON.parse(JSON.stringify(validDraft())) as Record<string, unknown>;
    mutate(draft);
    expect(port.validateStudentApplicationDraft(draft) !== null).toBe(web.validateStudentApplicationDraft(draft) !== null);
  });

  it("не объект", () => {
    for (const value of [null, undefined, 5, "x", [], [validDraft()]]) {
      expect(port.validateStudentApplicationDraft(value)).toBeNull();
      expect(web.validateStudentApplicationDraft(value)).toBeNull();
    }
  });
});
