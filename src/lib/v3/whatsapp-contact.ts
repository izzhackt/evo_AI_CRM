import type { PlatformWhatsAppContact } from "@/lib/platform-communications";

/**
 * Как назвать WhatsApp-чат (просьба владельца 07.10.2026): имя из профиля
 * WhatsApp (или набранное сотрудником), без имени — «WhatsApp»; рядом номер —
 * код страны и последние шесть цифр, «+996 ••• 12 46 64», чтобы два клиента с
 * одинаковыми последними четырьмя цифрами не путались. Без строки 278 (не
 * WhatsApp-чат, номер неизвестен, чтение не удалось) — тема чата, как раньше.
 */
export type WhatsAppChatTitle = Readonly<{
  name: string;
  phone: string | null;
}>;

export const WHATSAPP_UNNAMED = "WhatsApp";

export function whatsAppChatTitle(
  subject: string,
  contact: PlatformWhatsAppContact | null | undefined,
): WhatsAppChatTitle {
  if (!contact) return Object.freeze({ name: subject, phone: null });
  return Object.freeze({ name: contact.name ?? WHATSAPP_UNNAMED, phone: contact.phone });
}

/** Одной строкой — там, где под номер нет своего места (журнал, ссылка). */
export function whatsAppChatLabel(title: WhatsAppChatTitle): string {
  return title.phone ? `${title.name} · ${title.phone}` : title.name;
}
