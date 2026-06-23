"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  APP_STATUSES,
  DOC_STATUSES,
  LEAD_STATUSES,
  STAGES,
  db,
  getSetting,
  hashPassword,
  setSetting,
  verifyPassword,
} from "./db";
import { sendWhatsApp } from "./whatsapp";
import { setSession, clearSession, currentUser, isStaff } from "./auth";
import { LOCALES, Locale } from "./i18n";

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optNum(form: FormData, key: string): number | null {
  const v = str(form, key);
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

async function requireStaff() {
  const user = await currentUser();
  if (!user || !isStaff(user.role)) redirect("/login");
  return user;
}

async function requireAdmissionsStaff() {
  const user = await requireStaff();
  if (user.role === "finance") redirect("/dashboard");
  return user;
}

async function requireFinanceStaff() {
  const user = await requireStaff();
  if (user.role !== "admin" && user.role !== "finance") redirect("/dashboard");
  return user;
}

function revalidateStaffCrm(clientId?: number | null) {
  revalidatePath("/dashboard");
  revalidatePath("/sales");
  revalidatePath("/clients");
  revalidatePath("/applications");
  revalidatePath("/documents");
  revalidatePath("/tasks");
  revalidatePath("/finance");
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

// ---------- auth ----------

export async function loginAction(_prev: string | null, form: FormData): Promise<string | null> {
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  if (!email || !password) return "fillAllFields";

  const row = db()
    .prepare("SELECT id, password_hash, role FROM users WHERE lower(email) = ?")
    .get(email) as { id: number; password_hash: string; role: string } | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return "invalidCredentials";

  await setSession(row.id);
  redirect(row.role === "client" ? "/portal" : "/dashboard");
}

export async function registerAction(_prev: string | null, form: FormData): Promise<string | null> {
  const name = str(form, "name");
  const email = str(form, "email").toLowerCase();
  const phone = str(form, "phone");
  const password = str(form, "password");
  if (!name || !email || !password) return "fillAllFields";

  const d = db();
  const exists = d.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email);
  if (exists) return "emailTaken";

  const user = d
    .prepare("INSERT INTO users (email, phone, password_hash, name, role) VALUES (?, ?, ?, ?, 'client')")
    .run(email, phone || null, hashPassword(password), name);
  d.prepare("INSERT INTO clients (user_id, stage, source) VALUES (?, 'lead', 'Самостоятельная регистрация')")
    .run(user.lastInsertRowid);

  await setSession(Number(user.lastInsertRowid));
  redirect("/portal");
}

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}

export async function setLocaleAction(form: FormData) {
  const locale = str(form, "locale") as Locale;
  if (!(LOCALES as readonly string[]).includes(locale)) return;
  const store = await cookies();
  store.set("locale", locale, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}

// ---------- clients ----------

export async function createClientAction(form: FormData) {
  await requireStaff();
  const name = str(form, "name");
  const email = str(form, "email").toLowerCase();
  const phone = str(form, "phone");
  if (!name || !email) return;

  const d = db();
  if (d.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email)) return;

  const tempPassword = Math.random().toString(36).slice(2, 10);
  const user = d
    .prepare("INSERT INTO users (email, phone, password_hash, name, role) VALUES (?, ?, ?, ?, 'client')")
    .run(email, phone || null, hashPassword(tempPassword), name);
  const client = d
    .prepare("INSERT INTO clients (user_id, stage, source, target_country, target_degree) VALUES (?, 'lead', ?, ?, ?)")
    .run(user.lastInsertRowid, str(form, "source") || null, str(form, "target_country") || null, str(form, "target_degree") || null);

  revalidateStaffCrm(Number(client.lastInsertRowid));
  redirect(`/clients/${client.lastInsertRowid}`);
}

export async function updateClientAction(form: FormData) {
  await requireStaff();
  const id = optNum(form, "client_id");
  const stage = str(form, "stage");
  if (!id) return;
  if (!(STAGES as readonly string[]).includes(stage)) return;
  db()
    .prepare("UPDATE clients SET stage = ?, manager_id = ?, curator_id = ?, target_country = ?, target_degree = ?, notes = ? WHERE id = ?")
    .run(
      stage,
      optNum(form, "manager_id"),
      optNum(form, "curator_id"),
      str(form, "target_country") || null,
      str(form, "target_degree") || null,
      str(form, "notes") || null,
      id
    );
  revalidateStaffCrm(id);
  revalidatePath("/portal");
}

// ---------- applications ----------

