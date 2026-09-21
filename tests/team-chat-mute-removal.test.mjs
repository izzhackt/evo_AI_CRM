import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = source("supabase/migrations/171_platform_team_chat_remove_mute.sql");

// Migration 156 mutates function bodies rather than declaring them again.
// Replay its exact checked replacements so the baseline is the effective
// authority contract, not the obsolete fixed-role definitions in 141/142.
function withCurrentAuthority(definition, signature, expectedPatches) {
  const scoped = source("supabase/migrations/156_platform_scoped_staff_consumers.sql");
  const patches = [...scoped.matchAll(/PERFORM pg_temp\.evo_s2_replace\('([^']+)',\s*\$\$([\s\S]*?)\$\$,\s*(?:\$\$([\s\S]*?)\$\$|'')\);/gu)]
    .filter((match) => match[1] === signature);
  assert.equal(patches.length, expectedPatches, "Every scoped-authority patch must be included");
  for (const [, , before, after] of patches) {
    assert.equal(definition.split(before).length - 1, 1, `Authority anchor drift: ${signature}`);
    definition = definition.replace(before, after ?? "");
  }
  return definition;
}

test("chat removes mute and permanent explanatory copy while retaining recovery and sparse seen", () => {
  const chat = source("src/components/v3/team-chat/TeamChat.tsx");
  assert.doesNotMatch(chat, /Сообщения появляются автоматически|Внутренняя переписка сотрудников EVO|Приглушить|Включить уведомления|item\.muted/u);
  assert.match(chat, /transportLabel \|\| error \? <div className=\{styles\.transport\} role="status"/u);
  assert.match(chat, /transport === "live" \? null/u);
  assert.match(chat, /Обновить историю/u);
  assert.match(chat, /Подключить снова/u);
  assert.match(chat, /useTeamChatSeen/u);
  assert.doesNotMatch(chat, /operation: "read"|markRead\(/u);
  assert.match(source("src/components/v3/team-chat/useTeamChatSeen.ts"), /markTeamChatSeenAction\(batch\)/u);
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
  command = withCurrentAuthority(command, "platform.team_chat_command(uuid,text,uuid,jsonb)", 3);
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
  const notifications = withCurrentAuthority(
    workflow.slice(workflow.indexOf("CREATE FUNCTION platform_private.notify_staff_chat_mention()"), workflow.indexOf("CREATE TRIGGER team_chat_mention_notifications")).trim(),
    "platform_private.notify_staff_chat_mention()", 2)
    .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
    .replace("      AND NOT EXISTS (SELECT 1 FROM platform.team_chat_preferences pref WHERE pref.organization_id = NEW.organization_id\n        AND pref.channel_key = NEW.channel_key AND pref.membership_id = m.id AND pref.muted)\n", "");
  assert.ok(migration.includes(notifications), "Only mute suppression may change; preserve mention recipients and deduplication");
  assert.match(command, /'team\.chat\.moderate'/u);
  assert.match(notifications, /platform_private\.staff_can_access/u);
  assert.doesNotMatch(migration, /actor\.platform_role <> 'admin'|m\.current_role IN|JOIN platform\.role_bundle_versions/u);
  assert.doesNotMatch(migration, /\bDROP\b|\bDELETE FROM\b|\bTRUNCATE\b/u);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;\s*$/u);
});
