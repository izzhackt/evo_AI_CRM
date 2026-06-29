import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const dbPath = process.env.EVO_DB_PATH || join(process.cwd(), "data", "edu-admin.db");
const backupDir = process.env.EVO_BACKUP_DIR || join(process.cwd(), "backups");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
const backupPath = join(backupDir, `edu-admin-${stamp}.db`);

mkdirSync(dirname(backupPath), { recursive: true });

const db = new Database(dbPath, { readonly: true });
try {
  await db.backup(backupPath);
  console.log(`SQLite backup written to ${backupPath}`);
} finally {
  db.close();
}
