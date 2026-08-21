import assert from "node:assert/strict";
import test from "node:test";

import { PLATFORM_AUDIT_ACTIONS } from "../src/lib/platform-audit.ts";
import {
  AUDIT_QUESTIONS,
  AUDIT_QUESTION_ACTION_LIMIT,
  auditQuestionHref,
  defaultAuditWindowStart,
  unknownAuditActions,
} from "../src/lib/platform-audit-questions.ts";

test("every question names only actions the audit actually defines", () => {
  // A question naming an undefined action returns nothing, which a reader
  // would take as "this never happened" rather than "this filter is wrong".
  for (const question of AUDIT_QUESTIONS) {
    assert.deepEqual(
      unknownAuditActions(question),
      [],
      `${question.key} names actions the audit does not define`,
    );
  }
});

test("an invented action is caught rather than silently returning nothing", () => {
  const unknown = unknownAuditActions({
    key: "broken",
    question: "?",
    why: "?",
    actions: ["membership.role.change", "membership.role.invented"],
  });
  assert.deepEqual(unknown, ["membership.role.invented"]);
});

test("question keys are unique and non-empty", () => {
  const keys = AUDIT_QUESTIONS.map((question) => question.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.match(key, /^[a-z][a-z0-9-]*$/u);
});

test("no question exceeds the filter value limit", () => {
  // The search RPC rejects a filter carrying more than 32 values.
  for (const question of AUDIT_QUESTIONS) {
    assert.ok(
      question.actions.length >= 1 &&
        question.actions.length <= AUDIT_QUESTION_ACTION_LIMIT,
      question.key,
    );
    assert.equal(new Set(question.actions).size, question.actions.length, question.key);
  }
});

test("the governance areas that matter are all covered", () => {
  const covered = new Set(AUDIT_QUESTIONS.flatMap((question) => question.actions));
  for (const action of [
    "membership.role.change",
    "case.curator.set",
    "finance.payment.record",
    "finance.stop.create",
    "document.download.grant",
    "audit.export",
    "knowledge.version.publish",
  ]) {
    assert.ok(covered.has(action), `not covered by any question: ${action}`);
  }
});

test("reading the audit is itself a question", () => {
  // Whoever exports the audit takes sensitive material with them, so that act
  // must be as visible as the acts it records.
  const question = AUDIT_QUESTIONS.find((item) => item.key === "audit-access");
  assert.ok(question);
  assert.ok(question.actions.includes("audit.export"));
});

test("a question resolves to the exact audit tab and filter", () => {
  const question = AUDIT_QUESTIONS.find((item) => item.key === "money");
  const href = auditQuestionHref(question, { startAt: "2026-07-01", pageSize: 50 });
  const url = new URL(href, "http://example.invalid");
  assert.equal(url.pathname, "/settings");
  assert.equal(url.searchParams.get("tab"), "audit");
  assert.equal(url.searchParams.get("start_at"), "2026-07-01");
  assert.equal(url.searchParams.get("page_size"), "50");
  assert.deepEqual(
    url.searchParams.get("actions").split(","),
    question.actions.slice(),
  );
});

test("an omitted period is left out rather than guessed", () => {
  const href = auditQuestionHref(AUDIT_QUESTIONS[0]);
  const url = new URL(href, "http://example.invalid");
  assert.equal(url.searchParams.get("start_at"), null);
  assert.equal(url.searchParams.get("end_at"), null);
});

test("the default window is a plain date the search accepts", () => {
  const start = defaultAuditWindowStart(new Date("2026-08-21T10:00:00Z"), 30);
  assert.equal(start, "2026-07-22");
  assert.match(start, /^\d{4}-\d{2}-\d{2}$/u);
});

test("the question set stays a subset of the audit vocabulary as it grows", () => {
  const known = new Set(PLATFORM_AUDIT_ACTIONS);
  const used = new Set(AUDIT_QUESTIONS.flatMap((question) => question.actions));
  for (const action of used) assert.ok(known.has(action), action);
  // Sanity: the audit is much larger than what the questions surface, so this
  // page is a way in rather than a claim of full coverage.
  assert.ok(known.size > used.size);
});
