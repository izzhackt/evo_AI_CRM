import { db, Stage, STAGES } from "./db";
import { STUDENT_PORTAL_SECTIONS, StudentPortalSnapshot } from "./contracts/student-portal";

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
};

const CLIENT_SELECT = `
  SELECT c.*, u.name, u.email, u.phone,
         m.name AS manager_name, cu.name AS curator_name
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
          status: rawSnapshot.visa.status as StudentPortalSnapshot["visa"]["status"],
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
    id: number; name: string; status: string; comment: string | null;
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
      c.stage, c.target_country
    FROM tasks t
    LEFT JOIN users a ON a.id = t.assignee_id
    LEFT JOIN clients c ON c.id = t.client_id
    LEFT JOIN users u ON u.id = c.user_id
    ${where}
    ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
             t.due_date IS NULL, t.due_date
  `).all(...params) as {
    id: number; title: string; description: string | null; due_date: string | null;
    status: string; priority: string; assignee_name: string | null;
    client_name: string | null; client_id: number | null;
    stage: Stage | null; target_country: string | null;
  }[];
}

export function listStaff() {
  return db().prepare("SELECT id, name, role FROM users WHERE role != 'client' ORDER BY name").all() as {
    id: number; name: string; role: string;
  }[];
}

export function allPayments() {
  return db().prepare(`
    SELECT p.*, u.name AS client_name, c.id AS client_id, c.stage, c.target_country,
      m.name AS manager_name
    FROM payments p
    JOIN clients c ON c.id = p.client_id
    JOIN users u ON u.id = c.user_id
    LEFT JOIN users m ON m.id = c.manager_id
    ORDER BY p.status = 'paid', p.due_date IS NULL, p.due_date
  `).all() as {
    id: number; title: string; amount: number; currency: string; due_date: string | null;
    paid_at: string | null; status: string; client_name: string; client_id: number;
    stage: Stage; target_country: string | null; manager_name: string | null;
  }[];
}

export type LeadRow = {
  id: number; name: string; phone: string | null; email: string | null;
  source: string | null; status: string; amount: number | null; currency: string;
  manager_id: number | null; client_id: number | null; target_country: string | null;
  notes: string | null; created_at: string; manager_name: string | null;
};

export function listLeads(): LeadRow[] {
  return db().prepare(`
    SELECT l.*, m.name AS manager_name
    FROM leads l LEFT JOIN users m ON m.id = l.manager_id
    ORDER BY l.updated_at DESC
  `).all() as LeadRow[];
}

export function getLead(id: number): LeadRow | undefined {
  return db().prepare(`
    SELECT l.*, m.name AS manager_name
    FROM leads l LEFT JOIN users m ON m.id = l.manager_id
    WHERE l.id = ?
  `).get(id) as LeadRow | undefined;
}

export function leadActivities(leadId: number) {
  return db().prepare(`
    SELECT a.*, u.name AS author_name
    FROM lead_activities a LEFT JOIN users u ON u.id = a.author_id
    WHERE a.lead_id = ? ORDER BY a.created_at DESC
  `).all(leadId) as { id: number; type: string; text: string; created_at: string; author_name: string | null }[];
}

export function salesReport() {
  const d = db();
  const byManager = d.prepare(`
    SELECT u.id, u.name,
      COUNT(l.id) AS leads,
      SUM(CASE WHEN l.status = 'won' THEN 1 ELSE 0 END) AS won,
      SUM(CASE WHEN l.status = 'lost' THEN 1 ELSE 0 END) AS lost,
      SUM(CASE WHEN l.status = 'won' THEN COALESCE(l.amount, 0) ELSE 0 END) AS won_amount
    FROM users u LEFT JOIN leads l ON l.manager_id = u.id
    WHERE u.role IN ('sales', 'admin')
    GROUP BY u.id HAVING leads > 0
    ORDER BY won_amount DESC
  `).all() as { id: number; name: string; leads: number; won: number; lost: number; won_amount: number }[];
  const byMonth = d.prepare(`
    SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS c
    FROM leads GROUP BY month ORDER BY month DESC LIMIT 12
  `).all() as { month: string; c: number }[];
  const bySource = d.prepare(`
    SELECT COALESCE(source, '—') AS source, COUNT(*) AS c,
      SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) AS won
    FROM leads GROUP BY source ORDER BY c DESC
  `).all() as { source: string; c: number; won: number }[];
  return { byManager, byMonth: byMonth.reverse(), bySource };
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
    SELECT c.*,
      (SELECT text FROM wa_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_text
    FROM wa_conversations c
    ORDER BY c.last_message_at DESC
  `).all() as {
    id: number; phone: string; name: string | null; lead_id: number | null;
    client_id: number | null; unread: number; last_text: string | null; last_message_at: string | null;
  }[];
}

export function getConversation(id: number) {
  return db().prepare("SELECT * FROM wa_conversations WHERE id = ?").get(id) as {
    id: number; phone: string; name: string | null; lead_id: number | null; client_id: number | null;
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

export function dashboardStats() {
  const d = db();
  const totalClients = (d.prepare("SELECT COUNT(*) c FROM clients WHERE stage != 'archived'").get() as { c: number }).c;
  const activeApps = (d.prepare("SELECT COUNT(*) c FROM applications WHERE status IN ('preparing','submitted')").get() as { c: number }).c;
  const openTasks = (d.prepare("SELECT COUNT(*) c FROM tasks WHERE status != 'done'").get() as { c: number }).c;
  const pendingPayments = (d.prepare("SELECT COUNT(*) c FROM payments WHERE status != 'paid'").get() as { c: number }).c;
  const activeLeads = (d.prepare("SELECT COUNT(*) c FROM leads WHERE status NOT IN ('won','lost')").get() as { c: number }).c;
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
