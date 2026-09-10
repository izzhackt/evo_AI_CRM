import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function loadSource(path, imports = {}, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, URL, Buffer, atob, ...globals, require(name) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected module at public config boundary: ${name}`);
    return imports[name];
  } });
  return exports;
}

function chatPage(runtimeEnv, authorize = async () => ({
  organizationId: "00000000-0000-4000-8000-000000000101",
  membershipId: "00000000-0000-4000-8000-000000000102", presentationRole: "admin",
})) {
  const publicConfig = loadSource("src/lib/supabase/config.ts", {}, { process: { env: runtimeEnv } });
  const jsx = (type, props) => ({ type, props });
  const { default: page } = loadSource("src/app/(v3)/v3/team-chat/page.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "next/navigation": { notFound() { throw new Error("not_found"); } },
    "@/components/v3/PartShell": { PartShell: "PartShell" },
    "@/components/v3/team-chat/TeamChat": { TeamChat: "TeamChat" },
    "@/lib/platform-guards": { requireV3PageActor: authorize },
    "@/lib/platform-team-chat": loadSource("src/lib/platform-team-chat.ts"),
    "@/lib/server/platform-team-chat-repository": { TeamChatReadError: class extends Error {} },
    "@/lib/v3/team-chat-source": { async readV3TeamChat() { return { page: { messages: [] }, channels: [], participants: [] }; } },
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
  const { TeamChat } = loadSource("src/components/v3/team-chat/TeamChat.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx }, "next/link": { default: "Link" },
    "react": { useState: (value) => [value, () => {}], useRef: (current) => ({ current }),
      useCallback: (callback) => callback, useEffect: (effect) => effects.push(effect), startTransition: (callback) => callback() },
    "@supabase/ssr": { createBrowserClient(...args) { calls.push(["client", ...args]); return client; } },
    "@/lib/platform-team-chat-actions": {},
    "@/lib/platform-team-chat": loadSource("src/lib/platform-team-chat.ts"),
    "@/lib/supabase/config": loadSource("src/lib/supabase/config.ts", {}, { process: { env: {} } }),
    "./TeamChatComposer": { TeamChatComposer: "Composer" },
    "./TeamChatMessageRow": { TeamChatMessageRow: "MessageRow" },
    "./team-chat.module.css": { default: {} },
  }, { process: { env: {} }, setInterval: () => 0, clearInterval() {}, clearTimeout() {},
    document: { addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {} } });
  TeamChat({ initial: { page: { messages: [], watermark: "0" }, channels: [], participants: [] },
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
