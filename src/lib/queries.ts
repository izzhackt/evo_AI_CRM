import { db, LEAD_ACTIVE_STATUSES, Stage, STAGES } from "./db";
import { STUDENT_PORTAL_SECTIONS, StudentPortalSnapshot } from "./contracts/student-portal";
import type { StaffRole } from "./domain";

const ACTIVE_LEAD_STATUS_SQL = LEAD_ACTIVE_STATUSES.map((status) => `'${status}'`).join(", ");
const ACTIVE_LEAD_SQL = `l.client_id IS NULL AND l.status IN (${ACTIVE_LEAD_STATUS_SQL})`;

export type ClientRow = {
  id: number;
  user_id: number;
  stage: Stage;
  manager_id: number | null;
  curator_id: number | null;
  source: string | null;
  target_country: string | null;
  target_degree: string | null;
  notes: string | null;
  created_at: string;
  name: string;
  email: string;
  phone: string | null;
  manager_name: string | null;
  curator_name: string | null;
  overdue_tasks: number;
  overdue_payments: number;
  rejected_documents: number;
};

const CLIENT_SELECT = `
  SELECT c.*, u.name, u.email, u.phone,
         m.name AS manager_name, cu.name AS curator_name,
         (
           SELECT COUNT(*)
           FROM tasks t
           WHERE t.client_id = c.id
             AND t.status != 'done'
             AND t.due_date IS NOT NULL
             AND t.due_date < date('now')
         ) AS overdue_tasks,
         (
           SELECT COUNT(*)
           FROM payments p
           WHERE p.client_id = c.id
             AND p.status != 'paid'
             AND p.due_date IS NOT NULL
             AND p.due_date < date('now')
         ) AS overdue_payments,
         (
           SELECT COUNT(*)
           FROM documents doc
           WHERE doc.client_id = c.id
             AND doc.status = 'rejected'
         ) AS rejected_documents
  FROM clients c
  JOIN users u ON u.id = c.user_id
  LEFT JOIN users m ON m.id = c.manager_id
  LEFT JOIN users cu ON cu.id = c.curator_id
`;

export function listClients(opts: { stage?: string; q?: string } = {}): ClientRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.stage) {
    where.push("c.stage = ?");
    params.push(opts.stage);
  }
  if (opts.q) {
    where.push("(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)");
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
  const sql =
    CLIENT_SELECT + (where.length ? ` WHERE ${where.join(" AND ")}` : "") + " ORDER BY c.created_at DESC";
  return db().prepare(sql).all(...params) as ClientRow[];
}

export function getClient(id: number): ClientRow | undefined {
  return db().prepare(CLIENT_SELECT + " WHERE c.id = ?").get(id) as ClientRow | undefined;
}

export function getClientByUserId(userId: number): ClientRow | undefined {
  return db().prepare(CLIENT_SELECT + " WHERE c.user_id = ?").get(userId) as ClientRow | undefined;
}

export type StudentPortalContactRow = {
  id: number;
  name: string;
  role: string;
  email: string;
  phone: string | null;
};

export type StudentPortalTaskRow = {
  id: number;
  title: string;
  description: string | null;
  due_date: string | null;
  status: string;
  priority: string;
  assignee_name: string | null;
};

type StudentPortalUpdateRow = {
  id: number;
  message: string;
  created_at: string;
  author_name: string | null;
  is_read: number;
};

function staffContact(id: number | null): StudentPortalContactRow | null {
  if (!id) return null;
  const row = db()
    .prepare("SELECT id, name, role, email, phone FROM users WHERE id = ? AND role != 'client'")
    .get(id) as StudentPortalContactRow | undefined;
  return row ?? null;
}

function portalStageTimeline(stage: Stage): StudentPortalSnapshot["stageTimeline"] {
  const visibleStages = STAGES.filter((s) => s !== "archived");
  const safeStage = stage === "archived" ? "enrolled" : stage;
  const currentIndex = Math.max(0, visibleStages.indexOf(safeStage));
  return visibleStages.map((stageItem, index) => ({
    stage: stageItem,
    labelKey: `stage.${stageItem}` as const,
    state: index < currentIndex ? "complete" : index === currentIndex ? "current" : "locked",
  }));
}

function portalProgressPercent(stage: Stage) {
  const visibleStages = STAGES.filter((s) => s !== "archived");
  const safeStage = stage === "archived" ? "enrolled" : stage;
  const currentIndex = Math.max(0, visibleStages.indexOf(safeStage));
  return Math.round(((currentIndex + 1) / visibleStages.length) * 100);
}

function portalPaymentStatus(payment: { status: string; due_date: string | null }, today: string) {
  return payment.status !== "paid" && payment.due_date && payment.due_date < today ? "overdue" : payment.status;
}

function portalNextAction(
  snapshot: Pick<StudentPortalSnapshot, "applications" | "documents" | "payments" | "tasks" | "visa">,
  today: string,
): StudentPortalSnapshot["nextAction"] {
  const urgentTask = snapshot.tasks.find((task) => task.priority === "urgent" || task.priority === "high");
  if (urgentTask) {
    return {
      labelKey: "portalNextTask",
      detail: urgentTask.title,
      dueDate: urgentTask.dueDate,
      severity: urgentTask.priority === "urgent" ? "urgent" : "warning",
    };
  }

  const openDocument = snapshot.documents.find((document) => document.status === "required" || document.status === "rejected");
  if (openDocument) {
    return {
      labelKey: "portalNextDocument",
      detail: openDocument.name,
      dueDate: null,
      severity: openDocument.status === "rejected" ? "urgent" : "warning",
    };
  }

  const nextApplication = snapshot.applications.find(
    (application) => application.deadline && application.status !== "enrolled" && application.status !== "rejected",
  );
  if (nextApplication) {
    return {
      labelKey: "portalNextDeadline",
      detail: nextApplication.university,
      dueDate: nextApplication.deadline,
      severity: nextApplication.deadline && nextApplication.deadline < today ? "urgent" : "normal",
    };
  }

  const openPayment = snapshot.payments.find((payment) => payment.status !== "paid");
  if (openPayment) {
    const visibleStatus = openPayment.dueDate && openPayment.dueDate < today ? "overdue" : openPayment.status;
    return {
      labelKey: visibleStatus === "overdue" ? "portalNextOverduePayment" : "portalNextPayment",
      detail: openPayment.title,
      dueDate: openPayment.dueDate,
      severity: visibleStatus === "overdue" ? "urgent" : "normal",
    };
  }

  if (snapshot.visa?.appointmentAt) {
    return {
      labelKey: "portalNextVisa",
      detail: snapshot.visa.country,
      dueDate: snapshot.visa.appointmentAt,
      severity: "normal",
    };
  }

  return null;
}

