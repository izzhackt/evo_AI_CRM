import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  getPlatformReplySnippets,
  isPlatformReplySnippetAudience,
  normalizePlatformReplySnippetRow,
  normalizePlatformReplySnippets,
  PLATFORM_REPLY_SNIPPET_AUDIENCES,
  PlatformReplySnippetsRepositoryError,
} from "../src/lib/platform-reply-snippets.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const SNIPPET_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_SNIPPET_ID = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "55555555-5555-4555-8555-555555555555";
const AT = "2026-09-06T10:00:00+00:00";
const LARGE_VERSION = "9007199254740993";

const ACTOR = Object.freeze({
  authUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  membershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  organizationId: ORGANIZATION_ID,
  displayName: "Sales",
  email: "sales@example.test",
  platformRole: "sales",
  authorityRole: "sales",
  presentationRole: "sales",
  platformAccessVersion: 1,
  platformBundleId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  platformBundleVersion: 1,
});

function dataModule(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

const actionHarness = {
  actor: ACTOR,
  response: { data: null, error: null },
  rpcCalls: [],
  revalidated: [],
};
globalThis.__platformReplySnippetActionHarness = actionHarness;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: dataModule("export default {};") };
    }
    if (!context.parentURL?.includes("/platform-reply-snippet-actions.ts")) {
      return nextResolve(specifier, context);
    }
    if (specifier === "next/cache") {
      return {
        shortCircuit: true,
        url: dataModule(`
          export function revalidatePath(path) {
            globalThis.__platformReplySnippetActionHarness.revalidated.push(path);
          }
        `),
      };
    }
    if (specifier === "./fixed-role-policy") {
      return {
        shortCircuit: true,
        url: dataModule("export function fixedRoleCan() { return true; }"),
      };
    }
    if (specifier === "./platform-guards") {
      return {
        shortCircuit: true,
        url: dataModule(`
          export async function requirePlatformStaffActor() {
            return globalThis.__platformReplySnippetActionHarness.actor;
          }
        `),
      };
    }
    if (specifier === "./platform-reply-snippets") {
      return {
        shortCircuit: true,
        url: new URL(
          "../src/lib/platform-reply-snippets.ts",
          import.meta.url,
        ).href,
      };
    }
    if (specifier === "./server/action-form-fields") {
      return {
        shortCircuit: true,
        url: new URL(
          "../src/lib/server/action-form-fields.ts",
          import.meta.url,
        ).href,
      };
    }
    if (specifier === "./supabase/server") {
      return {
        shortCircuit: true,
        url: dataModule(`
          export async function createSupabaseServerClient() {
            const harness = globalThis.__platformReplySnippetActionHarness;
            return {
              schema(schemaName) {
                return {
                  async rpc(rpcName, args) {
                    harness.rpcCalls.push({ schemaName, rpcName, args });
                    return harness.response;
                  },
                };
              },
            };
          }
        `),
      };
    }
    return nextResolve(specifier, context);
  },
});

