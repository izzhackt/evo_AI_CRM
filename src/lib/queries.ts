import { db, Stage } from "./db";

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
    SELECT t.*, a.name AS assignee_name, u.name AS client_name, c.id AS client_id
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
  }[];
}

export function listStaff() {
  return db().prepare("SELECT id, name, role FROM users WHERE role != 'client' ORDER BY name").all() as {
    id: number; name: string; role: string;
  }[];
}

export function allPayments() {
  return db().prepare(`
    SELECT p.*, u.name AS client_name, c.id AS client_id
    FROM payments p
    JOIN clients c ON c.id = p.client_id
    JOIN users u ON u.id = c.user_id
    ORDER BY p.status = 'paid', p.due_date IS NULL, p.due_date
  `).all() as {
    id: number; title: string; amount: number; currency: string; due_date: string | null;
    paid_at: string | null; status: string; client_name: string; client_id: number;
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
  const openTasks = (d.prepare("SELECT COUNT(*) c FROM tasks WHERE status = 'open'").get() as { c: number }).c;
  const pendingPayments = (d.prepare("SELECT COUNT(*) c FROM payments WHERE status != 'paid'").get() as { c: number }).c;
  const byStage = d.prepare("SELECT stage, COUNT(*) c FROM clients GROUP BY stage").all() as { stage: Stage; c: number }[];
  const deadlines = d.prepare(`
    SELECT ap.university, ap.deadline, u.name AS client_name, c.id AS client_id
    FROM applications ap
    JOIN clients c ON c.id = ap.client_id
    JOIN users u ON u.id = c.user_id
    WHERE ap.deadline IS NOT NULL AND ap.status IN ('preparing','submitted')
    ORDER BY ap.deadline LIMIT 8
  `).all() as { university: string; deadline: string; client_name: string; client_id: number }[];
  return { totalClients, activeApps, openTasks, pendingPayments, byStage, deadlines };
}
