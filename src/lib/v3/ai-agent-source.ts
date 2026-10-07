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
  type AiRules,
  type AiSettings,
  type AiSpend,
} from "./ai-agent.ts";

/**
 * Раздел «ИИ-агент» (план §12.2): чтения и записи прямо в авторизованные RPC
 * `platform.ai_agent_*_v1` (269) от имени сотрудника — агент здесь не нужен.
 * Права, версии и аудит решает база; сбой — `unavailable`, отказ — `denied`,
 * нуля и пустого списка наугад нет. Просмотр роли администратором читает, но
 * не пишет.
 */
export type AiRead<T> =
  | Readonly<{ status: "available"; data: T }>
  | Readonly<{ status: "denied" | "unavailable" }>;

export type AiWriteStatus = "saved" | "conflict" | "forbidden" | "invalid" | "unavailable";

type RpcError = Readonly<{ code?: string; message?: string }>;

async function rpc(name: string, args: Record<string, unknown>) {
  return (await createSupabaseServerClient()).schema("platform").rpc(name, args);
}

async function read<T>(name: string, args: Record<string, unknown>, normalize: (value: unknown) => T): Promise<AiRead<T>> {
  try {
    const { data, error } = await rpc(name, args);
    if (error) return (error as RpcError).code === "42501" ? { status: "denied" } : { status: "unavailable" };
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
