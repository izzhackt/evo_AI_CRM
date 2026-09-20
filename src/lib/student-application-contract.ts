export const STUDENT_APPLICATION_METADATA_KEY = "student_application_draft";
export const STUDENT_APPLICATION_NATIONALITIES = "AF AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW".split(" ");
export const STUDENT_APPLICATION_CONSENT_VERSION = "2026-09-18";
export const STUDENT_APPLICATION_COUNTRIES = ["CN", "MY", "DE", "FR", "ES", "IT", "NL", "PL", "HU", "AT", "CZ", "GB", "CY", "TR", "AE"] as const;
export const STUDENT_APPLICATION_INTAKE_SEASONS = ["spring", "summer", "autumn", "winter", "undecided"] as const;
export const STUDENT_APPLICATION_EDUCATION_LEVELS = ["secondary", "high_school", "foundation", "diploma", "bachelor", "master", "phd"] as const;
export const STUDENT_APPLICATION_STUDY_LEVELS = ["foundation", "bachelor", "master", "phd", "diploma", "language"] as const;
export const STUDENT_APPLICATION_GRADE_SCALES = ["100", "5", "4", "10", "20"] as const;
export const STUDENT_APPLICATION_TUITION_BUDGETS = ["under_5000", "5000_10000", "10000_20000", "20000_30000", "over_30000", "undecided"] as const;
export const STUDENT_APPLICATION_FUNDING_SOURCES = ["family", "savings", "scholarship", "loan", "employer", "undecided"] as const;
export const STUDENT_APPLICATION_DIRECTIONS = ["CN", "MY", "EUROPE", "AE", "TR"] as const;
export type AdmissionsDirection = typeof STUDENT_APPLICATION_DIRECTIONS[number];
export type StudentApplicationEnglish = { mode: "exam"; exam: "ielts" | "toefl" | "toefl_120" | "pte" | "duolingo"; score: number } | { mode: "self"; level: "beginner" | "intermediate" | "advanced" | "fluent" };
export type StudentApplicationDraft = {
  schemaVersion: 1; requestId: string; firstName: string; lastName: string; phone: string;
  destinationCountries: string[]; intakeSeason: typeof STUDENT_APPLICATION_INTAKE_SEASONS[number]; intakeYear: number;
  educationLevel: typeof STUDENT_APPLICATION_EDUCATION_LEVELS[number]; averageGrade: number; gradeScale: typeof STUDENT_APPLICATION_GRADE_SCALES[number];
  studyFields: string[]; studyLevels: string[]; nationality: string; english: StudentApplicationEnglish;
  tuitionBudget: typeof STUDENT_APPLICATION_TUITION_BUDGETS[number]; fundingSource: typeof STUDENT_APPLICATION_FUNDING_SOURCES[number];
  consent: true; consentVersion: typeof STUDENT_APPLICATION_CONSENT_VERSION;
};
export type StudentApplication = {
  id: string; status: "pending" | "approved" | "rejected"; revision: number; email: string;
  questionnaire: StudentApplicationDraft; submittedAt: string; decidedAt: string | null;
  decisionReason: string | null; studentCaseId: string | null; admissionsDirection: AdmissionsDirection | null;
  /**
   * The unified-workflow canonical lead this application is linked to — set at
   * submit time when Продажи has a configured intake owner, or at approval
   * time otherwise (never both/neither). Null only before either has run.
   */
  canonicalLeadId: string | null;
};
export type StudentApplicationCurator = { membershipId: string; displayName: string; directions: AdmissionsDirection[] };
export type StudentApplicationQueue = { applications: StudentApplication[]; curators: StudentApplicationCurator[]; pendingCount: number };
export type StudentApplicationActionState = { status: "idle" | "saved" | "invalid" | "forbidden" | "conflict" | "unavailable"; requestId?: string };