export function studentPortalSnapshotForUser(userId: number): StudentPortalSnapshot | undefined {
  const client = getClientByUserId(userId);
  if (!client) return undefined;
  const today = new Date().toISOString().slice(0, 10);
  const tasks = db().prepare(`
    SELECT t.id, t.title, t.description, t.due_date, t.status, t.priority, a.name AS assignee_name
    FROM tasks t
    LEFT JOIN users a ON a.id = t.assignee_id
    WHERE t.client_id = ? AND t.status != 'done'
    ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      t.due_date IS NULL, t.due_date, t.created_at DESC
  `).all(client.id) as StudentPortalTaskRow[];

  const rawSnapshot = {
    applications: clientApplications(client.id),
    documents: clientDocuments(client.id),
    visa: clientVisaCase(client.id),
    payments: clientPayments(client.id),
    updates: db().prepare(`
      SELECT up.*, a.name AS author_name
      FROM updates up LEFT JOIN users a ON a.id = up.author_id
      WHERE up.client_id = ? ORDER BY up.created_at DESC
    `).all(client.id) as StudentPortalUpdateRow[],
    tasks,
  };

  const snapshot: StudentPortalSnapshot = {
    student: {
      id: client.user_id,
      name: client.name,
      email: client.email,
      phone: client.phone,
    },
    client: {
      id: client.id,
      stage: client.stage,
      targetCountry: client.target_country,
      targetDegree: client.target_degree,
      managerId: client.manager_id,
      curatorId: client.curator_id,
    },
    visibleSections: STUDENT_PORTAL_SECTIONS,
    stageTimeline: portalStageTimeline(client.stage),
    progressPercent: portalProgressPercent(client.stage),
    nextAction: null,
    manager: staffContact(client.manager_id),
    curator: staffContact(client.curator_id),
    updates: rawSnapshot.updates.map((update) => ({
      id: update.id,
      message: update.message,
      authorName: update.author_name,
      createdAt: update.created_at,
      isRead: Boolean(update.is_read),
    })),
    applications: rawSnapshot.applications.map((application) => ({
      id: application.id,
      university: application.university,
      country: application.country,
      program: application.program,
      degree: application.degree,
      deadline: application.deadline,
      status: application.status as StudentPortalSnapshot["applications"][number]["status"],
      notes: application.notes,
    })),
    documents: rawSnapshot.documents.map((document) => ({
      id: document.id,
      name: document.name,
      status: document.status as StudentPortalSnapshot["documents"][number]["status"],
      comment: document.comment,
      updatedAt: document.updated_at,
    })),
    visa: rawSnapshot.visa
      ? {
          id: rawSnapshot.visa.id,
          country: rawSnapshot.visa.country,
          status: rawSnapshot.visa.status as NonNullable<StudentPortalSnapshot["visa"]>["status"],
          appointmentAt: rawSnapshot.visa.appointment_at,
          notes: rawSnapshot.visa.notes,
        }
      : null,
    payments: rawSnapshot.payments.map((payment) => ({
      id: payment.id,
      title: payment.title,
      amount: payment.amount,
      currency: payment.currency,
      dueDate: payment.due_date,
      paidAt: payment.paid_at,
      status: portalPaymentStatus(payment, today) as StudentPortalSnapshot["payments"][number]["status"],
    })),
    tasks: rawSnapshot.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      dueDate: task.due_date,
      status: task.status as StudentPortalSnapshot["tasks"][number]["status"],
      priority: task.priority as StudentPortalSnapshot["tasks"][number]["priority"],
      assigneeName: task.assignee_name,
    })),
    generatedAt: new Date().toISOString(),
  };
  return { ...snapshot, nextAction: portalNextAction(snapshot, today) };
}

export function clientApplications(clientId: number) {
  return db().prepare("SELECT * FROM applications WHERE client_id = ? ORDER BY deadline IS NULL, deadline").all(clientId) as {
    id: number; university: string; country: string | null; program: string | null;
    degree: string | null; deadline: string | null; status: string; notes: string | null;
  }[];
}

export function clientDocuments(clientId: number) {
  return db().prepare("SELECT * FROM documents WHERE client_id = ? ORDER BY id").all(clientId) as {
    id: number; name: string; status: string; comment: string | null; updated_at: string;
  }[];
}

export function clientVisaCase(clientId: number) {
  return db().prepare("SELECT * FROM visa_cases WHERE client_id = ?").get(clientId) as {
    id: number; country: string; status: string; appointment_at: string | null; notes: string | null;
  } | undefined;
}

export function clientPayments(clientId: number) {
  return db().prepare("SELECT * FROM payments WHERE client_id = ? ORDER BY due_date IS NULL, due_date").all(clientId) as {
    id: number; title: string; amount: number; currency: string;
    due_date: string | null; paid_at: string | null; status: string;
  }[];
}

export function clientTasks(clientId: number) {
  return db().prepare(`
    SELECT t.*, a.name AS assignee_name
    FROM tasks t
    LEFT JOIN users a ON a.id = t.assignee_id
    WHERE t.client_id = ?
    ORDER BY t.status = 'done',
      CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      t.due_date IS NULL, t.due_date
  `).all(clientId) as {
    id: number; title: string; description: string | null; due_date: string | null;
    status: string; priority: string; assignee_name: string | null;
  }[];
}

export type ApplicationQueueRow = {
  id: number;
  client_id: number;
  client_name: string;
  stage: Stage;
  manager_name: string | null;
  university: string;
  country: string | null;
  program: string | null;
  degree: string | null;
  deadline: string | null;
  status: string;
  notes: string | null;
  updated_at: string;
  document_total: number;
  document_open: number;
  open_tasks: number;
  pending_payments: number;
};

