import { db, getSetting } from "./db";
import { normalizePhone } from "./phone";

export type SendResult = { status: "sent" | "failed"; waId?: string; error?: "not_configured" | "provider_error" };

type WhatsAppProvider = "meta" | "waha";

type WhatsAppAccount = {
  id: number;
  provider: WhatsAppProvider;
  name: string;
  session_name: string | null;
  phone: string | null;
  status: string;
};

// Отправка через официальный WhatsApp Cloud API (Meta).
export async function sendWhatsApp(phone: string, text: string, accountId?: number | null): Promise<SendResult> {
  const account = accountId ? getWhatsAppAccount(accountId) : getDefaultWhatsAppAccount();
  if (account?.provider === "waha") return sendWahaWhatsApp(account, phone, text);
  return sendMetaWhatsApp(phone, text);
}

async function sendMetaWhatsApp(phone: string, text: string): Promise<SendResult> {
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

async function sendWahaWhatsApp(account: WhatsAppAccount, phone: string, text: string): Promise<SendResult> {
  const normalizedPhone = normalizePhone(phone);
  const session = account.session_name?.trim();
  const baseUrl = normalizeBaseUrl(getSetting("waha_base_url"));
  const apiKey = getSetting("waha_api_key")?.trim();
  if (!normalizedPhone || !session || !baseUrl || !apiKey) {
    console.error("WAHA send blocked: missing phone, session, base URL, or API key");
    return { status: "failed", error: "not_configured" };
  }

  try {
    const res = await fetch(`${baseUrl}/api/sendText`, {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session,
        chatId: `${normalizedPhone.replace(/[^\d]/g, "")}@c.us`,
        text,
      }),
    });
    if (!res.ok) {
      console.error("WAHA send failed:", res.status, await res.text());
      return { status: "failed", error: "provider_error" };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string; messageId?: string };
    return { status: "sent", waId: data.id ?? data.messageId };
  } catch (e) {
    console.error("WAHA send error:", e);
    return { status: "failed", error: "provider_error" };
  }
}

export function getWhatsAppAccount(id: number): WhatsAppAccount | null {
  const account = db().prepare("SELECT * FROM wa_accounts WHERE id = ?").get(id) as WhatsAppAccount | undefined;
  return account ?? null;
}

export function getWhatsAppAccountBySession(session: string): WhatsAppAccount | null {
  const account = db().prepare("SELECT * FROM wa_accounts WHERE provider = 'waha' AND session_name = ?").get(session) as WhatsAppAccount | undefined;
  return account ?? null;
}

export function getDefaultWhatsAppAccount(): WhatsAppAccount | null {
  const provider = getSetting("wa_provider")?.trim();
  if (provider === "waha") {
    const session = getSetting("waha_session_name")?.trim();
    if (session) return getWhatsAppAccountBySession(session);
  }
  return null;
}

function normalizeBaseUrl(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
