import "server-only";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import {
  getPlatformWhatsAppContacts,
  type PlatformWhatsAppContact,
} from "@/lib/platform-communications";
import { whatsAppChatLabel, whatsAppChatTitle } from "@/lib/v3/whatsapp-contact";

const CONTACT_CHUNK = 60;

/**
 * Имена и номера WhatsApp-чатов (278) для уже прочитанных id. Чтение
 * информационное: сбой, отказ или ещё не применённая миграция — пустой
 * ответ, и экран показывает тему чата, как раньше.
 */
export async function readWhatsAppContacts(
  actor: ActivePlatformActor,
  ids: readonly string[],
): Promise<ReadonlyMap<string, PlatformWhatsAppContact>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += CONTACT_CHUNK) {
    chunks.push(unique.slice(start, start + CONTACT_CHUNK));
  }
  try {
    const maps = await Promise.all(chunks.map((chunk) => getPlatformWhatsAppContacts(actor, chunk)));
    return new Map(maps.flatMap((map) => [...map]));
  } catch {
    return new Map();
  }
}

/** Ссылки на чаты лида: тема заменяется именем и номером, где они есть. */
export async function withWhatsAppTitles<T extends Readonly<{ conversationId: string; subject: string }>>(
  actor: ActivePlatformActor,
  conversations: readonly T[],
): Promise<readonly T[]> {
  if (conversations.length === 0) return conversations;
  const contacts = await readWhatsAppContacts(actor, conversations.map((item) => item.conversationId));
  if (contacts.size === 0) return conversations;
  return Object.freeze(conversations.map((item) => {
    const contact = contacts.get(item.conversationId);
    return contact
      ? Object.freeze({ ...item, subject: whatsAppChatLabel(whatsAppChatTitle(item.subject, contact)) })
      : item;
  }));
}
