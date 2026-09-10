import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

// Execute the actual projection, including server-only's real react-server export.
// No Auth/RPC dependencies or substitute question bank participate in this check.
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/server/student-portal-assessment-preview-content.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  conditions: ["react-server"],
});
const { projectAssessmentPreviewContent } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString("base64")}`);

for (const [file, key, count] of [["english-v1.json", "english36", 36], ["orvis-v1.json", "orvis92", 92]]) {
  test(`${key}: actual authored content projects only open questions and instructions`, () => {
    const content = JSON.parse(readFileSync(new URL(`../supabase/assessment-content/${file}`, import.meta.url), "utf8"));
    const projected = JSON.parse(JSON.stringify(projectAssessmentPreviewContent(content)));
    assert.equal(projected.instrumentKey, key);
    assert.equal(projected.version, content.version);
    assert.equal(projected.locale, content.locale);
    assert.equal(projected.title, content.metadata.title);
    assert.equal(projected.description, content.metadata.description);
    assert.deepEqual(projected.instructions, content.metadata.instructions);
    assert.deepEqual(projected.limitations, content.metadata.limitations);
    assert.deepEqual(Object.keys(projected).sort(), ["description", "instrumentKey", "instructions", "limitations", "locale", "questions", "title", "version"].sort());
    assert.equal(projected.questions.length, count);
    for (const [index, question] of projected.questions.entries()) {
      const authored = content.questions[index];
      assert.deepEqual(Object.keys(question).sort(), authored.passage ? ["id", "options", "passage", "prompt"] : ["id", "options", "prompt"]);
      assert.equal(question.id, authored.id);
      assert.equal(question.prompt, authored.prompt);
      assert.equal(question.passage, authored.passage);
      assert.equal(question.options.length, authored.options.length);
      question.options.forEach((option, optionIndex) => {
        assert.deepEqual(Object.keys(option).sort(), ["id", "label"]);
        assert.equal(option.id, authored.options[optionIndex].id);
        assert.equal(option.label, authored.options[optionIndex].label);
      });
    }
    assert.doesNotMatch(JSON.stringify(projected), /"(?:gradingRules|correctOptionId|explanation|blueprint|bands|scales|professions|answers|attemptId|result)"\s*:/);
  });
}

test("preview content is guarded before canonical imports and has no database path", () => {
  const source = readFileSync(new URL("../src/lib/server/student-portal-assessment-preview.ts", import.meta.url), "utf8");
  assert.match(source, /^import "server-only";/);
  const authority = source.indexOf("await requireStudentPortalPreviewAuthority()");
  assert.ok(authority > 0);
  for (const bank of ["english-v1.json", "orvis-v1.json"]) {
    assert.ok(source.indexOf(bank) > authority);
  }
  assert.doesNotMatch(source, /\.rpc\(|createClient|service_role|student_assessment_attempt|readStudentAssessmentAttempt/);
});

test("preview reuses the Student question controls and never imports persistence", () => {
  const preview = readFileSync(new URL("../src/components/v3/portal/assessments/AssessmentPreviewRunner.tsx", import.meta.url), "utf8");
  const student = readFileSync(new URL("../src/components/v3/portal/assessments/AssessmentRunner.tsx", import.meta.url), "utf8");
  for (const source of [preview, student]) {
    assert.match(source, /import \{ AssessmentQuestion \} from "\.\/AssessmentQuestion"/);
    assert.match(source, /<AssessmentQuestion /);
  }
  assert.match(preview, /useState<Record<string, string>>\(\{\}\)/);
  assert.match(preview, /Ответы не сохраняются/);
  assert.doesNotMatch(preview, /student-assessment-actions|AssessmentResults|localStorage|sessionStorage|indexedDB|fetch\(|\.rpc\(|createClient|gradingRules|correctOptionId|<form/);
  // Existing Student persistence is still owned by its real runner.
  assert.match(student, /completeStudentAssessmentAction/);
  assert.match(student, /saveStudentAssessmentAction/);
  assert.match(student, /startStudentAssessmentAction/);
  assert.match(student, /disabled=\{completing \|\| error\?\.code === "conflict"\}/);
});