function row(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    reply_snippet_id: SNIPPET_ID,
    audience: "sales",
    title: "Приветствие",
    body: "Здравствуйте!\nСпасибо, что написали нам.",
    version: "1",
    created_by_membership_id: MEMBERSHIP_ID,
    created_by_display_name: "Айдана",
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

test("reply-snippet audiences are the three fixed machine keys", () => {
  assert.deepEqual(PLATFORM_REPLY_SNIPPET_AUDIENCES, [
    "sales",
    "admissions",
    "all",
  ]);
  assert.equal(isPlatformReplySnippetAudience("admissions"), true);
  assert.equal(isPlatformReplySnippetAudience("draft"), false);
  assert.equal(isPlatformReplySnippetAudience(null), false);
});

test("reply-snippet rows normalize multi-line bodies and lossless versions", () => {
  assert.deepEqual(normalizePlatformReplySnippetRow(row(), ORGANIZATION_ID), {
    replySnippetId: SNIPPET_ID,
    audience: "sales",
    title: "Приветствие",
    body: "Здравствуйте!\nСпасибо, что написали нам.",
    version: "1",
    createdByMembershipId: MEMBERSHIP_ID,
    createdByDisplayName: "Айдана",
    createdAt: AT,
    updatedAt: AT,
  });
  const large = normalizePlatformReplySnippetRow(
    row({ version: "9007199254740993" }),
    ORGANIZATION_ID,
  );
  assert.equal(large.version, "9007199254740993");
});

test("reply-snippet rows enforce PostgreSQL edge whitespace and code-point limits", () => {
  const emojiTitle = "😀".repeat(120);
  const emojiBody = "😀".repeat(2_000);
  const boundary = normalizePlatformReplySnippetRow(
    row({ title: emojiTitle, body: emojiBody }),
    ORGANIZATION_ID,
  );
  assert.equal(boundary.title, emojiTitle);
  assert.equal(boundary.body, emojiBody);

  for (const overrides of [
    { title: "😀".repeat(121) },
    { body: "😀".repeat(2_001) },
    { body: "\nBody accepted by SQL only after canonical trimming\n" },
  ]) {
    assert.throws(
      () => normalizePlatformReplySnippetRow(row(overrides), ORGANIZATION_ID),
      PlatformReplySnippetsRepositoryError,
    );
  }

  const nonBreakingSpace = "\u00a0";
  assert.equal(
    normalizePlatformReplySnippetRow(
      row({ body: `${nonBreakingSpace}content${nonBreakingSpace}` }),
      ORGANIZATION_ID,
    ).body,
    `${nonBreakingSpace}content${nonBreakingSpace}`,
  );
});

test("an unknown audience key from the database never reaches the screen raw", () => {
  for (const audience of ["draft", "handed_off", "ALL", "", null]) {
    assert.throws(
      () => normalizePlatformReplySnippetRow(row({ audience }), ORGANIZATION_ID),
      PlatformReplySnippetsRepositoryError,
    );
  }
});

test("reply-snippet rows fail closed on malformed or foreign shapes", () => {
  assert.throws(
    () => normalizePlatformReplySnippetRow({ unexpected: true }, ORGANIZATION_ID),
    PlatformReplySnippetsRepositoryError,
  );
  assert.throws(
    () => normalizePlatformReplySnippetRow(
      { ...row(), extra_key: "x" },
      ORGANIZATION_ID,
    ),
    PlatformReplySnippetsRepositoryError,
  );
  assert.throws(
    () => normalizePlatformReplySnippetRow(
      row({ organization_id: "99999999-9999-4999-8999-999999999999" }),
      ORGANIZATION_ID,
    ),
    PlatformReplySnippetsRepositoryError,
  );
  assert.throws(
    () => normalizePlatformReplySnippetRow(
      row({ title: "Bad\u0007title" }),
      ORGANIZATION_ID,
    ),
    PlatformReplySnippetsRepositoryError,
  );
  assert.throws(
    () => normalizePlatformReplySnippetRow(
      row({ title: "Bad\u0085title" }),
      ORGANIZATION_ID,
    ),
    PlatformReplySnippetsRepositoryError,
  );
  assert.throws(
    () => normalizePlatformReplySnippetRow(
      row({ body: "Tab\tis a control character" }),
      ORGANIZATION_ID,
    ),
    PlatformReplySnippetsRepositoryError,
  );
  assert.throws(
    () => normalizePlatformReplySnippetRow(
      row({ body: "NUL\u0000must never reach the composer" }),
      ORGANIZATION_ID,
    ),
    PlatformReplySnippetsRepositoryError,
  );
  assert.throws(
    () => normalizePlatformReplySnippetRow(
      row({ title: "x".repeat(121) }),
      ORGANIZATION_ID,
    ),
    PlatformReplySnippetsRepositoryError,
  );
  assert.throws(
    () => normalizePlatformReplySnippetRow(
      row({ body: "x".repeat(2001) }),
      ORGANIZATION_ID,
    ),
    PlatformReplySnippetsRepositoryError,
  );
  assert.throws(
    () => normalizePlatformReplySnippetRow(row({ version: "0" }), ORGANIZATION_ID),
    PlatformReplySnippetsRepositoryError,
  );
});

test("reply-snippet listings reject duplicate identifiers", () => {
  const listing = normalizePlatformReplySnippets(
    [row(), row({ reply_snippet_id: OTHER_SNIPPET_ID, title: "Другое" })],
    ORGANIZATION_ID,
  );
  assert.equal(listing.length, 2);
  assert.equal(Object.isFrozen(listing), true);
  assert.throws(
    () => normalizePlatformReplySnippets([row(), row()], ORGANIZATION_ID),
    PlatformReplySnippetsRepositoryError,
  );
  assert.throws(
    () => normalizePlatformReplySnippets({ rows: [] }, ORGANIZATION_ID),
    PlatformReplySnippetsRepositoryError,
  );
});

test("reply-snippet reads use exactly one organization-scoped read RPC", async () => {
  const calls = [];
  const listing = await getPlatformReplySnippets(ACTOR, "sales", {
    client: {
      schema(name) {
        calls.push(["schema", name]);
        return {
          async rpc(name, args, options) {
            calls.push(["rpc", name, args, options]);
            return { data: [row()], error: null };
          },
        };
      },
    },
  });
  assert.equal(listing.length, 1);
  assert.deepEqual(calls, [
    ["schema", "platform"],
    [
      "rpc",
      "list_reply_snippets",
      { p_organization_id: ORGANIZATION_ID, p_audience: "sales" },
      { get: true },
    ],
  ]);
});

test("reply-snippet reads omit the optional audience instead of serializing null", async () => {
  const calls = [];
  const listing = await getPlatformReplySnippets(ACTOR, null, {
    client: {
      schema(name) {
        calls.push(["schema", name]);
        return {
          async rpc(name, args, options) {
            calls.push(["rpc", name, args, options]);
            return { data: [], error: null };
          },
        };
      },
    },
  });
  assert.deepEqual(listing, []);
  assert.deepEqual(calls, [
    ["schema", "platform"],
    [
      "rpc",
      "list_reply_snippets",
      { p_organization_id: ORGANIZATION_ID },
      { get: true },
    ],
  ]);
});

test("reply-snippet reads fail closed on bad filters, RPC errors and rows", async () => {
  await assert.rejects(
    getPlatformReplySnippets(ACTOR, "draft", {
      client: { schema() { throw new Error("must not run"); } },
    }),
    PlatformReplySnippetsRepositoryError,
  );
  await assert.rejects(
    getPlatformReplySnippets(ACTOR, null, {
      client: {
        schema() {
          return { async rpc() { return { data: null, error: { code: "XX" } }; } };
        },
      },
    }),
    PlatformReplySnippetsRepositoryError,
  );
  await assert.rejects(
    getPlatformReplySnippets(ACTOR, null, {
      client: {
        schema() {
          return {
            async rpc() {
              return { data: [{ unexpected: true }], error: null };
            },
          };
        },
      },
    }),
    PlatformReplySnippetsRepositoryError,
  );
});

const actionsSource = readFileSync(
  new URL("../src/lib/platform-reply-snippet-actions.ts", import.meta.url),
  "utf8",
);

test("reply-snippet actions expose create, versioned update and archive", () => {
  for (const actionName of [
    "createPlatformReplySnippetAction",
    "updatePlatformReplySnippetAction",
    "archivePlatformReplySnippetAction",
  ]) {
    assert.match(
      actionsSource,
      new RegExp(`export async function ${actionName}\\(`),
    );
  }
  for (const rpcName of [
    "create_reply_snippet",
    "update_reply_snippet",
    "archive_reply_snippet",
  ]) {
    assert.match(actionsSource, new RegExp(`"${rpcName}"`));
  }
  assert.equal(
    actionsSource.match(/_previous: PlatformReplySnippetActionState/g)?.length,
    3,
  );
  assert.match(actionsSource, /p_expected_version: expectedVersion/);
});

test("reply-snippet actions use exact forms, fixed roles and fail-closed output checks", () => {
  for (const fieldsName of [
    "CREATE_SNIPPET_FIELDS",
    "UPDATE_SNIPPET_FIELDS",
    "ARCHIVE_SNIPPET_FIELDS",
  ]) {
    assert.match(
      actionsSource,
      new RegExp(`exactActionStringFields\\(form, ${fieldsName}\\)`),
    );
  }
  assert.match(
    actionsSource,
    /fixedRoleCan\(actor\.authorityRole, "messaging\.send"\)/,
  );
  assert.match(actionsSource, /hasExactKeys\(value, keys\)/);
  assert.match(actionsSource, /CREATE_RESULT_KEYS/);
  assert.match(actionsSource, /MUTATE_RESULT_KEYS/);
  assert.match(
    actionsSource,
    /BigInt\(nextVersion\) !== BigInt\(expected\.previousVersion\) \+ BigInt\(1\)/,
  );
  assert.match(actionsSource, /revalidatePath\("\/v3\/inbox"\)/);
  assert.doesNotMatch(
    actionsSource,
    /localStorage|sessionStorage|indexedDB|fallback/i,
  );
});

test("reply-snippet action bodies keep LF newlines and normalize CRLF", () => {
  assert.match(
    actionsSource,
    /value\.replace\(\/\\r\\n\?\/g, "\\n"\)/,
  );
  assert.match(actionsSource, /PLATFORM_REPLY_SNIPPET_BODY_MAX_LENGTH/);
  assert.match(actionsSource, /PLATFORM_REPLY_SNIPPET_TITLE_MAX_LENGTH/);
  assert.match(
    actionsSource,
    /BODY_CONTROL_PATTERN = \/\[\\u0000-\\u0009\\u000B-\\u001F\\u007F\]\//,
  );
});

function updateForm() {
  const form = new FormData();
  form.set("reply_snippet_id", SNIPPET_ID);
  form.set("audience", "sales");
  form.set("title", "Приветствие");
  form.set("body", "Здравствуйте!\nСпасибо, что написали нам.");
  form.set("expected_version", LARGE_VERSION);
  form.set("request_id", REQUEST_ID);
  return form;
}

function updateReceipt(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    reply_snippet_id: SNIPPET_ID,
    audience: "sales",
    title: "Приветствие",
    body: "Здравствуйте!\nСпасибо, что написали нам.",
    request_id: REQUEST_ID,
    expected_version: LARGE_VERSION,
    version: "9007199254740994",
    archived_at: null,
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

test("reply-snippet mutation verifies the lossless echoed expected version", async () => {
  const { updatePlatformReplySnippetAction } = await import(
    "../src/lib/platform-reply-snippet-actions.ts"
  );
  actionHarness.rpcCalls.length = 0;
  actionHarness.revalidated.length = 0;
  actionHarness.response = { data: updateReceipt(), error: null };

  const accepted = await updatePlatformReplySnippetAction(
    {
      status: "idle",
      requestId: REQUEST_ID,
      replySnippetId: SNIPPET_ID,
      version: LARGE_VERSION,
      archivedAt: null,
    },
    updateForm(),
  );

  assert.equal(accepted.status, "saved");
  assert.equal(accepted.version, "9007199254740994");
  assert.deepEqual(actionHarness.revalidated, ["/v3/inbox"]);

  actionHarness.rpcCalls.length = 0;
  actionHarness.revalidated.length = 0;
  actionHarness.response = {
    data: updateReceipt({ expected_version: "9007199254740992" }),
    error: null,
  };

  const rejected = await updatePlatformReplySnippetAction(
    {
      status: "idle",
      requestId: REQUEST_ID,
      replySnippetId: SNIPPET_ID,
      version: LARGE_VERSION,
      archivedAt: null,
    },
    updateForm(),
  );

  assert.equal(rejected.status, "unavailable");
  assert.equal(rejected.requestId, REQUEST_ID);
  assert.equal(rejected.version, null);
  assert.deepEqual(actionHarness.revalidated, []);
  assert.deepEqual(actionHarness.rpcCalls, [
    {
      schemaName: "platform",
      rpcName: "update_reply_snippet",
      args: {
        p_organization_id: ORGANIZATION_ID,
        p_reply_snippet_id: SNIPPET_ID,
        p_audience: "sales",
        p_title: "Приветствие",
        p_body: "Здравствуйте!\nСпасибо, что написали нам.",
        p_expected_version: LARGE_VERSION,
        p_request_id: REQUEST_ID,
      },
    },
  ]);
});

test("reply-snippet actions match SQL LF trimming and Unicode code-point limits", async () => {
  const { updatePlatformReplySnippetAction } = await import(
    "../src/lib/platform-reply-snippet-actions.ts"
  );
  const previous = {
    status: "idle",
    requestId: REQUEST_ID,
    replySnippetId: SNIPPET_ID,
    version: LARGE_VERSION,
    archivedAt: null,
  };

  actionHarness.rpcCalls.length = 0;
  actionHarness.revalidated.length = 0;
  actionHarness.response = {
    data: updateReceipt({ body: "Wrapped body" }),
    error: null,
  };
  const wrappedForm = updateForm();
  wrappedForm.set("body", "\r\n  Wrapped body  \r\n");
  const wrapped = await updatePlatformReplySnippetAction(previous, wrappedForm);
  assert.equal(wrapped.status, "saved");
  assert.equal(actionHarness.rpcCalls[0].args.p_body, "Wrapped body");

  const emojiTitle = "😀".repeat(120);
  const emojiBody = "😀".repeat(2_000);
  actionHarness.rpcCalls.length = 0;
  actionHarness.revalidated.length = 0;
  actionHarness.response = {
    data: updateReceipt({ title: emojiTitle, body: emojiBody }),
    error: null,
  };
  const boundaryForm = updateForm();
  boundaryForm.set("title", emojiTitle);
  boundaryForm.set("body", emojiBody);
  const boundary = await updatePlatformReplySnippetAction(previous, boundaryForm);
  assert.equal(boundary.status, "saved");
  assert.equal(actionHarness.rpcCalls[0].args.p_title, emojiTitle);
  assert.equal(actionHarness.rpcCalls[0].args.p_body, emojiBody);

  actionHarness.rpcCalls.length = 0;
  actionHarness.revalidated.length = 0;
  const overLimitForm = updateForm();
  overLimitForm.set("body", "😀".repeat(2_001));
  const overLimit = await updatePlatformReplySnippetAction(
    previous,
    overLimitForm,
  );
  assert.equal(overLimit.status, "invalid");
  assert.deepEqual(actionHarness.rpcCalls, []);
  assert.deepEqual(actionHarness.revalidated, []);

  const c1ControlForm = updateForm();
  c1ControlForm.set("title", "Bad\u0085title");
  const c1Control = await updatePlatformReplySnippetAction(
    previous,
    c1ControlForm,
  );
  assert.equal(c1Control.status, "invalid");
  assert.deepEqual(actionHarness.rpcCalls, []);
  assert.deepEqual(actionHarness.revalidated, []);
});