export function isStudentApplicationUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function isStudentApplicationRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value === value.trim() && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}
function stringSet(value: unknown, max: number, validate: (item: unknown) => boolean): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= max && value.every(validate) && new Set(value).size === value.length;
}
const DRAFT_KEYS = ["schemaVersion", "requestId", "firstName", "lastName", "phone", "destinationCountries", "intakeSeason", "intakeYear", "educationLevel", "averageGrade", "gradeScale", "studyFields", "studyLevels", "nationality", "english", "tuitionBudget", "fundingSource", "consent", "consentVersion"].sort().join(",");

/** Metadata is an editable draft, never an authority claim. Revalidate on every submission. */
export function validateStudentApplicationDraft(value: unknown): StudentApplicationDraft | null {
  if (!isStudentApplicationRecord(value) || Object.keys(value).sort().join(",") !== DRAFT_KEYS
    || value.schemaVersion !== 1 || !isStudentApplicationUuid(value.requestId)
    || !text(value.firstName, 60) || !text(value.lastName, 60)
    || !text(value.phone, 40) || !/^\+?[0-9 ()-]{7,40}$/.test(value.phone) || value.phone.replace(/\D/g, "").length < 7 || value.phone.replace(/\D/g, "").length > 15
    || !stringSet(value.destinationCountries, 15, (v) => oneOf(STUDENT_APPLICATION_COUNTRIES, v))
    || !oneOf(STUDENT_APPLICATION_INTAKE_SEASONS, value.intakeSeason)
    || !Number.isInteger(value.intakeYear) || Number(value.intakeYear) < 2026 || Number(value.intakeYear) > 2036
    || !oneOf(STUDENT_APPLICATION_EDUCATION_LEVELS, value.educationLevel)
    || !oneOf(STUDENT_APPLICATION_GRADE_SCALES, value.gradeScale)
    || typeof value.averageGrade !== "number" || !Number.isFinite(value.averageGrade) || value.averageGrade < 0 || value.averageGrade > Number(value.gradeScale)
    || !stringSet(value.studyFields, 10, (v) => text(v, 100))
    || !stringSet(value.studyLevels, 6, (v) => oneOf(STUDENT_APPLICATION_STUDY_LEVELS, v))
    || typeof value.nationality !== "string" || !STUDENT_APPLICATION_NATIONALITIES.includes(value.nationality)
    || !oneOf(STUDENT_APPLICATION_TUITION_BUDGETS, value.tuitionBudget)
    || !oneOf(STUDENT_APPLICATION_FUNDING_SOURCES, value.fundingSource)
    || value.consent !== true || value.consentVersion !== STUDENT_APPLICATION_CONSENT_VERSION
    || !isStudentApplicationRecord(value.english)) return null;
  const english = value.english;
  if (english.mode === "self") {
    if (Object.keys(english).sort().join(",") !== "level,mode" || !oneOf(["beginner", "intermediate", "advanced", "fluent"], english.level)) return null;
  } else if (english.mode === "exam") {
    const ranges = { ielts: [0, 9, 0.5], toefl: [1, 6, 0.5], toefl_120: [0, 120, 1], pte: [10, 90, 1], duolingo: [10, 160, 5] };
    if (Object.keys(english).sort().join(",") !== "exam,mode,score" || !oneOf(["ielts", "toefl", "toefl_120", "pte", "duolingo"], english.exam)
      || typeof english.score !== "number" || !Number.isFinite(english.score)) return null;
    const [min, max, step] = ranges[english.exam as keyof typeof ranges];
    if (english.score < min || english.score > max || !Number.isInteger(english.score / step)) return null;
  } else return null;
  return value as StudentApplicationDraft;
}

export function studentApplicationCountryDirection(country: string): AdmissionsDirection | null {
  if (!(STUDENT_APPLICATION_COUNTRIES as readonly string[]).includes(country)) return null;
  return country === "CN" || country === "MY" || country === "AE" || country === "TR" ? country : "EUROPE";
}