export function allApplications(opts: { status?: string } = {}): ApplicationQueueRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    where.push("ap.status = ?");
    params.push(opts.status);
  }
  const sql = `
    SELECT ap.*, c.id AS client_id, c.stage, u.name AS client_name, m.name AS manager_name,
      (SELECT COUNT(*) FROM documents doc WHERE doc.client_id = c.id) AS document_total,
      (SELECT COUNT(*) FROM documents doc WHERE doc.client_id = c.id AND doc.status != 'approved') AS document_open,
      (SELECT COUNT(*) FROM tasks t WHERE t.client_id = c.id AND t.status != 'done') AS open_tasks,
      (SELECT COUNT(*) FROM payments p WHERE p.client_id = c.id AND p.status != 'paid') AS pending_payments
    FROM applications ap
    JOIN clients c ON c.id = ap.client_id
    JOIN users u ON u.id = c.user_id
    LEFT JOIN users m ON m.id = c.manager_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ap.status = 'enrolled', ap.status = 'rejected',
      ap.deadline IS NULL, ap.deadline, ap.updated_at DESC
  `;
  return db().prepare(sql).all(...params) as ApplicationQueueRow[];
}

export function getApplication(id: number): ApplicationQueueRow | undefined {
  return db().prepare(`
    SELECT ap.*, c.id AS client_id, c.stage, u.name AS client_name, m.name AS manager_name,
      (SELECT COUNT(*) FROM documents doc WHERE doc.client_id = c.id) AS document_total,
      (SELECT COUNT(*) FROM documents doc WHERE doc.client_id = c.id AND doc.status != 'approved') AS document_open,
      (SELECT COUNT(*) FROM tasks t WHERE t.client_id = c.id AND t.status != 'done') AS open_tasks,
      (SELECT COUNT(*) FROM payments p WHERE p.client_id = c.id AND p.status != 'paid') AS pending_payments
    FROM applications ap
    JOIN clients c ON c.id = ap.client_id
    JOIN users u ON u.id = c.user_id
    LEFT JOIN users m ON m.id = c.manager_id
    WHERE ap.id = ?
  `).get(id) as ApplicationQueueRow | undefined;
}

export type DocumentQueueRow = {
  id: number;
  client_id: number;
  client_name: string;
  stage: Stage;
  manager_name: string | null;
  name: string;
  status: string;
  comment: string | null;
  updated_at: string;
  application_total: number;
  active_applications: number;
  open_tasks: number;
  pending_payments: number;
};

export function allDocuments(opts: { status?: string } = {}): DocumentQueueRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    where.push("doc.status = ?");
    params.push(opts.status);
  }
  const sql = `
    SELECT doc.*, c.id AS client_id, c.stage, u.name AS client_name, m.name AS manager_name,
      (SELECT COUNT(*) FROM applications ap WHERE ap.client_id = c.id) AS application_total,
      (SELECT COUNT(*) FROM applications ap WHERE ap.client_id = c.id AND ap.status IN ('preparing', 'submitted', 'offer')) AS active_applications,
      (SELECT COUNT(*) FROM tasks t WHERE t.client_id = c.id AND t.status != 'done') AS open_tasks,
      (SELECT COUNT(*) FROM payments p WHERE p.client_id = c.id AND p.status != 'paid') AS pending_payments
    FROM documents doc
    JOIN clients c ON c.id = doc.client_id
    JOIN users u ON u.id = c.user_id
    LEFT JOIN users m ON m.id = c.manager_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY doc.status = 'approved', doc.status = 'rejected', doc.updated_at DESC
  `;
  return db().prepare(sql).all(...params) as DocumentQueueRow[];
}

export function getDocument(id: number): DocumentQueueRow | undefined {
  return db().prepare(`
    SELECT doc.*, c.id AS client_id, c.stage, u.name AS client_name, m.name AS manager_name,
      (SELECT COUNT(*) FROM applications ap WHERE ap.client_id = c.id) AS application_total,
      (SELECT COUNT(*) FROM applications ap WHERE ap.client_id = c.id AND ap.status IN ('preparing', 'submitted', 'offer')) AS active_applications,
      (SELECT COUNT(*) FROM tasks t WHERE t.client_id = c.id AND t.status != 'done') AS open_tasks,
      (SELECT COUNT(*) FROM payments p WHERE p.client_id = c.id AND p.status != 'paid') AS pending_payments
    FROM documents doc
    JOIN clients c ON c.id = doc.client_id
    JOIN users u ON u.id = c.user_id
    LEFT JOIN users m ON m.id = c.manager_id
    WHERE doc.id = ?
  `).get(id) as DocumentQueueRow | undefined;
}

export type VisaQueueRow = {
  id: number;
  client_id: number;
  client_name: string;
  stage: Stage;
  target_country: string | null;
  manager_name: string | null;
  curator_name: string | null;
  country: string;
  status: string;
  appointment_at: string | null;
  notes: string | null;
  updated_at: string;
  document_total: number;
  document_open: number;
  active_applications: number;
  open_tasks: number;
};

export function allVisaCases(opts: { status?: string } = {}): VisaQueueRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    where.push("v.status = ?");
    params.push(opts.status);
  }
  return db().prepare(`
    SELECT v.*, c.id AS client_id, c.stage, c.target_country, u.name AS client_name,
      m.name AS manager_name, cu.name AS curator_name,
      (SELECT COUNT(*) FROM documents doc WHERE doc.client_id = c.id) AS document_total,
      (SELECT COUNT(*) FROM documents doc WHERE doc.client_id = c.id AND doc.status != 'approved') AS document_open,
      (SELECT COUNT(*) FROM applications ap WHERE ap.client_id = c.id AND ap.status IN ('preparing', 'submitted', 'offer')) AS active_applications,
      (SELECT COUNT(*) FROM tasks t WHERE t.client_id = c.id AND t.status != 'done') AS open_tasks
    FROM visa_cases v
    JOIN clients c ON c.id = v.client_id
    JOIN users u ON u.id = c.user_id
    LEFT JOIN users m ON m.id = c.manager_id
    LEFT JOIN users cu ON cu.id = c.curator_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY v.status = 'approved', v.status = 'rejected',
      v.appointment_at IS NULL, v.appointment_at, v.updated_at DESC
  `).all(...params) as VisaQueueRow[];
}

