import { filledValues, INVITE, REQUEST_ID, validDraft } from "@/test-fixtures/registration";
import { STUDENT_APPLICATION_CONSENT_VERSION, validateStudentApplicationDraft } from "@/features/registration/application-contract";
import {
  addCustomField,
  buildQuestionnaire,
  currentDestinations,
  firstInvalidStep,
  initialValues,
  LAST_STEP_INDEX,
  namePrefillFromDisplayName,
  parseNumber,
  restoreStep,
  restoreValues,
  toggleSelection,
  utf8ByteLength,
  validateStep,
  validDraft as validOf,
  WIZARD_STEPS,
} from "@/features/registration/wizard-model";

const empty = () => initialValues(REQUEST_ID);
const ctx = { password: "a".repeat(20), aiConsent: true };

describe("шаги", () => {
  it("7 шагов: «Образование» и «Ступень», «Гражданство» и «Английский» слиты", () => {
    expect(WIZARD_STEPS).toEqual(["countries", "intake", "educationLevels", "fields", "nationalityEnglish", "budget", "account"]);
    expect(LAST_STEP_INDEX).toBe(6);
  });
});

describe("проверка шагов (правила веба)", () => {
  it("пустая анкета не проходит ни один шаг", () => {
    const keys = WIZARD_STEPS.map((_, i) => validateStep(i, empty(), { password: null, aiConsent: false }));
    expect(keys.every((k) => k !== null)).toBe(true);
    expect(keys.slice(0, 6)).toEqual(["validation.countries", "validation.intake", "validation.education", "validation.fields", "validation.nationality", "validation.budget"]);
  });

  it("заполненная анкета проходит все шаги", () => {
    const values = filledValues();
    for (let i = 0; i < WIZARD_STEPS.length; i += 1) expect(validateStep(i, values, ctx)).toBeNull();
    expect(firstInvalidStep(values)).toBeNull();
  });

  it("страны: «Пока не решил» только одна, прочее вне списка отклоняется", () => {
    expect(validateStep(0, { ...empty(), destinationCountries: ["undecided"] })).toBeNull();
    expect(validateStep(0, { ...empty(), destinationCountries: ["undecided", "CN"] })).toBeNull(); // выбор вручную исправляет toggleSelection, а сервер отвергнет в validDraft
    expect(validateStep(0, { ...empty(), destinationCountries: ["DE"] })).toBe("validation.countries");
  });

  it("образование и ступень: сначала балл, потом ступень; балл в пределах шкалы, запятая допустима", () => {
    const base = { ...empty(), educationLevel: "bachelor", averageGrade: "4,5", gradeScale: "5" };
    expect(validateStep(2, base)).toBe("validation.levels");
    expect(validateStep(2, { ...base, studyLevels: ["master"] })).toBeNull();
    expect(validateStep(2, { ...base, studyLevels: ["master"], averageGrade: "5.1" })).toBe("validation.education");
    expect(validateStep(2, { ...base, studyLevels: ["master"], averageGrade: "-1" })).toBe("validation.education");
    expect(validateStep(2, { ...base, studyLevels: ["master"], averageGrade: "abc" })).toBe("validation.education");
    expect(validateStep(2, { ...base, studyLevels: ["master"], educationLevel: "" })).toBe("validation.education");
  });

  it("гражданство и английский: список ISO, шкала и шаг экзамена", () => {
    const base = { ...empty(), nationality: "KG" };
    expect(validateStep(4, { ...base, nationality: "ZZ" })).toBe("validation.nationality");
    expect(validateStep(4, base)).toBe("validation.english");
    expect(validateStep(4, { ...base, englishMode: "exam", englishExam: "ielts", englishScore: "" })).toBe("validation.englishScore");
    expect(validateStep(4, { ...base, englishMode: "exam", englishExam: "ielts", englishScore: "6.5" })).toBeNull();
    expect(validateStep(4, { ...base, englishMode: "exam", englishExam: "ielts", englishScore: "6.3" })).toBe("validation.englishScore");
    expect(validateStep(4, { ...base, englishMode: "exam", englishExam: "ielts", englishScore: "9.5" })).toBe("validation.englishScore");
    expect(validateStep(4, { ...base, englishMode: "exam", englishExam: "duolingo", englishScore: "105" })).toBeNull();
    expect(validateStep(4, { ...base, englishMode: "exam", englishExam: "duolingo", englishScore: "103" })).toBe("validation.englishScore");
    expect(validateStep(4, { ...base, englishMode: "self", englishLevel: "" })).toBe("validation.english");
    expect(validateStep(4, { ...base, englishMode: "self", englishLevel: "fluent" })).toBeNull();
  });

  it("аккаунт: имя, телефон, почта, пароль 12+ и ≤72 байт, обе галочки", () => {
    const values = filledValues();
    expect(validateStep(6, { ...values, firstName: " " }, ctx)).toBe("wizard.err.firstName");
    expect(validateStep(6, { ...values, phone: "12" }, ctx)).toBe("wizard.err.phone");
    expect(validateStep(6, { ...values, phone: "+996abc555" }, ctx)).toBe("wizard.err.phone");
    expect(validateStep(6, { ...values, email: "no-at" }, ctx)).toBe("wizard.err.email");
    expect(validateStep(6, values, { ...ctx, password: "short" })).toBe("wizard.err.password");
    expect(validateStep(6, values, { ...ctx, password: "я".repeat(40) })).toBe("wizard.err.passwordLong");
    expect(validateStep(6, { ...values, consent: false }, ctx)).toBe("wizard.err.consent");
    expect(validateStep(6, values, { ...ctx, aiConsent: false })).toBe("wizard.err.aiConsent");
    expect(validateStep(6, values, ctx)).toBeNull();
  });

  it("у вошедшего почта и пароль не спрашиваются, но обе галочки нужны", () => {
    const values = { ...filledValues(), email: "" };
    expect(validateStep(6, values, { password: null, aiConsent: true, signedInEmail: "me@example.test" })).toBeNull();
    expect(validateStep(6, values, { password: null, aiConsent: false })).toBe("wizard.err.aiConsent");
  });

  it("utf8ByteLength считает байты, а не символы", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("я")).toBe(2);
    expect(utf8ByteLength("€")).toBe(3);
    expect(utf8ByteLength("😀")).toBe(4);
  });
});

