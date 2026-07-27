import Database from "better-sqlite3";
import path from "path";
import { scryptSync, randomBytes } from "crypto";
import { decryptRuntimeSecret, encryptRuntimeSecret } from "./secret-storage";
export type { Role } from "./roles";
export {
  EVO_AMO_PIPELINE_ID,
  LEAD_ACTIVE_STATUSES,
  LEAD_STAGE_DEFINITIONS,
  LEAD_STATUSES,
  LEAD_TERMINAL_STATUSES,
  isActiveLeadStatus,
} from "./lead-stages";
export type { LeadStatus } from "./lead-stages";

export const STAGES = [
  "lead",
  "consultation",
  "contract",
  "documents",
  "applying",
  "offer",
  "visa",
  "enrolled",
  "archived",
] as const;
export type Stage = (typeof STAGES)[number];

export const APP_STATUSES = ["preparing", "submitted", "offer", "rejected", "enrolled"] as const;
export const DOC_STATUSES = ["required", "uploaded", "review", "approved", "rejected"] as const;
export const VISA_STATUSES = ["not_started", "docs", "appointment", "submitted", "approved", "rejected"] as const;
export const PAYMENT_STATUSES = ["pending", "paid", "overdue"] as const;

export const TASK_COLUMNS = ["todo", "in_progress", "review", "done"] as const;
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  return scryptSync(password, salt, 64).toString("hex") === hash;
}

let _db: Database.Database | null = null;
const SECRET_SETTING_KEYS = new Set([
  "wa_token",
  "wa_verify_token",
  "wa_app_secret",
  "waha_api_key",
  "waha_webhook_secret",
  "tel_api_key",
  "anthropic_api_key",
  "amocrm_client_secret",
  "amocrm_refresh_token",
  "lead_agent_sync_secret",
]);

export function db(): Database.Database {
  if (_db) return _db;
  const file = process.env.EVO_DB_PATH || path.join(process.cwd(), "data", "edu-admin.db");
  _db = new Database(file);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  init(_db);
  return _db;
}

