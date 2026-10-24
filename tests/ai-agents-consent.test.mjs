import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_CONSENT_MISSING_CHAT_LINE,
  AI_CONSENT_MISSING_CODE,
  AI_CONSENT_MISSING_MESSAGE,
  AI_CONSENT_POLICY_VERSION,
  AI_CONSENT_SOURCES,
  AI_CONSENT_STATUSES,
  aiConsentChip,
  parseStaffAiConsent,
} from "../src/lib/ai-agents/consent.ts";
import { AI_AGENT_TOOL_ERROR_CODES } from "../src/lib/ai-agents/contract.ts";
import { AI_AGENT_TOOL_ERROR_WORDS, toolErrorWords } from "../src/lib/v3/ai-agents-view.ts";

// Согласие студента на ИИ-помощников (миграция 320): общий словарь CRM. Базу проверяет Postgres-набор
// supabase/tests/platform_student_ai_consent.sql; здесь - чистые правила кода.

test("the shared constants are the owner's contract of 25.10.2026", () => {
  assert.equal(AI_CONSENT_POLICY_VERSION, "2026-10-25");
  assert.deepEqual([...AI_CONSENT_STATUSES], ["granted", "declined"]);
  assert.deepEqual([...AI_CONSENT_SOURCES], ["portal_web", "ios"]);
  assert.equal(AI_CONSENT_MISSING_CODE, "ai_consent_missing");
  assert.equal(AI_CONSENT_MISSING_MESSAGE, "Студент не дал согласия на ИИ-помощников: его документы и переписку агент не читает.");
  assert.equal(AI_CONSENT_MISSING_CHAT_LINE, "Студент не дал согласия на ИИ-помощников — помощник не читает эту переписку.");
  assert.ok(AI_AGENT_TOOL_ERROR_CODES.includes(AI_CONSENT_MISSING_CODE));
  // The activity log words the refusal; no tool error code is left without a word.
  assert.equal(toolErrorWords("ai_consent_missing"), "нет согласия студента");
  for (const code of AI_AGENT_TOOL_ERROR_CODES) assert.ok(AI_AGENT_TOOL_ERROR_WORDS[code], `${code} has a word`);
});

test("parseStaffAiConsent accepts exactly the shape of staff_student_ai_consent_v1 and nothing else", () => {
  const granted = { status: "granted", decidedAt: "2026-10-25T05:00:00.123456+00:00", aiAllowed: true };
  assert.deepEqual(parseStaffAiConsent(granted), granted);
  assert.deepEqual(parseStaffAiConsent({ status: "declined", decidedAt: "2026-10-25T05:00:00Z", aiAllowed: false }),
    { status: "declined", decidedAt: "2026-10-25T05:00:00Z", aiAllowed: false });
  assert.deepEqual(parseStaffAiConsent({ status: null, decidedAt: null, aiAllowed: true }), { status: null, decidedAt: null, aiAllowed: true });
  assert.deepEqual(parseStaffAiConsent({ status: null, decidedAt: null, aiAllowed: false }), { status: null, decidedAt: null, aiAllowed: false });
  const bad = [
    null, undefined, "granted", 3, [], {},
    { status: "granted", decidedAt: "2026-10-25T05:00:00Z" },
    { status: "granted", decidedAt: "2026-10-25T05:00:00Z", aiAllowed: true, extra: 1 },
    { status: "maybe", decidedAt: "2026-10-25T05:00:00Z", aiAllowed: true },
    { status: "granted", decidedAt: "yesterday", aiAllowed: true },
    { status: "granted", decidedAt: null, aiAllowed: true },
    { status: null, decidedAt: "2026-10-25T05:00:00Z", aiAllowed: true },
    { status: "granted", decidedAt: "2026-10-25T05:00:00Z", aiAllowed: "yes" },
  ];
  for (const value of bad) assert.equal(parseStaffAiConsent(value), null, JSON.stringify(value));
  assert.ok(Object.isFrozen(parseStaffAiConsent(granted)));
});

test("the chip says one of three words; only «не разрешено» is a warning", () => {
  const granted = aiConsentChip({ status: "granted", decidedAt: "2026-10-25T05:00:00Z", aiAllowed: true });
  const declined = aiConsentChip({ status: "declined", decidedAt: "2026-10-25T05:00:00Z", aiAllowed: false });
  const none = aiConsentChip({ status: null, decidedAt: null, aiAllowed: false });
  const noPortal = aiConsentChip({ status: null, decidedAt: null, aiAllowed: true });
  assert.deepEqual([granted.label, declined.label, none.label, noPortal.label],
    ["ИИ: разрешено", "ИИ: не разрешено", "ИИ: не спрашивали", "ИИ: не спрашивали"]);
  assert.deepEqual([granted.tone, declined.tone, none.tone, noPortal.tone], ["neutral", "warn", "neutral", "neutral"]);
  // The hint tells what the helpers do: they do not read when the student has not allowed; a student without a cabinet is another case.
  assert.match(declined.title, /не читают/u);
  assert.match(none.title, /не читают/u);
  assert.match(noPortal.title, /нет кабинета/u);
  // «Разрешено» is a permission, not a claim that the helpers read: «могут читать».
  assert.match(granted.title, /могут читать/u);
  // Not asked and granted on an older text version look the same to the staff read: the hint names both.
  assert.match(none.title, /прежней версии/u);
  // The words are true for every AI path migration 320 closes (Claude agents, the Gemini sales-chat helper, memory,
  // the night autoresponder, document recognition): «помощники», never the narrower «агенты Claude».
  for (const chip of [granted, declined, none, noPortal]) {
    assert.match(chip.title, /помощники/u);
    assert.doesNotMatch(chip.title, /агенты Claude|Gemini|Claude/u);
  }
  for (const chip of [granted, declined, none, noPortal]) {
    assert.equal(/\d|@|auth:/u.test(chip.label + chip.title), false, "no number, address or Auth id in the words");
  }
});
