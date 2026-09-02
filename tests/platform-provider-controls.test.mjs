import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

function source(path) {
  const url = new URL(path, ROOT);
  assert.equal(existsSync(url), true, `${path} must exist`);
  return readFileSync(url, "utf8");
}

function between(value, start, end) {
  const startIndex = value.indexOf(start);
  assert.notEqual(startIndex, -1, `missing source boundary: ${start}`);
  const endIndex = value.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing source boundary: ${end}`);
  return value.slice(startIndex, endIndex);
}

function fieldNames(formSource) {
  return [...formSource.matchAll(/\bname="([^"]+)"/g)].map((match) => match[1]);
}

const controls = source(
  "src/components/platform/communications/PlatformProviderWorkflowControls.tsx",
);
const page = source("src/app/(staff)/whatsapp/[id]/page.tsx");

test("controls make Gemini advisory-only and expose an exact draft request", () => {
  assert.match(
    controls,
    /ИИ только готовит черновик\. Решение принимает сотрудник,[\s\S]*после отдельного подтверждения\./,
  );
  assert.match(controls, /\{copy\.advisory\}/);
  assert.match(controls, /data-testid="platform-provider-workflow-controls"/);

  const requestForm = between(
    controls,
    "<form action={geminiAction}",
    "</form>",
  );
  assert.deepEqual(fieldNames(requestForm), [
    "conversation_id",
    "source_message_id",
    "request_id",
  ]);
  assert.match(requestForm, /value=\{latestInboundSourceMessageId\}/);
  assert.match(requestForm, /value=\{requestIds\.gemini\}/);
  assert.doesNotMatch(
    controls,
    /(?:action|onClick)=\{[^}]*(?:autonomous|broadcast)/i,
  );
});

test("review controls expose exact Accept, reply-only Edit, and reasoned Reject intent", () => {
  const hiddenFields = between(
    controls,
    "function reviewHiddenFields(",
    "function formatTimestamp(",
  );
  assert.deepEqual(fieldNames(hiddenFields), [
    "conversation_id",
    "proposal_request_id",
    "review_request_id",
    "decision",
  ]);

  const reviewSection = between(
    controls,
    "<form action={reviewAction}>",
    "{reviewState.status !== \"idle\"",
  );
  const reviewForms = [
    ...reviewSection.matchAll(/<form action=\{reviewAction\}[\s\S]*?<\/form>/g),
  ].map((match) => match[0]);
  assert.equal(reviewForms.length, 3);
  assert.deepEqual(
    [...reviewSection.matchAll(/requestIds\.review,\s*"(accepted|edited|rejected)"/g)]
      .map((match) => match[1]),
    ["accepted", "edited", "rejected"],
  );

  const [acceptForm, editForm, rejectForm] = reviewForms;
  assert.deepEqual(fieldNames(acceptForm), ["edited_reply_text", "reason"]);
  assert.match(acceptForm, /name="edited_reply_text" value=""/);
  assert.match(acceptForm, /name="reason" value=""/);

  assert.deepEqual(fieldNames(editForm), ["edited_reply_text", "reason"]);
  assert.match(editForm, /name="edited_reply_text"\s+required/);
  assert.match(editForm, /defaultValue=\{proposal\.proposal\.reply_text\}/);
  assert.match(editForm, /name="reason"\s+maxLength=\{1_000\}/);

  assert.deepEqual(fieldNames(rejectForm), ["edited_reply_text", "reason"]);
  assert.match(rejectForm, /name="edited_reply_text" value=""/);
  assert.match(rejectForm, /name="reason"\s+required/);

  for (const label of [
    "Принять без изменений",
    "Сохранить исправленный текст",
    "Отклонить черновик",
  ]) {
    assert.equal(controls.includes(label), true, `${label} must remain explicit`);
  }
  assert.doesNotMatch(
    controls,
    /name="(?:citations|summary|confidence|risk|model_ref|schema_version|provider_evidence)"/,
  );
});

test("manual send requires one exact confirmation and carries no provider target", () => {
  const sendForm = between(controls, "<form action={sendAction}", "</form>");
  assert.deepEqual(fieldNames(sendForm), [
    "conversation_id",
    "source_message_id",
    "send_request_id",
    "message_text",
    "confirm_send",
  ]);
  assert.match(sendForm, /name="message_text"\s+required\s+maxLength=\{3_000\}/);

  const confirmation = between(sendForm, 'type="checkbox"', "/>\n");
  assert.match(confirmation, /name="confirm_send"/);
  assert.match(confirmation, /value="1"/);
  assert.match(confirmation, /\brequired\b/);
  assert.match(confirmation, /checked=\{confirmed\}/);

  const sendDisabled = between(
    sendForm,
    "disabled={",
    'data-testid="platform-provider-send"',
  );
  assert.match(sendDisabled, /!confirmed/);
  assert.match(sendDisabled, /messageText\.trim\(\)\.length === 0/);
  assert.doesNotMatch(
    sendForm,
    /name="(?:recipient|phone|raw_chat|session|api_key|provider_message_id|provider_evidence)"/i,
  );
});

test("unknown WhatsApp outcomes block resend and offer send-free reconciliation", () => {
  const stateLogic = between(
    controls,
    "const unresolvedAttempt =",
    "return (",
  );
  assert.match(stateLogic, /latestAttempt\?\.status === "prepared"/);
  assert.match(stateLogic, /latestAttempt\?\.status === "unknown"/);
  assert.match(stateLogic, /sendState\.status === "unknown_result"/);

  const sendForm = between(controls, "<form action={sendAction}", "</form>");
  const sendDisabled = between(
    sendForm,
    "disabled={",
    'data-testid="platform-provider-send"',
  );
  assert.match(sendDisabled, /sendActionSettled/);
  assert.match(sendDisabled, /unresolvedAttempt/);
  assert.match(
    controls,
    /Результат неизвестен\. Повторная отправка заблокирована до сверки с WAHA\./,
  );

  assert.match(
    controls,
    /latestAttempt\.reconciliationRequired \? \([\s\S]*?<form action=\{reconcileAction\}>/,
  );
  const reconcileForm = between(
    controls,
    "<form action={reconcileAction}>",
    "</form>",
  );
  assert.deepEqual(fieldNames(reconcileForm), [
    "conversation_id",
    "attempt_id",
    "reconcile_request_id",
  ]);
  assert.match(reconcileForm, /data-testid="platform-provider-reconcile"/);
  assert.doesNotMatch(reconcileForm, /sendAction|message_text|confirm_send/);
});

test("conversation page reads provider state through the authenticated canonical thread", () => {
  assert.match(page, /createSupabaseServerClient\(\)/);
  assert.match(page, /readStaffGeminiProposal\(/);
  assert.match(page, /listStaffGeminiProposalReviews\(/);
  assert.match(page, /readLatestManualWhatsAppSendAttempt\(/);
  assert.match(page, /organizationId:\s*actor\.organizationId/g);
  assert.match(page, /messageCursor === null[\s\S]*?direction === "inbound"/);
  assert.match(page, /workflowControls=\{[\s\S]*?<PlatformProviderWorkflowControls/);
  assert.doesNotMatch(
    page,
    /service[_-]?role|EVO_PLATFORM_SUPABASE_SECRET_KEY|recipient|rawChat/i,
  );
});
