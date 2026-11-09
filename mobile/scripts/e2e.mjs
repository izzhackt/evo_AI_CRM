#!/usr/bin/env node
// Запуск Maestro-потоков против локального стенда: node scripts/e2e.mjs ios|android [flow.yaml ...]
// Логин и пароль берутся из игнорируемого Git файла .local-stack-accounts.json (npm run mobile:stack:up в корне)
// и передаются потокам через окружение процесса (MAESTRO_E2E_*), а не аргументами командной строки.
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [platform, ...flows] = process.argv.slice(2);
if (platform !== "ios" && platform !== "android") {
  console.error("Использование: node scripts/e2e.mjs ios|android [поток.yaml ...]");
  process.exit(2);
}
const accountsFile = process.env.EVO_E2E_ACCOUNTS ?? path.join(root, ".local-stack-accounts.json");
if (!existsSync(accountsFile)) {
  console.error(`Нет ${accountsFile}. Поднимите стенд (npm run mobile:stack:up) и скопируйте mobile/.local-stack-accounts.json.`);
  process.exit(2);
}
const accounts = JSON.parse(readFileSync(accountsFile, "utf8")).accounts ?? [];
const student = accounts.find((a) => a.key === (process.env.EVO_E2E_ACCOUNT ?? "assisted"));
if (!student?.login || !student?.password) {
  console.error("В файле аккаунтов нет студента с логином и паролем.");
  process.exit(2);
}
const args = ["test"];
if (platform) args.push("--platform", platform);
if (process.env.EVO_E2E_DEVICE) args.push("--device", process.env.EVO_E2E_DEVICE);
args.push(...(flows.length > 0 ? flows : [".maestro"]));
const result = spawnSync("maestro", args, {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: "1", MAESTRO_E2E_LOGIN: student.login, MAESTRO_E2E_PASSWORD: student.password },
});
process.exit(result.status ?? 1);
