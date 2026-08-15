import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  extractRealIntentSignals,
  normalizeBody,
  resolvePrivateOutput,
  writePrivateReport,
} from "../scripts/lead_eval/extract-real-whatsapp-intents.mjs";

function record(type, data) {
  return JSON.stringify({ "тип": type, "данные": data });
}

function writeChat(directory, name, server, messages) {
  const rows = [record("метаданные чата", { id: { server } })];
  for (const message of messages) rows.push(record("сообщение", message));
  const path = join(directory, name);
  writeFileSync(path, `${rows.join("\n")}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

test("normalization removes contact channels before classification", () => {
  const normalized = normalizeBody("Цена? +996 555 123 456 user@example.com https://example.com");
  assert.equal(normalized.redacted, "цена");
  assert.deepEqual(normalized.tokens, ["цена"]);
});

test("real-message eligibility is direct inbound text only and multi-label", async () => {
  const archive = mkdtempSync(join(tmpdir(), "evo-real-intents-"));
  chmodSync(archive, 0o700);
  writeChat(archive, "direct.jsonl", "lid", [
    { fromMe: false, type: "chat", body: "Сколько стоят услуги и можно ли оплатить частями?" },
    { fromMe: true, type: "chat", body: "Ответ сотрудника" },
    { fromMe: false, type: "image", body: "Изображение" },
  ]);
  writeChat(archive, "group.jsonl", "g.us", [
    { fromMe: false, type: "chat", body: "Сколько стоят услуги?" },
  ]);

  const first = await extractRealIntentSignals(archive);
  const second = await extractRealIntentSignals(archive);
  assert.equal(first.eligible_direct_chats, 1);
  assert.equal(first.eligible_inbound_text_messages, 1);
  assert.equal(first.matched_inbound_text_messages, 1);
  assert.deepEqual(first, second);
  assert.equal(first.candidates.find((item) => item.intent_id === "service_price")?.message_count, 1);
  assert.equal(first.candidates.find((item) => item.intent_id === "payment_installments")?.message_count, 1);
});

test("archive child symlinks fail closed", async () => {
  const archive = mkdtempSync(join(tmpdir(), "evo-real-intents-symlink-"));
  const external = mkdtempSync(join(tmpdir(), "evo-real-intents-external-"));
  chmodSync(archive, 0o700);
  chmodSync(external, 0o700);
  const source = writeChat(external, "outside.jsonl", "lid", [
    { fromMe: false, type: "chat", body: "Сколько стоят услуги?" },
  ]);
  symlinkSync(source, join(archive, "escape.jsonl"));
  await assert.rejects(() => extractRealIntentSignals(archive), /must not be a symlink/);
});

test("output is confined to an existing owner-only private evidence directory", () => {
  const repo = mkdtempSync(join(tmpdir(), "evo-real-intents-repo-"));
  const root = join(repo, ".evo-private-eval");
  const outputDirectory = join(root, "top50");
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  chmodSync(outputDirectory, 0o700);

  assert.equal(
    resolvePrivateOutput(repo, join(outputDirectory, "candidates.json")),
    join(outputDirectory, "candidates.json"),
  );
  const output = resolvePrivateOutput(repo, join(outputDirectory, "report.json"));
  writePrivateReport(output, { deterministic: true });
  assert.equal(lstatSync(output).mode & 0o777, 0o600);
  assert.throws(() => resolvePrivateOutput(repo, join(repo, "tracked.json")), /inside \.evo-private-eval/);

  const external = mkdtempSync(join(tmpdir(), "evo-real-intents-output-external-"));
  chmodSync(external, 0o700);
  symlinkSync(external, join(root, "linked"));
  assert.throws(
    () => resolvePrivateOutput(repo, join(root, "linked", "candidates.json")),
    /must not be a symlink|must not contain symlinks/,
  );
});

test("committed draft contains generalized questions only", () => {
  const draft = readFileSync(new URL("../docs/lead-agent/TOP_50_REAL_WHATSAPP_INTENTS_DRAFT.md", import.meta.url), "utf8");
  assert.match(draft, /owner_review_required/);
  assert.doesNotMatch(draft, /https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d\s().-]{5,}\d/iu);
});
