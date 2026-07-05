import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { randomBytes, scryptSync } from "crypto";

const dbPath = process.env.EVO_DB_PATH || join(process.cwd(), "data", "edu-admin.db");
const email = process.env.EVO_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.EVO_ADMIN_PASSWORD ?? "";
const name = process.env.EVO_ADMIN_NAME?.trim() || "EVO Admin";
const phone = process.env.EVO_ADMIN_PHONE?.trim() || null;

function hashPassword(value) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(value, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

if (!email || !email.includes("@")) {
  throw new Error("EVO_ADMIN_EMAIL must be set to a valid email address");
}

if (password.length < 12) {
  throw new Error("EVO_ADMIN_PASSWORD must be at least 12 characters");
}

mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    phone TEXT,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'client',
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
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'normal',
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
`);

const taskColumns = db.prepare("PRAGMA table_info(tasks)").all().map((column) => column.name);
if (!taskColumns.includes("priority")) {
  db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'");
}
if (!taskColumns.includes("lead_id")) {
  db.exec("ALTER TABLE tasks ADD COLUMN lead_id INTEGER REFERENCES leads(id)");
}

const existing = db.prepare("SELECT id, role FROM users WHERE lower(email) = ?").get(email);
if (existing) {
  db.prepare("UPDATE users SET role = 'admin', name = ?, phone = COALESCE(?, phone) WHERE id = ?").run(name, phone, existing.id);
  console.log(`Updated existing admin ${email} in ${dbPath}`);
} else {
  db.prepare("INSERT INTO users (email, phone, password_hash, name, role) VALUES (?, ?, ?, ?, 'admin')")
    .run(email, phone, hashPassword(password), name);
  console.log(`Created admin ${email} in ${dbPath}`);
}

db.close();
