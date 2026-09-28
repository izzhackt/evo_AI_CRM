import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as access from "../src/lib/platform-access.ts";
import * as jsxRuntime from "react/jsx-runtime";
import * as chatFeed from "../src/lib/team-chat-feed.ts";
import * as chatSeen from "../src/lib/platform-team-chat-seen.ts";

function loadSource(path, imports = {}, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, URL, Buffer, atob, ...globals, require(name) {
    if (name === "./platform-access.ts" || name === "@/lib/platform-access") return access;
    assert.ok(Object.hasOwn(imports, name), `Unexpected module at public config boundary: ${name}`);
    return imports[name];
  } });
  return exports;
}

function chatPage(runtimeEnv, authorize = async () => ({
  organizationId: "00000000-0000-4000-8000-000000000101",
  membershipId: "00000000-0000-4000-8000-000000000102", presentationRole: null,
  systemRole: "admin", permissionKeys: [], assignments: [],
})) {
  const publicConfig = loadSource("src/lib/supabase/config.ts", {}, { process: { env: runtimeEnv } });
  const jsx = (type, props) => ({ type, props });
  const { default: page } = loadSource("src/app/(v3)/v3/team-chat/page.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "next/navigation": { notFound() { throw new Error("not_found"); } },
    "@/components/ui": { Card: "Card" },
    "@/components/v3/PartShell": { PartShell: "PartShell" },
    "@/components/v3/team-chat/TeamChat": { TeamChat: "TeamChat" },
    "@/lib/platform-guards": { requireV3PageActor: authorize },
    "@/lib/platform-team-chat": loadSource("src/lib/platform-team-chat.ts"),
    "@/lib/server/platform-team-chat-repository": { TeamChatReadError: class extends Error {} },
    "@/lib/server/platform-team-chat-v2-repository": { TeamChatV2Error: class extends Error {} },
    "@/lib/v3/team-chat-source": { async readV3TeamChatFeed() { return { page: { messages: [] }, channels: [], participants: [] }; } },
    "@/lib/supabase/config": publicConfig,
  });
  return () => page({ searchParams: Promise.resolve({}) });
}

test("authenticated chat receives only validated runtime public config without browser build-time env", async () => {
  const page = await chatPage({
    NEXT_PUBLIC_SUPABASE_URL: "https://evo-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_runtime_test",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_never_serialize",
  })();
  assert.equal(page.props.children.type, "TeamChat");
  assert.ok(page.props.children.props.realtimeConfig, "The authenticated server page must supply runtime public config");
  assert.deepEqual(JSON.parse(JSON.stringify(page.props.children.props.realtimeConfig)), {
    url: "https://evo-test.supabase.co", publishableKey: "sb_publishable_runtime_test",
  });
  assert.doesNotMatch(JSON.stringify(page), /sb_secret_|EVO_PLATFORM_SUPABASE_SECRET_KEY/u);
});

