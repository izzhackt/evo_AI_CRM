"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  APP_STATUSES,
  DOC_STATUSES,
  LEAD_STATUSES,
  STAGES,
  TASK_COLUMNS,
  TASK_PRIORITIES,
  VISA_STATUSES,
  db,
  getSetting,
  hashPassword,
  setSetting,
  verifyPassword,
} from "./db";
import { getDefaultWhatsAppAccount, sendWhatsApp, upsertWahaAccount } from "./whatsapp";
import { createAmoCrmAdapter, getAmoCrmLocalStatus, normalizeAmoCrmAccountBaseUrl } from "./amocrm";
import { setSession, clearSession, currentUser, isStaff } from "./auth";
import { ROLE_HOME_ROUTE, isRole } from "./domain";
import { LOCALES, type Locale } from "./i18n-data";
import { normalizePhone } from "./phone";
import {
  canAssignCurator,
  canTransitionStudentCase,
  isStudentCaseState,
  nextCaseStateForAssignment,
  normalizeStudentCaseReason,
  workflowOwnerForState,
  type StudentCaseState,
} from "./student-case-policy";

const CURRENCIES = ["KGS", "USD", "EUR"] as const;

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optNum(form: FormData, key: string): number | null {
  const v = str(form, key);
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function normalizeUrl(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function requireStaff() {
  const user = await currentUser();
  if (!user || !isStaff(user.role)) redirect("/login");
  return user;
}

async function requireAdminStaff() {
  const user = await requireStaff();
  if (!canAssignCurator(user.role)) redirect("/dashboard");
  return user;
}

async function requireAdmissionsStaff() {
  const user = await requireStaff();
  if (user.role === "finance") redirect("/dashboard");
  return user;
}

async function requireSalesStaff() {
  const user = await requireStaff();
  if (user.role !== "admin" && user.role !== "sales") redirect("/dashboard");
  return user;
}

async function requireWhatsAppStaff() {
  const user = await requireStaff();
  if (user.role !== "admin" && user.role !== "sales" && user.role !== "curator") redirect("/dashboard");
  return user;
}

async function requireFinanceStaff() {
  const user = await requireStaff();
  if (user.role !== "admin" && user.role !== "finance") redirect("/dashboard");
  return user;
}

async function requireVisaOperationsStaff() {
  const user = await requireStaff();
  if (user.role !== "admin" && user.role !== "curator") {
    redirect(ROLE_HOME_ROUTE[user.role]);
  }
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

function revalidateLeadTask(leadId?: number | null) {
  if (leadId) revalidatePath(`/sales/${leadId}`);
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
  if (!isRole(row.role)) return "roleMigrationRequired";

  await setSession(row.id);
  redirect(ROLE_HOME_ROUTE[row.role]);
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
  if (stage === "archived" || !(STAGES as readonly string[]).includes(stage)) return;
  db()
    .prepare("UPDATE clients SET stage = ?, target_country = ?, target_degree = ?, notes = ? WHERE id = ?")
    .run(
      stage,
      str(form, "target_country") || null,
      str(form, "target_degree") || null,
      str(form, "notes") || null,
      id
    );
  revalidateStaffCrm(id);
  revalidatePath("/portal");
}

type StudentCaseMutationRow = {
  id: number;
  curator_id: number | null;
  case_state: string;
  contract_confirmed_at: string | null;
  contract_confirmation_ref: string | null;
  portal_activated_at: string | null;
  handoff_at: string | null;
};

function revalidateStudentCase(clientId: number) {
  revalidateStaffCrm(clientId);
  revalidatePath("/portal");
}

export async function assignCuratorAction(form: FormData) {
  const actor = await requireAdminStaff();
  const clientId = optNum(form, "client_id");
  const curatorId = optNum(form, "curator_id");
  const reason = normalizeStudentCaseReason(form.get("reason"));
  if (!clientId || !curatorId || !reason) return;

  const d = db();
  const changed = d.transaction(() => {
    const current = d.prepare(`
      SELECT id, curator_id, case_state, contract_confirmed_at,
             contract_confirmation_ref, portal_activated_at, handoff_at
      FROM clients
      WHERE id = ?
    `).get(clientId) as StudentCaseMutationRow | undefined;
    const target = d.prepare("SELECT role FROM users WHERE id = ?").get(curatorId) as
      | { role: string }
      | undefined;
    if (
      !current
      || target?.role !== "curator"
      || current.curator_id === curatorId
      || !isStudentCaseState(current.case_state)
    ) {
      return false;
    }

    const afterState = nextCaseStateForAssignment({
      caseState: current.case_state,
      contractConfirmedAt: current.contract_confirmed_at,
      contractConfirmationRef: current.contract_confirmation_ref,
    });
    if (!afterState) return false;

    const occurredAt = new Date().toISOString();
    const portalActivatedAt = current.portal_activated_at ?? occurredAt;
    const handoffAt = current.handoff_at ?? occurredAt;
    d.prepare(`
      UPDATE clients
      SET curator_id = ?,
          case_state = ?,
          portal_activated_at = ?,
          handoff_at = ?
      WHERE id = ?
    `).run(curatorId, afterState, portalActivatedAt, handoffAt, clientId);
    d.prepare(`
      INSERT INTO student_case_audit (
        client_id, actor_user_id, event_type, reason,
        before_curator_id, after_curator_id,
        before_case_state, after_case_state,
        before_workflow_owner, after_workflow_owner,
        occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      clientId,
      actor.id,
      current.curator_id == null ? "assigned" : "reassigned",
      reason,
      current.curator_id,
      curatorId,
      current.case_state,
      afterState,
      workflowOwnerForState(current.case_state),
      workflowOwnerForState(afterState),
      occurredAt,
    );
    return true;
  }).immediate();

  if (changed) revalidateStudentCase(clientId);
}

async function transitionStudentCase(
  form: FormData,
  expectedState: StudentCaseState,
  afterState: StudentCaseState,
  eventType: "closed" | "reopened",
) {
  const actor = await requireStaff();
  const clientId = optNum(form, "client_id");
  const reason = normalizeStudentCaseReason(form.get("reason"));
  if (!clientId || !reason) return;

  const d = db();
  const changed = d.transaction(() => {
    const current = d.prepare(`
      SELECT id, curator_id, case_state, contract_confirmed_at,
             contract_confirmation_ref, portal_activated_at, handoff_at
      FROM clients
      WHERE id = ?
    `).get(clientId) as StudentCaseMutationRow | undefined;
    if (
      !current
      || !isStudentCaseState(current.case_state)
      || current.case_state !== expectedState
      || !canTransitionStudentCase(
        actor,
        { curatorId: current.curator_id },
      )
    ) {
      return false;
    }

    const occurredAt = new Date().toISOString();
    d.prepare(`
      UPDATE clients
      SET case_state = ?,
          closed_at = ?
      WHERE id = ?
    `).run(afterState, afterState === "closed" ? occurredAt : null, clientId);
    d.prepare(`
      INSERT INTO student_case_audit (
        client_id, actor_user_id, event_type, reason,
        before_curator_id, after_curator_id,
        before_case_state, after_case_state,
        before_workflow_owner, after_workflow_owner,
        occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      clientId,
      actor.id,
      eventType,
      reason,
      current.curator_id,
      current.curator_id,
      current.case_state,
      afterState,
      workflowOwnerForState(current.case_state),
      workflowOwnerForState(afterState),
      occurredAt,
    );
    return true;
  }).immediate();

  if (changed) revalidateStudentCase(clientId);
}

export async function closeStudentCaseAction(form: FormData) {
  await transitionStudentCase(form, "active", "closed", "closed");
}

export async function reopenStudentCaseAction(form: FormData) {
  await transitionStudentCase(form, "closed", "active", "reopened");
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
  await requireVisaOperationsStaff();
  const clientId = optNum(form, "client_id");
  if (!clientId) return;
  const status = str(form, "status");
  if (!(VISA_STATUSES as readonly string[]).includes(status)) return;
  const d = db();
  const existing = d.prepare("SELECT id FROM visa_cases WHERE client_id = ?").get(clientId) as { id: number } | undefined;
  if (existing) {
    d.prepare("UPDATE visa_cases SET country = ?, status = ?, appointment_at = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(str(form, "country") || "—", status, str(form, "appointment_at") || null, str(form, "notes") || null, existing.id);
  } else {
    d.prepare("INSERT INTO visa_cases (client_id, country, status, appointment_at, notes) VALUES (?, ?, ?, ?, ?)")
      .run(clientId, str(form, "country") || "—", status, str(form, "appointment_at") || null, str(form, "notes") || null);
  }
  revalidateStaffCrm(clientId);
  revalidatePath("/visa");
  if (existing) revalidatePath(`/visa/${existing.id}`);
  revalidatePath("/portal");
}

// ---------- payments ----------

export async function addPaymentAction(form: FormData) {
  await requireFinanceStaff();
  const clientId = optNum(form, "client_id");
  const title = str(form, "title");
  const amount = parseFloat(str(form, "amount"));
  const currency = str(form, "currency") || "KGS";
  if (!clientId || !title || !Number.isFinite(amount) || amount <= 0) return;
  if (!(CURRENCIES as readonly string[]).includes(currency)) return;
  db()
    .prepare("INSERT INTO payments (client_id, title, amount, currency, due_date) VALUES (?, ?, ?, ?, ?)")
    .run(clientId, title, amount, currency, str(form, "due_date") || null);
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
  const leadId = optNum(form, "lead_id");
  const priority = str(form, "priority") || "normal";
  if (!title) return;
  if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) return;
  db()
    .prepare("INSERT INTO tasks (title, description, lead_id, client_id, assignee_id, due_date, priority, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?)")
    .run(
      title, str(form, "description") || null, leadId, clientId, optNum(form, "assignee_id"),
      str(form, "due_date") || null, priority, user.id
    );
  revalidateStaffCrm(clientId);
  revalidateLeadTask(leadId);
}

export async function completeTaskAction(form: FormData) {
  await requireStaff();
  const id = optNum(form, "id");
  if (!id) return;
  const d = db();
  const row = d.prepare("SELECT client_id, lead_id FROM tasks WHERE id = ?").get(id) as { client_id: number | null; lead_id: number | null } | undefined;
  if (!row) return;
  d.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(id);
  revalidateStaffCrm(row.client_id);
  revalidateLeadTask(row.lead_id);
}

// ---------- sales / leads ----------

export async function addLeadAction(form: FormData) {
  const user = await requireSalesStaff();
  const name = str(form, "name");
  if (!name) return;
  db()
    .prepare("INSERT INTO leads (name, phone, email, source, amount, currency, manager_id, target_country, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      name, normalizePhone(str(form, "phone")) || null, str(form, "email") || null, str(form, "source") || null,
      str(form, "amount") ? parseFloat(str(form, "amount")) : null, str(form, "currency") || "KGS",
      optNum(form, "manager_id") ?? user.id, str(form, "target_country") || null, str(form, "notes") || null,
      LEAD_STATUSES[0]
  );
  revalidatePath("/sales");
  revalidatePath("/dashboard");
  redirect("/sales");
}

export async function moveLeadAction(form: FormData) {
  const user = await requireSalesStaff();
  const id = optNum(form, "id");
  const status = str(form, "status");
  if (
    !id
    || status === "contract_signed"
    || !(LEAD_STATUSES as readonly string[]).includes(status)
  ) {
    return;
  }
  const d = db();
  d.prepare("UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  d.prepare("INSERT INTO lead_activities (lead_id, author_id, type, text) VALUES (?, ?, 'status', ?)")
    .run(id, user.id, status);
  revalidatePath("/sales");
  revalidatePath(`/sales/${id}`);
  revalidatePath("/dashboard");
}

export async function updateLeadAction(form: FormData) {
  await requireSalesStaff();
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
  const user = await requireSalesStaff();
  const id = optNum(form, "lead_id");
  const text = str(form, "text");
  if (!id || !text) return;
  db().prepare("INSERT INTO lead_activities (lead_id, author_id, type, text) VALUES (?, ?, 'note', ?)")
    .run(id, user.id, text);
  revalidatePath(`/sales/${id}`);
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
  if (!id || !(TASK_COLUMNS as readonly string[]).includes(status)) return;
  const d = db();
  const row = d.prepare("SELECT client_id, lead_id FROM tasks WHERE id = ?").get(id) as { client_id: number | null; lead_id: number | null } | undefined;
  if (!row) return;
  d.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, id);
  revalidateStaffCrm(row.client_id);
  revalidateLeadTask(row.lead_id);
}

// ---------- whatsapp ----------

export async function sendWaMessageAction(form: FormData) {
  const user = await requireWhatsAppStaff();
  const conversationId = optNum(form, "conversation_id");
  const text = str(form, "text");
  if (!conversationId || !text) return;
  const d = db();
  const conv = d.prepare("SELECT * FROM wa_conversations WHERE id = ?").get(conversationId) as { phone: string; wa_account_id: number | null } | undefined;
  if (!conv) return;

  const result = await sendWhatsApp(conv.phone, text, conv.wa_account_id);
  d.prepare("INSERT INTO wa_messages (conversation_id, direction, text, status, author_id, wa_id) VALUES (?, 'out', ?, ?, ?, ?)")
    .run(conversationId, text, result.status, user.id, result.waId ?? null);
  d.prepare("UPDATE wa_conversations SET last_message_at = datetime('now'), unread = 0 WHERE id = ?").run(conversationId);
  revalidatePath(`/whatsapp/${conversationId}`);
  revalidatePath("/whatsapp");
}

export async function createConversationAction(form: FormData) {
  await requireWhatsAppStaff();
  const phone = normalizePhone(str(form, "phone"));
  if (!phone) return;
  const d = db();
  const accountId = getDefaultWhatsAppAccount()?.id ?? null;
  const existing = accountId
    ? d.prepare("SELECT id FROM wa_conversations WHERE phone = ? AND wa_account_id = ?").get(phone, accountId) as { id: number } | undefined
    : d.prepare("SELECT id FROM wa_conversations WHERE phone = ? AND wa_account_id IS NULL").get(phone) as { id: number } | undefined;
  const id = existing
    ? existing.id
    : d.prepare("INSERT INTO wa_conversations (wa_account_id, phone, name, last_message_at) VALUES (?, ?, ?, datetime('now'))")
        .run(accountId, phone, str(form, "name") || null).lastInsertRowid;
  revalidatePath("/whatsapp");
  redirect(`/whatsapp/${id}`);
}

export async function markConversationReadAction(form: FormData) {
  await requireWhatsAppStaff();
  const id = optNum(form, "id");
  if (!id) return;
  db().prepare("UPDATE wa_conversations SET unread = 0 WHERE id = ?").run(id);
  revalidatePath("/whatsapp");
}

export async function startWahaSessionAction() {
  const user = await currentUser();
  if (!user || user.role !== "admin") redirect("/dashboard");

  const baseUrl = normalizeUrl(getSetting("waha_base_url"));
  const apiKey = getSetting("waha_api_key")?.trim();
  const sessionName = getSetting("waha_session_name")?.trim();
  const webhookSecret = getSetting("waha_webhook_secret")?.trim();
  const webhookUrl = getSetting("waha_webhook_url")?.trim();
  if (!baseUrl || !apiKey || !sessionName || !webhookSecret || !webhookUrl) {
    setSetting("waha_last_error", "not_configured");
    revalidatePath("/settings");
    return;
  }

  const sessionConfig = {
    name: sessionName,
    config: {
      webhooks: [
        {
          url: webhookUrl,
          events: ["message", "session.status"],
          hmac: { key: webhookSecret },
          retries: { policy: "constant", delaySeconds: 2, attempts: 15 },
        },
      ],
    },
  };

  try {
    const res = await fetch(`${baseUrl}/api/sessions/start`, {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionConfig),
    });
    const text = await res.text();
    const shouldRestart = res.status === 422 && text.toLowerCase().includes("already started");
    const restartRes = shouldRestart
      ? await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionName)}/restart`, {
          method: "POST",
          headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
        })
      : null;

    if (res.ok || restartRes?.ok) {
      upsertWahaAccount({
        name: getSetting("waha_account_name") || sessionName,
        sessionName,
        ownerUserId: user.id,
      });
      setSetting("waha_last_error", "");
    } else {
      setSetting("waha_last_error", `provider_${restartRes?.status ?? res.status}`);
    }
  } catch {
    setSetting("waha_last_error", "provider_unreachable");
  }
  revalidatePath("/settings");
}

// ---------- telephony ----------

export async function logCallAction(form: FormData) {
  const user = await requireSalesStaff();
  const phone = normalizePhone(str(form, "phone"));
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
  const keys = ["wa_phone_id", "tel_provider", "wa_provider", "waha_account_name", "waha_base_url", "waha_session_name", "waha_webhook_url"];
  for (const key of keys) {
    const value = str(form, key);
    if (form.has(key)) setSetting(key, value);
  }
  const secretKeys = [
    "wa_token",
    "wa_verify_token",
    "wa_app_secret",
    "waha_api_key",
    "waha_webhook_secret",
    "lead_agent_sync_secret",
    "tel_api_key",
    "anthropic_api_key",
  ];
  for (const key of secretKeys) {
    if (form.has(key)) setPreservedSecret(key, str(form, key));
  }

  if (form.has("wa_provider") && str(form, "wa_provider") === "waha" && str(form, "waha_session_name")) {
    upsertWahaAccount({
      name: str(form, "waha_account_name") || str(form, "waha_session_name"),
      sessionName: str(form, "waha_session_name"),
      ownerUserId: user.id,
    });
  }

  if (form.has("amocrm_account_base_url")) {
    const rawBaseUrl = str(form, "amocrm_account_base_url");
    const normalizedBaseUrl = normalizeAmoCrmAccountBaseUrl(rawBaseUrl);
    if (rawBaseUrl && !normalizedBaseUrl) {
      setSetting("amocrm_last_error", "invalid_account_domain");
      revalidatePath("/settings");
      return;
    }
    setSetting("amocrm_account_base_url", normalizedBaseUrl ?? "");
    setSetting("amocrm_client_id", str(form, "amocrm_client_id"));
    setPreservedSecret("amocrm_client_secret", str(form, "amocrm_client_secret"));
    setSetting("amocrm_redirect_uri", str(form, "amocrm_redirect_uri"));
    setPreservedSecret("amocrm_refresh_token", str(form, "amocrm_refresh_token"));
    setPositiveIntegerSetting("amocrm_pipeline_id", str(form, "amocrm_pipeline_id"));
    setPositiveIntegerSetting("amocrm_status_id", str(form, "amocrm_status_id"));
    setPositiveIntegerSetting("amocrm_responsible_user_id", str(form, "amocrm_responsible_user_id"));
    setPositiveIntegerSetting("amocrm_target_country_field_id", str(form, "amocrm_target_country_field_id"));
    setPositiveIntegerSetting("amocrm_source_field_id", str(form, "amocrm_source_field_id"));
    setSetting("amocrm_last_error", "");
    setSetting("amocrm_last_check", "");
  }

  revalidatePath("/settings");
}

export async function getIntegrationStatus() {
  const telephonyProvider = getSetting("tel_provider")?.trim();
  const telephonyApiKey = getSetting("tel_api_key")?.trim();
  const whatsappProvider = getSetting("wa_provider")?.trim() || "meta";
  const metaConfigured = !!getSetting("wa_token") && !!getSetting("wa_phone_id");
  const wahaConfigured = whatsappProvider === "waha" &&
    !!getSetting("waha_base_url") &&
    !!getSetting("waha_api_key") &&
    !!getSetting("waha_session_name") &&
    !!getSetting("waha_webhook_secret") &&
    !!getSetting("waha_webhook_url");
  const wahaLastError = getSetting("waha_last_error")?.trim();
  const whatsappState: "not_configured" | "configured" | "blocked" =
    whatsappProvider === "waha"
      ? !wahaConfigured
        ? "not_configured"
        : wahaLastError
          ? "blocked"
          : "configured"
      : metaConfigured
        ? "configured"
        : "not_configured";
  return {
    whatsapp: whatsappState === "configured",
    whatsappState,
    telephony: !!telephonyProvider && !!telephonyApiKey,
    ai: !!getSetting("anthropic_api_key") || !!process.env.ANTHROPIC_API_KEY,
    amocrm: getAmoCrmLocalStatus(),
  };
}

export async function checkAmoCrmAction() {
  const user = await currentUser();
  if (!user || user.role !== "admin") redirect("/dashboard");
  const status = await createAmoCrmAdapter().getConnectionState();
  if (status.status === "not_configured") {
    setSetting("amocrm_last_check", `not_configured:${status.missing.join(",")}`);
  } else if (status.status === "blocked") {
    setSetting("amocrm_last_check", `blocked:${status.reason}`);
  } else {
    setSetting("amocrm_last_check", `configured:${status.accountBaseUrl}`);
  }
  revalidatePath("/settings");
  redirect("/settings?amocrm_check=1");
}

function setPreservedSecret(key: string, value: string) {
  if (value || !getSetting(key)) setSetting(key, value);
}

function setPositiveIntegerSetting(key: string, value: string) {
  if (!value) {
    setSetting(key, "");
    return;
  }
  const parsed = Number.parseInt(value, 10);
  setSetting(key, Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : "");
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
