// Строгие декодеры тестов (english36, orvis92): порт нормализаторов src/lib/v3/student-assessment-source.ts.
// Веб-файл тянет серверный клиент Supabase динамическим импортом, поэтому страж общих импортов его
// не пропускает; правила разбора те же (белый список полей вопроса: ключи проверки в черновик не
// попадают), типы берутся из общего контракта. Любое отклонение формы: PortalDecodeError без данных.
import {
  ORVIS_SCALES,
  isAssessmentKey,
  isAssessmentUuid,
  type AssessmentAttempt,
  type AssessmentCatalog,
  type AssessmentMetadata,
  type AssessmentProfession,
  type AssessmentQuestion,
  type AssessmentResult,
  type OrvisScale,
  type StudentAssessmentKey,
} from "@web/lib/student-assessment-contract";

import { PortalDecodeError } from "@/domain/portal-source";

const fail = (): never => { throw new PortalDecodeError(); };
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail();
}
function text(value: unknown, max = 12000): string { return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? value : fail(); }
function list<T>(value: unknown, parse: (value: unknown) => T, max = 100): T[] { return Array.isArray(value) && value.length <= max ? value.map(item => parse(item)) : fail(); }
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : fail(); }
function uuid(value: unknown): string { return isAssessmentUuid(value) ? value : fail(); }
function timestamp(value: unknown): string { const result = text(value, 40); return /^\d{4}-\d{2}-\d{2}T/.test(result) && Number.isFinite(Date.parse(result)) ? result : fail(); }
function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null { return value === null ? null : parse(value); }
function key(value: unknown): StudentAssessmentKey { return isAssessmentKey(value) ? value : fail(); }
function scale(value: unknown): OrvisScale { return typeof value === "string" && (ORVIS_SCALES as readonly string[]).includes(value) ? value as OrvisScale : fail(); }
function url(value: unknown): string { const result = text(value, 2000); try { return new URL(result).protocol === "https:" ? result : fail(); } catch { return fail(); } }
function profession(value: unknown): AssessmentProfession {
  const row = record(value); const source = record(row.source);
  return { id: text(row.id, 100), title: text(row.title, 300), scaleIds: list(row.scaleIds, scale, 8), summary: text(row.summary), tasks: list(row.tasks, text, 20), skills: list(row.skills, text, 20), studyDirections: list(row.studyDirections, text, 20), tryActivity: text(row.tryActivity), ...(row.careerPath ? { careerPath: list(row.careerPath, text, 10) } : {}), editorialNote: text(row.editorialNote), source: { url: url(source.url), occupationId: text(source.occupationId, 100), version: text(source.version, 100), retrievedOn: text(source.retrievedOn, 20), license: text(source.license, 100), licenseUrl: url(source.licenseUrl) } };
}
function metadata(value: unknown): AssessmentMetadata {
  const row = record(value);
  return { title: text(row.title, 300), description: text(row.description), instructions: list(row.instructions, text, 30), limitations: list(row.limitations, text, 30),
    ...(row.bands ? { bands: list(row.bands, item => { const b = record(item); return { id: text(b.id, 100), label: text(b.label, 300) }; }, 10) } : {}),
    ...(row.recommendations ? { recommendations: Object.fromEntries(Object.entries(record(row.recommendations)).filter(([topic]) => ["grammar", "vocabulary", "reading"].includes(topic)).map(([topic, value]) => [topic, text(value)])) } : {}),
    ...(row.blueprint ? { blueprint: list(row.blueprint, value => { const b = record(value); return { questionId: text(b.questionId, 80), skill: text(b.skill, 100) }; }, 36) } : {}),
    ...(row.skillLabels ? { skillLabels: Object.fromEntries(Object.entries(record(row.skillLabels)).slice(0, 36).map(([id, value]) => [text(id, 100), text(value, 300)])) } : {}),
    ...(row.scales ? { scales: list(row.scales, item => { const s = record(item); return { id: scale(s.id), label: text(s.label, 100), description: text(s.description) }; }, 8) } : {}),
    ...(row.professions ? { professions: list(row.professions, profession, 32) } : {}),
    ...(row.professionAttribution ? { professionAttribution: text(row.professionAttribution) } : {}),
  };
}
function question(value: unknown): AssessmentQuestion {
  const row = record(value);
  // Allowlist projection: grading keys are never serialized into a draft.
  return { id: text(row.id, 80), prompt: text(row.prompt), options: list(row.options, option => { const o = record(option); return { id: text(o.id, 80), label: text(o.label, 2000) }; }, 8), ...(row.topic ? { topic: text(row.topic, 100) } : {}), ...(row.passage ? { passage: text(row.passage) } : {}) };
}
function result(value: unknown): AssessmentResult {
  const row = record(value); const instrumentKey = key(row.instrumentKey);
  const base = { instrumentKey, version: text(row.version, 100), metadata: metadata(row.metadata), answeredCount: integer(row.answeredCount, 92), questionCount: integer(row.questionCount, 92), completedAt: timestamp(row.completedAt) };
  if (instrumentKey === "english36") {
    const e = record(row.english);
    return { ...base, english: { correctCount: integer(e.correctCount, 36), totalCount: integer(e.totalCount, 36), ...(e.band ? { band: text(e.band, 100) } : {}), topics: list(e.topics, value => { const t = record(value); return { topic: text(t.topic, 100), correctCount: integer(t.correctCount, 36), totalCount: integer(t.totalCount, 36) }; }), feedback: list(e.feedback, value => { const f = record(value); return { questionId: text(f.questionId, 80), selectedOptionId: text(f.selectedOptionId, 80), correctOptionId: text(f.correctOptionId, 80), correct: typeof f.correct === "boolean" ? f.correct : fail(), explanation: text(f.explanation), topic: text(f.topic, 100) }; }, 36) } };
  }
  const o = record(row.orvis);
  return { ...base, orvis: { scales: list(o.scales, value => { const s = record(value); const mean = s.mean; return { scale: scale(s.scale), rawSum: integer(s.rawSum, 70), itemCount: integer(s.itemCount, 14), mean: typeof mean === "number" && Number.isFinite(mean) && mean >= 1 && mean <= 5 ? mean : fail() }; }, 8), topScales: list(o.topScales, scale, 8) } };
}
export function normalizeAssessmentAttempt(value: unknown): AssessmentAttempt {
  const row = record(value); const status = row.status === "draft" || row.status === "completed" ? row.status : fail();
  const questions = list(row.questions, question, 92); const answers = record(row.answers);
  if (Object.keys(answers).length > 92 || Object.entries(answers).some(([id, value]) => !questions.some(q => q.id === id && q.options.some(o => o.id === value)))) return fail();
  const parsedResult = nullable(row.result, result);
  if ((status === "completed") !== (parsedResult !== null) || (status === "completed") !== (row.completedAt !== null)) return fail();
  if (new Set(questions.map(q => q.id)).size !== questions.length || questions.some(q => q.options.length < 2 || new Set(q.options.map(o => o.id)).size !== q.options.length)) return fail();
  if (parsedResult && (parsedResult.instrumentKey !== row.instrumentKey || parsedResult.version !== row.version || parsedResult.questionCount !== questions.length || parsedResult.answeredCount !== questions.length || Object.keys(answers).length !== questions.length)) return fail();
  return { attemptId: uuid(row.attemptId), instrumentKey: key(row.instrumentKey), versionId: uuid(row.versionId), version: text(row.version, 100), locale: text(row.locale, 20), status, revision: integer(row.revision), metadata: metadata(row.metadata), questions, answers: Object.fromEntries(Object.entries(answers).map(([id, value]) => [id, text(value, 80)])), result: parsedResult, createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt), completedAt: nullable(row.completedAt, timestamp) };
}
export function normalizeAssessmentCatalog(value: unknown): AssessmentCatalog {
  const row = record(value);
  return { instruments: list(row.instruments, value => { const i = record(value); return { instrumentKey: key(i.instrumentKey), versionId: uuid(i.versionId), version: text(i.version, 100), locale: text(i.locale, 20), metadata: metadata(i.metadata), questionCount: integer(i.questionCount, 92), draftAttemptId: nullable(i.draftAttemptId, uuid), latestCompletedAttemptId: nullable(i.latestCompletedAttemptId, uuid) }; }, 2), attempts: list(row.attempts, value => { const a = record(value); return { attemptId: uuid(a.attemptId), instrumentKey: key(a.instrumentKey), version: text(a.version, 100), status: a.status === "draft" || a.status === "completed" ? a.status : fail(), revision: integer(a.revision), answeredCount: integer(a.answeredCount, 92), questionCount: integer(a.questionCount, 92), createdAt: timestamp(a.createdAt), updatedAt: timestamp(a.updatedAt), completedAt: nullable(a.completedAt, timestamp) }; }, 100) };
}
