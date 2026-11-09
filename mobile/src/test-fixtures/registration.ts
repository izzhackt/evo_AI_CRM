import { STUDENT_APPLICATION_CONSENT_VERSION, type StudentApplicationDraft } from "@/features/registration/application-contract";
import { initialValues, type WizardValues } from "@/features/registration/wizard-model";

// Синтетические данные: ни одного настоящего человека, телефона или почты.
export const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
export const INVITE = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"; // 32 символа base64url, не настоящий токен

export function validDraft(overrides: Partial<StudentApplicationDraft> = {}): StudentApplicationDraft {
  return {
    schemaVersion: 1,
    requestId: REQUEST_ID,
    firstName: "Тест",
    lastName: "Студентов",
    phone: "+996 555 000 111",
    destinationCountries: ["CN", "MY"],
    intakeSeason: "autumn",
    intakeYear: 2027,
    educationLevel: "high_school",
    averageGrade: 4.5,
    gradeScale: "5",
    studyFields: ["Информатика и IT"],
    studyLevels: ["bachelor"],
    nationality: "KG",
    english: { mode: "exam", exam: "ielts", score: 6.5 },
    tuitionBudget: "5000_10000",
    fundingSource: "family",
    consent: true,
    consentVersion: STUDENT_APPLICATION_CONSENT_VERSION,
    ...overrides,
  };
}

export function filledValues(overrides: Partial<WizardValues> = {}): WizardValues {
  return { ...initialValues(REQUEST_ID, validDraft(), null, "test.student@example.test"), consent: true, ...overrides };
}