export async function addApplicationAction(form: FormData) {
  await requireAdmissionsStaff();
  const clientId = optNum(form, "client_id");
  const university = str(form, "university");
  if (!clientId || !university) return;
  db()
    .prepare("INSERT INTO applications (client_id, university, country, program, degree, deadline) VALUES (?, ?, ?, ?, ?, ?)")
    .run(clientId, university, str(form, "country") || null, str(form, "program") || null, str(form, "degree") || null, str(form, "deadline") || null);
  revalidateStaffCrm(clientId);
}

export async function setApplicationStatusAction(form: FormData) {
  await requireAdmissionsStaff();
  const id = optNum(form, "id");
  const status = str(form, "status");
  if (!id || !(APP_STATUSES as readonly string[]).includes(status)) return;
  const d = db();
  const row = d.prepare("SELECT client_id FROM applications WHERE id = ?").get(id) as { client_id: number } | undefined;
  if (!row) return;
  d
    .prepare("UPDATE applications SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, id);
  revalidateStaffCrm(row.client_id);
  revalidatePath("/portal");
}

// ---------- documents ----------

export async function addDocumentAction(form: FormData) {
  await requireAdmissionsStaff();
  const clientId = optNum(form, "client_id");
  const name = str(form, "name");
  if (!clientId || !name) return;
  db().prepare("INSERT INTO documents (client_id, name) VALUES (?, ?)").run(clientId, name);
  revalidateStaffCrm(clientId);
}

export async function setDocumentStatusAction(form: FormData) {
  await requireAdmissionsStaff();
  const id = optNum(form, "id");
  const status = str(form, "status");
  if (!id || !(DOC_STATUSES as readonly string[]).includes(status)) return;
  const d = db();
  const row = d.prepare("SELECT client_id FROM documents WHERE id = ?").get(id) as { client_id: number } | undefined;
  if (!row) return;
  d
    .prepare("UPDATE documents SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, id);
  revalidateStaffCrm(row.client_id);
  revalidatePath("/portal");
}

// ---------- visa ----------

export async function upsertVisaCaseAction(form: FormData) {
  await requireStaff();
  const clientId = optNum(form, "client_id");
  if (!clientId) return;
  const d = db();
  const existing = d.prepare("SELECT id FROM visa_cases WHERE client_id = ?").get(clientId) as { id: number } | undefined;
  if (existing) {
    d.prepare("UPDATE visa_cases SET country = ?, status = ?, appointment_at = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(str(form, "country"), str(form, "status"), str(form, "appointment_at") || null, str(form, "notes") || null, existing.id);
  } else {
    d.prepare("INSERT INTO visa_cases (client_id, country, status, appointment_at, notes) VALUES (?, ?, ?, ?, ?)")
      .run(clientId, str(form, "country") || "—", str(form, "status") || "not_started", str(form, "appointment_at") || null, str(form, "notes") || null);
  }
  revalidateStaffCrm(clientId);
  revalidatePath("/portal");
}

// ---------- payments ----------

export async function addPaymentAction(form: FormData) {
  await requireFinanceStaff();
  const clientId = optNum(form, "client_id");
  const title = str(form, "title");
  const amount = parseFloat(str(form, "amount"));
  if (!clientId || !title || !Number.isFinite(amount)) return;
  db()
    .prepare("INSERT INTO payments (client_id, title, amount, currency, due_date) VALUES (?, ?, ?, ?, ?)")
    .run(clientId, title, amount, str(form, "currency") || "KGS", str(form, "due_date") || null);
  revalidateStaffCrm(clientId);
}

export async function markPaymentPaidAction(form: FormData) {
  await requireFinanceStaff();
  const id = optNum(form, "id");
  if (!id) return;
  const d = db();
  const row = d.prepare("SELECT client_id FROM payments WHERE id = ?").get(id) as { client_id: number } | undefined;
  if (!row) return;
  d
    .prepare("UPDATE payments SET status = 'paid', paid_at = date('now') WHERE id = ?")
    .run(id);
  revalidateStaffCrm(row.client_id);
  revalidatePath("/portal");
}

// ---------- tasks ----------

export async function addTaskAction(form: FormData) {
  const user = await requireStaff();
  const title = str(form, "title");
  const clientId = optNum(form, "client_id");
  if (!title) return;
  db()
    .prepare("INSERT INTO tasks (title, description, client_id, assignee_id, due_date, priority, status, created_by) VALUES (?, ?, ?, ?, ?, ?, 'todo', ?)")
    .run(
      title, str(form, "description") || null, clientId, optNum(form, "assignee_id"),
      str(form, "due_date") || null, str(form, "priority") || "normal", user.id
    );
  revalidateStaffCrm(clientId);
}

export async function completeTaskAction(form: FormData) {
  await requireStaff();
  const id = optNum(form, "id");
  if (!id) return;
  const d = db();
  const row = d.prepare("SELECT client_id FROM tasks WHERE id = ?").get(id) as { client_id: number | null } | undefined;
  if (!row) return;
  d.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(id);
  revalidateStaffCrm(row.client_id);
}

// ---------- sales / leads ----------

export async function addLeadAction(form: FormData) {
  const user = await requireStaff();
  const name = str(form, "name");
  if (!name) return;
  db()
    .prepare("INSERT INTO leads (name, phone, email, source, amount, currency, manager_id, target_country, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      name, str(form, "phone") || null, str(form, "email") || null, str(form, "source") || null,
      str(form, "amount") ? parseFloat(str(form, "amount")) : null, str(form, "currency") || "KGS",
      optNum(form, "manager_id") ?? user.id, str(form, "target_country") || null, str(form, "notes") || null
    );
  revalidatePath("/sales");
  revalidatePath("/dashboard");
}

export async function moveLeadAction(form: FormData) {
  const user = await requireStaff();
  const id = optNum(form, "id");
  const status = str(form, "status");
  if (!id || !(LEAD_STATUSES as readonly string[]).includes(status)) return;
  const d = db();
  d.prepare("UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  d.prepare("INSERT INTO lead_activities (lead_id, author_id, type, text) VALUES (?, ?, 'status', ?)")
    .run(id, user.id, status);
  revalidatePath("/sales");
  revalidatePath(`/sales/${id}`);
  revalidatePath("/dashboard");
}

export async function updateLeadAction(form: FormData) {
  await requireStaff();
  const id = optNum(form, "id");
  if (!id) return;
  db()
    .prepare("UPDATE leads SET name = ?, phone = ?, email = ?, source = ?, amount = ?, manager_id = ?, target_country = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
    .run(
      str(form, "name"), str(form, "phone") || null, str(form, "email") || null, str(form, "source") || null,
      str(form, "amount") ? parseFloat(str(form, "amount")) : null, optNum(form, "manager_id"),
      str(form, "target_country") || null, str(form, "notes") || null, id
    );
  revalidatePath(`/sales/${id}`);
  revalidatePath("/sales");
  revalidatePath("/dashboard");
}

export async function addLeadNoteAction(form: FormData) {
  const user = await requireStaff();
  const id = optNum(form, "lead_id");
  const text = str(form, "text");
  if (!id || !text) return;
  db().prepare("INSERT INTO lead_activities (lead_id, author_id, type, text) VALUES (?, ?, 'note', ?)")
    .run(id, user.id, text);
  revalidatePath(`/sales/${id}`);
}

export async function convertLeadAction(form: FormData) {
  await requireStaff();
  const id = optNum(form, "id");
  if (!id) return;
  const d = db();
  const lead = d.prepare("SELECT * FROM leads WHERE id = ?").get(id) as {
    id: number; name: string; phone: string | null; email: string | null;
    source: string | null; manager_id: number | null; target_country: string | null; client_id: number | null;
  } | undefined;
  if (!lead || lead.client_id) return;

  const email = lead.email || `lead${lead.id}@noemail.local`;
  let userId: number | bigint;
  const existing = d.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email.toLowerCase()) as { id: number } | undefined;
  if (existing) {
    userId = existing.id;
  } else {
    const tempPassword = Math.random().toString(36).slice(2, 10);
    userId = d
      .prepare("INSERT INTO users (email, phone, password_hash, name, role) VALUES (?, ?, ?, ?, 'client')")
      .run(email.toLowerCase(), lead.phone, hashPassword(tempPassword), lead.name).lastInsertRowid;
  }
  const clientRow = d
    .prepare("INSERT INTO clients (user_id, stage, manager_id, source, target_country) VALUES (?, 'contract', ?, ?, ?)")
    .run(userId, lead.manager_id, lead.source, lead.target_country);
  d.prepare("UPDATE leads SET status = 'won', client_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(clientRow.lastInsertRowid, id);

  revalidatePath("/sales");
  revalidateStaffCrm(Number(clientRow.lastInsertRowid));
  redirect(`/clients/${clientRow.lastInsertRowid}`);
}

// ---------- team chat ----------

export async function createChannelAction(form: FormData) {
  const user = await requireStaff();
  const name = str(form, "name").toLowerCase().replace(/[^a-zа-яё0-9_-]/gi, "-");
  if (!name) return;
  const d = db();
  if (d.prepare("SELECT id FROM channels WHERE name = ?").get(name)) return;
  const ch = d.prepare("INSERT INTO channels (name, description, created_by) VALUES (?, ?, ?)")
    .run(name, str(form, "description") || null, user.id);
  revalidatePath("/chat");
  redirect(`/chat/${ch.lastInsertRowid}`);
}

export async function sendChannelMessageAction(form: FormData) {
  const user = await requireStaff();
  const channelId = optNum(form, "channel_id");
  const text = str(form, "text");
  if (!channelId || !text) return;
  db().prepare("INSERT INTO channel_messages (channel_id, author_id, text) VALUES (?, ?, ?)")
    .run(channelId, user.id, text);
  revalidatePath(`/chat/${channelId}`);
}

// ---------- tasks (kanban) ----------

export async function moveTaskAction(form: FormData) {
  await requireStaff();
  const id = optNum(form, "id");
  const status = str(form, "status");
  if (!id || !["todo", "in_progress", "review", "done"].includes(status)) return;
  const d = db();
  const row = d.prepare("SELECT client_id FROM tasks WHERE id = ?").get(id) as { client_id: number | null } | undefined;
  if (!row) return;
  d.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, id);
  revalidateStaffCrm(row.client_id);
}

// ---------- whatsapp ----------

export async function sendWaMessageAction(form: FormData) {
  const user = await requireStaff();
  const conversationId = optNum(form, "conversation_id");
  const text = str(form, "text");
  if (!conversationId || !text) return;
  const d = db();
  const conv = d.prepare("SELECT * FROM wa_conversations WHERE id = ?").get(conversationId) as { phone: string } | undefined;
  if (!conv) return;

  const result = await sendWhatsApp(conv.phone, text);
  d.prepare("INSERT INTO wa_messages (conversation_id, direction, text, status, author_id, wa_id) VALUES (?, 'out', ?, ?, ?, ?)")
    .run(conversationId, text, result.status, user.id, result.waId ?? null);
  d.prepare("UPDATE wa_conversations SET last_message_at = datetime('now'), unread = 0 WHERE id = ?").run(conversationId);
  revalidatePath(`/whatsapp/${conversationId}`);
  revalidatePath("/whatsapp");
}

export async function createConversationAction(form: FormData) {
  await requireStaff();
  const phone = str(form, "phone");
  if (!phone) return;
  const d = db();
  const existing = d.prepare("SELECT id FROM wa_conversations WHERE phone = ?").get(phone) as { id: number } | undefined;
  const id = existing
    ? existing.id
    : d.prepare("INSERT INTO wa_conversations (phone, name, last_message_at) VALUES (?, ?, datetime('now'))")
        .run(phone, str(form, "name") || null).lastInsertRowid;
  revalidatePath("/whatsapp");
  redirect(`/whatsapp/${id}`);
}

export async function markConversationReadAction(form: FormData) {
  await requireStaff();
  const id = optNum(form, "id");
  if (!id) return;
  db().prepare("UPDATE wa_conversations SET unread = 0 WHERE id = ?").run(id);
  revalidatePath("/whatsapp");
}

// ---------- telephony ----------

export async function logCallAction(form: FormData) {
  const user = await requireStaff();
  const phone = str(form, "phone");
  if (!phone) return;
  db()
    .prepare("INSERT INTO calls (direction, phone, manager_id, lead_id, duration_sec, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(
      str(form, "direction") || "out", phone, user.id, optNum(form, "lead_id"),
      optNum(form, "duration_sec") ?? 0, str(form, "status") || "answered", str(form, "notes") || null
    );
  revalidatePath("/calls");
}

// ---------- settings ----------

export async function saveSettingsAction(form: FormData) {
  const user = await currentUser();
  if (!user || user.role !== "admin") redirect("/dashboard");
  const keys = [
    "wa_token", "wa_phone_id", "wa_verify_token",
    "tel_provider", "tel_api_key",
    "anthropic_api_key",
  ];
  for (const key of keys) {
    const value = str(form, key);
    if (form.has(key)) setSetting(key, value);
  }
  revalidatePath("/settings");
}

export async function getIntegrationStatus() {
  return {
    whatsapp: !!getSetting("wa_token") && !!getSetting("wa_phone_id"),
    telephony: !!getSetting("tel_api_key"),
    ai: !!getSetting("anthropic_api_key") || !!process.env.ANTHROPIC_API_KEY,
  };
}

// ---------- updates ----------

export async function postUpdateAction(form: FormData) {
  const user = await requireStaff();
  const clientId = optNum(form, "client_id");
  const message = str(form, "message");
  if (!clientId || !message) return;
  db()
    .prepare("INSERT INTO updates (client_id, author_id, message) VALUES (?, ?, ?)")
    .run(clientId, user.id, message);
  revalidateStaffCrm(clientId);
  revalidatePath("/portal");
}
