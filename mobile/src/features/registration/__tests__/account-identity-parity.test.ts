// Порт двух правил веба (src/lib/student-account-contract.ts, 342) обязан совпадать с ним на одних и тех же входах.
import * as port from "@/features/registration/account-identity";

type Web = {
  ACCOUNT_NAME_PREFILL_KEY: string;
  TECHNICAL_STUDENT_EMAIL_DOMAIN: string;
  isTechnicalStudentEmail: (email: string | null | undefined) => boolean;
  accountNamePrefill: (userMetadata: unknown) => { firstName: string; lastName: string } | null;
};
// requireActual: тип веб-модуля не подключаем (tsc приложения не должен обходить серверный код).
const web = jest.requireActual("@web/lib/student-account-contract") as Web;

describe("константы совпадают с вебом", () => {
  it("ключ подсказки имени и домен служебной почты", () => {
    expect(port.ACCOUNT_NAME_PREFILL_KEY).toBe(web.ACCOUNT_NAME_PREFILL_KEY);
    expect(port.TECHNICAL_STUDENT_EMAIL_DOMAIN).toBe(web.TECHNICAL_STUDENT_EMAIL_DOMAIN);
    expect(port.ACCOUNT_NAME_PREFILL_KEY).toBe("evo_name_prefill");
    expect(port.TECHNICAL_STUDENT_EMAIL_DOMAIN).toBe("students.evoadmissions.invalid");
  });
});

describe("isTechnicalStudentEmail", () => {
  const samples: [string, string | null | undefined][] = [
    ["служебная", "aigul.test@students.evoadmissions.invalid"],
    ["служебная в верхнем регистре", "AIGUL.TEST@STUDENTS.EVOADMISSIONS.INVALID"],
    ["обычная", "student@example.test"],
    ["чужой поддомен", "student@mail.students.evoadmissions.invalid.example.test"],
    ["без собаки", "students.evoadmissions.invalid"],
    ["похожая зона", "student@students.evoadmissions.invalid.com"],
    ["пустая", ""],
    ["null", null],
    ["undefined", undefined],
  ];
  it.each(samples)("%s: то же, что в вебе", (_name, email) => {
    expect(port.isTechnicalStudentEmail(email)).toBe(web.isTechnicalStudentEmail(email));
  });
  it("служебная почта скрывается, обычная нет", () => {
    expect(port.isTechnicalStudentEmail("aigul.test@students.evoadmissions.invalid")).toBe(true);
    expect(port.isTechnicalStudentEmail("student@example.test")).toBe(false);
  });
});

describe("accountNamePrefill", () => {
  const meta = (value: unknown) => ({ evo_name_prefill: value });
  const samples: [string, unknown][] = [
    ["имя и фамилия", meta({ firstName: "Айгүл", lastName: "Тестова" })],
    ["пробелы по краям и внутри", meta({ firstName: "  Айгүл   Мээрим ", lastName: " Тестова " })],
    ["нет фамилии", meta({ firstName: "Айгүл", lastName: "" })],
    ["нет имени", meta({ firstName: "", lastName: "Тестова" })],
    ["одни пробелы", meta({ firstName: "   ", lastName: "   " })],
    ["ровно 60 знаков", meta({ firstName: "а".repeat(60), lastName: "б".repeat(60) })],
    ["61 знак", meta({ firstName: "а".repeat(61), lastName: "б" })],
    ["угловая скобка", meta({ firstName: "<b>Айгүл", lastName: "Тестова" })],
    ["управляющий знак", meta({ firstName: "Ай\u0007гүл", lastName: "Тестова" })],
    ["перевод строки", meta({ firstName: "Айгүл\nМээрим", lastName: "Тестова" })],
    ["число вместо строки", meta({ firstName: 5, lastName: "Тестова" })],
    ["значение не объект", meta("Айгүл Тестова")],
    ["значение null", meta(null)],
    ["нет ключа", { other: 1 }],
    ["метаданные null", null],
    ["метаданные строка", "x"],
    ["метаданные undefined", undefined],
  ];
  it.each(samples)("%s: то же, что в вебе", (_name, metadata) => {
    expect(port.accountNamePrefill(metadata)).toEqual(web.accountNamePrefill(metadata));
  });
  it("подсказка берёт имя и фамилию, которые ввёл администратор", () => {
    expect(port.accountNamePrefill(meta({ firstName: "  Айгүл ", lastName: "Тестова" }))).toEqual({ firstName: "Айгүл", lastName: "Тестова" });
    expect(port.accountNamePrefill(meta({ firstName: "Айгүл", lastName: "" }))).toBeNull();
  });
});