export function getVisaCase(id: number): VisaQueueRow | undefined {
  return db().prepare(`
    SELECT v.*, c.id AS client_id, c.stage, c.target_country, u.name AS client_name,
      m.name AS manager_name, cu.name AS curator_name,
      (SELECT COUNT(*) FROM documents doc WHERE doc.client_id = c.id) AS document_total,
      (SELECT COUNT(*) FROM documents doc WHERE doc.client_id = c.id AND doc.status != 'approved') AS document_open,
      (SELECT COUNT(*) FROM applications ap WHERE ap.client_id = c.id AND ap.status IN ('preparing', 'submitted', 'offer')) AS active_applications,
      (SELECT COUNT(*) FROM tasks t WHERE t.client_id = c.id AND t.status != 'done') AS open_tasks
    FROM visa_cases v
    JOIN clients c ON c.id = v.client_id
    JOIN users u ON u.id = c.user_id
    LEFT JOIN users m ON m.id = c.manager_id
    LEFT JOIN users cu ON cu.id = c.curator_id
    WHERE v.id = ?
  `).get(id) as VisaQueueRow | undefined;
}

export function clientUpdates(clientId: number) {
  return db().prepare(`
    SELECT up.*, a.name AS author_name
    FROM updates up LEFT JOIN users a ON a.id = up.author_id
    WHERE up.client_id = ? ORDER BY up.created_at DESC
  `).all(clientId) as {
    id: number; message: string; created_at: string; author_name: string | null;
  }[];
}

export function listTasks(assigneeId?: number) {
  const where = assigneeId ? "WHERE t.assignee_id = ?" : "";
  const params = assigneeId ? [assigneeId] : [];
  return db().prepare(`
    SELECT t.*, a.name AS assignee_name, u.name AS client_name, c.id AS client_id,
      c.stage, c.target_country, l.name AS lead_name, l.status AS lead_status
    FROM tasks t
    LEFT JOIN users a ON a.id = t.assignee_id
    LEFT JOIN clients c ON c.id = t.client_id
    LEFT JOIN users u ON u.id = c.user_id
    LEFT JOIN leads l ON l.id = t.lead_id
    ${where}
    ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
             t.due_date IS NULL, t.due_date
  `).all(...params) as {
    id: number; title: string; description: string | null; due_date: string | null;
    status: string; priority: string; assignee_name: string | null;
    client_name: string | null; client_id: number | null; lead_id: number | null;
    lead_name: string | null; lead_status: string | null; stage: Stage | null; target_country: string | null;
  }[];
}

export function listStaff() {
  return db().prepare("SELECT id, name, email, role, created_at FROM users WHERE role != 'client' ORDER BY name").all() as {
    id: number; name: string; email: string; role: string; created_at: string;
  }[];
}

export type OperatorNotificationKind =
  | "task_overdue"
  | "task_priority"
  | "whatsapp_unread"
  | "document_attention"
  | "payment_overdue"
  | "application_deadline";

export type OperatorNotification = {
  id: string;
  kind: OperatorNotificationKind;
  group: "urgent" | "today" | "upcoming";
  title: string;
  subject: string | null;
  href: string;
  occurred_at: string | null;
  priority: number;
};

export const OPERATOR_NOTIFICATION_LIMIT = 40;

function notificationGroup(
  dateValue: string | null,
  forceUrgent = false,
): OperatorNotification["group"] {
  if (forceUrgent) return "urgent";
  if (!dateValue) return "upcoming";
  const date = dateValue.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return "urgent";
  if (date === today) return "today";
  return "upcoming";
}

/**
 * Role-filtered, read-only attention feed assembled from existing operational
 * tables. This is deliberately not an unread-notification store: this
 * workspace has no notification acknowledgement table.
 */
export function listOperatorNotifications(
  role: StaffRole,
  limit = OPERATOR_NOTIFICATION_LIMIT,
): OperatorNotification[] {
  const d = db();
  const items: OperatorNotification[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const sourceLimit = Math.max(0, limit);
  if (sourceLimit === 0) return items;

  const tasks = d.prepare(`
    SELECT t.id, t.title, t.due_date, t.priority,
      COALESCE(l.name, u.name) AS subject
    FROM tasks t
    LEFT JOIN leads l ON l.id = t.lead_id
    LEFT JOIN clients c ON c.id = t.client_id
    LEFT JOIN users u ON u.id = c.user_id
    WHERE t.status != 'done'
      AND (
        t.priority IN ('urgent', 'high')
        OR (t.due_date IS NOT NULL AND t.due_date <= date('now', '+7 days'))
      )
    ORDER BY t.due_date IS NULL, t.due_date
    LIMIT ?
  `).all(sourceLimit) as {
    id: number;
    title: string;
    due_date: string | null;
    priority: string;
    subject: string | null;
  }[];
  for (const task of tasks) {
    const overdue = Boolean(task.due_date && task.due_date.slice(0, 10) < today);
    items.push({
      id: `task-${task.id}`,
      kind: overdue ? "task_overdue" : "task_priority",
      group: notificationGroup(task.due_date, overdue || task.priority === "urgent"),
      title: task.title,
      subject: task.subject,
      href: `/tasks?view=list#task-${task.id}`,
      occurred_at: task.due_date,
      priority: overdue || task.priority === "urgent" ? 0 : 2,
    });
  }

  if (["admin", "sales", "curator"].includes(role)) {
    const conversations = d.prepare(`
      SELECT id, COALESCE(name, phone) AS title, unread, last_message_at
      FROM wa_conversations
      WHERE unread > 0
      ORDER BY last_message_at DESC
      LIMIT ?
    `).all(sourceLimit) as {
      id: number; title: string; unread: number; last_message_at: string | null;
    }[];
    for (const conversation of conversations) {
      items.push({
        id: `whatsapp-${conversation.id}`,
        kind: "whatsapp_unread",
        group: notificationGroup(conversation.last_message_at),
        title: conversation.title,
        subject: String(conversation.unread),
        href: `/whatsapp/${conversation.id}`,
        occurred_at: conversation.last_message_at,
        priority: 1,
      });
    }
  }

  if (["admin", "sales", "curator", "visa"].includes(role)) {
    const documents = d.prepare(`
      SELECT doc.id, doc.name, doc.status, doc.updated_at, u.name AS client_name
      FROM documents doc
      JOIN clients c ON c.id = doc.client_id
      JOIN users u ON u.id = c.user_id
      WHERE doc.status IN ('uploaded', 'review', 'rejected')
      ORDER BY doc.status = 'rejected' DESC, doc.updated_at DESC
      LIMIT ?
    `).all(sourceLimit) as {
      id: number; name: string; status: string; updated_at: string; client_name: string;
    }[];
    for (const document of documents) {
      const rejected = document.status === "rejected";
      items.push({
        id: `document-${document.id}`,
        kind: "document_attention",
        group: rejected ? "urgent" : "upcoming",
        title: document.name,
        subject: document.client_name,
        href: `/documents/${document.id}`,
        occurred_at: document.updated_at,
        priority: rejected ? 0 : 3,
      });
    }

    const applications = d.prepare(`
      SELECT ap.id, ap.university, ap.deadline, u.name AS client_name
      FROM applications ap
      JOIN clients c ON c.id = ap.client_id
      JOIN users u ON u.id = c.user_id
      WHERE ap.status NOT IN ('enrolled', 'rejected')
        AND ap.deadline IS NOT NULL
        AND ap.deadline <= date('now', '+14 days')
      ORDER BY ap.deadline
      LIMIT ?
    `).all(sourceLimit) as {
      id: number; university: string; deadline: string; client_name: string;
    }[];
    for (const application of applications) {
      const group = notificationGroup(application.deadline);
      items.push({
        id: `application-${application.id}`,
        kind: "application_deadline",
        group,
        title: application.university,
        subject: application.client_name,
        href: `/applications/${application.id}`,
        occurred_at: application.deadline,
        priority: group === "urgent" ? 0 : 2,
      });
    }
  }

  if (["admin", "finance"].includes(role)) {
    const payments = d.prepare(`
      SELECT p.id, p.title, p.due_date, u.name AS client_name
      FROM payments p
      JOIN clients c ON c.id = p.client_id
      JOIN users u ON u.id = c.user_id
      WHERE p.status != 'paid'
        AND p.due_date IS NOT NULL
        AND p.due_date < date('now')
      ORDER BY p.due_date
      LIMIT ?
    `).all(sourceLimit) as {
      id: number; title: string; due_date: string; client_name: string;
    }[];
    for (const payment of payments) {
      items.push({
        id: `payment-${payment.id}`,
        kind: "payment_overdue",
        group: "urgent",
        title: payment.title,
        subject: payment.client_name,
        // Finance currently exposes one supported queue rather than a
        // record-level filter or anchor. Keep this action truthful until that
        // route owns a real overdue-payment drilldown.
        href: "/finance",
        occurred_at: payment.due_date,
        priority: 0,
      });
    }
  }

  return items
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        String(a.occurred_at ?? "").localeCompare(String(b.occurred_at ?? "")),
    )
    .slice(0, sourceLimit);
}

