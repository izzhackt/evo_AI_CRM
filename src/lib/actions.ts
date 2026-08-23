"use server";

import { notFound, redirect } from "next/navigation";
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
import { getDefaultWhatsAppAccount, sendWhatsApp } from "./whatsapp";
import { createAmoCrmAdapter, getAmoCrmLocalStatus, normalizeAmoCrmAccountBaseUrl } from "./amocrm";
import { setSession, clearSession, currentUser, isStaff, type SessionUser } from "./auth";
import { resolvePlatformActor } from "./platform-auth";
import { platformHomeRoute } from "./platform-guards";
import { isUiContractFixtureMode } from "./runtime-mode";
import {
  clearSupabaseAuthCookies,
  createSupabaseServerContext,
} from "./supabase/server";
import {
  canClientCapability,
  canMutateClientlessTask,
  canReceiveClientlessTask,
  canReceiveClientTask,
  resolveClientAccess,
  type AccessActor,
  type ClientAccessSubject,
  type ClientCapability,
} from "./access";
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
import {
  canCreateManualWhatsAppConversation,
} from "./whatsapp-policy";
import { getConversationForActor } from "./queries";

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

function validatedLocalSalesManagerId(managerId: number | null): number | null {
  if (managerId === null) return null;
  const manager = db()
    .prepare("SELECT id FROM users WHERE id = ? AND role = 'sales'")
    .get(managerId) as { id: number } | undefined;
  if (!manager) notFound();
  return manager.id;
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

function assertClientCapability(
  actor: SessionUser,
  clientId: number,
  capability: ClientCapability,
): ClientAccessSubject {
  const row = db()
    .prepare(`
      SELECT id, manager_id, curator_id, case_state, handoff_at
      FROM clients
      WHERE id = ?
    `)
    .get(clientId) as
      | {
          id: number;
          manager_id: number | null;
          curator_id: number | null;
          case_state: string;
          handoff_at: string | null;
        }
      | undefined;

  if (!row || !isStudentCaseState(row.case_state)) {
    notFound();
  }

  const subject: ClientAccessSubject = {
    ...row,
    case_state: row.case_state,
  };
  if (!canClientCapability(resolveClientAccess(actor, subject), capability)) {
    notFound();
  }
  return subject;
}

function assertTaskMutationCapability(
  actor: SessionUser,
  task: {
    client_id: number | null;
    assignee_id: number | null;
  },
) {
  if (task.client_id) {
    assertClientCapability(actor, task.client_id, "write_tasks");
    return;
  }
  if (!canMutateClientlessTask(actor, task.assignee_id)) notFound();
}

function assertStaffTaskAssignee(assigneeId: number | null): AccessActor | null {
  if (!assigneeId) return null;
  const assignee = db()
    .prepare("SELECT id, role FROM users WHERE id = ?")
    .get(assigneeId) as AccessActor | undefined;
  if (!assignee || !isRole(assignee.role) || !isStaff(assignee.role)) notFound();
  return assignee;
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

type PlatformAuthClient = Awaited<
  ReturnType<typeof createSupabaseServerContext>
>["client"];

async function clearPlatformAuthSession(
  client?: PlatformAuthClient,
): Promise<void> {
  try {
    if (client) await client.auth.signOut({ scope: "local" });
  } finally {
    await clearSupabaseAuthCookies();
    await clearSession();
  }
}

export async function loginAction(_prev: string | null, form: FormData): Promise<string | null> {
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  if (!email || !password) return "fillAllFields";

  if (isUiContractFixtureMode()) {
    const row = db()
      .prepare("SELECT id, password_hash, role FROM users WHERE lower(email) = ?")
      .get(email) as { id: number; password_hash: string; role: string } | undefined;
    if (!row || !verifyPassword(password, row.password_hash)) return "invalidCredentials";
    if (!isRole(row.role)) return "roleMigrationRequired";

    await setSession(row.id);
    redirect(ROLE_HOME_ROUTE[row.role]);
  }

  let context: Awaited<ReturnType<typeof createSupabaseServerContext>>;
  let accessToken: string;
  try {
    context = await createSupabaseServerContext();
    const { data, error } = await context.client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return "invalidCredentials";
    if (!data.session?.access_token) {
      await clearPlatformAuthSession(context.client);
      return "platformUnavailable";
    }
    accessToken = data.session.access_token;
  } catch {
    return "platformUnavailable";
  }

  const result = await resolvePlatformActor(context.client, true, accessToken);
  if (result.status !== "authenticated") {
    const rejectionError =
      result.status === "invalid" &&
      result.reason === "authority_lookup_failed"
        ? "platformUnavailable"
        : "accessNotProvisioned";
    console.warn(JSON.stringify({
      event: "platform_login_authority_rejected",
      code:
        result.status === "invalid"
          ? result.reason
          : "authority_not_authenticated",
      service: "evo-crm",
    }));
    await clearPlatformAuthSession(context.client);
    return rejectionError;
  }

  await clearSession();
  redirect(platformHomeRoute(result.actor.platformRole));
}

export async function registerAction(_prev: string | null, form: FormData): Promise<string | null> {
  if (!isUiContractFixtureMode()) return "invitationRequired";

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
  if (!isUiContractFixtureMode()) {
    let client: PlatformAuthClient | undefined;
    try {
      ({ client } = await createSupabaseServerContext());
    } catch {
      // The local cookie fallback below does not depend on provider access.
    }
    await clearPlatformAuthSession(client);
  } else {
    await clearSession();
  }
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
  const actor = await requireStaff();
  if (actor.role !== "admin" && actor.role !== "sales") notFound();
  const name = str(form, "name");
  const email = str(form, "email").toLowerCase();
  const phone = str(form, "phone");
  if (!name || !email) return;

  const d = db();
  const managerId = actor.role === "sales" ? actor.id : optNum(form, "manager_id");
  if (!managerId) return;

  const createClient = d.transaction(() => {
    const manager = d
      .prepare("SELECT id FROM users WHERE id = ? AND role = 'sales'")
      .get(managerId) as { id: number } | undefined;
    if (!manager) notFound();
    if (d.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email)) return null;

    const tempPassword = Math.random().toString(36).slice(2, 10);
    const user = d
      .prepare("INSERT INTO users (email, phone, password_hash, name, role) VALUES (?, ?, ?, ?, 'client')")
      .run(email, phone || null, hashPassword(tempPassword), name);
    const client = d
      .prepare(`
        INSERT INTO clients (
          user_id,
          stage,
          manager_id,
          source,
          target_country,
          target_degree
        ) VALUES (?, 'lead', ?, ?, ?, ?)
      `)
      .run(
        user.lastInsertRowid,
        managerId,
        str(form, "source") || null,
        str(form, "target_country") || null,
        str(form, "target_degree") || null,
      );
    return Number(client.lastInsertRowid);
  });
  const clientId = createClient();
  if (!clientId) return;

  revalidateStaffCrm(clientId);
  redirect(`/clients/${clientId}`);
}

export async function updateClientAction(form: FormData) {
  const actor = await requireStaff();
  const id = optNum(form, "client_id");
  const stage = str(form, "stage");
  if (!id) return;
  if (stage === "archived" || !(STAGES as readonly string[]).includes(stage)) return;
  assertClientCapability(actor, id, "write_profile");
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
  const actor = await requireAdmissionsStaff();
  const clientId = optNum(form, "client_id");
  const university = str(form, "university");
  if (!clientId || !university) return;
  assertClientCapability(actor, clientId, "write_applications");
  db()
    .prepare("INSERT INTO applications (client_id, university, country, program, degree, deadline) VALUES (?, ?, ?, ?, ?, ?)")
    .run(clientId, university, str(form, "country") || null, str(form, "program") || null, str(form, "degree") || null, str(form, "deadline") || null);
  revalidateStaffCrm(clientId);
}

export async function setApplicationStatusAction(form: FormData) {
  const actor = await requireAdmissionsStaff();
  const id = optNum(form, "id");
  const status = str(form, "status");
  if (!id || !(APP_STATUSES as readonly string[]).includes(status)) return;
  const d = db();
  const row = d.prepare("SELECT client_id FROM applications WHERE id = ?").get(id) as { client_id: number } | undefined;
  if (!row) notFound();
  assertClientCapability(actor, row.client_id, "write_applications");
  d
    .prepare("UPDATE applications SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, id);
  revalidateStaffCrm(row.client_id);
  revalidatePath("/portal");
}

// ---------- documents ----------

export async function addDocumentAction(form: FormData) {
  const actor = await requireAdmissionsStaff();
  const clientId = optNum(form, "client_id");
  const name = str(form, "name");
  if (!clientId || !name) return;
  assertClientCapability(actor, clientId, "write_documents");
  db().prepare("INSERT INTO documents (client_id, name) VALUES (?, ?)").run(clientId, name);
  revalidateStaffCrm(clientId);
}

export async function setDocumentStatusAction(form: FormData) {
  const actor = await requireAdmissionsStaff();
  const id = optNum(form, "id");
  const status = str(form, "status");
  if (!id || !(DOC_STATUSES as readonly string[]).includes(status)) return;
  const d = db();
  const row = d.prepare("SELECT client_id FROM documents WHERE id = ?").get(id) as { client_id: number } | undefined;
  if (!row) notFound();
  assertClientCapability(actor, row.client_id, "write_documents");
  d
    .prepare("UPDATE documents SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, id);
  revalidateStaffCrm(row.client_id);
  revalidatePath("/portal");
}

// ---------- visa ----------

export async function upsertVisaCaseAction(form: FormData) {
  const actor = await requireVisaOperationsStaff();
  const clientId = optNum(form, "client_id");
  if (!clientId) return;
  const status = str(form, "status");
  if (!(VISA_STATUSES as readonly string[]).includes(status)) return;
  assertClientCapability(actor, clientId, "write_visa");
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
  const actor = await requireFinanceStaff();
  const clientId = optNum(form, "client_id");
  const title = str(form, "title");
  const amount = parseFloat(str(form, "amount"));
  const currency = str(form, "currency") || "KGS";
  if (!clientId || !title || !Number.isFinite(amount) || amount <= 0) return;
  if (!(CURRENCIES as readonly string[]).includes(currency)) return;
  assertClientCapability(actor, clientId, "write_finance");
  db()
    .prepare("INSERT INTO payments (client_id, title, amount, currency, due_date) VALUES (?, ?, ?, ?, ?)")
    .run(clientId, title, amount, currency, str(form, "due_date") || null);
  revalidateStaffCrm(clientId);
}

export async function markPaymentPaidAction(form: FormData) {
  const actor = await requireFinanceStaff();
  const id = optNum(form, "id");
  if (!id) return;
  const d = db();
  const row = d.prepare("SELECT client_id FROM payments WHERE id = ?").get(id) as { client_id: number } | undefined;
  if (!row) notFound();
  assertClientCapability(actor, row.client_id, "write_finance");
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
  const assigneeId = optNum(form, "assignee_id");
  const priority = str(form, "priority") || "normal";
  if (!title) return;
  if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) return;
  const assignee = assertStaffTaskAssignee(assigneeId);
  if (clientId) {
    const client = assertClientCapability(user, clientId, "write_tasks");
    if (assignee && !canReceiveClientTask(assignee, client)) notFound();
  } else {
    if (assignee && !canReceiveClientlessTask(assignee)) notFound();
    if (!canMutateClientlessTask(user, assigneeId)) notFound();
  }
  db()
    .prepare("INSERT INTO tasks (title, description, lead_id, client_id, assignee_id, due_date, priority, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?)")
    .run(
      title, str(form, "description") || null, leadId, clientId, assigneeId,
      str(form, "due_date") || null, priority, user.id
    );
  revalidateStaffCrm(clientId);
  revalidateLeadTask(leadId);
}

export async function completeTaskAction(form: FormData) {
  const actor = await requireStaff();
  const id = optNum(form, "id");
  if (!id) return;
  const d = db();
  const row = d.prepare("SELECT client_id, lead_id, assignee_id FROM tasks WHERE id = ?").get(id) as {
    client_id: number | null;
    lead_id: number | null;
    assignee_id: number | null;
  } | undefined;
  if (!row) notFound();
  assertTaskMutationCapability(actor, row);
  d.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(id);
  revalidateStaffCrm(row.client_id);
  revalidateLeadTask(row.lead_id);
}

// ---------- sales / leads ----------

export async function addLeadAction(form: FormData) {
  const user = await requireSalesStaff();
  const name = str(form, "name");
  if (!name) return;
  const managerId = user.role === "sales"
    ? user.id
    : validatedLocalSalesManagerId(optNum(form, "manager_id"));
  db()
    .prepare("INSERT INTO leads (name, phone, email, source, amount, currency, manager_id, target_country, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      name, normalizePhone(str(form, "phone")) || null, str(form, "email") || null, str(form, "source") || null,
      str(form, "amount") ? parseFloat(str(form, "amount")) : null, str(form, "currency") || "KGS",
      managerId, str(form, "target_country") || null, str(form, "notes") || null,
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
  const user = await requireSalesStaff();
  const id = optNum(form, "id");
  if (!id) return;
  const d = db();
  const current = d
    .prepare("SELECT manager_id FROM leads WHERE id = ?")
    .get(id) as { manager_id: number | null } | undefined;
  if (!current) notFound();
  if (user.role === "sales" && current.manager_id !== user.id) notFound();
  const managerId = user.role === "sales"
    ? current.manager_id
    : validatedLocalSalesManagerId(optNum(form, "manager_id"));
  d
    .prepare("UPDATE leads SET name = ?, phone = ?, email = ?, source = ?, amount = ?, manager_id = ?, target_country = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
    .run(
      str(form, "name"), str(form, "phone") || null, str(form, "email") || null, str(form, "source") || null,
      str(form, "amount") ? parseFloat(str(form, "amount")) : null, managerId,
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
  const actor = await requireStaff();
  const id = optNum(form, "id");
  const status = str(form, "status");
  if (!id || !(TASK_COLUMNS as readonly string[]).includes(status)) return;
  const d = db();
  const row = d.prepare("SELECT client_id, lead_id, assignee_id FROM tasks WHERE id = ?").get(id) as {
    client_id: number | null;
    lead_id: number | null;
    assignee_id: number | null;
  } | undefined;
  if (!row) notFound();
  assertTaskMutationCapability(actor, row);
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
  const conv = getConversationForActor(user, conversationId);
  if (!conv) notFound();

  const result = await sendWhatsApp(conv.phone, text, conv.wa_account_id);
  const d = db();
  d.prepare("INSERT INTO wa_messages (conversation_id, direction, text, status, author_id, wa_id) VALUES (?, 'out', ?, ?, ?, ?)")
    .run(conversationId, text, result.status, user.id, result.waId ?? null);
  d.prepare("UPDATE wa_conversations SET last_message_at = datetime('now'), unread = 0 WHERE id = ?").run(conversationId);
  revalidatePath(`/whatsapp/${conversationId}`);
  revalidatePath("/whatsapp");
}

export async function createConversationAction(form: FormData) {
  const user = await requireWhatsAppStaff();
  if (!canCreateManualWhatsAppConversation(user)) notFound();
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
  const user = await requireWhatsAppStaff();
  const id = optNum(form, "id");
  if (!id) return;
  if (!getConversationForActor(user, id)) notFound();
  db().prepare("UPDATE wa_conversations SET unread = 0 WHERE id = ?").run(id);
  revalidatePath("/whatsapp");
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
  const keys = ["tel_provider"];
  for (const key of keys) {
    const value = str(form, key);
    if (form.has(key)) setSetting(key, value);
  }
  const secretKeys = ["tel_api_key", "anthropic_api_key"];
  for (const key of secretKeys) {
    if (form.has(key)) setPreservedSecret(key, str(form, key));
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
  if (!isUiContractFixtureMode()) {
    return {
      whatsapp: false,
      whatsappState: "not_configured" as const,
      telephony: false,
      ai: false,
      amocrm: {
        status: "not_configured" as const,
        missing: [
          "accountBaseUrl",
          "clientId",
          "clientSecret",
          "redirectUri",
          "refreshToken",
        ] as const,
      },
    };
  }

  const telephonyProvider = getSetting("tel_provider")?.trim();
  const telephonyApiKey = getSetting("tel_api_key")?.trim();
  return {
    whatsapp: false,
    whatsappState: "not_configured" as "not_configured" | "configured" | "blocked",
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
  assertClientCapability(user, clientId, "write_updates");
  db()
    .prepare("INSERT INTO updates (client_id, author_id, message) VALUES (?, ?, ?)")
    .run(clientId, user.id, message);
  revalidateStaffCrm(clientId);
  revalidatePath("/portal");
}
