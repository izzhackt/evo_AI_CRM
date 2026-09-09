import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { assessmentAnswersFingerprint, assessmentPath, parseAssessmentWriteInput } from "../src/lib/student-assessment-contract.ts";
import { normalizeAssessmentAttempt, normalizeAssessmentCatalog, readStudentAssessments, readStudentAssessmentAttempt, startStudentAssessment, writeStudentAssessment, StudentAssessmentSourceError } from "../src/lib/v3/student-assessment-source.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const DATE = "2026-09-09T12:00:00+00:00";
const metadata = { title: "Английский", description: "Проверка", instructions: ["Один ответ"], limitations: ["Не сертификат"], secretKey: "must-not-serialize" };
const question = { id: "grammar-01", prompt: "Choose the verb.", options: [{ id: "a", label: "is" }, { id: "b", label: "are" }, { id: "unknown", label: "Не знаю" }], topic: "grammar", correctOptionId: "a", gradingRules: { correctOptionId: "a" } };
const draft = { attemptId: ID, instrumentKey: "english36", versionId: VERSION_ID, version: "1.0.0", locale: "ru", status: "draft", revision: 0, metadata, questions: [question], answers: {}, result: null, createdAt: DATE, updatedAt: DATE, completedAt: null };
const catalog = { instruments: [{ instrumentKey: "english36", versionId: VERSION_ID, version: "1.0.0", locale: "ru", metadata, questionCount: 36, draftAttemptId: ID, latestCompletedAttemptId: null }], attempts: [{ attemptId: ID, instrumentKey: "english36", version: "1.0.0", status: "draft", revision: 0, answeredCount: 0, questionCount: 36, createdAt: DATE, updatedAt: DATE, completedAt: null }] };
const input = { attemptId: ID, expectedRevision: 0, answers: { "grammar-01": "a" }, requestId: REQUEST_ID };
function rpcClient(data, error = null) {
  const calls = [];
  return { calls, client: { schema(schema) { assert.equal(schema, "platform"); return { rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ data, error }); } }; } } };
}

test("write input rejects injected identity/score, unknown fields and unbounded answers", () => {
  assert.deepEqual(parseAssessmentWriteInput(input), input);
  for (const extra of ["organizationId", "studentMembershipId", "score", "result", "level"]) assert.equal(parseAssessmentWriteInput({ ...input, [extra]: "forged" }), null);
  for (const bad of [null, [], {}, { ...input, expectedRevision: -1 }, { ...input, expectedRevision: "0" }, { ...input, answers: { q: 5 } }, { ...input, answers: { constructor: "a" } }, { ...input, requestId: "fake" }, { ...input, answers: Object.fromEntries(Array.from({ length: 93 }, (_, i) => [`q${i}`, "a"])) }]) assert.equal(parseAssessmentWriteInput(bad), null);
});

test("answer equality is independent of Postgres jsonb key order", () => {
  assert.equal(assessmentAnswersFingerprint({ b: "1", a: "2" }), assessmentAnswersFingerprint({ a: "2", b: "1" }));
  assert.notEqual(assessmentAnswersFingerprint({ a: "1" }), assessmentAnswersFingerprint({ a: "2" }));
});

test("draft normalization is an explicit projection with no metadata or question keys", () => {
  const normalized = normalizeAssessmentAttempt(draft);
  assert.equal(normalized.metadata.secretKey, undefined);
  assert.equal(normalized.questions[0].correctOptionId, undefined);
  assert.equal(normalized.questions[0].gradingRules, undefined);
  assert.equal(normalized.result, null);
  assert.equal(normalized.metadata.instructions[0], "Один ответ");
});

test("malformed results, answers, duplicates and unknown instrument fail closed", () => {
  for (const bad of [ { ...draft, instrumentKey: "custom" }, { ...draft, answers: { unknown: "a" } }, { ...draft, answers: { "grammar-01": "forged" } }, { ...draft, questions: [question, question] }, { ...draft, status: "completed" }, { ...draft, revision: Number.MAX_SAFE_INTEGER + 1 }, { ...draft, updatedAt: "bad-date" } ]) assert.throws(() => normalizeAssessmentAttempt(bad), StudentAssessmentSourceError);
  assert.equal(normalizeAssessmentCatalog(catalog).attempts[0].revision, 0);
  assert.throws(() => normalizeAssessmentCatalog({ ...catalog, attempts: [{}] }), StudentAssessmentSourceError);
});

test("read and mutations use only the five Student RPCs and server-derived identity", async () => {
  const c = rpcClient(catalog); await readStudentAssessments(c); assert.deepEqual(c.calls, [{ name: "student_assessments_v1", args: undefined }]);
  const a = rpcClient(draft);
  await readStudentAssessmentAttempt(ID, a);
  await startStudentAssessment("english36", REQUEST_ID, a);
  await writeStudentAssessment(input, false, a);
  await writeStudentAssessment(input, true, a);
  assert.deepEqual(a.calls.map(c => c.name), ["student_assessment_attempt_v1", "start_student_assessment_v1", "save_student_assessment_answers_v1", "complete_student_assessment_v1"]);
  assert.deepEqual(a.calls[2].args, { p_attempt_id: ID, p_expected_revision: 0, p_answers: { "grammar-01": "a" }, p_request_id: REQUEST_ID });
  assert.equal(assessmentPath("english36"), "/portal/tests/english"); assert.equal(assessmentPath("orvis92"), "/portal/tests/career");
});

test("RPC errors expose bounded codes, never database messages", async () => {
  for (const [sql, expected] of [["40001", "conflict"], ["22023", "invalid"], ["42501", "denied"], ["XX000", "unavailable"]]) {
    await assert.rejects(readStudentAssessments(rpcClient(null, { code: sql, message: "private-answer-secret" })), error => error instanceof StudentAssessmentSourceError && error.code === expected && !error.message.includes("private-answer"));
  }
});

test("every mutation authenticates directly; no service role or logging of private answers", () => {
  const source = readFileSync(new URL("../src/lib/student-assessment-actions.ts", import.meta.url), "utf8");
  assert.equal((source.match(/await requireStudentPortalActor\(\)/g) ?? []).length, 4);
  assert.doesNotMatch(source, /service_role|serviceRole|console\.|JSON\.stringify/);
});

test("assessment UI uses bounded authenticated actions, not a browser database or local grader", () => {
  const runner = readFileSync(new URL("../src/components/v3/portal/assessments/AssessmentRunner.tsx", import.meta.url), "utf8");
  assert.match(runner, /saveStudentAssessmentAction/);
  assert.match(runner, /pending\.current \?\?/);
  assert.match(runner, /crypto\.randomUUID/);
  assert.match(runner, /beforeunload/);
  assert.doesNotMatch(runner, /createClient|supabase|localStorage|sessionStorage|gradingRules|correctOptionId|fetch\(/);
});

test("published content passes the same actual Student metadata projection", () => {
  for (const [file, instrumentKey] of [["english-v1.json", "english36"], ["orvis-v1.json", "orvis92"]]) {
    const content = JSON.parse(readFileSync(new URL(`../supabase/assessment-content/${file}`, import.meta.url), "utf8"));
    const normalized = normalizeAssessmentAttempt({ ...draft, instrumentKey, metadata: content.metadata, questions: content.questions });
    assert.equal(normalized.questions.length, instrumentKey === "english36" ? 36 : 92);
    assert.doesNotMatch(JSON.stringify(normalized.questions), /correctOptionId|gradingRules|originalPrompt/);
  }
});
