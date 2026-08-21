import { PLATFORM_AUDIT_ACTIONS } from "./platform-audit.ts";

/**
 * Standing questions over the audit trail.
 *
 * The audit already records what happened; what it lacked was a way in. Each
 * question is a named set of actions that answers one governance question, and
 * resolves to a pre-filtered search rather than a number, so nothing is
 * asserted that the search itself would not show.
 *
 * Counting is deliberately absent: the search RPC paginates at 100 rows and
 * offers no aggregation, so any count rendered here would either be capped or
 * require dozens of round trips. A capped count reads as a fact and is not one.
 */

export type AuditQuestion = Readonly<{
  key: string;
  question: string;
  why: string;
  actions: readonly string[];
}>;

/** Filters accept at most 32 values, so a question must stay inside that. */
export const AUDIT_QUESTION_ACTION_LIMIT = 32;

export const AUDIT_QUESTIONS: readonly AuditQuestion[] = [
  {
    key: "staff-access",
    question: "Кто менял доступ сотрудников?",
    why: "Выдача, смена роли, блокировка и область доступа определяют, кто что может делать.",
    actions: [
      "membership.provision",
      "membership.role.change",
      "membership.status.change",
      "membership.scope.organization.assign",
      "membership.scope.organization.revoke",
    ],
  },
  {
    key: "case-ownership",
    question: "Кто передавал и переназначал дела?",
    why: "Смена куратора и передача от продаж меняют ответственного за студента.",
    actions: ["case.curator.set", "case.handoff.create", "case.lifecycle.change"],
  },
  {
    key: "money",
    question: "Кто подтверждал деньги и блокировки?",
    why: "Обязательства, платежи и стоп-факторы напрямую влияют на работу по делу.",
    actions: [
      "finance.obligation.create",
      "finance.payment.record",
      "finance.stop.create",
      "finance.stop.resolve",
    ],
  },
  {
    key: "sensitive-documents",
    question: "Кто получал доступ к документам?",
    why: "Выдача ссылки на скачивание — момент, когда чувствительный файл покидает систему.",
    actions: ["document.download.grant", "document.download.sign.authorize"],
  },
  {
    key: "document-decisions",
    question: "Какие решения принимались по документам?",
    why: "Приём, требование исправления и отказ определяют, что студент делает дальше.",
    actions: ["document.version.review", "document.validation.attest"],
  },
  {
    key: "ai-sending",
    question: "Что происходило с ответами ИИ?",
    why: "Черновик, его правка и ручная отправка показывают, что именно ушло клиенту.",
    actions: [
      "ai.draft.generate",
      "ai.draft.review",
      "ai.control.set",
      "autonomous.reply.control.set",
    ],
  },
  {
    key: "knowledge",
    question: "Кто менял базу знаний?",
    why: "Публикация и снятие версии меняют то, на чём ИИ основывает ответы клиенту.",
    actions: [
      "knowledge.version.publish",
      "knowledge.version.retire",
      "knowledge.chunkset.publish",
    ],
  },
  {
    key: "audit-access",
    question: "Кто читал и выгружал сам аудит?",
    why: "Выгрузка истории аудита сама выносит наружу чувствительные сведения.",
    actions: ["audit.export"],
  },
];

/**
 * A question that names an action the audit does not define would silently
 * return nothing, which reads as "this never happened". Refuse it instead.
 */
export function unknownAuditActions(question: AuditQuestion): readonly string[] {
  const known = new Set<string>(PLATFORM_AUDIT_ACTIONS as readonly string[]);
  return question.actions.filter((action) => !known.has(action));
}

export function auditQuestionHref(
  question: AuditQuestion,
  options: Readonly<{ startAt?: string; endAt?: string; pageSize?: number }> = {},
): string {
  const params = new URLSearchParams({ tab: "audit" });
  if (options.startAt) params.set("start_at", options.startAt);
  if (options.endAt) params.set("end_at", options.endAt);
  params.set("actions", question.actions.join(","));
  if (options.pageSize) params.set("page_size", String(options.pageSize));
  return `/settings?${params.toString()}`;
}

/** Start of the window a question opens with, expressed as a date only. */
export function defaultAuditWindowStart(now: Date, days = 30): string {
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return start.toISOString().slice(0, 10);
}
