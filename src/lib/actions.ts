"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  LEAD_STATUSES,
  STAGES,
  db,
  getSetting,
  hashPassword,
} from "./db";
import { currentUser, isStaff, type SessionUser } from "./auth";
import { isUiContractFixtureMode } from "./runtime-mode";
import {
  canClientCapability,
  resolveClientAccess,
  type ClientAccessSubject,
  type ClientCapability,
} from "./access";
import { normalizePhone } from "./phone";
import {
  canTransitionStudentCase,
  isStudentCaseState,
  nextCaseStateForAssignment,
  normalizeStudentCaseReason,
  workflowOwnerForState,
  type StudentCaseState,
} from "./student-case-policy";

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
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

async function requireSalesStaff() {
  const user = await requireStaff();
  if (user.role !== "admin" && user.role !== "sales") redirect("/dashboard");
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

export async function getIntegrationStatus() {
  if (!isUiContractFixtureMode()) {
    return {
      whatsapp: false,
      whatsappState: "not_configured" as const,
      telephony: false,
    };
  }

  const telephonyProvider = getSetting("tel_provider")?.trim();
  const telephonyApiKey = getSetting("tel_api_key")?.trim();
  return {
    whatsapp: false,
    whatsappState: "not_configured" as "not_configured" | "configured" | "blocked",
    telephony: !!telephonyProvider && !!telephonyApiKey,
  };
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