describe("выбор из списков", () => {
  it("«Пока не решил» и страны взаимоисключающие", () => {
    let v = toggleSelection(empty(), "destinationCountries", "CN").values;
    v = toggleSelection(v, "destinationCountries", "MY").values;
    expect(v.destinationCountries).toEqual(["CN", "MY"]);
    v = toggleSelection(v, "destinationCountries", "undecided").values;
    expect(v.destinationCountries).toEqual(["undecided"]);
    v = toggleSelection(v, "destinationCountries", "AE").values;
    expect(v.destinationCountries).toEqual(["AE"]);
    expect(toggleSelection(v, "destinationCountries", "AE").values.destinationCountries).toEqual([]);
  });

  it("пределы 10 направлений и 6 ступеней", () => {
    let v = empty();
    for (let i = 0; i < 10; i += 1) v = addCustomField(v, `Направление ${i}`).values;
    expect(v.studyFields).toHaveLength(10);
    const over = addCustomField(v, "Одиннадцатое");
    expect(over.limitExceeded).toBe(true);
    expect(over.values.studyFields).toHaveLength(10);
    expect(toggleSelection(v, "studyFields", "Направление 3").values.studyFields).toHaveLength(9);
  });

  it("своё направление: обрезка, без повтора и пустого", () => {
    const once = addCustomField(empty(), "  Своё  ").values;
    expect(once.studyFields).toEqual(["Своё"]);
    expect(addCustomField(once, "Своё").values.studyFields).toEqual(["Своё"]);
    expect(addCustomField(once, "   ").values.studyFields).toEqual(["Своё"]);
    expect(addCustomField(empty(), "я".repeat(150)).values.studyFields[0]).toHaveLength(100);
  });

  it("старые коды стран выпадают из восстановленного списка", () => {
    expect(currentDestinations(["DE", "CN", "undecided"])).toEqual(["CN"]);
    expect(currentDestinations(["undecided"])).toEqual(["undecided"]);
  });
});

