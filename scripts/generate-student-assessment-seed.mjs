import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CONTENT_FILES = ["english-v1.json", "orvis-v1.json"];
export const SEED_PATH = resolve(root, "supabase/migrations/136_platform_student_assessment_content.sql");
export const ORVIS_SCALE_IDS = [
  "leadership", "organization", "altruism", "creativity",
  "analysis", "production", "adventure", "erudition",
];

function assertNonEmptyString(value, field) {
  assert.equal(typeof value, "string", `${field} must be a string`);
  assert.ok(value.trim(), `${field} must not be blank`);
}

function assertNoGradingFields(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!["gradingRules", "grading_rules", "correctOptionId", "explanation"].includes(key),
      `Public content must not contain private field ${key}`);
    assertNoGradingFields(child);
  }
}

function validateQuestion(question, rule, instrumentKey) {
  assert.ok(question && typeof question === "object" && !Array.isArray(question));
  assert.ok(Object.keys(question).every((key) => ["id", "prompt", "options", "topic", "passage"].includes(key)));
  assert.match(question.id, /^[a-z0-9][a-z0-9_-]{0,79}$/);
  assertNonEmptyString(question.prompt, `${question.id}.prompt`);
  assert.equal(question.options.length, 5, `${question.id} must have five options`);
  assert.equal(new Set(question.options.map((option) => option.id)).size, 5);
  assert.equal(new Set(question.options.map((option) => option.label)).size, 5);
  for (const option of question.options) {
    assert.deepEqual(Object.keys(option).sort(), ["id", "label"]);
    assertNonEmptyString(option.id, `${question.id}.option.id`);
    assertNonEmptyString(option.label, `${question.id}.option.label`);
  }
  if (instrumentKey === "english36") {
    assert.deepEqual(question.options.map((option) => option.id), ["a", "b", "c", "d", "unknown"]);
    assert.ok(["a", "b", "c", "d"].includes(rule.correctOptionId));
    assert.ok(["grammar", "vocabulary", "reading"].includes(rule.topic));
    assert.equal(question.topic, rule.topic);
    assertNonEmptyString(rule.explanation, `${question.id}.explanation`);
    if (rule.topic === "reading") assertNonEmptyString(question.passage, `${question.id}.passage`);
  } else {
    assert.deepEqual(question.options.map((option) => option.id), ["1", "2", "3", "4", "5"]);
    assert.ok(ORVIS_SCALE_IDS.includes(rule.scale));
    assert.deepEqual(Object.keys(rule), ["scale"]);
  }
}

export function validateContent(content) {
  assert.ok(["english36", "orvis92"].includes(content.instrumentKey));
  assert.equal(content.version, "1.0.0");
  assert.equal(content.locale, "ru");
  assert.equal(content.questions.length, content.instrumentKey === "english36" ? 36 : 92);
  assert.equal(new Set(content.questions.map((question) => question.id)).size, content.questions.length);
  assert.equal(new Set(content.questions.map((question) => question.prompt)).size, content.questions.length);
  assert.deepEqual(Object.keys(content.gradingRules).sort(), content.questions.map((question) => question.id).sort());
  assertNonEmptyString(content.metadata.title, "metadata.title");
  for (const field of ["instructions", "limitations"]) {
    assert.ok(Array.isArray(content.metadata[field]) && content.metadata[field].length > 0);
    for (const item of content.metadata[field]) assertNonEmptyString(item, `metadata.${field}`);
  }
  assertNoGradingFields(content.metadata);
  assertNoGradingFields(content.questions);
  for (const question of content.questions) validateQuestion(question, content.gradingRules[question.id], content.instrumentKey);
  return content;
}

export function loadAssessmentContent() {
  return CONTENT_FILES.map((name) => {
    const raw = readFileSync(resolve(root, "supabase/assessment-content", name), "utf8");
    return { name, raw, content: validateContent(JSON.parse(raw)) };
  });
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function generateSeed() {
  const sources = loadAssessmentContent();
  const header = sources.map(({ name, raw }) =>
    `-- ${name} sha256: ${createHash("sha256").update(raw).digest("hex")}`);
  const inserts = sources.map(({ content }) => {
    const values = [content.instrumentKey, content.version, content.locale].map(sqlString);
    const jsonValues = [content.metadata, content.questions, content.gradingRules]
      .map((value) => `${sqlString(JSON.stringify(value))}::JSONB`);
    return "INSERT INTO platform_private.student_assessment_versions\n"
      + "  (instrument_key, version, locale, metadata, questions, grading_rules)\n"
      + `VALUES (\n  ${[...values, ...jsonValues].join(",\n  ")}\n);`;
  });
  return [
    "-- P5/P6: immutable original EVO English36 and Russian exploratory ORVIS92 v1.",
    "-- Generated by scripts/generate-student-assessment-seed.mjs; do not edit SQL content by hand.",
    "-- Changes after application require a new version and a new forward migration.",
    "-- Answer keys live only in platform_private, never in frontend imports or public metadata.",
    ...header, "BEGIN;", ...inserts, "COMMIT;", "",
  ].join("\n\n");
}

function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length <= 1 && (!args.length || ["--check", "--write"].includes(args[0])),
    "Usage: node scripts/generate-student-assessment-seed.mjs [--check|--write]");
  const sql = generateSeed();
  if (args[0] === "--check") {
    assert.equal(readFileSync(SEED_PATH, "utf8"), sql, "Migration 136 differs from the versioned JSON sources");
    process.stdout.write("Assessment seed: exact match\n");
  } else if (args[0] === "--write") {
    writeFileSync(SEED_PATH, sql, "utf8");
    process.stdout.write("Generated migration 136 from checked content\n");
  } else {
    process.stdout.write(sql);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
