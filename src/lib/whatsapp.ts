import { db, getSetting, LEAD_STATUSES } from "./db";
import { normalizePhone } from "./phone";

export type SendResult = { status: "sent" | "failed"; waId?: string; error?: "not_configured" | "provider_error" };

// Отправка через официальный WhatsApp Cloud API (Meta).
export async function sendWhatsApp(phone: string, text: string): Promise<SendResult> {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return { status: "failed", error: "provider_error" };
  const token = getSetting("wa_token");
  const phoneId = getSetting("wa_phone_id");
  if (!token || !phoneId) {
    console.error("WhatsApp send blocked: missing wa_token or wa_phone_id");
    return { status: "failed", error: "not_configured" };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalizedPhone.replace(/[^\d]/g, ""),
        type: "text",
        text: { body: text },
      }),
    });
    if (!res.ok) {
      console.error("WhatsApp send failed:", res.status, await res.text());
      return { status: "failed", error: "provider_error" };
    }
    const data = (await res.json()) as { messages?: { id: string }[] };
    return { status: "sent", waId: data.messages?.[0]?.id };
  } catch (e) {
    console.error("WhatsApp send error:", e);
    return { status: "failed", error: "provider_error" };
  }
}

// Входящее сообщение (из webhook): находим или создаём диалог, сохраняем сообщение.
export function receiveWhatsApp(phone: string, name: string | null, text: string, waId?: string) {
  const d = db();
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;
  const existing = d.prepare("SELECT id FROM wa_conversations WHERE phone = ?").get(normalizedPhone) as { id: number } | undefined;
  let convId: number | bigint;
  if (existing) {
    convId = existing.id;
    d.prepare("UPDATE wa_conversations SET last_message_at = datetime('now'), unread = unread + 1, name = COALESCE(name, ?) WHERE id = ?")
      .run(name, convId);
  } else {
    // новый контакт в WhatsApp автоматически становится лидом с источником WhatsApp
    const lead = d.prepare("INSERT INTO leads (name, phone, source, status) VALUES (?, ?, 'WhatsApp', ?)")
      .run(name ?? normalizedPhone, normalizedPhone, LEAD_STATUSES[0]);
    convId = d.prepare("INSERT INTO wa_conversations (phone, name, lead_id, last_message_at, unread) VALUES (?, ?, ?, datetime('now'), 1)")
      .run(normalizedPhone, name, lead.lastInsertRowid).lastInsertRowid;
  }
  d.prepare("INSERT INTO wa_messages (conversation_id, direction, text, status, wa_id) VALUES (?, 'in', ?, 'received', ?)")
    .run(convId, text, waId ?? null);
  return convId;
}
