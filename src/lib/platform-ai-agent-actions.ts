"use server";
import { revalidatePath } from "next/cache";

import { staffCanAccessRoute } from "./platform-access";
import { requirePlatformStaffActor } from "./platform-guards";
import { parseSalesUuid } from "./platform-sales-register-contract";
import { exactActionStringFields } from "./server/action-form-fields";
import { AI_CONSENT_TEXT_VERSION, AI_RULES_BYTE_LIMIT, utf8Bytes } from "./v3/ai-agent";
import { isAiReviewCorrection } from "./v3/ai-agent-knowledge";
import {
  confirmAiDocumentCompany,
  confirmAiRules,
  deleteAiDocument,
  deleteAiExample,
  discardAiLab,
  recordAiConsent,
  rejectAiLabProposal,
  resolveAiReviewItem,
  retryAiDocument,
  saveAiMonthlyCap,
  saveAiRules,
  type AiWriteStatus,
} from "./v3/ai-agent-source";

/**
 * Записи раздела «ИИ-агент» (план §8, §10, §12.2, §13): «Правила общения»
 * (новая версия, «Проверено»), повтор обработки документа, месячный лимит и
 * согласие на Gemini (только admin — решает база). Каждая запись — один RPC
 * с id запроса: повтор с тем же id возвращает прежнюю квитанцию, другой ввод —
 * конфликт. Неизвестный результат (`unavailable`) безопасно повторить тем же
 * id: форма хранит его до записи.
 */
export type AiActionState = Readonly<{ status: "idle" | AiWriteStatus; requestId: string | null }>;

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const VERSION = /^(?:0|[1-9]\d{0,14})$/u;

async function actorFor() {
  const actor = await requirePlatformStaffActor();
  return staffCanAccessRoute(actor, "/v3/ai-agent") ? actor : null;
}

function done(status: AiWriteStatus, requestId: string): AiActionState {
  if (status === "saved") revalidatePath("/v3/ai-agent");
  return { status, requestId };
}

