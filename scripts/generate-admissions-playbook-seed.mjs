import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CONTENT_FILES = ["china-v1.json", "malaysia-v1.json"];
export const SEED_PATH = resolve(root, "supabase/migrations/138_platform_admissions_playbook_content.sql");
export const STAGE_KEYS = [
  "intake", "profile_and_route", "documents", "applications", "decisions",
  "visa_and_predeparture", "arrival_and_adaptation",
];
const KEY = /^[a-z][a-z0-9_-]{0,63}$/;
const SOURCE_HASHES = {
  CN: "80f8d69dfff652c1be32fb74b840598ccbcc8957dded0d5356c8438ccba70c8a",
  MY: "9e06092bcd977f6c595fa660a3ba3421189746ac1eebe9f47b1afdb0d9a5575d",
};

function object(value, fields, name, optional = []) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${name}: object required`);
  assert.ok(fields.every((field) => Object.hasOwn(value, field)), `${name}: required fields missing`);
  assert.ok(Object.keys(value).every((field) => [...fields, ...optional].includes(field)), `${name}: unknown fields`);
}

function text(value, name, maximum = 1200) {
  assert.equal(typeof value, "string", `${name}: string required`);
  assert.ok(value.trim() && value === value.trim() && value.length <= maximum, `${name}: invalid length/whitespace`);
  assert.doesNotMatch(value, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u, `${name}: control character`);
  assert.doesNotMatch(value, /<\/?[a-z][^>]*>/iu, `${name}: content must be plain text, not HTML`);
}

function array(value, name, minimum, maximum) {
  assert.ok(Array.isArray(value) && value.length >= minimum && value.length <= maximum, `${name}: invalid array size`);
}

function strings(value, name, minimum = 1, maximum = 12) {
  array(value, name, minimum, maximum);
  value.forEach((item) => text(item, name));
  assert.equal(new Set(value).size, value.length, `${name}: duplicate text`);
}

function stableKey(value, name) {
  assert.equal(typeof value, "string", `${name}: string key required`);
  assert.match(value, KEY, `${name}: invalid stable key`);
}

function unique(items, field, name) {
  assert.equal(new Set(items.map((item) => item[field])).size, items.length, `${name}: duplicate ${field}`);
}

function date(value, name) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/, `${name}: ISO date required`);
  assert.equal(new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10), value, `${name}: invalid date`);
}

function officialUrl(value, name) {
  const url = new URL(value);
  assert.equal(url.protocol, "https:", `${name}: HTTPS source required`);
  assert.ok(!url.username && !url.password, `${name}: credentials forbidden`);
  const hosts = [
    "kg.china-embassy.gov.cn", "www.imi.gov.my", "imigresen-online.imi.gov.my",
    "visa.educationmalaysia.gov.my", "sunwayuniversity.edu.my", "www.apu.edu.my", "www.mmu.edu.my",
  ];
  assert.ok(hosts.includes(url.hostname), `${name}: unreviewed source host`);
}

export function messagePlaceholderKeys(body) {
  text(body, "message.body", 3000);
  const matches = [...body.matchAll(/\{\{([a-z][a-z0-9_]{0,63})\}\}/g)];
  const remainder = body.replace(/\{\{([a-z][a-z0-9_]{0,63})\}\}/g, "");
  assert.doesNotMatch(remainder, /[{}]/u, "Malformed or unnamed message placeholder");
  return [...new Set(matches.map((match) => match[1]))].sort();
}

export function validatePlaybook(playbook) {
  object(playbook, ["direction", "version", "title", "content"], "playbook");
  assert.ok(["CN", "MY"].includes(playbook.direction));
  assert.equal(playbook.version, "1.0.0", "This seed owns only version 1.0.0");
  text(playbook.title, "title", 200);
  const { content } = playbook;
  object(content, ["stages", "tasks", "messages", "sources", "limitations"], "content");
  array(content.stages, "stages", 7, 7);
  assert.deepEqual(content.stages.map((stage) => stage.key), STAGE_KEYS, "Canonical ordered stages required");
  unique(content.stages, "title", "stages");
  for (const stage of content.stages) {
    object(stage, ["key", "title", "summary", "checklist", "exitCriteria", "cautions"], "stage");
    text(stage.title, `${stage.key}.title`, 200);
    text(stage.summary, `${stage.key}.summary`, 500);
    strings(stage.checklist, `${stage.key}.checklist`, 1, 12);
    strings(stage.exitCriteria, `${stage.key}.exitCriteria`, 1, 4);
    strings(stage.cautions, `${stage.key}.cautions`, 1, 6);
  }

  array(content.tasks, "tasks", 1, 40);
  unique(content.tasks, "key", "tasks");
  unique(content.tasks, "title", "tasks");
  for (const task of content.tasks) {
    object(task, ["key", "stageKey", "title", "priority", "studentVisible"], "task");
    stableKey(task.key, "task.key");
    assert.ok(STAGE_KEYS.includes(task.stageKey), "Unknown task stage");
    assert.ok(!["intake", "profile_and_route"].includes(task.stageKey), "Existing u6 starter tasks must not be cloned");
    assert.ok(!task.key.startsWith("u6"), "u6 source keys belong to Sales handoff");
    text(task.title, "task.title", 240);
    assert.ok(["normal", "high"].includes(task.priority), "Unknown task priority");
    assert.equal(task.studentVisible, false, "Editorial curator tasks are private by default");
  }

  array(content.sources, "sources", 3, 20);
  unique(content.sources, "id", "sources");
  const sourceIds = new Set(content.sources.map((source) => source.id));
  for (const source of content.sources) {
    object(source, ["id", "title", "kind", "sourceVersion", "reviewedOn", "scope"], "source", ["url", "sha256"]);
    stableKey(source.id, "source.id");
    text(source.title, "source.title", 300);
    text(source.sourceVersion, "source.sourceVersion", 500);
    text(source.scope, "source.scope", 1000);
    date(source.reviewedOn, "source.reviewedOn");
    assert.ok(["owner-regulation", "owner-decision", "official"].includes(source.kind));
    if (source.kind === "official") officialUrl(source.url, "source.url");
    else assert.ok(!Object.hasOwn(source, "url"), "Private source must not expose a URL");
    if (source.kind === "owner-regulation") assert.equal(source.sha256, SOURCE_HASHES[playbook.direction]);
    else assert.ok(!Object.hasOwn(source, "sha256"), "Do not invent source checksums");
  }
  assert.equal(content.sources.filter((source) => source.kind === "owner-regulation").length, 1);
  assert.equal(content.sources.filter((source) => source.kind === "owner-decision").length, 1);

  array(content.messages, "messages", playbook.direction === "CN" ? 12 : 13, 40);
  unique(content.messages, "id", "messages");
  unique(content.messages, "body", "messages");
  for (const message of content.messages) {
    object(message, ["id", "stageKey", "title", "audience", "locale", "whenToUse", "body", "placeholders", "sourceIds"], "message");
    stableKey(message.id, "message.id");
    assert.ok(message.id.startsWith(`${playbook.direction.toLowerCase()}-`));
    assert.ok(STAGE_KEYS.includes(message.stageKey));
    assert.ok(["student", "referral", "partner", "university"].includes(message.audience));
    assert.ok(["ru", "en"].includes(message.locale));
    if (message.audience === "university") assert.equal(message.locale, "en");
    if (["student", "referral"].includes(message.audience)) assert.equal(message.locale, "ru");
    text(message.title, "message.title", 200);
    text(message.whenToUse, "message.whenToUse", 1000);
    const keys = messagePlaceholderKeys(message.body);
    array(message.placeholders, "message.placeholders", 1, 20);
    unique(message.placeholders, "key", "message.placeholders");
    for (const placeholder of message.placeholders) {
      object(placeholder, ["key", "label"], "placeholder");
      stableKey(placeholder.key, "placeholder.key");
      text(placeholder.label, "placeholder.label", 180);
    }
    assert.deepEqual(message.placeholders.map((item) => item.key).sort(), keys, `${message.id}: exact placeholder labels required`);
    array(message.sourceIds, "message.sourceIds", 1, 10);
    assert.equal(new Set(message.sourceIds).size, message.sourceIds.length);
    assert.ok(message.sourceIds.every((id) => sourceIds.has(id)), `${message.id}: undeclared source`);
  }
  for (const stage of STAGE_KEYS) {
    assert.ok(content.messages.some((message) => message.stageKey === stage), `${stage}: missing manual message coverage`);
  }
  strings(content.limitations, "limitations", 5, 20);
  return playbook;
}

export function loadPlaybooks() {
  return CONTENT_FILES.map((name) => {
    const raw = readFileSync(resolve(root, "supabase/admissions-content", name), "utf8");
    return { name, raw, playbook: validatePlaybook(JSON.parse(raw)) };
  });
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function generateSeed(inputs = loadPlaybooks()) {
  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs.map(({ playbook }) => playbook.direction), ["CN", "MY"]);
  const statements = inputs.map(({ name, raw, playbook }) => {
    validatePlaybook(playbook);
    assert.deepEqual(JSON.parse(raw), playbook, "Source checksum must describe the exact inserted content");
    const hash = createHash("sha256").update(raw).digest("hex");
    return `-- Source: supabase/admissions-content/${name}\n-- SHA256: ${hash}\n`
      + "INSERT INTO platform_private.admissions_playbook_versions (direction, version, title, content)\nVALUES (\n"
      + `  ${sqlLiteral(playbook.direction)},\n  ${sqlLiteral(playbook.version)},\n  ${sqlLiteral(playbook.title)},\n`
      + `  ${sqlLiteral(JSON.stringify(playbook.content, null, 2))}::jsonb\n);`;
  });
  return "-- Generated by scripts/generate-admissions-playbook-seed.mjs.\n"
    + "-- Candidate editorial CN/MY playbooks; deployment/review gates are separate.\n"
    + "-- Immutable content only: no case binding, task creation, people, payment or provider writes.\n"
    + "-- Never rewrite an applied migration; publish a new version in a forward migration.\n\nBEGIN;\n\n"
    + statements.join("\n\n") + "\n\nCOMMIT;\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  assert.ok(args.length <= 1 && args.every((arg) => ["--write", "--check"].includes(arg)),
    "Usage: node scripts/generate-admissions-playbook-seed.mjs [--write|--check]");
  const sql = generateSeed();
  if (args.includes("--write")) {
    writeFileSync(SEED_PATH, sql, "utf8");
    process.stdout.write("Generated migration 138 from validated CN/MY content\n");
  } else if (args.includes("--check")) {
    assert.equal(readFileSync(SEED_PATH, "utf8"), sql, "Migration 138 differs from source JSON");
    process.stdout.write("Migration 138 exactly matches validated CN/MY content\n");
  } else process.stdout.write(sql);
}
