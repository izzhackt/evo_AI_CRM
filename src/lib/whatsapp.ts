import { db, getSetting, LEAD_STATUSES } from "./db";
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

export type LeadAgentSyncInput = {
  session: string;
  phone: string;
  name?: string | null;
  inboundText: string;
  inboundWaId: string;
  amoLeadId: number;
  amoContactId?: number | null;
  agentState: string;
  agentSummary?: string | null;
  agentHandoffReason?: string | null;
  draftReviewText?: string | null;
  draftReviewStatus?: string | null;
  draftReviewProvider?: string | null;
  draftReviewModel?: string | null;
  outboundText?: string | null;
  outboundWaId?: string | null;
};

export type LeadAgentSyncResult = {
  leadId: number;
  conversationId: number;
  insertedInbound: boolean;
  insertedOutbound: boolean;
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

// Входящее сообщение (из webhook): находим или создаём диалог, сохраняем сообщение.
export function receiveWhatsApp(phone: string, name: string | null, text: string, waId?: string, options: { accountId?: number | null } = {}) {
  const d = db();
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  if (waId) {
    const duplicate = d.prepare("SELECT conversation_id FROM wa_messages WHERE wa_id = ?").get(waId) as { conversation_id: number } | undefined;
    if (duplicate) return duplicate.conversation_id;
  }

  const accountId = options.accountId ?? null;
  const existing = accountId
    ? d.prepare("SELECT id FROM wa_conversations WHERE phone = ? AND wa_account_id = ?").get(normalizedPhone, accountId) as { id: number } | undefined
    : d.prepare("SELECT id FROM wa_conversations WHERE phone = ? AND wa_account_id IS NULL").get(normalizedPhone) as { id: number } | undefined;
  let convId: number | bigint;
  if (existing) {
    convId = existing.id;
    d.prepare("UPDATE wa_conversations SET last_message_at = datetime('now'), unread = unread + 1, name = COALESCE(name, ?) WHERE id = ?")
      .run(name, convId);
  } else {
    // новый контакт в WhatsApp автоматически становится лидом с источником WhatsApp
    const lead = d.prepare("INSERT INTO leads (name, phone, source, status) VALUES (?, ?, 'WhatsApp', ?)")
      .run(name ?? normalizedPhone, normalizedPhone, LEAD_STATUSES[0]);
    convId = d.prepare("INSERT INTO wa_conversations (wa_account_id, phone, name, lead_id, last_message_at, unread) VALUES (?, ?, ?, ?, datetime('now'), 1)")
      .run(accountId, normalizedPhone, name, lead.lastInsertRowid).lastInsertRowid;
  }
  d.prepare("INSERT INTO wa_messages (conversation_id, direction, text, status, wa_id) VALUES (?, 'in', ?, 'received', ?)")
    .run(convId, text, waId ?? null);
  return convId;
}

export function syncLeadAgentWhatsApp(input: LeadAgentSyncInput): LeadAgentSyncResult | null {
  const d = db();
  const normalizedPhone = normalizePhone(input.phone);
  const session = input.session.trim();
  const inboundText = input.inboundText.trim();
  const inboundWaId = input.inboundWaId.trim();
  const agentState = input.agentState.trim();
  if (!normalizedPhone || !session || !inboundText || !inboundWaId || !agentState) return null;

  const accountId = Number(
    getWhatsAppAccountBySession(session)?.id ??
      upsertWahaAccount({ name: session, sessionName: session }),
  );
  const leadId = upsertLeadAgentLead(d, {
    phone: normalizedPhone,
    name: input.name?.trim() || null,
    amoLeadId: input.amoLeadId,
    amoContactId: input.amoContactId ?? null,
    agentState,
    agentSummary: input.agentSummary?.trim() || null,
    agentHandoffReason: input.agentHandoffReason?.trim() || null,
    draftReviewText: input.draftReviewText?.trim() || null,
    draftReviewStatus: input.draftReviewStatus?.trim() || (input.draftReviewText?.trim() ? "generated" : null),
    draftReviewProvider: input.draftReviewProvider?.trim() || null,
    draftReviewModel: input.draftReviewModel?.trim() || null,
  });
  const conversationId = upsertLeadAgentConversation(d, {
    accountId,
    leadId,
    phone: normalizedPhone,
    name: input.name?.trim() || null,
    amoLeadId: input.amoLeadId,
    amoContactId: input.amoContactId ?? null,
    agentState,
    agentSummary: input.agentSummary?.trim() || null,
    agentHandoffReason: input.agentHandoffReason?.trim() || null,
    draftReviewText: input.draftReviewText?.trim() || null,
    draftReviewStatus: input.draftReviewStatus?.trim() || (input.draftReviewText?.trim() ? "generated" : null),
    draftReviewProvider: input.draftReviewProvider?.trim() || null,
    draftReviewModel: input.draftReviewModel?.trim() || null,
  });

  const inbound = d.prepare(`
    INSERT OR IGNORE INTO wa_messages (conversation_id, direction, text, status, wa_id)
    VALUES (?, 'in', ?, 'received', ?)
  `).run(conversationId, inboundText, inboundWaId);
  const outboundText = input.outboundText?.trim();
  let insertedOutbound = false;
  if (outboundText) {
    const outbound = d.prepare(`
      INSERT OR IGNORE INTO wa_messages (conversation_id, direction, text, status, wa_id)
      VALUES (?, 'out', ?, 'sent', ?)
    `).run(conversationId, outboundText, input.outboundWaId?.trim() || null);
    insertedOutbound = outbound.changes > 0;
  }

  d.prepare(`
    UPDATE wa_conversations
    SET last_message_at = datetime('now'), unread = unread + CASE WHEN ? THEN 1 ELSE 0 END
    WHERE id = ?
  `).run(inbound.changes > 0 ? 1 : 0, conversationId);

  return {
    leadId,
    conversationId,
    insertedInbound: inbound.changes > 0,
    insertedOutbound,
  };
}

function upsertLeadAgentLead(
  d: ReturnType<typeof db>,
  input: {
    phone: string;
    name: string | null;
    amoLeadId: number;
    amoContactId: number | null;
    agentState: string;
    agentSummary: string | null;
    agentHandoffReason: string | null;
    draftReviewText: string | null;
    draftReviewStatus: string | null;
    draftReviewProvider: string | null;
    draftReviewModel: string | null;
  },
): number {
  const existingByAmo = d.prepare("SELECT id FROM leads WHERE amo_lead_id = ?").get(input.amoLeadId) as
    | { id: number }
    | undefined;
  const existingByPhone = existingByAmo
    ? undefined
    : d.prepare("SELECT id FROM leads WHERE phone = ? ORDER BY id LIMIT 1").get(input.phone) as
        | { id: number }
        | undefined;
  const existing = existingByAmo ?? existingByPhone;
  if (existing) {
    d.prepare(`
      UPDATE leads
      SET name = COALESCE(?, name),
          phone = ?,
          source = COALESCE(source, 'WhatsApp'),
          amo_lead_id = COALESCE(?, amo_lead_id),
          amo_contact_id = COALESCE(?, amo_contact_id),
          agent_state = ?,
          agent_summary = ?,
          agent_handoff_reason = ?,
          agent_draft_review_text = ?,
          agent_draft_review_status = ?,
          agent_draft_review_provider = ?,
          agent_draft_review_model = ?,
          agent_last_synced_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      input.name,
      input.phone,
      input.amoLeadId,
      input.amoContactId,
      input.agentState,
      input.agentSummary,
      input.agentHandoffReason,
      input.draftReviewText,
      input.draftReviewStatus,
      input.draftReviewProvider,
      input.draftReviewModel,
      existing.id,
    );
    return existing.id;
  }

  return Number(d.prepare(`
    INSERT INTO leads (
      name, phone, source, status, amo_lead_id, amo_contact_id, agent_state,
      agent_summary, agent_handoff_reason, agent_draft_review_text,
      agent_draft_review_status, agent_draft_review_provider, agent_draft_review_model,
      agent_last_synced_at
    )
    VALUES (?, ?, 'WhatsApp', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    input.name ?? input.phone,
    input.phone,
    LEAD_STATUSES[0],
    input.amoLeadId,
    input.amoContactId,
    input.agentState,
    input.agentSummary,
    input.agentHandoffReason,
    input.draftReviewText,
    input.draftReviewStatus,
    input.draftReviewProvider,
    input.draftReviewModel,
  ).lastInsertRowid);
}

function upsertLeadAgentConversation(
  d: ReturnType<typeof db>,
  input: {
    accountId: number;
    leadId: number;
    phone: string;
    name: string | null;
    amoLeadId: number;
    amoContactId: number | null;
    agentState: string;
    agentSummary: string | null;
    agentHandoffReason: string | null;
    draftReviewText: string | null;
    draftReviewStatus: string | null;
    draftReviewProvider: string | null;
    draftReviewModel: string | null;
  },
): number {
  const existing = d.prepare(`
    SELECT id FROM wa_conversations WHERE phone = ? AND wa_account_id = ?
  `).get(input.phone, input.accountId) as { id: number } | undefined;
  if (existing) {
    d.prepare(`
      UPDATE wa_conversations
      SET name = COALESCE(name, ?),
          lead_id = ?,
          amo_lead_id = COALESCE(?, amo_lead_id),
          amo_contact_id = COALESCE(?, amo_contact_id),
          agent_state = ?,
          agent_summary = ?,
          agent_handoff_reason = ?,
          agent_draft_review_text = ?,
          agent_draft_review_status = ?,
          agent_draft_review_provider = ?,
          agent_draft_review_model = ?,
          agent_last_synced_at = datetime('now')
      WHERE id = ?
    `).run(
      input.name,
      input.leadId,
      input.amoLeadId,
      input.amoContactId,
      input.agentState,
      input.agentSummary,
      input.agentHandoffReason,
      input.draftReviewText,
      input.draftReviewStatus,
      input.draftReviewProvider,
      input.draftReviewModel,
      existing.id,
    );
    return existing.id;
  }

  return Number(d.prepare(`
    INSERT INTO wa_conversations (
      wa_account_id, phone, name, lead_id, amo_lead_id, amo_contact_id,
      agent_state, agent_summary, agent_handoff_reason, agent_draft_review_text,
      agent_draft_review_status, agent_draft_review_provider, agent_draft_review_model,
      agent_last_synced_at, last_message_at, unread
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 0)
  `).run(
    input.accountId,
    input.phone,
    input.name,
    input.leadId,
    input.amoLeadId,
    input.amoContactId,
    input.agentState,
    input.agentSummary,
    input.agentHandoffReason,
    input.draftReviewText,
    input.draftReviewStatus,
    input.draftReviewProvider,
    input.draftReviewModel,
  ).lastInsertRowid);
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

export function upsertWahaAccount(input: { name: string; sessionName: string; phone?: string | null; ownerUserId?: number | null }) {
  const d = db();
  const existing = getWhatsAppAccountBySession(input.sessionName);
  if (existing) {
    d.prepare(`
      UPDATE wa_accounts
      SET name = ?, phone = COALESCE(?, phone), status = CASE WHEN status = 'not_configured' THEN 'STOPPED' ELSE status END,
          owner_user_id = COALESCE(?, owner_user_id), is_default = 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(input.name, input.phone ?? null, input.ownerUserId ?? null, existing.id);
    return existing.id;
  }
  return d.prepare(`
    INSERT INTO wa_accounts (provider, name, session_name, phone, status, owner_user_id, is_default)
    VALUES ('waha', ?, ?, ?, 'STOPPED', ?, 1)
  `).run(input.name, input.sessionName, input.phone ?? null, input.ownerUserId ?? null).lastInsertRowid;
}

export function updateWahaAccountStatus(session: string, status: string, phone?: string | null) {
  const normalizedPhone = phone ? normalizePhone(phone) : null;
  db().prepare(`
    UPDATE wa_accounts
    SET status = ?, phone = COALESCE(?, phone), updated_at = datetime('now')
    WHERE provider = 'waha' AND session_name = ?
  `).run(status, normalizedPhone, session);
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
