#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, lstatSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { INTENT_CATALOG } from "./intent-catalog.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

const STOP_WORDS = new Set(`а алло без бы был была были было быть в вам вас ваш ваша ваше ваши ведь во вот все всего всех вы где да даже для до его ее если есть ещё же за и из или им их к как какая какие какой когда кто ли либо мне может мы на надо наш наша не него неё нет ни но ну о об он она они оно от по под после почему при про с со так также такой там те тем то того тоже только тут ты у уже что чтобы это этот эта эти я здравствуйте добрый день вечер утро привет спасибо пожалуйста саламатсызбы кандай менен учун жана бар жок hello hi thanks please the is are can could would want need about`.split(/\s+/u));

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseArgs(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("expected --archive and --output");
    result[key.slice(2)] = value;
  }
  if (!result.archive || !result.output) throw new Error("expected --archive and --output");
  return result;
}

export function requirePrivateDirectory(path, label) {
  const info = lstatSync(path);
  if (info.isSymbolicLink()) throw new Error(`${label} must not be a symlink`);
  if ((info.mode & 0o777) !== 0o700) throw new Error(`${label} must have mode 0700`);
}

export function normalizeBody(value) {
  if (typeof value !== "string") return null;
  const redacted = value
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/https?:\/\/\S+|www\.\S+/gu, " ")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, " ")
    .replace(/\+?\d[\d\s().-]{5,}\d/gu, " ")
    .replace(/\d+/gu, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (redacted.length < 4 || redacted.length > 1_000) return null;
  const tokens = [...new Set(redacted.split(" ")
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    .map((token) => token.slice(0, Math.min(token.length, 7))))]
    .sort();
  return tokens.length >= 1 ? { redacted, tokens } : null;
}

export async function parseChat(path) {
  const input = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  let server = null;
  const messages = [];
  for await (const line of input) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    const data = record["данные"];
    if (record["тип"] === "метаданные чата") {
      server = data?.id?.server ?? null;
      continue;
    }
    if (record["тип"] !== "сообщение") continue;
    const type = data?.type ?? data?._data?.type;
    if (data?.fromMe !== false || type !== "chat") continue;
    const normalized = normalizeBody(data?.body);
    if (normalized) messages.push(normalized);
  }
  return { direct: server === "lid" || server === "c.us", messages };
}

export async function extractRealIntentSignals(archiveDirectory) {
  const archive = realpathSync(resolve(archiveDirectory));
  requirePrivateDirectory(archive, "archive directory");
  const files = readdirSync(archive).filter((name) => name.endsWith(".jsonl")).sort();
  const intentCounts = new Map(INTENT_CATALOG.map((intent) => [intent.id, {
    ...intent,
    messageCount: 0,
    chats: new Set(),
  }]));
  let directChats = 0;
  let inboundTextMessages = 0;
  let matchedMessages = 0;

  for (const file of files) {
    const path = join(archive, file);
    const child = lstatSync(path);
    if (child.isSymbolicLink()) throw new Error(`archive file must not be a symlink: ${file}`);
    const realChild = realpathSync(path);
    if (!realChild.startsWith(`${archive}/`)) throw new Error(`archive file escapes approved root: ${file}`);
    if (!child.isFile() || (child.mode & 0o777) !== 0o600) throw new Error(`archive file must have mode 0600: ${file}`);
    const chat = await parseChat(path);
    if (!chat.direct) continue;
    directChats += 1;
    const sourceHash = hash(`${file}\n`);
    for (const message of chat.messages) {
      inboundTextMessages += 1;
      let matched = false;
      for (const intent of intentCounts.values()) {
        if (!intent.patterns.some((pattern) => pattern.test(message.redacted))) continue;
        intent.messageCount += 1;
        intent.chats.add(sourceHash);
        matched = true;
      }
      if (matched) matchedMessages += 1;
    }
  }

  const candidates = [...intentCounts.values()]
    .filter((intent) => intent.messageCount > 0)
    .sort((left, right) => right.chats.size - left.chats.size || right.messageCount - left.messageCount || left.id.localeCompare(right.id))
    .slice(0, 50)
    .map((intent, index) => ({
        rank: index + 1,
        intent_id: intent.id,
        generalized_client_question: intent.question,
        message_count: intent.messageCount,
        unique_chat_count: intent.chats.size,
        source_set_sha256: hash([...intent.chats].sort().join("\n")),
        answer_status: "owner_review_required",
      }));

  return {
    schema_version: 1,
    source_kind: "real_protected_evo_whatsapp_archive",
    archive_chat_files: files.length,
    eligible_direct_chats: directChats,
    eligible_inbound_text_messages: inboundTextMessages,
    matched_inbound_text_messages: matchedMessages,
    unmatched_inbound_text_messages: inboundTextMessages - matchedMessages,
    classification: "privacy_redacted_multilabel_intent_catalog_v1",
    limitations: [
      "Generalized questions are taxonomy labels, not customer quotations.",
      "One real message may match more than one intent.",
      "Frequency signals do not establish business truth or answer correctness.",
      "Owner review is required to merge, split, label, or approve every candidate.",
    ],
    candidates,
  };
}

export function resolvePrivateOutput(repoRoot, requestedOutput) {
  const root = join(resolve(repoRoot), ".evo-private-eval");
  requirePrivateDirectory(root, "private evidence root");
  const output = resolve(requestedOutput);
  if (!output.startsWith(`${root}/`)) throw new Error("output must be inside .evo-private-eval/");
  const parent = dirname(output);
  const relativeParent = relative(root, parent);
  let cursor = root;
  for (const component of relativeParent.split(sep).filter(Boolean)) {
    cursor = join(cursor, component);
    requirePrivateDirectory(cursor, "output directory");
  }
  const realRoot = realpathSync(root);
  const realParent = realpathSync(parent);
  if (realParent !== realRoot && !realParent.startsWith(`${realRoot}/`)) {
    throw new Error("output directory must not contain symlinks");
  }
  return output;
}

export function writePrivateReport(output, report) {
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  if ((lstatSync(output).mode & 0o777) !== 0o600) throw new Error("output file must have mode 0600");
}

async function main() {
  const args = parseArgs(process.argv);
  const output = resolvePrivateOutput(REPO_ROOT, args.output);
  if (basename(output).startsWith(".")) throw new Error("output must have an explicit file name");
  const result = await extractRealIntentSignals(args.archive);
  writePrivateReport(output, result);
  process.stdout.write(`${JSON.stringify({ candidates: result.candidates.length, direct_chats: result.eligible_direct_chats, inbound_text_messages: result.eligible_inbound_text_messages, output_sha256: hash(JSON.stringify(result)) })}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
