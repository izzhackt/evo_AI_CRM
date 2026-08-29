import { db, LEAD_ACTIVE_STATUSES, Stage } from "./db";
import {
  buildFullClientPredicate,
  buildVisaClientPredicate,
  buildVisibleClientPredicate,
  resolveClientAccess,
  type AccessActor,
  type ClientAccessMode,
} from "./access";
import type { StudentCaseAuditEvent, StudentCaseState } from "./student-case-policy";

const ACTIVE_LEAD_STATUS_SQL = LEAD_ACTIVE_STATUSES.map((status) => `'${status}'`).join(", ");
const ACTIVE_LEAD_SQL = `l.client_id IS NULL AND l.status IN (${ACTIVE_LEAD_STATUS_SQL})`;

export type ClientRow = {
  id: number;
  user_id: number;
  stage: Stage;
  manager_id: number | null;
  curator_id: number | null;
  case_state: StudentCaseState;
  contract_confirmed_at: string | null;
  contract_confirmation_ref: string | null;
  portal_activated_at: string | null;
  handoff_at: string | null;
  closed_at: string | null;
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
         ) AS overdue_payments
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

export function clientApplications(clientId: number) {
  return db().prepare("SELECT * FROM applications WHERE client_id = ? ORDER BY deadline IS NULL, deadline").all(clientId) as {
    id: number; university: string; country: string | null; program: string | null;
    degree: string | null; deadline: string | null; status: string; notes: string | null;
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

export function clientUpdates(clientId: number) {
  return db().prepare(`
    SELECT up.*, a.name AS author_name
    FROM updates up LEFT JOIN users a ON a.id = up.author_id
    WHERE up.client_id = ? ORDER BY up.created_at DESC
  `).all(clientId) as {
    id: number; message: string; created_at: string; author_name: string | null;
  }[];
}

export function listStaff() {
  return db().prepare(`
    SELECT id, name, email, role, created_at
    FROM users
    WHERE role IN ('admin', 'sales', 'curator', 'finance')
    ORDER BY name
  `).all() as {
    id: number; name: string; email: string; role: string; created_at: string;
  }[];
}

export function listCurators() {
  return db().prepare(`
    SELECT id, name, email, role, created_at
    FROM users
    WHERE role = 'curator'
    ORDER BY name
  `).all() as {
    id: number; name: string; email: string; role: "curator"; created_at: string;
  }[];
}

export type StudentCaseAuditRow = {
  id: number;
  client_id: number;
  actor_user_id: number;
  event_type: StudentCaseAuditEvent;
  reason: string;
  before_curator_id: number | null;
  after_curator_id: number | null;
  before_case_state: StudentCaseState;
  after_case_state: StudentCaseState;
  before_workflow_owner: "sales" | "curator";
  after_workflow_owner: "sales" | "curator";
  occurred_at: string;
  actor_name: string;
  before_curator_name: string | null;
  after_curator_name: string | null;
};

/** Caller must authorize the staff view before exposing audit reasons. */
export function studentCaseAudit(clientId: number): StudentCaseAuditRow[] {
  return db().prepare(`
    SELECT audit.*,
           actor.name AS actor_name,
           before_curator.name AS before_curator_name,
           after_curator.name AS after_curator_name
    FROM student_case_audit audit
    JOIN users actor ON actor.id = audit.actor_user_id
    LEFT JOIN users before_curator ON before_curator.id = audit.before_curator_id
    LEFT JOIN users after_curator ON after_curator.id = audit.after_curator_id
    WHERE audit.client_id = ?
    ORDER BY audit.occurred_at DESC, audit.id DESC
  `).all(clientId) as StudentCaseAuditRow[];
}

export type OperatorNotificationKind =
  | "task_overdue"
  | "task_priority"
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
function taskScopeForActor(actor: AccessActor, clientAlias = "c") {
  const clientScope = buildFullClientPredicate(actor, clientAlias);
  switch (actor.role) {
    case "admin":
      return { sql: "1 = 1", params: [] };
    case "sales":
      return {
        sql: `((t.client_id IS NULL AND t.assignee_id = ?) OR (t.client_id IS NOT NULL AND (${clientScope.sql})))`,
        params: [actor.id, ...clientScope.params],
      };
    case "curator":
      return {
        sql: `t.client_id IS NOT NULL AND (${clientScope.sql})`,
        params: clientScope.params,
      };
    case "finance":
      return {
        sql: "t.client_id IS NULL AND t.assignee_id = ?",
        params: [actor.id],
      };
    default:
      return { sql: "0 = 1", params: [] };
  }
}

export function listOperatorNotificationsForActor(
  actor: AccessActor,
  limit = OPERATOR_NOTIFICATION_LIMIT,
): OperatorNotification[] {
  const d = db();
  const items: OperatorNotification[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const sourceLimit = Math.max(0, limit);
  if (sourceLimit === 0) return items;
  const taskScope = taskScopeForActor(actor);

  const tasks = d.prepare(`
    SELECT t.id, t.title, t.due_date, t.priority,
      COALESCE(l.name, u.name) AS subject
    FROM tasks t
    LEFT JOIN leads l ON l.id = t.lead_id
    LEFT JOIN clients c ON c.id = t.client_id
    LEFT JOIN users u ON u.id = c.user_id
    WHERE t.status != 'done'
      AND (${taskScope.sql})
      AND (
        t.priority IN ('urgent', 'high')
        OR (t.due_date IS NOT NULL AND t.due_date <= date('now', '+7 days'))
      )
    ORDER BY t.due_date IS NULL, t.due_date
    LIMIT ?
  `).all(...taskScope.params, sourceLimit) as {
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

  if (["admin", "sales", "curator"].includes(actor.role)) {
    const clientScope = buildFullClientPredicate(actor, "c");
    const applications = d.prepare(`
      SELECT ap.id, ap.university, ap.deadline, u.name AS client_name
      FROM applications ap
      JOIN clients c ON c.id = ap.client_id
      JOIN users u ON u.id = c.user_id
      WHERE ap.status NOT IN ('enrolled', 'rejected')
        AND ap.deadline IS NOT NULL
        AND ap.deadline <= date('now', '+14 days')
        AND (${clientScope.sql})
      ORDER BY ap.deadline
      LIMIT ?
    `).all(...clientScope.params, sourceLimit) as {
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

  if (["admin", "finance"].includes(actor.role)) {
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

type FullClientAccessMode = Extract<
  ClientAccessMode,
  "admin_full" | "sales_full_pre_handoff" | "curator_full"
>;

export type FullClientAccessRow = ClientRow & {
  access_mode: FullClientAccessMode;
};

export type SalesPostHandoffClientSummary = {
  id: number;
  name: string;
  stage: Stage;
  target_country: string | null;
  target_degree: string | null;
  case_state: StudentCaseState;
  curator_name: string | null;
  handoff_at: string | null;
  access_mode: "sales_post_handoff_summary";
};

export type ActorClientRow = FullClientAccessRow | SalesPostHandoffClientSummary;

type ClientListOptions = {
  stage?: string;
  q?: string;
};

type ClientAccessProbe = {
  id: number;
  manager_id: number | null;
  curator_id: number | null;
  case_state: StudentCaseState;
  handoff_at: string | null;
  name: string;
  stage: Stage;
  target_country: string | null;
  target_degree: string | null;
  curator_name: string | null;
};

function fullClientAccessMode(actor: AccessActor): FullClientAccessMode | null {
  switch (actor.role) {
    case "admin":
      return "admin_full";
    case "sales":
      return "sales_full_pre_handoff";
    case "curator":
      return "curator_full";
    default:
      return null;
  }
}

function appendClientListFilters(
  where: string[],
  params: unknown[],
  opts: ClientListOptions,
) {
  if (opts.stage) {
    where.push("c.stage = ?");
    params.push(opts.stage);
  }
  if (opts.q) {
    where.push("(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)");
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
}

/**
 * Returns only rows the actor can see. Full rows and post-handoff Sales
 * summaries are selected separately so restricted columns never leave SQLite.
 */
export function listClientsForActor(
  actor: AccessActor,
  opts: ClientListOptions = {},
): ActorClientRow[] {
  const mode = fullClientAccessMode(actor);
  const fullRows: FullClientAccessRow[] = [];

  if (mode) {
    const fullScope = buildFullClientPredicate(actor, "c");
    const where = [`(${fullScope.sql})`];
    const params: unknown[] = [...fullScope.params];
    appendClientListFilters(where, params, opts);
    const fullSelect = CLIENT_SELECT.replace(
      "SELECT c.*",
      `SELECT c.*, '${mode}' AS access_mode`,
    );
    fullRows.push(
      ...(db()
        .prepare(`${fullSelect} WHERE ${where.join(" AND ")} ORDER BY c.created_at DESC`)
        .all(...params) as FullClientAccessRow[]),
    );
  }

  if (actor.role !== "sales") return fullRows;

  const visibleScope = buildVisibleClientPredicate(actor, "c");
  const fullScope = buildFullClientPredicate(actor, "c");
  const where = [`(${visibleScope.sql})`, `NOT (${fullScope.sql})`];
  const params: unknown[] = [...visibleScope.params, ...fullScope.params];
  if (opts.stage) {
    where.push("c.stage = ?");
    params.push(opts.stage);
  }
  if (opts.q) {
    where.push("u.name LIKE ?");
    params.push(`%${opts.q}%`);
  }

  const summaryRows = db().prepare(`
    SELECT c.id, u.name, c.stage, c.target_country, c.target_degree,
      c.case_state, cu.name AS curator_name, c.handoff_at,
      'sales_post_handoff_summary' AS access_mode
    FROM clients c
    JOIN users u ON u.id = c.user_id
    LEFT JOIN users cu ON cu.id = c.curator_id
    WHERE ${where.join(" AND ")}
    ORDER BY c.handoff_at DESC, c.id DESC
  `).all(...params) as SalesPostHandoffClientSummary[];

  return [...fullRows, ...summaryRows];
}

/**
 * Loads only a safe access probe first. Sensitive columns are queried only
 * after the actor has matched the full-access SQL predicate.
 */
export function getClientForActor(
  actor: AccessActor,
  id: number,
): ActorClientRow | undefined {
  const visibleScope = buildVisibleClientPredicate(actor, "c");
  const probe = db().prepare(`
    SELECT c.id, c.manager_id, c.curator_id, c.case_state, c.handoff_at,
      u.name, c.stage, c.target_country, c.target_degree,
      cu.name AS curator_name
    FROM clients c
    JOIN users u ON u.id = c.user_id
    LEFT JOIN users cu ON cu.id = c.curator_id
    WHERE c.id = ? AND (${visibleScope.sql})
  `).get(id, ...visibleScope.params) as ClientAccessProbe | undefined;
  if (!probe) return undefined;

  const accessMode = resolveClientAccess(actor, probe);
  if (accessMode === "sales_post_handoff_summary") {
    return {
      id: probe.id,
      name: probe.name,
      stage: probe.stage,
      target_country: probe.target_country,
      target_degree: probe.target_degree,
      case_state: probe.case_state,
      curator_name: probe.curator_name,
      handoff_at: probe.handoff_at,
      access_mode: accessMode,
    };
  }

  const mode = fullClientAccessMode(actor);
  if (!mode || accessMode !== mode) return undefined;
  const fullScope = buildFullClientPredicate(actor, "c");
  const fullSelect = CLIENT_SELECT.replace(
    "SELECT c.*",
    `SELECT c.*, '${mode}' AS access_mode`,
  );
  return db()
    .prepare(`${fullSelect} WHERE c.id = ? AND (${fullScope.sql})`)
    .get(id, ...fullScope.params) as FullClientAccessRow | undefined;
}

export type ClientApplicationRow = ReturnType<typeof clientApplications>[number];
export type ClientVisaRow = NonNullable<ReturnType<typeof clientVisaCase>>;
export type ClientPaymentRow = ReturnType<typeof clientPayments>[number];
export type ClientTaskRow = ReturnType<typeof clientTasks>[number];
export type ClientUpdateRow = ReturnType<typeof clientUpdates>[number];

export function clientApplicationsForActor(
  actor: AccessActor,
  clientId: number,
): ClientApplicationRow[] {
  const scope = buildFullClientPredicate(actor, "c");
  return db().prepare(`
    SELECT ap.*
    FROM applications ap
    JOIN clients c ON c.id = ap.client_id
    WHERE ap.client_id = ? AND (${scope.sql})
    ORDER BY ap.deadline IS NULL, ap.deadline
  `).all(clientId, ...scope.params) as ClientApplicationRow[];
}

export function clientVisaCaseForActor(
  actor: AccessActor,
  clientId: number,
): ClientVisaRow | undefined {
  const scope = buildVisaClientPredicate(actor, "c");
  return db().prepare(`
    SELECT v.*
    FROM visa_cases v
    JOIN clients c ON c.id = v.client_id
    WHERE v.client_id = ? AND (${scope.sql})
  `).get(clientId, ...scope.params) as ClientVisaRow | undefined;
}

export function clientPaymentsForActor(
  actor: AccessActor,
  clientId: number,
): ClientPaymentRow[] {
  return db().prepare(`
    SELECT p.*
    FROM payments p
    WHERE p.client_id = ?
      AND ? IN ('admin', 'finance')
    ORDER BY p.due_date IS NULL, p.due_date
  `).all(clientId, actor.role) as ClientPaymentRow[];
}

export function clientTasksForActor(
  actor: AccessActor,
  clientId: number,
): ClientTaskRow[] {
  const scope = buildFullClientPredicate(actor, "c");
  return db().prepare(`
    SELECT t.*, a.name AS assignee_name
    FROM tasks t
    JOIN clients c ON c.id = t.client_id
    LEFT JOIN users a ON a.id = t.assignee_id
    WHERE t.client_id = ? AND (${scope.sql})
    ORDER BY t.status = 'done',
      CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      t.due_date IS NULL, t.due_date
  `).all(clientId, ...scope.params) as ClientTaskRow[];
}

export function clientUpdatesForActor(
  actor: AccessActor,
  clientId: number,
): ClientUpdateRow[] {
  const scope = buildFullClientPredicate(actor, "c");
  return db().prepare(`
    SELECT up.*, a.name AS author_name
    FROM updates up
    JOIN clients c ON c.id = up.client_id
    LEFT JOIN users a ON a.id = up.author_id
    WHERE up.client_id = ? AND (${scope.sql})
    ORDER BY up.created_at DESC
  `).all(clientId, ...scope.params) as ClientUpdateRow[];
}

export function studentCaseAuditForActor(
  actor: AccessActor,
  clientId: number,
): StudentCaseAuditRow[] {
  if (actor.role !== "admin" && actor.role !== "curator") return [];
  const scope = buildFullClientPredicate(actor, "c");
  return db().prepare(`
    SELECT audit.*,
      audit_actor.name AS actor_name,
      before_curator.name AS before_curator_name,
      after_curator.name AS after_curator_name
    FROM student_case_audit audit
    JOIN clients c ON c.id = audit.client_id
    JOIN users audit_actor ON audit_actor.id = audit.actor_user_id
    LEFT JOIN users before_curator ON before_curator.id = audit.before_curator_id
    LEFT JOIN users after_curator ON after_curator.id = audit.after_curator_id
    WHERE audit.client_id = ? AND (${scope.sql})
    ORDER BY audit.occurred_at DESC, audit.id DESC
  `).all(clientId, ...scope.params) as StudentCaseAuditRow[];
}

export type LeadRow = {
  id: number; name: string; phone: string | null; email: string | null;
  source: string | null; status: string; amount: number | null; currency: string;
  manager_id: number | null; client_id: number | null; target_country: string | null;
  notes: string | null; created_at: string; updated_at: string; manager_name: string | null;
  open_tasks: number; overdue_tasks: number; next_task_due_date: string | null;
  next_task_title: string | null; last_activity_at: string | null; last_call_at: string | null;
  last_touch_at: string | null; last_channel: string | null; call_count: number;
};

type LeadBaseRow = Omit<
  LeadRow,
  "last_touch_at" | "last_channel"
>;

function leadBaseRows(id?: number): LeadBaseRow[] {
  const where = id === undefined ? "" : "WHERE l.id = ?";
  const params = id === undefined ? [] : [id];
  return db().prepare(`
    SELECT l.*, m.name AS manager_name,
      (SELECT COUNT(*) FROM tasks t WHERE t.status != 'done' AND (t.lead_id = l.id OR (l.client_id IS NOT NULL AND t.client_id = l.client_id))) AS open_tasks,
      (SELECT COUNT(*) FROM tasks t WHERE t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date < date('now') AND (t.lead_id = l.id OR (l.client_id IS NOT NULL AND t.client_id = l.client_id))) AS overdue_tasks,
      (SELECT t.due_date FROM tasks t WHERE t.status != 'done' AND (t.lead_id = l.id OR (l.client_id IS NOT NULL AND t.client_id = l.client_id)) ORDER BY t.due_date IS NULL, t.due_date LIMIT 1) AS next_task_due_date,
      (SELECT t.title FROM tasks t WHERE t.status != 'done' AND (t.lead_id = l.id OR (l.client_id IS NOT NULL AND t.client_id = l.client_id)) ORDER BY t.due_date IS NULL, t.due_date LIMIT 1) AS next_task_title,
      (SELECT MAX(a.created_at) FROM lead_activities a WHERE a.lead_id = l.id) AS last_activity_at,
      (SELECT MAX(c.started_at) FROM calls c WHERE c.lead_id = l.id) AS last_call_at,
      (SELECT COUNT(*) FROM calls c WHERE c.lead_id = l.id) AS call_count
    FROM leads l
    LEFT JOIN users m ON m.id = l.manager_id
    ${where}
    ORDER BY l.updated_at DESC
  `).all(...params) as LeadBaseRow[];
}

function latestTimestamp(
  ...values: Array<string | null>
): string | null {
  const present = values.filter((value): value is string => value !== null);
  return present.length === 0 ? null : present.sort().at(-1) ?? null;
}

function lastLeadChannel(
  row: LeadBaseRow,
): string | null {
  if (
    row.last_call_at !== null
    && (
      row.last_activity_at === null
      || row.last_call_at >= row.last_activity_at
    )
  ) {
    return "Call";
  }
  return row.last_activity_at === null ? null : "CRM";
}

function mergeLeadActivityMetrics(
  baseRows: LeadBaseRow[],
): LeadRow[] {
  return baseRows.map((row) => ({
    ...row,
    last_touch_at: latestTimestamp(
      row.last_activity_at,
      row.last_call_at,
      row.updated_at,
    ),
    last_channel: lastLeadChannel(row),
  }));
}

export function listLeadsForActor(actor: AccessActor): LeadRow[] {
  void actor;
  return mergeLeadActivityMetrics(leadBaseRows());
}

export function getLeadForActor(
  actor: AccessActor,
  id: number,
): LeadRow | undefined {
  void actor;
  return mergeLeadActivityMetrics(leadBaseRows(id))[0];
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

export function salesCockpitStatsForActor(actor: AccessActor) {
  void actor;
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
      (SELECT COUNT(*) FROM calls c WHERE c.manager_id = u.id) AS calls
    FROM users u
    LEFT JOIN leads l ON l.manager_id = u.id
    WHERE u.role IN ('sales', 'admin')
    GROUP BY u.id
    HAVING deals > 0 OR signed > 0
    ORDER BY no_task DESC, deals DESC
    LIMIT 6
  `).all() as {
    id: number;
    name: string;
    deals: number;
    value: number;
    signed: number;
    no_task: number;
    calls: number;
  }[];
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

  const scopedManagerRows = managerRows.map((row) => ({
    ...row,
    messages: null,
  }));
  const channelActivity = {
    incomingCalls: (d.prepare("SELECT COUNT(*) c FROM calls WHERE direction = 'in'").get() as { c: number }).c,
    outgoingCalls: (d.prepare("SELECT COUNT(*) c FROM calls WHERE direction = 'out'").get() as { c: number }).c,
    incomingMessages: null,
    outgoingMessages: null,
    unreadConversations: null,
    avgResponseMinutes: null,
  };
  return {
    dealsWithoutTasks,
    overdueLeadTasks,
    managerRows: scopedManagerRows,
    sourceRows,
    channelActivity,
  };
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

export function dashboardStatsForActor(actor: AccessActor) {
  const d = db();
  const clientScope = buildFullClientPredicate(actor, "c");
  const taskScope = taskScopeForActor(actor);
  const canReadLeadOperations = actor.role === "admin" || actor.role === "sales";
  const canReadFinanceProjection = actor.role === "admin" || actor.role === "finance";
  const count = (sql: string, params: Array<string | number> = []) =>
    (d.prepare(sql).get(...params) as { c: number }).c;

  const totalClients = count(
    `SELECT COUNT(*) c FROM clients c
     WHERE c.stage != 'archived' AND (${clientScope.sql})`,
    clientScope.params,
  );
  const activeApps = count(
    `SELECT COUNT(*) c
     FROM applications ap
     JOIN clients c ON c.id = ap.client_id
     WHERE ap.status IN ('preparing','submitted') AND (${clientScope.sql})`,
    clientScope.params,
  );
  const openTasks = count(
    `SELECT COUNT(*) c
     FROM tasks t
     LEFT JOIN clients c ON c.id = t.client_id
     WHERE t.status != 'done' AND (${taskScope.sql})`,
    taskScope.params,
  );
  const pendingPayments = canReadFinanceProjection
    ? count("SELECT COUNT(*) c FROM payments WHERE status != 'paid'")
    : 0;
  const activeLeads = canReadLeadOperations
    ? count(`SELECT COUNT(*) c FROM leads l WHERE ${ACTIVE_LEAD_SQL}`)
    : 0;
  const overduePayments = canReadFinanceProjection
    ? count("SELECT COUNT(*) c FROM payments WHERE status != 'paid' AND due_date IS NOT NULL AND due_date < date('now')")
    : 0;
  const urgentTasks = count(
    `SELECT COUNT(*) c
     FROM tasks t
     LEFT JOIN clients c ON c.id = t.client_id
     WHERE t.status != 'done'
       AND t.priority IN ('high','urgent')
       AND (${taskScope.sql})`,
    taskScope.params,
  );
  const byStage = d.prepare(`
    SELECT c.stage, COUNT(*) c
    FROM clients c
    WHERE ${clientScope.sql}
    GROUP BY c.stage
  `).all(...clientScope.params) as { stage: Stage; c: number }[];
  const byLeadStatus = canReadLeadOperations
    ? d.prepare("SELECT status, COUNT(*) c FROM leads GROUP BY status").all() as { status: string; c: number }[]
    : [];
  const byApplicationStatus = d.prepare(`
    SELECT ap.status, COUNT(*) c
    FROM applications ap
    JOIN clients c ON c.id = ap.client_id
    WHERE ${clientScope.sql}
    GROUP BY ap.status
  `).all(...clientScope.params) as { status: string; c: number }[];
  const byTaskStatus = d.prepare(`
    SELECT t.status, COUNT(*) c
    FROM tasks t
    LEFT JOIN clients c ON c.id = t.client_id
    WHERE ${taskScope.sql}
    GROUP BY t.status
  `).all(...taskScope.params) as { status: string; c: number }[];
  const byPaymentStatus = canReadFinanceProjection
    ? d.prepare(`
      SELECT CASE
        WHEN status != 'paid' AND due_date IS NOT NULL AND due_date < date('now') THEN 'overdue'
        ELSE status
      END AS status, COUNT(*) c
      FROM payments
      GROUP BY CASE
        WHEN status != 'paid' AND due_date IS NOT NULL AND due_date < date('now') THEN 'overdue'
        ELSE status
      END
    `).all() as { status: string; c: number }[]
    : [];
  const deadlines = d.prepare(`
    SELECT ap.university, ap.deadline, ap.status, u.name AS client_name, c.id AS client_id
    FROM applications ap
    JOIN clients c ON c.id = ap.client_id
    JOIN users u ON u.id = c.user_id
    WHERE ap.deadline IS NOT NULL
      AND ap.status IN ('preparing','submitted')
      AND (${clientScope.sql})
    ORDER BY ap.deadline LIMIT 8
  `).all(...clientScope.params) as { university: string; deadline: string; status: string; client_name: string; client_id: number }[];
  return {
    totalClients,
    activeApps,
    openTasks,
    pendingPayments,
    activeLeads,
    overduePayments,
    urgentTasks,
    byStage,
    byLeadStatus,
    byApplicationStatus,
    byTaskStatus,
    byPaymentStatus,
    deadlines,
  };
}