export type PaymentQueueRow = {
  id: number;
  title: string;
  amount: number;
  currency: string;
  due_date: string | null;
  paid_at: string | null;
  status: string;
  client_name: string;
  client_id: number;
  stage: Stage;
  target_country: string | null;
  manager_name: string | null;
};

export function allPayments(): PaymentQueueRow[] {
  return db().prepare(`
    SELECT p.*, u.name AS client_name, c.id AS client_id, c.stage, c.target_country,
      m.name AS manager_name
    FROM payments p
    JOIN clients c ON c.id = p.client_id
    JOIN users u ON u.id = c.user_id
    LEFT JOIN users m ON m.id = c.manager_id
    ORDER BY p.status = 'paid', p.due_date IS NULL, p.due_date
  `).all() as PaymentQueueRow[];
}

export function getPayment(id: number): PaymentQueueRow | undefined {
  return db().prepare(`
    SELECT p.*, u.name AS client_name, c.id AS client_id, c.stage, c.target_country,
      m.name AS manager_name
    FROM payments p
    JOIN clients c ON c.id = p.client_id
    JOIN users u ON u.id = c.user_id
    LEFT JOIN users m ON m.id = c.manager_id
    WHERE p.id = ?
  `).get(id) as PaymentQueueRow | undefined;
}

export type LeadRow = {
  id: number; name: string; phone: string | null; email: string | null;
  source: string | null; status: string; amount: number | null; currency: string;
  manager_id: number | null; client_id: number | null; target_country: string | null;
  notes: string | null; created_at: string; updated_at: string; manager_name: string | null;
  open_tasks: number; overdue_tasks: number; next_task_due_date: string | null;
  next_task_title: string | null; last_activity_at: string | null; last_call_at: string | null;
  last_wa_at: string | null; last_touch_at: string | null; last_channel: string | null;
  call_count: number; wa_message_count: number; unread_messages: number;
};

export function listLeads(): LeadRow[] {
  return db().prepare(`
    WITH lead_context AS (
      SELECT l.*, m.name AS manager_name,
        (SELECT COUNT(*) FROM tasks t WHERE t.status != 'done' AND (t.lead_id = l.id OR (l.client_id IS NOT NULL AND t.client_id = l.client_id))) AS open_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date < date('now') AND (t.lead_id = l.id OR (l.client_id IS NOT NULL AND t.client_id = l.client_id))) AS overdue_tasks,
        (SELECT t.due_date FROM tasks t WHERE t.status != 'done' AND (t.lead_id = l.id OR (l.client_id IS NOT NULL AND t.client_id = l.client_id)) ORDER BY t.due_date IS NULL, t.due_date LIMIT 1) AS next_task_due_date,
        (SELECT t.title FROM tasks t WHERE t.status != 'done' AND (t.lead_id = l.id OR (l.client_id IS NOT NULL AND t.client_id = l.client_id)) ORDER BY t.due_date IS NULL, t.due_date LIMIT 1) AS next_task_title,
        (SELECT MAX(a.created_at) FROM lead_activities a WHERE a.lead_id = l.id) AS last_activity_at,
        (SELECT MAX(c.started_at) FROM calls c WHERE c.lead_id = l.id) AS last_call_at,
        (SELECT MAX(w.last_message_at) FROM wa_conversations w WHERE w.lead_id = l.id) AS last_wa_at,
        (SELECT COUNT(*) FROM calls c WHERE c.lead_id = l.id) AS call_count,
        (SELECT COUNT(*) FROM wa_messages wm JOIN wa_conversations w ON w.id = wm.conversation_id WHERE w.lead_id = l.id) AS wa_message_count,
        (SELECT COALESCE(SUM(w.unread), 0) FROM wa_conversations w WHERE w.lead_id = l.id) AS unread_messages
      FROM leads l LEFT JOIN users m ON m.id = l.manager_id
    )
    SELECT *,
      NULLIF(MAX(COALESCE(last_activity_at, ''), COALESCE(last_call_at, ''), COALESCE(last_wa_at, ''), COALESCE(updated_at, '')), '') AS last_touch_at,
      CASE
        WHEN COALESCE(last_wa_at, '') >= COALESCE(last_call_at, '') AND COALESCE(last_wa_at, '') >= COALESCE(last_activity_at, '') THEN 'WhatsApp'
        WHEN COALESCE(last_call_at, '') >= COALESCE(last_activity_at, '') THEN 'Call'
        WHEN last_activity_at IS NOT NULL THEN 'CRM'
        ELSE NULL
      END AS last_channel
    FROM lead_context
    ORDER BY updated_at DESC
  `).all() as LeadRow[];
}

