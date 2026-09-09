import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  generateSeed, loadPlaybooks, messagePlaceholderKeys, SEED_PATH, STAGE_KEYS, validatePlaybook,
} from "./generate-admissions-playbook-seed.mjs";

const inputs = loadPlaybooks();
const [china, malaysia] = inputs.map(({ playbook }) => playbook);

test("CN and MY cover the seven canonical stages with distinct evidence and curator continuation tasks", () => {
  assert.deepEqual(inputs.map(({ playbook }) => playbook.direction), ["CN", "MY"]);
  for (const playbook of [china, malaysia]) {
    assert.deepEqual(playbook.content.stages.map((stage) => stage.key), STAGE_KEYS);
    assert.deepEqual([...new Set(playbook.content.tasks.map((task) => task.stageKey))], STAGE_KEYS.slice(2));
    assert.ok(playbook.content.tasks.every((task) => task.studentVisible === false));
    const body = JSON.stringify(playbook.content);
    assert.match(body, /u6/);
    assert.match(body, /основн/);
    assert.match(body, /альтернатив/);
    assert.match(body, /прибыт/);
    assert.match(body, /не.*автомат|автомат.*не/);
  }
  assert.equal(china.content.tasks.length, 12);
  assert.equal(malaysia.content.tasks.length, 13);
});

test("message bank covers manual stage communication with exact named placeholders and declared provenance", () => {
  assert.equal(china.content.messages.length, 14);
  assert.equal(malaysia.content.messages.length, 17);
  for (const playbook of [china, malaysia]) {
    for (const message of playbook.content.messages) {
      const keys = messagePlaceholderKeys(message.body);
      assert.deepEqual(keys, message.placeholders.map((item) => item.key).sort());
      const filled = message.body.replace(/\{\{([a-z][a-z0-9_]{0,63})\}\}/g,
        (_match, key) => `QA value for ${key}`);
      assert.ok(filled.length > 0);
      assert.doesNotMatch(filled, /[{}]/);
      assert.ok(!Object.hasOwn(message, "send") && !Object.hasOwn(message, "webhook"));
    }
  }
  assert.ok(malaysia.content.messages.some((message) => message.audience === "university" && message.locale === "en"));
  assert.ok(malaysia.content.messages.some((message) => message.audience === "referral" && message.locale === "ru"));
});

test("Malaysia contains independent entry and post-arrival concepts without imported amounts or private examples", () => {
  const content = JSON.stringify(malaysia.content);
  for (const term of ["EMGS", "eVAL", "SEV/eVISA", "MDAC", "Student Pass", "medical", "pending", "Letter of Offer", "Letter of Eligibility", "Interstudy", "кампус", "депозит", "invoice"]) {
    assert.ok(content.includes(term), `Missing MY operational concept: ${term}`);
  }
  assert.doesNotMatch(content, /\d+\s*%|\b(?:RM|USD|CNY)\s*\d|\d[\d,. ]*\s*(?:RM|USD|CNY)\b/iu);
  assert.doesNotMatch(content, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+\d[\d() -]{7,}/iu);
  assert.ok(malaysia.content.limitations.some((item) => /срок.*более позд|более позд.*дат/.test(item)));
  assert.ok(malaysia.content.limitations.some((item) => /Google Sheets/.test(item) && /sync не добавляется/.test(item)));
});

test("China preserves preliminary/final decisions and conditional visa documents without universal timings", () => {
  const content = JSON.stringify(china.content);
  for (const term of ["pre-admission", "окончательн", "JW201", "JW202", "DQ", "подтверждение", "Finance"]) {
    assert.ok(content.includes(term), `Missing CN operational concept: ${term}`);
  }
  assert.doesNotMatch(content, /2[–-]6 недель|2[–-]4 недель|180 дней|24 часов|30 дней|5[,. ]?000 USD/iu);
  assert.ok(china.content.messages.find((message) => message.id === "cn-submission-confirmed").whenToUse.includes("доказательства"));
  assert.ok(china.content.messages.find((message) => message.id === "cn-pre-admission").body.includes("не окончательное"));
});

test("validators reject malformed identities, stages, placeholders, provenance and privileged payload additions", () => {
  const mutations = [
    (value) => { value.content.stages[1].key = "intake"; },
    (value) => { value.content.tasks[0].key = value.content.tasks[1].key; },
    (value) => { value.content.tasks[0].studentVisible = true; },
    (value) => { value.content.tasks[0].dueDays = 5; },
    (value) => { value.content.tasks[0].stageKey = "intake"; },
    (value) => { value.content.messages[0].body += " {{undeclared}}"; },
    (value) => { value.content.messages[0].body += " {{invalid-key}}"; },
    (value) => { value.content.messages[0].placeholders[0].key = "unused"; },
    (value) => { value.content.messages[0].sourceIds = ["missing-source"]; },
    (value) => { value.content.messages[0].body += "<script>alert(1)</script>"; },
    (value) => { value.content.sources[0].sha256 = "0".repeat(64); },
    (value) => { value.content.sources[2].url = "https://not-reviewed.example/"; },
    (value) => { value.content.sources[2].reviewedOn = "2026-02-30"; },
    (value) => { value.content.assessmentResults = []; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(china);
    mutate(value);
    assert.throws(() => validatePlaybook(value));
  }
});

test("migration 138 is byte-exact deterministic immutable private seed, with SQL quotes and complete EOF", () => {
  const sql = generateSeed();
  assert.equal(readFileSync(SEED_PATH, "utf8"), sql);
  assert.equal(generateSeed(), sql);
  assert.equal((sql.match(/INSERT INTO platform_private\.admissions_playbook_versions/g) ?? []).length, 2);
  assert.equal((sql.match(/-- SHA256: [a-f0-9]{64}/g) ?? []).length, 2);
  assert.doesNotMatch(sql, /ON CONFLICT|UPDATE platform|INSERT INTO auth\.|INSERT INTO platform\./);
  assert.match(sql, /Taylor''s/);
  assert.ok(sql.startsWith("-- Generated by scripts/generate-admissions-playbook-seed.mjs."));
  assert.ok(sql.endsWith("COMMIT;\n"));
  assert.ok(!sql.endsWith("\n\n"), "No blank line at EOF");
});
