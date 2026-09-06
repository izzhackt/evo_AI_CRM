import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const AT = "2026-09-06T10:00:00+00:00";

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
      row({ body: "Tab\tis a control character" }),
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
});