/** «Сохранить новую версию»: текст ≤ 32 КБ, ожидаемая текущая версия — против гонки правок. */
export async function saveAiRulesAction(previous: AiActionState, form: FormData): Promise<AiActionState> {
  const fields = exactActionStringFields(form, ["request_id", "expected_version", "body"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  if (!fields || !requestId) return { status: "invalid", requestId: previous.requestId };
  const expected = fields.get("expected_version")!;
  const body = fields.get("body")!.replace(/\r\n?/gu, "\n");
  if ((expected !== "" && !VERSION.test(expected)) || !body.trim() || utf8Bytes(body) > AI_RULES_BYTE_LIMIT
    || CONTROL.test(body.replace(/\t/gu, ""))) return { status: "invalid", requestId };
  const actor = await actorFor();
  if (!actor) return { status: "forbidden", requestId };
  return done(await saveAiRules(actor, { body, expectedVersion: expected === "" ? null : Number(expected), requestId }), requestId);
}

/** «Проверено» у версии «Правил общения». */
export async function confirmAiRulesAction(previous: AiActionState, form: FormData): Promise<AiActionState> {
  const fields = exactActionStringFields(form, ["request_id", "rules_version_id"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const rulesVersionId = fields && parseSalesUuid(fields.get("rules_version_id"));
  if (!fields || !requestId || !rulesVersionId) return { status: "invalid", requestId: requestId ?? previous.requestId };
  const actor = await actorFor();
  if (!actor) return { status: "forbidden", requestId };
  return done(await confirmAiRules(actor, { rulesVersionId, requestId }), requestId);
}

/** «Повторить» у документа с ошибкой обработки. */
export async function retryAiDocumentAction(previous: AiActionState, form: FormData): Promise<AiActionState> {
  const fields = exactActionStringFields(form, ["request_id", "document_id", "expected_version"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const documentId = fields && parseSalesUuid(fields.get("document_id"));
  const expected = fields?.get("expected_version") ?? "";
  if (!fields || !requestId || !documentId || !VERSION.test(expected) || expected === "0") {
    return { status: "invalid", requestId: requestId ?? previous.requestId };
  }
  const actor = await actorFor();
  if (!actor) return { status: "forbidden", requestId };
  return done(await retryAiDocument(actor, { documentId, expectedVersion: Number(expected), requestId }), requestId);
}

/** Месячный лимит расходов на ИИ в долларах (0–100 000), с ожидаемой версией настроек. */
export async function saveAiMonthlyCapAction(previous: AiActionState, form: FormData): Promise<AiActionState> {
  const fields = exactActionStringFields(form, ["request_id", "expected_version", "monthly_cap_usd"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  if (!fields || !requestId) return { status: "invalid", requestId: previous.requestId };
  const expected = fields.get("expected_version")!;
  const raw = fields.get("monthly_cap_usd")!.trim().replace(",", ".");
  const cap = /^\d{1,6}(?:\.\d{1,2})?$/u.test(raw) ? Number(raw) : NaN;
  if (!VERSION.test(expected) || !Number.isFinite(cap) || cap < 0 || cap > 100_000) return { status: "invalid", requestId };
  const actor = await actorFor();
  if (!actor) return { status: "forbidden", requestId };
  return done(await saveAiMonthlyCap(actor, { expectedVersion: Number(expected), monthlyCapUsd: cap, requestId }), requestId);
}

/**
 * Согласие владельца на передачу текстов клиентов в Gemini (Q4) — записывает
 * и отзывает только admin (§13); база отказывает остальным (42501).
 */
export async function recordAiConsentAction(previous: AiActionState, form: FormData): Promise<AiActionState> {
  const fields = exactActionStringFields(form, ["request_id", "consent_action"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const action = fields?.get("consent_action");
  if (!fields || !requestId || (action !== "grant" && action !== "revoke")) {
    return { status: "invalid", requestId: requestId ?? previous.requestId };
  }
  const actor = await actorFor();
  if (!actor) return { status: "forbidden", requestId };
  return done(await recordAiConsent(actor, {
    action, textVersion: action === "grant" ? AI_CONSENT_TEXT_VERSION : null, requestId,
  }), requestId);
}

// ------------------------------------------------------------------ P2

/** Общая форма команды над документом: id запроса, документ, ожидаемая версия строки. */
type DocumentCommand =
  | Readonly<{ invalid: AiActionState }>
  | Readonly<{ requestId: string; documentId: string; expectedVersion: number }>;

function documentCommand(previous: AiActionState, form: FormData): DocumentCommand {
  const fields = exactActionStringFields(form, ["request_id", "document_id", "expected_version"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const documentId = fields && parseSalesUuid(fields.get("document_id"));
  const expected = fields?.get("expected_version") ?? "";
  if (!fields || !requestId || !documentId || !VERSION.test(expected) || expected === "0") {
    return { invalid: { status: "invalid", requestId: requestId ?? previous.requestId } };
  }
  return { requestId, documentId, expectedVersion: Number(expected) };
}

/** «Удалить» документ: строка, фрагменты и пункты сверки — в базе, объекты — из Storage. */
export async function deleteAiDocumentAction(previous: AiActionState, form: FormData): Promise<AiActionState> {
  const command = documentCommand(previous, form);
  if ("invalid" in command) return command.invalid;
  const actor = await actorFor();
  if (!actor) return { status: "forbidden", requestId: command.requestId };
  return done(await deleteAiDocument(actor, command), command.requestId);
}

/** «Это материал компании — продолжить» (§7): решение записывается, обработка продолжается. */
export async function confirmAiDocumentCompanyAction(previous: AiActionState, form: FormData): Promise<AiActionState> {
  const command = documentCommand(previous, form);
  if ("invalid" in command) return command.invalid;
  const actor = await actorFor();
  if (!actor) return { status: "forbidden", requestId: command.requestId };
  return done(await confirmAiDocumentCompany(actor, command), command.requestId);
}

const REVIEW_ACTIONS = new Set(["confirm", "correct", "dismiss", "reopen"]);
const REVIEW_STATUSES = new Set(["open", "applying", "resolved", "dismissed"]);

/**
 * Пункт «Листа сверки» (§7): «Подтвердить», «Исправить» (одна строка до 200
 * знаков), «Оставить как есть», «Открыть снова». Ожидаемый статус — против
 * решения двух сотрудников сразу (конфликт — «обновите страницу»).
 */
export async function resolveAiReviewItemAction(previous: AiActionState, form: FormData): Promise<AiActionState> {
  const fields = exactActionStringFields(form, ["request_id", "item_id", "review_action", "value", "expected_status"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const itemId = fields && parseSalesUuid(fields.get("item_id"));
  const action = fields?.get("review_action") ?? "";
  const expected = fields?.get("expected_status") ?? "";
  const raw = fields?.get("value") ?? "";
  if (!fields || !requestId || !itemId || !REVIEW_ACTIONS.has(action) || !REVIEW_STATUSES.has(expected)
    || (action === "correct" ? !isAiReviewCorrection(raw) : raw !== "")) {
    return { status: "invalid", requestId: requestId ?? previous.requestId };
  }
  const actor = await actorFor();
  if (!actor) return { status: "forbidden", requestId };
  return done(await resolveAiReviewItem(actor, {
    itemId, action: action as "confirm" | "correct" | "dismiss" | "reopen",
    value: action === "correct" ? raw.trim() : null,
    expectedStatus: expected as "open" | "applying" | "resolved" | "dismissed", requestId,
  }), requestId);
}

/** «Новая проверка» в Лаборатории. */
export async function discardAiLabAction(previous: AiActionState, form: FormData): Promise<AiActionState> {
  const fields = exactActionStringFields(form, ["request_id"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  if (!fields || !requestId) return { status: "invalid", requestId: previous.requestId };
  const actor = await actorFor();
  if (!actor) return { status: "forbidden", requestId };
  return done(await discardAiLab(actor), requestId);
}

/** «Не менять» — предложение отклонено, ничего не применяется. */
export async function rejectAiLabProposalAction(previous: AiActionState, form: FormData): Promise<AiActionState> {
  const fields = exactActionStringFields(form, ["request_id", "proposal_id"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const proposalId = fields && parseSalesUuid(fields.get("proposal_id"));
  if (!fields || !requestId || !proposalId) return { status: "invalid", requestId: requestId ?? previous.requestId };
  const actor = await actorFor();
  if (!actor) return { status: "forbidden", requestId };
  return done(await rejectAiLabProposal(actor, { proposalId, requestId }), requestId);
}

/** Удалить эталонный ответ. */
export async function deleteAiExampleAction(previous: AiActionState, form: FormData): Promise<AiActionState> {
  const fields = exactActionStringFields(form, ["request_id", "example_id"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const exampleId = fields && parseSalesUuid(fields.get("example_id"));
  if (!fields || !requestId || !exampleId) return { status: "invalid", requestId: requestId ?? previous.requestId };
  const actor = await actorFor();
  if (!actor) return { status: "forbidden", requestId };
  return done(await deleteAiExample(actor, { exampleId, requestId }), requestId);
}
