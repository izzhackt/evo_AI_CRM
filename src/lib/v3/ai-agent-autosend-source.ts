import "server-only";

import { isStaffPreview } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";
import type { AiRead, AiWriteStatus } from "./ai-agent-source.ts";
import {
  normalizeAiAutosendChat,
  normalizeAiAutosendJournal,
  normalizeAiAutosendState,
  normalizeAiAutosendSummary,
  type AiAutosendChat,
  type AiAutosendJournal,
  type AiAutosendJournalFilter,
  type AiAutosendSettings,
  type AiAutosendState,
  type AiAutosendSummaryRead,
} from "./ai-agent-autosend.ts";
import { getPlatformConversationSummary } from "../platform-communications.ts";
import { whatsAppChatLabel, whatsAppChatTitle } from "./whatsapp-contact.ts";
import { readWhatsAppContacts } from "./whatsapp-contact-source.ts";

/**
 * «Автоответчик» (P4, план §11): чтения и записи — прямо в авторизованные RPC
 * `platform.ai_agent_autosend_*_v1` (277) от имени сотрудника. Права, версии,
 * согласие, три ночи проверки и аудит решает база; сбой — `unavailable`,
 * отказ — `denied`, нуля наугад нет. Просмотр роли читает, но не пишет.
 */
type RpcError = Readonly<{ code?: string; message?: string }>;

async function rpc(name: string, args: Record<string, unknown>) {
  return (await createSupabaseServerClient()).schema("platform").rpc(name, args);
}

async function readRpc<T>(name: string, args: Record<string, unknown>, normalize: (value: unknown) => T): Promise<AiRead<T>> {
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

export async function readAiAutosend(actor: ActivePlatformActor): Promise<AiRead<AiAutosendState>> {
  const read = await readRpc("ai_agent_autosend_v1", { p_organization_id: actor.organizationId }, normalizeAiAutosendState);
  if (read.status !== "available" || read.data.settings.liveTestConversationIds.length === 0) return read;
  const titles = await readConversationTitles(actor, read.data.settings.liveTestConversationIds);
  return { status: "available", data: Object.freeze({ ...read.data, liveTestTitles: Object.freeze(Object.fromEntries(titles)) }) };
}

/**
 * Имена чатов, которые журнал и сводка знают только по id (277 отдаёт id): то
 * же охраняемое чтение диалога, что у переписки, — чужой чат остаётся без
 * имени. Название — как в списке WhatsApp (278): имя из профиля и номер
 * «+996 ••• 12 46 64». Не больше 40 чатов за страницу; сбой — без имени, а
 * не ошибка.
 */
const TITLE_LIMIT = 40;
async function readConversationTitles(actor: ActivePlatformActor, ids: readonly (string | null)[]): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))].slice(0, TITLE_LIMIT);
  const contactsRead = readWhatsAppContacts(actor, unique);
  const entries = await Promise.all(unique.map(async (id) => {
    try {
      const summary = await getPlatformConversationSummary(actor, id);
      return summary ? ([id, summary.subject] as const) : null;
    } catch {
      return null;
    }
  }));
  const contacts = await contactsRead;
  return new Map(entries.filter((entry): entry is readonly [string, string] => entry !== null)
    .map(([id, subject]) => [id, whatsAppChatLabel(whatsAppChatTitle(subject, contacts.get(id)))] as const));
}

export async function readAiAutosendJournal(
  actor: ActivePlatformActor,
  input: Readonly<{ filter: AiAutosendJournalFilter; limit: number }>,
): Promise<AiRead<AiAutosendJournal>> {
  const query: Record<string, unknown> = { limit: input.limit };
  if (input.filter !== "all") query.status = input.filter;
  const read = await readRpc("ai_agent_autosend_log_v1", { p_organization_id: actor.organizationId, p_query: query }, normalizeAiAutosendJournal);
  if (read.status !== "available") return read;
  const titles = await readConversationTitles(actor, read.data.items.map((row) => row.conversationId));
  return { status: "available", data: Object.freeze({
    ...read.data,
    items: Object.freeze(read.data.items.map((row) => Object.freeze({ ...row, conversationTitle: titles.get(row.conversationId) ?? null }))),
  }) };
}

export async function readAiAutosendSummary(actor: ActivePlatformActor, summaryId: string | null): Promise<AiRead<AiAutosendSummaryRead>> {
  const read = await readRpc("ai_agent_autosend_summary_v1", { p_organization_id: actor.organizationId, p_summary_id: summaryId }, normalizeAiAutosendSummary);
  if (read.status !== "available" || !read.data.summary) return read;
  const summary = read.data.summary;
  const titles = await readConversationTitles(actor, summary.items.map((item) => item.conversationId));
  return { status: "available", data: Object.freeze({
    ...read.data,
    summary: Object.freeze({
      ...summary,
      items: Object.freeze(summary.items.map((item) => Object.freeze({
        ...item, conversationTitle: item.conversationId ? titles.get(item.conversationId) ?? null : null,
      }))),
    }),
  }) };
}