export function getLead(id: number): LeadRow | undefined {
  return db().prepare(`
    WITH lead_context AS (
      SELECT l.*, m.name AS manager_name,
        (SELECT COUNT(*) FROM tasks t WHERE t.status != 'done' AND (t.lead_id = l.id OR (l.client_id IS NOT NULL AND t.client_id = l.client_id))) AS open_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date < date('now') AND (t.lead_id = l.id OR (l.client_id IS NOT NULL AND t.client_id = l.client_id))) AS overdue_tasks,
        (SELECT t.due_date FROM tasks t WHERE t.status != 'done' AND (t.lead_id = l.id OR (l.client_id IS NOT NULL AND t.client_id = l.client_id)) ORDER BY t.due_date IS NULL, t.due_date LIMIT 1) AS next_task_due_date,
        (SELECT t.title FROM tasks t WHERE t.status != 'done' AND (t.lead_id = l.id OR (l.client_id IS NOT NULL AND t.client_id = l.client_id)) ORDER BY t.due_date IS NULL, t.due_date LIMIT 1) AS next_task_title,
        (SELECT MAX(a.created_at) FROM lead_activities a WHERE a.lead_id = l.id) AS last_activity_at,
        (SELECT MAX(c.started_at) FROM calls c WHERE c.lead_id = l.id) AS last_call_at,
        (SELECT MAX(w.last_message_at) FROM wa_conversations w WHERE w.lead_id = l.id) AS last_wa_at,
        (SELECT COUNT(*) FROM calls c WHERE c.lead_id = l.id) AS call_count,
        (SELECT COUNT(*) FROM wa_messages wm JOIN wa_conversations w ON w.id = wm.conversation_id WHERE w.lead_id = l.id) AS wa_message_count,
        (SELECT COALESCE(SUM(w.unread), 0) FROM wa_conversations w WHERE w.lead_id = l.id) AS unread_messages
      FROM leads l LEFT JOIN users m ON m.id = l.manager_id
      WHERE l.id = ?
    )
    SELECT *,
      NULLIF(MAX(COALESCE(last_activity_at, ''), COALESCE(last_call_at, ''), COALESCE(last_wa_at, ''), COALESCE(updated_at, '')), '') AS last_touch_at,
      CASE
        WHEN COALESCE(last_wa_at, '') >= COALESCE(last_call_at, '') AND COALESCE(last_wa_at, '') >= COALESCE(last_activity_at, '') THEN 'WhatsApp'
        WHEN COALESCE(last_call_at, '') >= COALESCE(last_activity_at, '') THEN 'Call'
        WHEN last_activity_at IS NOT NULL THEN 'CRM'
        ELSE NULL
      END AS last_channel
    FROM lead_context
  `).get(id) as LeadRow | undefined;
}

export function leadActivities(leadId: number) {
  return db().prepare(`
    SELECT a.*, u.name AS author_name
    FROM lead_activities a LEFT JOIN users u ON u.id = a.author_id
    WHERE a.lead_id = ? ORDER BY a.created_at DESC
  `).all(leadId) as { id: number; type: string; text: string; created_at: string; author_name: string | null }[];
}

export type SalesReportPeriod = "30d" | "quarter" | "year" | "all";

export function salesReport(period: SalesReportPeriod = "all") {
  const d = db();
  const periodSql = {
    "30d": "datetime('now', '-30 days')",
    quarter: "datetime('now', '-3 months')",
    year: "datetime('now', 'start of year')",
    all: null,
  }[period];
  const leadJoinFilter = periodSql ? ` AND l.created_at >= ${periodSql}` : "";
  const leadWhereFilter = periodSql ? ` WHERE created_at >= ${periodSql}` : "";
  const byManager = d.prepare(`
    SELECT u.id, u.name,
      COUNT(l.id) AS leads,
      SUM(CASE WHEN l.status = 'contract_signed' OR l.client_id IS NOT NULL THEN 1 ELSE 0 END) AS won,
      SUM(CASE WHEN l.status = 'no_request' THEN 1 ELSE 0 END) AS lost,
      SUM(CASE WHEN l.status = 'contract_signed' OR l.client_id IS NOT NULL THEN COALESCE(l.amount, 0) ELSE 0 END) AS won_amount
    FROM users u LEFT JOIN leads l ON l.manager_id = u.id${leadJoinFilter}
    WHERE u.role IN ('sales', 'admin')
    GROUP BY u.id HAVING leads > 0
    ORDER BY won_amount DESC
  `).all() as { id: number; name: string; leads: number; won: number; lost: number; won_amount: number }[];
  const byMonth = d.prepare(`
    SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS c
    FROM leads${leadWhereFilter} GROUP BY month ORDER BY month DESC LIMIT 12
  `).all() as { month: string; c: number }[];
  const bySource = d.prepare(`
    SELECT COALESCE(source, '—') AS source, COUNT(*) AS c,
      SUM(CASE WHEN status = 'contract_signed' OR client_id IS NOT NULL THEN 1 ELSE 0 END) AS won
    FROM leads${leadWhereFilter} GROUP BY source ORDER BY c DESC
  `).all() as { source: string; c: number; won: number }[];
  return { byManager, byMonth: byMonth.reverse(), bySource };
}