test("chat runtime config remains behind staff authentication and rejects server credentials", async () => {
  await assert.rejects(chatPage({}, async () => { throw new Error("staff_login_required"); }), /staff_login_required/u);
  for (const publishableKey of ["sb_secret_never_serialize", undefined]) {
    await assert.rejects(chatPage({
      NEXT_PUBLIC_SUPABASE_URL: "https://evo-test.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    }), (error) => ["unsafe_publishable_key", "missing_publishable_key"].includes(error.code));
  }
});

test("chat connects with supplied public config in an env-free browser and keeps private session authorization", async () => {
  const effects = [], calls = [];
  const jsx = (type, props) => ({ type, props });
  const subscription = {
    on(...args) { calls.push(["on", args[0], args[1]]); return subscription; },
    subscribe() { calls.push(["subscribe"]); return subscription; },
  };
  const client = {
    auth: { async getSession() { return { data: { session: { access_token: "test-session-token" } }, error: null }; } },
    realtime: { async setAuth(token) { calls.push(["auth", token]); } },
    channel(topic, config) { calls.push(["channel", topic, config]); return subscription; },
    removeChannel() {},
  };
  const hooks = { useState: (value) => [typeof value === "function" ? value() : value, () => {}], useRef: (current) => ({ current }),
    useCallback: (callback) => callback, useEffect: (effect) => effects.push(effect), useLayoutEffect: (effect) => effects.push(effect) };
  const seenHook = loadSource("src/components/v3/team-chat/useTeamChatSeen.ts", {
    react: hooks, "@/lib/platform-team-chat-seen-actions": {},
    "@/lib/platform-team-chat-seen": chatSeen, "@/lib/team-chat-feed": chatFeed,
  });
  const { TeamChat } = loadSource("src/components/v3/team-chat/TeamChat.tsx", {
    "@/components/icons": loadSource("src/components/icons.tsx", { "react/jsx-runtime": jsxRuntime }),
    "@/lib/platform-organization-time": loadSource("src/lib/platform-organization-time.ts"),
    "react/jsx-runtime": { jsx, jsxs: jsx }, "next/link": { default: "Link" },
    "react": hooks,
    "@supabase/ssr": { createBrowserClient(...args) { calls.push(["client", ...args]); return client; } },
    "@/lib/platform-team-chat-actions": {},
    "@/lib/platform-team-chat-v2-actions": {},
    "@/lib/team-chat-feed": chatFeed,
    "@/lib/platform-team-chat": loadSource("src/lib/platform-team-chat.ts"),
    "@/lib/supabase/config": loadSource("src/lib/supabase/config.ts", {}, { process: { env: {} } }),
    "./TeamChatComposer": { TeamChatComposer: "Composer" },
    "./TeamChatMessageRow": { TeamChatMessageRow: "MessageRow" },
    "./useTeamChatSeen": seenHook,
    "./team-chat.module.css": { default: {} },
  }, { process: { env: {} }, setInterval: () => 0, clearInterval() {}, clearTimeout() {},
    document: { addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {} } });
  TeamChat({ initial: { page: { schemaVersion: 2, messages: [], quotes: [], watermark: "0", beforeCursor: "0", afterCursor: "0", hasBefore: false, hasAfter: false, latestMessageId: null, focusMessageId: null }, channels: [], participants: [] },
    channel: "general", organizationId: "test-org", membershipId: "test-member", canModerate: true,
    realtimeConfig: { url: "https://evo-test.supabase.co", publishableKey: "sb_publishable_runtime_test" } });
  const cleanups = effects.map((effect) => effect());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["client", "https://evo-test.supabase.co", "sb_publishable_runtime_test"],
    ["auth", "test-session-token"],
    ["channel", "team-chat:test-org:general", { config: { private: true } }],
    ["on", "broadcast", { event: "invalidate" }], ["subscribe"],
  ]);
  for (const cleanup of cleanups) cleanup?.();
});

test("revocation remains terminal when an earlier context request rejects afterwards", async () => {
  const cells = [], effects = [];
  let cursor = 0, connections = 0, rejectContext;
  const contextResponse = new Promise((_resolve, reject) => { rejectContext = reject; });
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = { value: typeof initial === "function" ? initial() : initial };
      return [cells[index].value, (next) => { cells[index].value = typeof next === "function" ? next(cells[index].value) : next; }];
    },
    useRef(initial) { const index = cursor++; return cells[index] ??= { current: initial }; },
    useCallback: (callback) => callback,
    useEffect: (effect) => effects.push(effect), useLayoutEffect: (effect) => effects.push(effect),
  };
  const jsx = (type, props) => ({ type, props });
  const seenHook = loadSource("src/components/v3/team-chat/useTeamChatSeen.ts", {
    react: hooks, "@/lib/platform-team-chat-seen-actions": {},
    "@/lib/platform-team-chat-seen": chatSeen, "@/lib/team-chat-feed": chatFeed,
  });
  const { TeamChat } = loadSource("src/components/v3/team-chat/TeamChat.tsx", {
    react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx }, "next/link": { default: "Link" },
    "@supabase/ssr": { createBrowserClient() { connections++; throw new Error("must not reconnect after revocation"); } },
    "@/lib/platform-team-chat-actions": {},
    "@/lib/platform-team-chat-v2-actions": { readTeamChatTimelineV2Action: () => contextResponse },
    "@/lib/platform-team-chat": loadSource("src/lib/platform-team-chat.ts"),
    "@/lib/team-chat-feed": chatFeed,
    "@/lib/platform-organization-time": loadSource("src/lib/platform-organization-time.ts"),
    "@/components/icons": loadSource("src/components/icons.tsx", { "react/jsx-runtime": jsxRuntime }),
    "./TeamChatComposer": { TeamChatComposer: "Composer" },
    "./TeamChatMessageRow": { TeamChatMessageRow: "MessageRow" }, "./useTeamChatSeen": seenHook,
    "./team-chat.module.css": { default: {} },
  }, { setInterval: () => 0, clearInterval() {}, clearTimeout() {},
    document: { addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {} } });
  const props = { initial: { page: { schemaVersion: 2, messages: [], quotes: [], watermark: "0", beforeCursor: "0", afterCursor: "0", hasBefore: false, hasAfter: false, latestMessageId: null, focusMessageId: null }, channels: [], participants: [] },
    channel: "general", organizationId: "test-org", membershipId: "test-member", canModerate: true,
    realtimeConfig: { url: "https://evo-test.supabase.co", publishableKey: "sb_publishable_runtime_test" } };
  const render = () => { cursor = 0; effects.length = 0; return TeamChat(props); };
  const findComposer = (node) => !node || typeof node !== "object" ? null : Array.isArray(node)
    ? node.map(findComposer).find(Boolean) : node.type === "Composer" ? node : findComposer(node.props?.children);
  const composer = findComposer(render());
  assert.ok(composer);
  const pendingContext = composer.props.onResumeEdit("00000000-0000-4000-8000-000000000111");
  composer.props.onFailure("forbidden");
  assert.equal(Boolean(findComposer(render())), false);
  rejectContext(new Error("late transport failure"));
  await pendingContext;
  assert.equal(Boolean(findComposer(render())), false, "A late failed read must not recover the draft/editor after revocation");
  const cleanups = effects.map((effect) => effect());
  assert.equal(connections, 0, "Revocation must keep the private realtime effect stopped");
  for (const cleanup of cleanups) cleanup?.();
});

test("the successor env template exposes only publishable Supabase values to the browser", () => {
  for (const path of ["deploy/env.production.example"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /^NEXT_PUBLIC_SUPABASE_URL=/mu, path);
    assert.match(source, /^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/mu, path);
    assert.match(source, /^EVO_PLATFORM_SUPABASE_SECRET_KEY=/mu, path);
    assert.match(source, /^EVO_PLATFORM_ORGANIZATION_ID=/mu, path);
    assert.doesNotMatch(
      source,
      /^NEXT_PUBLIC_.*(?:SECRET|SERVICE_ROLE)/mu,
      `${path} exposes a server-only Supabase credential`,
    );
    assert.doesNotMatch(
      source,
      /AUTH_SECRET|EVO_SECRET_ENCRYPTION_KEY|EVO_DB_PATH|EVO_BACKUP_DIR|EVO_AGENT_WAHA_SESSION|EVO_PLATFORM_(?:MANUAL_SEND|LEAD_AGENT)|EVO_LEAD_AGENT_|crm_primary|evo-inbox/u,
      `${path} retains a superseded authority or static WAHA session selection`,
    );
  }
});