export function readAiAutosendChat(actor: ActivePlatformActor, conversationId: string): Promise<AiRead<AiAutosendChat>> {
  return readRpc("ai_agent_autosend_conversation_v1", { p_organization_id: actor.organizationId, p_conversation_id: conversationId }, normalizeAiAutosendChat);
}

export type AiAutosendWriteStatus = AiWriteStatus;
/**
 * Отказы записи настроек со своим текстом (277): список живого теста задаёт
 * только тот, кто сам может отправлять в WhatsApp (`ai_autosend_sender_required`,
 * 42501), только из чатов, которые он читает (`ai_conversation_unavailable`,
 * 42501), и только после трёх ночей проверки (`ai_autosend_shadow_nights_required`,
 * PT412 — не согласие на Gemini).
 */
export type AiAutosendSaveStatus = AiAutosendWriteStatus | "sender_required" | "chat_unavailable" | "shadow_nights_required";

function writeStatus(error: RpcError): AiAutosendWriteStatus {
  if (error.code === "PT409" || error.code === "23505") return "conflict";
  if (error.code === "PT412") return "consent_required";
  if (error.code === "42501") return "forbidden";
  if (error.code === "22023" || error.code === "P0002" || error.code === "23514") return "invalid";
  return "unavailable";
}

async function write(actor: ActivePlatformActor, name: string, args: Record<string, unknown>): Promise<AiAutosendWriteStatus> {
  if (isStaffPreview(actor)) return "forbidden";
  try {
    const { error } = await rpc(name, { p_organization_id: actor.organizationId, ...args });
    return error ? writeStatus(error as RpcError) : "saved";
  } catch {
    return "unavailable";
  }
}

/**
 * Настройки одной записью — только изменённые ключи (`aiAutosendSettingsPatch`);
 * ожидаемая версия — против гонки двух сотрудников (PT409).
 */
export async function saveAiAutosendSettings(
  actor: ActivePlatformActor,
  input: Readonly<{ patch: Partial<AiAutosendSettings>; expectedVersion: number; requestId: string }>,
): Promise<AiAutosendSaveStatus> {
  if (isStaffPreview(actor)) return "forbidden";
  try {
    const { error } = await rpc("ai_agent_autosend_save_v1", {
      p_organization_id: actor.organizationId, p_expected_version: input.expectedVersion, p_patch: input.patch, p_request_id: input.requestId,
    });
    if (!error) return "saved";
    const { code, message } = error as RpcError;
    if (code === "42501" && message === "ai_autosend_sender_required") return "sender_required";
    if (code === "42501" && message === "ai_conversation_unavailable") return "chat_unavailable";
    if (code === "PT412" && message === "ai_autosend_shadow_nights_required") return "shadow_nights_required";
    return writeStatus(error as RpcError);
  } catch {
    return "unavailable";
  }
}

/**
 * Главный выключатель. Включение — согласие на Gemini и право отвечать в
 * WhatsApp (PT412 / 42501); ответственным становится включивший; первое
 * включение — «Проверка без отправки». Выключение отменяет ждущие отправки.
 */
export function enableAiAutosend(actor: ActivePlatformActor, input: Readonly<{ enabled: boolean; expectedVersion: number; requestId: string }>) {
  return write(actor, "ai_agent_autosend_enable_v1", {
    p_enabled: input.enabled, p_expected_version: input.expectedVersion, p_request_id: input.requestId,
  });
}

/** «Проверка без отправки» ↔ «Отвечает»: живой — после трёх ночей проверки, с подтверждённой строкой о помощнике (PT412). */
export function setAiAutosendShadow(actor: ActivePlatformActor, input: Readonly<{ shadow: boolean; expectedVersion: number; requestId: string }>) {
  return write(actor, "ai_agent_autosend_shadow_v1", {
    p_shadow: input.shadow, p_expected_version: input.expectedVersion, p_request_id: input.requestId,
  });
}

/** Пауза и «Снять паузу» — только человек; снятие обнуляет счётчики ошибок. */
export function pauseAiAutosend(actor: ActivePlatformActor, input: Readonly<{ action: "pause" | "resume"; expectedVersion: number; requestId: string }>) {
  return write(actor, "ai_agent_autosend_pause_v1", {
    p_action: input.action, p_expected_version: input.expectedVersion, p_request_id: input.requestId,
  });
}

/** «Автоответчик в этом чате» (окно ИИ): исключить чат или вернуть. */
export function setAiAutosendExclusion(actor: ActivePlatformActor, input: Readonly<{ conversationId: string; excluded: boolean; requestId: string }>) {
  return write(actor, "ai_agent_autosend_exclusion_v1", {
    p_conversation_id: input.conversationId, p_excluded: input.excluded, p_request_id: input.requestId,
  });
}
