import "server-only";

import { isStaffPreview } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";
import {
  normalizeAiDocuments,
  normalizeAiRules,
  normalizeAiSettings,
  normalizeAiSpend,
  type AiDocument,
  type AiReviewFilter,
  type AiRules,
  type AiSettings,
  type AiSpend,
} from "./ai-agent.ts";
import {
  normalizeAiDocumentDetail,
  normalizeAiDocumentPage,
  normalizeAiExamples,
  normalizeAiLabState,
  normalizeAiReviewList,
  type AiDocumentDetail,
  type AiDocumentPage,
  type AiGoldenExample,
  type AiLabState,
  type AiReviewAction,
  type AiReviewList,
  type AiReviewStatus,
} from "./ai-agent-knowledge.ts";

/**
 * Раздел «ИИ-агент» (план §12.2): чтения и записи прямо в авторизованные RPC
 * `platform.ai_agent_*_v1` (269) от имени сотрудника — агент здесь не нужен.
 * Права, версии и аудит решает база; сбой — `unavailable`, отказ — `denied`,
 * нуля и пустого списка наугад нет. Просмотр роли администратором читает, но
 * не пишет.
 */
export type AiRead<T> =
  | Readonly<{ status: "available"; data: T }>
  | Readonly<{ status: "denied" | "missing" | "unavailable" }>;

export type AiWriteStatus = "saved" | "conflict" | "forbidden" | "invalid" | "unavailable";

type RpcError = Readonly<{ code?: string; message?: string }>;

async function rpc(name: string, args: Record<string, unknown>) {
  return (await createSupabaseServerClient()).schema("platform").rpc(name, args);
}

async function read<T>(name: string, args: Record<string, unknown>, normalize: (value: unknown) => T): Promise<AiRead<T>> {
  try {
    const { data, error } = await rpc(name, args);
    if (error) {
      const code = (error as RpcError).code;
      return code === "42501" ? { status: "denied" } : code === "P0002" ? { status: "missing" } : { status: "unavailable" };
    }
    return { status: "available", data: normalize(data) };
  } catch {
    return { status: "unavailable" };
  }
}

export function readAiSettings(actor: ActivePlatformActor): Promise<AiRead<AiSettings>> {
  return read("ai_agent_settings_v1", { p_organization_id: actor.organizationId }, normalizeAiSettings);
}

export function readAiDocuments(actor: ActivePlatformActor): Promise<AiRead<Readonly<{
  items: readonly AiDocument[]; hasMore: boolean; canManage: boolean; isAdmin: boolean;
}>>> {
  return read("ai_agent_documents_v1", { p_organization_id: actor.organizationId, p_query: { limit: 100 } }, normalizeAiDocuments);
}

export function readAiRules(actor: ActivePlatformActor): Promise<AiRead<AiRules>> {
  return read("ai_agent_rules_v1", { p_organization_id: actor.organizationId, p_limit: 20 }, normalizeAiRules);
}

export function readAiSpend(actor: ActivePlatformActor): Promise<AiRead<AiSpend>> {
  return read("ai_agent_spend_v1", { p_organization_id: actor.organizationId }, normalizeAiSpend);
}

// ------------------------------------------------------------------ P2

/** Карточка документа и его страницы (271). */
export function readAiDocumentDetail(actor: ActivePlatformActor, documentId: string): Promise<AiRead<AiDocumentDetail>> {
  return read("ai_agent_document_v1", { p_organization_id: actor.organizationId, p_document_id: documentId }, normalizeAiDocumentDetail);
}

/** Страница документа: текст, строки, фрагменты с рамками и пункты сверки (271). */
export function readAiDocumentPage(actor: ActivePlatformActor, documentId: string, pageNo: number): Promise<AiRead<AiDocumentPage>> {
  return read("ai_agent_document_page_v1", {
    p_organization_id: actor.organizationId, p_document_id: documentId, p_page_no: pageNo,
  }, normalizeAiDocumentPage);
}

/** «Лист сверки» (272): открытые (и применяемые) или решённые пункты живых документов. */
export function readAiReview(
  actor: ActivePlatformActor,
  input: Readonly<{ filter: AiReviewFilter; documentId: string | null; limit: number }>,
): Promise<AiRead<AiReviewList>> {
  const query: Record<string, unknown> = { status: input.filter === "open" ? "pending" : input.filter, limit: input.limit };
  if (input.documentId) query.documentId = input.documentId;
  return read("ai_agent_review_v1", { p_organization_id: actor.organizationId, p_query: query }, normalizeAiReviewList);
}

/** «Лаборатория» (273): своя проверка и предложение сотрудника. */
export function readAiLab(actor: ActivePlatformActor): Promise<AiRead<AiLabState>> {
  return read("ai_agent_lab_v1", { p_organization_id: actor.organizationId }, normalizeAiLabState);
}

/** Эталонные ответы (273): действует ли каждый — решает база. */
export function readAiExamples(actor: ActivePlatformActor): Promise<AiRead<Readonly<{
  items: readonly AiGoldenExample[]; hasMore: boolean; canManage: boolean;
}>>> {
  return read("ai_agent_examples_v1", { p_organization_id: actor.organizationId, p_query: { limit: 50 } }, normalizeAiExamples);
}

