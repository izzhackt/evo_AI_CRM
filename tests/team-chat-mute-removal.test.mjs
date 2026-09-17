import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = source("supabase/migrations/171_platform_team_chat_remove_mute.sql");

test("chat removes mute and permanent explanatory copy while retaining real recovery and mark-read", () => {
  const chat = source("src/components/v3/team-chat/TeamChat.tsx");
  assert.doesNotMatch(chat, /Сообщения появляются автоматически|Внутренняя переписка сотрудников EVO|Приглушить|Включить уведомления|item\.muted/u);
  assert.match(chat, /transportLabel \? <div className=\{styles\.transport\} role="status"/u);
  assert.match(chat, /transport === "live" \? error \? "Соединение установлено" : null/u);
  assert.match(chat, /Обновить историю/u);
  assert.match(chat, /Подключить снова/u);
  assert.match(chat, /JSON\.stringify\(\{ operation: "read", messageId \}\)/u);
  assert.match(chat, /void markRead\(page\.latestMessageId\)/u);
});

test("chat action rejects mute before reaching authentication or RPC", () => {
  const action = source("src/lib/platform-team-chat-actions.ts");
  assert.doesNotMatch(action, /\bmute\b|\bmuted\b/u);
  assert.match(action, /if \(!allowed \|\| Object\.keys\(value\)/u);
  assert.match(action, /read: \["operation", "messageId"\]/u);
});

test("migration only removes mute branches and mention suppression from the existing command contract", () => {
  const initial = source("supabase/migrations/141_platform_team_chat.sql");
  let command = initial.slice(initial.indexOf("CREATE FUNCTION platform.team_chat_command("), initial.indexOf("CREATE FUNCTION platform_private.team_chat_can_subscribe(")).trim();
  command = command.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
    .replace("    WHEN 'read' THEN ARRAY['operation', 'messageId']\n    WHEN 'mute' THEN ARRAY['operation', 'muted', 'expectedVersion'] END;", "    WHEN 'read' THEN ARRAY['operation', 'messageId'] END;");
  const readStart = command.indexOf("    IF operation = 'read' THEN");
  const readEnd = command.indexOf("\n    ELSE", readStart);
  const branchEnd = command.indexOf("\n  END IF;\n  result :=", readEnd);
  assert.ok(readStart > 0 && readEnd > readStart && branchEnd > readEnd);
  const readBranch = command.slice(readStart + "    IF operation = 'read' THEN\n".length, readEnd)
    .split("\n").map((line) => line.slice(2)).join("\n");
  command = command.slice(0, readStart) + readBranch + command.slice(branchEnd);
  assert.ok(migration.includes(command), "Only the retired mute dispatch/mutation may change; preserve locks, authorization, message actions, read cursors, receipts and realtime");

  const workflow = source("supabase/migrations/142_platform_team_workflow.sql");
  const notifications = workflow.slice(workflow.indexOf("CREATE FUNCTION platform_private.notify_staff_chat_mention()"), workflow.indexOf("CREATE TRIGGER team_chat_mention_notifications")).trim()
    .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
    .replace("      AND NOT EXISTS (SELECT 1 FROM platform.team_chat_preferences pref WHERE pref.organization_id = NEW.organization_id\n        AND pref.channel_key = NEW.channel_key AND pref.membership_id = m.id AND pref.muted)\n", "");
  assert.ok(migration.includes(notifications), "Only mute suppression may change; preserve mention recipients and deduplication");
  assert.doesNotMatch(migration, /\bDROP\b|\bDELETE FROM\b|\bTRUNCATE\b/u);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;\s*$/u);
});
