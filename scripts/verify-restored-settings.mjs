import Database from "better-sqlite3";
import { resolve } from "node:path";
import { decryptRuntimeSecret } from "../src/lib/secret-storage.ts";

const dbPath = process.argv[2];
if (!dbPath?.startsWith("/")) {
  throw new Error("an absolute isolated SQLite path is required");
}
if (["/opt/evo-crm", "/opt/evo-inbox", "/var/lib/docker"].some((root) => resolve(dbPath).startsWith(`${root}/`))) {
  throw new Error("production database targets are forbidden");
}

const secretNames = new Set([
  "wa_app_secret",
  "waha_api_key",
  "waha_webhook_secret",
  "amocrm_access_token",
  "amocrm_client_secret",
  "lead_agent_sync_secret",
]);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
let ciphertextPresent = 0;
let decryptSucceeded = 0;
try {
  const rows = db.prepare("SELECT key, value FROM settings ORDER BY key").all();
  for (const row of rows) {
    if (!secretNames.has(row.key) || typeof row.value !== "string" || !row.value.startsWith("enc:v1:")) continue;
    ciphertextPresent += 1;
    const plaintext = decryptRuntimeSecret(row.key, row.value);
    if (typeof plaintext === "string" && plaintext.length > 0) decryptSucceeded += 1;
  }
} finally {
  db.close();
}

if (ciphertextPresent === 0) throw new Error("no encrypted settings were present in the restored database");
if (decryptSucceeded !== ciphertextPresent) throw new Error("one or more restored encrypted settings could not be decrypted");
console.log(
  JSON.stringify({
    status: "verified",
    ciphertextPresent: true,
    encryptedSettingCount: ciphertextPresent,
    decryptSucceeded: true,
    plaintextPrinted: false,
  }),
);