describe("анкета для сервера", () => {
  it("собранная анкета проходит валидатор сервера и несёт текущую версию согласия", () => {
    const q = buildQuestionnaire(filledValues());
    const checked = validateStudentApplicationDraft(q);
    expect(checked).not.toBeNull();
    expect(checked?.consentVersion).toBe(STUDENT_APPLICATION_CONSENT_VERSION);
    expect(Object.keys(q as object)).toHaveLength(19);
    expect(validOf(filledValues())).not.toBeNull();
  });

  it("без галочки согласия анкета невалидна", () => {
    expect(validOf(filledValues({ consent: false }))).toBeNull();
  });

  it("числа уходят числами, запятая русской клавиатуры становится точкой", () => {
    const q = buildQuestionnaire(filledValues({ averageGrade: "4,25", intakeYear: "2028", englishScore: "7" })) as Record<string, unknown>;
    expect(q.averageGrade).toBe(4.25);
    expect(q.intakeYear).toBe(2028);
    expect((q.english as { score: number }).score).toBe(7);
    expect(parseNumber("")).toBeNaN();
    expect(parseNumber(" 3,5 ")).toBe(3.5);
  });

  it("имя и телефон обрезаются", () => {
    const q = buildQuestionnaire(filledValues({ firstName: "  Тест ", phone: " +996 555 000 111 " })) as Record<string, string>;
    expect(q.firstName).toBe("Тест");
    expect(q.phone).toBe("+996 555 000 111");
  });
});

describe("предзаполнение и восстановление", () => {
  it("имя из приглашения делится по первому пробелу", () => {
    expect(namePrefillFromDisplayName("Тест Студентов Иванович")).toEqual({ firstName: "Тест", lastName: "Студентов Иванович" });
    expect(namePrefillFromDisplayName("Тест")).toEqual({ firstName: "Тест", lastName: "" });
    expect(namePrefillFromDisplayName("   ")).toBeNull();
    expect(namePrefillFromDisplayName(null)).toBeNull();
  });

  it("анкета для исправления заполняет поля, но согласие сброшено", () => {
    const v = initialValues("22222222-2222-4222-8222-222222222222", validDraft(), null, "me@example.test");
    expect(v.firstName).toBe("Тест");
    expect(v.intakeYear).toBe("2027");
    expect(v.englishMode).toBe("exam");
    expect(v.consent).toBe(false);
    expect(v.requestId).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("restoreValues: чужие типы отбрасываются, согласие и requestId не восстанавливаются", () => {
    const base = empty();
    const restored = restoreValues(
      { requestId: "evil", consent: true, firstName: "Тест", phone: 5, destinationCountries: ["CN", "DE"], studyFields: ["a", 7], englishMode: "hack", intakeYear: "2027" },
      base,
    );
    expect(restored.requestId).toBe(REQUEST_ID);
    expect(restored.consent).toBe(false);
    expect(restored.firstName).toBe("Тест");
    expect(restored.phone).toBe("");
    expect(restored.destinationCountries).toEqual(["CN"]);
    expect(restored.studyFields).toEqual([]);
    expect(restored.englishMode).toBe("");
    expect(restored.intakeYear).toBe("2027");
    expect(restoreValues("garbage", base)).toBe(base);
  });

  it("restoreStep ограничивает шаг", () => {
    expect(restoreStep(3)).toBe(3);
    expect(restoreStep(99)).toBe(LAST_STEP_INDEX);
    expect(restoreStep(-4)).toBe(0);
    expect(restoreStep("x")).toBe(0);
    expect(restoreStep(2.5)).toBe(0);
  });

  it("токен приглашения в черновик не попадает", () => {
    expect(JSON.stringify(filledValues())).not.toContain(INVITE);
  });
});
