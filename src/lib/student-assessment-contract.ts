export const STUDENT_ASSESSMENT_KEYS = ["english36", "orvis92"] as const;
export type StudentAssessmentKey = (typeof STUDENT_ASSESSMENT_KEYS)[number];
export const ORVIS_SCALES = ["leadership", "organization", "altruism", "creativity", "analysis", "production", "adventure", "erudition"] as const;
export type OrvisScale = (typeof ORVIS_SCALES)[number];
export type AssessmentAnswers = Record<string, string>;
export type AssessmentQuestion = {
  id: string;
  prompt: string;
  options: { id: string; label: string }[];
  topic?: string;
  passage?: string;
};
export type AssessmentProfession = {
  id: string; title: string; scaleIds: OrvisScale[]; summary: string;
  tasks: string[]; skills: string[]; studyDirections: string[]; tryActivity: string;
  careerPath?: string[];
  source: { url: string; occupationId: string; version: string; retrievedOn: string; license: string; licenseUrl: string };
  editorialNote: string;
};
export type AssessmentMetadata = {
  title: string; description: string; instructions: string[]; limitations: string[];
  bands?: { id: string; label: string }[];
  recommendations?: Partial<Record<"grammar" | "vocabulary" | "reading", string>>;
  blueprint?: { questionId: string; skill: string }[];
  skillLabels?: Record<string, string>;
  scales?: { id: OrvisScale; label: string; description: string }[];
  professions?: AssessmentProfession[];
  professionAttribution?: string;
};
export type AssessmentResult = {
  instrumentKey: StudentAssessmentKey; version: string; metadata: AssessmentMetadata;
  answeredCount: number; questionCount: number; completedAt: string;
  english?: {
    correctCount: number; totalCount: number; band?: string;
    topics: { topic: string; correctCount: number; totalCount: number }[];
    feedback: { questionId: string; selectedOptionId: string; correctOptionId: string; correct: boolean; explanation: string; topic: string }[];
  };
  orvis?: { scales: { scale: OrvisScale; rawSum: number; itemCount: number; mean: number }[]; topScales: OrvisScale[] };
};
export type AssessmentAttempt = {
  attemptId: string; instrumentKey: StudentAssessmentKey; versionId: string; version: string;
  locale: string; status: "draft" | "completed"; revision: number; metadata: AssessmentMetadata;
  questions: AssessmentQuestion[]; answers: AssessmentAnswers; result: AssessmentResult | null;
  createdAt: string; updatedAt: string; completedAt: string | null;
};
export type AssessmentAttemptSummary = Pick<AssessmentAttempt, "attemptId" | "instrumentKey" | "version" | "status" | "revision" | "createdAt" | "updatedAt" | "completedAt"> & {
  answeredCount: number; questionCount: number;
};
export type AssessmentCatalog = {
  instruments: {
    instrumentKey: StudentAssessmentKey; versionId: string; version: string; locale: string;
    metadata: AssessmentMetadata; questionCount: number;
    draftAttemptId: string | null; latestCompletedAttemptId: string | null;
  }[];
  attempts: AssessmentAttemptSummary[];
};
export type AssessmentActionResult =
  | { ok: true; attempt: AssessmentAttempt }
  | { ok: false; code: "conflict" | "invalid" | "unavailable" | "denied"; message: string };
export type AssessmentWriteInput = {
  attemptId: string; expectedRevision: number; answers: AssessmentAnswers; requestId: string;
};

export function assessmentPath(key: StudentAssessmentKey): string {
  return key === "english36" ? "/portal/tests/english" : "/portal/tests/career";
}

export function isAssessmentKey(value: unknown): value is StudentAssessmentKey {
  return value === "english36" || value === "orvis92";
}

export function assessmentAnswersFingerprint(answers: AssessmentAnswers): string {
  return JSON.stringify(Object.fromEntries(Object.entries(answers).sort(([a], [b]) => a.localeCompare(b))));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isAssessmentUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** No identity or score fields are accepted from the browser. */
export function parseAssessmentWriteInput(value: unknown): AssessmentWriteInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "answers,attemptId,expectedRevision,requestId") return null;
  if (!isAssessmentUuid(row.attemptId) || !isAssessmentUuid(row.requestId)
    || !Number.isSafeInteger(row.expectedRevision) || Number(row.expectedRevision) < 0
    || !row.answers || typeof row.answers !== "object" || Array.isArray(row.answers)) return null;
  const entries = Object.entries(row.answers);
  if (entries.length > 92 || entries.some(([key, answer]) => !/^[a-zA-Z0-9_-]{1,80}$/.test(key)
    || typeof answer !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(answer)
    || ["__proto__", "constructor", "prototype"].includes(key))) return null;
  return { attemptId: row.attemptId, expectedRevision: Number(row.expectedRevision), answers: Object.fromEntries(entries) as AssessmentAnswers, requestId: row.requestId };
}
