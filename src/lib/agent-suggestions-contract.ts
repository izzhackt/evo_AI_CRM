/**
 * «Предложение агента, которое принимает человек» (миграция 383, решение владельца 28.11.2026): чистые функции без ввода-вывода.
 * Читают ответы трёх RPC сотрудника (`agent_suggestion_read_v1`, `agent_suggestion_decide_v1`, `case_handoff_note_v1`),
 * выбирают агента-куратора по делу и строят тексты поручений. Правила базы повторять здесь не нужно: это подсказки экрана.
 */
import type { AiAgentKey } from "./ai-agents/contract.ts";
import { salesCountryDirection } from "./sales-country-curator.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/u;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;

export const AGENT_SUGGESTION_TEXT_MAX_LENGTH = 300;
export const AGENT_SUGGESTION_REASON_MAX_LENGTH = 300;

export type AgentSuggestion = Readonly<{
  id: string;
  studentCaseId: string;
  text: string;
  dueOn: string | null;
  assigneeMembershipId: string | null;
  assigneeName: string | null;
  reason: string;
  agentKey: string;
  agentTitle: string | null;
  createdAt: string;
  expiresAt: string;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const oneLine = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim().length > 0 && [...value].length <= max && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim() : null;
const optionalLine = (value: unknown, max: number): string | null | undefined =>
  value === null || value === undefined ? null : oneLine(value, max) ?? undefined;

/** Ответ `agent_suggestion_read_v1`: предложение или null. Неузнаваемая форма — null (экран не рисует строку). */
export function parseAgentSuggestion(value: unknown, studentCaseId: string): AgentSuggestion | null {
  if (!isRecord(value)) return null;
  const id = typeof value.suggestion_id === "string" && UUID.test(value.suggestion_id) ? value.suggestion_id : null;
  const text = oneLine(value.text, AGENT_SUGGESTION_TEXT_MAX_LENGTH);
  const reason = oneLine(value.reason, AGENT_SUGGESTION_REASON_MAX_LENGTH);
  const dueOn = value.due_on === null || value.due_on === undefined ? null : typeof value.due_on === "string" && ISO_DAY.test(value.due_on) ? value.due_on : undefined;
  const assigneeName = optionalLine(value.assignee_name, 200);
  const agentTitle = optionalLine(value.agent_title, 200);
  const assignee = value.assignee_membership_id === null || value.assignee_membership_id === undefined ? null
    : typeof value.assignee_membership_id === "string" && UUID.test(value.assignee_membership_id) ? value.assignee_membership_id : undefined;
  if (value.student_case_id !== studentCaseId || !id || !text || !reason || dueOn === undefined || assignee === undefined
    || assigneeName === undefined || agentTitle === undefined || typeof value.agent_key !== "string"
    || typeof value.created_at !== "string" || !DATE_TIME.test(value.created_at)
    || typeof value.expires_at !== "string" || !DATE_TIME.test(value.expires_at)) return null;
  return Object.freeze({
    id, studentCaseId, text, dueOn, assigneeMembershipId: assignee, assigneeName, reason, agentKey: value.agent_key,
    agentTitle, createdAt: value.created_at, expiresAt: value.expires_at,
  });
}

export type AgentSuggestionDecision = "accept" | "dismiss";
export type AgentSuggestionStatus =
  | "accepted" | "dismissed" | "invalid" | "forbidden" | "preview" | "stale" | "not_active" | "gone" | "request_conflict" | "unavailable";

/** Ответ `agent_suggestion_decide_v1`: итог и (при «Принять») квитанция записи шага. */
export type AgentSuggestionDecided = Readonly<{
  status: "accepted" | "dismissed";
  receipt: Readonly<{ nextAction: string | null; nextActionDueOn: string | null; admissionsVersion: string }> | null;
  replayed: boolean;
}>;

export function parseAgentSuggestionDecided(value: unknown): AgentSuggestionDecided | null {
  if (!isRecord(value) || (value.status !== "accepted" && value.status !== "dismissed")) return null;
  const replayed = value.replayed === true;
  if (value.status === "dismissed") return Object.freeze({ status: "dismissed", receipt: null, replayed });
  const receipt = value.receipt;
  if (!isRecord(receipt) || typeof receipt.admissions_version !== "string" || !/^\d{1,19}$/u.test(receipt.admissions_version)) return null;
  const nextAction = typeof receipt.next_action === "string" ? receipt.next_action : null;
  const due = typeof receipt.next_action_due_on === "string" && ISO_DAY.test(receipt.next_action_due_on) ? receipt.next_action_due_on : null;
  return Object.freeze({
    status: "accepted",
    receipt: Object.freeze({ nextAction, nextActionDueOn: due, admissionsVersion: receipt.admissions_version }),
    replayed,
  });
}

/** Ошибка RPC «решения» → честный итог. 22023/55000 различаются по тексту, остальное — по коду. */
export function agentSuggestionStatusFromRpcError(error: unknown): Exclude<AgentSuggestionStatus, "accepted" | "dismissed" | "preview"> {
  if (!isRecord(error)) return "unavailable";
  const code = typeof error.code === "string" ? error.code : null;
  const message = typeof error.message === "string" ? error.message.trim() : "";
  if (code === "42501") return "forbidden";
  if (code === "PT409") return "stale";
  if (code === "55000" && message === "agent_suggestion_not_pending") return "gone";
  if (code === "22023") {
    if (message === "case_next_action_case_not_active") return "not_active";
    if (message === "case_next_action_request_conflict") return "request_conflict";
    return "invalid";
  }
  return "unavailable";
}

/* ----------------------------------------------------------- агент по делу */

const AGENT_BY_DIRECTION: Readonly<Record<string, AiAgentKey>> = Object.freeze({
  CN: "curator-cn", MY: "curator-my", EUROPE: "curator-eu", AE: "curator-ae", TR: "curator-tr",
});

/**
 * Агент-куратор дела: сначала страна дела (Китай и Малайзия), иначе направление дела (Европа, ОАЭ, Турция).
 * Дело без того и другого агента не получает: честное «агента нет», а не случайный.
 */
export function curatorAgentKey(input: Readonly<{ direction: string | null; country: string | null }>): AiAgentKey | null {
  const byCountry = salesCountryDirection(input.country);
  if (byCountry) return AGENT_BY_DIRECTION[byCountry] ?? null;
  return input.direction ? AGENT_BY_DIRECTION[input.direction] ?? null : null;
}

/* --------------------------------------------------------------- поручения */

/** Поручение агенту по кнопке «Предложить шаг»: одно предложение, клиенту не пишет, этапы не двигает. */
export function nextStepCommandText(studentCaseId: string): string {
  return `Дело case_id=${studentCaseId}: вызови get_case_dossier, предложи ОДИН следующий шаг через propose_next_step (≤300 символов, срок, исполнитель); клиенту не пиши, этапы не двигай.`;
}

/** Поручение агенту по кнопке «Собрать передачу»: страница по шаблону из правил куратора, заметка дела «Передача дела». */
export function handoffCommandText(studentCaseId: string): string {
  return `Дело case_id=${studentCaseId}: вызови get_case_dossier и, если у дела есть лид, get_lead_dossier; собери страницу передачи по шаблону и сохрани через add_note с заголовком «Передача дела»; клиенту не пиши.`;
}

/* ------------------------------------------------------- страница передачи */

export type HandoffLine = Readonly<{ label: string | null; text: string; sub: boolean }>;
export type HandoffNote = Readonly<{
  noteId: string;
  createdAt: string;
  agentTitle: string;
  lines: readonly HandoffLine[];
}>;

const HANDOFF_HEADER = /^\[ИИ «([^»]{1,120})»\] Передача дела(?:\r?\n|$)/u;

/**
 * Ответ `case_handoff_note_v1`: заметка «Передача дела». Строки — поля страницы: «Подпись: значение» делится на подпись и
 * текст, строки-подпункты («— Условия продажи: …», «- …») помечены `sub`. Своего хранилища нет: это обычная заметка дела.
 */
export function parseHandoffNote(value: unknown): HandoffNote | null {
  if (!isRecord(value) || typeof value.body !== "string" || typeof value.case_note_id !== "string" || !UUID.test(value.case_note_id)
    || typeof value.created_at !== "string" || !DATE_TIME.test(value.created_at)) return null;
  const header = HANDOFF_HEADER.exec(value.body);
  if (!header) return null;
  const lines: HandoffLine[] = [];
  for (const raw of value.body.slice(header[0].length).split(/\r?\n/u)) {
    let text = raw.trim();
    if (!text) continue;
    const sub = /^[-—–•]\s+/u.test(text);
    if (sub) text = text.replace(/^[-—–•]\s+/u, "");
    const colon = text.indexOf(":");
    if (colon > 0 && colon <= 60 && !text.slice(0, colon).includes("  ")) {
      lines.push({ label: text.slice(0, colon).trim(), text: text.slice(colon + 1).trim(), sub });
    } else {
      lines.push({ label: null, text, sub });
    }
  }
  return Object.freeze({ noteId: value.case_note_id, createdAt: value.created_at, agentTitle: header[1], lines: Object.freeze(lines) });
}
