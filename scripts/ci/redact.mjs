// Логи, которые CI выкладывает в публичный артефакт, не должны содержать ключей: даже локальные ключи Supabase
// по умолчанию вычёркиваются (JWT, sb_secret_/sb_publishable_, пароль в строке подключения Postgres, строки с
// метками «Access Key», «Secret Key», «JWT secret», «service_role» в выводе `supabase start`/`status`).
// Лог `supabase start` в артефакт вообще не выкладывается; это второй рубеж для остальных файлов.
//
//   node scripts/ci/redact.mjs <файл>...      (перезаписывает файлы; отсутствующие пропускаются)
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function redact(text) {
  return String(text)
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/gu, "[redacted-jwt]")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/gu, "[redacted-sb-key]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gu, "$1[redacted]@")
    .replace(/^(.*?(?:access[ _-]?key|secret[ _-]?key|jwt[ _-]?secret|service[ _-]?role)[^:=\n]*[:=]\s*).+$/gimu, "$1[redacted]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const file of process.argv.slice(2)) {
    let text;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    writeFileSync(file, redact(text));
  }
}