function writeStatus(error: RpcError): AiWriteStatus {
  if (error.code === "PT409") return "conflict";
  if (error.code === "42501") return "forbidden";
  if (error.code === "22023" || error.code === "23505" || error.code === "P0002") return "invalid";
  return "unavailable";
}

async function write(actor: ActivePlatformActor, name: string, args: Record<string, unknown>): Promise<AiWriteStatus> {
  if (isStaffPreview(actor)) return "forbidden";
  try {
    const { error } = await rpc(name, { p_organization_id: actor.organizationId, ...args });
    return error ? writeStatus(error) : "saved";
  } catch {
    return "unavailable";
  }
}

export function saveAiRules(actor: ActivePlatformActor, input: Readonly<{ body: string; expectedVersion: number | null; requestId: string }>) {
  return write(actor, "ai_agent_rules_save_v1", {
    p_body: input.body, p_expected_current_version: input.expectedVersion, p_request_id: input.requestId,
  });
}

export function confirmAiRules(actor: ActivePlatformActor, input: Readonly<{ rulesVersionId: string; requestId: string }>) {
  return write(actor, "ai_agent_rules_confirm_v1", { p_rules_version_id: input.rulesVersionId, p_request_id: input.requestId });
}

export function retryAiDocument(actor: ActivePlatformActor, input: Readonly<{ documentId: string; expectedVersion: number; requestId: string }>) {
  return write(actor, "ai_agent_document_retry_v1", {
    p_document_id: input.documentId, p_expected_version: input.expectedVersion, p_request_id: input.requestId,
  });
}

export function recordAiConsent(actor: ActivePlatformActor, input: Readonly<{ action: "grant" | "revoke"; textVersion: string | null; requestId: string }>) {
  return write(actor, "ai_agent_consent_record_v1", {
    p_action: input.action, p_text_version: input.textVersion, p_request_id: input.requestId,
  });
}

export function saveAiMonthlyCap(actor: ActivePlatformActor, input: Readonly<{ expectedVersion: number; monthlyCapUsd: number; requestId: string }>) {
  return write(actor, "ai_agent_settings_save_v1", {
    p_expected_version: input.expectedVersion, p_patch: { monthlyCapUsd: input.monthlyCapUsd }, p_request_id: input.requestId,
  });
}

// ------------------------------------------------------------------ P2 writes

/**
 * Удаление документа (269): база удаляет строку, фрагменты, страницы и пункты
 * сверки и останавливает обработку; CRM затем убирает его объекты из Storage
 * (`{org}/{doc}/` целиком). Bucket закрыт, поэтому неудачная уборка не
 * открывает файл — объект просто остаётся недостижимым до повтора уборки.
 */
export async function deleteAiDocument(actor: ActivePlatformActor, input: Readonly<{ documentId: string; expectedVersion: number; requestId: string }>) {
  const status = await write(actor, "ai_agent_document_delete_v1", {
    p_document_id: input.documentId, p_expected_version: input.expectedVersion, p_request_id: input.requestId,
  });
  if (status === "saved") {
    const { removeAiDocumentObjects } = await import("../server/ai-agent-storage-cleanup.ts");
    await removeAiDocumentObjects(actor.organizationId, input.documentId).catch(() => false);
  }
  return status;
}

/** «Это материал компании — продолжить» у документа, похожего на документ клиента (271). */
export function confirmAiDocumentCompany(actor: ActivePlatformActor, input: Readonly<{ documentId: string; expectedVersion: number; requestId: string }>) {
  return write(actor, "ai_agent_document_confirm_company_v1", {
    p_document_id: input.documentId, p_expected_version: input.expectedVersion, p_request_id: input.requestId,
  });
}

/** Решение по пункту «Листа сверки» (272): ожидаемый статус — против гонки двух сотрудников. */
export function resolveAiReviewItem(actor: ActivePlatformActor, input: Readonly<{
  itemId: string; action: AiReviewAction; value: string | null; expectedStatus: AiReviewStatus; requestId: string;
}>) {
  return write(actor, "ai_agent_review_resolve_v1", {
    p_item_id: input.itemId, p_action: input.action, p_value: input.value,
    p_expected_status: input.expectedStatus, p_request_id: input.requestId,
  });
}

/** «Новая проверка» — своя проверка Лаборатории начинается с пустой (273). */
export function discardAiLab(actor: ActivePlatformActor) {
  // Без id запроса (273): повтор «Новой проверки» безвреден — сессия уже пуста.
  return write(actor, "ai_agent_lab_discard_v1", {});
}

/** «Не менять» — предложение отклонено, знания не тронуты (273). */
export function rejectAiLabProposal(actor: ActivePlatformActor, input: Readonly<{ proposalId: string; requestId: string }>) {
  return write(actor, "ai_agent_lab_reject_v1", { p_proposal_id: input.proposalId, p_request_id: input.requestId });
}

/** Удалить эталонный ответ (273). */
export function deleteAiExample(actor: ActivePlatformActor, input: Readonly<{ exampleId: string; requestId: string }>) {
  return write(actor, "ai_agent_example_delete_v1", { p_example_id: input.exampleId, p_request_id: input.requestId });
}