export function salesCockpitStats() {
  const d = db();
  const dealWithoutTaskWhere = `
    ${ACTIVE_LEAD_SQL} AND NOT EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.status != 'done' AND (t.lead_id = l.id OR (l.client_id IS NOT NULL AND t.client_id = l.client_id))
    )
  `;
  const dealsWithoutTasks = (d.prepare(`SELECT COUNT(*) c FROM leads l WHERE ${dealWithoutTaskWhere}`).get() as { c: number }).c;
  const overdueLeadTasks = (d.prepare(`
    SELECT COUNT(DISTINCT l.id) c
    FROM leads l
    JOIN tasks t ON t.status != 'done'
      AND t.due_date IS NOT NULL
      AND t.due_date < date('now')
      AND (t.lead_id = l.id OR (l.client_id IS NOT NULL AND t.client_id = l.client_id))
    WHERE ${ACTIVE_LEAD_SQL}
  `).get() as { c: number }).c;
  const managerRows = d.prepare(`
    SELECT u.id, u.name,
      SUM(CASE WHEN l.id IS NOT NULL AND ${ACTIVE_LEAD_SQL} THEN 1 ELSE 0 END) AS deals,
      COALESCE(SUM(l.amount), 0) AS value,
      SUM(CASE WHEN l.status = 'contract_signed' OR l.client_id IS NOT NULL THEN 1 ELSE 0 END) AS signed,
      SUM(CASE WHEN l.id IS NOT NULL AND ${ACTIVE_LEAD_SQL} AND NOT EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.status != 'done' AND (t.lead_id = l.id OR (l.client_id IS NOT NULL AND t.client_id = l.client_id))
      ) THEN 1 ELSE 0 END) AS no_task,
      (SELECT COUNT(*) FROM calls c WHERE c.manager_id = u.id) AS calls,
      (SELECT COUNT(*) FROM wa_messages wm WHERE wm.author_id = u.id) AS messages
    FROM users u
    LEFT JOIN leads l ON l.manager_id = u.id
    WHERE u.role IN ('sales', 'admin')
    GROUP BY u.id
    HAVING deals > 0 OR signed > 0
    ORDER BY no_task DESC, deals DESC
    LIMIT 6
  `).all() as { id: number; name: string; deals: number; value: number; signed: number; no_task: number; calls: number; messages: number }[];
  const sourceRows = d.prepare(`
    SELECT COALESCE(NULLIF(TRIM(source), ''), '—') AS source,
      COUNT(*) AS deals,
      COALESCE(SUM(amount), 0) AS value,
      SUM(CASE WHEN status = 'contract_signed' OR client_id IS NOT NULL THEN 1 ELSE 0 END) AS signed
    FROM leads
    GROUP BY COALESCE(NULLIF(TRIM(source), ''), '—')
    ORDER BY deals DESC, value DESC
    LIMIT 6
  `).all() as { source: string; deals: number; value: number; signed: number }[];
  const avgResponseMinutes = (d.prepare(`
    SELECT AVG((julianday((
      SELECT MIN(out_msg.created_at)
      FROM wa_messages out_msg
      WHERE out_msg.conversation_id = in_msg.conversation_id
        AND out_msg.direction = 'out'
        AND out_msg.created_at > in_msg.created_at
    )) - julianday(in_msg.created_at)) * 24 * 60) AS minutes
    FROM wa_messages in_msg
    WHERE in_msg.direction = 'in'
      AND EXISTS (
        SELECT 1
        FROM wa_messages out_msg
        WHERE out_msg.conversation_id = in_msg.conversation_id
          AND out_msg.direction = 'out'
          AND out_msg.created_at > in_msg.created_at
      )
  `).get() as { minutes: number | null }).minutes;
  const channelActivity = {
    incomingCalls: (d.prepare("SELECT COUNT(*) c FROM calls WHERE direction = 'in'").get() as { c: number }).c,
    outgoingCalls: (d.prepare("SELECT COUNT(*) c FROM calls WHERE direction = 'out'").get() as { c: number }).c,
    incomingMessages: (d.prepare("SELECT COUNT(*) c FROM wa_messages WHERE direction = 'in'").get() as { c: number }).c,
    outgoingMessages: (d.prepare("SELECT COUNT(*) c FROM wa_messages WHERE direction = 'out'").get() as { c: number }).c,
    unreadConversations: (d.prepare("SELECT COALESCE(SUM(unread), 0) c FROM wa_conversations").get() as { c: number }).c,
    avgResponseMinutes: avgResponseMinutes === null ? null : Math.max(0, Math.round(avgResponseMinutes)),
  };
  return { dealsWithoutTasks, overdueLeadTasks, managerRows, sourceRows, channelActivity };
}

export function listChannels() {
  return db().prepare(`
    SELECT ch.*, (SELECT COUNT(*) FROM channel_messages m WHERE m.channel_id = ch.id) AS message_count
    FROM channels ch ORDER BY ch.name
  `).all() as { id: number; name: string; description: string | null; message_count: number }[];
}

export function channelMessages(channelId: number, limit = 100) {
  return db().prepare(`
    SELECT m.*, u.name AS author_name, u.role AS author_role
    FROM channel_messages m JOIN users u ON u.id = m.author_id
    WHERE m.channel_id = ?
    ORDER BY m.created_at DESC LIMIT ?
  `).all(channelId, limit).reverse() as {
    id: number; text: string; created_at: string; author_id: number;
    author_name: string; author_role: string;
  }[];
}

export function listConversations() {
  return db().prepare(`
    SELECT c.*, a.name AS account_name, a.provider AS account_provider,
      (SELECT text FROM wa_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_text
    FROM wa_conversations c
    LEFT JOIN wa_accounts a ON a.id = c.wa_account_id
    ORDER BY c.last_message_at DESC
  `).all() as {
    id: number; phone: string; name: string | null; lead_id: number | null;
    client_id: number | null; unread: number; last_text: string | null; last_message_at: string | null;
    wa_account_id: number | null; account_name: string | null; account_provider: string | null;
    amo_lead_id: number | null; amo_contact_id: number | null; agent_state: string | null;
    agent_summary: string | null; agent_handoff_reason: string | null; agent_draft_review_text: string | null;
    agent_draft_review_status: string | null; agent_draft_review_provider: string | null;
    agent_draft_review_model: string | null; agent_last_synced_at: string | null;
  }[];
}

export function getConversation(id: number) {
  return db().prepare(`
    SELECT c.*, a.name AS account_name, a.provider AS account_provider
    FROM wa_conversations c
    LEFT JOIN wa_accounts a ON a.id = c.wa_account_id
    WHERE c.id = ?
  `).get(id) as {
    id: number; phone: string; name: string | null; lead_id: number | null; client_id: number | null;
    wa_account_id: number | null; account_name: string | null; account_provider: string | null;
    amo_lead_id: number | null; amo_contact_id: number | null; agent_state: string | null;
    agent_summary: string | null; agent_handoff_reason: string | null; agent_draft_review_text: string | null;
    agent_draft_review_status: string | null; agent_draft_review_provider: string | null;
    agent_draft_review_model: string | null; agent_last_synced_at: string | null;
  } | undefined;
}

