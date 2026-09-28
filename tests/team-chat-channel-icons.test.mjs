import assert from "node:assert/strict";
import test from "node:test";
import { TEAM_CHAT_CHANNELS, TEAM_CHAT_CHANNEL_ICONS } from "../src/lib/platform-team-chat.ts";
import { GROUP_ICONS, LINK_ICONS } from "../src/lib/v3/shell-tabs.ts";

// Э8.9: знак канала — знак его места в меню, а не первая буква названия.
test("team chat channel icons are the menu icons of the same place", () => {
  assert.deepEqual(Object.keys(TEAM_CHAT_CHANNEL_ICONS).sort(), [...TEAM_CHAT_CHANNELS].sort());
  assert.equal(TEAM_CHAT_CHANNEL_ICONS.general, LINK_ICONS["team-chat"]);
  assert.equal(TEAM_CHAT_CHANNEL_ICONS.sales, GROUP_ICONS.sales);
  assert.equal(TEAM_CHAT_CHANNEL_ICONS.admissions, GROUP_ICONS.admissions);
  assert.equal(new Set(Object.values(TEAM_CHAT_CHANNEL_ICONS)).size, TEAM_CHAT_CHANNELS.length, "every channel has its own icon");
});