function init(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'client'
        CHECK (role IN ('admin', 'sales', 'curator', 'finance', 'client')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
      stage TEXT NOT NULL DEFAULT 'lead',
      manager_id INTEGER REFERENCES users(id),
      curator_id INTEGER REFERENCES users(id),
      source TEXT,
      target_country TEXT,
      target_degree TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id),
      university TEXT NOT NULL,
      country TEXT,
      program TEXT,
      degree TEXT,
      deadline TEXT,
      status TEXT NOT NULL DEFAULT 'preparing',
      notes TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id),
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'required',
      comment TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS visa_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id),
      country TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'not_started',
      appointment_at TEXT,
      notes TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id),
      title TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'KGS',
      due_date TEXT,
      paid_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      lead_id INTEGER REFERENCES leads(id),
      client_id INTEGER REFERENCES clients(id),
      assignee_id INTEGER REFERENCES users(id),
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id),
      author_id INTEGER REFERENCES users(id),
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_read INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      source TEXT,
      status TEXT NOT NULL DEFAULT 'processing_mp',
      amount REAL,
      currency TEXT NOT NULL DEFAULT 'KGS',
      manager_id INTEGER REFERENCES users(id),
      client_id INTEGER REFERENCES clients(id),
      target_country TEXT,
      notes TEXT,
      amo_lead_id INTEGER,
      amo_contact_id INTEGER,
      agent_state TEXT,
      agent_summary TEXT,
      agent_handoff_reason TEXT,
      agent_draft_review_text TEXT,
      agent_draft_review_status TEXT,
      agent_draft_review_provider TEXT,
      agent_draft_review_model TEXT,
      agent_last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lead_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES leads(id),
      author_id INTEGER REFERENCES users(id),
      type TEXT NOT NULL DEFAULT 'note',
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS channel_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL REFERENCES channels(id),
      author_id INTEGER NOT NULL REFERENCES users(id),
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wa_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL DEFAULT 'meta',
      name TEXT NOT NULL,
      session_name TEXT,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'not_configured',
      owner_user_id INTEGER REFERENCES users(id),
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wa_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_account_id INTEGER REFERENCES wa_accounts(id),
      phone TEXT NOT NULL,
      name TEXT,
      lead_id INTEGER REFERENCES leads(id),
      client_id INTEGER REFERENCES clients(id),
      amo_lead_id INTEGER,
      amo_contact_id INTEGER,
      agent_state TEXT,
      agent_summary TEXT,
      agent_handoff_reason TEXT,
      agent_draft_review_text TEXT,
      agent_draft_review_status TEXT,
      agent_draft_review_provider TEXT,
      agent_draft_review_model TEXT,
      agent_last_synced_at TEXT,
      last_message_at TEXT,
      unread INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS wa_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES wa_conversations(id),
      direction TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'demo',
      author_id INTEGER REFERENCES users(id),
      wa_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL,
      phone TEXT NOT NULL,
      manager_id INTEGER REFERENCES users(id),
      lead_id INTEGER REFERENCES leads(id),
      client_id INTEGER REFERENCES clients(id),
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      duration_sec INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'answered',
      recording_url TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  migrate(d);
  seed(d);
  seedV2(d);
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS wa_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL DEFAULT 'meta',
      name TEXT NOT NULL,
      session_name TEXT,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'not_configured',
      owner_user_id INTEGER REFERENCES users(id),
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  migrateWhatsAppConversations(d);
  const taskCols = (d.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).map((c) => c.name);
  if (!taskCols.includes("priority")) {
    d.exec("ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'");
  }
  if (!taskCols.includes("lead_id")) {
    d.exec("ALTER TABLE tasks ADD COLUMN lead_id INTEGER REFERENCES leads(id)");
  }
  addColumnIfMissing(d, "leads", "amo_lead_id", "INTEGER");
  addColumnIfMissing(d, "leads", "amo_contact_id", "INTEGER");
  addColumnIfMissing(d, "leads", "agent_state", "TEXT");
  addColumnIfMissing(d, "leads", "agent_summary", "TEXT");
  addColumnIfMissing(d, "leads", "agent_handoff_reason", "TEXT");
  addColumnIfMissing(d, "leads", "agent_draft_review_text", "TEXT");
  addColumnIfMissing(d, "leads", "agent_draft_review_status", "TEXT");
  addColumnIfMissing(d, "leads", "agent_draft_review_provider", "TEXT");
  addColumnIfMissing(d, "leads", "agent_draft_review_model", "TEXT");
  addColumnIfMissing(d, "leads", "agent_last_synced_at", "TEXT");
  addColumnIfMissing(d, "wa_conversations", "amo_lead_id", "INTEGER");
  addColumnIfMissing(d, "wa_conversations", "amo_contact_id", "INTEGER");
  addColumnIfMissing(d, "wa_conversations", "agent_state", "TEXT");
  addColumnIfMissing(d, "wa_conversations", "agent_summary", "TEXT");
  addColumnIfMissing(d, "wa_conversations", "agent_handoff_reason", "TEXT");
  addColumnIfMissing(d, "wa_conversations", "agent_draft_review_text", "TEXT");
  addColumnIfMissing(d, "wa_conversations", "agent_draft_review_status", "TEXT");
  addColumnIfMissing(d, "wa_conversations", "agent_draft_review_provider", "TEXT");
  addColumnIfMissing(d, "wa_conversations", "agent_draft_review_model", "TEXT");
  addColumnIfMissing(d, "wa_conversations", "agent_last_synced_at", "TEXT");
  // tasks status values moved from open/done to todo/in_progress/review/done
  d.exec("UPDATE tasks SET status = 'todo' WHERE status = 'open'");
  d.exec(`
    UPDATE leads SET status = CASE status
      WHEN 'new' THEN 'processing_mp'
      WHEN 'contacted' THEN 'qualified'
      WHEN 'meeting' THEN 'meeting_scheduled'
      WHEN 'proposal' THEN 'meeting_done'
      WHEN 'won' THEN 'contract_signed'
      WHEN 'lost' THEN 'no_request'
      ELSE status
    END
    WHERE status IN ('new', 'contacted', 'meeting', 'proposal', 'won', 'lost')
  `);
  d.exec(`
    UPDATE lead_activities SET text = CASE text
      WHEN 'new' THEN 'processing_mp'
      WHEN 'contacted' THEN 'qualified'
      WHEN 'meeting' THEN 'meeting_scheduled'
      WHEN 'proposal' THEN 'meeting_done'
      WHEN 'won' THEN 'contract_signed'
      WHEN 'lost' THEN 'no_request'
      ELSE text
    END
    WHERE type = 'status' AND text IN ('new', 'contacted', 'meeting', 'proposal', 'won', 'lost')
  `);
  d.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_accounts_provider_session
      ON wa_accounts(provider, session_name)
      WHERE session_name IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_conversations_account_phone
      ON wa_conversations(wa_account_id, phone)
      WHERE wa_account_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_conversations_legacy_phone
      ON wa_conversations(phone)
      WHERE wa_account_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_messages_wa_id
      ON wa_messages(wa_id)
      WHERE wa_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_amo_lead_id
      ON leads(amo_lead_id)
      WHERE amo_lead_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_leads_amo_contact_id
      ON leads(amo_contact_id)
      WHERE amo_contact_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_wa_conversations_amo_lead_id
      ON wa_conversations(amo_lead_id)
      WHERE amo_lead_id IS NOT NULL;

    CREATE TRIGGER IF NOT EXISTS users_role_insert_guard
    BEFORE INSERT ON users
    WHEN NEW.role NOT IN ('admin', 'sales', 'curator', 'finance', 'client')
    BEGIN
      SELECT RAISE(ABORT, 'unsupported user role');
    END;

    CREATE TRIGGER IF NOT EXISTS users_role_update_guard
    BEFORE UPDATE OF role ON users
    WHEN NEW.role NOT IN ('admin', 'sales', 'curator', 'finance', 'client')
    BEGIN
      SELECT RAISE(ABORT, 'unsupported user role');
    END;
  `);
}

function addColumnIfMissing(
  d: Database.Database,
  table: string,
  column: string,
  definition: string,
) {
  const cols = (d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  );
  if (!cols.includes(column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateWhatsAppConversations(d: Database.Database) {
  const cols = (d.prepare("PRAGMA table_info(wa_conversations)").all() as { name: string }[]).map((c) => c.name);
  const indexes = d.prepare("PRAGMA index_list(wa_conversations)").all() as { name: string; origin: string }[];
  const hasAccountId = cols.includes("wa_account_id");
  const hasTableUniquePhone = indexes.some((idx) => idx.origin === "u");
  if (!hasAccountId && !hasTableUniquePhone) {
    d.exec("ALTER TABLE wa_conversations ADD COLUMN wa_account_id INTEGER REFERENCES wa_accounts(id)");
    return;
  }
  if (!hasTableUniquePhone) return;

  d.pragma("foreign_keys = OFF");
  try {
    d.exec(`
      CREATE TABLE IF NOT EXISTS wa_conversations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wa_account_id INTEGER REFERENCES wa_accounts(id),
        phone TEXT NOT NULL,
        name TEXT,
        lead_id INTEGER REFERENCES leads(id),
        client_id INTEGER REFERENCES clients(id),
        amo_lead_id INTEGER,
        amo_contact_id INTEGER,
        agent_state TEXT,
        agent_summary TEXT,
        agent_handoff_reason TEXT,
        agent_draft_review_text TEXT,
        agent_draft_review_status TEXT,
        agent_draft_review_provider TEXT,
        agent_draft_review_model TEXT,
        agent_last_synced_at TEXT,
        last_message_at TEXT,
        unread INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO wa_conversations_new (
        id, wa_account_id, phone, name, lead_id, client_id, last_message_at, unread
      )
        SELECT
          id, ${hasAccountId ? "wa_account_id" : "NULL"}, phone, name, lead_id, client_id,
          last_message_at, unread
        FROM wa_conversations;
      DROP TABLE wa_conversations;
      ALTER TABLE wa_conversations_new RENAME TO wa_conversations;
    `);
  } finally {
    d.pragma("foreign_keys = ON");
  }
}

export function getSetting(key: string): string | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return null;
  return SECRET_SETTING_KEYS.has(key) ? decryptRuntimeSecret(key, row.value) : row.value;
}

export function setSetting(key: string, value: string) {
  const storedValue = SECRET_SETTING_KEYS.has(key) ? encryptRuntimeSecret(key, value) : value;
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, storedValue);
}

function seed(d: Database.Database) {
  const count = d.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  if (count.c > 0) return;
  if (process.env.NODE_ENV === "production" && process.env.EVO_ALLOW_DEMO_SEED !== "1") return;

  const insertUser = d.prepare(
    "INSERT INTO users (email, phone, password_hash, name, role) VALUES (?, ?, ?, ?, ?)"
  );

  const admin = insertUser.run("admin@demo.kg", "+996700000001", hashPassword("admin123"), "Айгуль Асанова", "admin");
  const sales = insertUser.run("sales@demo.kg", "+996700000002", hashPassword("sales123"), "Бакыт Жумалиев", "sales");
  const curator = insertUser.run("curator@demo.kg", "+996700000003", hashPassword("curator123"), "Динара Токтогулова", "curator");
  insertUser.run("finance@demo.kg", "+996700000005", hashPassword("finance123"), "Гульнара Орозова", "finance");

  const clientUser1 = insertUser.run("client@demo.kg", "+996555111222", hashPassword("client123"), "Нурлан Абдыкадыров", "client");
  const clientUser2 = insertUser.run("aizhan@demo.kg", "+996555333444", hashPassword("client123"), "Айжан Мамытова", "client");

  const insertClient = d.prepare(
    "INSERT INTO clients (user_id, stage, manager_id, curator_id, source, target_country, target_degree, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const c1 = insertClient.run(
    clientUser1.lastInsertRowid, "applying", sales.lastInsertRowid, curator.lastInsertRowid,
    "Instagram", "Германия", "Бакалавриат", "Сильный английский (IELTS 7.0), интересуется Computer Science"
  );
  const c2 = insertClient.run(
    clientUser2.lastInsertRowid, "consultation", sales.lastInsertRowid, null,
    "Рекомендация", "США", "Магистратура", "Нужна стипендия, рассматривает Fulbright"
  );

  const insertApp = d.prepare(
    "INSERT INTO applications (client_id, university, country, program, degree, deadline, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  insertApp.run(c1.lastInsertRowid, "TU München", "Германия", "Informatics", "Бакалавриат", "2026-07-15", "submitted");
  insertApp.run(c1.lastInsertRowid, "RWTH Aachen", "Германия", "Computer Science", "Бакалавриат", "2026-07-15", "preparing");

  const insertDoc = d.prepare("INSERT INTO documents (client_id, name, status) VALUES (?, ?, ?)");
  insertDoc.run(c1.lastInsertRowid, "Аттестат (нотариальный перевод)", "approved");
  insertDoc.run(c1.lastInsertRowid, "Сертификат IELTS", "approved");
  insertDoc.run(c1.lastInsertRowid, "Мотивационное письмо", "review");
  insertDoc.run(c1.lastInsertRowid, "Рекомендательное письмо", "required");
  insertDoc.run(c2.lastInsertRowid, "Диплом бакалавра", "required");

  d.prepare("INSERT INTO visa_cases (client_id, country, status, notes) VALUES (?, ?, ?, ?)")
    .run(c1.lastInsertRowid, "Германия", "not_started", "Начнём после получения оффера");

  const insertPayment = d.prepare(
    "INSERT INTO payments (client_id, title, amount, currency, due_date, paid_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  insertPayment.run(c1.lastInsertRowid, "Консалтинговый пакет — 1-й взнос", 50000, "KGS", "2026-03-01", "2026-02-25", "paid");
  insertPayment.run(c1.lastInsertRowid, "Консалтинговый пакет — 2-й взнос", 50000, "KGS", "2026-07-01", null, "pending");
  insertPayment.run(c2.lastInsertRowid, "Первичная консультация", 3000, "KGS", "2026-06-15", null, "pending");

  const insertTask = d.prepare(
    "INSERT INTO tasks (title, description, client_id, assignee_id, due_date, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  insertTask.run(
    "Проверить мотивационное письмо", "Нурлан загрузил новую версию, нужна вычитка",
    c1.lastInsertRowid, curator.lastInsertRowid, "2026-06-12", "open", admin.lastInsertRowid
  );
  insertTask.run(
    "Подготовить договор для Айжан", null,
    c2.lastInsertRowid, sales.lastInsertRowid, "2026-06-14", "open", admin.lastInsertRowid
  );

  const insertUpdate = d.prepare("INSERT INTO updates (client_id, author_id, message) VALUES (?, ?, ?)");
  insertUpdate.run(c1.lastInsertRowid, curator.lastInsertRowid, "Заявка в TU München отправлена! Ожидаем ответ в течение 4–6 недель.");
  insertUpdate.run(c1.lastInsertRowid, curator.lastInsertRowid, "Аттестат и IELTS приняты. Осталось рекомендательное письмо — напомните, пожалуйста, вашему учителю.");
  insertUpdate.run(c2.lastInsertRowid, sales.lastInsertRowid, "Добро пожаловать! Ваша первичная консультация назначена, скоро свяжемся для подтверждения времени.");
}

function seedV2(d: Database.Database) {
  const count = d.prepare("SELECT COUNT(*) AS c FROM leads").get() as { c: number };
  if (count.c > 0) return;
  if (process.env.NODE_ENV === "production" && process.env.EVO_ALLOW_DEMO_SEED !== "1") return;

  const ids = (email: string) =>
    (d.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: number } | undefined)?.id ?? null;
  const admin = ids("admin@demo.kg");
  const sales = ids("sales@demo.kg");
  const curator = ids("curator@demo.kg");

  const insertLead = d.prepare(
    "INSERT INTO leads (name, phone, email, source, status, amount, currency, manager_id, target_country, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const l1 = insertLead.run("Темирлан Касымов", "+996700123456", "temirlan@mail.kg", "Instagram", "processing_mp", 120000, "KGS", sales, "Германия", "Спросил про бесплатное обучение в Германии");
  const l2 = insertLead.run("Асель Бекова", "+996555654321", null, "Сайт", "qualified", 150000, "KGS", sales, "США", "11 класс, хочет Computer Science");
  const l3 = insertLead.run("Чынгыз Алиев", "+996777888999", null, "Рекомендация", "meeting_scheduled", 100000, "KGS", sales, "Турция", "Встреча в офисе в четверг");
  insertLead.run("Мээрим Садыкова", "+996505111333", "meerim@gmail.com", "Instagram", "meeting_done", 180000, "KGS", sales, "Великобритания", "Отправлен пакет «Премиум»");
  insertLead.run("Айбек Токтосунов", "+996700555666", null, "WhatsApp", "contract_signed", 150000, "KGS", sales, "Германия", "Договор подписан");
  insertLead.run("Жылдыз Омурова", "+996555000777", null, "Сайт", "no_request", 120000, "KGS", sales, "США", "Выбрала другое агентство");

  const insertActivity = d.prepare(
    "INSERT INTO lead_activities (lead_id, author_id, type, text) VALUES (?, ?, ?, ?)"
  );
  insertActivity.run(l1.lastInsertRowid, sales, "note", "Написал в директ, интересуется учёбой в Германии после 11 класса");
  insertActivity.run(l2.lastInsertRowid, sales, "call", "Позвонил, договорились о консультации на следующей неделе");

  const insertLeadTask = d.prepare(
    "INSERT INTO tasks (title, description, lead_id, assignee_id, due_date, status, created_by, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  insertLeadTask.run("Ответить на заявку из Instagram", "Уточнить класс, бюджет и страну", l1.lastInsertRowid, sales, "2026-06-26", "todo", admin, "high");
  insertLeadTask.run("Подтвердить встречу", null, l3.lastInsertRowid, sales, "2026-06-24", "todo", admin, "urgent");

  const insertChannel = d.prepare("INSERT INTO channels (name, description, created_by) VALUES (?, ?, ?)");
  const chGeneral = insertChannel.run("общий", "Общий канал команды", admin);
  const chSales = insertChannel.run("продажи", "Лиды, сделки, планы", admin);
  insertChannel.run("кураторы", "Сопровождение поступления", admin);

  const insertMsg = d.prepare("INSERT INTO channel_messages (channel_id, author_id, text) VALUES (?, ?, ?)");
  insertMsg.run(chGeneral.lastInsertRowid, admin, "Всем привет! Это наш новый внутренний чат — теперь общаемся здесь, а не в десяти разных мессенджерах 🎉");
  insertMsg.run(chGeneral.lastInsertRowid, curator, "Отлично! Сразу вопрос: куда писать по визовым кейсам?");
  insertMsg.run(chGeneral.lastInsertRowid, admin, "Создала канал #кураторы, визовые вопросы туда");
  insertMsg.run(chSales.lastInsertRowid, sales, "За неделю 4 новых лида с Instagram, 1 договор подписан 💪");

  const insertConv = d.prepare(
    "INSERT INTO wa_conversations (phone, name, lead_id, last_message_at, unread) VALUES (?, ?, ?, datetime('now'), ?)"
  );
  const conv1 = insertConv.run("+996700123456", "Темирлан Касымов", l1.lastInsertRowid, 1);
  const conv2 = insertConv.run("+996555654321", "Асель Бекова", l2.lastInsertRowid, 0);

  const insertWa = d.prepare(
    "INSERT INTO wa_messages (conversation_id, direction, text, status, author_id) VALUES (?, ?, ?, ?, ?)"
  );
  insertWa.run(conv1.lastInsertRowid, "in", "Здравствуйте! Видел ваш пост про обучение в Германии. Сколько стоят ваши услуги?", "demo", null);
  insertWa.run(conv2.lastInsertRowid, "in", "Добрый день, дочка в 11 классе, хотим в США на Computer Science", "demo", null);
  insertWa.run(conv2.lastInsertRowid, "out", "Добрый день! Отличный выбор. Приглашаем на бесплатную консультацию — расскажем про стипендии и подготовку к SAT. Когда вам удобно?", "demo", sales);

  const insertCall = d.prepare(
    "INSERT INTO calls (direction, phone, manager_id, lead_id, started_at, duration_sec, status, notes) VALUES (?, ?, ?, ?, datetime('now', ?), ?, ?, ?)"
  );
  insertCall.run("out", "+996555654321", sales, l2.lastInsertRowid, "-2 hours", 420, "answered", "Договорились о консультации");
  insertCall.run("in", "+996777888999", sales, null, "-1 day", 0, "missed", null);
  insertCall.run("in", "+996700123456", sales, l1.lastInsertRowid, "-3 hours", 180, "answered", "Спрашивал про цены");
}