export function waMessages(conversationId: number) {
  return db().prepare(`
    SELECT m.*, u.name AS author_name
    FROM wa_messages m LEFT JOIN users u ON u.id = m.author_id
    WHERE m.conversation_id = ? ORDER BY m.created_at
  `).all(conversationId) as {
    id: number; direction: string; text: string; status: string;
    created_at: string; author_name: string | null;
  }[];
}

export function listCalls() {
  return db().prepare(`
    SELECT c.*, m.name AS manager_name, l.name AS lead_name
    FROM calls c
    LEFT JOIN users m ON m.id = c.manager_id
    LEFT JOIN leads l ON l.id = c.lead_id
    ORDER BY c.started_at DESC LIMIT 200
  `).all() as {
    id: number; direction: string; phone: string; started_at: string;
    duration_sec: number; status: string; recording_url: string | null;
    notes: string | null; manager_name: string | null; lead_name: string | null; lead_id: number | null;
  }[];
}

export type OperationalAuditRow = {
  id: string;
  kind: "lead_activity" | "call" | "chat";
  title: string;
  detail: string | null;
  occurred_at: string;
  actor_name: string | null;
};

/**
 * Available operational history only. This is not a security audit log:
 * authentication, role changes, and setting mutations are not persisted in a
 * dedicated audit table in the current workspace.
 */
export function listOperationalAuditTrail(limit = 60): OperationalAuditRow[] {
  return db().prepare(`
    SELECT * FROM (
      SELECT
        'lead-' || a.id AS id,
        'lead_activity' AS kind,
        l.name AS title,
        a.text AS detail,
        a.created_at AS occurred_at,
        u.name AS actor_name
      FROM lead_activities a
      JOIN leads l ON l.id = a.lead_id
      LEFT JOIN users u ON u.id = a.author_id

      UNION ALL

      SELECT
        'call-' || c.id AS id,
        'call' AS kind,
        c.phone AS title,
        COALESCE(c.notes, c.status) AS detail,
        c.started_at AS occurred_at,
        u.name AS actor_name
      FROM calls c
      LEFT JOIN users u ON u.id = c.manager_id

      UNION ALL

      SELECT
        'chat-' || m.id AS id,
        'chat' AS kind,
        '#' || ch.name AS title,
        m.text AS detail,
        m.created_at AS occurred_at,
        u.name AS actor_name
      FROM channel_messages m
      JOIN channels ch ON ch.id = m.channel_id
      LEFT JOIN users u ON u.id = m.author_id
    )
    ORDER BY occurred_at DESC
    LIMIT ?
  `).all(Math.max(0, limit)) as OperationalAuditRow[];
}

export function dashboardStats() {
  const d = db();
  const totalClients = (d.prepare("SELECT COUNT(*) c FROM clients WHERE stage != 'archived'").get() as { c: number }).c;
  const activeApps = (d.prepare("SELECT COUNT(*) c FROM applications WHERE status IN ('preparing','submitted')").get() as { c: number }).c;
  const openTasks = (d.prepare("SELECT COUNT(*) c FROM tasks WHERE status != 'done'").get() as { c: number }).c;
  const pendingPayments = (d.prepare("SELECT COUNT(*) c FROM payments WHERE status != 'paid'").get() as { c: number }).c;
  const activeLeads = (d.prepare(`SELECT COUNT(*) c FROM leads l WHERE ${ACTIVE_LEAD_SQL}`).get() as { c: number }).c;
  const documentsInReview = (d.prepare("SELECT COUNT(*) c FROM documents WHERE status IN ('uploaded','review')").get() as { c: number }).c;
  const overduePayments = (d.prepare("SELECT COUNT(*) c FROM payments WHERE status != 'paid' AND due_date IS NOT NULL AND due_date < date('now')").get() as { c: number }).c;
  const urgentTasks = (d.prepare("SELECT COUNT(*) c FROM tasks WHERE status != 'done' AND priority IN ('high','urgent')").get() as { c: number }).c;
  const byStage = d.prepare("SELECT stage, COUNT(*) c FROM clients GROUP BY stage").all() as { stage: Stage; c: number }[];
  const byLeadStatus = d.prepare("SELECT status, COUNT(*) c FROM leads GROUP BY status").all() as { status: string; c: number }[];
  const byApplicationStatus = d.prepare("SELECT status, COUNT(*) c FROM applications GROUP BY status").all() as { status: string; c: number }[];
  const byDocumentStatus = d.prepare("SELECT status, COUNT(*) c FROM documents GROUP BY status").all() as { status: string; c: number }[];
  const byTaskStatus = d.prepare("SELECT status, COUNT(*) c FROM tasks GROUP BY status").all() as { status: string; c: number }[];
  const byPaymentStatus = d.prepare(`
    SELECT CASE
      WHEN status != 'paid' AND due_date IS NOT NULL AND due_date < date('now') THEN 'overdue'
      ELSE status
    END AS status, COUNT(*) c
    FROM payments
    GROUP BY CASE
      WHEN status != 'paid' AND due_date IS NOT NULL AND due_date < date('now') THEN 'overdue'
      ELSE status
    END
  `).all() as { status: string; c: number }[];
  const deadlines = d.prepare(`
    SELECT ap.university, ap.deadline, ap.status, u.name AS client_name, c.id AS client_id
    FROM applications ap
    JOIN clients c ON c.id = ap.client_id
    JOIN users u ON u.id = c.user_id
    WHERE ap.deadline IS NOT NULL AND ap.status IN ('preparing','submitted')
    ORDER BY ap.deadline LIMIT 8
  `).all() as { university: string; deadline: string; status: string; client_name: string; client_id: number }[];
  return {
    totalClients,
    activeApps,
    openTasks,
    pendingPayments,
    activeLeads,
    documentsInReview,
    overduePayments,
    urgentTasks,
    byStage,
    byLeadStatus,
    byApplicationStatus,
    byDocumentStatus,
    byTaskStatus,
    byPaymentStatus,
    deadlines,
  };
}
